'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { api, useUser, type Rfq } from '@/lib/api';
import { fmtMoney, fmtTime } from '@/lib/format';
import { notify } from '@/lib/notify';
import { useLiveUpdates } from '@/lib/socket';

/**
 * App-wide notifications for auctions you are not looking at: new RFQs, new bids,
 * extensions and "you've been outbid". The open auction's page raises its own, richer toasts.
 */
export function LiveNotifications() {
  const user = useUser();
  const pathname = usePathname();
  const snapshot = useRef<Map<number, Rfq> | null>(null);
  const viewing = useRef<string>(pathname);
  useEffect(() => {
    viewing.current = pathname;
  }, [pathname]);

  const sync = useCallback(() => {
    if (!user) return;
    api<{ rfqs: Rfq[] }>('/rfqs')
      .then(({ rfqs }) => {
        const prev = snapshot.current;
        snapshot.current = new Map(rfqs.map((r) => [r.id, r]));
        if (!prev) return; // first load is the baseline, not news

        for (const r of rfqs) {
          if (viewing.current === `/auctions/${r.id}`) continue;
          const before = prev.get(r.id);
          const href = `/auctions/${r.id}`;
          const id = `rfq-${r.id}`;

          if (!before) {
            if (user.role === 'SUPPLIER')
              notify({ kind: 'rfq', id, href, title: 'New RFQ open for bids', description: `${r.refId}: ${r.name}` });
            continue;
          }

          const extended = Date.parse(r.currentCloseAt) > Date.parse(before.currentCloseAt);
          const newBids = r.bidCount > before.bidCount;
          const until = `Now closes at ${fmtTime(r.currentCloseAt)}.`;

          if (user.role === 'SUPPLIER') {
            const outbid = before.myRank != null && r.myRank != null && r.myRank > before.myRank;
            if (outbid)
              notify({
                kind: 'outbid',
                id,
                href,
                title: `You've been outbid on ${r.refId}`,
                description: `You're now L${r.myRank}. Current L1 is ${fmtMoney(r.lowestBid)}.${extended ? ` ${until}` : ''}`,
              });
            else if (extended && r.myRank != null)
              notify({ kind: 'extended', id, href, title: `${r.refId} was extended`, description: until });
          } else if (newBids) {
            notify({
              kind: extended ? 'extended' : 'bid',
              id,
              href,
              title: `New bid on ${r.refId}`,
              description: `L1 is now ${fmtMoney(r.lowestBid)}.${extended ? ` ${until}` : ''}`,
            });
          }
        }
      })
      .catch(() => {}); // a missed notification is not worth an error toast
  }, [user]);

  useEffect(() => {
    snapshot.current = null;
    sync();
  }, [sync]);
  useLiveUpdates(user ? 'list' : null, sync);

  return null;
}
