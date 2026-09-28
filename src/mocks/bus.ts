import type { RealtimeEnvelope } from '@/contracts';

/** In-page replacement for the Socket.IO channel when the mock backend is active. */
type Listener = (envelope: RealtimeEnvelope) => void;
type PresenceListener = (visible: boolean) => void;
const listeners = new Set<Listener>();
const presenceListeners = new Set<PresenceListener>();

export const mockBus = {
  emit(envelope: RealtimeEnvelope): void {
    // Deliver asynchronously, like a socket would, and as a structured clone so consumers cannot mutate mock state.
    const copy = JSON.parse(JSON.stringify(envelope)) as RealtimeEnvelope;
    setTimeout(() => {
      for (const l of listeners) l(copy);
    }, 0);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Client → "server": the socket's `presence { visible }` (D-97). */
  presence(visible: boolean): void {
    setTimeout(() => {
      for (const l of presenceListeners) l(visible);
    }, 0);
  },
  onPresence(listener: PresenceListener): () => void {
    presenceListeners.add(listener);
    return () => presenceListeners.delete(listener);
  },
};
