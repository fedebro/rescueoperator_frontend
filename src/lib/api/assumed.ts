/**
 * Shapes the v1 contract does NOT define as Zod schemas (ROUTES.md only names the route, or the contract only defines
 * the request body). These are the frontend's working assumptions — the mock backend implements exactly these and
 * `analisi/note-agenti/frontend-depth.md` lists them for the backend agents. When the backend publishes the real schema
 * in `contracts/`, delete the matching entry here. Admin shapes live in `./admin.ts`.
 */
import { z } from 'zod';
import {
  Amount,
  CareerSummary,
  CourseDto,
  CrewPreview,
  DispatchOption,
  DispatchOptionsResult,
  EnrollmentDto,
  FacilityDto,
  I18nText,
  IncidentDto,
  InventoryLineDto,
  IsoDateTime,
  MaintenanceOrderDto,
  MaintenanceStatusDto,
  OrderDto,
  PatientDto,
  PersonnelDto,
  SpeedupTarget,
  VehicleDto,
} from '@/contracts';

/**
 * GET /incidents/:id/dispatch-options — depth.ts declares `crew` as an additive field of DispatchOption but the base
 * schema (game.ts) does not list it, so a strict parse would strip it: the client parses with this extension.
 */
export const DispatchOptionV2 = DispatchOption.extend({ crew: CrewPreview.optional() });
export const DispatchOptionsResultV2 = DispatchOptionsResult.extend({ options: z.array(DispatchOptionV2) });
export type DispatchOptionV2 = z.infer<typeof DispatchOptionV2>;

/** ★POST /careers/:id/facilities — acquire a facility on a candidate site (body not in the contract). */
export const AcquireFacilityBody = z.object({
  siteId: z.string(),
  facilityTypeCode: z.string(),
  name: z.string().min(2).max(60).optional(),
});

/** GET /personnel/:id — the operator sheet = PersonnelDto + history + injury. */
export const PersonnelDetailDto = PersonnelDto.extend({
  history: z.array(z.object({ at: IsoDateTime, kind: z.string(), text: I18nText })),
  injury: z.object({ severity: z.enum(['MINOR', 'MODERATE']), recoversAt: IsoDateTime }).nullable(),
});
export type PersonnelDetailDto = z.infer<typeof PersonnelDetailDto>;

/** GET /training/courses — catalogue + the career's enrollments + free training slots per facility. */
export const TrainingOverview = z.object({
  courses: z.array(CourseDto),
  enrollments: z.array(EnrollmentDto),
  slots: z.array(z.object({ facilityId: z.string(), total: z.number().int(), used: z.number().int() })),
});
export type TrainingOverview = z.infer<typeof TrainingOverview>;

/** ★POST /patients/:id/transport */
export const TransportResult = z.object({
  patient: PatientDto,
  vehicle: VehicleDto,
  incident: IncidentDto.optional(),
});

/** GET /inventory — stock lines of every facility + open orders. */
export const InventoryOverview = z.object({
  lines: z.array(InventoryLineDto),
  orders: z.array(OrderDto),
});
export type InventoryOverview = z.infer<typeof InventoryOverview>;

/** GET /maintenance — status of every vehicle + workshop queue (+ workshop slots per facility). */
export const MaintenanceOverview = z.object({
  vehicles: z.array(MaintenanceStatusDto),
  orders: z.array(MaintenanceOrderDto),
  workshops: z.array(z.object({ facilityId: z.string(), slots: z.number().int(), busy: z.number().int() })),
});
export type MaintenanceOverview = z.infer<typeof MaintenanceOverview>;

/** GET /speedups/quote?target=&targetId= → SpeedupQuote (contract). ★POST /speedups → this. */
export const SpeedupResult = z.object({
  target: SpeedupTarget,
  targetId: z.string(),
  cost: Amount,
  career: CareerSummary.optional(),
  vehicle: VehicleDto.optional(),
  facility: FacilityDto.optional(),
});
export type SpeedupResult = z.infer<typeof SpeedupResult>;
