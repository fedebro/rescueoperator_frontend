'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { PushConfigDto } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { track } from '@/lib/analytics';
import { toast } from '@/stores/toast';
import { pushApi } from './api';
import type { EnableResult } from './controller';
import { devicePlatform } from './subscription';

/** The server's push switch, key and categories: fetched once per session (it changes with a deploy, not in play). */
export function usePushConfig() {
  return useQuery({
    queryKey: qk.pushConfig,
    queryFn: pushApi.config,
    staleTime: 30 * 60_000,
    retry: 1,
  });
}

/** Push is on for the server: a key to subscribe with and the switch on. */
export const serverPushEnabled = (config: PushConfigDto | undefined): boolean =>
  !!config?.enabled && !!config.vapidPublicKey;

/** Tells the player how "Attiva notifiche" went (sheet and Settings share it). */
export function useEnableFeedback(): (result: EnableResult, source: 'prompt' | 'settings') => void {
  const t = useTranslations('push.result');
  return React.useCallback(
    (result, source) => {
      track('push_enable_result', { result, source, platform: devicePlatform() });
      if (result === 'enabled')
        toast({ tone: 'success', title: t('enabled'), description: t('enabledBody') });
      else if (result === 'denied')
        toast({ tone: 'warning', title: t('blocked'), description: t('blockedBody'), durationMs: 8000 });
      else if (result === 'unavailable') toast({ tone: 'warning', title: t('unavailable') });
      else if (result === 'failed') toast({ tone: 'danger', title: t('failed') });
      // 'dismissed': the browser's prompt was closed without an answer — nothing to say.
    },
    [t],
  );
}
