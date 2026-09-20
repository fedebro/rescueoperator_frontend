'use client';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { CandidateDto, DepartmentDto, EnrollmentDto, TeamDto } from '@/contracts';
import { personnelApi, type CourseDto } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { toast } from '@/stores/toast';
import { requestCredits } from '@/features/monetization/insufficient-credits';
import { useCareerId, useCatalog, useSnapshot } from '@/features/game/hooks';

export type Team = z.infer<typeof TeamDto>;
export type TeamStatus = Team['status'];
export type Department = z.infer<typeof DepartmentDto>;
export type Candidate = z.infer<typeof CandidateDto>;
export type Enrollment = z.infer<typeof EnrollmentDto>;
export type Course = z.infer<typeof CourseDto>;

/** Every personnel query lives under `qk.personnelRoot`: the `personnel.updated` realtime event refetches them all. */
export function usePersonnel() {
  const careerId = useCareerId();
  return useQuery({ queryKey: qk.personnel(careerId), queryFn: () => personnelApi.list(careerId) });
}
export function usePersonnelDetail(id: string | null) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.personnelDetail(careerId, id ?? 'none'),
    queryFn: () => personnelApi.detail(careerId, id!),
    enabled: id !== null,
  });
}
export function useTeams(enabled = true) {
  const careerId = useCareerId();
  return useQuery({ queryKey: qk.teams(careerId), queryFn: () => personnelApi.teams(careerId), enabled });
}
export function useDepartments(enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.departments(careerId),
    queryFn: () => personnelApi.departments(careerId),
    enabled,
  });
}
export function useCandidates() {
  const careerId = useCareerId();
  return useQuery({ queryKey: qk.candidates(careerId), queryFn: () => personnelApi.candidates(careerId) });
}
export function useTraining() {
  const careerId = useCareerId();
  return useQuery({ queryKey: qk.training(careerId), queryFn: () => personnelApi.training(careerId) });
}
export function useInvalidatePersonnel() {
  const qc = useQueryClient();
  const careerId = useCareerId();
  return React.useCallback(
    () => qc.invalidateQueries({ queryKey: qk.personnelRoot(careerId) }),
    [qc, careerId],
  );
}

/**
 * `CatalogDto.roles` is an open record in the contract: this is the shape the client relies on
 * (catalog `roles.yaml`: code, family | SHARED, specialist, requiredLevel, hireCost, costPerPeriod, onboardingSeconds,
 * startingQualifications, quickHire).
 */
const RoleInfo = z.object({
  code: z.string(),
  family: z.string(),
  specialist: z.boolean().default(false),
  requiredLevel: z.number().default(1),
  hireCost: z.number().default(0),
  costPerPeriod: z.number().default(0),
  onboardingSeconds: z.number().default(0),
  startingQualifications: z.array(z.string()).default([]),
  quickHire: z.boolean().default(false),
});
export type RoleInfo = z.infer<typeof RoleInfo>;
export function useRoles(): RoleInfo[] {
  const catalog = useCatalog();
  return React.useMemo(
    () =>
      (catalog?.roles ?? []).flatMap((raw) => {
        const parsed = RoleInfo.safeParse(raw);
        return parsed.success ? [parsed.data] : [];
      }),
    [catalog],
  );
}

/** Level gate of a catalog feature (TEAMS 4 · DEPARTMENTS 12 · TRAINING 2): locked screens show the level, never hide. */
export function useFeature(feature: 'TEAMS' | 'DEPARTMENTS' | 'TRAINING'): {
  unlocked: boolean;
  requiredLevel: number | null;
} {
  const catalog = useCatalog();
  const { career } = useSnapshot();
  const row = catalog?.features?.find((f) => f.feature === feature);
  if (!row) return { unlocked: catalog !== undefined, requiredLevel: null };
  return { unlocked: row.requiredLevel <= career.level, requiredLevel: row.requiredLevel };
}

/** Shared error path of every purchase in this area: the prescribed "not enough credits" flow, otherwise a toast. */
export function useCommandError(): (error: unknown, price?: string | bigint) => void {
  const errorMessage = useErrorMessage();
  return React.useCallback(
    (error, price) => {
      if (isApiError(error, 'INSUFFICIENT_CREDITS') && price !== undefined) requestCredits(price);
      else toast({ tone: 'danger', title: errorMessage(error) });
    },
    [errorMessage],
  );
}
