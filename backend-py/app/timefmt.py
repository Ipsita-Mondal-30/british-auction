from datetime import datetime, timezone


def iso(dt: datetime) -> str:
    """Same shape as JavaScript's toISOString(): UTC, milliseconds, trailing Z."""
    dt = dt.astimezone(timezone.utc)
    return dt.strftime('%Y-%m-%dT%H:%M:%S.') + f'{dt.microsecond // 1000:03d}Z'


def now() -> datetime:
    """Current UTC time at millisecond precision, matching TIMESTAMP(3) and JavaScript dates."""
    dt = datetime.now(timezone.utc)
    return dt.replace(microsecond=dt.microsecond // 1000 * 1000)
