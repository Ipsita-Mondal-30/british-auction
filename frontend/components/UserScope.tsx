'use client';

import { Fragment, type ReactNode } from 'react';
import { useUser } from '@/lib/api';

/**
 * Remounts page content when the signed-in user changes. Next keeps visited routes alive with
 * their state, so without this a supplier could briefly see a page still holding buyer data.
 */
export function UserScope({ children }: { children: ReactNode }) {
  const user = useUser();
  return <Fragment key={user?.id ?? 'anon'}>{children}</Fragment>;
}
