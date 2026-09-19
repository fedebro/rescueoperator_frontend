/**
 * Server clock tracking. Every API response and realtime envelope carries `serverTime`;
 * the client keeps `offset = serverTime - Date.now()` so countdowns, ETAs and vehicle
 * interpolation follow the authoritative clock instead of the device clock.
 */
type Listener = (offsetMs: number) => void;

let offsetMs = 0;
let samples = 0;
const listeners = new Set<Listener>();

/** Feed a server timestamp. `roundTripMs` (when known) halves the network latency error. */
export function observeServerTime(
  serverTimeIso: string,
  roundTripMs = 0,
  localNow: number = Date.now(),
): void {
  const server = Date.parse(serverTimeIso);
  if (Number.isNaN(server)) return;
  const sample = server + roundTripMs / 2 - localNow;
  // First sample wins outright; later samples are smoothed unless the drift is large (device clock changed).
  if (samples === 0 || Math.abs(sample - offsetMs) > 5_000) offsetMs = sample;
  else offsetMs = offsetMs * 0.8 + sample * 0.2;
  samples += 1;
  for (const l of listeners) l(offsetMs);
}

export function getClockOffset(): number {
  return offsetMs;
}

/** Current server time in epoch ms. */
export function serverNow(localNow: number = Date.now()): number {
  return localNow + offsetMs;
}

export function subscribeClock(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetClockForTests(): void {
  offsetMs = 0;
  samples = 0;
}
