"""
Request validation. Messages and issue order are part of the API contract: the frontend shows each
issue next to its field. An issue marked `abort` (wrong type, unparseable date, unknown option,
non-integer) skips the cross-field date checks.
"""

import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Request

from .errors import HttpError
from .timefmt import now

MISSING = object()
DAY = timedelta(days=1)
TRIGGER_TYPES = ('BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_CHANGE')
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
MAX_DATE_MS = 8.64e15  # JavaScript's Date range


def js_type(v: Any) -> str:
    if v is MISSING:
        return 'undefined'
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'boolean'
    if isinstance(v, (int, float)):
        return 'number'
    if isinstance(v, str):
        return 'string'
    if isinstance(v, list):
        return 'array'
    return 'object'


def is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


@dataclass
class Issues:
    items: list[tuple[str, str, bool]] = field(default_factory=list)

    def add(self, path: str, message: str, abort: bool = False) -> None:
        self.items.append((path, message, abort))

    @property
    def aborted(self) -> bool:
        return any(a for _, _, a in self.items)

    def raise_if_any(self) -> None:
        if self.items:
            issues = [{'path': p, 'message': m} for p, m, _ in self.items]
            raise HttpError(400, issues[0]['message'], issues)


# --- request body ----------------------------------------------------------------------------

async def json_body(request: Request) -> Any:
    """
    The parsed JSON body, or MISSING when there is none (not JSON, or empty). Only objects and
    arrays are accepted at the top level, and anything unparseable is 'Invalid JSON body'.
    """
    content_type = request.headers.get('content-type', '').split(';')[0].strip().lower()
    raw = await request.body()
    if content_type != 'application/json' or not raw:
        return MISSING
    text = raw.decode('utf-8', errors='replace').lstrip()
    if not text.startswith(('{', '[')):
        raise HttpError(400, 'Invalid JSON body')

    def reject_constant(c):
        raise ValueError(c)  # NaN / Infinity are not JSON

    try:
        return json.loads(text, parse_constant=reject_constant)
    except ValueError:
        raise HttpError(400, 'Invalid JSON body')


def as_object(body: Any, issues: Issues) -> dict | None:
    if not isinstance(body, dict):
        issues.add('', f'Invalid input: expected object, received {js_type(body)}', abort=True)
        return None
    return body


# --- field checks ----------------------------------------------------------------------------

def string(obj: dict, key: str, issues: Issues, required_msg: str, max_len: int) -> str | None:
    v = obj.get(key, MISSING)
    if not isinstance(v, str):
        issues.add(key, f'Invalid input: expected string, received {js_type(v)}', abort=True)
        return None
    s = v.strip()
    if len(s) < 1:
        issues.add(key, required_msg)
    if len(s) > max_len:
        issues.add(key, f'Too big: expected string to have <={max_len} characters')
    return s


def minutes(obj: dict, key: str, issues: Issues, min_msg: str) -> int | None:
    """z.number().int().min(1, msg).max(1440)"""
    v = obj.get(key, MISSING)
    if not is_number(v):
        issues.add(key, f'Invalid input: expected number, received {js_type(v)}', abort=True)
        return None
    if v != int(v):
        issues.add(key, 'Invalid input: expected int, received number', abort=True)
        return None
    if v < 1:
        issues.add(key, min_msg)
    if v > 1440:
        issues.add(key, 'Too big: expected number to be <=1440')
    return int(v)


def trigger_type(obj: dict, issues: Issues) -> str | None:
    v = obj.get('triggerType', MISSING)
    if v not in TRIGGER_TYPES:
        issues.add('triggerType', 'Invalid option: expected one of ' + '|'.join(f'"{t}"' for t in TRIGGER_TYPES), abort=True)
        return None
    return v


def money(obj: dict, key: str, label: str, issues: Issues) -> int | None:
    """z.number({ error }).min(0).max(1e9), as integer cents. Unlabelled failures use the field's message."""
    v = obj.get(key, MISSING)
    if not is_number(v):
        issues.add(key, f'{label} is required', abort=True)
        return None
    if v < 0:
        issues.add(key, f'{label} cannot be negative')
    if v > 1e9:
        issues.add(key, f'{label} is required')
    return math.floor(v * 100 + 0.5)  # JavaScript's Math.round


def transit_days(obj: dict, issues: Issues) -> int | None:
    v = obj.get('transitTimeDays', MISSING)
    if not is_number(v) or v != int(v):
        issues.add('transitTimeDays', 'Transit time is required', abort=True)
        return None
    if v < 1:
        issues.add('transitTimeDays', 'Transit time must be at least 1 day')
    if v > 365:
        issues.add('transitTimeDays', 'Transit time is required')
    return int(v)


ISO = re.compile(
    r'^(?P<y>\d{4}|[+-]\d{6})(?:-(?P<mo>\d{2})(?:-(?P<d>\d{2}))?)?'
    r'(?:T(?P<h>\d{2}):(?P<mi>\d{2})(?::(?P<s>\d{2})(?:\.(?P<f>\d+))?)?(?P<tz>Z|[+-]\d{2}:\d{2})?)?$'
)


def js_date(v: Any) -> datetime | None:
    """`new Date(v)` for JSON values. Strings must be ISO 8601, which is what the frontend sends."""
    if v is MISSING or isinstance(v, (dict, list)):
        return None
    if v is None or isinstance(v, bool) or is_number(v):
        ms = float(v or 0)
        if abs(ms) > MAX_DATE_MS:
            return None
        try:
            return EPOCH + timedelta(milliseconds=math.trunc(ms))
        except OverflowError:
            return None
    if not isinstance(v, str):
        return None
    m = ISO.match(v.strip())
    if not m:
        return None
    try:
        dt = datetime(
            int(m['y']), int(m['mo'] or 1), int(m['d'] or 1), int(m['h'] or 0), int(m['mi'] or 0), int(m['s'] or 0),
            int((m['f'] or '0')[:3].ljust(3, '0')) * 1000,
        )
    except ValueError:
        return None
    if m['tz'] == 'Z':
        return dt.replace(tzinfo=timezone.utc)
    if m['tz']:
        sign = 1 if m['tz'][0] == '+' else -1
        hh, mm = int(m['tz'][1:3]), int(m['tz'][4:6])
        return dt.replace(tzinfo=timezone(sign * timedelta(hours=hh, minutes=mm)))
    if m['h'] is None:
        return dt.replace(tzinfo=timezone.utc)  # date-only forms are UTC
    return dt.astimezone(timezone.utc)  # date-time without offset is server local time


def date(obj: dict, key: str, issues: Issues, msg: str) -> datetime | None:
    dt = js_date(obj.get(key, MISSING))
    if dt is None:
        issues.add(key, msg, abort=True)
    return dt


# --- request schemas -------------------------------------------------------------------------

def rfq_input(body: Any) -> dict:
    issues = Issues()
    obj = as_object(body, issues)
    if obj is None:
        issues.raise_if_any()
    v = {
        'ref_id': string(obj, 'refId', issues, 'Reference ID is required', 50),
        'name': string(obj, 'name', issues, 'RFQ name is required', 200),
        'bid_start_at': date(obj, 'bidStartAt', issues, 'Bid start time is required'),
        'bid_close_at': date(obj, 'bidCloseAt', issues, 'Bid close time is required'),
        'forced_close_at': date(obj, 'forcedCloseAt', issues, 'Forced close time is required'),
        'pickup_date': date(obj, 'pickupDate', issues, 'Pickup / service date is required'),
        'trigger_window_min': minutes(obj, 'triggerWindowMin', issues, 'Trigger window (X) must be at least 1 minute'),
        'extension_min': minutes(obj, 'extensionMin', issues, 'Extension duration (Y) must be at least 1 minute'),
        'trigger_type': trigger_type(obj, issues),
    }
    if not issues.aborted:
        if v['bid_close_at'] <= v['bid_start_at']:
            issues.add('bidCloseAt', 'Bid close time must be after bid start time')
        if v['forced_close_at'] <= v['bid_close_at']:
            issues.add('forcedCloseAt', 'Forced close time must be later than bid close time')
        if v['bid_close_at'] <= now():
            issues.add('bidCloseAt', 'Bid close time must be in the future')
        # pickupDate is a calendar date (UTC midnight); it may fall on the same day as forced close
        if v['pickup_date'] + DAY <= v['forced_close_at']:
            issues.add('pickupDate', 'Pickup / service date cannot be before the forced close date')
    issues.raise_if_any()
    return v


def bid_input(body: Any) -> dict:
    issues = Issues()
    obj = as_object(body, issues)
    if obj is None:
        issues.raise_if_any()
    v = {
        'carrier_name': string(obj, 'carrierName', issues, 'Carrier name is required', 100),
        'freight_cents': money(obj, 'freightCharges', 'Freight charges', issues),
        'origin_cents': money(obj, 'originCharges', 'Origin charges', issues),
        'destination_cents': money(obj, 'destinationCharges', 'Destination charges', issues),
        'transit_time_days': transit_days(obj, issues),
        'quote_valid_until': date(obj, 'quoteValidUntil', issues, 'Quote validity date is required'),
    }
    issues.raise_if_any()
    return v
