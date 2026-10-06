'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/auth';
import { useSessionGate } from '@/hooks/use-session';
import { BrandSplash } from '@/components/brand/splash';
import { ServerOfflineScreen } from '@/components/brand/server-offline';
import { GameRuntime } from './game-runtime';
import { GameShell } from './shell';
import { OutcomeModal } from './outcome-modal';
import { AwayReportDialog } from './away-report';
import { TutorialOverlay } from './tutorial-overlay';
import { InsufficientCreditsHost } from '@/features/monetization/insufficient-credits';
import { FamilyUnlockCelebration } from '@/features/families/family-unlock-celebration';
import { MajorAlertHost } from '@/features/major/major-alert';
import { OperationAlertHost } from '@/features/alliance/operation-alert';

export function GameLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const gateStatus = useSessionGate('needs-career');
  const careerId = useAuthStore((s) => s.user?.activeCareerId ?? null);
  if (gateStatus === 'unreachable') return <ServerOfflineScreen />;
  if (gateStatus !== 'ok' || !careerId) return <BrandSplash />;
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
      <InsufficientCreditsHost />
      <FamilyUnlockCelebration />
      {/* The full-screen alert of a major incident, over any page (D-24, study 06 §2.6). */}
      <MajorAlertHost />
      {/* The full-screen alert of an alliance operation (D-106, study 07 §3.2). */}
      <OperationAlertHost />
    </GameRuntime>
  );
}
