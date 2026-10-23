// Pure auction rules. No DB, no clock: everything takes `now` as an argument so it is testable.

export type TriggerType = 'BID_RECEIVED' | 'ANY_RANK_CHANGE' | 'L1_CHANGE';
export type Status = 'UPCOMING' | 'ACTIVE' | 'CLOSED' | 'FORCE_CLOSED';

export interface RankableBid {
  id: number;
  supplierId: number;
  totalCents: number;
  createdAt: Date;
}

const MIN = 60_000;

export const toCents = (amount: { toString(): string } | number) => Math.round(Number(amount.toString()) * 100);

/** Each supplier's latest bid, sorted L1 first. Ties go to whoever bid that price first. */
export function rank<T extends RankableBid>(bids: T[]): T[] {
  const latest = new Map<number, T>();
  for (const b of bids) {
    const cur = latest.get(b.supplierId);
    if (!cur || b.id > cur.id) latest.set(b.supplierId, b);
  }
  return [...latest.values()].sort(
    (a, b) => a.totalCents - b.totalCents || a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
  );
}

/** Bid window: bidStart <= now < currentClose (a bid exactly at close is late). */
export function isOpen(rfq: { bidStartAt: Date; currentCloseAt: Date }, now: Date): boolean {
  return now >= rfq.bidStartAt && now < rfq.currentCloseAt;
}

/** Trigger window: the last X minutes before the *current* close time. */
export function inTriggerWindow(now: Date, currentCloseAt: Date, windowMin: number): boolean {
  return now.getTime() >= currentCloseAt.getTime() - windowMin * MIN && now < currentCloseAt;
}

/**
 * Compares rankings before and after a bid. Returns a human-readable cause if the
 * configured trigger fired, or null if it did not.
 */
export function detectTrigger(
  type: TriggerType,
  before: RankableBid[],
  after: RankableBid[],
  name: (supplierId: number) => string,
): string | null {
  if (type === 'BID_RECEIVED') return 'New bid received in trigger window';

  if (type === 'L1_CHANGE') {
    const prev = before[0]?.supplierId;
    const next = after[0]?.supplierId;
    // First-ever bid is not a "change"; L1 undercutting themselves is not a change either.
    if (prev === undefined || prev === next) return null;
    return `L1 changed: ${name(prev)} → ${name(next!)}`;
  }

  // ANY_RANK_CHANGE: fires only if a previously ranked supplier moved.
  // A new entrant at the bottom displaces nobody, so it does not count.
  const beforeRank = new Map(before.map((b, i) => [b.supplierId, i + 1]));
  const afterRank = new Map(after.map((b, i) => [b.supplierId, i + 1]));
  const moved = before.some((b) => afterRank.get(b.supplierId) !== beforeRank.get(b.supplierId));
  if (!moved) return null;
  const changes = after
    .filter((b) => beforeRank.get(b.supplierId) !== afterRank.get(b.supplierId))
    .map((b) => {
      const from = beforeRank.get(b.supplierId);
      return `${name(b.supplierId)} ${from ? `L${from}` : 'new'}→L${afterRank.get(b.supplierId)}`;
    });
  return `Rank change: ${changes.join(', ')}`;
}

/** New close time after an extension, capped at forced close. Null when already at the cap. */
export function extendClose(currentCloseAt: Date, forcedCloseAt: Date, extensionMin: number): Date | null {
  if (currentCloseAt >= forcedCloseAt) return null;
  return new Date(Math.min(currentCloseAt.getTime() + extensionMin * MIN, forcedCloseAt.getTime()));
}

export function status(
  rfq: { bidStartAt: Date; currentCloseAt: Date; forcedCloseAt: Date },
  now: Date,
): Status {
  if (now < rfq.bidStartAt) return 'UPCOMING';
  if (now < rfq.currentCloseAt) return 'ACTIVE';
  return rfq.currentCloseAt.getTime() >= rfq.forcedCloseAt.getTime() ? 'FORCE_CLOSED' : 'CLOSED';
}
