import type { z } from 'zod';
import type {
  HospitalDto as HospitalDtoSchema,
  HospitalLoad as HospitalLoadSchema,
  HospitalOption as HospitalOptionSchema,
  IncidentDto,
  PatientDto,
  VehicleDto,
} from '@/contracts';
import type { LngLat } from '@/lib/geo';
import {
  ECONOMY,
  FACILITY_TYPES,
  FEATURES,
  INCIDENT_TEMPLATES,
  PATIENT_PROFILES,
  VEHICLE_TYPES,
  bandFor,
} from '../data/catalog';
import { MockError, capacitiesFor, iso, text, type MockCareer, type MockEngine } from '../engine';
import { domainState } from './index';

/**
 * Simulation of the `medical` area (analisi/03 §6, Spec 12 reduced): patients are created with the incident, assessed when
 * the first medical-capable vehicle arrives, treated on scene, then either released or transported — one patient per
 * ambulance — to a hospital the player picks (or the recommended one, automatically, after a grace time: D-31 anti-stall).
 * Nothing is tick-driven: stability is an anchored value, every step is a scheduled action whose ref is the PATIENT id
 * (never the incident id: the core cancels every action that references an incident when its work ends).
 */

export type HospitalLoad = z.infer<typeof HospitalLoadSchema>;
export type HospitalDto = z.infer<typeof HospitalDtoSchema>;
export type HospitalOption = z.infer<typeof HospitalOptionSchema>;
/** The bundled catalog carries more fields than the adapter's type declares: the ones used here, all optional. */
type Profile = (typeof PATIENT_PROFILES)[number] & {
  stability: { unstableBelow?: number };
  transport: { escortCapability?: string; escortThreshold?: number };
};
export type PatientOutcome = 'ADMITTED_STABLE' | 'ADMITTED_WORSENED' | 'RELEASED_ON_SCENE' | 'NOT_TREATED';

/* ───────────── hospitals around Pescara (real names and positions; capacities/loads are game values) ───────────── */

export interface MockHospital {
  id: string;
  name: string;
  position: LngLat;
  capabilities: string[];
  hasHelipad: boolean;
  capacity: number;
  /** Beds already taken by the rest of the world: the load never decays below this. */
  baseline: number;
}
const hospitalId = (n: number) => `hos_${`HSP${String(n).padStart(3, '0')}`.padStart(26, '0')}`;
export const HOSPITALS: MockHospital[] = [
  {
    id: hospitalId(1),
    name: 'Ospedale Civile Santo Spirito – Pescara',
    position: [14.2006, 42.4599],
    capabilities: [
      'GENERAL_EMERGENCY',
      'INTENSIVE_CARE',
      'CARDIOLOGY',
      'STROKE_UNIT',
      'TRAUMA_CENTER',
      'PEDIATRICS',
      'OBSTETRICS',
    ],
    hasHelipad: true,
    capacity: 30,
    baseline: 17,
  },
  {
    id: hospitalId(2),
    name: 'Ospedale Clinicizzato SS. Annunziata – Chieti',
    position: [14.1482, 42.3695],
    capabilities: [
      'GENERAL_EMERGENCY',
      'INTENSIVE_CARE',
      'CARDIOLOGY',
      'STROKE_UNIT',
      'PEDIATRICS',
      'OBSTETRICS',
    ],
    hasHelipad: true,
    capacity: 24,
    baseline: 17,
  },
  {
    id: hospitalId(3),
    name: 'Ospedale San Massimo – Penne',
    position: [13.9276, 42.4571],
    capabilities: ['GENERAL_EMERGENCY'],
    hasHelipad: false,
    capacity: 10,
    baseline: 4,
  },
  {
    id: hospitalId(4),
    name: 'Ospedale Santissima Trinità – Popoli',
    position: [13.8312, 42.1722],
    capabilities: ['GENERAL_EMERGENCY', 'INTENSIVE_CARE'],
    hasHelipad: true,
    capacity: 10,
    baseline: 3,
  },
  {
    id: hospitalId(5),
    name: 'Ospedale San Liberatore – Atri',
    position: [13.9788, 42.5786],
    capabilities: ['GENERAL_EMERGENCY', 'CARDIOLOGY'],
    hasHelipad: false,
    capacity: 12,
    baseline: 6,
  },
  {
    id: hospitalId(6),
    name: 'Ospedale Gaetano Bernabeo – Ortona',
    position: [14.4012, 42.3541],
    capabilities: ['GENERAL_EMERGENCY', 'OBSTETRICS'],
    hasHelipad: false,
    capacity: 12,
    baseline: 9,
  },
];

/* ───────────── per-career state ───────────── */

interface Anchor {
  value: number;
  ratePerSecond: number;
  anchorAt: number;
}
export interface MockPatient {
  dto: PatientDto;
  /** The truth, hidden from the DTO until the patient is assessed. */
  profileCode: string;
  transportDrawn: boolean;
  initialStability: number;
  stability: Anchor;
  treatedByPlayer: boolean;
  stabilized: boolean;
  /** Handed to an external (system) ambulance by the anti-stall rule. */
  external: boolean;
  outcome: PatientOutcome | null;
}
export interface MedicalState {
  patients: MockPatient[];
  /** Admissions on top of the baseline, decaying over time (anchored like everything else). */
  load: Record<string, { extra: number; anchorAt: number; forced?: HospitalLoad | null }>;
  config: {
    autoTransportSeconds: number;
    externalSeconds: number;
    alwaysTransport?: boolean;
    /** QA: fixed handoff duration in game seconds (slow e2e machines need a wider AT_HOSPITAL window). */
    handoffSeconds?: number;
  };
  admitted: number;
}
export const medicalState = (career: MockCareer): MedicalState =>
  domainState<MedicalState>(career, 'medical', () => ({
    patients: [],
    load: {},
    // REAL seconds (not compressed): the player needs the same time to read the options whatever the mock speed is.
    config: { autoTransportSeconds: 30, externalSeconds: 45 },
    admitted: 0,
  }));

/* ───────────── pure helpers (unit-tested) ───────────── */

const MEDICAL = ECONOMY.medical as typeof ECONOMY.medical & {
  hospitalLoadDecayPerHour?: number;
  outcomeScore?: Partial<Record<PatientOutcome, number>>;
};
const OUTCOME_SCORE: Record<PatientOutcome, number> = {
  ADMITTED_STABLE: 1.2,
  ADMITTED_WORSENED: 0.8,
  RELEASED_ON_SCENE: 1.1,
  NOT_TREATED: 0.5,
  ...MEDICAL.outcomeScore,
};
const LOAD_DECAY_PER_HOUR = MEDICAL.hospitalLoadDecayPerHour ?? 6;

const MEDICAL_CAPS = ['MEDICAL_BASIC', 'MEDICAL_ADVANCED'];
const TRANSPORT_CAP = 'PATIENT_TRANSPORT';
const FINAL = new Set<PatientDto['status']>(['ADMITTED', 'RELEASED_ON_SCENE', 'DECEASED']);
const ON_SCENE = new Set<PatientDto['status']>([
  'UNASSESSED',
  'ASSESSED',
  'TREATING',
  'STABILIZED',
  'AWAITING_TRANSPORT',
]);
export const isFinal = (p: MockPatient): boolean => FINAL.has(p.dto.status);
/** Deceased is disabled (D-31, economy.medical.deceasedEnabled=false): stability never reaches zero. */
const STABILITY_FLOOR = 3;
const clampStability = (v: number) => Math.min(100, Math.max(STABILITY_FLOOR, v));

export function stabilityAt(a: Anchor, at: number): number {
  return clampStability(a.value + (a.ratePerSecond * Math.max(0, at - a.anchorAt)) / 1000);
}
export function loadLevel(occupied: number, capacity: number): HospitalLoad {
  const ratio = occupied / Math.max(1, capacity);
  return ratio >= 0.9 ? 'SATURATED' : ratio >= 0.7 ? 'BUSY' : 'NORMAL';
}
const HANDOFF_FACTOR: Record<HospitalLoad, number> = { NORMAL: 1, BUSY: 1.5, SATURATED: 2.5, CLOSED: 4 };
const LOAD_PENALTY: Record<HospitalLoad, number> = { NORMAL: 0, BUSY: 10, SATURATED: 35, CLOSED: 1000 };

export interface OptionInput {
  hospital: MockHospital;
  load: HospitalLoad;
  /** Travel time in game seconds. */
  travelSeconds: number;
}
/**
 * Destination score (Spec 12 §75 reduced): time matters most, the required unit is worth ~10 game minutes of travel,
 * the preferred unit a little more, a loaded emergency department costs. Exactly one open option is recommended.
 */
export function rankHospitals(
  inputs: OptionInput[],
  need: { required: string; preferred: string | null },
  speed: number,
): HospitalOption[] {
  const anyCompatible = inputs.some(
    (i) => i.load !== 'CLOSED' && i.hospital.capabilities.includes(need.required),
  );
  const fastest = Math.min(...inputs.filter((i) => i.load !== 'CLOSED').map((i) => i.travelSeconds));
  const scored = inputs.map((i) => {
    const compatible = i.hospital.capabilities.includes(need.required);
    const preferred = !!need.preferred && i.hospital.capabilities.includes(need.preferred);
    const score =
      100 -
      (i.travelSeconds / 60) * 4 +
      (compatible ? 40 : 0) +
      (compatible && preferred ? 15 : 0) -
      LOAD_PENALTY[i.load];
    const reasons: string[] = [];
    if (i.load === 'CLOSED') reasons.push('CLOSED');
    else {
      if (i.travelSeconds === fastest) reasons.push('CLOSEST');
      if (compatible) reasons.push('SPECIALTY_AVAILABLE');
      else reasons.push(anyCompatible ? 'NOT_COMPATIBLE' : 'NO_SPECIALTY_IN_RANGE');
      if (compatible && preferred) reasons.push('PREFERRED_UNIT');
      if (i.load === 'NORMAL') reasons.push('LOW_LOAD');
      else reasons.push(i.load === 'BUSY' ? 'BUSY' : 'SATURATED');
    }
    return { i, compatible, score: Math.round(score * 10) / 10, reasons };
  });
  const best = [...scored].filter((s) => s.i.load !== 'CLOSED').sort((a, b) => b.score - a.score)[0];
  return scored
    .map((s) => ({
      hospitalId: s.i.hospital.id,
      etaSeconds: Math.round(s.i.travelSeconds / speed),
      compatible: s.compatible,
      load: s.i.load,
      expectedHandoffSeconds: Math.round((MEDICAL.hospitalHandoffSeconds * HANDOFF_FACTOR[s.i.load]) / speed),
      score: s.score,
      recommended: s === best,
      reasons: s.reasons.map((r) => text(`medical.reasons.${r}`)),
    }))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.score - a.score);
}

export function outcomeFactor(patients: MockPatient[], at: number): number | null {
  if (patients.length === 0) return null;
  const scores = OUTCOME_SCORE;
  const total = patients.reduce((sum, p) => {
    if (p.outcome) return sum + scores[p.outcome];
    // Not final yet (the reward is paid when the on-scene work ends): project from what is known now.
    if (p.external || p.dto.status === 'UNASSESSED') return sum + scores.NOT_TREATED;
    return sum + (hasWorsened(p, at) ? scores.ADMITTED_WORSENED : 1);
  }, 0);
  return Math.min(1.2, Math.max(0, total / patients.length));
}
const profileOf = (p: MockPatient): Profile =>
  (PATIENT_PROFILES.find((x) => x.code === p.profileCode) ?? PATIENT_PROFILES[0]!) as Profile;
function hasWorsened(p: MockPatient, at: number): boolean {
  const now = stabilityAt(p.stability, at);
  const unstableBelow = profileOf(p).stability.unstableBelow ?? 45;
  return now < p.initialStability - 10 || now < unstableBelow;
}

const TREAT_SECONDS: Record<string, number> = { WHITE: 20, GREEN: 25, BLUE: 35, ORANGE: 45, RED: 55 };

/**
 * Mass-casualty care (major incidents, `depth.medical` defaults of the backend): a FIELD POST (posto medico avanzato,
 * EMS_PMA — medical capability, MASS_CASUALTY ≥ `minMassCasualty`, transports nobody) treats faster on scene and releases
 * the lighter triage codes there instead of sending them to hospital. The multi-patient vehicle (EMS_MAXI, tag
 * MULTI_PATIENT, `patientCapacity` 4) carries several patients of the same incident to one hospital in one trip.
 */
export const FIELD_POST = {
  minMassCasualty: 50,
  treatmentSlots: 4,
  speedBonus: 0.25,
  releaseTriage: ['GREEN', 'WHITE', 'BLUE'],
} as const;
const TRIAGE_RANK: Record<string, number> = { RED: 0, ORANGE: 1, BLUE: 2, GREEN: 3, WHITE: 4 };
/** Patients a vehicle carries at once (`patientCapacity`; 0 / NO_TRANSPORT = none, a normal ambulance = 1). */
export const patientCapacityOf = (typeCode: string): number => {
  const type = VEHICLE_TYPES.find((t) => t.code === typeCode);
  if (!type || type.tags.includes('NO_TRANSPORT')) return 0;
  return Math.max(1, type.patientCapacity);
};
export const isFieldPost = (vehicle: Pick<VehicleDto, 'capabilities'>): boolean => {
  const value = (code: string) => vehicle.capabilities.find((c) => c.code === code)?.value ?? 0;
  return (
    (value('MEDICAL_BASIC') > 0 || value('MEDICAL_ADVANCED') > 0) &&
    value('MASS_CASUALTY') >= FIELD_POST.minMassCasualty &&
    value('PATIENT_TRANSPORT') <= 0
  );
};
const ASSESS_SECONDS = 8;
const PACKAGING_SECONDS = 6;
const EXTERNAL_ARRIVAL_SECONDS = 40;

/* ───────────── install ───────────── */

export function installMedical(engine: MockEngine): void {
  const capsOf = (vehicles: VehicleDto[]) => (code: string) =>
    vehicles.reduce((s, v) => s + (v.capabilities.find((c) => c.code === code)?.value ?? 0), 0);
  const onSceneVehicles = (career: MockCareer, incidentId: string) =>
    career.vehicles.filter((v) => v.incidentId === incidentId && v.status === 'ON_SCENE');
  const hasCap = (v: VehicleDto, codes: string[]) =>
    v.capabilities.some((c) => codes.includes(c.code) && c.value > 0);
  const patientsOf = (career: MockCareer, incidentId: string) =>
    medicalState(career).patients.filter((p) => p.dto.incidentId === incidentId);
  const scheduleAt = (career: MockCareer, type: string, dueAt: number, ref: string) => {
    career.actions.push({ id: engine.id('act'), type, dueAt, ref });
  };
  const pending = (career: MockCareer, type: string, ref: string) =>
    career.actions.some((a) => a.type === type && a.ref === ref);
  const ratePerRealSecond = (decayPerMinute: number) => -(decayPerMinute / 60) * engine.speed;

  /* ── hospitals ── */
  const extraOf = (career: MockCareer, h: MockHospital, at: number): number => {
    const row = medicalState(career).load[h.id];
    const decayPerSecond = (LOAD_DECAY_PER_HOUR / 3600) * engine.speed;
    return row ? Math.max(0, row.extra - (decayPerSecond * Math.max(0, at - row.anchorAt)) / 1000) : 0;
  };
  const occupancy = (career: MockCareer, h: MockHospital, at: number): number => {
    const state = medicalState(career);
    const extra = extraOf(career, h, at);
    const incoming = state.patients.filter(
      (p) => p.dto.hospitalId === h.id && (p.dto.status === 'IN_TRANSPORT' || p.dto.status === 'HANDOFF'),
    ).length;
    return h.baseline + extra + incoming;
  };
  const loadOf = (career: MockCareer, h: MockHospital, at: number): HospitalLoad =>
    medicalState(career).load[h.id]?.forced ?? loadLevel(occupancy(career, h, at), h.capacity);
  const hospitalDto = (career: MockCareer, h: MockHospital, at: number): HospitalDto => ({
    id: h.id,
    name: h.name,
    position: h.position,
    capabilities: h.capabilities,
    load: loadOf(career, h, at),
    hasHelipad: h.hasHelipad,
  });
  const admit = (career: MockCareer, h: MockHospital, at: number) => {
    const state = medicalState(career);
    // Settle the decayed admissions, then add this one (re-anchored: no tick).
    state.load[h.id] = {
      extra: extraOf(career, h, at) + 1,
      anchorAt: at,
      forced: state.load[h.id]?.forced ?? null,
    };
    state.admitted += 1;
  };

  const hospitalOptions = (career: MockCareer, patientId: string, at = engine.now()): HospitalOption[] => {
    const p = medicalState(career).patients.find((x) => x.dto.id === patientId);
    if (!p) throw new MockError(404, 'NOT_FOUND', 'Patient not found');
    const incident = career.incidents.find((i) => i.id === p.dto.incidentId);
    const from = incident?.position ?? career.facilities[0]!.position;
    const typeCode =
      onSceneVehicles(career, p.dto.incidentId).find((v) => hasCap(v, [TRANSPORT_CAP]))?.typeCode ??
      'EMS_MSB';
    return rankHospitals(
      HOSPITALS.map((hospital) => {
        const { path, distanceMeters } = engine.route(
          from,
          hospital.position,
          p.dto.id + hospital.id,
          typeCode,
        );
        return {
          hospital,
          load: loadOf(career, hospital, at),
          travelSeconds: engine.travelSeconds(distanceMeters, typeCode, career, path),
        };
      }),
      profileOf(p).hospital,
      engine.speed,
    );
  };

  /* ── patients ── */
  const publish = (p: MockPatient, assessed: boolean) => {
    const profile = profileOf(p);
    p.dto = {
      ...p.dto,
      profileCode: assessed ? p.profileCode : null,
      triage: assessed ? (profile.triage as PatientDto['triage']) : null,
      stability: assessed
        ? {
            value: p.stability.value,
            ratePerSecond: p.stability.ratePerSecond,
            anchorAt: iso(p.stability.anchorAt),
          }
        : null,
      transportRequired: assessed ? p.dto.transportRequired : null,
    };
  };
  const emitPatient = (career: MockCareer, p: MockPatient, extra: Record<string, unknown> = {}) =>
    engine.emit(career, 'patient.updated', { patient: p.dto, ...extra });

  const setRate = (p: MockPatient, rate: number, at: number): boolean => {
    if (Math.abs(p.stability.ratePerSecond - rate) < 1e-9) return false;
    p.stability = { value: stabilityAt(p.stability, at), ratePerSecond: rate, anchorAt: at };
    return true;
  };

  /**
   * Re-evaluates every patient still on scene against the vehicles that are on scene NOW: assessment, needs, stability
   * anchors, pending steps and the auto-transport grace timer. Called on arrivals, after every step, and lazily by the
   * REST reads (a recalled vehicle has no hook).
   */
  const refreshScene = (career: MockCareer, incidentId: string, at: number): void => {
    const state = medicalState(career);
    const vehicles = onSceneVehicles(career, incidentId);
    const sum = capsOf(vehicles);
    const medicalOnScene = MEDICAL_CAPS.some((c) => sum(c) > 0);
    const freeTransport = freeTransportVehicles(career, incidentId);
    for (const p of patientsOf(career, incidentId)) {
      if (!ON_SCENE.has(p.dto.status)) continue;
      const profile = profileOf(p);
      let changed = false;
      if (p.dto.status === 'UNASSESSED' && medicalOnScene) {
        p.dto = {
          ...p.dto,
          status: 'ASSESSED',
          transportRequired: p.transportDrawn,
          busyUntil: iso(at + engine.dur(ASSESS_SECONDS)),
        };
        p.treatedByPlayer = true;
        scheduleAt(career, 'PATIENT_STEP', at + engine.dur(ASSESS_SECONDS), p.dto.id);
        engine.log(career, incidentId, 'patient.updated', text('timeline.patient_assessed'), at);
        changed = true;
      }
      if (p.dto.status === 'TREATING' && !medicalOnScene) {
        // The crew left: treatment is interrupted, the patient waits for the next medical vehicle.
        engine.cancelActions(career, (a) => a.type === 'PATIENT_STEP' && a.ref === p.dto.id);
        p.dto = { ...p.dto, status: 'ASSESSED', busyUntil: null };
        changed = true;
      }
      if (p.dto.status === 'ASSESSED' && medicalOnScene && !pending(career, 'PATIENT_STEP', p.dto.id)) {
        p.dto = { ...p.dto, busyUntil: iso(at + engine.dur(ASSESS_SECONDS)) };
        scheduleAt(career, 'PATIENT_STEP', at + engine.dur(ASSESS_SECONDS), p.dto.id);
        changed = true;
      }
      const assessed = p.dto.status !== 'UNASSESSED';
      const needs = assessed
        ? profile.treatment
            .filter((n) => n.level !== 'OPTIONAL')
            .map((n) => ({ capability: n.capability, met: sum(n.capability) >= n.threshold }))
        : [];
      if (JSON.stringify(needs) !== JSON.stringify(p.dto.needs)) {
        p.dto = { ...p.dto, needs };
        changed = true;
      }
      const requiredMet = requiredNeedsMet(p, sum);
      const s = profile.stability;
      const rate = !medicalOnScene
        ? ratePerRealSecond(s.decayPerMinuteUntreated)
        : p.dto.status === 'TREATING'
          ? ratePerRealSecond(requiredMet ? s.decayPerMinuteTreated : s.decayPerMinuteUntreated * 0.5)
          : p.dto.status === 'STABILIZED' || p.dto.status === 'AWAITING_TRANSPORT'
            ? ratePerRealSecond(p.stabilized ? s.decayPerMinuteInTransport : s.decayPerMinuteUntreated * 0.5)
            : ratePerRealSecond(s.decayPerMinuteUntreated);
      if (setRate(p, rate, at)) changed = true;
      if (
        p.dto.status === 'AWAITING_TRANSPORT' &&
        freeTransport.length > 0 &&
        !pending(career, 'PATIENT_AUTO_TRANSPORT', p.dto.id)
      )
        scheduleAt(career, 'PATIENT_AUTO_TRANSPORT', at + state.config.autoTransportSeconds * 1000, p.dto.id);
      if (changed) {
        publish(p, p.dto.status !== 'UNASSESSED');
        emitPatient(career, p);
      }
    }
  };
  const requiredNeedsMet = (p: MockPatient, sum: (code: string) => number) =>
    profileOf(p)
      .treatment.filter((n) => n.level === 'REQUIRED')
      .every((n) => sum(n.capability) >= n.threshold);

  /** On-scene vehicles that can carry patients (PATIENT_TRANSPORT, a patient capacity, never a NO_TRANSPORT field post). */
  const freeTransportVehicles = (career: MockCareer, incidentId: string): VehicleDto[] =>
    onSceneVehicles(career, incidentId).filter(
      (v) => hasCap(v, [TRANSPORT_CAP]) && patientCapacityOf(v.typeCode) > 0,
    );
  const fieldPostOnScene = (career: MockCareer, incidentId: string): boolean =>
    onSceneVehicles(career, incidentId).some(isFieldPost);

  /** Anti-stall (D-31): if nobody of the player's fleet takes care of a patient, an external ambulance eventually does. */
  const ensureFallback = (career: MockCareer, incidentId: string, at: number) => {
    const seconds = medicalState(career).config.externalSeconds;
    for (const p of patientsOf(career, incidentId))
      if (!isFinal(p) && !pending(career, 'PATIENT_FALLBACK', p.dto.id))
        scheduleAt(career, 'PATIENT_FALLBACK', at + seconds * 1000, p.dto.id);
  };

  /** When nobody is left on scene the retained vehicles go home; when every patient is final the incident may close. */
  const afterPatientMoved = (career: MockCareer, incidentId: string, at: number) => {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident) return;
    const list = patientsOf(career, incidentId);
    if (incident.status === 'RESOLVING' && !list.some((p) => ON_SCENE.has(p.dto.status))) {
      const vehicles = onSceneVehicles(career, incidentId).map((v) =>
        engine.sendHome(career, v, at, incident.position),
      );
      if (vehicles.length) engine.emit(career, 'vehicle.returning', { vehicles });
    }
    if (list.every(isFinal)) engine.checkResolved(career, incidentId, at);
  };

  const finish = (
    career: MockCareer,
    p: MockPatient,
    status: 'ADMITTED' | 'RELEASED_ON_SCENE',
    at: number,
  ) => {
    p.stability = { value: stabilityAt(p.stability, at), ratePerSecond: 0, anchorAt: at };
    p.outcome =
      status === 'RELEASED_ON_SCENE'
        ? 'RELEASED_ON_SCENE'
        : !p.treatedByPlayer
          ? 'NOT_TREATED'
          : hasWorsened(p, at)
            ? 'ADMITTED_WORSENED'
            : 'ADMITTED_STABLE';
    p.dto = { ...p.dto, status, busyUntil: null, assignedVehicleId: null };
    publish(p, true);
  };

  const startTransport = (
    career: MockCareer,
    patientId: string,
    body: { hospitalId: string; vehicleId?: string; withPatientIds?: string[] },
    at: number,
    auto = false,
  ) => {
    const p = medicalState(career).patients.find((x) => x.dto.id === patientId);
    if (!p) throw new MockError(404, 'NOT_FOUND', 'Patient not found');
    if (p.dto.status !== 'AWAITING_TRANSPORT')
      throw new MockError(409, 'INVALID_STATE_TRANSITION', 'Patient is not awaiting transport');
    const incident = career.incidents.find((i) => i.id === p.dto.incidentId);
    const hospital = HOSPITALS.find((h) => h.id === body.hospitalId);
    if (!incident || !hospital) throw new MockError(404, 'NOT_FOUND', 'Hospital not found');
    const options = hospitalOptions(career, patientId, at);
    const option = options.find((o) => o.hospitalId === hospital.id)!;
    if (option.load === 'CLOSED')
      throw new MockError(409, 'HOSPITAL_NOT_COMPATIBLE', 'Hospital is not accepting patients');
    const choiceLevel = FEATURES.find((f) => f.feature === 'HOSPITAL_CHOICE')?.requiredLevel ?? 1;
    if (!option.recommended && career.summary.level < choiceLevel)
      throw new MockError(403, 'NOT_UNLOCKED', 'Manual hospital choice is not unlocked yet', {
        feature: 'HOSPITAL_CHOICE',
        requiredLevel: choiceLevel,
      });
    const free = freeTransportVehicles(career, incident.id);
    const vehicle = body.vehicleId
      ? free.find((v) => v.id === body.vehicleId)
      : // Best escort first: the most advanced medical capability among the free ambulances.
        [...free].sort((a, b) => capsOf([b])('MEDICAL_ADVANCED') - capsOf([a])('MEDICAL_ADVANCED'))[0];
    if (!vehicle)
      throw new MockError(409, 'VEHICLE_NOT_AVAILABLE', 'No on-scene vehicle can transport the patient', {
        vehicleIds: body.vehicleId ? [body.vehicleId] : [],
      });
    const others = coPassengers(
      career,
      p,
      hospital,
      patientCapacityOf(vehicle.typeCode),
      body.withPatientIds,
    );
    const { path, distanceMeters } = engine.route(
      incident.position,
      hospital.position,
      vehicle.id + hospital.id,
      vehicle.typeCode,
    );
    const arriveAt = at + engine.dur(engine.travelSeconds(distanceMeters, vehicle.typeCode, career, path));
    for (const passenger of [p, ...others]) board(career, passenger, vehicle, hospital, arriveAt, at);
    const moving = engine.patchVehicle(career, vehicle.id, {
      status: 'TRANSPORTING',
      position: incident.position,
      busyUntil: iso(arriveAt),
      movement: { path, departAt: iso(at), arriveAt: iso(arriveAt), distanceMeters, purpose: 'TO_HOSPITAL' },
    })!;
    engine.log(
      career,
      incident.id,
      'patient.transport_started',
      others.length > 0
        ? text('timeline.patient_transport_multi', {
            callSign: vehicle.callSign,
            hospital: hospital.name,
            count: others.length + 1,
          })
        : text(auto ? 'timeline.patient_transport_auto' : 'timeline.patient_transport', {
            callSign: vehicle.callSign,
            hospital: hospital.name,
          }),
      at,
      vehicle.id,
    );
    const next = engine.recompute(career, incident.id, at) ?? incident;
    for (const other of others) emitPatient(career, other);
    emitPatient(career, p, { vehicle: moving, incident: next });
    refreshScene(career, incident.id, at);
    afterPatientMoved(career, incident.id, at);
    return {
      patient: p.dto,
      vehicle: moving,
      incident: career.incidents.find((i) => i.id === incident.id),
      boarded: others.map((o) => o.dto),
    };
  };

  /**
   * Who else rides a multi-patient vehicle (the backend's `coPassengers`): the listed ids (same incident, transportable, this
   * hospital can take them, within the capacity) or — list omitted — the other patients waiting for transport that this
   * hospital can take, worst triage first. A normal ambulance with a non-empty list: 409 SINGLE_PATIENT_VEHICLE.
   */
  const coPassengers = (
    career: MockCareer,
    primary: MockPatient,
    hospital: MockHospital,
    capacity: number,
    requested: string[] | undefined,
  ): MockPatient[] => {
    const wanted = [...new Set(requested ?? [])];
    if (capacity <= 1) {
      if (wanted.length > 0)
        throw new MockError(409, 'CONFLICT', 'This vehicle carries one patient at a time', {
          reason: 'SINGLE_PATIENT_VEHICLE',
        });
      return [];
    }
    const fits = (x: MockPatient) => hospital.capabilities.includes(profileOf(x).hospital.required);
    const sameIncident = patientsOf(career, primary.dto.incidentId).filter((x) => x !== primary);
    if (requested !== undefined) {
      if (wanted.length > capacity - 1)
        throw new MockError(400, 'VALIDATION_ERROR', `This vehicle carries ${capacity} patients at most`, {
          capacity,
        });
      return wanted.map((id) => {
        const other = sameIncident.find((x) => x.dto.id === id);
        if (!other) throw new MockError(404, 'NOT_FOUND', 'Patient not found');
        if (
          !['ASSESSED', 'TREATING', 'AWAITING_TRANSPORT'].includes(other.dto.status) ||
          !other.dto.transportRequired
        )
          throw new MockError(409, 'CONFLICT', 'This patient cannot be moved right now', {
            reason: 'PATIENT_NOT_TRANSPORTABLE',
          });
        if (!fits(other))
          throw new MockError(
            409,
            'HOSPITAL_NOT_COMPATIBLE',
            'This hospital cannot treat one of the patients',
            {
              patientId: id,
            },
          );
        return other;
      });
    }
    return sameIncident
      .filter((x) => x.dto.status === 'AWAITING_TRANSPORT' && x.dto.transportRequired && fits(x))
      .sort(
        (a, b) =>
          (TRIAGE_RANK[profileOf(a).triage] ?? 9) - (TRIAGE_RANK[profileOf(b).triage] ?? 9) ||
          a.dto.label.localeCompare(b.dto.label),
      )
      .slice(0, capacity - 1);
  };

  /** One patient aboard: in transport with the vehicle, towards the hospital, arriving with it. */
  const board = (
    career: MockCareer,
    p: MockPatient,
    vehicle: VehicleDto,
    hospital: MockHospital,
    arriveAt: number,
    at: number,
  ) => {
    const profile = profileOf(p);
    const escorted =
      capsOf([vehicle])(profile.transport.escortCapability ?? 'MEDICAL_BASIC') >=
      (profile.transport.escortThreshold ?? 0);
    const s = profile.stability;
    setRate(
      p,
      ratePerRealSecond(
        escorted
          ? s.decayPerMinuteInTransport
          : (s.decayPerMinuteInTransport + s.decayPerMinuteUntreated) / 2,
      ),
      at,
    );
    engine.cancelActions(
      career,
      (a) =>
        a.ref === p.dto.id &&
        (a.type === 'PATIENT_AUTO_TRANSPORT' || a.type === 'PATIENT_FALLBACK' || a.type === 'PATIENT_STEP'),
    );
    p.stabilized = p.stabilized || p.dto.status === 'AWAITING_TRANSPORT';
    p.dto = {
      ...p.dto,
      status: 'IN_TRANSPORT',
      transportRequired: true,
      assignedVehicleId: vehicle.id,
      hospitalId: hospital.id,
      busyUntil: iso(arriveAt),
    };
    publish(p, true);
    scheduleAt(career, 'PATIENT_ARRIVE_HOSPITAL', arriveAt, p.dto.id);
  };

  const externalTakeover = (career: MockCareer, p: MockPatient, at: number) => {
    const recommended = hospitalOptions(career, p.dto.id, at).find((o) => o.recommended);
    const hospital = HOSPITALS.find((h) => h.id === recommended?.hospitalId) ?? HOSPITALS[0]!;
    const travel = (recommended?.etaSeconds ?? 60) * engine.speed;
    const arriveAt = at + engine.dur(EXTERNAL_ARRIVAL_SECONDS + travel);
    p.external = true;
    setRate(p, ratePerRealSecond(profileOf(p).stability.decayPerMinuteInTransport), at);
    engine.cancelActions(
      career,
      (a) => a.ref === p.dto.id && ['PATIENT_STEP', 'PATIENT_AUTO_TRANSPORT'].includes(a.type),
    );
    p.dto = {
      ...p.dto,
      status: 'IN_TRANSPORT',
      transportRequired: true,
      assignedVehicleId: null,
      hospitalId: hospital.id,
      busyUntil: iso(arriveAt),
      needs: [],
    };
    publish(p, true);
    scheduleAt(career, 'PATIENT_ARRIVE_HOSPITAL', arriveAt, p.dto.id);
    engine.log(
      career,
      p.dto.incidentId,
      'patient.transport_started',
      text('timeline.patient_external', { hospital: hospital.name }),
      at,
    );
    emitPatient(career, p);
    afterPatientMoved(career, p.dto.incidentId, at);
  };

  /* ── hooks ── */
  engine.hooks.incidentSpawned.push((career, incident) => {
    const template = INCIDENT_TEMPLATES.find((t) => t.code === incident.templateCode);
    const band = template ? bandFor(template, incident.severity).patients : null;
    if (!band || band.count.length === 0 || band.profiles.length === 0) return;
    const draw = <T extends { weight: number }>(rows: T[]): T => {
      let r = engine.random() * rows.reduce((s, x) => s + x.weight, 0);
      return rows.find((x) => (r -= x.weight) <= 0) ?? rows[0]!;
    };
    const count = draw(band.count).n;
    const at = engine.now();
    const state = medicalState(career);
    for (let n = 1; n <= count; n++) {
      const profile =
        PATIENT_PROFILES.find((x) => x.code === draw(band.profiles).profile) ?? PATIENT_PROFILES[0]!;
      const s = profile.stability;
      const initial = Math.round(s.initialMin + engine.random() * (s.initialMax - s.initialMin));
      state.patients.push({
        dto: {
          id: engine.id('pat'),
          incidentId: incident.id,
          label: `Paziente ${n}`,
          profileCode: null,
          triage: null,
          status: 'UNASSESSED',
          stability: null,
          needs: [],
          transportRequired: null,
          assignedVehicleId: null,
          hospitalId: null,
          busyUntil: null,
        },
        profileCode: profile.code,
        // `alwaysTransport` is a QA switch (deterministic e2e): the draw still consumes a random number.
        transportDrawn:
          engine.random() < profile.transport.probability || state.config.alwaysTransport === true,
        initialStability: initial,
        stability: {
          value: initial,
          ratePerSecond: ratePerRealSecond(s.decayPerMinuteUntreated),
          anchorAt: at,
        },
        treatedByPlayer: false,
        stabilized: false,
        external: false,
        outcome: null,
      });
    }
    engine.patchIncident(career, incident.id, { patientCount: count });
  });

  engine.hooks.vehicleArrived.push((career, _vehicle, incident, at) => {
    if (patientsOf(career, incident.id).length === 0) return;
    refreshScene(career, incident.id, at);
    ensureFallback(career, incident.id, at);
  });

  engine.hooks.retainVehicles.push((career, incident) => {
    const list = patientsOf(career, incident.id);
    if (list.every(isFinal)) return [];
    // Only consulted when the on-scene work ends: from now on the incident only waits for its patients.
    ensureFallback(career, incident.id, engine.now());
    const someoneOnScene = list.some((p) => ON_SCENE.has(p.dto.status));
    return career.vehicles
      .filter(
        (v) =>
          v.incidentId === incident.id &&
          (v.status === 'TRANSPORTING' ||
            v.status === 'AT_HOSPITAL' ||
            (someoneOnScene && v.status === 'ON_SCENE' && hasCap(v, [...MEDICAL_CAPS, TRANSPORT_CAP]))),
      )
      .map((v) => v.id);
  });

  engine.hooks.resolvingBlockers.push((career, incident) => !patientsOf(career, incident.id).every(isFinal));

  engine.hooks.patientOutcome.push((career, incident) =>
    outcomeFactor(patientsOf(career, incident.id), engine.now()),
  );

  engine.hooks.incidentClosed.push((career, incident) => {
    const state = medicalState(career);
    // A patient already travelling with one of the player's ambulances completes the trip even if the incident is gone.
    const keep = (p: MockPatient) =>
      p.dto.incidentId !== incident.id ||
      (p.dto.assignedVehicleId !== null && (p.dto.status === 'IN_TRANSPORT' || p.dto.status === 'HANDOFF'));
    const dropped = new Set(state.patients.filter((p) => !keep(p)).map((p) => p.dto.id));
    state.patients = state.patients.filter(keep);
    engine.cancelActions(career, (a) => dropped.has(a.ref));
  });

  /* ── executors ── */
  const patientOf = (career: MockCareer, id: string) =>
    medicalState(career).patients.find((p) => p.dto.id === id);

  engine.registerExecutor('PATIENT_STEP', (career, action) => {
    const p = patientOf(career, action.ref);
    if (!p) return;
    const at = action.dueAt;
    const incidentId = p.dto.incidentId;
    const sum = capsOf(onSceneVehicles(career, incidentId));
    const medicalOnScene = MEDICAL_CAPS.some((c) => sum(c) > 0);
    if (p.dto.status === 'ASSESSED') {
      if (!medicalOnScene) {
        p.dto = { ...p.dto, busyUntil: null };
      } else {
        const profile = profileOf(p);
        const advanced = profile.treatment.some(
          (n) => n.capability === 'MEDICAL_ADVANCED' && sum(n.capability) >= n.threshold,
        );
        // A field post on the scene (EMS_PMA) treats faster (`speedBonus`, mass-casualty care).
        const post = fieldPostOnScene(career, incidentId) ? 1 + FIELD_POST.speedBonus : 1;
        const endsAt = at + engine.dur(((TREAT_SECONDS[profile.triage] ?? 35) * (advanced ? 0.8 : 1)) / post);
        p.dto = { ...p.dto, status: 'TREATING', busyUntil: iso(endsAt) };
        scheduleAt(career, 'PATIENT_STEP', endsAt, p.dto.id);
      }
    } else if (p.dto.status === 'TREATING') {
      if (requiredNeedsMet(p, sum)) {
        p.stabilized = true;
        const endsAt = at + engine.dur(PACKAGING_SECONDS);
        p.dto = { ...p.dto, status: 'STABILIZED', busyUntil: iso(endsAt) };
        scheduleAt(career, 'PATIENT_STEP', endsAt, p.dto.id);
        engine.log(career, incidentId, 'patient.updated', text('timeline.patient_stabilized'), at);
      } else {
        // Load and go: what is on scene cannot stabilise this patient, the hospital can.
        p.dto = { ...p.dto, status: 'AWAITING_TRANSPORT', transportRequired: true, busyUntil: null };
      }
    } else if (p.dto.status === 'STABILIZED') {
      // A field post on scene treats the lighter triage codes definitively: released there, no hospital leg.
      const releasedByPost =
        p.dto.transportRequired === true &&
        (FIELD_POST.releaseTriage as readonly string[]).includes(profileOf(p).triage) &&
        fieldPostOnScene(career, incidentId);
      if (releasedByPost) {
        finish(career, p, 'RELEASED_ON_SCENE', at);
        engine.log(career, incidentId, 'patient.updated', text('timeline.patient_released_field_post'), at);
      } else if (p.dto.transportRequired) p.dto = { ...p.dto, status: 'AWAITING_TRANSPORT', busyUntil: null };
      else {
        finish(career, p, 'RELEASED_ON_SCENE', at);
        engine.log(career, incidentId, 'patient.updated', text('timeline.patient_released'), at);
      }
    } else return;
    if (p.dto.status === 'AWAITING_TRANSPORT') {
      const incident = career.incidents.find((i) => i.id === incidentId);
      engine.notify(career, {
        category: 'OPERATIONS',
        priority: 'IMPORTANT',
        title: text('notifications.patientAwaitingTransport', { address: incident?.address ?? '' }),
        action: { kind: 'OPEN_INCIDENT', targetId: incidentId },
      });
    }
    publish(p, true);
    emitPatient(career, p);
    refreshScene(career, incidentId, at);
    afterPatientMoved(career, incidentId, at);
  });

  engine.registerExecutor('PATIENT_AUTO_TRANSPORT', (career, action) => {
    const p = patientOf(career, action.ref);
    if (!p || p.dto.status !== 'AWAITING_TRANSPORT') return;
    const recommended = hospitalOptions(career, p.dto.id, action.dueAt).find((o) => o.recommended);
    if (!recommended || freeTransportVehicles(career, p.dto.incidentId).length === 0) return;
    startTransport(career, p.dto.id, { hospitalId: recommended.hospitalId }, action.dueAt, true);
  });

  engine.registerExecutor('PATIENT_FALLBACK', (career, action) => {
    const p = patientOf(career, action.ref);
    if (!p || isFinal(p) || !ON_SCENE.has(p.dto.status)) return;
    const at = action.dueAt;
    const helpers = career.vehicles.filter(
      (v) => v.incidentId === p.dto.incidentId && ['PREPARING', 'EN_ROUTE', 'ON_SCENE'].includes(v.status),
    );
    const wanted = p.dto.status === 'AWAITING_TRANSPORT' ? [TRANSPORT_CAP] : MEDICAL_CAPS;
    if (helpers.some((v) => hasCap(v, wanted))) {
      // The player is taking care of it: look again later.
      scheduleAt(
        career,
        'PATIENT_FALLBACK',
        at + medicalState(career).config.externalSeconds * 1000,
        p.dto.id,
      );
      return;
    }
    externalTakeover(career, p, at);
  });

  engine.registerExecutor('PATIENT_ARRIVE_HOSPITAL', (career, action) => {
    const p = patientOf(career, action.ref);
    if (!p || p.dto.status !== 'IN_TRANSPORT') return;
    const at = action.dueAt;
    const hospital = HOSPITALS.find((h) => h.id === p.dto.hospitalId) ?? HOSPITALS[0]!;
    const handoff =
      medicalState(career).config.handoffSeconds ??
      MEDICAL.hospitalHandoffSeconds * HANDOFF_FACTOR[loadOf(career, hospital, at)];
    const endsAt = at + engine.dur(handoff);
    // Stability no longer matters once the patient is inside the emergency department.
    p.stability = { value: stabilityAt(p.stability, at), ratePerSecond: 0, anchorAt: at };
    p.dto = { ...p.dto, status: 'HANDOFF', busyUntil: iso(endsAt) };
    publish(p, true);
    const vehicle = p.dto.assignedVehicleId
      ? engine.patchVehicle(career, p.dto.assignedVehicleId, {
          status: 'AT_HOSPITAL',
          position: hospital.position,
          movement: null,
          busyUntil: iso(endsAt),
        })
      : null;
    scheduleAt(career, 'PATIENT_HANDOFF_DONE', endsAt, p.dto.id);
    emitPatient(career, p, vehicle ? { vehicle } : {});
  });

  engine.registerExecutor('PATIENT_HANDOFF_DONE', (career, action) => {
    const p = patientOf(career, action.ref);
    if (!p || p.dto.status !== 'HANDOFF') return;
    const at = action.dueAt;
    const hospital = HOSPITALS.find((h) => h.id === p.dto.hospitalId) ?? HOSPITALS[0]!;
    const carrier = career.vehicles.find((v) => v.id === p.dto.assignedVehicleId);
    admit(career, hospital, at);
    finish(career, p, 'ADMITTED', at);
    // A multi-patient vehicle leaves the hospital after the LAST handoff of the patients it carried.
    const stillAboard = medicalState(career).patients.some(
      (x) =>
        x !== p &&
        x.dto.assignedVehicleId === carrier?.id &&
        (x.dto.status === 'IN_TRANSPORT' || x.dto.status === 'HANDOFF'),
    );
    const vehicle =
      carrier && carrier.status === 'AT_HOSPITAL' && !stillAboard
        ? engine.sendHome(career, carrier, at, hospital.position)
        : null;
    const incident = career.incidents.find((i) => i.id === p.dto.incidentId);
    if (incident)
      engine.log(
        career,
        incident.id,
        'patient.admitted',
        text('timeline.patient_admitted', { hospital: hospital.name }),
        at,
      );
    emitPatient(career, p, vehicle ? { vehicle } : {});
    if (incident) afterPatientMoved(career, incident.id, at);
    else medicalState(career).patients = medicalState(career).patients.filter((x) => x !== p);
  });

  /* ── public surface for the REST handlers ── */
  const api: MedicalApi = {
    patients: (career, incidentId) => {
      if (career.incidents.some((i) => i.id === incidentId)) refreshScene(career, incidentId, engine.now());
      return patientsOf(career, incidentId).map((p) => p.dto);
    },
    patient: (career, id) => {
      const p = patientOf(career, id);
      if (!p) throw new MockError(404, 'NOT_FOUND', 'Patient not found');
      return p.dto;
    },
    hospitalOptions: (career, id) => hospitalOptions(career, id),
    transport: (career, id, body) => startTransport(career, id, body, engine.now()),
    hospitals: (career) => HOSPITALS.map((h) => hospitalDto(career, h, engine.now())),
  };
  medicalApis.set(engine, api);

  /* ── QA helpers (src/mocks/qa.ts is installed after the domains: attach as soon as it exists) ── */
  const current = () => engine.qa.career();
  const helpers = {
    /** Builds (once) an operational EMS station and adds an available basic ambulance to it. Returns their ids. */
    giveAmbulance: (typeCode = 'EMS_MSB') => {
      const career = current();
      const type = FACILITY_TYPES.find((f) => f.code === 'EMS_STATION')!;
      let facility = career.facilities.find((f) => f.typeCode === type.code && f.status === 'OPERATIONAL');
      if (!facility) {
        facility = {
          id: engine.id('fac'),
          typeCode: type.code,
          family: 'EMS',
          name: 'Postazione 118 Pescara Centro',
          position: [14.2102, 42.4655],
          status: 'OPERATIONAL',
          capacities: capacitiesFor(type.baseCapacity),
          upgrades: [],
          address: 'Via Paolucci, Pescara',
          headquarters: false,
          operationalAt: null,
          promotion: null,
        };
        career.facilities.push(facility);
        if (!career.summary.unlockedFamilies.includes('EMS'))
          career.summary = {
            ...career.summary,
            unlockedFamilies: [...career.summary.unlockedFamilies, 'EMS'],
          };
      }
      const vehicle = engine.addVehicle(career, typeCode, facility.id, true);
      engine.emit(career, 'vehicle.updated', { vehicle, facility, career: career.summary });
      engine.save();
      return { facilityId: facility.id, vehicleId: vehicle.id };
    },
    medicalState: () => {
      const career = current();
      const state = medicalState(career);
      return {
        patients: state.patients.map((p) => ({
          ...p.dto,
          trueProfile: p.profileCode,
          outcome: p.outcome,
          external: p.external,
          stabilityNow: stabilityAt(p.stability, engine.now()),
        })),
        hospitals: api.hospitals(career),
        admitted: state.admitted,
        config: state.config,
      };
    },
    /** Grace times in REAL seconds (auto-confirm of the recommended hospital, external ambulance takeover) + QA switches. */
    medicalConfig: (config: Partial<MedicalState['config']>) => {
      Object.assign(medicalState(current()).config, config);
      engine.save();
    },
    /** Skips assessment/treatment: the patient is immediately stabilised and awaits transport. */
    stabilize: (patientId: string) => {
      const career = current();
      const p = patientOf(career, patientId);
      if (!p || !ON_SCENE.has(p.dto.status)) return;
      engine.cancelActions(career, (a) => a.type === 'PATIENT_STEP' && a.ref === p.dto.id);
      p.stabilized = true;
      p.treatedByPlayer = true;
      p.dto = { ...p.dto, status: 'AWAITING_TRANSPORT', transportRequired: true, busyUntil: null };
      publish(p, true);
      emitPatient(career, p);
      refreshScene(career, p.dto.incidentId, engine.now());
      engine.save();
    },
    setHospitalLoad: (hospitalIdOrName: string, load: HospitalLoad | null) => {
      const career = current();
      const h = HOSPITALS.find((x) => x.id === hospitalIdOrName || x.name.includes(hospitalIdOrName));
      if (!h) return;
      const state = medicalState(career);
      state.load[h.id] = { ...(state.load[h.id] ?? { extra: 0, anchorAt: engine.now() }), forced: load };
      engine.emit(career, 'patient.updated', {});
      engine.save();
    },
  };
  const attach = () => Object.assign(engine.qa, helpers);
  if (engine.qa) attach();
  else queueMicrotask(attach);
}

export interface MedicalApi {
  patients: (career: MockCareer, incidentId: string) => PatientDto[];
  patient: (career: MockCareer, id: string) => PatientDto;
  hospitalOptions: (career: MockCareer, id: string) => HospitalOption[];
  transport: (
    career: MockCareer,
    id: string,
    body: { hospitalId: string; vehicleId?: string; withPatientIds?: string[] },
  ) => { patient: PatientDto; vehicle: VehicleDto; incident?: IncidentDto; boarded: PatientDto[] };
  hospitals: (career: MockCareer) => HospitalDto[];
}
const medicalApis = new WeakMap<MockEngine, MedicalApi>();
/** The medical domain of an engine (the REST handlers are thin wrappers over it). */
export function medicalOf(engine: MockEngine): MedicalApi {
  const api = medicalApis.get(engine);
  if (!api) throw new Error('medical domain not installed');
  return api;
}
