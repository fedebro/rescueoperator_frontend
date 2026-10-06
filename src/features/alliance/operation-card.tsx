'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Medal, Siren, Users } from 'lucide-react';
import type { AllianceOperationDto, AllianceOperationOutcome } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { operationApi } from '@/lib/api/alliance';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { ProgressBar, Skeleton } from '@/components/ui/misc';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useOpenMajor } from '@/features/major/hooks';
import { useAllianceMutation, useOperation } from './hooks';

export const OUTCOME_TONE: Record<AllianceOperationOutcome, 'xp' | 'neutral' | 'warning' | 'danger'> = {
  GOLD: 'xp',
  SILVER: 'neutral',
  BRONZE: 'warning',
  FAILED: 'danger',
};

export function OutcomeBadge({ outcome }: { outcome: AllianceOperationOutcome }) {
  const t = useTranslations('alliance.operation');
  return (
    <Badge tone={OUTCOME_TONE[outcome]} data-testid="operation-outcome" data-outcome={outcome}>
      <Medal className="size-3" aria-hidden />
      {t(`outcome.${outcome}`)}
    </Badge>
  );
}

export function OperationStatusBadge({ status }: { status: AllianceOperationDto['status'] }) {
  const t = useTranslations('alliance.operation');
  const tone =
    status === 'ALERT'
      ? 'danger'
      : status === 'ACTIVE'
        ? 'brand'
        : status === 'ENDED'
          ? 'success'
          : 'neutral';
  return (
    <Badge tone={tone} data-testid="operation-status" data-status={status}>
      {t(`status.${status}`)}
    </Badge>
  );
}

/** Partecipa / Non ora (07 §3.2), with the server's reason when neither is possible. */
export function useOperationDecision() {
  const t = useTranslations('alliance.operation');
  const invalidate = (careerId: string) => [
    qk.allianceOperation(careerId),
    qk.allianceHome(careerId),
    qk.allianceChat(careerId),
  ];
  const join = useAllianceMutation((careerId) => operationApi.join(careerId), {
    successToast: t('joinedToast'),
    invalidate,
  });
  const decline = useAllianceMutation((careerId) => operationApi.decline(careerId), {
    successToast: t('declinedToast'),
    invalidate,
  });
  return { join, decline };
}

export function JoinButtons({
  operation,
  size = 'sm',
  onDone,
}: {
  operation: AllianceOperationDto;
  size?: 'sm' | 'md' | 'lg';
  onDone?: () => void;
}) {
  const t = useTranslations('alliance.operation');
  const { join, decline } = useOperationDecision();
  const me = operation.me;
  if (me.status === 'JOINED')
    return (
      <Badge tone="success" data-testid="operation-me-joined">
        {t('youJoined')}
      </Badge>
    );
  if (me.status === 'DECLINED')
    return (
      <span className="text-muted text-xs" data-testid="operation-me-declined">
        {t('youDeclined')}
      </span>
    );
  if (!me.canJoin)
    return (
      <span
        className="text-warning text-xs"
        data-testid="operation-blocked"
        data-reason={me.blockedReason ?? ''}
      >
        {me.blockedReason ? t(`blocked.${me.blockedReason}`) : t('blocked.NOT_RUNNING')}
      </span>
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size={size}
        onClick={() => join.mutate(undefined, { onSuccess: onDone })}
        loading={join.isPending}
        data-testid="operation-join"
      >
        <Siren className="size-4" aria-hidden />
        {t('join')}
      </Button>
      {operation.status === 'ALERT' ? (
        <Button
          size={size}
          variant="secondary"
          onClick={() => decline.mutate(undefined, { onSuccess: onDone })}
          loading={decline.isPending}
          data-testid="operation-decline"
        >
          {t('decline')}
        </Button>
      ) : null}
    </div>
  );
}

/** The body of the "Operazione di alleanza" card in the overview (09 §5): the running one, or the last outcome. */
export function OperationSection() {
  const t = useTranslations('alliance.operation');
  const tx = useI18nText();
  const router = useRouter();
  const openMajor = useOpenMajor();
  const operation = useOperation();
  if (operation.isPending) return <Skeleton className="h-20" />;
  const op = operation.data;
  const board = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => router.push('/game/alliance/operation')}
      data-testid="operation-open-board"
    >
      {op ? t('openBoard') : t('history')}
    </Button>
  );
  if (!op)
    return (
      <div className="flex flex-col gap-2" data-testid="operation-none">
        <p className="text-muted text-sm">{t('none')}</p>
        <p className="text-subtle text-xs">{t('noneHint')}</p>
        <div>{board}</div>
      </div>
    );
  return (
    <div className="flex flex-col gap-3" data-testid="operation-card" data-status={op.status}>
      <div className="flex flex-wrap items-center gap-2">
        <OperationStatusBadge status={op.status} />
        <span className="font-semibold">{tx(op.title)}</span>
        {op.outcome ? <OutcomeBadge outcome={op.outcome} /> : null}
      </div>
      {op.status === 'ALERT' ? (
        <p className="text-sm">
          {t('alertEndsIn')}{' '}
          <Countdown to={op.alertEndsAt} doneLabel="0:00" className="tabular font-semibold" /> ·{' '}
          <Users className="inline size-4" aria-hidden /> {t('joinedCount', { count: op.joinedCount })}
        </p>
      ) : null}
      {op.status === 'ACTIVE' ? (
        <>
          <ProgressBar value={op.progress} label={t('progress', { pct: Math.round(op.progress * 100) })} />
          <p className="text-muted text-xs">
            {op.phase ? `${t(`phase.${op.phase}`)} · ` : ''}
            {t('joinedCount', { count: op.joinedCount })} · {t('endsIn')}{' '}
            {op.endsAt ? <Countdown to={op.endsAt} doneLabel="0:00" className="tabular" /> : null}
          </p>
        </>
      ) : null}
      {op.status === 'ENDED' && op.reward.allianceXp !== null ? (
        <p className="text-muted text-xs">{t('endedSummary', { xp: op.reward.allianceXp })}</p>
      ) : null}
      {op.status === 'CANCELLED' ? <p className="text-muted text-xs">{t('cancelledBody')}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {op.status === 'ALERT' || op.status === 'ACTIVE' ? <JoinButtons operation={op} /> : null}
        {op.me.majorId && op.status === 'ACTIVE' ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openMajor(op.me.majorId!)}
            data-testid="operation-my-front"
          >
            {t('myFront')}
          </Button>
        ) : null}
        {board}
      </div>
    </div>
  );
}
