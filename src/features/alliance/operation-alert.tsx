'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { Clock, Siren, Users } from 'lucide-react';
import { track } from '@/lib/analytics';
import { playCue } from '@/lib/sound';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { MAJOR_VIBRATION } from '@/features/major/major-alert';
import { useOperation } from './hooks';
import { useOperationDecision } from './operation-card';
import { allianceOf } from './snapshot';

const ACK_KEY = (careerId: string) => `rc-alliance-operation-ack:${careerId}`;
function acknowledged(careerId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ACK_KEY(careerId)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function acknowledge(careerId: string, operationId: string): void {
  try {
    const set = acknowledged(careerId);
    set.add(operationId);
    localStorage.setItem(ACK_KEY(careerId), JSON.stringify([...set].slice(-20)));
  } catch {
    /* storage unavailable */
  }
}
function vibrate(): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    navigator.vibrate(MAJOR_VIBRATION);
  } catch {
    /* optional */
  }
}

/**
 * The full-screen alert of an alliance operation (study 07 §3.2, 09 §5 — the major alert's shape): scenario, duration, who
 * already joined, Partecipa / Non ora. Mounted by the game layout; shown once per operation and device while the alert
 * window is open and the player has not answered.
 */
export function OperationAlertHost() {
  const t = useTranslations('alliance.operation');
  const tx = useI18nText();
  const careerId = useCareerId();
  const snapshot = useSnapshot();
  const ref = allianceOf(snapshot);
  const enabled = !!ref?.operationId && snapshot.featureFlags.alliance_operations === true;
  const operation = useOperation(enabled).data;
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const { join, decline } = useOperationDecision();
  const op = enabled ? (operation ?? null) : null;
  const open =
    !!op &&
    op.status === 'ALERT' &&
    op.me.status !== 'JOINED' &&
    op.me.status !== 'DECLINED' &&
    dismissed !== op.id &&
    !acknowledged(careerId).has(op.id);

  const announced = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open || !op || announced.current === op.id) return;
    announced.current = op.id;
    track('alliance_operation_alert_shown', { scenarioCode: op.scenarioCode });
    vibrate();
    if (snapshot.featureFlags.soundEffects !== false) playCue('major');
  }, [open, op, snapshot.featureFlags.soundEffects]);

  if (!open || !op) return null;
  const close = () => {
    acknowledge(careerId, op.id);
    setDismissed(op.id);
  };
  const joinedNames = op.participants
    .filter((p) => p.status === 'JOINED')
    .map((p) => p.participant.directorName)
    .filter((n): n is string => !!n);
  return (
    <DialogPrimitive.Root open onOpenChange={(value) => (value ? undefined : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in bg-overlay fixed inset-0 z-[80] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          role="alertdialog"
          aria-describedby="operation-alert-description"
          data-testid="operation-alert"
          data-operation-id={op.id}
          className={cn(
            'animate-slide-up border-brand/60 fixed inset-0 z-[81] flex flex-col overflow-y-auto border-2 outline-none',
            'bg-[radial-gradient(ellipse_at_top,rgb(43_122_255/0.28),transparent_60%),var(--rc-surface-1)]',
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
              className="bg-brand text-inverse grid size-24 place-items-center rounded-full md:size-20"
            >
              <Siren className="size-12 md:size-10" />
            </span>
            <div className="flex flex-col gap-2">
              <p className="text-brand text-xs font-bold tracking-[0.08em] uppercase">{t('eyebrow')}</p>
              <DialogPrimitive.Title
                className="font-display text-2xl leading-tight font-extrabold text-balance md:text-3xl"
                data-testid="operation-alert-title"
              >
                {tx(op.alert)}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="operation-alert-description"
                className="text-muted mx-auto max-w-md text-sm leading-relaxed"
              >
                {tx(op.description)}
              </DialogPrimitive.Description>
            </div>
            <ul className="flex w-full max-w-md flex-col gap-2 text-left text-sm">
              <li className="border-border bg-surface-2 flex min-h-11 items-center gap-3 rounded-md border px-3 py-2">
                <Clock className="text-muted size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  {t('duration', { minutes: op.durationMinutes })} · {t('alertEndsIn')}{' '}
                  <Countdown to={op.alertEndsAt} doneLabel="0:00" className="tabular font-semibold" />
                </span>
              </li>
              <li className="border-border bg-surface-2 flex min-h-11 items-center gap-3 rounded-md border px-3 py-2">
                <Users className="text-muted size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1" data-testid="operation-alert-joined">
                  {t('joinedCount', { count: op.joinedCount })}
                  {joinedNames.length ? `: ${joinedNames.join(', ')}` : ''}
                </span>
              </li>
            </ul>
            {!op.me.canJoin && op.me.blockedReason ? (
              <p className="text-warning max-w-md text-xs" data-testid="operation-alert-blocked">
                {t(`blocked.${op.me.blockedReason}`)}
              </p>
            ) : (
              <p className="text-subtle max-w-md text-xs">{t('alertHint')}</p>
            )}
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 px-5 md:flex-row-reverse">
            <Button
              size="lg"
              className="h-12 w-full text-base md:flex-1"
              onClick={() => join.mutate(undefined, { onSuccess: close })}
              loading={join.isPending}
              disabled={!op.me.canJoin}
              autoFocus
              data-testid="operation-alert-join"
            >
              <Siren className="size-5" aria-hidden />
              {t('join')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="h-12 w-full md:w-auto"
              onClick={() => (op.me.canJoin ? decline.mutate(undefined, { onSuccess: close }) : close())}
              loading={decline.isPending}
              data-testid="operation-alert-decline"
            >
              {t('decline')}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
