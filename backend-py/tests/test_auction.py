from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from itertools import count

from app.auction import detect_trigger, extend_close, in_trigger_window, is_open, rank, status, to_cents


def t(hhmm: str) -> datetime:
    return datetime.fromisoformat(f'2026-01-01T{hhmm}:00').replace(tzinfo=timezone.utc)


@dataclass
class Bid:
    id: int
    supplier_id: int
    total_cents: int
    created_at: datetime


next_id = count(1)


def bid(supplier_id: int, total: int, at: str = '17:00') -> Bid:
    return Bid(next(next_id), supplier_id, total * 100, t(at))


def name(i: int) -> str:
    return ['', 'A', 'B', 'C'][i]


def ids(r: list[Bid]) -> list[int]:
    return [b.supplier_id for b in r]


def test_rank_uses_each_supplier_latest_bid_ties_go_to_earlier_bid():
    bids = [bid(1, 1000, '17:00'), bid(2, 900, '17:01'), bid(1, 800, '17:02'), bid(3, 900, '17:00')]
    assert ids(rank(bids)) == [1, 3, 2]  # A=800, C=900@17:00 beats B=900@17:01


def test_to_cents_avoids_float_drift():
    assert to_cents('0.1') + to_cents('0.2') == to_cents('0.3')
    assert to_cents(1234.56) == 123456


def test_is_open_start_inclusive_close_exclusive():
    start, close = t('17:00'), t('18:00')
    assert is_open(start, close, t('16:59')) is False
    assert is_open(start, close, t('17:00')) is True
    assert is_open(start, close, t('18:00') - timedelta(milliseconds=1)) is True
    assert is_open(start, close, t('18:00')) is False


def test_trigger_window_is_the_last_x_minutes_before_current_close():
    assert in_trigger_window(t('17:49'), t('18:00'), 10) is False
    assert in_trigger_window(t('17:50'), t('18:00'), 10) is True
    assert in_trigger_window(t('17:59'), t('18:00'), 10) is True
    assert in_trigger_window(t('18:00'), t('18:00'), 10) is False
    # after an extension the window moves with the close time
    assert in_trigger_window(t('17:56'), t('18:05'), 10) is True


def test_bid_received_always_fires():
    a = bid(1, 1000)
    assert detect_trigger('BID_RECEIVED', [a], [a, bid(2, 2000)], name)


def test_any_rank_change_overtaking_fires_bottom_entrant_and_self_undercut_do_not():
    a, b = bid(1, 1000), bid(2, 1200)
    before = rank([a, b])
    b2 = bid(2, 900, '17:58')
    assert detect_trigger('ANY_RANK_CHANGE', before, rank([a, b, b2]), name) == 'Rank change: B L2→L1, A L1→L2'
    # new supplier enters at the bottom: nobody moved
    assert detect_trigger('ANY_RANK_CHANGE', before, rank([a, b, bid(3, 5000)]), name) is None
    # new supplier enters in the middle: B moves L2→L3
    assert detect_trigger('ANY_RANK_CHANGE', before, rank([a, b, bid(3, 1100)]), name)
    # L1 lowers own price: ranks unchanged
    assert detect_trigger('ANY_RANK_CHANGE', before, rank([a, b, bid(1, 950)]), name) is None
    # very first bid: no previously ranked supplier
    assert detect_trigger('ANY_RANK_CHANGE', [], [a], name) is None


def test_l1_change_only_a_different_lowest_supplier_fires():
    a, b = bid(1, 1000), bid(2, 1200)
    before = rank([a, b])
    assert detect_trigger('L1_CHANGE', before, rank([a, b, bid(3, 900)]), name) == 'L1 changed: A → C'
    assert detect_trigger('L1_CHANGE', before, rank([a, b, bid(2, 1100)]), name) is None  # L2 improves, still L2
    assert detect_trigger('L1_CHANGE', before, rank([a, b, bid(1, 900)]), name) is None  # L1 undercuts self
    assert detect_trigger('L1_CHANGE', [], [a], name) is None  # first bid


def test_extension_adds_y_to_current_close_capped_at_forced_close():
    assert extend_close(t('18:00'), t('18:30'), 5) == t('18:05')
    assert extend_close(t('18:28'), t('18:30'), 5) == t('18:30')
    assert extend_close(t('18:30'), t('18:30'), 5) is None


def test_status_derivation():
    start, close, forced = t('17:00'), t('18:00'), t('18:30')
    assert status(start, close, forced, t('16:00')) == 'UPCOMING'
    assert status(start, close, forced, t('17:30')) == 'ACTIVE'
    assert status(start, close, forced, t('18:00')) == 'CLOSED'
    assert status(start, t('18:30'), forced, t('18:30')) == 'FORCE_CLOSED'
