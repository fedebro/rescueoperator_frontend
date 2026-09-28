'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { MajorIncidentDto } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { track } from '@/lib/analytics';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { majorApi } from './api';
import { activeMajorIdOf, memberSignature, percent } from './major';

/**
 * The coordination view of a major. Kept fresh by the realtime `career.updated {major}` events (the runtime writes them
 * into this cache); a slow poll while it runs covers what no event carries (the reinforcement quote, the growth check).
 */
export function useMajor(majorId: string | null) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.major(careerId, majorId ?? '-'),
    queryFn: () => majorApi.detail(careerId, majorId!),
    enabled: !!majorId,
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data?.status === 'ACTIVE' ? 20_000 : false),
  });
}

/**
 * A change on the running major's members re-reads it (debounced) — not only every 20 s. Mounted once by the game layout:
 * an unobserved cache entry just goes stale, and the coordination view refetches it when it opens.
 */
export function useMajorFollowsMembers(majorId: string | null): void {
  const careerId = useCareerId();
  const qc = useQueryClient();
  const { incidents } = useSnapshot();
  const signature = majorId ? memberSignature(incidents.filter((i) => i.major?.id === majorId)) : '';
  const previous = React.useRef(signature);
  React.useEffect(() => {
    if (previous.current === signature) return;
    previous.current = signature;
    if (!majorId) return;
    const timer = window.setTimeout(
      () => void qc.invalidateQueries({ queryKey: qk.major(careerId, majorId) }),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [signature, careerId, majorId, qc]);
}

/** The running major's id from the snapshot (its own field, else a member's reference). */
export function useActiveMajorId(): string | null {
  const snapshot = useSnapshot();
  return activeMajorIdOf(snapshot);
}

export function useActiveMajor(): { id: string | null; major: MajorIncidentDto | undefined } {
  const id = useActiveMajorId();
  const query = useMajor(id);
  return { id, major: query.data };
}

export function useMajorTrophies(enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.majorTrophies(careerId),
    queryFn: () => majorApi.trophies(careerId),
    enabled,
    staleTime: 60_000,
  });
}

export function useMajorHistory(limit = 5, enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: [...qk.majorList(careerId), limit],
    queryFn: () => majorApi.list(careerId, limit),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Opens the coordination view from anywhere (alert, strip, queue, notification): the map comes up with the major selected
 * and the camera on its event area.
 */
export function useOpenMajor(): (majorId: string, center?: [number, number] | null) => void {
  const router = useRouter();
  return React.useCallback(
    (majorId, center) => {
      useUiStore.getState().select({ kind: 'major', id: majorId }, center ? { focus: center } : undefined);
      if (typeof window !== 'undefined' && window.location.pathname !== '/game') router.push('/game');
    },
    [router],
  );
}

/** "Chiedi rinforzi": the column is on its way; a refusal says why in the server's own words (`major.reinforcements.blocked.*`). */
export function useRequestReinforcements(majorId: string) {
  const careerId = useCareerId();
  const qc = useQueryClient();
  const t = useTranslations('maxi.reinforcements');
  const tx = useI18nText();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: () => majorApi.requestReinforcements(careerId, majorId),
    onSuccess: (major) => {
      qc.setQueryData(qk.major(careerId, majorId), major);
      const column = major.reinforcements.requests.at(-1);
      track('major_reinforcements_requested', { scenarioCode: major.scenarioCode });
      toast({
        tone: 'success',
        title: t('requested'),
        description: column ? t('requestedBody', { percent: percent(column.coverageShare) }) : undefined,
        durationMs: 4000,
      });
    },
    onError: (e) => {
      const reason =
        isApiError(e, 'CONFLICT') && typeof (e.details as { reason?: unknown } | null)?.reason === 'string'
          ? (e.details as { reason: string }).reason
          : null;
      toast({
        tone: 'warning',
        title: reason ? tx({ key: `major.reinforcements.blocked.${reason}` }) : errorMessage(e),
      });
      void qc.invalidateQueries({ queryKey: qk.major(careerId, majorId) });
    },
  });
}
