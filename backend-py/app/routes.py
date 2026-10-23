import math
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, Header
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from . import auction as A
from . import serialize as S
from .db import get_session
from .errors import HttpError
from .models import AuctionEvent, Bid, Rfq, User
from .timefmt import iso, now

router = APIRouter(prefix='/api')
Db = Annotated[AsyncSession, Depends(get_session)]

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


@router.get('/rfqs/{id}')
async def get_rfq(id: str, db: Db, user: Me):
    return {'serverNow': iso(now()), 'rfq': await details(db, parse_id(id), user)}
