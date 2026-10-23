"""Pure auction rules. No DB, no clock: everything takes `now` as an argument so it is testable."""

from abc import ABC, abstractmethod
from collections.abc import Callable, Sequence
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import ClassVar, Literal, Protocol, TypeVar, get_args

TriggerType = Literal['BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_CHANGE']
Status = Literal['UPCOMING', 'ACTIVE', 'CLOSED', 'FORCE_CLOSED']


class RankableBid(Protocol):
    id: int
    supplier_id: int
    total_cents: int
    created_at: datetime


B = TypeVar('B', bound=RankableBid)


def to_cents(amount: Decimal | str | int | float) -> int:
    return int((Decimal(str(amount)) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def rank(bids: Sequence[B]) -> list[B]:
    """Each supplier's latest bid, sorted L1 first. Ties go to whoever bid that price first."""
    latest: dict[int, B] = {}
    for b in bids:
        cur = latest.get(b.supplier_id)
        if cur is None or b.id > cur.id:
            latest[b.supplier_id] = b
    return sorted(latest.values(), key=lambda b: (b.total_cents, b.created_at, b.id))


def is_open(bid_start_at: datetime, current_close_at: datetime, now: datetime) -> bool:
    """Bid window: bidStart <= now < currentClose (a bid exactly at close is late)."""
    return bid_start_at <= now < current_close_at


def in_trigger_window(now: datetime, current_close_at: datetime, window_min: int) -> bool:
    """Trigger window: the last X minutes before the *current* close time."""
    return current_close_at - timedelta(minutes=window_min) <= now < current_close_at


class BaseExtensionStrategy(ABC):
    """
    One extension trigger. `detect` compares the ranking before and after an accepted bid and returns a
    human-readable cause if the auction should extend, or None. A new trigger type is a new subclass
    registered in STRATEGIES; the bid engine (routes.place_bid) never changes.
    """

    trigger_type: ClassVar[TriggerType]

    @abstractmethod
    def detect(self, before: Sequence[RankableBid], after: Sequence[RankableBid], name: Callable[[int], str]) -> str | None: ...


class BidReceivedStrategy(BaseExtensionStrategy):
    trigger_type = 'BID_RECEIVED'

    def detect(self, before, after, name):
        return 'New bid received in trigger window'


class AnyRankChangeStrategy(BaseExtensionStrategy):
    """Fires only if a previously ranked supplier moved. A new entrant at the bottom displaces nobody."""

    trigger_type = 'ANY_RANK_CHANGE'

    def detect(self, before, after, name):
        before_rank = {b.supplier_id: i + 1 for i, b in enumerate(before)}
        after_rank = {b.supplier_id: i + 1 for i, b in enumerate(after)}
        if not any(after_rank.get(b.supplier_id) != before_rank[b.supplier_id] for b in before):
            return None
        changes = []
        for b in after:
            old, new = before_rank.get(b.supplier_id), after_rank[b.supplier_id]
            if old != new:
                changes.append(f'{name(b.supplier_id)} {f"L{old}" if old else "new"}→L{new}')
        return f'Rank change: {", ".join(changes)}'


class L1RankChangeStrategy(BaseExtensionStrategy):
    """Fires only when a different supplier becomes the lowest bidder."""

    trigger_type = 'L1_CHANGE'

    def detect(self, before, after, name):
        prev = before[0].supplier_id if before else None
        nxt = after[0].supplier_id if after else None
        # First-ever bid is not a "change"; L1 undercutting themselves is not a change either.
        if prev is None or prev == nxt:
            return None
        return f'L1 changed: {name(prev)} → {name(nxt)}'


STRATEGIES: dict[str, BaseExtensionStrategy] = {
    s.trigger_type: s for s in (BidReceivedStrategy(), AnyRankChangeStrategy(), L1RankChangeStrategy())
}
# Every trigger type the API accepts must have exactly one strategy.
assert set(STRATEGIES) == set(get_args(TriggerType)), 'each TriggerType needs a strategy'


def detect_trigger(
    type: TriggerType,
    before: Sequence[RankableBid],
    after: Sequence[RankableBid],
    name: Callable[[int], str],
) -> str | None:
    """Cause of the extension if the auction's configured trigger fired, else None."""
    return STRATEGIES[type].detect(before, after, name)


def extend_close(current_close_at: datetime, forced_close_at: datetime, extension_min: int) -> datetime | None:
    """New close time after an extension, capped at forced close. None when already at the cap."""
    if current_close_at >= forced_close_at:
        return None
    return min(current_close_at + timedelta(minutes=extension_min), forced_close_at)


def status(bid_start_at: datetime, current_close_at: datetime, forced_close_at: datetime, now: datetime) -> Status:
    if now < bid_start_at:
        return 'UPCOMING'
    if now < current_close_at:
        return 'ACTIVE'
    return 'FORCE_CLOSED' if current_close_at >= forced_close_at else 'CLOSED'
