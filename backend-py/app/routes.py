import math
from collections import defaultdict
from datetime import timezone
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from . import auction as A
from . import serialize as S
from .db import get_session
from .errors import HttpError
from .models import AuctionEvent, Bid, Rfq, User
from .realtime import rfq_updated
from .timefmt import iso, now
from .validation import DAY, bid_input, json_body, rfq_input

router = APIRouter(prefix='/api')
Db = Annotated[AsyncSession, Depends(get_session)]
# Declared before the user, so a malformed body is rejected before auth is checked.
Body = Annotated[Any, Depends(json_body)]

TRIGGER_LABEL = {
    'BID_RECEIVED': 'Bid received',
    'ANY_RANK_CHANGE': 'Supplier ranking changed',
    'L1_CHANGE': 'Lowest bidder (L1) changed',
}


def js_int(raw: str | None) -> int | None:
    """Integer value of a header or path segment, read the way JavaScript's Number() reads it."""
    if raw is None:
        return None
    s = raw.strip()
    if s == '':
        return 0
    try:
        n = int(s, 16) if s.lower().startswith('0x') else float(s)
    except ValueError:
        return None
    return int(n) if math.isfinite(n) and n == int(n) else None


def parse_id(raw: str) -> int:
    n = js_int(raw)
    if n is None or n <= 0:
        raise HttpError(404, 'RFQ not found')
    return n


# ponytail: mock auth — trusts the x-user-id header. Swap for real sessions/JWT before production.
async def current_user(db: Db, x_user_id: Annotated[str | None, Header()] = None) -> User:
    n = js_int(x_user_id)
    user = await db.get(User, n) if n is not None else None
    if user is None:
        raise HttpError(401, 'Pick a user to log in as')
    return user


Me = Annotated[User, Depends(current_user)]


def require_role(user: User, role: str) -> User:
    if user.role != role:
        raise HttpError(403, f'Only {role.lower()}s can do this')
    return user


def inr(cents: int) -> str:
    """Rupees with Indian digit grouping, like toLocaleString('en-IN'): 1,71,000.00"""
    rupees, paise = divmod(cents, 100)
    digits = str(rupees)
    head, tail = digits[:-3], digits[-3:]
    groups = []
    while head:
        groups.insert(0, head[-2:])
        head = head[:-2]
    return ','.join([*groups, tail]) + f'.{paise:02d}'


def rupees(cents: int) -> Decimal:
    return Decimal(cents).scaleb(-2)


def supplier_event(e: AuctionEvent, me: int, rfq: Rfq) -> dict:
    """What a supplier may see of the activity log: their own bids, never competitor identities."""
    if e.type == 'BID_PLACED':
        reason = e.reason if e.actor_id == me else 'A competitor placed a bid'
    elif e.type == 'TIME_EXTENDED':
        reason = f'{TRIGGER_LABEL[rfq.trigger_type]} in the last {rfq.trigger_window_min} min'
    else:
        reason = 'Trigger fired, but the auction is already at its forced close time'
    out = S.event(e)
    del out['actorId'], out['bidId']
    return {**out, 'reason': reason, 'mine': e.actor_id == me}


async def details(db: AsyncSession, id: int, user: User) -> dict:
    rfq = await db.scalar(
        select(Rfq)
        .where(Rfq.id == id)
        .options(selectinload(Rfq.buyer), selectinload(Rfq.bids).selectinload(Bid.supplier), selectinload(Rfq.events))
        .execution_options(populate_existing=True)
    )
    if rfq is None:
        raise HttpError(404, 'RFQ not found')

    ranked = A.rank(rfq.bids)
    base = {
        **S.rfq(rfq),
        'buyer': {'name': rfq.buyer.name, 'company': rfq.buyer.company},
        'status': A.status(rfq.bid_start_at, rfq.current_close_at, rfq.forced_close_at, now()),
        'lowestBid': S.money(ranked[0].total_amount) if ranked else None,
        'bidCount': len(rfq.bids),
        'supplierCount': len(ranked),
    }

    if user.role == 'BUYER':
        # Every bid ever placed, lowest first; `current` marks each supplier's live quote.
        live = {b.id for b in ranked}
        all_bids = sorted(rfq.bids, key=lambda b: (b.total_cents, b.created_at, b.id))
        return {
            **base,
            'ranking': [{'rank': i + 1, **S.bid(b)} for i, b in enumerate(ranked)],
            'allBids': [{**S.bid(b), 'current': b.id in live} for b in all_bids],
            'events': [S.event(e) for e in rfq.events],
        }
    my_rank = next((i + 1 for i, b in enumerate(ranked) if b.supplier_id == user.id), None)
    return {
        **base,
        'myRank': my_rank,
        'myBids': [S.bid(b) for b in rfq.bids if b.supplier_id == user.id],
        'events': [supplier_event(e, user.id, rfq) for e in rfq.events],
    }


@router.get('/health')
async def health():
    return {'ok': True, 'serverNow': iso(now())}


@router.get('/users')
async def users(db: Db):
    rows = await db.scalars(select(User).order_by(User.role, User.id))
    return [S.user(u) for u in rows]


@router.get('/rfqs')
async def list_rfqs(db: Db, user: Me):
    rfqs = (await db.scalars(select(Rfq).order_by(Rfq.id.desc()))).all()
    # Bids only ever go down per supplier, so the global minimum is the current L1 price.
    mins = await db.execute(select(Bid.rfq_id, func.min(Bid.total_amount), func.count()).group_by(Bid.rfq_id))
    by_rfq = {rfq_id: (low, count) for rfq_id, low, count in mins}
    t = now()

    # Suppliers also get their own rank per RFQ (drives "you've been outbid" notifications).
    # ponytail: loads every bid; fine at assignment scale, move to a window-function query if bids grow large.
    my_rank: dict[int, int] = {}
    if user.role == 'SUPPLIER':
        per_rfq: dict[int, list[Bid]] = defaultdict(list)
        for b in await db.scalars(select(Bid)):
            per_rfq[b.rfq_id].append(b)
        for rfq_id, bids in per_rfq.items():
            rank = next((i + 1 for i, b in enumerate(A.rank(bids)) if b.supplier_id == user.id), None)
            if rank:
                my_rank[rfq_id] = rank

    out = []
    for r in rfqs:
        low, count = by_rfq.get(r.id, (None, 0))
        row = {
            **S.rfq(r),
            'status': A.status(r.bid_start_at, r.current_close_at, r.forced_close_at, t),
            'lowestBid': S.money(low),
            'bidCount': count,
        }
        if user.role == 'SUPPLIER':
            row['myRank'] = my_rank.get(r.id)
        out.append(row)
    return {'serverNow': iso(t), 'rfqs': out}


@router.post('/rfqs')
async def create_rfq(body: Body, db: Db, user: Me):
    buyer = require_role(user, 'BUYER')
    v = rfq_input(body)
    rfq = Rfq(
        ref_id=v['ref_id'],
        name=v['name'],
        buyer_id=buyer.id,
        bid_start_at=v['bid_start_at'],
        bid_close_at=v['bid_close_at'],
        current_close_at=v['bid_close_at'],
        forced_close_at=v['forced_close_at'],
        pickup_date=v['pickup_date'].astimezone(timezone.utc).date(),
        trigger_window_min=v['trigger_window_min'],
        extension_min=v['extension_min'],
        trigger_type=v['trigger_type'],
        created_at=now(),  # set here, not by the DB default, which uses the session time zone
    )
    db.add(rfq)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        if getattr(e.orig, 'sqlstate', None) == '23505':
            raise HttpError(409, f'Reference ID "{v["ref_id"]}" is already in use', [
                {'path': 'refId', 'message': 'Reference ID is already in use'},
            ])
        raise
    await db.refresh(rfq)
    await rfq_updated(rfq.id, 'list')
    return JSONResponse(S.rfq(rfq), status_code=201)


@router.get('/rfqs/{id}')
async def get_rfq(id: str, db: Db, user: Me):
    return {'serverNow': iso(now()), 'rfq': await details(db, parse_id(id), user)}


@router.post('/rfqs/{id}/bids')
async def place_bid(id: str, body: Body, db: Db, user: Me):
    # Arrival time is the bid's timestamp. Close times only ever move later, so checking
    # against arrival (not lock-acquired) time never lets a late bid in.
    t = now()
    rfq_id = parse_id(id)
    supplier = require_role(user, 'SUPPLIER')
    v = bid_input(body)
    total_cents = v['freight_cents'] + v['origin_cents'] + v['destination_cents']
    if total_cents <= 0:
        raise HttpError(400, 'Total charges must be greater than 0')
    if v['quote_valid_until'] + DAY <= t:
        raise HttpError(400, 'Quote validity cannot be in the past')

    await db.commit()  # end the read transaction the auth lookup opened
    async with db.begin():
        # Row lock: bids on the same RFQ are processed one at a time.
        locked = await db.scalar(select(Rfq.id).where(Rfq.id == rfq_id).with_for_update())
        if locked is None:
            raise HttpError(404, 'RFQ not found')
        rfq = await db.scalar(
            select(Rfq).where(Rfq.id == rfq_id).options(selectinload(Rfq.bids)).execution_options(populate_existing=True)
        )
        if not A.is_open(rfq.bid_start_at, rfq.current_close_at, t):
            raise HttpError(409, 'Bidding has not started yet' if t < rfq.bid_start_at else 'Bidding is closed')

        before = A.rank(rfq.bids)
        mine = next((b for b in before if b.supplier_id == supplier.id), None)
        if mine and total_cents >= mine.total_cents:
            raise HttpError(400, f'New bid must be lower than your previous bid of {inr(mine.total_cents)}')

        bid = Bid(
            rfq_id=rfq_id,
            supplier_id=supplier.id,
            carrier_name=v['carrier_name'],
            freight_charges=rupees(v['freight_cents']),
            origin_charges=rupees(v['origin_cents']),
            destination_charges=rupees(v['destination_cents']),
            total_amount=rupees(total_cents),
            transit_time_days=v['transit_time_days'],
            quote_valid_until=v['quote_valid_until'].astimezone(timezone.utc).date(),
            created_at=t,
        )
        db.add(bid)
        await db.flush()
        after = A.rank([*rfq.bids, bid])
        my_rank = next(i + 1 for i, b in enumerate(after) if b.supplier_id == supplier.id)

        names = {u.id: u.name for u in await db.scalars(select(User).where(User.id.in_([b.supplier_id for b in after])))}
        name = lambda sid: names.get(sid, f'#{sid}')

        db.add(AuctionEvent(
            rfq_id=rfq_id, type='BID_PLACED', actor_id=supplier.id, bid_id=bid.id,
            reason=f'{supplier.name} bid {inr(total_cents)} → now L{my_rank}', created_at=t,
        ))

        cause = A.detect_trigger(rfq.trigger_type, before, after, name) if A.in_trigger_window(
            t, rfq.current_close_at, rfq.trigger_window_min
        ) else None
        if cause:
            new_close = A.extend_close(rfq.current_close_at, rfq.forced_close_at, rfq.extension_min)
            window = f'in the last {rfq.trigger_window_min} min'
            if new_close is None:
                db.add(AuctionEvent(
                    rfq_id=rfq_id, type='EXTENSION_CAPPED', actor_id=supplier.id, bid_id=bid.id,
                    reason=f'{cause} {window}, but the auction is already at its forced close time', created_at=t,
                ))
            else:
                added_min = (new_close - rfq.current_close_at).total_seconds() / 60
                capped = ' (capped at forced close time)' if added_min < rfq.extension_min else ''
                db.add(AuctionEvent(
                    rfq_id=rfq_id, type='TIME_EXTENDED', actor_id=supplier.id, bid_id=bid.id,
                    old_close_at=rfq.current_close_at, new_close_at=new_close,
                    reason=f'{cause} {window} → extended by {js_minutes(added_min)} min{capped}', created_at=t,
                ))
                rfq.current_close_at = new_close

    await rfq_updated(rfq_id, f'rfq:{rfq_id}', 'list')
    return JSONResponse({'serverNow': iso(now()), 'rfq': await details(db, rfq_id, supplier)}, status_code=201)


def js_minutes(m: float) -> str:
    """`+m.toFixed(2)` in JavaScript: at most 2 decimals, no trailing zeros (5, 2.5, 0.33)."""
    return format(Decimal(f'{m:.2f}').normalize(), 'f')
