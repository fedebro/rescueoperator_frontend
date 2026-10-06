'use client';
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed, EyeOff, Flag, ShieldAlert, XCircle } from 'lucide-react';
import {
  adminApi,
  type AdminModerationDecisionRequest,
  type AdminReportDetail,
  type AdminReportRow,
  type AdminSanctionRow,
} from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/ui/data-table';
import { Field, Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useReasonedAction } from './confirm-with-reason';
import {
  AdminTable,
  DateCell,
  DefinitionGrid,
  Heading,
  IdCode,
  NoPermission,
  QueryState,
  StateBadge,
  Textarea,
  useCan,
} from './shared';

const ALL = 'ALL';
export const REPORT_STATUSES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export const REPORT_SEVERITIES = ['HIGH', 'NORMAL'] as const;
export const REPORT_KINDS = [
  'MESSAGE',
  'POST',
  'REPLY',
  'DIRECTOR_NAME',
  'ALLIANCE_NAME',
  'ALLIANCE_DESCRIPTION',
] as const;
export const REPORT_REASONS = [
  'HARASSMENT',
  'SEXUAL',
  'HATE',
  'THREAT_SELF_HARM',
  'PERSONAL_DATA',
  'SPAM_SCAM',
  'OTHER',
] as const;
export const DECISIONS = [
  'DISMISS',
  'REMOVE_CONTENT',
  'WARN',
  'MUTE_PLATFORM',
  'SUSPEND',
  'FORCE_NEUTRAL_NAME',
  'CLOSE_ALLIANCE',
] as const;
export type Decision = (typeof DECISIONS)[number];
/** Mirrors `SEVERE_ACTIONS` of the server: GAME_ADMIN only. */
export const SEVERE_DECISIONS: ReadonlySet<Decision> = new Set([
  'SUSPEND',
  'FORCE_NEUTRAL_NAME',
  'CLOSE_ALLIANCE',
]);

/** Which decisions make sense for a case (the server refuses the others with 409): the form only offers these. */
export function decisionsFor(
  row: Pick<AdminReportRow, 'targetKind' | 'reportedUserId' | 'allianceId'>,
  severe: boolean,
): Decision[] {
  return DECISIONS.filter((action) => {
    if (SEVERE_DECISIONS.has(action) && !severe) return false;
    if (action === 'CLOSE_ALLIANCE') return row.allianceId !== null;
    if (action === 'REMOVE_CONTENT') return row.targetKind !== 'DIRECTOR_NAME';
    if (['WARN', 'MUTE_PLATFORM', 'SUSPEND', 'FORCE_NEUTRAL_NAME'].includes(action))
      return row.reportedUserId !== null;
    return true;
  });
}

const STATUS_TONE = {
  OPEN: 'warning',
  UNDER_REVIEW: 'info',
  RESOLVED: 'success',
  DISMISSED: 'neutral',
} as const;

function SeverityBadge({ severity }: { severity: AdminReportRow['severity'] }) {
  const t = useTranslations('admin.moderation');
  return (
    <StateBadge
      tone={severity === 'HIGH' ? 'danger' : 'neutral'}
      icon={severity === 'HIGH' ? ShieldAlert : CircleDashed}
      label={t(`severities.${severity}`)}
    />
  );
}

function StatusBadge({ status }: { status: AdminReportRow['status'] }) {
  const t = useTranslations('admin.moderation');
  const icon =
    status === 'RESOLVED'
      ? CheckCircle2
      : status === 'DISMISSED'
        ? XCircle
        : status === 'OPEN'
          ? Flag
          : CircleDashed;
  return <StateBadge tone={STATUS_TONE[status]} icon={icon} label={t(`statuses.${status}`)} />;
}

/* ───────────── queue ───────────── */

export function AdminModeration() {
  const t = useTranslations('admin.moderation');
  const tc = useTranslations('admin.common');
  const can = useCan();
  const [status, setStatus] = React.useState<string>('OPEN');
  const [severity, setSeverity] = React.useState<string>(ALL);
  const [kind, setKind] = React.useState<string>(ALL);
  const summary = useQuery({
    queryKey: qk.admin('moderationSummary'),
    queryFn: adminApi.moderationSummary,
    refetchInterval: 30_000,
  });
  const q = useInfiniteQuery({
    queryKey: qk.admin('moderation', status, severity, kind),
    queryFn: ({ pageParam }) =>
      adminApi.moderationReports(
        {
          status: status === ALL ? undefined : status,
          severity: severity === ALL ? undefined : severity,
          targetKind: kind === ALL ? undefined : kind,
        },
        pageParam,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
    refetchInterval: 30_000,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const columns: Column<AdminReportRow>[] = [
    {
      id: 'severity',
      header: t('severity'),
      width: '120px',
      cell: (r) => <SeverityBadge severity={r.severity} />,
      sortValue: (r) => (r.severity === 'HIGH' ? 0 : 1),
    },
    {
      id: 'status',
      header: t('status'),
      width: '140px',
      cell: (r) => <StatusBadge status={r.status} />,
      sortValue: (r) => r.status,
    },
    { id: 'kind', header: t('kind'), width: '150px', cell: (r) => t(`kinds.${r.targetKind}`) },
    { id: 'reason', header: t('reason'), width: '170px', cell: (r) => t(`reasons.${r.reason}`) },
    {
      id: 'excerpt',
      header: t('excerpt'),
      width: 'minmax(220px,3fr)',
      cell: (r) => <span className={r.hidden ? 'text-muted italic' : ''}>{r.excerpt || '—'}</span>,
    },
    {
      id: 'reporters',
      header: t('reporters'),
      width: '120px',
      align: 'right',
      cell: (r) => (
        <span className="inline-flex items-center gap-1">
          {r.reporterCount}
          {r.flaggedByFilter ? <Badge tone="info">{t('filterFlag')}</Badge> : null}
          {r.hidden ? <EyeOff className="text-subtle size-3.5" aria-label={t('hidden')} /> : null}
        </span>
      ),
      sortValue: (r) => r.reporterCount,
    },
    {
      id: 'author',
      header: t('author'),
      width: 'minmax(140px,1.5fr)',
      cell: (r) => r.reportedDirectorName ?? '—',
    },
    {
      id: 'last',
      header: t('lastReported'),
      width: '170px',
      cell: (r) => <DateCell iso={r.lastReportedAt} />,
      sortValue: (r) => r.lastReportedAt,
    },
  ];
  const stats = summary.data;
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        {can('moderation.decide') ? null : <NoPermission />}
      </Heading>
      {stats ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('summary')}>
          {(
            [
              ['open', stats.open],
              ['openHigh', stats.openHigh],
              ['activeMutes', stats.activeMutes],
              ['meanDecisionHours', stats.meanDecisionHours === null ? '—' : stats.meanDecisionHours],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="panel p-3">
              <dt className="text-subtle text-xs font-semibold tracking-wide uppercase">
                {t(`stats.${key}`)}
              </dt>
              <dd
                className={`font-display text-2xl font-extrabold ${key === 'openHigh' && Number(value) > 0 ? 'text-danger' : ''}`}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select
          label={t('status')}
          value={status}
          onValueChange={setStatus}
          className="w-full"
          options={[
            { value: ALL, label: tc('all') },
            ...REPORT_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) })),
          ]}
        />
        <Select
          label={t('severity')}
          value={severity}
          onValueChange={setSeverity}
          className="w-full"
          options={[
            { value: ALL, label: tc('all') },
            ...REPORT_SEVERITIES.map((s) => ({ value: s, label: t(`severities.${s}`) })),
          ]}
        />
        <Select
          label={t('kind')}
          value={kind}
          onValueChange={setKind}
          className="w-full"
          options={[
            { value: ALL, label: tc('all') },
            ...REPORT_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) })),
          ]}
        />
      </div>
      <QueryState loading={q.isLoading} error={q.error}>
        <AdminTable
          caption={t('title')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          cardTitle={(r) => `${t(`kinds.${r.targetKind}`)} · ${t(`reasons.${r.reason}`)}`}
          rowHref={(r) => `/admin/moderation/${r.id}`}
          empty={<EmptyState title={t('empty')} description={t('emptyBody')} />}
        />
        {q.hasNextPage ? (
          <Button variant="secondary" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {tc('loadMore')}
          </Button>
        ) : null}
      </QueryState>
    </>
  );
}

/* ───────────── case ───────────── */

export function AdminModerationCasePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('admin.moderation');
  const q = useQuery({
    queryKey: qk.admin('moderationCase', id),
    queryFn: () => adminApi.moderationReport(id),
  });
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {q.data ? <CaseDetail detail={q.data} /> : <EmptyState title={t('empty')} />}
    </QueryState>
  );
}

function CaseDetail({ detail }: { detail: AdminReportDetail }) {
  const t = useTranslations('admin.moderation');
  const tc = useTranslations('admin.common');
  const decided = detail.status === 'RESOLVED' || detail.status === 'DISMISSED';
  return (
    <>
      <Heading
        title={`${t(`kinds.${detail.targetKind}`)} · ${t(`reasons.${detail.reason}`)}`}
        subtitle={t('caseSubtitle', { count: detail.reporterCount })}
      >
        <SeverityBadge severity={detail.severity} />
        <StatusBadge status={detail.status} />
        {detail.hidden ? <StateBadge tone="warning" icon={EyeOff} label={t('hidden')} /> : null}
      </Heading>
      <section className="panel flex flex-col gap-3 p-4" aria-labelledby="case-content">
        <h2 id="case-content" className="font-semibold">
          {t('content')}
        </h2>
        <blockquote className="bg-surface-2 border-border rounded-md border p-3 text-sm break-words whitespace-pre-wrap">
          {detail.content.text || <span className="text-subtle italic">{t('contentPurged')}</span>}
        </blockquote>
        <DefinitionGrid
          items={[
            [
              t('author'),
              detail.reportedUserId ? (
                <Link className="text-skyline hover:underline" href={`/admin/users/${detail.reportedUserId}`}>
                  {detail.reportedDirectorName ?? detail.reportedUserId}
                </Link>
              ) : (
                (detail.reportedDirectorName ?? '—')
              ),
            ],
            [t('target'), <IdCode key="target" value={detail.targetId} />],
            [
              t('alliance'),
              detail.allianceId ? (
                <IdCode
                  key="alliance"
                  value={detail.allianceId}
                  href={`/admin/alliances/${detail.allianceId}`}
                />
              ) : (
                '—'
              ),
            ],
            [t('contentLive'), detail.content.live ? tc('yes') : tc('no')],
            [t('written'), <DateCell key="written" iso={detail.content.createdAt} />],
            [t('firstReported'), <DateCell key="first" iso={detail.createdAt} />],
            [
              t('filterVerdict'),
              detail.filter
                ? detail.filter.tier
                  ? `${detail.filter.tier} · ${detail.filter.reasons.join(', ')}`
                  : t('filterClean')
                : '—',
            ],
          ]}
        />
      </section>
      {detail.context.length > 0 ? (
        <section className="panel flex flex-col gap-2 p-4" aria-labelledby="case-context">
          <h2 id="case-context" className="font-semibold">
            {t('context')}
          </h2>
          <ol className="flex flex-col gap-1 text-sm">
            {detail.context.map((item) => (
              <li
                key={item.id}
                className={`rounded-md px-2 py-1 ${item.isTarget ? 'bg-danger/10 border-danger border' : ''}`}
              >
                <span className="text-subtle tabular text-xs">
                  <DateCell iso={item.createdAt} />
                </span>{' '}
                <span className="font-semibold">{item.authorDirectorName ?? '—'}</span>:{' '}
                <span className="break-words">{item.text}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <section className="panel flex flex-col gap-2 p-4" aria-labelledby="case-reporters">
        <h2 id="case-reporters" className="font-semibold">
          {t('reportersTitle', { count: detail.reporters.length })}
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {detail.reporters.map((r, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <DateCell iso={r.createdAt} />
              <span className="font-semibold">
                {r.source === 'SYSTEM' ? t('filterFlag') : (r.reporterDirectorName ?? '—')}
              </span>
              <Badge tone="neutral">{t(`reasons.${r.reason}`)}</Badge>
              {r.note ? <span className="text-muted">«{r.note}»</span> : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel flex flex-col gap-2 p-4" aria-labelledby="case-author">
        <h2 id="case-author" className="font-semibold">
          {t('authorRecord')}
        </h2>
        <DefinitionGrid
          items={[
            [t('otherCases'), String(detail.author.cases)],
            [t('accountStatus'), detail.author.accountStatus ?? '—'],
            [t('accountSince'), <DateCell key="since" iso={detail.author.accountCreatedAt} />],
          ]}
        />
        <SanctionList rows={detail.author.sanctions} />
      </section>
      <section className="panel flex flex-col gap-3 p-4" aria-labelledby="case-decision">
        <h2 id="case-decision" className="font-semibold">
          {t('decision')}
        </h2>
        {decided ? (
          <DefinitionGrid
            items={[
              [t('decisionTaken'), detail.decision ? t(`actions.${detail.decision}`) : '—'],
              [t('decidedBy'), detail.decidedBy ?? '—'],
              [t('decidedAt'), <DateCell key="at" iso={detail.decidedAt} />],
              [t('decisionReason'), detail.decisionReason ?? '—'],
              [t('decisionMessage'), detail.decisionMessage ?? '—'],
            ]}
          />
        ) : (
          <DecisionForm detail={detail} />
        )}
      </section>
    </>
  );
}

export function SanctionList({ rows }: { rows: AdminSanctionRow[] }) {
  const t = useTranslations('admin.sanctions');
  if (rows.length === 0) return <p className="text-subtle text-sm">{t('none')}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label={t('title')}>
      {rows.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-2">
          <StateBadge
            tone={s.active ? 'danger' : 'neutral'}
            icon={s.active ? AlertTriangle : CircleDashed}
            label={t(`kinds.${s.kind}`)}
          />
          <DateCell iso={s.startsAt} />
          {s.expiresAt ? (
            <span className="text-muted">
              → <DateCell iso={s.expiresAt} />
            </span>
          ) : null}
          {s.reason ? <Badge tone="neutral">{t(`reasons.${s.reason}`)}</Badge> : null}
          {s.revokedAt ? <Badge tone="info">{t('revoked')}</Badge> : null}
          {s.caseId ? <IdCode value={s.caseId} href={`/admin/moderation/${s.caseId}`} /> : null}
        </li>
      ))}
    </ul>
  );
}

function DecisionForm({ detail }: { detail: AdminReportDetail }) {
  const t = useTranslations('admin.moderation');
  const can = useCan();
  const options = decisionsFor(detail, can('moderation.decideSevere'));
  const [action, setAction] = React.useState<Decision>(options[0] ?? 'DISMISS');
  const [message, setMessage] = React.useState('');
  const [hours, setHours] = React.useState('24');
  const decide = useReasonedAction<AdminModerationDecisionRequest, AdminReportDetail>({
    run: (body, reason) => adminApi.decideReport(detail.id, { ...body, reason }),
    success: t('decided'),
    invalidate: [
      qk.admin('moderationCase', detail.id),
      qk.admin('moderation'),
      qk.admin('moderationSummary'),
      qk.admin('sanctions'),
    ],
  });
  if (!can('moderation.decide')) return <NoPermission />;
  const parsedHours = Number(hours);
  const hoursInvalid = action === 'MUTE_PLATFORM' && (!Number.isInteger(parsedHours) || parsedHours < 1);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (hoursInvalid) return;
        decide.ask(
          {
            action,
            message: message.trim() || undefined,
            durationHours: action === 'MUTE_PLATFORM' ? parsedHours : undefined,
            reason: '',
          },
          {
            title: t('confirmTitle', { action: t(`actions.${action}`) }),
            description: t(`actionHelp.${action}`),
            targetId: detail.id,
            confirmLabel: t(`actions.${action}`),
            tone: action === 'DISMISS' ? 'primary' : 'danger',
          },
        );
      }}
    >
      <Select
        label={t('action')}
        value={action}
        onValueChange={(v) => setAction(v as Decision)}
        className="w-full sm:max-w-sm"
        options={options.map((a) => ({ value: a, label: t(`actions.${a}`) }))}
      />
      <p className="text-muted text-sm">{t(`actionHelp.${action}`)}</p>
      {action === 'MUTE_PLATFORM' ? (
        <Field
          label={t('durationHours')}
          htmlFor="decision-hours"
          error={hoursInvalid ? t('durationInvalid') : null}
          hint={t('durationHint')}
        >
          <Input
            id="decision-hours"
            type="number"
            min={1}
            max={8760}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="sm:max-w-40"
          />
        </Field>
      ) : null}
      {action !== 'DISMISS' && action !== 'CLOSE_ALLIANCE' ? (
        <Field label={t('messageLabel')} htmlFor="decision-message" hint={t('messageHint')}>
          <Textarea
            id="decision-message"
            value={message}
            maxLength={300}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('messagePlaceholder')}
          />
        </Field>
      ) : null}
      <div>
        <Button
          type="submit"
          variant={action === 'DISMISS' ? 'secondary' : 'danger'}
          disabled={decide.isPending}
        >
          {t(`actions.${action}`)}
        </Button>
      </div>
      {decide.dialog}
    </form>
  );
}
