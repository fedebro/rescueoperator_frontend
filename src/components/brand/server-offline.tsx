'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { WifiOff, RotateCw } from 'lucide-react';
import { Logo } from './logo';
import { Button } from '@/components/ui/button';
import { refreshSession } from '@/lib/api/client';

/**
 * Shown by a gated layout when `useSessionGate` reports `unreachable`: the server didn't answer (network error,
 * timeout, 5xx) — not "you're logged out." `AuthBootstrap` is already retrying in the background on its own backoff;
 * "Riprova ora" just runs one attempt immediately instead of waiting for the next scheduled one.
 */
export function ServerOfflineScreen() {
  const t = useTranslations('offline');
  const [retrying, setRetrying] = React.useState(false);

  const retryNow = React.useCallback(() => {
    setRetrying(true);
    refreshSession().finally(() => setRetrying(false));
  }, []);

  return (
    <div
      className="h-dvh-safe bg-bg grid place-items-center p-6"
      role="alert"
      data-testid="server-offline"
    >
      <div className="flex max-w-sm flex-col items-center gap-5 text-center">
        <Logo variant="stacked" className="w-40 opacity-80" />
        <div className="bg-danger/10 text-danger grid size-14 place-items-center rounded-full">
          <WifiOff className="size-7" aria-hidden />
        </div>
        <div>
          <h1 className="text-fg text-lg font-bold">{t('title')}</h1>
          <p className="text-muted mt-2 text-sm leading-relaxed">{t('body')}</p>
        </div>
        <Button onClick={retryNow} loading={retrying} data-testid="server-offline-retry">
          <RotateCw className="size-4" aria-hidden />
          {t('retry')}
        </Button>
        <p className="text-subtle text-xs">{t('autoRetry')}</p>
      </div>
    </div>
  );
}
