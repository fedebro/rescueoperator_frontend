'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  BellOff,
  BellRing,
  CheckCircle2,
  Siren,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';
import { track } from '@/lib/analytics';
import { useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { useCareerId } from '@/features/game/hooks';
import { IosInstallSteps } from '@/features/platform/install-app';
import { enablePush, syncPush } from './controller';
import { decidePushAction, deniedHelpFor, type DeniedHelp, type PushPromptVariant } from './decide';
import { readPushEnvironment } from './environment';
import { serverPushEnabled, useEnableFeedback, usePushConfig } from './hooks';
import { RELEASE_ID } from './release';
import { usePushStore } from './store';
import { devicePlatform, requestNotificationPermission } from './subscription';

/** A session's first seconds belong to the map: the sheet waits this long, then for a calm moment. */
export const PROMPT_DELAY_MS = 5000;
const CALM_RETRY_MS = 2500;

/** No dialog, alert or tutorial card open, and the tab in front: the sheet never lands on top of something else. */
export function isCalmMoment(doc: Document = document): boolean {
  return doc.visibilityState === 'visible' && !doc.querySelector('[role="dialog"], [role="alertdialog"]');
}

const DENIED_KEY: Record<DeniedHelp, 'iosApp' | 'androidApp' | 'macSafari' | 'browser'> = {
  'ios-app': 'iosApp',
  'android-app': 'androidApp',
  'mac-safari': 'macSafari',
  browser: 'browser',
};

/** How to allow notifications again on this device (the browser will never ask twice by itself). */
export function DeniedHelpText({ help }: { help: DeniedHelp }) {
  const t = useTranslations('push.denied');
  return (
    <p className="text-sm" data-testid="push-denied-help" data-help={help}>
      <span className="text-muted">{t('howTo')} </span>
      {t(DENIED_KEY[help])}
    </p>
  );
}

function Benefit({ icon: Icon, children }: { icon: typeof Siren; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <Icon className="text-skyline mt-0.5 size-5 shrink-0" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

/**
 * The permission sheet of D-98 (centred dialog on desktop, bottom sheet on phones). The browser's own prompt can only
 * come from a tap: "Attiva notifiche" starts `Notification.requestPermission()` synchronously in its click handler.
 */
export function PushPromptSheet({
  variant,
  onClose,
}: {
  variant: PushPromptVariant | null;
  onClose: () => void;
}) {
  const t = useTranslations('push');
  const tc = useTranslations('common');
  const careerId = useCareerId();
  const config = usePushConfig();
  const feedback = useEnableFeedback();
  const [busy, setBusy] = React.useState(false);
  const help = React.useMemo(
    () => (variant === 'denied' ? deniedHelpFor(readPushEnvironment()) : null),
    [variant],
  );

  const dismiss = () => {
    if (busy || !variant) return;
    track('push_prompt_dismissed', { kind: variant });
    onClose();
  };
  const enable = () => {
    if (!config.data || busy) return;
    // Inside the gesture, before any await: browsers only show their prompt in response to a tap.
    const permission = requestNotificationPermission();
    setBusy(true);
    void enablePush(permission, { careerId, config: config.data }).then((result) => {
      setBusy(false);
      feedback(result, 'prompt');
      onClose();
    });
  };

  const content =
    variant === 'ask' ? (
      <>
        <ul className="flex flex-col gap-3 text-sm" data-testid="push-benefits">
          <Benefit icon={Siren}>{t('prompt.benefitIncidents')}</Benefit>
          <Benefit icon={CheckCircle2}>{t('prompt.benefitClosed')}</Benefit>
          <Benefit icon={AlertTriangle}>{t('prompt.benefitMajor')}</Benefit>
          <Benefit icon={SlidersHorizontal}>{t('prompt.benefitControl')}</Benefit>
        </ul>
        <p className="text-subtle mt-4 text-xs">{t('prompt.note')}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss} disabled={busy} data-testid="push-prompt-later">
            {t('prompt.later')}
          </Button>
          <Button onClick={enable} loading={busy} data-testid="push-prompt-enable">
            <BellRing className="size-4" aria-hidden />
            {t('prompt.enable')}
          </Button>
        </DialogFooter>
      </>
    ) : variant === 'denied' ? (
      <>
        <DeniedHelpText help={help ?? 'browser'} />
        <DialogFooter>
          <Button variant="secondary" onClick={dismiss} data-testid="push-prompt-later">
            {t('denied.ok')}
          </Button>
        </DialogFooter>
      </>
    ) : variant === 'ios-install' ? (
      <>
        <IosInstallSteps>
          <li className="flex items-start gap-3">
            <Smartphone className="text-skyline mt-0.5 size-5 shrink-0" aria-hidden />
            <span>{t('ios.after')}</span>
          </li>
        </IosInstallSteps>
        <DialogFooter>
          <Button variant="secondary" onClick={dismiss} data-testid="push-prompt-later">
            {t('ios.ok')}
          </Button>
        </DialogFooter>
      </>
    ) : null;

  const title =
    variant === 'denied' ? t('denied.title') : variant === 'ios-install' ? t('ios.title') : t('prompt.title');
  const description =
    variant === 'denied' ? t('denied.intro') : variant === 'ios-install' ? t('ios.intro') : t('prompt.intro');

  return (
    <Dialog open={variant !== null} onOpenChange={(open) => (open ? undefined : dismiss())}>
      {variant ? (
        <DialogContent
          title={
            <span className="flex items-center gap-2">
              {variant === 'denied' ? (
                <BellOff className="text-warning size-5 shrink-0" aria-hidden />
              ) : (
                <BellRing className="text-brand-text size-5 shrink-0" aria-hidden />
              )}
              {title}
            </span>
          }
          description={description}
          closeLabel={tc('close')}
          data-testid="push-prompt"
          data-variant={variant}
        >
          {content}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/**
 * Mounted once per game session (GameRuntime). Decides what this device needs (D-98) and does it:
 *  - permission granted → silent (re)subscription, no UI;
 *  - otherwise, once per release and never during the tutorial → one sheet, a few seconds in, at a calm moment.
 */
export function PushRuntime({ tutorialCompleted }: { tutorialCompleted: boolean }) {
  const careerId = useCareerId();
  const config = usePushConfig();
  const promptedRelease = usePushStore((s) => s.promptedRelease);
  const optedOut = usePushStore((s) => s.optedOut);
  const [variant, setVariant] = React.useState<PushPromptVariant | null>(null);
  const syncing = React.useRef(false);
  const showing = variant !== null;
  const data = config.data;

  React.useEffect(() => {
    if (!data || showing) return;
    const action = decidePushAction({
      releaseId: RELEASE_ID,
      serverEnabled: serverPushEnabled(data),
      env: readPushEnvironment(),
      tutorialCompleted,
      promptedRelease,
      optedOut,
    });
    if (action.type === 'sync') {
      if (syncing.current) return;
      syncing.current = true;
      void syncPush({ careerId, config: data }).then((result) => {
        syncing.current = false;
        if (result === 'synced') track('push_synced', { platform: devicePlatform() });
      });
      return;
    }
    if (action.type !== 'prompt') return;
    let timer = window.setTimeout(function attempt() {
      if (!isCalmMoment()) {
        timer = window.setTimeout(attempt, CALM_RETRY_MS);
        return;
      }
      // Counted as asked as soon as it is on screen: a reload does not bring it back in this release.
      usePushStore.getState().markPrompted(RELEASE_ID);
      // The sheet already explains the Home Screen app: the separate "install" hint would say it twice.
      if (action.variant === 'ios-install') useSettingsStore.getState().dismissInstallHint();
      track('push_prompt_shown', { kind: action.variant });
      setVariant(action.variant);
    }, PROMPT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [data, showing, tutorialCompleted, promptedRelease, optedOut, careerId]);

  return <PushPromptSheet variant={variant} onClose={() => setVariant(null)} />;
}
