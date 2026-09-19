import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENT, SOCKET_NAMESPACE } from '@/contracts';
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
  handlers.onStatus('connecting');
  socket.on('connect', () => {
    failures = 0;
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
      socket.removeAllListeners();
      socket.close();
    },
  };
}

/** Mock transport: the in-page simulation publishes envelopes on a bus. */
export function connectMockBus(handlers: TransportHandlers): RealtimeTransport {
  let unsubscribe: (() => void) | null = null;
  let closed = false;
  handlers.onStatus('connecting');
  void import('@/mocks/bus').then(({ mockBus }) => {
    if (closed) return;
    unsubscribe = mockBus.subscribe(handlers.onEvent);
    handlers.onStatus('online');
  });
  return {
    close: () => {
      closed = true;
      unsubscribe?.();
    },
  };
}
