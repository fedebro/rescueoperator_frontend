import { io, type Socket } from 'socket.io-client';
import type { z } from 'zod';
import { SOCKET_EVENT, SOCKET_NAMESPACE, SOCKET_PRESENCE_EVENT, type PresenceEventBody } from '@/contracts';
import { env } from '@/lib/env';
import { getAccessToken, refreshSession } from '@/lib/api/client';

export type TransportStatus = 'connecting' | 'online' | 'reconnecting' | 'failed';
export interface RealtimeTransport {
  close(): void;
}
export interface TransportHandlers {
  onEvent: (raw: unknown) => void;
  onStatus: (status: TransportStatus) => void;
  /** Called on every (re)connection after the first: the caller refetches the snapshot. */
  onReconnect: () => void;
}

/** Is the game on screen? A hidden tab, a minimised window or an app in the background is not (Page Visibility API). */
export const pageVisible = (): boolean =>
  typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * Presence (D-97): the server never pushes to a player who has a visible game client, so every client says whether it is
 * on screen — on every (re)connection and on every visibility change. A socket that never said so counts as hidden.
 * `announce()` reports the current state (call it on connect); `stop()` removes the listeners.
 */
export function reportPresence(send: (body: z.infer<typeof PresenceEventBody>) => void): {
  announce: () => void;
  stop: () => void;
} {
  const announce = () => send({ visible: pageVisible() });
  // `pagehide` covers a tab being closed or frozen without a visibility change first (bfcache, some mobile browsers).
  const hide = () => send({ visible: false });
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', announce);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', hide);
  return {
    announce,
    stop: () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', announce);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', hide);
    },
  };
}

/** Socket.IO — websocket only (D-73), namespace /game, single event name. */
export function connectSocket(careerId: string, handlers: TransportHandlers): RealtimeTransport {
  let connectedOnce = false;
  let failures = 0;
  const socket: Socket = io(`${env.apiUrl.replace(/\/$/, '')}${SOCKET_NAMESPACE}`, {
    transports: ['websocket'],
    upgrade: false,
    withCredentials: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    auth: (cb) => cb({ accessToken: getAccessToken(), careerId }),
  });
  const presence = reportPresence((body) => {
    if (socket.connected) socket.emit(SOCKET_PRESENCE_EVENT, body);
  });
  handlers.onStatus('connecting');
  socket.on('connect', () => {
    failures = 0;
    presence.announce();
    handlers.onStatus('online');
    if (connectedOnce) handlers.onReconnect();
    connectedOnce = true;
  });
  socket.on(SOCKET_EVENT, (raw: unknown) => handlers.onEvent(raw));
  socket.on('disconnect', () => handlers.onStatus('reconnecting'));
  socket.on('connect_error', (err: Error) => {
    failures += 1;
    // Expired access token → refresh, the auth callback picks the new token on the next attempt.
    if (/UNAUTHENTICATED|jwt|token/i.test(err.message)) void refreshSession().catch(() => undefined);
    handlers.onStatus(failures >= 3 ? 'failed' : 'reconnecting');
  });
  return {
    close: () => {
      presence.stop();
      socket.removeAllListeners();
      socket.close();
    },
  };
}

/** Mock transport: the in-page simulation publishes envelopes on a bus (and hears the client's presence on it). */
export function connectMockBus(handlers: TransportHandlers): RealtimeTransport {
  let unsubscribe: (() => void) | null = null;
  let presence: ReturnType<typeof reportPresence> | null = null;
  let closed = false;
  handlers.onStatus('connecting');
  void import('@/mocks/bus').then(({ mockBus }) => {
    if (closed) return;
    unsubscribe = mockBus.subscribe(handlers.onEvent);
    presence = reportPresence((body) => mockBus.presence(body.visible));
    presence.announce();
    handlers.onStatus('online');
  });
  return {
    close: () => {
      closed = true;
      unsubscribe?.();
      presence?.stop();
    },
  };
}
