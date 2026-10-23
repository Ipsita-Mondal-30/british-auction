'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Buildings, Truck } from '@phosphor-icons/react';
import { api, ApiError, setUser, type User } from '@/lib/api';
import { ErrorNote, Panel, Skeleton } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<User[]>('/users')
      .then(setUsers)
      .catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const pick = (u: User) => {
    setUser(u);
    router.push('/auctions');
  };

  const group = (role: User['role']) => users?.filter((u) => u.role === role) ?? [];

  return (
    <div className="grid gap-10 pt-6 lg:grid-cols-[1fr_440px] lg:gap-16 lg:pt-16">
      <div className="max-w-xl">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Freight RFQs with British auction bidding</h1>
        <p className="mt-4 text-base leading-relaxed text-fg-2">
          Suppliers keep lowering their quotes. Late activity extends the close time, and a forced close time caps it.
        </p>
        <dl className="mt-10 grid gap-6 sm:grid-cols-2">
          <div>
            <dt className="flex items-center gap-2 text-sm font-medium">
              <Buildings size={18} className="text-accent" /> Buyers
            </dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-fg-2">
              Create RFQs, set the extension rules and see every quote ranked L1, L2, L3.
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-sm font-medium">
              <Truck size={18} className="text-accent" /> Suppliers
            </dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-fg-2">
              Submit quotes and see their own rank and the current lowest price. Competitor quotes stay hidden.
            </dd>
          </div>
        </dl>
      </div>

      <Panel title="Sign in as">
        <div className="p-2">
          {error && (
            <div className="p-3">
              <ErrorNote
                message={error}
                onRetry={() => {
                  setError(null);
                  load();
                }}
              />
            </div>
          )}
          {!users && !error && (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          )}
          {users &&
            (['BUYER', 'SUPPLIER'] as const).map((role) => (
              <div key={role} className="py-1">
                <p className="px-3 pb-1 pt-2 text-xs font-medium text-fg-3">{role === 'BUYER' ? 'Buyer' : 'Suppliers'}</p>
                <ul>
                  {group(role).map((u) => (
                    <li key={u.id}>
                      <button
                        onClick={() => pick(u)}
                        className="press group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm font-semibold text-accent">
                          {u.name
                            .split(' ')
                            .map((p) => p[0])
                            .join('')}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{u.name}</span>
                          <span className="block truncate text-xs text-fg-3">{u.company}</span>
                        </span>
                        <ArrowRight size={16} className="text-fg-3 transition-transform duration-150 group-hover:translate-x-0.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}
