import type {
  IncidentDto,
  MajorGroupDto,
  MajorIncidentDto,
  MajorIncidentRefDto,
  MajorSectorDto,
} from '@/contracts';
import { INCIDENT_ID, incident } from './fixtures';

/** Test data of a major incident (D-24): a main scene and one linked incident, contract-typed. */
export const MAJOR_ID = 'mjr_01J8Z0000000000000000000AA';
export const SUB_ID = 'inc_01J8Z0000000000000000000BB';
export const CENTER: [number, number] = [14.22, 42.465];
const T0 = '2026-01-01T10:00:00.000Z';

export const majorRef = (patch: Partial<MajorIncidentRefDto> = {}): MajorIncidentRefDto => ({
  id: MAJOR_ID,
  scenarioCode: 'MAJ_RESIDENTIAL_FIRE',
  title: { key: 'major.scenario.MAJ_RESIDENTIAL_FIRE.title', params: { fallback: 'Incendio residenziale' } },
  role: 'MAIN',
  phase: 'ALARM',
  mainIncidentId: INCIDENT_ID,
  sector: 0,
  center: CENTER,
  areaRadiusMeters: 350,
  ...patch,
});

/** The main scene (sector 0) and a linked incident (sector 1), as the snapshot carries them. */
export const mainScene = (patch: Partial<IncidentDto> = {}): IncidentDto =>
  incident({
    position: CENTER,
    severity: 6,
    families: ['FIRE', 'EMS', 'POLICE'],
    requirements: [
      {
        capability: 'FIRE_SUPPRESSION',
        level: 'REQUIRED',
        required: 200,
        onScene: 100,
        enRoute: 50,
        family: 'FIRE',
      },
      {
        capability: 'WATER_SUPPLY',
        level: 'REQUIRED',
        required: 100,
        onScene: 100,
        enRoute: 0,
        family: 'FIRE',
      },
      { capability: 'MEDICAL_BASIC', level: 'REQUIRED', required: 80, onScene: 0, enRoute: 0, family: 'EMS' },
      {
        capability: 'SCENE_SECURITY',
        level: 'RECOMMENDED',
        required: 70,
        onScene: 0,
        enRoute: 0,
        family: 'POLICE',
      },
    ],
    major: majorRef(),
    ...patch,
  });
export const linkedIncident = (patch: Partial<IncidentDto> = {}): IncidentDto =>
  incident({
    id: SUB_ID,
    position: [14.225, 42.468],
    severity: 3,
    requirements: [
      {
        capability: 'FIRE_SUPPRESSION',
        level: 'REQUIRED',
        required: 50,
        onScene: 0,
        enRoute: 0,
        family: 'FIRE',
      },
    ],
    major: majorRef({ role: 'SUB', sector: 1 }),
    ...patch,
  });

const group = (patch: Partial<MajorGroupDto> = {}): MajorGroupDto => ({
  family: 'FIRE',
  required: 350,
  onScene: 200,
  enRoute: 50,
  reinforced: 0,
  coverage: 0.75,
  capabilities: [],
  ...patch,
});

const sector = (patch: Partial<MajorSectorDto> = {}): MajorSectorDto => ({
  incidentId: INCIDENT_ID,
  role: 'MAIN',
  cause: 'INITIAL',
  phase: 'ALARM',
  sector: 0,
  templateCode: 'FIRE_BUILDING',
  title: { key: 'incidents.FIRE_BUILDING.title', params: { fallback: 'Incendio edificio' } },
  status: 'PENDING_RESPONSE',
  severity: 6,
  position: CENTER,
  distanceMeters: 0,
  families: ['FIRE', 'EMS', 'POLICE'],
  coverageRatio: 0.4,
  assignedVehicleIds: [],
  groups: [group()],
  ...patch,
});

export const majorDto = (patch: Partial<MajorIncidentDto> = {}): MajorIncidentDto => ({
  id: MAJOR_ID,
  scenarioCode: 'MAJ_RESIDENTIAL_FIRE',
  title: { key: 'major.scenario.MAJ_RESIDENTIAL_FIRE.title', params: { fallback: 'Incendio residenziale' } },
  description: {
    key: 'major.scenario.MAJ_RESIDENTIAL_FIRE.description',
    params: { fallback: 'Fumo nelle scale' },
  },
  alert: {
    key: 'major.scenario.MAJ_RESIDENTIAL_FIRE.alert',
    params: { address: 'Via Roma', fallback: 'MAXI-EMERGENZA — Incendio residenziale, Via Roma' },
  },
  icon: 'major-residential-fire',
  status: 'ACTIVE',
  outcome: null,
  phase: 'ALARM',
  phaseStartedAt: T0,
  phases: [
    { phase: 'ALARM', reached: true, at: T0 },
    { phase: 'CONTAINMENT', reached: false, at: null },
    { phase: 'RESCUE', reached: false, at: null },
    { phase: 'SECURING', reached: false, at: null },
  ],
  progress: 0,
  center: CENTER,
  areaRadiusMeters: 350,
  address: 'Via Roma, Pescara',
  municipality: 'Pescara',
  mainIncidentId: INCIDENT_ID,
  severity: 6,
  severityBoosted: false,
  fleet: { operational: 11, targetVehicles: 18 },
  trigger: { weather: null, event: null },
  growth: { level: 0, max: 3, nextCheckAt: null },
  sectors: [
    sector(),
    sector({
      incidentId: SUB_ID,
      role: 'SUB',
      cause: 'PHASE',
      sector: 1,
      severity: 3,
      distanceMeters: 420,
      families: ['FIRE'],
      coverageRatio: 0,
    }),
  ],
  groups: [group()],
  reinforcements: {
    quote: {
      available: true,
      blockedReason: null,
      coverageShare: 0.4,
      rewardReductionShare: 0.32,
      etaSeconds: 300,
      priority: false,
      families: ['FIRE', 'EMS'],
      capabilities: [{ capability: 'FIRE_SUPPRESSION', value: 120 }],
    },
    requests: [],
    reinforcedShare: 0,
  },
  reward: {
    estimated: { min: '350', max: '840' },
    credits: null,
    xp: null,
    reputationDelta: null,
    medal: null,
    quality: null,
    notes: [],
  },
  startedAt: T0,
  endedAt: null,
  ...patch,
});
