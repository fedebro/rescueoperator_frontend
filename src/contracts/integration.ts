import { z } from 'zod';
import { Amount, FacilityFamily, I18nText, IdPrefix, IsoDateTime, LngLat, ServiceFamily, SupportedLocale, publicId } from './common';
import { FacilityDto, VehicleDto } from './game';
import { FacilityDetailDto } from './core-loop';

/* Wave 2a (backend-integration): catalog i18n, sites & facilities, coverage & stipend, milestones. All additive within v1. */

/** GET /public/i18n/catalog/:locale[?v=<hash>] — flattened catalog texts (`vehicle.FIRE_APS.name` → string | string[]). Cache: immutable when `v` matches. */
export const CatalogI18nBundle = z.object({
  locale: SupportedLocale,
  catalogVersion: z.string(),
  hash: z.string(),
  messages: z.record(z.union([z.string(), z.array(z.string())])),
});
export type CatalogI18nBundle = z.infer<typeof CatalogI18nBundle>;

/** GET /careers/:id/sites?bbox=w,s,e,n[&family=] — candidate sites where a new facility can be acquired. */
export const SiteOptionDto = z.object({
  facilityTypeCode: z.string(), family: FacilityFamily, tier: z.number().int(), price: Amount, requiredLevel: z.number().int(), setupSeconds: z.number().int(),
  available: z.boolean(), lockedReason: z.string().nullable(),
});
export const SiteDto = z.object({
  id: publicId(IdPrefix.site),
  name: z.string(),
  real: z.boolean(),
  family: ServiceFamily,
  position: LngLat,
  address: z.string().nullable(),
  locationId: z.string(),
  capacityPoints: z.number().int(),
  expansionPotential: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  profile: z.enum(['CENTRAL', 'BALANCED', 'PERIPHERAL']),
  /** True when this career already owns a facility on the site. */
  owned: z.boolean(),
  options: z.array(SiteOptionDto),
});
export type SiteDto = z.infer<typeof SiteDto>;

/** POST /careers/:id/facilities/:facilityId/promote (Idempotency-Key) → FacilityDetailDto */
export const PromotionOfferDto = z.object({
  toTypeCode: z.string(), name: I18nText, price: Amount, buildSeconds: z.number().int(), requiredLevel: z.number().int(),
  requiredUpgradeLevels: z.record(z.number().int()), available: z.boolean(), lockedReason: z.string().nullable(),
});
export const FacilityDetailV2Dto = FacilityDetailDto.extend({ promotionOffer: PromotionOfferDto.nullable().optional() });
export type FacilityDetailV2Dto = z.infer<typeof FacilityDetailV2Dto>;

/** POST /careers/:id/vehicles/:vehicleId/transfer (Idempotency-Key) → { vehicle, facilities } */
export const TransferVehicleBody = z.object({ facilityId: publicId(IdPrefix.facility) });
export const TransferVehicleResult = z.object({ vehicle: VehicleDto, facilities: z.array(FacilityDto) });

/* GET /coverage → `CoverageDto`, GET /economy/stipend → `StipendDto`: both live in business.ts (extended additively there). */

/** GET /careers/:id/progression/milestones */
export const MilestoneDto = z.object({
  code: z.string(), phase: z.string(), order: z.number().int(), title: I18nText, description: I18nText, rewardCredits: Amount, rewardXp: Amount,
  progress: z.object({ current: z.number(), target: z.number() }), achieved: z.boolean(), achievedAt: IsoDateTime.nullable(),
});
export type MilestoneDto = z.infer<typeof MilestoneDto>;
