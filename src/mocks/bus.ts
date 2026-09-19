import type { RealtimeEnvelope } from '@/contracts';

/** In-page replacement for the Socket.IO channel when the mock backend is active. */
type Listener = (envelope: RealtimeEnvelope) => void;
const listeners = new Set<Listener>();

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
};
