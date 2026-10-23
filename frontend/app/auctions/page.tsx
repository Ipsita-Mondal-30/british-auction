'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { api, ApiError, useRequireUser, type Rfq, type Status } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { fmtDateTime, fmtDuration, fmtMoney, liveStatus } from '@/lib/format';
import { useLiveUpdates } from '@/lib/socket';
import { Button, cx, ErrorNote, Panel, RankPill, Skeleton, StatusBadge } from '@/components/ui';

const FILTERS: { key: 'ALL' | Status | 'ENDED'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'UPCOMING', label: 'Upcoming' },
  { key: 'ENDED', label: 'Closed' },
];

export default function AuctionsPage() {
  const user = useRequireUser();
  const router = useRouter();
  const now = useNow();
  const [rfqs, setRfqs] = useState<Rfq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('ALL');
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    api<{ rfqs: Rfq[] }>('/rfqs')
      .then((d) => {
        setRfqs(d.rfqs);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);
  useLiveUpdates(user ? 'list' : null, load);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rfqs ?? [])
      .map((r) => ({ ...r, status: liveStatus(r, now) }))
      .filter((r) =>
        filter === 'ALL' ? true : filter === 'ENDED' ? r.status === 'CLOSED' || r.status === 'FORCE_CLOSED' : r.status === filter,
      )
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.refId.toLowerCase().includes(q))
      .sort((a, b) => {
        const order = { ACTIVE: 0, UPCOMING: 1, CLOSED: 2, FORCE_CLOSED: 2 };
        const close = (r: Rfq) => Date.parse(r.currentCloseAt);
        return order[a.status] - order[b.status] || (order[a.status] === 2 ? close(b) - close(a) : close(a) - close(b));
      });
  }, [rfqs, now, filter, query]);

  const count = (key: (typeof FILTERS)[number]['key']) =>
    (rfqs ?? []).filter((r) => {
      const s = liveStatus(r, now);
      return key === 'ALL' || (key === 'ENDED' ? s === 'CLOSED' || s === 'FORCE_CLOSED' : s === key);
    }).length;

  if (!user) return <ListSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Auctions</h1>
          <p className="mt-1 text-sm text-fg-2">
            {user.role === 'BUYER' ? 'Every British auction RFQ, updated live.' : 'Open RFQs you can bid on, updated live.'}
          </p>
        </div>
        {user.role === 'BUYER' && (
          <Button onClick={() => router.push('/auctions/new')}>
            <Plus size={16} weight="bold" /> New RFQ
          </Button>
        )}
      </div>

      {error && <ErrorNote message={error} onRetry={load} />}

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div role="tablist" aria-label="Filter by status" className="flex gap-1 rounded-lg bg-surface-2 p-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cx(
                  'press h-7 rounded-md px-3 text-sm font-medium',
                  filter === f.key ? 'bg-surface text-fg shadow-panel' : 'text-fg-2 hover:text-fg',
                )}
              >
                {f.label}
                {rfqs && <span className="ml-1.5 font-mono text-xs text-fg-3 tabular-nums">{count(f.key)}</span>}
              </button>
            ))}
          </div>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search RFQs</span>
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or ID"
              className="h-8 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-fg-3">
                <th className="px-4 py-2.5 font-medium">RFQ</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                {user.role === 'SUPPLIER' && <th className="px-4 py-2.5 font-medium">Your rank</th>}
                <th className="px-4 py-2.5 text-right font-medium">Lowest bid</th>
                <th className="px-4 py-2.5 text-right font-medium">Time left</th>
                <th className="px-4 py-2.5 font-medium">Current close</th>
                <th className="px-4 py-2.5 font-medium">Forced close</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {!rfqs &&
                [0, 1, 2, 3].map((i) => (
                  <tr key={i}>
                    <td className="px-4 py-3.5" colSpan={7}>
                      <Skeleton className="h-5" />
                    </td>
                  </tr>
                ))}
              {rows.map((r) => {
                const extendedMin = (Date.parse(r.currentCloseAt) - Date.parse(r.bidCloseAt)) / 60_000;
                return (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/auctions/${r.id}`)}
                    className="cursor-pointer transition-colors duration-100 hover:bg-surface-2"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/auctions/${r.id}`} className="font-medium underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {r.name}
                      </Link>
                      <div className="font-mono text-xs text-fg-3">{r.refId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    {user.role === 'SUPPLIER' && (
                      <td className="px-4 py-3">{r.myRank ? <RankPill rank={r.myRank} /> : <span className="text-fg-3">Not bid</span>}</td>
                    )}
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {r.lowestBid ? fmtMoney(r.lowestBid) : <span className="font-sans text-fg-3">No bids</span>}
                      {r.bidCount > 0 && <div className="text-xs text-fg-3">{r.bidCount} bids</div>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {r.status === 'ACTIVE' ? (
                        fmtDuration(Date.parse(r.currentCloseAt) - now)
                      ) : r.status === 'UPCOMING' ? (
                        <span className="font-sans text-fg-2">starts in {fmtDuration(Date.parse(r.bidStartAt) - now)}</span>
                      ) : (
                        <span className="font-sans text-fg-3">Ended</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {fmtDateTime(r.currentCloseAt)}
                      {extendedMin > 0 && <div className="text-xs text-warn">+{Math.round(extendedMin)} min extended</div>}
                    </td>
                    <td className="px-4 py-3 text-fg-2">{fmtDateTime(r.forcedCloseAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {rfqs && rows.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="font-medium">{rfqs.length === 0 ? 'No RFQs yet' : 'Nothing matches this filter'}</p>
            <p className="mt-1 text-sm text-fg-2">
              {rfqs.length === 0
                ? user.role === 'BUYER'
                  ? 'Create the first RFQ to start an auction.'
                  : 'RFQs appear here as soon as a buyer creates one.'
                : 'Try another status or clear the search.'}
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
