/**
 * Depth domains: personnel, training, medical, inventory, maintenance.
 * Authored by the lead BEFORE implementation so backend and frontend can be built in parallel.
 * Backend may extend additively; never rename or remove fields.
 */
import { z } from 'zod';
import { Amount, I18nText, IdPrefix, IsoDateTime, LngLat, ServiceFamily, publicId } from './common';
import { FatigueBand, HealthBand, PatientStatus, PersonnelStatus, TriageCode } from './game';

/* ───────────── personnel ───────────── */

export const QualificationHeld = z.object({ code: z.string(), obtainedAt: IsoDateTime, expiresAt: IsoDateTime.nullable() });

export const PersonnelDto = z.object({
  id: publicId(IdPrefix.personnel),
  firstName: z.string(),
  lastName: z.string(),
  roleCode: z.string(),
  family: ServiceFamily,
  facilityId: publicId(IdPrefix.facility),
  teamId: publicId(IdPrefix.team).nullable(),
  status: PersonnelStatus,
  competence: z.number().int().min(1).max(100),
  /** Fatigue anchor: value(now) = clamp(value + ratePerSecond * (now - anchorAt), 0, 100). */
  fatigue: z.object({ value: z.number(), ratePerSecond: z.number(), anchorAt: IsoDateTime, band: FatigueBand }),
  qualifications: z.array(QualificationHeld),
  missions: z.number().int(),
  hiredAt: IsoDateTime,
  busyUntil: IsoDateTime.nullable(),
  busyReason: z.enum(['ONBOARDING', 'MISSION', 'REST', 'TRAINING', 'INJURY', 'TRANSFER']).nullable(),
  costPerPeriod: Amount,
});
export type PersonnelDto = z.infer<typeof PersonnelDto>;

export const TeamStatus = z.enum(['READY', 'PARTIAL', 'ON_MISSION', 'RESTING', 'UNAVAILABLE']);
export const TeamDto = z.object({
  id: publicId(IdPrefix.team),
  name: z.string(),
  facilityId: publicId(IdPrefix.facility),
  departmentId: publicId(IdPrefix.department).nullable(),
  vehicleId: publicId(IdPrefix.vehicle).nullable(),
  leaderId: publicId(IdPrefix.personnel).nullable(),
  memberIds: z.array(publicId(IdPrefix.personnel)),
  status: TeamStatus,
  readiness: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});
export const DepartmentDto = z.object({
  id: publicId(IdPrefix.department), name: z.string(), family: ServiceFamily, facilityId: publicId(IdPrefix.facility),
});

export const CandidateDto = z.object({
  id: publicId(IdPrefix.candidate),
  firstName: z.string(), lastName: z.string(), roleCode: z.string(), family: ServiceFamily,
  competence: z.number().int(), qualifications: z.array(z.string()), potential: z.enum(['STANDARD', 'PROMISING', 'EXCEPTIONAL']),
  hireCost: Amount, costPerPeriod: Amount, onboardingSeconds: z.number().int(), expiresAt: IsoDateTime,
});
export const CandidatesResult = z.object({ candidates: z.array(CandidateDto), nextRefreshAt: IsoDateTime });

/** ★POST /personnel/hire — quick hire of a base role. */
export const QuickHireBody = z.object({ roleCode: z.string(), facilityId: publicId(IdPrefix.facility), count: z.number().int().min(1).max(10).default(1) });
/** ★POST /candidates/:id/hire */
export const HireCandidateBody = z.object({ facilityId: publicId(IdPrefix.facility) });
export const CreateTeamBody = z.object({ name: z.string().min(2).max(40), facilityId: publicId(IdPrefix.facility), departmentId: publicId(IdPrefix.department).nullable().optional() });
export const SetTeamMembersBody = z.object({ memberIds: z.array(publicId(IdPrefix.personnel)).max(12), leaderId: publicId(IdPrefix.personnel).nullable().optional() });
export const SetTeamVehicleBody = z.object({ vehicleId: publicId(IdPrefix.vehicle).nullable() });
export const TransferPersonnelBody = z.object({ facilityId: publicId(IdPrefix.facility) });

export const CourseDto = z.object({
  code: z.string(), name: I18nText, description: I18nText, family: ServiceFamily.nullable(),
  grantsQualification: z.string(), prerequisites: z.array(z.string()), eligibleRoles: z.array(z.string()),
  cost: Amount, durationSeconds: z.number().int(), requiredLevel: z.number().int(), unlocked: z.boolean(),
});
export const EnrollmentDto = z.object({
  id: publicId(IdPrefix.training), courseCode: z.string(), personnelId: publicId(IdPrefix.personnel),
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']), startedAt: IsoDateTime, endsAt: IsoDateTime,
});
/** ★POST /training/enroll */
export const EnrollBody = z.object({ courseCode: z.string(), personnelIds: z.array(publicId(IdPrefix.personnel)).min(1).max(20) });

/** Crew preview shown in dispatch options (additive field `crew` on DispatchOption). */
export const CrewPreview = z.object({
  available: z.number().int(), min: z.number().int(), optimal: z.number().int(),
  missingQualifications: z.array(z.string()), maxFatigueBand: FatigueBand, efficiency: z.number(),
});

/* ───────────── medical ───────────── */

export const PatientDto = z.object({
  id: publicId(IdPrefix.patient),
  incidentId: publicId(IdPrefix.incident),
  label: z.string(), // "Paziente 1"
  profileCode: z.string().nullable(), // null until assessed
  triage: TriageCode.nullable(),
  status: PatientStatus,
  stability: z.object({ value: z.number(), ratePerSecond: z.number(), anchorAt: IsoDateTime }).nullable(),
  needs: z.array(z.object({ capability: z.string(), met: z.boolean() })),
  transportRequired: z.boolean().nullable(),
  assignedVehicleId: publicId(IdPrefix.vehicle).nullable(),
  hospitalId: publicId(IdPrefix.hospital).nullable(),
  busyUntil: IsoDateTime.nullable(),
});
export type PatientDto = z.infer<typeof PatientDto>;

export const HospitalLoad = z.enum(['NORMAL', 'BUSY', 'SATURATED', 'CLOSED']);
export const HospitalDto = z.object({
  id: publicId(IdPrefix.hospital), name: z.string(), position: LngLat,
  capabilities: z.array(z.string()), load: HospitalLoad, hasHelipad: z.boolean(),
});
export const HospitalOption = z.object({
  hospitalId: publicId(IdPrefix.hospital), etaSeconds: z.number().int(), compatible: z.boolean(),
  load: HospitalLoad, expectedHandoffSeconds: z.number().int(), score: z.number(), recommended: z.boolean(), reasons: z.array(I18nText),
});
/** ★POST /patients/:id/transport */
export const TransportPatientBody = z.object({ hospitalId: publicId(IdPrefix.hospital), vehicleId: publicId(IdPrefix.vehicle).optional() });

/* ───────────── inventory ───────────── */

export const InventoryLineDto = z.object({
  facilityId: publicId(IdPrefix.facility), itemCode: z.string(), quantity: z.number().int(), reserved: z.number().int(),
  inbound: z.number().int(), minimum: z.number().int(), low: z.boolean(),
});
export const ItemTypeDto = z.object({ code: z.string(), name: I18nText, unit: z.string(), price: Amount, deliverySeconds: z.number().int() });
/** ★POST /inventory/orders */
export const InventoryOrderBody = z.object({
  facilityId: publicId(IdPrefix.facility),
  lines: z.array(z.object({ itemCode: z.string(), quantity: z.number().int().min(1).max(10000) })).min(1).max(20),
  urgent: z.boolean().default(false),
});
export const OrderDto = z.object({
  id: publicId(IdPrefix.order), kind: z.enum(['VEHICLE', 'SUPPLIES']), status: z.enum(['PLACED', 'IN_DELIVERY', 'DELIVERED', 'CANCELLED']),
  total: Amount, placedAt: IsoDateTime, arrivesAt: IsoDateTime.nullable(), summary: I18nText,
});

/* ───────────── maintenance ───────────── */

export const MaintenanceStatusDto = z.object({
  vehicleId: publicId(IdPrefix.vehicle), health: z.number(), healthBand: HealthBand, wear: z.number(),
  km: z.number(), missions: z.number().int(), due: z.enum(['NOT_DUE', 'UPCOMING', 'DUE', 'OVERDUE']),
  failureRisk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  quotes: z.array(z.object({ kind: z.enum(['SERVICE', 'REPAIR', 'FREE_EMERGENCY_REPAIR']), cost: Amount, durationSeconds: z.number().int(), restoresTo: z.number() })),
});
export const MaintenanceOrderDto = z.object({
  id: publicId(IdPrefix.maintenance), vehicleId: publicId(IdPrefix.vehicle), kind: z.enum(['SERVICE', 'REPAIR', 'FREE_EMERGENCY_REPAIR']),
  status: z.enum(['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']), cost: Amount, startedAt: IsoDateTime.nullable(), endsAt: IsoDateTime.nullable(),
});
/** ★POST /vehicles/:id/maintenance  ·  ★POST /vehicles/:id/repair */
export const MaintenanceBody = z.object({ kind: z.enum(['SERVICE', 'REPAIR', 'FREE_EMERGENCY_REPAIR']) });
export const VehicleHistoryEntry = z.object({ at: IsoDateTime, kind: z.string(), text: I18nText });
