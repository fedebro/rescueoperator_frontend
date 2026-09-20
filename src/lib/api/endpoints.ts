import { z } from 'zod';
import {
  AuthResult,
  AwayReport,
  BalanceDto,
  CareerSummary,
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
  OtpRequestResult,
  SessionDto,
  StarterSite,
  SyncSnapshot,
  UserDto,
  VehicleDto,
  type SupportedLocale,
} from '@/contracts';
import { api } from './client';
import { NotificationDto, StipendDto } from '@/contracts';
import { DispatchOptionsResultV2 } from './assumed';

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
  logout: () => api.post<void>('/auth/logout'),
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
  recallVehicle: (careerId: string, vehicleId: string) =>
    api.command(`${c(careerId)}/vehicles/${vehicleId}/recall`, {}, { schema: VehicleDto }),
  incident: (careerId: string, id: string) =>
    api.get(`${c(careerId)}/incidents/${id}`, { schema: IncidentDto }),
  dispatchOptions: (careerId: string, incidentId: string) =>
    api.get(`${c(careerId)}/incidents/${incidentId}/dispatch-options`, { schema: DispatchOptionsResultV2 }),
  dispatch: (careerId: string, incidentId: string, vehicleIds: string[]) =>
    api.command(
      `${c(careerId)}/incidents/${incidentId}/dispatch`,
      { vehicleIds },
      { schema: DispatchResultDto },
    ),
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
