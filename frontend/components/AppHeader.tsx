'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Gavel, SignOut } from '@phosphor-icons/react';
import { setUser, useUser } from '@/lib/api';
import { Button, MotionTile } from './ui';

export function AppHeader() {
  const user = useUser();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={user ? '/auctions' : '/'} className="group flex items-center gap-2 text-sm font-semibold">
          <MotionTile icon={Gavel} motion="gavel" size={15} className="size-7 bg-fg text-white" />
          RFQ Auctions
        </Link>
        {user && (
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-fg-3">
                {user.role === 'BUYER' ? 'Buyer' : 'Supplier'}, {user.company}
              </div>
            </div>
            <Button
              variant="ghost"
              aria-label="Switch user"
              onClick={() => {
                setUser(null);
                router.push('/');
              }}
            >
              <SignOut size={16} />
              <span className="hidden sm:inline">Switch user</span>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
