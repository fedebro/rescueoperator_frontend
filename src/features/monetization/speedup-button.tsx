'use client';
import * as React from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Zap } from 'lucide-react';
import type { z } from 'zod';
import type { SpeedupResult, SpeedupTarget } from '@/contracts';
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
  // Polling stops as soon as the process is paid for or finishes by itself: the server answers
  // INVALID_STATE_TRANSITION for a target with nothing running, and repeating that is pure console noise.
  const [settled, setSettled] = React.useState(false);
  const quote = useQuery({
    queryKey: qk.speedupQuote(careerId, target, targetId),
    queryFn: () => monetizationApi.speedupQuote(careerId, target, targetId),
    staleTime: 0,
    gcTime: 0,
    enabled: !settled,
    retry: false,
    refetchInterval: (q) => (q.state.status === 'error' ? false : 5000), // the price drops as the timer runs
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
    } else {
      setSettled(true); // the quote for this target is about to become meaningless
      confirm.mutate();
    }
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
        {quote.isLoading && !settled ? (
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

export interface SpeedupAllItem {
  target: Target;
  targetId: string;
  /** When the process ends (ISO). Items whose timer already passed are ignored. */
  endsAt: string | null | undefined;
}

export interface SpeedupAllButtonProps {
  /** Candidate processes; only the ones still running are quoted and finished. */
  items: SpeedupAllItem[];
  /** Below this many running items the bulk action adds nothing over the per-item button, so it stays hidden. */
  minItems?: number;
  size?: 'sm' | 'md';
  className?: string;
  onDone?: () => void;
}

function SpeedupAllDialog({
  items,
  onClose,
  onDone,
}: { items: SpeedupAllItem[] } & Pick<SpeedupAllButtonProps, 'onDone'> & { onClose: () => void }) {
  const t = useTranslations('monetization.speedup');
  const tc = useTranslations('common');
  const careerId = useCareerId();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const patchSnapshot = usePatchSnapshot();
  const { career } = useSnapshot();
  // Same rationale as SpeedupDialog: stop polling once the batch is on its way to the server.
  const [settled, setSettled] = React.useState(false);
  const quotes = useQueries({
    queries: items.map((item) => ({
      queryKey: qk.speedupQuote(careerId, item.target, item.targetId),
      queryFn: () => monetizationApi.speedupQuote(careerId, item.target, item.targetId),
      staleTime: 0,
      gcTime: 0,
      enabled: !settled,
      retry: false,
      refetchInterval: (q: { state: { status: string } }) => (q.state.status === 'error' ? false : 5000),
    })),
    combine: (results) => ({
      isLoading: results.some((r) => r.isLoading),
      data: results.every((r) => r.data !== undefined) ? results.map((r) => r.data!) : null,
    }),
  });
  const total = (quotes.data ?? []).reduce((sum, q) => sum + parseAmount(q.cost), 0n);
  const free = quotes.data !== null && total === 0n;

  const confirm = useMutation({
    mutationFn: () =>
      Promise.allSettled(items.map((item) => monetizationApi.speedup(careerId, item.target, item.targetId))),
    onSuccess: (results) => {
      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<z.infer<typeof SpeedupResult>> => r.status === 'fulfilled',
      );
      for (const { value } of fulfilled) {
        patchSnapshot((s) => ({
          ...s,
          career: value.career ?? s.career,
          vehicles: value.vehicle
            ? s.vehicles.map((v) => (v.id === value.vehicle!.id ? value.vehicle! : v))
            : s.vehicles,
          facilities: value.facility
            ? s.facilities.map((f) => (f.id === value.facility!.id ? value.facility! : f))
            : s.facilities,
        }));
      }
      const keys = new Map<string, QueryKey>();
      for (const item of items)
        for (const key of speedupInvalidations(careerId, item.target, item.targetId))
          keys.set(key.join('|'), key);
      for (const key of keys.values()) void qc.invalidateQueries({ queryKey: key });
      track('speedup_used_bulk', { count: fulfilled.length, total: items.length });
      if (fulfilled.length === items.length)
        toast({ tone: 'success', title: t('allDone', { count: fulfilled.length }) });
      else if (fulfilled.length > 0)
        toast({ tone: 'info', title: t('allPartial', { done: fulfilled.length, count: items.length }) });
      else toast({ tone: 'danger', title: t('allFailed') });
      onClose();
      onDone?.();
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const onConfirm = () => {
    if (quotes.data && compareAmount(career.credits, total.toString()) < 0) {
      onClose();
      requestCredits(total.toString());
    } else {
      setSettled(true); // the individual quotes are about to become meaningless
      confirm.mutate();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        title={t('allTitle')}
        description={t('allDescription', { count: items.length })}
        closeLabel={tc('close')}
        data-testid="speedup-all-dialog"
      >
        {quotes.isLoading && !settled ? (
          <Skeleton className="h-20" />
        ) : quotes.data ? (
          <dl className="border-border bg-surface-2 rounded-md border p-3 text-sm">
            <dt className="text-subtle text-[11px] font-semibold tracking-wide uppercase">{t('allCost')}</dt>
            <dd data-testid="speedup-all-cost">
              {free ? (
                <span className="text-success text-base font-semibold">{t('free')}</span>
              ) : (
                <CreditAmount value={total.toString()} label={tc('credits')} size="lg" />
              )}
            </dd>
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
            disabled={!quotes.data}
            data-testid="speedup-all-confirm"
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
 * Bulk "finish everything now" (client-side aggregation, D-44): sums each running item's own quote and, on confirm,
 * fires the existing single-target `POST /speedups` once per item (`Promise.allSettled`, so one failure — e.g. a
 * process that finished on its own a second earlier — never blocks the rest). There is deliberately no batch
 * endpoint: the single-target command already re-derives capacity/lock-ordering per aggregate under its own
 * transaction, which a naive bulk command would have to duplicate and could get wrong.
 * Generic over `target` so any screen with several concurrent speed-up-able items (trainings, deliveries, repairs…)
 * can reuse it; only the training screen mounts it today.
 */
export function SpeedupAllButton({
  items,
  minItems = 2,
  size = 'sm',
  className,
  onDone,
}: SpeedupAllButtonProps) {
  const t = useTranslations('monetization.speedup');
  const now = useServerNow(1000, items.length > 0);
  const running = items.filter((item) => !!item.endsAt && Date.parse(item.endsAt) > now);
  // Frozen at click time: a timer completing on its own while the dialog is open must not resize the batch mid-flight.
  const [dialogItems, setDialogItems] = React.useState<SpeedupAllItem[] | null>(null);
  if (running.length < minItems && !dialogItems) return null;
  return (
    <>
      <Button
        variant="outline"
        size={size}
        className={cn('text-credits', size === 'sm' && 'h-7 px-2', className)}
        onClick={() => {
          track('speedup_all_opened', { count: running.length });
          setDialogItems(running);
        }}
        data-testid="speedup-all-button"
      >
        <Zap className="size-3.5" aria-hidden />
        {t('allButton', { count: running.length })}
      </Button>
      {dialogItems ? (
        <SpeedupAllDialog items={dialogItems} onClose={() => setDialogItems(null)} onDone={onDone} />
      ) : null}
    </>
  );
}
