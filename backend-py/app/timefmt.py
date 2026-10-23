from datetime import datetime, timezone


def iso(dt: datetime) -> str:
    """Same shape as JavaScript's toISOString(): UTC, milliseconds, trailing Z."""
    dt = dt.astimezone(timezone.utc)
    return dt.strftime('%Y-%m-%dT%H:%M:%S.') + f'{dt.microsecond // 1000:03d}Z'


def now() -> datetime:
    return datetime.now(timezone.utc)
