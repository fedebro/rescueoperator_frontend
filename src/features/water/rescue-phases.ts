import type { PatientDto } from '@/contracts';

/**
 * Phase strip of a water rescue with a meeting point (analisi/studio-2026-10-18-mare/01 §3.1, analisi/note-agenti/mare.md):
 * In mare → A bordo → Verso riva (arrivo hh:mm) → A riva, in attesa del mezzo di terra → In ospedale — how many patients are
 * in each phase and which unit has them. Derived from the patients' DTOs only (`location`, `recovery`, `status`).
 */
export type RescuePhaseKey = 'IN_WATER' | 'ABOARD' | 'HEADING_ASHORE' | 'ASHORE' | 'HOSPITAL';
export const RESCUE_PHASES: readonly RescuePhaseKey[] = [
  'IN_WATER',
  'ABOARD',
  'HEADING_ASHORE',
  'ASHORE',
  'HOSPITAL',
];

export interface RescuePhase {
  key: RescuePhaseKey;
  patients: PatientDto[];
  /** The units that have them: the boat carrying them, the ambulance taking them to hospital (deduplicated). */
  vehicleIds: string[];
  /** The earliest landing (heading ashore) or Coast Guard landing (in the water), else null. */
  etaAt: string | null;
}

export interface RescuePhases {
  phases: RescuePhase[];
  /** Ended otherwise: treated and released on scene, not survived, not rescued. */
  others: PatientDto[];
}

const ON_SCENE: ReadonlySet<PatientDto['status']> = new Set([
  'UNASSESSED',
  'ASSESSED',
  'TREATING',
  'STABILIZED',
  'AWAITING_TRANSPORT',
]);
const TO_HOSPITAL: ReadonlySet<PatientDto['status']> = new Set(['IN_TRANSPORT', 'HANDOFF', 'ADMITTED']);

/** A water rescue: some patient started in the water (an older server or a land incident has no `recovery`). */
export const isWaterRescue = (patients: readonly PatientDto[]): boolean =>
  patients.some((p) => p.location === 'WATER' || !!p.recovery);

/** In which phase a patient is at `now` (null = ended otherwise). */
export function rescuePhaseOf(patient: PatientDto, now: number): RescuePhaseKey | null {
  if (TO_HOSPITAL.has(patient.status)) return 'HOSPITAL';
  if (!ON_SCENE.has(patient.status)) return null;
  if (patient.location !== 'WATER') return 'ASHORE';
  const recovery = patient.recovery;
  if (recovery?.by === 'VEHICLE' && recovery.etaAt) {
    const departsAt = recovery.departsAt ? Date.parse(recovery.departsAt) : null;
    return departsAt !== null && now >= departsAt ? 'HEADING_ASHORE' : 'ABOARD';
  }
  return 'IN_WATER';
}

const earliest = (values: (string | null | undefined)[]): string | null =>
  values.filter((v): v is string => !!v).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;

export function rescuePhases(patients: readonly PatientDto[], now: number): RescuePhases | null {
  if (!isWaterRescue(patients)) return null;
  const phases = RESCUE_PHASES.map((key): RescuePhase => ({
    key,
    patients: [],
    vehicleIds: [],
    etaAt: null,
  }));
  const others: PatientDto[] = [];
  for (const patient of patients) {
    const key = rescuePhaseOf(patient, now);
    if (!key) {
      others.push(patient);
      continue;
    }
    const phase = phases.find((p) => p.key === key)!;
    phase.patients.push(patient);
    const vehicleId =
      key === 'ABOARD' || key === 'HEADING_ASHORE'
        ? patient.recovery?.vehicleId
        : key === 'ASHORE' || key === 'HOSPITAL'
          ? patient.assignedVehicleId
          : null;
    if (vehicleId && !phase.vehicleIds.includes(vehicleId)) phase.vehicleIds.push(vehicleId);
  }
  for (const phase of phases) {
    if (phase.key === 'HEADING_ASHORE') phase.etaAt = earliest(phase.patients.map((p) => p.recovery?.etaAt));
    if (phase.key === 'IN_WATER')
      phase.etaAt = earliest(
        phase.patients.filter((p) => p.recovery?.by === 'COAST_GUARD').map((p) => p.recovery?.etaAt),
      );
  }
  return { phases, others };
}

/** Somebody aboard a unit bound for the meeting point (about to be landed there). */
export const someoneBeingLanded = (patients: readonly PatientDto[]): boolean =>
  patients.some(
    (p) =>
      p.location === 'WATER' && ON_SCENE.has(p.status) && p.recovery?.by === 'VEHICLE' && !!p.recovery.etaAt,
  );
