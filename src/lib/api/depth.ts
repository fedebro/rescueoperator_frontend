/**
 * REST wrappers for the depth + business contract (contracts/depth.ts, business.ts, integration.ts; routes: ROUTES.md).
 * Every response shape comes from the contract copy in `@/contracts` — there are no locally assumed shapes left.
 */
import { z } from 'zod';
import {
  type AcquireFacilityBody,
  AdCompleteResult,
  AdStartResult,
  AdsStatusDto,
  CandidatesResult,
  ChargeSavedCardResult,
  CheckoutResult,
  type CourseDto,
  CoverageDto,
  CreditPackageDto,
  DepartmentDto,
  EnrollmentDto,
  FacilityDetailV2Dto,
  HospitalDto,
  HospitalOption,
  type InventoryLineDto,
  InventoryOverview,
  ItemTypeDto,
  MaintenanceOrderDto,
  MaintenanceOverview,
  type MaintenanceStatusDto,
  MilestoneDto,
  NotificationDto,
  OrderDto,
  PatientDto,
  PersonnelDetailDto,
  PersonnelDto,
  PublicInviteDto,
  PurchaseDto,
  ReferralDto,
  RunwayDto,
  SavedPaymentMethodDto,
  SaveCardResult,
  SiteDto,
  SpeedupQuote,
  SpeedupResult,
  StipendDto,
  TeamDto,
  TrainingOverview,
  TransferVehicleResult,
  TransportPatientResult,
  WaterSourcesResult,
  VehicleHistoryEntry,
  WorldContextDto,
  type SpeedupTarget,
} from '@/contracts';
import { api } from './client';

const c = (careerId: string) => `/careers/${careerId}`;
type Target = z.infer<typeof SpeedupTarget>;

export const facilitiesApi = {
  /**
   * Candidate sites inside a bbox `[w,s,e,n]`. `kind` (water, D-23): ALL (default: nautical sites are listed whatever
   * the family), STANDARD (family sites only) or NAUTICAL (only where a Base nautica can be bought).
   */
  sites: (
    careerId: string,
    bbox: [number, number, number, number],
    family?: string,
    kind?: 'ALL' | 'STANDARD' | 'NAUTICAL',
  ) =>
    api.get(`${c(careerId)}/sites`, {
      query: { bbox: bbox.join(','), family, kind },
      schema: z.array(SiteDto),
    }),
  acquire: (careerId: string, body: z.infer<typeof AcquireFacilityBody>) =>
    api.command(`${c(careerId)}/facilities`, body, { schema: FacilityDetailV2Dto }),
  detail: (careerId: string, id: string) =>
    api.get(`${c(careerId)}/facilities/${id}`, { schema: FacilityDetailV2Dto }),
  promote: (careerId: string, id: string) =>
    api.command(`${c(careerId)}/facilities/${id}/promote`, {}, { schema: FacilityDetailV2Dto }),
  transferVehicle: (careerId: string, vehicleId: string, facilityId: string) =>
    api.command(
      `${c(careerId)}/vehicles/${vehicleId}/transfer`,
      { facilityId },
      { schema: TransferVehicleResult },
    ),
};

/**
 * Real runway/taxiway centerlines (airport-runway-map). Rendering-only world overlay: no ownership, no gate — the
 * bbox mirrors `facilitiesApi.sites`, so the same "pad the career bounds a little" helper works for both.
 */
export const worldGeometryApi = {
  runways: (careerId: string, bbox: [number, number, number, number]) =>
    api.get(`${c(careerId)}/runways`, { query: { bbox: bbox.join(',') }, schema: z.array(RunwayDto) }),
};

export const personnelApi = {
  list: (careerId: string) => api.get(`${c(careerId)}/personnel`, { schema: z.array(PersonnelDto) }),
  detail: (careerId: string, id: string) =>
    api.get(`${c(careerId)}/personnel/${id}`, { schema: PersonnelDetailDto }),
  quickHire: (careerId: string, body: { roleCode: string; facilityId: string; count: number }) =>
    api.command(`${c(careerId)}/personnel/hire`, body, { schema: z.array(PersonnelDto) }),
  dismiss: (careerId: string, id: string) => api.post<void>(`${c(careerId)}/personnel/${id}/dismiss`),
  rest: (careerId: string, id: string) =>
    api.command(`${c(careerId)}/personnel/${id}/rest`, {}, { schema: PersonnelDto }),
  transfer: (careerId: string, id: string, facilityId: string) =>
    api.command(`${c(careerId)}/personnel/${id}/transfer`, { facilityId }, { schema: PersonnelDto }),
  candidates: (careerId: string) => api.get(`${c(careerId)}/candidates`, { schema: CandidatesResult }),
  hireCandidate: (careerId: string, id: string, facilityId: string) =>
    api.command(`${c(careerId)}/candidates/${id}/hire`, { facilityId }, { schema: PersonnelDto }),
  teams: (careerId: string) => api.get(`${c(careerId)}/teams`, { schema: z.array(TeamDto) }),
  createTeam: (careerId: string, body: { name: string; facilityId: string; departmentId?: string | null }) =>
    api.post(`${c(careerId)}/teams`, body, { schema: TeamDto }),
  updateTeam: (careerId: string, id: string, body: { name?: string; departmentId?: string | null }) =>
    api.patch(`${c(careerId)}/teams/${id}`, body, { schema: TeamDto }),
  setTeamMembers: (careerId: string, id: string, body: { memberIds: string[]; leaderId?: string | null }) =>
    api.put(`${c(careerId)}/teams/${id}/members`, body, { schema: TeamDto }),
  setTeamVehicle: (careerId: string, id: string, vehicleId: string | null) =>
    api.put(`${c(careerId)}/teams/${id}/vehicle`, { vehicleId }, { schema: TeamDto }),
  departments: (careerId: string) =>
    api.get(`${c(careerId)}/departments`, { schema: z.array(DepartmentDto) }),
  createDepartment: (careerId: string, body: { name: string; family: string; facilityId: string }) =>
    api.post(`${c(careerId)}/departments`, body, { schema: DepartmentDto }),
  training: (careerId: string) => api.get(`${c(careerId)}/training/courses`, { schema: TrainingOverview }),
  enroll: (careerId: string, body: { courseCode: string; personnelIds: string[] }) =>
    api.command(`${c(careerId)}/training/enroll`, body, { schema: z.array(EnrollmentDto) }),
  cancelEnrollment: (careerId: string, id: string) =>
    api.post(`${c(careerId)}/training/${id}/cancel`, {}, { schema: EnrollmentDto }),
};
export type { CourseDto };

export const medicalApi = {
  patients: (careerId: string, incidentId: string) =>
    api.get(`${c(careerId)}/incidents/${incidentId}/patients`, { schema: z.array(PatientDto) }),
  patient: (careerId: string, id: string) => api.get(`${c(careerId)}/patients/${id}`, { schema: PatientDto }),
  hospitalOptions: (careerId: string, patientId: string) =>
    api.get(`${c(careerId)}/patients/${patientId}/hospital-options`, { schema: z.array(HospitalOption) }),
  /** A multi-patient vehicle (EMS_MAXI) boards `withPatientIds` too (omitted = the server's own pick, `[]` = alone). */
  transport: (
    careerId: string,
    patientId: string,
    body: { hospitalId: string; vehicleId?: string; withPatientIds?: string[] },
  ) =>
    api.command(`${c(careerId)}/patients/${patientId}/transport`, body, { schema: TransportPatientResult }),
  hospitals: (careerId: string) => api.get(`${c(careerId)}/hospitals`, { schema: z.array(HospitalDto) }),
};

/** Where a water bomber refills: the nearest source is used automatically, this is only for the manual choice. */
export const waterApi = {
  sources: (careerId: string, incidentId: string) =>
    api.get(`${c(careerId)}/incidents/${incidentId}/water-sources`, { schema: WaterSourcesResult }),
  choose: (careerId: string, incidentId: string, waterSourceId: string) =>
    api.command(
      `${c(careerId)}/incidents/${incidentId}/water-source`,
      { waterSourceId },
      { schema: WaterSourcesResult },
    ),
};

export const logisticsApi = {
  inventory: (careerId: string) => api.get(`${c(careerId)}/inventory`, { schema: InventoryOverview }),
  items: (careerId: string) => api.get(`${c(careerId)}/inventory/items`, { schema: z.array(ItemTypeDto) }),
  order: (
    careerId: string,
    body: { facilityId: string; lines: { itemCode: string; quantity: number }[]; urgent: boolean },
  ) => api.command(`${c(careerId)}/inventory/orders`, body, { schema: OrderDto }),
  maintenance: (careerId: string) => api.get(`${c(careerId)}/maintenance`, { schema: MaintenanceOverview }),
  startMaintenance: (careerId: string, vehicleId: string, kind: 'SERVICE') =>
    api.command(
      `${c(careerId)}/vehicles/${vehicleId}/maintenance`,
      { kind },
      { schema: MaintenanceOrderDto },
    ),
  startRepair: (careerId: string, vehicleId: string, kind: 'REPAIR' | 'FREE_EMERGENCY_REPAIR') =>
    api.command(`${c(careerId)}/vehicles/${vehicleId}/repair`, { kind }, { schema: MaintenanceOrderDto }),
  vehicleHistory: (careerId: string, vehicleId: string) =>
    api.get(`${c(careerId)}/vehicles/${vehicleId}/history`, { schema: z.array(VehicleHistoryEntry) }),
};
export type { InventoryLineDto, MaintenanceStatusDto };

export const worldApi = {
  world: (careerId: string) => api.get(`${c(careerId)}/world`, { schema: WorldContextDto }),
  coverage: (careerId: string) => api.get(`${c(careerId)}/coverage`, { schema: CoverageDto }),
  stipend: (careerId: string) => api.get(`${c(careerId)}/economy/stipend`, { schema: StipendDto }),
  milestones: (careerId: string) =>
    api.get(`${c(careerId)}/progression/milestones`, { schema: z.array(MilestoneDto) }),
};

export const monetizationApi = {
  packages: (careerId: string) =>
    api.get(`${c(careerId)}/shop/packages`, { schema: z.array(CreditPackageDto) }),
  checkout: (careerId: string, packageId: string) =>
    api.command(
      `${c(careerId)}/shop/checkout`,
      { packageId, withdrawalWaiverAccepted: true },
      { schema: CheckoutResult },
    ),
  purchases: (careerId: string) => api.get(`${c(careerId)}/shop/purchases`, { schema: z.array(PurchaseDto) }),
  savedPaymentMethod: (careerId: string) =>
    api.get(`${c(careerId)}/shop/payment-method`, { schema: SavedPaymentMethodDto }),
  saveCard: (careerId: string) =>
    api.command(`${c(careerId)}/shop/payment-method`, {}, { schema: SaveCardResult }),
  removeSavedCard: (careerId: string) => api.delete(`${c(careerId)}/shop/payment-method`),
  checkoutSaved: (careerId: string, packageId: string) =>
    api.command(
      `${c(careerId)}/shop/checkout-saved`,
      { packageId, withdrawalWaiverAccepted: true },
      { schema: ChargeSavedCardResult },
    ),
  /** Quote = GET with the same target query; buy = ★POST. */
  speedupQuote: (careerId: string, target: Target, targetId: string) =>
    api.get(`${c(careerId)}/speedups/quote`, { query: { target, targetId }, schema: SpeedupQuote }),
  speedup: (careerId: string, target: Target, targetId: string) =>
    api.command(`${c(careerId)}/speedups`, { target, targetId }, { schema: SpeedupResult }),
  adsStatus: (careerId: string) => api.get(`${c(careerId)}/ads/status`, { schema: AdsStatusDto }),
  adStart: (careerId: string) => api.command(`${c(careerId)}/ads/start`, {}, { schema: AdStartResult }),
  adComplete: (careerId: string, body: { adToken: string; providerProof?: string }) =>
    api.command(`${c(careerId)}/ads/complete`, body, { schema: AdCompleteResult }),
  referrals: (careerId: string) => api.get(`${c(careerId)}/referrals`, { schema: ReferralDto }),
  publicInvite: (code: string) =>
    api.get(`/public/invite/${encodeURIComponent(code)}`, { schema: PublicInviteDto, auth: false }),
};

export const platformApi = {
  notifications: (careerId: string) =>
    api.get(`${c(careerId)}/notifications`, { schema: z.array(NotificationDto) }),
  readNotification: (careerId: string, id: string) =>
    api.post<void>(`${c(careerId)}/notifications/${id}/read`),
  readAllNotifications: (careerId: string) => api.post<void>(`${c(careerId)}/notifications/read-all`),
  /** Product analytics: batched, no PII (contract `AnalyticsEventBody`). */
  analytics: (
    events: { name: string; at: string; props?: Record<string, string | number | boolean | null> }[],
  ) => api.post<void>('/analytics/events', { events }),
};
