"""Resets the DB to demo data with times relative to "now". Run: python -m app.seed"""

import asyncio
import math
import re
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import text

from . import config
from .db import Session, engine
from .models import AuctionEvent, Bid, Rfq, User
from .routes import inr
from .timefmt import now

# The seed wipes every table. Refuse to touch a remote database unless explicitly told to.
if not re.search(r'@(localhost|127\.0\.0\.1)[:/]', config.DATABASE_URL) and '--force' not in sys.argv:
    sys.exit('Refusing to reset a non-local database. Re-run with: python -m app.seed --force')


def at(min_from_now: float) -> datetime:
    return now() + timedelta(minutes=min_from_now)


def day(days_from_now: int) -> date:
    return now().date() + timedelta(days=days_from_now)


def js_round(x: float) -> int:
    return math.floor(x + 0.5)


async def main() -> None:
    async with Session() as db, db.begin():
        await db.execute(text('TRUNCATE "AuctionEvent", "Bid", "Rfq", "User" RESTART IDENTITY CASCADE'))

        buyer = User(name='Priya Sharma', company='Acme Manufacturing', role='BUYER')
        db.add(buyer)
        suppliers = []
        for name, company in [
            ('Rahul Verma', 'Swift Freight'),
            ('Ananya Iyer', 'Oceanic Carriers'),
            ('Karan Mehta', 'Northline Cargo'),
            ('Sara Khan', 'Rapid Haul'),
        ]:
            s = User(name=name, company=company, role='SUPPLIER')
            db.add(s)
            await db.flush()
            suppliers.append(s)
        s1, s2, s3, s4 = suppliers

        async def rfq(ref_id: str, name: str, t: dict, cfg: dict, bids: list[tuple[User, int, int]]) -> Rfq:
            r = Rfq(
                ref_id=ref_id,
                name=name,
                buyer_id=buyer.id,
                bid_start_at=at(t['start']),
                bid_close_at=at(t['close']),
                current_close_at=at(t.get('current', t['close'])),
                forced_close_at=at(t['forced']),
                pickup_date=day(math.ceil(t['forced'] / 1440) + 2),
                trigger_window_min=cfg['x'],
                extension_min=cfg['y'],
                trigger_type=cfg['type'],
                created_at=now(),
            )
            db.add(r)
            await db.flush()
            for s, total, when in bids:
                freight = js_round(total * 0.7)
                origin = js_round(total * 0.15)
                created_at = at(when)
                bid = Bid(
                    rfq_id=r.id,
                    supplier_id=s.id,
                    carrier_name=s.company,
                    freight_charges=Decimal(freight),
                    origin_charges=Decimal(origin),
                    destination_charges=Decimal(total - freight - origin),
                    total_amount=Decimal(total),
                    transit_time_days=3 + s.id % 4,
                    quote_valid_until=day(30),
                    created_at=created_at,
                )
                db.add(bid)
                await db.flush()
                db.add(AuctionEvent(
                    rfq_id=r.id, type='BID_PLACED', actor_id=s.id, bid_id=bid.id,
                    reason=f'{s.name} bid {inr(total * 100)}', created_at=created_at,
                ))
                await db.flush()
            return r

        # Demo: closes in 5 min and we're already inside the 10-min window, so an L1-changing bid extends it.
        await rfq(
            'RFQ-1001',
            'Mumbai → Delhi, 2 x 40ft containers',
            {'start': -60, 'close': 5, 'forced': 20},
            {'x': 10, 'y': 5, 'type': 'L1_CHANGE'},
            [(s1, 182000, -50), (s2, 175000, -40), (s3, 179500, -30), (s1, 171000, -20)],
        )

        await rfq(
            'RFQ-1002',
            'Chennai → Bengaluru, refrigerated LTL',
            {'start': -30, 'close': 120, 'forced': 180},
            {'x': 15, 'y': 10, 'type': 'ANY_RANK_CHANGE'},
            [(s2, 64000, -25), (s4, 61500, -15)],
        )

        await rfq(
            'RFQ-1003',
            'Pune → Kolkata, project cargo',
            {'start': 60, 'close': 24 * 60, 'forced': 24 * 60 + 60},
            {'x': 10, 'y': 5, 'type': 'BID_RECEIVED'},
            [],
        )

        await rfq(
            'RFQ-0999',
            'Ahmedabad → Jaipur, palletised FMCG',
            {'start': -26 * 60, 'close': -2 * 60, 'forced': -60},
            {'x': 10, 'y': 5, 'type': 'BID_RECEIVED'},
            [(s3, 98000, -25 * 60), (s1, 95000, -20 * 60), (s3, 93500, -5 * 60)],
        )

        # Force closed: kept extending until it hit the forced close cap.
        fc = await rfq(
            'RFQ-0998',
            'Kochi Port → Hyderabad, 1 x 20ft container',
            {'start': -6 * 60, 'close': -3 * 60, 'current': -2 * 60 - 45, 'forced': -2 * 60 - 45},
            {'x': 10, 'y': 10, 'type': 'ANY_RANK_CHANGE'},
            [(s1, 88000, -5 * 60), (s2, 86000, -4 * 60), (s1, 85000, -3 * 60 - 4), (s2, 84000, -2 * 60 - 55)],
        )
        db.add_all([
            AuctionEvent(
                rfq_id=fc.id, type='TIME_EXTENDED', actor_id=s1.id,
                old_close_at=at(-3 * 60), new_close_at=at(-2 * 60 - 50),
                reason=f'Rank change: {s1.name} L2→L1, {s2.name} L1→L2 in the last 10 min → extended by 10 min',
                created_at=at(-3 * 60 - 4),
            ),
            AuctionEvent(
                rfq_id=fc.id, type='TIME_EXTENDED', actor_id=s2.id,
                old_close_at=at(-2 * 60 - 50), new_close_at=at(-2 * 60 - 45),
                reason=f'Rank change: {s2.name} L2→L1, {s1.name} L1→L2 in the last 10 min → extended by 5 min (capped at forced close time)',
                created_at=at(-2 * 60 - 55),
            ),
        ])

    print(f'Seeded 1 buyer, {len(suppliers)} suppliers, 5 RFQs')
    await engine.dispose()


asyncio.run(main())
