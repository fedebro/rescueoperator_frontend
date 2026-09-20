'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Zap } from 'lucide-react';
import type { z } from 'zod';
import type { SpeedupTarget } from '@/contracts';
import { monetizationApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { track } from '@/lib/analytics';
import { compareAmount, formatClock, parseAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useServerNow } from '@/hooks/use-server-now';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { Button } from '@/components/ui/button';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { useCareerId, usePatchSnapshot, useSnapshot } from '@/features/game/hooks';
import { requestCredits } from './insufficient-credits';

type Target = z.infer<typeof SpeedupTarget>;

export interface SpeedupButtonProps {
  target: Target;
  targetId: string;
  /** When the process ends (ISO). The button hides itself once it has passed. */
  endsAt: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
  onDone?: () => void;
}

/**
 * Which cached resources a finished process changes. The operational snapshot is patched from the command result and
 * kept fresh by realtime events; the domain roots below are REST resources that must be refetched.
 */
export function speedupInvalidations(careerId: string, target: Target, targetId: string): QueryKey[] {
  const always: QueryKey[] = [qk.balance(careerId), qk.ledger(careerId), qk.monetizationRoot(careerId)];
  switch (target) {
    case 'VEHICLE_DELIVERY':
      return [...always, qk.maintenance(careerId)];
    case 'FACILITY_UPGRADE':
      return [...always, qk.facility(careerId, targetId.split(':')[0] ?? targetId), qk.worldRoot(careerId)];
    case 'MAINTENANCE':
      return [...always, qk.maintenance(careerId)];
    case 'SUPPLY_DELIVERY':
      return [...always, qk.inventory(careerId)];
    case 'TRAINING':
    case 'REST':
    case 'ONBOARDING':
      return [...always, qk.personnelRoot(careerId)];
  }
}

function SpeedupDialog({
  target,
  targetId,
  onClose,
  onDone,
}: Pick<SpeedupButtonProps, 'target' | 'targetId' | 'onDone'> & { onClose: () => void }) {
  const t = useTranslations('monetization.speedup');
  const tc = useTranslations('common');
  const careerId = useCareerId();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const patchSnapshot = usePatchSnapshot();
  const catalogName = useCatalogName();
  const { career } = useSnapshot();
  const quote = useQuery({
    queryKey: qk.speedupQuote(careerId, target, targetId),
    queryFn: () => monetizationApi.speedupQuote(careerId, target, targetId),
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 5000, // the price drops as the timer runs
  });
  const confirm = useMutation({
    mutationFn: () => monetizationApi.speedup(careerId, target, targetId),
    onSuccess: (result) => {
      patchSnapshot((s) => ({
        ...s,
        career: result.career ?? s.career,
        vehicles: result.vehicle
          ? s.vehicles.map((v) => (v.id === result.vehicle!.id ? result.vehicle! : v))
          : s.vehicles,
        facilities: result.facility
          ? s.facilities.map((f) => (f.id === result.facility!.id ? result.facility! : f))
          : s.facilities,
      }));
      for (const queryKey of speedupInvalidations(careerId, target, targetId))
        void qc.invalidateQueries({ queryKey });
      track('speedup_used', { target, cost: Number(result.cost) });
      toast({ tone: 'success', title: t('done') });
      onClose();
      onDone?.();
    },
    onError: (e) => {
      if (isApiError(e, 'INSUFFICIENT_CREDITS')) {
        onClose();
        requestCredits(quote.data?.cost ?? '0');
      } else if (isApiError(e, 'INVALID_STATE_TRANSITION') || isApiError(e, 'NOT_FOUND')) {
        // The process ended on its own in the meantime: nothing to pay for.
        toast({ tone: 'info', title: t('alreadyDone') });
        onClose();
      } else toast({ tone: 'danger', title: errorMessage(e) });
    },
  });
  const cost = quote.data?.cost;
  const free = cost !== undefined && parseAmount(cost) === 0n;
  const onConfirm = () => {
    if (cost !== undefined && compareAmount(career.credits, cost) < 0) {
      onClose();
      requestCredits(cost);
    } else confirm.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        title={t('title')}
        description={t('description', { process: catalogName('speedupKind', target) })}
        closeLabel={tc('close')}
        data-testid="speedup-dialog"
      >
        {quote.isLoading ? (
          <Skeleton className="h-20" />
        ) : quote.data ? (
          <dl className="border-border bg-surface-2 grid grid-cols-2 gap-3 rounded-md border p-3 text-sm">
            <div>
              <dt className="text-subtle text-[11px] font-semibold tracking-wide uppercase">
                {t('remaining')}
              </dt>
              <dd className="tabular text-base font-semibold">{formatClock(quote.data.remainingSeconds)}</dd>
            </div>
            <div>
              <dt className="text-subtle text-[11px] font-semibold tracking-wide uppercase">{t('cost')}</dt>
              <dd data-testid="speedup-cost">
                {free ? (
                  <span className="text-success text-base font-semibold">{t('free')}</span>
                ) : (
                  <CreditAmount value={quote.data.cost} label={tc('credits')} size="lg" />
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted text-sm">{t('alreadyDone')}</p>
        )}
        <p className="text-subtle mt-3 text-xs">{t('rule')}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={onConfirm}
            loading={confirm.isPending}
            disabled={!quote.data}
            data-testid="speedup-confirm"
          >
            <Zap className="size-4" aria-hidden />
            {free ? t('confirmFree') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * SLOT (owner: monetization agent) — "finish now" on every MANAGERIAL timer (delivery, construction, maintenance,
 * training, rest, onboarding, supplies). Travel and interventions can never be accelerated (analisi/05 §7.4): the
 * `SpeedupTarget` enum has no value for them, so this button cannot even be mounted there.
 * Always shows the quote (remaining time + cost) before spending. It is a spend of credits the player already owns,
 * so it is available from the start (it is not part of the shop gate).
 */
export function SpeedupButton({
  target,
  targetId,
  endsAt,
  size = 'sm',
  className,
  onDone,
}: SpeedupButtonProps) {
  const t = useTranslations('monetization.speedup');
  const [open, setOpen] = React.useState(false);
  const now = useServerNow(1000, !!endsAt);
  const running = !!endsAt && Date.parse(endsAt) > now;
  if (!running && !open) return null;
  return (
    <>
      {running ? (
        <Button
          variant="outline"
          size={size}
          className={cn('text-credits', size === 'sm' && 'h-7 px-2', className)}
          onClick={(e) => {
            // Often mounted inside clickable rows/cards.
            e.stopPropagation();
            track('speedup_quote_opened', { target });
            setOpen(true);
          }}
          data-testid="speedup-button"
          data-target={target}
        >
          <Zap className="size-3.5" aria-hidden />
          {t('button')}
        </Button>
      ) : null}
      {open ? (
        <SpeedupDialog target={target} targetId={targetId} onClose={() => setOpen(false)} onDone={onDone} />
      ) : null}
    </>
  );
}
