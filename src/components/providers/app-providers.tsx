'use client';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CatalogTextsProvider } from '@/i18n/catalog-texts';
import { Toaster } from '@/components/ui/toaster';
import { env } from '@/lib/env';
import { onAuthChange, refreshSession } from '@/lib/api/client';
import { ApiClientError } from '@/lib/api/errors';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { BrandSplash } from '@/components/brand/splash';
import { PlatformBootstrap } from '@/features/platform/platform-bootstrap';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => (error instanceof ApiClientError ? error.transient && count < 2 : count < 1),
      },
      mutations: { retry: false },
    },
  });
}

/** Blocks rendering until the in-browser mock backend is intercepting requests (mock mode only). */
function MockGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(!env.apiMock);
  React.useEffect(() => {
    if (!env.apiMock) return;
    let cancelled = false;
    void import('@/mocks/browser')
      .then((m) => m.startMockBackend())
      .then(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready ? <>{children}</> : <BrandSplash />;
}

/** Restores the session from the refresh cookie once per page load and keeps the auth store in sync with the API client. */
function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const setSession = useAuthStore((s) => s.setSession);
  const clear = useAuthStore((s) => s.clear);
  React.useEffect(() => {
    const off = onAuthChange((result) => (result ? setSession(result.user) : clear()));
    if (useAuthStore.getState().status === 'unknown') {
      refreshSession()
        .then((r) => {
          if (!r) clear();
        })
        .catch(() => clear());
    }
    return off;
  }, [setSession, clear]);
  return <>{children}</>;
}

function MotionPreference() {
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  React.useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [reducedMotion]);
  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(makeQueryClient);
  const t = useTranslations('common');
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={250}>
        <MotionPreference />
        <PlatformBootstrap />
        <MockGate>
          <CatalogTextsProvider>
            <AuthBootstrap>{children}</AuthBootstrap>
          </CatalogTextsProvider>
        </MockGate>
        <Toaster closeLabel={t('close')} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
