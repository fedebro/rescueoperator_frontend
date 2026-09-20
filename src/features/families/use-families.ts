'use client';
import * as React from 'react';
import type { I18nText, ServiceFamily } from '@/contracts';
import { useCatalog, useSnapshot } from '@/features/game/hooks';

/** Families whose unlock level depends on the territory of the career (analisi/05 §4): the UI explains it. */
export const TERRITORY_FAMILIES: readonly ServiceFamily[] = ['WILDFIRE', 'ALPINE'];

export interface FamilyInfo {
  code: ServiceFamily;
  name: I18nText;
  /** Already resolved for THIS career by the server. */
  requiredLevel: number;
  unlocked: boolean;
  territoryDependent: boolean;
  /** False when the territory cannot host this family at all (`spawnsIncidents=false` while still locked). */
  availableInTerritory: boolean;
}

/** Player-managed service families, catalog-driven (order, names, levels); lock state follows the live snapshot. */
export function useFamilies(): FamilyInfo[] {
  const catalog = useCatalog();
  const { career } = useSnapshot();
  return React.useMemo(
    () =>
      (catalog?.families ?? [])
        .filter((f) => f.code !== 'UNG' && f.playerManaged !== false)
        .map((f) => ({
          availableInTerritory: f.spawnsIncidents !== false || career.unlockedFamilies.includes(f.code),
          code: f.code,
          name: f.name,
          requiredLevel: f.requiredLevel,
          // The snapshot is patched by realtime events before the catalog refetch lands: trust it first.
          unlocked: career.unlockedFamilies.includes(f.code),
          territoryDependent: TERRITORY_FAMILIES.includes(f.code),
        })),
    [catalog, career.unlockedFamilies],
  );
}
