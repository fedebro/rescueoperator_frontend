'use client';
import * as React from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { IncidentDto, PatientDto, VehicleDto } from '@/contracts';
import { medicalApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useCareerId, useCatalog, useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';
import { isWaterUnitType } from '@/features/water/water';

export const TRANSPORT_CAPABILITY = 'PATIENT_TRANSPORT';
export const MEDICAL_CAPABILITIES = ['MEDICAL_BASIC', 'MEDICAL_ADVANCED'];

export const hasCapability = (vehicle: VehicleDto, codes: readonly string[]): boolean =>
  vehicle.capabilities.some((c) => codes.includes(c.code) && c.value > 0);

/** Statuses of a patient who has left the scene (on the way to, or at, the hospital) or whose care is over. */
const OFF_SCENE: ReadonlySet<PatientDto['status']> = new Set([
  'IN_TRANSPORT',
  'HANDOFF',
  'ADMITTED',
  'RELEASED_ON_SCENE',
  'DECEASED',
]);

/** Still at the scene — in the water or at the meeting point: not on the way to hospital, care not over. */
export const isAtScene = (patient: Pick<PatientDto, 'status'>): boolean => !OFF_SCENE.has(patient.status);

/**
 * Still in the water at the scene of a water incident (water patients, analisi/note-agenti/water-patients.md): only the units
 * on the water reach them — no assessment, care or transport from the meeting point until they are ashore. An absent
 * `location` (an older server) means ashore.
 */
export const isInWater = (patient: Pick<PatientDto, 'location' | 'status'>): boolean =>
  patient.location === 'WATER' && isAtScene(patient);

/** Brought ashore to the meeting point (by a boat, a helicopter or the Coast Guard) and still cared for there. */
export const isJustAshore = (patient: Pick<PatientDto, 'location' | 'status' | 'recovery'>): boolean =>
  !isInWater(patient) && isAtScene(patient) && !!patient.recovery?.recoveredAt;

/** Waiting for the hospital transport AND at the meeting point: the only patients a transport can be started for. */
export const canBeTransported = (patient: Pick<PatientDto, 'location' | 'status'>): boolean =>
  patient.status === 'AWAITING_TRANSPORT' && !isInWater(patient);

/** A vehicle that reaches the people in the water: a boat, or a helicopter able to do a water rescue (catalog type). */
export function useIsWaterUnit(): (vehicle: VehicleDto) => boolean {
  const typeOf = useVehicleTypeLookup();
  return React.useCallback(
    (vehicle) => isWaterUnitType(typeOf(vehicle.typeCode), vehicle.capabilities),
    [typeOf],
  );
}

/**
 * What is on scene decides assessment, needs and stability rates, but a recalled vehicle produces no `patient.updated`:
 * the signature is part of the query key so the list is re-read whenever the scene changes. The key stays under
 * `medicalRoot`, which `patient.updated` invalidates.
 */
const sceneSignature = (incident: IncidentDto, vehicles: readonly VehicleDto[]): string =>
  vehicles
    .filter((v) => v.incidentId === incident.id)
    .map((v) => `${v.id}:${v.status}`)
    .sort()
    .join('|');

export function usePatients(incident: IncidentDto) {
  const careerId = useCareerId();
  const { vehicles } = useSnapshot();
  return useQuery({
    queryKey: [...qk.patients(careerId, incident.id), sceneSignature(incident, vehicles)],
    queryFn: () => medicalApi.patients(careerId, incident.id),
    enabled: incident.patientCount > 0,
    placeholderData: (previous) => previous,
  });
}

/** Every patient of the active incidents (the contract has no career-wide list: one cached query per incident). */
export function useActivePatients(): PatientDto[] {
  const careerId = useCareerId();
  const { incidents, vehicles } = useSnapshot();
  const withPatients = incidents.filter((i) => i.patientCount > 0);
  return useQueries({
    queries: withPatients.map((incident) => ({
      queryKey: [...qk.patients(careerId, incident.id), sceneSignature(incident, vehicles)],
      queryFn: () => medicalApi.patients(careerId, incident.id),
      placeholderData: (previous: PatientDto[] | undefined) => previous,
    })),
    combine: combinePatients,
  });
}
/** Stable reference (module scope) so TanStack memoises the combined list between renders. */
const combinePatients = (results: { data?: PatientDto[] }[]): PatientDto[] =>
  results.flatMap((r) => r.data ?? []);

export function useHospitals(enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.hospitals(careerId),
    queryFn: () => medicalApi.hospitals(careerId),
    enabled,
    staleTime: 30_000,
  });
}

/** Catalog feature `HOSPITAL_CHOICE` (level 5): below it only the recommended hospital can be confirmed. */
export function useHospitalChoice(): { unlocked: boolean; requiredLevel: number } {
  const catalog = useCatalog();
  const { career } = useSnapshot();
  const feature = catalog?.features?.find((f) => f.feature === 'HOSPITAL_CHOICE');
  const requiredLevel = feature?.requiredLevel ?? 5;
  return { unlocked: feature ? feature.unlocked : career.level >= requiredLevel, requiredLevel };
}
