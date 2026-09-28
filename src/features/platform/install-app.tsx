'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Download, PlusSquare, Share } from 'lucide-react';
import { track } from '@/lib/analytics';
import { useSettingsStore } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { installMode, isIosDevice, isStandalone, promptInstall, usePwaStore, type InstallMode } from './pwa';
import { isInAppBrowser } from './in-app-browser';

/** Install availability for this device, resolved on the client only (SSR renders "unavailable"). */
const noopSubscribe = () => () => undefined;
const clientDevice = (): 'standalone' | 'in-app' | 'ios' | 'other' =>
  isStandalone()
    ? 'standalone'
    : isInAppBrowser(navigator.userAgent)
      ? 'in-app'
      : isIosDevice(navigator.userAgent, navigator.maxTouchPoints)
        ? 'ios'
        : 'other';

export function useInstallMode(): InstallMode {
  const hasPrompt = usePwaStore((s) => s.deferred !== null);
  const installed = usePwaStore((s) => s.installed);
  const device = React.useSyncExternalStore(noopSubscribe, clientDevice, () => 'other' as const);
  return installMode({
    hasPrompt,
    installed,
    standalone: device === 'standalone',
    ios: device === 'ios',
    inApp: device === 'in-app',
  });
}

/** Safari's three taps to add the game to the Home Screen (also used by the push sheet on iPhone / iPad). */
export function IosInstallSteps({ children }: { children?: React.ReactNode }) {
  const t = useTranslations('platform.pwa');
  return (
    <ol className="flex flex-col gap-3 text-sm" data-testid="ios-install-steps">
      <li className="flex items-start gap-3">
        <Share className="text-skyline mt-0.5 size-5 shrink-0" aria-hidden />
        <span>{t('iosStep1')}</span>
      </li>
      <li className="flex items-start gap-3">
        <PlusSquare className="text-skyline mt-0.5 size-5 shrink-0" aria-hidden />
        <span>{t('iosStep2')}</span>
      </li>
      <li className="flex items-start gap-3">
        <CheckCircle2 className="text-skyline mt-0.5 size-5 shrink-0" aria-hidden />
        <span>{t('iosStep3')}</span>
      </li>
      {children}
    </ol>
  );
}

/** iOS has no programmatic prompt: explain the two taps. */
export function IosInstallDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.pwa');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('iosTitle')} description={t('iosIntro')} closeLabel={tc('close')}>
        <IosInstallSteps />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tc('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useInstallFlow(source: 'hint' | 'settings') {
  const mode = useInstallMode();
  const [iosOpen, setIosOpen] = React.useState(false);
  const dismissHint = useSettingsStore((s) => s.dismissInstallHint);
  const start = React.useCallback(async () => {
    dismissHint(); // whoever starts an install never needs the hint again
    if (mode === 'ios') {
      track('pwa_install_prompted', { platform: 'ios', source });
      setIosOpen(true);
      return;
    }
    if (mode === 'native') await promptInstall(source);
  }, [mode, source, dismissHint]);
  return { mode, start, iosOpen, setIosOpen };
}

/** Settings entry: "Installa l’app" (native prompt / iOS instructions / already installed / not supported here). */
export function InstallAppSetting() {
  const t = useTranslations('platform.pwa');
  const { mode, start, iosOpen, setIosOpen } = useInstallFlow('settings');
  return (
    <div className="flex items-center justify-between gap-4 py-3" data-testid="install-app-setting">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{t('title')}</p>
        <p className="text-muted text-xs" data-testid="install-app-hint" data-mode={mode}>
          {mode === 'installed'
            ? t('installedHint')
            : mode === 'in-app'
              ? t('inAppHint')
              : mode === 'unavailable'
                ? t('unavailableHint')
                : t('hint')}
        </p>
      </div>
      <div className="shrink-0">
        {mode === 'installed' ? (
          <Badge tone="success">
            <CheckCircle2 className="size-3" aria-hidden />
            {t('installed')}
          </Badge>
        ) : (
          <Button
            variant="secondary"
            className="h-11 lg:h-10"
            disabled={mode === 'unavailable' || mode === 'in-app'}
            onClick={() => void start()}
            data-testid="install-app-button"
          >
            <Download className="size-4" aria-hidden />
            {t('install')}
          </Button>
        )}
      </div>
      <IosInstallDialog open={iosOpen} onOpenChange={setIosOpen} />
    </div>
  );
}

/** Wait before hinting: the first seconds of a session belong to the map, not to a suggestion. */
const HINT_DELAY_MS = 20_000;

/**
 * One-time, dismissible hint shown AFTER the tutorial, only where an install is actually possible.
 * It is a regular toast (never modal, never over the bottom sheet) and it is never shown again once seen.
 */
export function InstallHint({ tutorialCompleted }: { tutorialCompleted: boolean }) {
  const t = useTranslations('platform.pwa');
  const dismissed = useSettingsStore((s) => s.installHintDismissed);
  const { mode, start, iosOpen, setIosOpen } = useInstallFlow('hint');
  const eligible = tutorialCompleted && !dismissed && (mode === 'native' || mode === 'ios');
  const startRef = React.useRef(start);
  React.useEffect(() => {
    startRef.current = start;
  }, [start]);
  React.useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => {
      useSettingsStore.getState().dismissInstallHint();
      toast({
        tone: 'info',
        title: t('hintTitle'),
        description: t('hintBody'),
        durationMs: 15_000,
        action: { label: t('install'), onClick: () => void startRef.current() },
      });
    }, HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible, t]);
  return <IosInstallDialog open={iosOpen} onOpenChange={setIosOpen} />;
}
