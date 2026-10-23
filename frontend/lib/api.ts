'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { syncClock } from './clock';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type Role = 'BUYER' | 'SUPPLIER';
export type Status = 'UPCOMING' | 'ACTIVE' | 'CLOSED' | 'FORCE_CLOSED';
export type TriggerType = 'BID_RECEIVED' | 'ANY_RANK_CHANGE' | 'L1_CHANGE';

export interface User {
  id: number;
  name: string;
  company: string;
  role: Role;
}

export interface Rfq {
  id: number;
  refId: string;
  name: string;
  bidStartAt: string;
  bidCloseAt: string;
  currentCloseAt: string;
  forcedCloseAt: string;
  pickupDate: string;
  triggerWindowMin: number;
  extensionMin: number;
  triggerType: TriggerType;
  status: Status;
  lowestBid: string | null;
  bidCount: number;
  buyerId: number;
  /** Supplier view only: own rank, null if not bid yet. */
  myRank?: number | null;
}

export interface Bid {
  id: number;
  supplierId: number;
  carrierName: string;
  freightCharges: string;
  originCharges: string;
  destinationCharges: string;
  totalAmount: string;
  transitTimeDays: number;
  quoteValidUntil: string;
  createdAt: string;
  supplier?: { id: number; name: string; company: string };
}

export interface AuctionEvent {
  id: number;
  type: 'BID_PLACED' | 'TIME_EXTENDED' | 'EXTENSION_CAPPED';
  reason: string;
  oldCloseAt: string | null;
  newCloseAt: string | null;
  createdAt: string;
  mine?: boolean;
}

export interface RfqDetails extends Rfq {
  buyer: { name: string; company: string };
  supplierCount: number;
  events: AuctionEvent[];
  // buyer view
  ranking?: (Bid & { rank: number })[];
  /** Every bid, lowest first; `current` is the supplier's latest quote. */
  allBids?: (Bid & { current: boolean })[];
  // supplier view
  myBids?: Bid[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

// Per tab, so a buyer and a supplier can be open side by side in one browser.
const USER_KEY = 'ba.user';

// Cached by raw string so useSyncExternalStore gets a stable snapshot between changes.
let cachedRaw: string | null | undefined;
let cachedUser: User | null = null;

export function getUser(): User | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(USER_KEY);
  } catch {}
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedUser = raw ? JSON.parse(raw) : null;
    } catch {
      cachedUser = null;
    }
  }
  return cachedUser;
}

function subscribeUser(onChange: () => void) {
  window.addEventListener('ba:user', onChange);
  return () => window.removeEventListener('ba:user', onChange);
}

export function setUser(user: User | null) {
  if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  else sessionStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event('ba:user'));
}

/**
 * undefined during prerender/hydration, null when logged out.
 * Reads sessionStorage through an external store, never component state: Next 16 keeps hidden
 * routes alive with their state (Activity), and a stale copy made pages bounce to login.
 */
export function useUser(): User | null | undefined {
  return useSyncExternalStore(subscribeUser, getUser, () => undefined);
}

/** Same as useUser, but sends logged-out visitors to the login page. */
export function useRequireUser(): User | null | undefined {
  const user = useUser();
  const router = useRouter();
  useEffect(() => {
    if (user === null) router.replace('/');
  }, [user, router]);
  return user;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = getUser();
  const sent = Date.now();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(user ? { 'x-user-id': String(user.id) } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (body?.serverNow) syncClock(body.serverNow, sent, Date.now());
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'Request failed', body?.issues ?? []);
  return body as T;
}
