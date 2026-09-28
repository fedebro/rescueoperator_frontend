import { z } from 'zod';
import {
  AuthResult,
  AwayReport,
  BalanceDto,
  CancelDispatchResult,
  CareerSummary,
  ChainVehicleResult,
  DispatchResultDto,
  FacilityDetailDto,
  ProgressionDto,
  TimelineEntryDto,
  UnlockDto,
  CatalogDto,
  FacilityDto,
  IncidentDto,
  IncidentOutcomeDto,
  LedgerEntryDto,
  LocationSummary,
  type LogoutBody,
  OtpRequestResult,
  ResupplyVehicleResult,
  SessionDto,
  StarterSite,
  SyncSnapshot,
  UserDto,
  VehicleDto,
  type SupportedLocale,
} from '@/contracts';
import { api } from './client';
import { DispatchOptionsResult, NotificationDto, StipendDto, SyncDelta } from '@/contracts';

const c = (careerId: string) => `/careers/${careerId}`;

export const authApi = {
  requestOtp: (body: { email: string; locale?: SupportedLocale }) =>
    api.post('/auth/otp/request', body, { schema: OtpRequestResult, auth: false }),
  verifyOtp: (body: {
    challengeId: string;
    code: string;
    directorName?: string;
    acceptTerms?: boolean;
    confirmAge?: boolean;
    marketingConsent?: boolean;
  }) => api.post('/auth/otp/verify', body, { schema: AuthResult, auth: false }),
  /** `pushEndpoint`: this device's push subscription, dropped server-side together with the session (D-98). */
  logout: (body?: z.infer<typeof LogoutBody>) => api.post<void>('/auth/logout', body),
  me: () => api.get('/me', { schema: UserDto }),
  updateMe: (body: { directorName?: string; locale?: SupportedLocale; marketingConsent?: boolean }) =>
    api.patch('/me', body, { schema: UserDto }),
  sessions: () => api.get('/me/sessions', { schema: z.array(SessionDto) }),
  revokeSession: (id: string) => api.delete(`/me/sessions/${id}`),
  requestDeletion: () => api.post<void>('/me/delete-request'),
};

export const onboardingApi = {
  searchLocations: (q: string, signal?: AbortSignal) =>
    api.get('/locations/search', { query: { q }, schema: z.array(LocationSummary), signal }),
  location: (id: string) => api.get(`/locations/${encodeURIComponent(id)}`, { schema: LocationSummary }),
  starterSites: (id: string) =>
    api.get(`/locations/${encodeURIComponent(id)}/starter-sites`, { schema: z.array(StarterSite) }),
  createCareer: (body: { locationId: string; siteId: string }) =>
    api.command('/careers', body, { schema: CareerSummary }),
  myCareers: () => api.get('/careers', { schema: z.array(CareerSummary) }),
};

export const gameApi = {
  sync: (careerId: string) => api.get(`${c(careerId)}/sync`, { schema: SyncSnapshot }),
  /** Events missed since `seq`; `resyncRequired` means the gap is too large and `snapshot` carries the full state. */
  syncSince: (careerId: string, since: number) =>
    api.get(`${c(careerId)}/sync`, { query: { since }, schema: SyncDelta }),
  awayReport: (careerId: string) => api.get(`${c(careerId)}/away-report`, { schema: AwayReport.nullable() }),
  ackAwayReport: (careerId: string) => api.post<void>(`${c(careerId)}/away-report/ack`),
  setDuty: (careerId: string, onDuty: boolean) =>
    api.patch(`${c(careerId)}/duty`, { onDuty }, { schema: CareerSummary }),
  catalog: (careerId: string) => api.get(`${c(careerId)}/catalog`, { schema: CatalogDto }),
  facility: (careerId: string, id: string) =>
    api.get(`${c(careerId)}/facilities/${id}`, { schema: FacilityDetailDto }),
  buyUpgrade: (careerId: string, facilityId: string, upgradeCode: string) =>
    api.command(`${c(careerId)}/facilities/${facilityId}/upgrades`, { upgradeCode }, { schema: FacilityDto }),
  buyVehicle: (careerId: string, body: { vehicleTypeCode: string; facilityId: string }) =>
    api.command(`${c(careerId)}/shop/vehicles`, body, { schema: VehicleDto }),
  /** The fleet as read now: every vehicle with its read-model fields (the autonomy block is computed on read, D-22). */
  vehicles: (careerId: string) => api.get(`${c(careerId)}/vehicles`, { schema: z.array(VehicleDto) }),
  recallVehicle: (careerId: string, vehicleId: string) =>
    api.command(`${c(careerId)}/vehicles/${vehicleId}/recall`, {}, { schema: VehicleDto }),
  /** Redirects the vehicle now if it's RETURNING and eligible, otherwise queues the incident as its next assignment. */
  chainVehicle: (careerId: string, vehicleId: string, incidentId: string) =>
    api.command(`${c(careerId)}/vehicles/${vehicleId}/chain`, { incidentId }, { schema: ChainVehicleResult }),
  cancelChain: (careerId: string, vehicleId: string) =>
    api.post(`${c(careerId)}/vehicles/${vehicleId}/chain/cancel`, {}, { schema: VehicleDto }),
  /** Manual "return to resupply" (D-22 §3.4): at base now, on the way home at the arrival, patrolling at the next hop. */
  resupplyVehicle: (careerId: string, vehicleId: string) =>
    api.command(`${c(careerId)}/vehicles/${vehicleId}/resupply`, {}, { schema: ResupplyVehicleResult }),
  incident: (careerId: string, id: string) =>
    api.get(`${c(careerId)}/incidents/${id}`, { schema: IncidentDto }),
  dispatchOptions: (careerId: string, incidentId: string) =>
    api.get(`${c(careerId)}/incidents/${incidentId}/dispatch-options`, { schema: DispatchOptionsResult }),
  dispatch: (careerId: string, incidentId: string, vehicleIds: string[]) =>
    api.command(
      `${c(careerId)}/incidents/${incidentId}/dispatch`,
      { vehicleIds },
      { schema: DispatchResultDto },
    ),
  /**
   * ★ The free undo of a dispatch (the quick dispatch's "Annulla"): within `cancellableUntil`, while every vehicle is still
   * at its origin. 409 CANCEL_WINDOW_EXPIRED / DISPATCH_NOT_CANCELLABLE (→ recall instead), 404 unknown dispatch.
   */
  cancelDispatch: (careerId: string, dispatchId: string) =>
    api.command(`${c(careerId)}/dispatches/${dispatchId}/cancel`, {}, { schema: CancelDispatchResult }),
  timeline: (careerId: string, incidentId: string) =>
    api.get(`${c(careerId)}/incidents/${incidentId}/timeline`, { schema: z.array(TimelineEntryDto) }),
  unseenOutcomes: (careerId: string) =>
    api.get(`${c(careerId)}/outcomes`, { query: { unseen: 1 }, schema: z.array(IncidentOutcomeDto) }),
  ackOutcome: (careerId: string, incidentId: string) =>
    api.post<void>(`${c(careerId)}/outcomes/${incidentId}/ack`),
  balance: (careerId: string) => api.get(`${c(careerId)}/economy/balance`, { schema: BalanceDto }),
  ledger: (careerId: string, cursor?: string | null) =>
    api.getPage(`${c(careerId)}/economy/ledger`, {
      query: { cursor: cursor ?? undefined, limit: 50 },
      schema: z.array(LedgerEntryDto),
    }),
  stipend: (careerId: string) => api.get(`${c(careerId)}/economy/stipend`, { schema: StipendDto }),
  progression: (careerId: string) => api.get(`${c(careerId)}/progression`, { schema: ProgressionDto }),
  unlocks: (careerId: string) =>
    api.get(`${c(careerId)}/progression/unlocks`, { schema: z.array(UnlockDto) }),
  tutorialAdvance: (careerId: string, step: string) =>
    api.post(`${c(careerId)}/tutorial/advance`, { step }, { schema: CareerSummary }),
  notifications: (careerId: string) =>
    api.get(`${c(careerId)}/notifications`, { schema: z.array(NotificationDto) }),
  readAllNotifications: (careerId: string) => api.post<void>(`${c(careerId)}/notifications/read-all`),
};
