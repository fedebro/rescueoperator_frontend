'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  type InventoryLineDto,
  InventoryOverview,
  ItemTypeDto,
  type MaintenanceStatusDto,
  OrderDto,
} from '@/contracts';
import { api } from '@/lib/api/client';
import { logisticsApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useCareerId, useCatalog, useSnapshot } from '@/features/game/hooks';

/**
 * Read side of the logistics screens. The contract DTOs are parsed with a few ADDITIVE optional fields the UI can use
 * when the server sends them (pack size, order lines, urgent multipliers, storage usage); every one has a fallback, so a
 * backend that only implements the base contract still renders correctly.
 */
export type InventoryLine = z.infer<typeof InventoryLineDto>;
export type MaintenanceStatus = z.infer<typeof MaintenanceStatusDto>;

export const ItemTypeV2 = ItemTypeDto.extend({
  packSize: z.number().int().positive().optional(),
  family: z.string().optional(),
  requiredLevel: z.number().int().optional(),
  unlocked: z.boolean().optional(),
  icon: z.string().optional(),
});
export type ItemTypeV2 = z.infer<typeof ItemTypeV2>;

export const OrderV2 = OrderDto.extend({
  facilityId: z.string().optional(),
  urgent: z.boolean().optional(),
  lines: z.array(z.object({ itemCode: z.string(), quantity: z.number().int() })).optional(),
});
export type OrderV2 = z.infer<typeof OrderV2>;

export const InventoryOverviewV2 = InventoryOverview.extend({
  orders: z.array(OrderV2),
  urgent: z.object({ priceMultiplier: z.number(), timeMultiplier: z.number() }).optional(),
  storage: z
    .array(z.object({ facilityId: z.string(), capacity: z.number().int(), used: z.number().int() }))
    .optional(),
});
export type InventoryOverviewV2 = z.infer<typeof InventoryOverviewV2>;

/** Used only when the server does not publish its urgent-delivery multipliers (analisi: faster and pricier). */
export const DEFAULT_URGENT = { priceMultiplier: 1.5, timeMultiplier: 0.35 };

export function useInventory(enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: [...qk.inventory(careerId), 'overview'],
    queryFn: () => api.get(`/careers/${careerId}/inventory`, { schema: InventoryOverviewV2 }),
    enabled,
  });
}

export function useItemTypes(enabled = true) {
  const careerId = useCareerId();
  const catalog = useCatalog();
  const query = useQuery({
    queryKey: qk.inventoryItems(careerId),
    queryFn: () => api.get(`/careers/${careerId}/inventory/items`, { schema: z.array(ItemTypeV2) }),
    enabled,
    staleTime: 60_000,
  });
  // Pack size is catalog data: prefer the endpoint's additive field, fall back to the raw catalog section, then 1.
  const items = React.useMemo(() => {
    const raw = new Map(
      (catalog?.items ?? []).map((i) => [String(i.code), i] as [string, Record<string, unknown>]),
    );
    return (query.data ?? []).map((item) => {
      const fromCatalog = raw.get(item.code);
      const packSize =
        item.packSize ?? (Number(fromCatalog?.packSize) > 0 ? Number(fromCatalog?.packSize) : 1);
      return { ...item, packSize };
    });
  }, [query.data, catalog]);
  return { ...query, items };
}
export type ItemType = ReturnType<typeof useItemTypes>['items'][number];

export function useMaintenance(enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: [...qk.maintenance(careerId), 'overview'],
    queryFn: () => logisticsApi.maintenance(careerId),
    enabled,
  });
}

export function useVehicleHistory(vehicleId: string, enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.vehicleHistory(careerId, vehicleId),
    queryFn: () => logisticsApi.vehicleHistory(careerId, vehicleId),
    enabled,
  });
}

export interface FeatureGate {
  unlocked: boolean;
  requiredLevel: number;
}
/** Catalog feature gate (`INVENTORY` level 2, `MAINTENANCE` level 3): locked sections stay visible with their level. */
export function useFeatureGate(feature: 'INVENTORY' | 'MAINTENANCE'): FeatureGate {
  const catalog = useCatalog();
  const { career } = useSnapshot();
  const row = catalog?.features?.find((f) => f.feature === feature);
  const requiredLevel = row?.requiredLevel ?? (feature === 'INVENTORY' ? 2 : 3);
  // The level comes from the live snapshot: the catalog may be a few minutes stale right after a level-up.
  return { unlocked: career.level >= requiredLevel, requiredLevel };
}

/** Client-side quote of a supplies order, shown BEFORE the command (the server recomputes and is authoritative). */
export function quoteLines(
  lines: { item: ItemType; packs: number }[],
  urgent: { priceMultiplier: number; timeMultiplier: number },
) {
  let base = 0n;
  let seconds = 0;
  for (const { item, packs } of lines) {
    if (packs <= 0) continue;
    base += BigInt(item.price) * BigInt(packs * item.packSize);
    seconds = Math.max(seconds, item.deliverySeconds);
  }
  // Integer credits: the multiplier is applied in hundredths and rounded half-up, like the server does.
  const hundredths = BigInt(Math.round(urgent.priceMultiplier * 100));
  return {
    standard: { total: base, seconds },
    urgent: {
      total: (base * hundredths + 50n) / 100n,
      seconds: Math.max(1, Math.round(seconds * urgent.timeMultiplier)),
    },
  };
}
