'use client';
import * as React from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { AllianceHomeDto, SyncSnapshot } from '@/contracts';
import {
  aidApi,
  allianceApi,
  boardApi,
  chatApi,
  moderationApi,
  progressApi,
  operationApi,
} from '@/lib/api/alliance';
import { ApiClientError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { invalidateFresh } from '@/lib/api/invalidate';
import { qk } from '@/lib/api/query-keys';
import { toast } from '@/stores/toast';
import { useCareerId } from '@/features/game/hooks';

/** The whole section in one call (`AllianceHomeDto`); kept fresh by the alliance stream and the career stream. */
export function useAllianceHome() {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.allianceHome(careerId),
    queryFn: () => allianceApi.home(careerId),
    staleTime: 30_000,
  });
}

export function useAllianceMembers(enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.allianceMembers(careerId),
    queryFn: () => allianceApi.members(careerId),
    staleTime: 30_000,
    enabled,
  });
}

export function useJoinRequests(enabled: boolean) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.allianceJoinRequests(careerId),
    queryFn: () => allianceApi.joinRequests(careerId),
    staleTime: 15_000,
    enabled,
  });
}

export function useAllianceInvites(enabled: boolean) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.allianceInvites(careerId),
    queryFn: () => allianceApi.invites(careerId),
    staleTime: 15_000,
    enabled,
  });
}

export function useDirectorCard(targetCareerId: string | null) {
  return useQuery({
    queryKey: qk.directorCard(targetCareerId ?? ''),
    queryFn: () => allianceApi.director(targetCareerId!),
    enabled: targetCareerId !== null,
    staleTime: 15_000,
  });
}

export function useBlocks() {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.blocks(careerId),
    queryFn: () => moderationApi.blocks(careerId),
    staleTime: 30_000,
  });
}

export function useCommunityRules() {
  return useQuery({ queryKey: qk.communityRules, queryFn: moderationApi.communityRules, staleTime: 60_000 });
}

/**
 * The player-facing sentence of an alliance error: the specific reasons the server names (`details.reason`, the text
 * filter's `reasons`, a cooldown's `until`) before the generic message of the code.
 */
export function useAllianceErrorMessage(): (error: unknown) => string {
  const generic = useErrorMessage();
  const t = useTranslations('alliance');
  return React.useCallback(
    (error) => {
      if (!(error instanceof ApiClientError)) return generic(error);
      const details = (error.details ?? {}) as Record<string, unknown>;
      if (error.code === 'TEXT_REJECTED' && Array.isArray(details.reasons)) {
        const reasons = (details.reasons as string[]).map((r) =>
          t.has(`textReason.${r}` as never) ? t(`textReason.${r}` as never) : r,
        );
        return t('found.textRejected', { reasons: reasons.join(', ') });
      }
      if (typeof details.reason === 'string' && t.has(`errorReason.${details.reason}` as never))
        return t(`errorReason.${details.reason}` as never);
      if (error.code === 'LEVEL_TOO_LOW' && typeof details.required === 'number')
        return t('errorReason.LEVEL_REQUIRED', { level: details.required });
      return generic(error);
    },
    [generic, t],
  );
}

/** Mutation helper: refreshes the section (and the snapshot's badge) after a successful command, toasts an error. */
export function useAllianceMutation<TData, TVariables>(
  mutationFn: (careerId: string, variables: TVariables) => Promise<TData>,
  options: Omit<UseMutationOptions<TData, unknown, TVariables>, 'mutationFn'> & {
    /** Extra cache roots to re-read (the section root is always re-read). */
    invalidate?: (careerId: string) => readonly (readonly unknown[])[];
    successToast?: string | ((data: TData, variables: TVariables) => string | null);
    /** Replace the section's cached `alliance` at once (e.g. the result of a command that returns `MyAllianceDto`). */
    applyHome?: (data: TData, home: AllianceHomeDto) => AllianceHomeDto;
  } = {},
) {
  const careerId = useCareerId();
  const qc = useQueryClient();
  const message = useAllianceErrorMessage();
  const { invalidate, successToast, applyHome, onSuccess, onError, ...rest } = options;
  return useMutation<TData, unknown, TVariables>({
    mutationFn: (variables) => mutationFn(careerId, variables),
    ...rest,
    onSuccess: (data, variables, context, mutation) => {
      if (applyHome) {
        const key = qk.allianceHome(careerId);
        const home = qc.getQueryData<AllianceHomeDto>(key);
        if (home) qc.setQueryData(key, applyHome(data, home));
      }
      void invalidateFresh(qc, qk.allianceRoot(careerId));
      void invalidateFresh(qc, qk.sync(careerId));
      for (const key of invalidate?.(careerId) ?? []) void invalidateFresh(qc, key);
      const text = typeof successToast === 'function' ? successToast(data, variables) : successToast;
      if (text) toast({ tone: 'success', title: text, durationMs: 4000 });
      onSuccess?.(data, variables, context, mutation);
    },
    onError: (error, variables, context, mutation) => {
      toast({ tone: 'danger', title: message(error), durationMs: 6000 });
      onError?.(error, variables, context, mutation);
    },
  });
}

/** Re-reads the snapshot so the navigation badge and the `alliance` ref follow a command at once. */
export function useRefreshSnapshot(): () => void {
  const careerId = useCareerId();
  const qc = useQueryClient();
  return React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.sync(careerId) });
  }, [qc, careerId]);
}

export const snapshotAllianceId = (qcData: SyncSnapshot | undefined): string | null =>
  qcData?.alliance?.id ?? null;

/* ───────────────────────────── phase 2: board, chat, aid ───────────────────────────── */

/** The board, pinned announcements first then newest; pages through `meta.nextCursor`. */
export function useBoard(enabled = true) {
  const careerId = useCareerId();
  return useInfiniteQuery({
    queryKey: qk.allianceBoard(careerId),
    queryFn: ({ pageParam }) => boardApi.posts(careerId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
    staleTime: 15_000,
    enabled,
  });
}

export function useChannels(enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.allianceChannels(careerId),
    queryFn: () => chatApi.channels(careerId),
    staleTime: 15_000,
    enabled,
  });
}

/** Messages of a channel: the server pages newest-first; the screen shows them oldest-first and loads older at the top. */
export function useMessages(channelId: string | null) {
  const careerId = useCareerId();
  return useInfiniteQuery({
    queryKey: qk.allianceMessages(careerId, channelId ?? ''),
    queryFn: ({ pageParam }) => chatApi.messages(careerId, channelId!, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
    staleTime: Infinity,
    enabled: channelId !== null,
  });
}

export function useAidRequests(status: 'OPEN' | 'ALL', enabled = true) {
  const careerId = useCareerId();
  return useInfiniteQuery({
    queryKey: qk.allianceAidRequests(careerId, status),
    queryFn: ({ pageParam }) => aidApi.requests(careerId, status, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
    staleTime: 15_000,
    enabled,
  });
}

export function useAidColumns(role: 'GIVEN' | 'RECEIVED' | 'ALL', active: boolean, enabled = true) {
  const careerId = useCareerId();
  return useInfiniteQuery({
    queryKey: qk.allianceAidColumns(careerId, role, active),
    queryFn: ({ pageParam }) => aidApi.columns(careerId, role, active, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
    staleTime: 15_000,
    enabled,
  });
}

export function useColumnOptions(requestId: string | null) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.allianceColumnOptions(careerId, requestId ?? ''),
    queryFn: () => aidApi.columnOptions(careerId, requestId!),
    enabled: requestId !== null,
    staleTime: 5_000,
  });
}

/** Patches the career snapshot's unread counters after a read marker moved (the nav badge follows at once). */
export function useApplyUnread(): (unread: { board: number; chat: number }) => void {
  const careerId = useCareerId();
  const qc = useQueryClient();
  return React.useCallback(
    (unread) => {
      const key = qk.sync(careerId);
      const snapshot = qc.getQueryData<SyncSnapshot>(key);
      if (snapshot?.alliance)
        qc.setQueryData(key, { ...snapshot, alliance: { ...snapshot.alliance, unread } });
    },
    [qc, careerId],
  );
}

/* ───────────── phase 3: progression + operations ───────────── */
export function useObjectives(enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.allianceObjectives(careerId),
    queryFn: () => progressApi.objectives(careerId),
    enabled,
  });
}
export function useAllianceXp(enabled = true) {
  const careerId = useCareerId();
  return useInfiniteQuery({
    queryKey: qk.allianceXp(careerId),
    queryFn: ({ pageParam }) => progressApi.xp(careerId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
    enabled,
  });
}
export function useRanking(enabled = true) {
  return useQuery({ queryKey: qk.allianceRanking, queryFn: () => progressApi.ranking(), enabled });
}
/** The running / recent operation; polled gently so the clock and the fronts stay honest between stream events. */
export function useOperation(enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.allianceOperation(careerId),
    queryFn: () => operationApi.current(careerId),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}
export function useOperationHistory(enabled = true) {
  const careerId = useCareerId();
  return useInfiniteQuery({
    queryKey: qk.allianceOperations(careerId),
    queryFn: ({ pageParam }) => operationApi.history(careerId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
    enabled,
  });
}
