import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_PRESENCE_EVENT, PresenceEventBody } from '@/contracts';

/** A socket.io-client stand-in: records what the client emits and lets the test fire its lifecycle events. */
const socket = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    connected: false,
    emitted: [] as [string, unknown][],
    on(event: string, fn: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
    emit(event: string, body: unknown) {
      this.emitted.push([event, body]);
    },
    fire(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    removeAllListeners() {
      listeners.clear();
    },
    close: vi.fn(),
    reset() {
      listeners.clear();
      this.emitted = [];
      this.connected = false;
    },
  };
});
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socket) }));

const { connectSocket, reportPresence } = await import('./transport');

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const handlers = () => ({ onEvent: vi.fn(), onStatus: vi.fn(), onReconnect: vi.fn() });

afterEach(() => {
  socket.reset();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('presence (D-97: no push to a player who is looking at the game)', () => {
  it('reportPresence announces on demand, on every visibility change and on pagehide; stop() detaches', () => {
    const sent: boolean[] = [];
    const presence = reportPresence((body) => sent.push(body.visible));
    presence.announce();
    setVisibility('hidden');
    setVisibility('visible');
    window.dispatchEvent(new Event('pagehide'));
    presence.stop();
    setVisibility('hidden');
    expect(sent).toEqual([true, false, true, false]);
  });

  it('the socket says `presence { visible }` on every (re)connection and visibility change, contract-shaped', () => {
    const transport = connectSocket('car_01J8Z0000000000000000000AA', handlers());
    // Not connected yet: nothing can be sent (the connect handler announces it).
    setVisibility('hidden');
    expect(socket.emitted).toEqual([]);
    socket.connected = true;
    socket.fire('connect');
    setVisibility('visible');
    socket.fire('disconnect');
    socket.connected = false;
    setVisibility('hidden');
    socket.connected = true;
    socket.fire('connect'); // reconnection: announced again
    expect(socket.emitted).toEqual([
      [SOCKET_PRESENCE_EVENT, { visible: false }],
      [SOCKET_PRESENCE_EVENT, { visible: true }],
      [SOCKET_PRESENCE_EVENT, { visible: false }],
    ]);
    for (const [, body] of socket.emitted) expect(PresenceEventBody.safeParse(body).success).toBe(true);
    transport.close();
    setVisibility('visible');
    expect(socket.emitted).toHaveLength(3);
  });
});
