import type { QueryClient } from '@tanstack/react-query';
import type { SyncSnapshot } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';

/**
 * The autonomy block of a vehicle is computed by the server on every read (D-22): a level-up that unlocks the onboard
 * stock (level 2) or the fuel (level 3) changes it for the whole fleet without any vehicle event. Re-read the fleet once
 * and merge ONLY `autonomy` into the cached snapshot, so the gauges (and their explanation card) appear at once while
 * the rest of each vehicle stays owned by the realtime events. A failure is harmless: the next vehicle event carries it.
 */
export async function refreshFleetAutonomy(qc: QueryClient, careerId: string): Promise<void> {
  try {
    const fresh = new Map((await gameApi.vehicles(careerId)).map((v) => [v.id, v.autonomy]));
    qc.setQueryData<SyncSnapshot>(qk.sync(careerId), (s) =>
      s
        ? {
            ...s,
            vehicles: s.vehicles.map((v) => (fresh.has(v.id) ? { ...v, autonomy: fresh.get(v.id) } : v)),
          }
        : s,
    );
  } catch {
    /* next vehicle.* event */
  }
}
