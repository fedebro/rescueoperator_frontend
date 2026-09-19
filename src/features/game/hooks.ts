'use client';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IncidentDto, SyncSnapshot, VehicleDto } from '@/contracts';
import type { CatalogDto } from '@/lib/api/types';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { useAuthStore } from '@/stores/auth';

const CareerContext = React.createContext<string | null>(null);
export const CareerProvider = CareerContext.Provider;

export function useCareerId(): string {
  const fromContext = React.useContext(CareerContext);
  const fromUser = useAuthStore((s) => s.user?.activeCareerId ?? null);
  const id = fromContext ?? fromUser;
  if (!id) throw new Error('useCareerId used outside of a career');
  return id;
}

/** The operational snapshot. Fetched once, then kept fresh by realtime events (never refetched on a timer while the socket is up). */
export function useSnapshotQuery(careerId: string) {
  return useQuery({
    queryKey: qk.sync(careerId),
    queryFn: () => gameApi.sync(careerId),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useSnapshot(): SyncSnapshot {
  const careerId = useCareerId();
  const { data } = useSnapshotQuery(careerId);
  if (!data) throw new Error('snapshot not loaded — render under <GameRuntime>');
  return data;
}

export function useCatalog(): CatalogDto | undefined {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.catalog(careerId),
    queryFn: () => gameApi.catalog(careerId),
    staleTime: 5 * 60_000,
  }).data;
}

export function useVehicleTypeLookup() {
  const catalog = useCatalog();
  return React.useMemo(() => {
    const map = new Map((catalog?.vehicleTypes ?? []).map((v) => [v.code, v]));
    return (code: string) => map.get(code);
  }, [catalog]);
}

export const SEVERITY_ORDER = (a: IncidentDto, b: IncidentDto): number => {
  const pending = (i: IncidentDto) => (i.status === 'PENDING_RESPONSE' ? 0 : 1);
  return pending(a) - pending(b) || b.severity - a.severity || a.createdAt.localeCompare(b.createdAt);
};

export const isVehicleAvailable = (v: VehicleDto): boolean => v.status === 'AVAILABLE';

/** Optimistic snapshot patch helper used by mutations (the authoritative state follows via events). */
export function usePatchSnapshot() {
  const qc = useQueryClient();
  const careerId = useCareerId();
  return React.useCallback(
    (patch: (s: SyncSnapshot) => SyncSnapshot) => {
      qc.setQueryData<SyncSnapshot>(qk.sync(careerId), (s) => (s ? patch(s) : s));
    },
    [qc, careerId],
  );
}
