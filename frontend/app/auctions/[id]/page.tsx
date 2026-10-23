'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ClockClockwise, DownloadSimple, Gavel, LockSimple } from '@phosphor-icons/react';
import { api, ApiError, useRequireUser, type AuctionEvent, type RfqDetails, type User } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { fmtDate, fmtDateTime, fmtDuration, fmtMoney, fmtTime, liveStatus, TRIGGER_LABEL } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import { notify } from '@/lib/notify';
import { useLiveUpdates } from '@/lib/socket';
import { BidForm } from '@/components/BidForm';
import { Button, cx, ErrorNote, MotionTile, Panel, RankPill, Skeleton, StatusBadge, type IconMotion } from '@/components/ui';

export default function AuctionPage() {
  // useParams is runtime data; Suspense lets the shell prerender.
  return (
    <Suspense fallback={<DetailsSkeleton />}>
      <Auction />
    </Suspense>
  );
}

function Auction() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const now = useNow();
  const [rfq, setRfq] = useState<RfqDetails | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const lastEventId = useRef<number | null>(null);
  const lastRank = useRef<number | null | undefined>(undefined);

  const apply = useCallback((next: RfqDetails) => {
    // Anything in the activity log we haven't seen yet becomes a toast (not on first load).
    const seen = lastEventId.current;
    if (seen !== null) announce(next, next.events.filter((e) => e.id > seen), lastRank.current);
    lastEventId.current = next.events.at(-1)?.id ?? 0;
    lastRank.current = next.myRank;
    setRfq(next);
    setError(null);
  }, []);

  const load = useCallback(() => {
    api<{ rfq: RfqDetails }>(`/rfqs/${id}`)
      .then((d) => apply(d.rfq))
      .catch((e: ApiError) => setError({ status: e.status, message: e.message }));
  }, [id, apply]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);
  useLiveUpdates(user ? `rfq:${id}` : null, (rfqId) => {
    if (rfqId === undefined || rfqId === Number(id)) load();
  });

  const status = rfq ? liveStatus(rfq, now) : null;
  // When the countdown crosses a boundary (start or close): announce it and refetch the final state.
  const lastStatus = useRef(status);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (!prev || !status || prev === status || !rfq) return;
    load();
    if (status === 'ACTIVE') notify({ kind: 'success', id: `status-${rfq.id}`, title: 'Bidding is open', description: rfq.name });
    else if (prev === 'ACTIVE')
      notify({
        kind: status === 'FORCE_CLOSED' ? 'capped' : 'info',
        id: `status-${rfq.id}`,
        title: status === 'FORCE_CLOSED' ? 'Auction force closed' : 'Auction closed',
        description: rfq.lowestBid ? `Final L1 price ${fmtMoney(rfq.lowestBid)}.` : 'No bids were placed.',
      });
  }, [status, rfq, load]);

  if (error && !rfq)
    return error.status === 404 ? (
      <div className="py-20 text-center">
        <p className="text-lg font-medium">RFQ not found</p>
        <Link href="/auctions" className="mt-2 inline-block text-sm font-medium underline-offset-4 hover:underline">
          Back to auctions
        </Link>
      </div>
    ) : (
      <ErrorNote message={error.message} onRetry={load} />
    );
  if (!user || !rfq || !status) return <DetailsSkeleton />;

  const closeMs = Date.parse(rfq.currentCloseAt);
  const extendedMin = Math.round((closeMs - Date.parse(rfq.bidCloseAt)) / 60_000);
  const inWindow = status === 'ACTIVE' && closeMs - now <= rfq.triggerWindowMin * 60_000;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/auctions" className="inline-flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg">
          <ArrowLeft size={14} /> Auctions
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{rfq.name}</h1>
          <StatusBadge status={status} />
        </div>
        <p className="mt-1 font-mono text-sm text-fg-3">{rfq.refId}</p>
      </div>

      {error && <ErrorNote message={error.message} onRetry={load} />}

      <Panel>
        <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          <Stat label={status === 'UPCOMING' ? 'Starts in' : 'Time left'}>
            <span className={cx('font-mono text-3xl font-semibold tabular-nums', inWindow && 'text-warn')}>
              {status === 'UPCOMING'
                ? fmtDuration(Date.parse(rfq.bidStartAt) - now)
                : status === 'ACTIVE'
                  ? fmtDuration(closeMs - now)
                  : 'Ended'}
            </span>
            {inWindow && <p className="mt-1 text-xs text-warn">In the {rfq.triggerWindowMin} min extension window</p>}
          </Stat>
          <Stat label="Current close">
            <span key={rfq.currentCloseAt} className={cx('rounded text-lg font-semibold', extendedMin > 0 && 'flash')}>
              {fmtDateTime(rfq.currentCloseAt)}
            </span>
            <p className="mt-1 text-xs text-fg-3">
              {extendedMin > 0 ? `Originally ${fmtTime(rfq.bidCloseAt)}, +${extendedMin} min` : 'Not extended'}
            </p>
          </Stat>
          <Stat label="Forced close">
            <span className="text-lg font-semibold">{fmtDateTime(rfq.forcedCloseAt)}</span>
            <p className="mt-1 text-xs text-fg-3">Hard stop</p>
          </Stat>
          <Stat label="Lowest bid (L1)">
            <span className="font-mono text-lg font-semibold tabular-nums">{rfq.lowestBid ? fmtMoney(rfq.lowestBid) : 'No bids yet'}</span>
            <p className="mt-1 text-xs text-fg-3">
              {rfq.bidCount} bids from {rfq.supplierCount} suppliers
            </p>
          </Stat>
        </div>
        <Timeline rfq={rfq} now={now} />
      </Panel>

      {user.role === 'BUYER' ? (
        // Buyer: the ranking table is the main content, so it gets the full width.
        <>
          <Ranking rfq={rfq} />
          <BidHistory bids={rfq.allBids ?? []} />
          <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
            <Config rfq={rfq} />
            <ActivityLog events={rfq.events} live={status === 'ACTIVE'} />
          </div>
        </>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-6">
            <SupplierView rfq={rfq} user={user} open={status === 'ACTIVE'} onPlaced={apply} />
          </div>
          <div className="space-y-6">
            <Config rfq={rfq} />
            <ActivityLog events={rfq.events} live={status === 'ACTIVE'} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Toasts for new activity on the auction being viewed. Ids are per auction, so bursts update in place. */
function announce(rfq: RfqDetails, fresh: AuctionEvent[], prevRank: number | null | undefined) {
  if (!fresh.length) return;
  const isBuyer = rfq.ranking !== undefined;
  const others = fresh.filter((e) => e.type === 'BID_PLACED' && !e.mine);
  const extension = fresh.findLast((e) => e.type === 'TIME_EXTENDED');
  const capped = fresh.findLast((e) => e.type === 'EXTENSION_CAPPED');

  if (others.length) {
    if (isBuyer) {
      notify({
        kind: 'bid',
        id: `bid-${rfq.id}`,
        title: others.length === 1 ? 'New bid received' : `${others.length} new bids received`,
        description: others.at(-1)!.reason,
      });
    } else if (prevRank != null && rfq.myRank != null && rfq.myRank > prevRank) {
      notify({
        kind: 'outbid',
        id: `bid-${rfq.id}`,
        title: "You've been outbid",
        description: `You're now L${rfq.myRank}. Current L1 is ${fmtMoney(rfq.lowestBid)}.`,
      });
    } else {
      notify({
        kind: 'bid',
        id: `bid-${rfq.id}`,
        title: 'A competitor placed a bid',
        description: rfq.myRank ? `You're still L${rfq.myRank}.` : `L1 is now ${fmtMoney(rfq.lowestBid)}.`,
      });
    }
  }
  if (extension?.newCloseAt)
    notify({
      kind: 'extended',
      id: `ext-${rfq.id}`,
      title: `Auction extended to ${fmtTime(extension.newCloseAt)}`,
      description: extension.mine ? 'Your bid triggered the extension.' : extension.reason,
    });
  if (capped)
    notify({
      kind: 'capped',
      id: `ext-${rfq.id}`,
      title: 'Forced close reached',
      description: `No more extensions. Bidding ends at ${fmtTime(rfq.forcedCloseAt)}.`,
    });
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <div className="mb-1.5 text-xs font-medium text-fg-3">{label}</div>
      {children}
    </div>
  );
}

/** Start → original close → current close → forced close, with a marker for now. */
function Timeline({ rfq, now }: { rfq: RfqDetails; now: number }) {
  const start = Date.parse(rfq.bidStartAt);
  const end = Date.parse(rfq.forcedCloseAt);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - start) / (end - start)) * 100))}%`;
  const orig = Date.parse(rfq.bidCloseAt);
  const cur = Date.parse(rfq.currentCloseAt);
  return (
    <div className="border-t border-line px-5 pb-4 pt-5">
      <div className="relative h-2 rounded-full bg-surface-2" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-accent/25" style={{ width: pct(orig) }} />
        {cur > orig && <div className="absolute inset-y-0 bg-warn/40" style={{ left: pct(orig), width: `calc(${pct(cur)} - ${pct(orig)})` }} />}
        {now >= start && now <= end && (
          <div className="absolute -top-1 h-4 w-0.5 rounded-full bg-fg" style={{ left: pct(now) }} />
        )}
      </div>
      <div className="mt-2 flex justify-between text-xs text-fg-3">
        <span>Opened {fmtDateTime(rfq.bidStartAt)}</span>
        <span className="hidden sm:inline">
          <span className="mr-1 inline-block size-2 rounded-sm bg-accent/25 align-middle" /> Scheduled
          <span className="ml-3 mr-1 inline-block size-2 rounded-sm bg-warn/40 align-middle" /> Extended
          <span className="ml-3 mr-1 inline-block size-2 rounded-sm bg-surface-2 align-middle ring-1 ring-line" /> Headroom
        </span>
        <span>Forced {fmtDateTime(rfq.forcedCloseAt)}</span>
      </div>
    </div>
  );
}

/** Buyer-only export of the ranked supplier list, built from data already on screen. */
function exportRanking(rfq: RfqDetails) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const csv = toCsv(
    ['Rank', 'Supplier', 'Contact', 'Carrier', 'Freight (INR)', 'Origin (INR)', 'Destination (INR)', 'Total (INR)', 'Transit (days)', 'Quote valid until', 'Bid time'],
    (rfq.ranking ?? []).map((b) => [
      `L${b.rank}`,
      b.supplier?.company,
      b.supplier?.name,
      b.carrierName,
      b.freightCharges,
      b.originCharges,
      b.destinationCharges,
      b.totalAmount,
      b.transitTimeDays,
      b.quoteValidUntil.slice(0, 10),
      local(b.createdAt),
    ]),
  );
  downloadCsv(`${rfq.refId}-suppliers-${local(new Date().toISOString()).slice(0, 10)}.csv`, csv);
  notify({ kind: 'success', title: 'Supplier list exported', description: `${rfq.ranking?.length ?? 0} suppliers, ${rfq.refId}` });
}

function Ranking({ rfq }: { rfq: RfqDetails }) {
  const rows = rfq.ranking ?? [];
  return (
    <Panel
      title="Supplier ranking"
      action={
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-fg-3 sm:inline">Latest quote per supplier, lowest first</span>
          <Button variant="secondary" className="h-8 px-3" disabled={!rows.length} onClick={() => exportRanking(rfq)}>
            <DownloadSimple size={14} weight="bold" /> Export CSV
          </Button>
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty title="No bids yet" body="Quotes appear here the moment a supplier bids." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="text-left text-xs text-fg-3">
                <th className="px-4 py-2.5 font-medium">Rank</th>
                <th className="px-2.5 py-2.5 font-medium">Supplier</th>
                <th className="px-2.5 py-2.5 text-right font-medium">Freight</th>
                <th className="px-2.5 py-2.5 text-right font-medium">Origin</th>
                <th className="px-2.5 py-2.5 text-right font-medium">Destination</th>
                <th className="px-2.5 py-2.5 text-right font-medium">Total</th>
                <th className="px-2.5 py-2.5 text-right font-medium">Transit</th>
                <th className="px-4 py-2.5 font-medium">Valid until</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {rows.map((b) => (
                <tr key={b.id} className={b.rank === 1 ? 'bg-ok-soft/40' : undefined}>
                  <td className="px-4 py-3">
                    <RankPill rank={b.rank} />
                  </td>
                  <td className="px-2.5 py-3">
                    <div className="font-medium">{b.supplier?.company}</div>
                    <div className="whitespace-nowrap text-xs text-fg-3">
                      {b.carrierName}, {fmtTime(b.createdAt)}
                    </div>
                  </td>
                  <td className="px-2.5 py-3 text-right font-mono tabular-nums text-fg-2">{fmtMoney(b.freightCharges)}</td>
                  <td className="px-2.5 py-3 text-right font-mono tabular-nums text-fg-2">{fmtMoney(b.originCharges)}</td>
                  <td className="px-2.5 py-3 text-right font-mono tabular-nums text-fg-2">{fmtMoney(b.destinationCharges)}</td>
                  <td className="px-2.5 py-3 text-right font-mono font-semibold tabular-nums">{fmtMoney(b.totalAmount)}</td>
                  <td className="px-2.5 py-3 text-right tabular-nums">{b.transitTimeDays}d</td>
                  <td className="whitespace-nowrap px-4 py-3 text-fg-2">{fmtDate(b.quoteValidUntil)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Buyer-only: every bid ever placed, lowest first. Quotes a supplier has since lowered are dimmed. */
function BidHistory({ bids }: { bids: NonNullable<RfqDetails['allBids']> }) {
  const [all, setAll] = useState(false);
  if (bids.length === 0) return null;
  const shown = all ? bids : bids.slice(0, 10);
  return (
    <Panel title="All bids" action={<span className="text-xs text-fg-3">{bids.length} bids, lowest first</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs text-fg-3">
              <th className="px-4 py-2.5 font-medium">Supplier</th>
              <th className="px-2.5 py-2.5 text-right font-medium">Freight</th>
              <th className="px-2.5 py-2.5 text-right font-medium">Origin</th>
              <th className="px-2.5 py-2.5 text-right font-medium">Destination</th>
              <th className="px-2.5 py-2.5 text-right font-medium">Total</th>
              <th className="px-2.5 py-2.5 text-right font-medium">Transit</th>
              <th className="px-2.5 py-2.5 font-medium">Valid until</th>
              <th className="px-4 py-2.5 font-medium">Placed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line">
            {shown.map((b) => (
              <tr key={b.id} className={b.current ? undefined : 'text-fg-3'}>
                <td className="px-4 py-3">
                  <div className={cx('font-medium', !b.current && 'text-fg-2')}>{b.supplier?.company}</div>
                  <div className="whitespace-nowrap text-xs text-fg-3">
                    {b.carrierName}
                    {b.current ? '' : ', superseded'}
                  </div>
                </td>
                <td className="px-2.5 py-3 text-right font-mono tabular-nums">{fmtMoney(b.freightCharges)}</td>
                <td className="px-2.5 py-3 text-right font-mono tabular-nums">{fmtMoney(b.originCharges)}</td>
                <td className="px-2.5 py-3 text-right font-mono tabular-nums">{fmtMoney(b.destinationCharges)}</td>
                <td className={cx('px-2.5 py-3 text-right font-mono tabular-nums', b.current && 'font-semibold')}>{fmtMoney(b.totalAmount)}</td>
                <td className="px-2.5 py-3 text-right tabular-nums">{b.transitTimeDays}d</td>
                <td className="whitespace-nowrap px-2.5 py-3">{fmtDate(b.quoteValidUntil)}</td>
                <td className="whitespace-nowrap px-4 py-3">{fmtDateTime(b.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bids.length > 10 && (
        <div className="border-t border-line px-3 py-2">
          <Button variant="ghost" className="w-full" onClick={() => setAll(!all)}>
            {all ? 'Show lowest 10 only' : `Show all ${bids.length}`}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function SupplierView({ rfq, user, open, onPlaced }: { rfq: RfqDetails; user: User; open: boolean; onPlaced: (r: RfqDetails) => void }) {
  const mine = rfq.myBids ?? [];
  const last = mine.at(-1);
  const gap = last && rfq.lowestBid ? Number(last.totalAmount) - Number(rfq.lowestBid) : null;
  return (
    <>
      <Panel title="Your position">
        <div className="grid grid-cols-3 divide-x divide-line">
          <Stat label="Your rank">
            {rfq.myRank ? <span className="font-mono text-2xl font-semibold">L{rfq.myRank}</span> : <span className="text-fg-2">Not bid yet</span>}
          </Stat>
          <Stat label="Your latest bid">
            <span className="font-mono text-lg font-semibold tabular-nums">{last ? fmtMoney(last.totalAmount) : '-'}</span>
          </Stat>
          <Stat label="Gap to L1">
            <span className={cx('font-mono text-lg font-semibold tabular-nums', gap === 0 && 'text-ok')}>
              {gap === null ? '-' : gap === 0 ? <span className="font-sans">You are L1</span> : fmtMoney(gap)}
            </span>
          </Stat>
        </div>
      </Panel>

      <Panel title={last ? 'Lower your quote' : 'Submit a quote'}>
        <BidForm rfq={rfq} user={user} open={open} onPlaced={onPlaced} />
      </Panel>

      {mine.length > 0 && (
        <Panel title="Your bids">
          <ul className="divide-y divide-line">
            {[...mine].reverse().map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <span className="text-fg-2">
                  {fmtTime(b.createdAt)}, {b.carrierName}, {b.transitTimeDays}d transit
                </span>
                <span className="font-mono font-medium tabular-nums">{fmtMoney(b.totalAmount)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Config({ rfq }: { rfq: RfqDetails }) {
  const rows: [string, React.ReactNode][] = [
    ['Trigger', TRIGGER_LABEL[rfq.triggerType]],
    ['Trigger window (X)', `${rfq.triggerWindowMin} min before close`],
    ['Extension (Y)', `+${rfq.extensionMin} min per trigger`],
    ['Bid start', fmtDateTime(rfq.bidStartAt)],
    ['Original close', fmtDateTime(rfq.bidCloseAt)],
    ['Pickup / service', fmtDate(rfq.pickupDate)],
    ['Buyer', rfq.buyer.company],
  ];
  return (
    <Panel title="Auction rules">
      <dl className="space-y-2.5 px-5 py-4 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-fg-2">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

const EVENT_ICON = {
  BID_PLACED: { icon: Gavel, motion: 'gavel', className: 'bg-accent-soft text-accent' },
  TIME_EXTENDED: { icon: ClockClockwise, motion: 'clock', className: 'bg-warn-soft text-warn' },
  EXTENSION_CAPPED: { icon: LockSimple, motion: 'lock', className: 'bg-danger-soft text-danger' },
} as const satisfies Record<AuctionEvent['type'], { motion: IconMotion; [k: string]: unknown }>;

/**
 * Icon motion is a state cue, not decoration: the newest entry keeps moving while the auction
 * is live, entries that arrive while you watch play once, and the rest stay still (hover replays).
 */
function ActivityLog({ events, live }: { events: AuctionEvent[]; live: boolean }) {
  const [all, setAll] = useState(false);
  const [seenAtMount] = useState(() => events.at(-1)?.id ?? 0);
  const list = [...events].reverse();
  const shown = all ? list : list.slice(0, 8);
  return (
    <Panel title="Activity" action={<span className="text-xs text-fg-3">{events.length} events</span>}>
      {events.length === 0 ? (
        <Empty title="No activity yet" body="Bids and extensions are logged here." />
      ) : (
        <>
          <ol className="space-y-4 px-5 py-4">
            {shown.map((e, i) => {
              const { icon, motion, className } = EVENT_ICON[e.type];
              const mode = i === 0 && live ? 'loop' : e.id > seenAtMount ? 'once' : 'idle';
              return (
                <li key={e.id} className="group flex gap-3">
                  <MotionTile icon={icon} motion={motion} mode={mode} className={cx('size-7', className)} />
                  <div className="min-w-0 text-sm">
                    <p className={cx('leading-snug', e.mine && 'font-medium')}>{e.reason}</p>
                    <p className="mt-0.5 text-xs text-fg-3">
                      {fmtTime(e.createdAt)}
                      {e.type === 'TIME_EXTENDED' && e.oldCloseAt && e.newCloseAt && (
                        <>
                          , close {fmtTime(e.oldCloseAt)} to {fmtTime(e.newCloseAt)}
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {list.length > 8 && (
            <div className="border-t border-line px-3 py-2">
              <Button variant="ghost" className="w-full" onClick={() => setAll(!all)}>
                {all ? 'Show recent only' : `Show all ${list.length}`}
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-fg-2">{body}</p>
    </div>
  );
}

function DetailsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-80" />
      <Skeleton className="h-36 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}
