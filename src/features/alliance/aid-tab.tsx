'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Truck } from 'lucide-react';
import type { AidColumnDto, AllianceHomeDto } from '@/contracts';
import { aidApi } from '@/lib/api/alliance';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useUiStore } from '@/stores/ui';
import { useSnapshot } from '@/features/game/hooks';
import { incidentScene } from '@/features/water/water';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { StatusChip } from '@/components/ui/status-chip';
import { TimeAgo } from '@/components/ui/time-ago';
import { AidRequestCard } from './aid-request-card';
import { ColumnComposer } from './column-composer';
import { useAidColumns, useAidRequests, useAllianceMutation } from './hooks';

/** One of my columns (given) or one towards me (received): status, countdown, reward, "Richiama". */
export function ColumnRow({
  column,
  onRecall,
  recalling,
}: {
  column: AidColumnDto;
  onRecall?: (id: string) => void;
  recalling?: boolean;
}) {
  const t = useTranslations('alliance.aid');
  const ts = useTranslations('alliance.aid.columnStatus');
  const tx = useI18nText();
  const active = column.status === 'EN_ROUTE' || column.status === 'ON_SCENE';
  const other = column.mine ? column.requester : column.helper;
  return (
    <li
      className="flex flex-col gap-1.5 py-2.5"
      data-testid="aid-column"
      data-column-id={column.id}
      data-status={column.status}
      data-mine={column.mine}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Truck
          className={cn('size-4 shrink-0', column.status === 'ON_SCENE' ? 'text-success' : 'text-info')}
          aria-hidden
        />
        <span className="font-semibold">
          {column.mine
            ? t('columnTo', { name: other.directorName ?? '' })
            : t('columnFrom', { name: other.directorName ?? '' })}
        </span>
        <StatusChip status={column.status} label={ts(column.status)} />
        <span className="text-muted min-w-0 flex-1 truncate text-xs">{tx(column.incident.title)}</span>
        {column.status === 'EN_ROUTE' ? (
          <Countdown to={column.arriveAt} doneLabel="…" className="text-info text-xs" />
        ) : null}
        {column.status === 'ON_SCENE' && column.maxStayUntil ? (
          <Countdown to={column.maxStayUntil} doneLabel="…" className="text-muted text-xs" />
        ) : null}
        {(column.status === 'RETURNING' || column.status === 'RECALLED' || column.status === 'ABORTED') &&
        column.returnAt ? (
          <Countdown to={column.returnAt} doneLabel="…" className="text-muted text-xs" />
        ) : null}
        {column.status === 'RETURNED' ? (
          <TimeAgo at={column.returnedAt ?? column.departedAt} className="text-subtle text-xs" />
        ) : null}
      </div>
      <p className="text-muted flex flex-wrap items-center gap-x-2 text-xs">
        <span>{column.items.map((i) => i.callSign).join(', ')}</span>
        {column.reward.status !== 'PENDING' && column.mine ? (
          <span
            className="flex items-center gap-1"
            data-testid="column-reward"
            data-reward={column.reward.status}
          >
            <Badge
              tone={
                column.reward.status === 'PAID'
                  ? 'success'
                  : column.reward.status === 'UNDER_REVIEW'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {t(`reward.${column.reward.status}`)}
            </Badge>
            {column.reward.credits && column.reward.credits !== '0' ? (
              <CreditAmount value={column.reward.credits} label={t('rewardLabel')} sign />
            ) : null}
          </span>
        ) : null}
      </p>
      {active && column.mine && onRecall ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRecall(column.id)}
            loading={recalling}
            data-testid="column-recall"
          >
            {t('recall')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** Mutuo soccorso (study 09 §2.2): open requests, my columns in flight, the history of aid given and received. */
export function AidTab({ home, focusRequestId }: { home: AllianceHomeDto; focusRequestId?: string | null }) {
  const t = useTranslations('alliance.aid');
  const router = useRouter();
  const { incidents } = useSnapshot();
  const select = useUiStore((s) => s.select);
  const open = useAidRequests('OPEN');
  const active = useAidColumns('ALL', true);
  const history = useAidColumns('ALL', false);
  const [manualCompose, setManualCompose] = React.useState<string | null>(null);
  const [dismissedFocus, setDismissedFocus] = React.useState<string | null>(null);
  const recall = useAllianceMutation((careerId, id: string) => aidApi.recall(careerId, id), {
    successToast: t('recalled'),
  });
  const requests = React.useMemo(() => open.data?.pages.flatMap((p) => p.data) ?? [], [open.data]);
  const activeColumns = active.data?.pages.flatMap((p) => p.data) ?? [];
  const past = (history.data?.pages.flatMap((p) => p.data) ?? []).filter(
    (c) => !activeColumns.some((a) => a.id === c.id),
  );
  // A notification / push landing on one request I can help: its composer opens by itself, once (no effect needed).
  const focusedRequest =
    focusRequestId && focusRequestId !== dismissedFocus
      ? requests.find((r) => r.id === focusRequestId && r.viewer.canSend)
      : undefined;
  const compose = manualCompose ?? focusedRequest?.id ?? null;
  const setCompose = (id: string | null) => {
    setManualCompose(id);
    if (id === null && focusRequestId) setDismissedFocus(focusRequestId);
  };
  const openIncident = (incidentId: string) => {
    const incident = incidents.find((i) => i.id === incidentId);
    if (!incident) return;
    select({ kind: 'incident', id: incident.id }, { focus: incidentScene(incident) });
    router.push('/game');
  };
  return (
    <div className="flex flex-col gap-4" data-testid="alliance-aid">
      <Card>
        <SectionTitle>{t('openRequests')}</SectionTitle>
        {open.isPending ? (
          <Skeleton className="h-24" />
        ) : requests.length === 0 ? (
          <p className="text-muted text-sm">{t('noOpen')}</p>
        ) : (
          <div className="flex flex-col gap-2" data-testid="aid-open-list">
            {requests.map((r) => (
              <AidRequestCard
                key={r.id}
                request={r}
                onSend={() => setCompose(r.id)}
                onOpenIncident={r.mine ? () => openIncident(r.incident.id) : undefined}
                className={cn(focusRequestId === r.id && 'ring-focus/50 ring-2')}
              />
            ))}
          </div>
        )}
        <p className="text-subtle mt-2 text-xs">
          {t('limitsHint', {
            requests: home.config.aid.maxOpenRequestsPerCareer,
            vehicles: home.config.aid.maxVehiclesPerColumn,
            columns: home.alliance?.progress.concurrentColumns ?? 2,
          })}
        </p>
      </Card>
      <Card>
        <SectionTitle>{t('myColumns')}</SectionTitle>
        {active.isPending ? (
          <Skeleton className="h-16" />
        ) : activeColumns.length === 0 ? (
          <p className="text-muted text-sm">{t('noColumns')}</p>
        ) : (
          <ul className="divide-border divide-y" data-testid="aid-active-columns">
            {activeColumns.map((c) => (
              <ColumnRow
                key={c.id}
                column={c}
                onRecall={(id) => recall.mutate(id)}
                recalling={recall.isPending && recall.variables === c.id}
              />
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <SectionTitle>{t('history')}</SectionTitle>
        {history.isPending ? (
          <Skeleton className="h-16" />
        ) : past.length === 0 ? (
          <EmptyState title={t('noHistory')} description={t('noHistoryHint')} className="py-6" />
        ) : (
          <ul className="divide-border divide-y" data-testid="aid-history">
            {past.map((c) => (
              <ColumnRow key={c.id} column={c} />
            ))}
          </ul>
        )}
        {history.hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void history.fetchNextPage()}
            loading={history.isFetchingNextPage}
          >
            {t('more')}
          </Button>
        ) : null}
      </Card>
      <ColumnComposer requestId={compose} onOpenChange={(o) => !o && setCompose(null)} />
    </div>
  );
}
