'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import type { MajorIncidentDto } from '@/contracts';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/misc';
import { useOperation } from './hooks';

/**
 * "Operazione di alleanza" over my front (study 09 §5): the coordination view of a major that belongs to an operation
 * gets the collective progress and the way to the shared board.
 */
export function OperationStrip({ major }: { major: MajorIncidentDto }) {
  const t = useTranslations('alliance.operation');
  const tx = useI18nText();
  const router = useRouter();
  const enabled = !!major.allianceOperationId;
  const operation = useOperation(enabled);
  const op = operation.data;
  if (!enabled || !op || op.id !== major.allianceOperationId) return null;
  return (
    <section
      className="border-brand/40 bg-brand/10 flex flex-col gap-2 rounded-md border p-3"
      aria-label={t('eyebrow')}
      data-testid="operation-strip"
      data-operation-id={op.id}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-brand text-xs font-bold tracking-[0.08em] uppercase">{t('eyebrow')}</span>
        <span className="font-semibold">{tx(op.title)}</span>
        <span className="text-muted flex items-center gap-1 text-xs">
          <Users className="size-3.5" aria-hidden />
          {t('joinedCount', { count: op.joinedCount })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => router.push('/game/alliance/operation')}
          data-testid="operation-strip-board"
        >
          {t('openBoard')}
        </Button>
      </div>
      <ProgressBar value={op.progress} label={t('sharedProgress', { pct: Math.round(op.progress * 100) })} />
      <p className="text-muted text-xs">
        {t('sharedProgress', { pct: Math.round(op.progress * 100) })}
        {op.phase ? ` · ${t(`phase.${op.phase}`)}` : ''}
      </p>
    </section>
  );
}
