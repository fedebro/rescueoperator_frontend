'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { LifeBuoy, Star } from 'lucide-react';
import type { SyncSnapshot } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { formatClock } from '@/lib/format';
import { useI18nText } from '@/i18n/use-i18n-text';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Stat } from '@/components/ui/misc';
import { useCareerId, useSnapshot } from './hooks';

/** Shows pending mission outcomes one at a time; acknowledging removes it server-side (so it survives reloads until seen). */
export function OutcomeModal() {
  const careerId = useCareerId();
  const { pendingOutcomes, career, incidents } = useSnapshot();
  const t = useTranslations('game.outcome');
  const tf = useTranslations('families.outcome');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const qc = useQueryClient();
  const outcome = pendingOutcomes[0];
  // The tutorial keeps the modal back until its own OUTCOME step is reached, so the coach text and the modal agree.
  const ack = useMutation({
    mutationFn: (incidentId: string) => gameApi.ackOutcome(careerId, incidentId),
    onMutate: (incidentId) => {
      qc.setQueryData<SyncSnapshot>(qk.sync(careerId), (s) =>
        s ? { ...s, pendingOutcomes: s.pendingOutcomes.filter((o) => o.incidentId !== incidentId) } : s,
      );
    },
    onSuccess: () => {
      if (!career.tutorial.completed && career.tutorial.step === 'OUTCOME')
        void gameApi.tutorialAdvance(careerId, 'BUY_VEHICLE').catch(() => undefined);
    },
  });
  if (!outcome) return null;
  // The reward is paid when on-scene work ends; the incident may stay open while system units (UNG) finish.
  const stillResolving = incidents.some((i) => i.id === outcome.incidentId && i.status === 'RESOLVING');
  const tone = outcome.result === 'SUCCESS' ? 'success' : outcome.result === 'PARTIAL' ? 'warning' : 'danger';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) ack.mutate(outcome.incidentId);
      }}
    >
      <DialogContent
        title={t(`title.${outcome.result}`)}
        description={t('subtitle')}
        closeLabel={tc('close')}
        data-testid="outcome-modal"
      >
        <div className="flex flex-col items-center gap-2 py-2">
          <div
            role="img"
            aria-label={t('stars', { stars: outcome.stars })}
            className="flex gap-1.5"
            data-testid="outcome-stars"
            data-stars={outcome.stars}
          >
            {[1, 2, 3].map((i) => (
              <Star
                key={i}
                aria-hidden
                className={cn('size-10', i <= outcome.stars ? 'fill-credits text-credits' : 'text-surface-4')}
              />
            ))}
          </div>
          <Badge tone={tone}>{t(`result.${outcome.result}`)}</Badge>
        </div>
        <dl className="border-border bg-surface-2 mt-3 flex flex-col gap-2 rounded-md border p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t('gross')}</dt>
            <dd>
              <CreditAmount value={outcome.grossCredits} label={tc('credits')} tone="plain" />
            </dd>
          </div>
          {outcome.costs
            .filter((c) => c.amount !== '0')
            .map((c) => (
              <div key={c.code} className="flex justify-between">
                <dt className="text-muted">
                  {t.has(`cost.${c.code}` as never) ? t(`cost.${c.code}` as never) : c.code}
                </dt>
                <dd>
                  <CreditAmount value={`-${c.amount}`} sign label={tc('credits')} />
                </dd>
              </div>
            ))}
          <div className="border-border mt-1 flex items-center justify-between border-t pt-3">
            <dt className="text-fg font-semibold">{t('net')}</dt>
            <dd data-testid="outcome-net">
              <CreditAmount value={outcome.netCredits} sign label={tc('credits')} size="lg" />
            </dd>
          </div>
        </dl>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label={t('xp')} value={<span className="text-xp">+{outcome.xp}</span>} />
          <Stat label={t('response')} value={formatClock(outcome.responseSeconds)} />
          <Stat label={t('duration')} value={formatClock(outcome.durationSeconds)} />
        </div>
        {outcome.notes.length > 0 ? (
          <ul className="text-muted mt-4 flex flex-col gap-1 text-sm">
            {outcome.notes.map((n, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="text-skyline">
                  •
                </span>
                {tx(n)}
              </li>
            ))}
          </ul>
        ) : null}
        {stillResolving ? (
          <p
            className="border-info/40 bg-info/10 mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed"
            data-testid="outcome-still-resolving"
          >
            <LifeBuoy className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
            {tf('stillResolving')}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => ack.mutate(outcome.incidentId)}
            data-testid="outcome-continue"
          >
            {t('continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
