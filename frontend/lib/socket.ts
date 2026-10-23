'use client';

import { useEffect, useEffectEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';

let socket: Socket | null = null;
// Several components can share a room (the listing page and the global notifier both use
// `list`), so a room is only left when its last subscriber unmounts.
const roomRefs = new Map<string, number>();

/**
 * Calls `onUpdate` whenever the server broadcasts a change for this room.
 * Payloads carry only the RFQ id; callers refetch so role-based visibility stays server-side.
 */
export function useLiveUpdates(room: string | null, onUpdate: (rfqId?: number) => void) {
  const notify = useEffectEvent((rfqId?: number) => onUpdate(rfqId));

  useEffect(() => {
    if (!room) return;
    socket ??= io(API_URL, { transports: ['websocket', 'polling'] });
    const s = socket;
    const handler = (p?: { rfqId?: number }) => notify(p?.rfqId);
    // Rejoin and resync after a reconnect: we may have missed broadcasts while offline.
    const onReconnect = () => {
      s.emit('join', room);
      notify();
    };
    const refs = roomRefs.get(room) ?? 0;
    roomRefs.set(room, refs + 1);
    if (refs === 0) s.emit('join', room);
    s.on('rfq:updated', handler);
    s.io.on('reconnect', onReconnect);
    return () => {
      const left = (roomRefs.get(room) ?? 1) - 1;
      if (left > 0) roomRefs.set(room, left);
      else {
        roomRefs.delete(room);
        s.emit('leave', room);
      }
      s.off('rfq:updated', handler);
      s.io.off('reconnect', onReconnect);
    };
  }, [room]);
}
