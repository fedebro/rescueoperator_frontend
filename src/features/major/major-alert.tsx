'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { Siren, Truck, Map as MapIcon, Coins } from 'lucide-react';
import { track } from '@/lib/analytics';
import { playCue } from '@/lib/sound';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Button } from '@/components/ui/button';
import { CreditAmount } from '@/components/ui/credit-amount';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { useActiveMajorId, useMajor, useMajorFollowsMembers, useOpenMajor } from './hooks';
import { acknowledgeMajor, acknowledgedMajors } from './major';
import { useMajorStore } from './store';

/** A long, unmistakable buzz on phones (06 §2.6 "vibrazione su mobile"); ignored where the API does not exist. */
export const MAJOR_VIBRATION = [400, 150, 400, 150, 700];
function vibrate(): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    navigator.vibrate(MAJOR_VIBRATION);
  } catch {
    /* vibration is strictly optional */
  }
}

/**
 * The full-screen alert of a major incident (06 §2.6): "MAXI-EMERGENZA — Incendio con feriti multipli, Porta Nuova", with its
 * own siren and a vibration on phones. Mounted by the game layout, so it shows over ANY page; opens the coordination view on
 * the map or closes. Shown once per major and device (a reload during an unacknowledged major shows it again).
 */
export function MajorAlertHost() {
  const t = useTranslations('maxi.alert');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const careerId = useCareerId();
  const { featureFlags } = useSnapshot();
  const alertId = useMajorStore((s) => s.alertId);
  const activeId = useActiveMajorId();
  const openMajor = useOpenMajor();
  // The quote of the reinforcements follows the player's dispatches (no server event carries them).
  useMajorFollowsMembers(activeId);

  // A major found running (reload, resync, another device started it) that this device never acknowledged: alert now.
  React.useEffect(() => {
    if (!activeId || acknowledgedMajors(careerId).has(activeId)) return;
    if (useMajorStore.getState().alertId !== activeId) useMajorStore.getState().showAlert(activeId);
  }, [activeId, careerId]);

  const major = useMajor(alertId).data;
  const open = !!alertId && !!major && major.id === alertId && major.status === 'ACTIVE';

  // The siren (twice) and the vibration, once per major shown.
  const announced = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open || !major || announced.current === major.id) return;
    announced.current = major.id;
    track('major_alert_shown', { scenarioCode: major.scenarioCode, severity: major.severity });
    vibrate();
    if (featureFlags.soundEffects === false) return;
    playCue('major');
    const again = window.setTimeout(() => playCue('major'), 1100);
    return () => window.clearTimeout(again);
  }, [open, major, featureFlags.soundEffects]);

  const close = React.useCallback(() => {
    if (alertId) acknowledgeMajor(careerId, alertId);
    useMajorStore.getState().dismissAlert();
  }, [alertId, careerId]);
  const coordinate = () => {
    if (!major) return;
    track('major_alert_opened', { scenarioCode: major.scenarioCode });
    close();
    openMajor(major.id, major.center);
  };

  if (!open || !major) return null;
  const linked = major.sectors.filter((s) => s.role === 'SUB').length;
  return (
    <DialogPrimitive.Root open onOpenChange={(value) => (value ? undefined : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in bg-overlay fixed inset-0 z-[80] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          role="alertdialog"
          aria-describedby="major-alert-description"
          data-testid="major-alert"
          data-major-id={major.id}
          className={cn(
            'animate-slide-up border-major/60 fixed inset-0 z-[81] flex flex-col overflow-y-auto border-2 outline-none',
            'bg-[radial-gradient(ellipse_at_top,rgb(255_79_134/0.28),transparent_60%),var(--rc-surface-1)]',
            'md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[88dvh] md:w-[min(560px,92vw)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg',
          )}
          style={{
            paddingTop: 'max(1.25rem, var(--rc-safe-top))',
            paddingBottom: 'max(1.25rem, var(--rc-safe-bottom))',
          }}
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5 py-4 text-center">
            <span
              aria-hidden
              className="animate-major-flash bg-major text-inverse grid size-24 place-items-center rounded-full md:size-20"
            >
              <Siren className="size-12 md:size-10" />
            </span>
            <div className="flex flex-col gap-2">
              {/* The catalog's alert line already opens with "MAXI-EMERGENZA —": no eyebrow repeating it. */}
              <DialogPrimitive.Title
                className="font-display text-2xl leading-tight font-extrabold text-balance md:text-3xl"
                data-testid="major-alert-title"
              >
                {tx(major.alert)}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="major-alert-description"
                className="text-muted mx-auto max-w-md text-sm leading-relaxed"
              >
                {tx(major.description)}
              </DialogPrimitive.Description>
            </div>
            <ul className="flex w-full max-w-md flex-col gap-2 text-left text-sm">
              <li className="border-border bg-surface-2 flex min-h-11 items-center gap-3 rounded-md border px-3 py-2">
                <SeverityBadge severity={major.severity} label={t('severity')} />
                <span className="min-w-0 flex-1">{major.severityBoosted ? t('boosted') : t('severity')}</span>
              </li>
              <li className="border-border bg-surface-2 flex min-h-11 items-center gap-3 rounded-md border px-3 py-2">
                <Truck className="text-muted size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{t('sized', { count: major.fleet.targetVehicles })}</span>
              </li>
              {linked > 0 ? (
                <li className="border-border bg-surface-2 flex min-h-11 items-center gap-3 rounded-md border px-3 py-2">
                  <MapIcon className="text-muted size-5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{t('linked', { count: linked })}</span>
                </li>
              ) : null}
              <li className="border-border bg-surface-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2">
                <Coins className="text-credits size-5 shrink-0" aria-hidden />
                <span className="min-w-0">{t('reward')}</span>
                <span className="flex items-center gap-1">
                  <CreditAmount value={major.reward.estimated.min} label={tc('credits')} />
                  <span className="text-subtle">–</span>
                  <CreditAmount value={major.reward.estimated.max} label={tc('credits')} />
                </span>
              </li>
            </ul>
            <p className="text-warning max-w-md text-xs">{t('hint')}</p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 px-5 md:flex-row-reverse">
            <Button
              size="lg"
              className="bg-major hover:bg-major/90 h-12 w-full text-base md:flex-1"
              onClick={coordinate}
              autoFocus
              data-testid="major-alert-open"
            >
              <Siren className="size-5" aria-hidden />
              {t('open')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="h-12 w-full md:w-auto"
              onClick={close}
              data-testid="major-alert-close"
            >
              {t('dismiss')}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
