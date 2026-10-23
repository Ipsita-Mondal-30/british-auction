'use client';

import { useSyncExternalStore } from 'react';

// Offset between the server clock and this browser's clock. The countdown is display-only;
// the server re-checks time on every bid, so a wrong local clock can't sneak a bid in.
let offset = 0;

export function syncClock(serverNow: string, sentAt: number, receivedAt: number) {
  // Assume the server stamped the response halfway through the round trip.
  offset = new Date(serverNow).getTime() - (sentAt + receivedAt) / 2;
}

export const serverNow = () => Date.now() + offset;

// One shared 1s ticker for every component that shows time.
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      current = serverNow();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Server-adjusted "now", re-rendering every second. 0 during prerender. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => current || (current = serverNow()),
    () => 0,
  );
}
