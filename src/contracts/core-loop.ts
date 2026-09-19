import { z } from 'zod';
import { Amount, I18nText, IsoDateTime, ServiceFamily, publicId, IdPrefix } from './common';
import { FacilityDto, IncidentDto, RealtimeEnvelope, SyncSnapshot, VehicleDto } from './game';

/* Shapes of the core-loop endpoints that ROUTES.md names (added by backend-core, additive within v1). */

/** Tutorial progress lives in `CareerSummary.tutorial.step`. DONE ⇒ `completed = true`. Forward-only. */
export const TutorialStep = z.enum(['WELCOME', 'SELECT_INCIDENT', 'DISPATCH', 'WATCH_ARRIVAL', 'OUTCOME', 'BUY_VEHICLE', 'DONE']);
export type TutorialStep = z.infer<typeof TutorialStep>;
/** POST /careers/:id/tutorial/advance → CareerSummary. Sending DONE skips the tutorial. */
export const TutorialAdvanceBody = z.object({ step: TutorialStep });

/** PATCH /careers/:id/duty → CareerSummary */
export const DutyBody = z.object({ onDuty: z.boolean() });

/** POST /careers/:id/incidents/:incidentId/dispatch → the updated incident and vehicles. */
export const DispatchResultDto = z.object({ dispatchId: publicId(IdPrefix.dispatch), incident: IncidentDto, vehicles: z.array(VehicleDto) });
export type DispatchResultDto = z.infer<typeof DispatchResultDto>;

/**
 * GET /careers/:id/sync?since=<seq> → the missed realtime events, or (`resyncRequired`) a full snapshot when the gap
 * cannot be replayed. Without `since` the endpoint returns a plain `SyncSnapshot`.
 */
export const SyncDelta = z.object({
  seq: z.number().int(),
  events: z.array(RealtimeEnvelope),
  resyncRequired: z.boolean(),
  snapshot: SyncSnapshot.nullable(),
});
export type SyncDelta = z.infer<typeof SyncDelta>;

/** GET /careers/:id/incidents/:incidentId/timeline */
export const TimelineEntryDto = z.object({
  id: z.string(),
  at: IsoDateTime,
  type: z.string(),
  text: I18nText,
  vehicleId: publicId(IdPrefix.vehicle).nullable().optional(),
});
export type TimelineEntryDto = z.infer<typeof TimelineEntryDto>;

/** GET /careers/:id/facilities/:facilityId → FacilityDto + the upgrades that can be bought next. */
export const UpgradeOfferDto = z.object({
  code: z.string(),
  name: I18nText,
  description: I18nText,
  currentLevel: z.number().int(),
  maxLevel: z.number().int(),
  price: Amount,
  requiredLevel: z.number().int(),
  buildSeconds: z.number().int(),
  effect: z.object({ domain: z.string(), delta: z.number().int() }),
  available: z.boolean(),
  lockedReason: z.string().nullable(),
});
export type UpgradeOfferDto = z.infer<typeof UpgradeOfferDto>;
export const FacilityDetailDto = FacilityDto.extend({ address: z.string().nullable().optional(), availableUpgrades: z.array(UpgradeOfferDto) });
export type FacilityDetailDto = z.infer<typeof FacilityDetailDto>;

/** GET /careers/:id/economy/balance */
export const BalanceDto = z.object({ credits: Amount, purchasedCredits: Amount, lifetimeEarned: Amount, lifetimeSpent: Amount });
export type BalanceDto = z.infer<typeof BalanceDto>;

/** GET /careers/:id/progression */
export const ProgressionDto = z.object({
  level: z.number().int(), xp: Amount, xpForCurrentLevel: Amount, xpForNextLevel: Amount, reputation: z.number(),
  incidentsResolved: z.number().int(), incidentsFailed: z.number().int(),
});
export type ProgressionDto = z.infer<typeof ProgressionDto>;

/** GET /careers/:id/progression/unlocks */
export const UnlockDto = z.object({
  code: z.string(), kind: z.enum(['FAMILY', 'VEHICLE_TYPE', 'FACILITY_TYPE', 'FEATURE']), name: I18nText,
  requiredLevel: z.number().int(), unlocked: z.boolean(), family: ServiceFamily.nullable().optional(),
});
export type UnlockDto = z.infer<typeof UnlockDto>;

/** GET /health/ready · GET /version */
export const ReadinessDto = z.object({ status: z.enum(['ok', 'degraded']), checks: z.record(z.enum(['ok', 'fail', 'degraded'])) });
export const VersionDto = z.object({ name: z.string(), version: z.string(), gitSha: z.string(), configVersion: z.string().nullable(), catalogVersion: z.string() });
