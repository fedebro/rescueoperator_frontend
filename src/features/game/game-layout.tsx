'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/auth';
import { useSessionGate } from '@/hooks/use-session';
import { BrandSplash } from '@/components/brand/splash';
import { GameRuntime } from './game-runtime';
import { GameShell } from './shell';
import { OutcomeModal } from './outcome-modal';
import { AwayReportDialog } from './away-report';
import { TutorialOverlay } from './tutorial-overlay';

export function GameLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const allowed = useSessionGate('needs-career');
  const careerId = useAuthStore((s) => s.user?.activeCareerId ?? null);
  if (!allowed || !careerId) return <BrandSplash />;
  return (
    <GameRuntime careerId={careerId}>
      <a
        href="#main"
        className="focus:bg-surface-3 sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:px-3 focus:py-2"
      >
        {t('skipToContent')}
      </a>
      <GameShell>{children}</GameShell>
      <TutorialOverlay />
      <AwayReportDialog />
      <OutcomeModal />
    </GameRuntime>
  );
}
