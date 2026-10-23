import type { Status, TriggerType } from './api';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export const fmtMoney = (v: string | number | null | undefined) => (v == null ? '-' : money.format(Number(v)));

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const date = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso));
export const fmtTime = (iso: string) => time.format(new Date(iso));
/** Calendar dates (pickup, validity) are stored as UTC midnight; show them without a timezone shift. */
export const fmtDate = (iso: string) => date.format(new Date(iso));

export function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export const STATUS_LABEL: Record<Status, string> = {
  UPCOMING: 'Upcoming',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  FORCE_CLOSED: 'Force closed',
};

export const TRIGGER_LABEL: Record<TriggerType, string> = {
  BID_RECEIVED: 'Any bid received',
  ANY_RANK_CHANGE: 'Any supplier rank change',
  L1_CHANGE: 'Lowest bidder (L1) changes',
};

export const TRIGGER_SENTENCE: Record<TriggerType, string> = {
  BID_RECEIVED: 'any bid is received',
  ANY_RANK_CHANGE: "any supplier's rank changes",
  L1_CHANGE: 'the lowest bidder (L1) changes',
};

export const TRIGGER_HELP: Record<TriggerType, string> = {
  BID_RECEIVED: 'Every new bid inside the window extends the auction.',
  ANY_RANK_CHANGE: 'Extends when a bid moves any existing supplier up or down the ranking.',
  L1_CHANGE: 'Extends only when a different supplier becomes the lowest bidder.',
};

/** Status from times, matching the server's rule. Used so badges flip at 0 without a refetch. */
export function liveStatus(r: { bidStartAt: string; currentCloseAt: string; forcedCloseAt: string }, now: number): Status {
  if (now < Date.parse(r.bidStartAt)) return 'UPCOMING';
  if (now < Date.parse(r.currentCloseAt)) return 'ACTIVE';
  return Date.parse(r.currentCloseAt) >= Date.parse(r.forcedCloseAt) ? 'FORCE_CLOSED' : 'CLOSED';
}
