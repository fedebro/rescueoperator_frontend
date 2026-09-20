'use client';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { IncidentDto, PatientDto, VehicleDto } from '@/contracts';
import { medicalApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useCareerId, useCatalog, useSnapshot } from '@/features/game/hooks';

export const TRANSPORT_CAPABILITY = 'PATIENT_TRANSPORT';
export const MEDICAL_CAPABILITIES = ['MEDICAL_BASIC', 'MEDICAL_ADVANCED'];

export const hasCapability = (vehicle: VehicleDto, codes: readonly string[]): boolean =>
  vehicle.capabilities.some((c) => codes.includes(c.code) && c.value > 0);

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
