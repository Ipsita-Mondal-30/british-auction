"""
Rows to JSON in exactly the shape the Node API (Prisma) produces: camelCase keys, timestamps
as JavaScript ISO strings, DATE columns as UTC midnight, money as plain decimal strings.
"""

from datetime import date, datetime
from decimal import Decimal

from .models import AuctionEvent, Bid, Rfq, User
from .timefmt import iso


def ts(dt: datetime | None) -> str | None:
    return iso(dt) if dt is not None else None


def day(d: date) -> str:
    """Prisma returns DATE columns as a timestamp at UTC midnight."""
    return f'{d.isoformat()}T00:00:00.000Z'


def money(d: Decimal | None) -> str | None:
    """Like Prisma's Decimal: no trailing zeros, no exponent ("182000", "69199.89")."""
    if d is None:
        return None
    s = format(d.normalize(), 'f')
    return '0' if s in ('-0', '') else s


def user(u: User) -> dict:
    return {'id': u.id, 'name': u.name, 'company': u.company, 'role': u.role}


def rfq(r: Rfq) -> dict:
    return {
        'id': r.id,
        'refId': r.ref_id,
        'name': r.name,
        'buyerId': r.buyer_id,
        'bidStartAt': ts(r.bid_start_at),
        'bidCloseAt': ts(r.bid_close_at),
        'currentCloseAt': ts(r.current_close_at),
        'forcedCloseAt': ts(r.forced_close_at),
        'pickupDate': day(r.pickup_date),
        'triggerWindowMin': r.trigger_window_min,
        'extensionMin': r.extension_min,
        'triggerType': r.trigger_type,
        'createdAt': ts(r.created_at),
    }


def bid(b: Bid) -> dict:
    return {
        'id': b.id,
        'rfqId': b.rfq_id,
        'supplierId': b.supplier_id,
        'carrierName': b.carrier_name,
        'freightCharges': money(b.freight_charges),
        'originCharges': money(b.origin_charges),
        'destinationCharges': money(b.destination_charges),
        'totalAmount': money(b.total_amount),
        'transitTimeDays': b.transit_time_days,
        'quoteValidUntil': day(b.quote_valid_until),
        'createdAt': ts(b.created_at),
        'supplier': {'id': b.supplier.id, 'name': b.supplier.name, 'company': b.supplier.company},
    }


def event(e: AuctionEvent) -> dict:
    return {
        'id': e.id,
        'rfqId': e.rfq_id,
        'type': e.type,
        'actorId': e.actor_id,
        'bidId': e.bid_id,
        'oldCloseAt': ts(e.old_close_at),
        'newCloseAt': ts(e.new_close_at),
        'reason': e.reason,
        'createdAt': ts(e.created_at),
    }
