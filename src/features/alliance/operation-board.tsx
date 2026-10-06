'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, MessageSquare, Siren, Truck } from 'lucide-react';
import type { AllianceOperationDto, AllianceOperationParticipantDto } from '@/contracts';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Card, EmptyState, ProgressBar, SectionTitle, Skeleton, Stat } from '@/components/ui/misc';
import { useCareerId } from '@/features/game/hooks';
import { useOpenMajor } from '@/features/major/hooks';
import { ColumnComposer } from './column-composer';
import { useAllianceHome, useOperation, useOperationHistory } from './hooks';
import { JoinButtons, OperationStatusBadge, OutcomeBadge } from './operation-card';

function FrontRow({
  row,
  mine,
  onSendColumn,
}: {
  row: AllianceOperationParticipantDto;
  mine: boolean;
  onSendColumn: (requestId: string) => void;
}) {
  const t = useTranslations('alliance.operation');
  const front = row.front;
  return (
    <li
      className={cn('flex flex-col gap-1.5 py-2', mine && 'bg-brand/5 -mx-2 rounded-md px-2')}
      data-testid="operation-front"
      data-status={row.status}
      data-mine={mine}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">
          {row.participant.directorName ?? t('deletedDirector')}
          {mine ? <span className="text-muted"> · {t('you')}</span> : null}
        </span>
        <Badge tone={row.status === 'JOINED' ? 'success' : row.status === 'DECLINED' ? 'neutral' : 'warning'}>
          {t(`participant.${row.status}`)}
        </Badge>
        {front ? (
          <span className="text-muted text-xs">
            {t(`phase.${front.phase}`)} ·{' '}
            {t('sectors', { closed: front.sectorsClosed, total: front.sectors })} ·{' '}
            {t('coverage', { pct: Math.round(front.coverage * 100) })}
          </span>
        ) : null}
        {front?.ended ? <Badge tone="neutral">{t('frontEnded')}</Badge> : null}
      </div>
      {front ? (
        <ProgressBar
          value={front.progress}
          label={t('progress', { pct: Math.round(front.progress * 100) })}
          tone={front.ended ? 'success' : 'brand'}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted">
          {t('contribution', {
            incidents: row.contribution.incidentsClosed,
            columns: row.contribution.usefulColumns,
            points: row.contribution.points,
          })}
        </span>
        {front?.openAidRequestId && !mine ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onSendColumn(front.openAidRequestId!)}
            data-testid="front-send-column"
          >
            <Truck className="size-4" aria-hidden />
            {t('needsHelp')}
          </Button>
        ) : null}
        {front?.openAidRequestId && mine ? (
          <span className="text-warning" data-testid="front-my-request">
            {t('myRequestOpen')}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function RewardsTable({ op, careerId }: { op: AllianceOperationDto; careerId: string }) {
  const t = useTranslations('alliance.operation');
  const tc = useTranslations('common');
  const joined = op.participants.filter((p) => p.status === 'JOINED');
  return (
    <ul className="divide-border divide-y" data-testid="operation-rewards">
      {joined.map((p) => (
        <li
          key={p.participant.careerId ?? p.participant.directorName ?? 'x'}
          className="flex flex-wrap items-center gap-3 py-2 text-sm"
          data-mine={p.participant.careerId === careerId}
        >
          <span className="min-w-0 flex-1 font-semibold">
            {p.participant.directorName ?? t('deletedDirector')}
          </span>
          <span className="text-muted text-xs">
            {t('contribution', {
              incidents: p.contribution.incidentsClosed,
              columns: p.contribution.usefulColumns,
              points: p.contribution.points,
            })}
          </span>
          {p.reward.eligible && p.reward.credits !== null ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-muted">×{p.reward.multiplier ?? 1}</span>
              <CreditAmount value={p.reward.credits} label={tc('credits')} />
              {p.reward.xp ? <span className="text-xp tabular">+{p.reward.xp} XP</span> : null}
            </span>
          ) : (
            <span className="text-muted text-xs">{t('notEligible')}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function HistoryList() {
  const t = useTranslations('alliance.operation');
  const tx = useI18nText();
  const locale = useLocale();
  const history = useOperationHistory();
  if (history.isPending) return <Skeleton className="h-16" />;
  const items = history.data?.pages.flatMap((p) => p.data) ?? [];
  if (items.length === 0)
    return <EmptyState title={t('historyEmptyTitle')} description={t('historyEmptyBody')} />;
  return (
    <ul className="divide-border divide-y" data-testid="operation-history">
      {items.map((op) => (
        <li
          key={op.id}
          className="flex flex-wrap items-center gap-3 py-2 text-sm"
          data-outcome={op.outcome ?? ''}
        >
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{tx(op.title)}</span>
            <span className="text-muted block text-xs">
              {op.endedAt ? formatDateTime(op.endedAt, locale) : ''} ·{' '}
              {t('joinedCount', { count: op.joinedCount })}
            </span>
          </span>
          {op.outcome ? <OutcomeBadge outcome={op.outcome} /> : <OperationStatusBadge status={op.status} />}
          {op.reward.allianceXp !== null ? (
            <span className="text-xp tabular text-xs">+{op.reward.allianceXp} XP</span>
          ) : null}
        </li>
      ))}
      {history.hasNextPage ? (
        <li className="py-2 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void history.fetchNextPage()}
            loading={history.isFetchingNextPage}
          >
            {t('more')}
          </Button>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The shared board of an alliance operation (study 07 §4, 09 §5): overall progress and clock, one row per front with
 * coverage and open requests, columns in flight, Partecipa for late joiners, the outcome with every contribution and
 * reward; the trophy board (history) below.
 */
export function OperationBoardScreen() {
  const t = useTranslations('alliance.operation');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const router = useRouter();
  const careerId = useCareerId();
  const openMajor = useOpenMajor();
  const home = useAllianceHome();
  const enabled = home.data?.config.flags.operations === true && !!home.data.alliance;
  const operation = useOperation(enabled);
  const [compose, setCompose] = React.useState<string | null>(null);
  const op = operation.data ?? null;
  const running = op?.status === 'ALERT' || op?.status === 'ACTIVE';
  return (
    <div className="scroll-y flex h-full min-h-0 flex-col gap-4 p-4" data-testid="operation-board">
      <header className="flex items-center gap-2">
        <IconButton
          label={tc('back')}
          onClick={() => router.push('/game/alliance')}
          data-testid="operation-back"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </IconButton>
        <div className="min-w-0 flex-1">
          <p className="text-brand text-xs font-bold tracking-[0.08em] uppercase">{t('eyebrow')}</p>
          <h1 className="font-display truncate text-xl font-bold">{op ? tx(op.title) : t('boardTitle')}</h1>
        </div>
        {op ? <OperationStatusBadge status={op.status} /> : null}
      </header>
      {home.isPending || (enabled && operation.isPending) ? (
        <Skeleton className="h-40" />
      ) : !enabled ? (
        <EmptyState title={t('unavailable')} />
      ) : op ? (
        <>
          <Card className="flex flex-col gap-3" data-testid="operation-summary">
            <p className="text-muted text-sm">{tx(op.description)}</p>
            {op.status === 'ALERT' ? (
              <p className="text-sm">
                {t('alertEndsIn')}{' '}
                <Countdown to={op.alertEndsAt} doneLabel="0:00" className="tabular font-semibold" />
              </p>
            ) : null}
            {op.status === 'ACTIVE' || op.status === 'ENDED' ? (
              <ProgressBar
                value={op.progress}
                label={t('progress', { pct: Math.round(op.progress * 100) })}
                tone={op.status === 'ENDED' ? 'success' : 'brand'}
              />
            ) : null}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t('phaseLabel')} value={op.phase ? t(`phase.${op.phase}`) : '—'} />
              <Stat label={t('joined')} value={<span className="tabular">{op.joinedCount}</span>} />
              <Stat
                label={t('clock')}
                value={
                  op.status === 'ACTIVE' && op.endsAt ? (
                    <Countdown to={op.endsAt} doneLabel="0:00" className="tabular" />
                  ) : (
                    <span>{t('duration', { minutes: op.durationMinutes })}</span>
                  )
                }
              />
              <Stat
                label={t('lateJoin')}
                value={
                  op.status === 'ACTIVE' && op.lateJoinUntil ? (
                    <Countdown to={op.lateJoinUntil} doneLabel={t('closed')} className="tabular" />
                  ) : (
                    <span>—</span>
                  )
                }
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {running ? <JoinButtons operation={op} /> : null}
              {op.me.majorId && op.status === 'ACTIVE' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openMajor(op.me.majorId!)}
                  data-testid="operation-my-front"
                >
                  <Siren className="size-4" aria-hidden />
                  {t('myFront')}
                </Button>
              ) : null}
              {op.channelId ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/game/alliance/chat?channel=${op.channelId}`)}
                  data-testid="operation-chat"
                >
                  <MessageSquare className="size-4" aria-hidden />
                  {t('chat')}
                </Button>
              ) : null}
            </div>
          </Card>
          {op.status === 'ENDED' && op.outcome ? (
            <Card className="flex flex-col gap-3" data-testid="operation-outcome-card">
              <SectionTitle>{t('outcomeTitle')}</SectionTitle>
              <div className="flex flex-wrap items-center gap-3">
                <OutcomeBadge outcome={op.outcome} />
                {op.reward.allianceXp !== null ? (
                  <span className="text-xp tabular font-semibold">+{op.reward.allianceXp} XP</span>
                ) : null}
                {op.reward.quality !== null ? (
                  <span className="text-muted text-sm">
                    {t('quality', { pct: Math.round(op.reward.quality * 100) })}
                  </span>
                ) : null}
                {op.reward.trophy ? <Badge tone="xp">{t('trophy')}</Badge> : null}
              </div>
              <RewardsTable op={op} careerId={careerId} />
            </Card>
          ) : null}
          <Card>
            <SectionTitle>{t('fronts')}</SectionTitle>
            <ul className="divide-border divide-y" data-testid="operation-fronts">
              {op.participants.map((p) => (
                <FrontRow
                  key={p.participant.careerId ?? p.participant.directorName ?? 'x'}
                  row={p}
                  mine={p.participant.careerId === careerId}
                  onSendColumn={setCompose}
                />
              ))}
            </ul>
          </Card>
          <Card>
            <SectionTitle>{t('columnsInFlight')}</SectionTitle>
            {op.columnsInFlight.length === 0 ? (
              <p className="text-muted text-sm">{t('noColumns')}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm" data-testid="operation-columns">
                {op.columnsInFlight.map((c) => (
                  <li key={c.columnId} className="flex flex-wrap items-center gap-2">
                    <Truck className="text-muted size-4" aria-hidden />
                    <span>
                      {t('columnLine', {
                        helper: c.helper.directorName ?? '',
                        requester: c.requester.directorName ?? '',
                      })}
                    </span>
                    <Countdown to={c.arriveAt} doneLabel={t('arrived')} className="tabular text-xs" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
      {enabled ? (
        <Card>
          <SectionTitle>{t('history')}</SectionTitle>
          <HistoryList />
        </Card>
      ) : null}
      <ColumnComposer requestId={compose} onOpenChange={(o) => !o && setCompose(null)} />
    </div>
  );
}
