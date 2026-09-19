import type { IncidentDto, RealtimeEnvelope, RealtimeEventType, SyncSnapshot, VehicleDto } from '@/contracts';

export const CAREER_ID = 'car_01J8Z0000000000000000000AA';
export const FACILITY_ID = 'fac_01J8Z0000000000000000000AA';
export const VEHICLE_ID = 'veh_01J8Z0000000000000000000AA';
export const INCIDENT_ID = 'inc_01J8Z0000000000000000000AA';
const T0 = '2026-01-01T10:00:00.000Z';

export const vehicle = (patch: Partial<VehicleDto> = {}): VehicleDto => ({
  id: VEHICLE_ID,
  typeCode: 'FIRE_APS',
  family: 'FIRE',
  callSign: 'APS 1',
  facilityId: FACILITY_ID,
  status: 'AVAILABLE',
  position: [14.21, 42.46],
  movement: null,
  incidentId: null,
  capabilities: [{ code: 'FIRE_SUPPRESSION', value: 75 }],
  health: 100,
  healthBand: 'EXCELLENT',
  crew: { min: 3, optimal: 5, assigned: 5 },
  busyUntil: null,
  ...patch,
});

export const incident = (patch: Partial<IncidentDto> = {}): IncidentDto => ({
  id: INCIDENT_ID,
  templateCode: 'CAR_FIRE',
  category: 'fire_vehicle',
  families: ['FIRE'],
  title: { key: 'incidents.CAR_FIRE.title' },
  report: { key: 'incidents.CAR_FIRE.report', params: { address: 'Via Roma' } },
  address: 'Via Roma',
  position: [14.22, 42.465],
  status: 'PENDING_RESPONSE',
  severity: 3,
  escalating: false,
  createdAt: T0,
  expiresAt: null,
  nextEscalationAt: null,
  work: { total: 60, remaining: 60, ratePerSecond: 0, anchorAt: T0, estimatedEndAt: null },
  coverageRatio: 0,
  requirements: [{ capability: 'FIRE_SUPPRESSION', level: 'REQUIRED', required: 60, onScene: 0, enRoute: 0 }],
  assignedVehicleIds: [],
  patientCount: 0,
  estimatedReward: { min: '40', max: '96' },
  isTutorial: false,
  ...patch,
});

export const snapshot = (patch: Partial<SyncSnapshot> = {}): SyncSnapshot => ({
  seq: 10,
  career: {
    id: CAREER_ID,
    directorName: 'Test',
    locationId: 'IT-068028',
    locationName: 'Pescara',
    timezone: 'Europe/Rome',
    center: [14.21, 42.46],
    bounds: [14.1, 42.4, 14.3, 42.5],
    onDuty: true,
    level: 1,
    xp: '0',
    xpForCurrentLevel: '0',
    xpForNextLevel: '100',
    reputation: 50,
    credits: '400',
    coveragePct: 70,
    unlockedFamilies: ['FIRE'],
    tutorial: { completed: true, step: null },
    createdAt: T0,
  },
  facilities: [],
  vehicles: [vehicle()],
  incidents: [],
  world: {
    localTime: T0,
    timezone: 'Europe/Rome',
    dayPhase: 'DAY',
    weather: { code: 'CLEAR', temperatureC: 20, windKmh: 5, degraded: false },
    trafficLevel: 'LIGHT',
    closures: [],
  },
  pendingOutcomes: [],
  unreadNotifications: 0,
  featureFlags: {},
  configVersion: 'test',
  ...patch,
});

export const envelope = (
  type: RealtimeEventType,
  seq: number,
  payload: Record<string, unknown>,
): RealtimeEnvelope => ({ type, v: 1, careerId: CAREER_ID, seq, occurredAt: T0, serverTime: T0, payload });
