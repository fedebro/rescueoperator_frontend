'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AlertTriangle, CircleDashed } from 'lucide-react';
import { adminApi, type AdminSanctionRequest, type AdminSanctionRow } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/ui/data-table';
import { Field, Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/switch';
import { useReasonedAction } from './confirm-with-reason';
import { REPORT_REASONS } from './moderation';
import {
  AdminTable,
  DateCell,
  Heading,
  IdCode,
  NoPermission,
  QueryState,
  StateBadge,
  Textarea,
  useCan,
} from './shared';

const ALL = 'ALL';
const KINDS = ['WARNING', 'MUTE_PLATFORM', 'MUTE_ALLIANCE'] as const;
const NONE = 'NONE';

/** Sanctions (warnings, platform and alliance mutes): the active ones, the history, a revoke, and a sanction outside any case. */
export function AdminSanctions() {
  const t = useTranslations('admin.sanctions');
  const tc = useTranslations('admin.common');
  const can = useCan();
  const [kind, setKind] = React.useState<string>(ALL);
  const [activeOnly, setActiveOnly] = React.useState(true);
  const [userId, setUserId] = React.useState('');
  const q = useInfiniteQuery({
    queryKey: qk.admin('sanctions', kind, activeOnly, userId.trim()),
    queryFn: ({ pageParam }) =>
      adminApi.sanctions(
        { kind: kind === ALL ? undefined : kind, active: activeOnly, userId: userId.trim() || undefined },
        pageParam,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const revoke = useReasonedAction<AdminSanctionRow>({
    run: (row, reason) => adminApi.revokeSanction(row.id, reason),
    success: t('revokedDone'),
    invalidate: [qk.admin('sanctions'), qk.admin('moderationSummary')],
  });
  const columns: Column<AdminSanctionRow>[] = [
    {
      id: 'kind',
      header: t('kind'),
      width: '170px',
      cell: (r) => (
        <StateBadge
          tone={r.active ? 'danger' : 'neutral'}
          icon={r.active ? AlertTriangle : CircleDashed}
          label={t(`kinds.${r.kind}`)}
        />
      ),
    },
    {
      id: 'user',
      header: t('user'),
      width: 'minmax(160px,1.5fr)',
      cell: (r) => (
        <Link className="text-skyline hover:underline" href={`/admin/users/${r.userId}`}>
          {r.directorName}
        </Link>
      ),
    },
    {
      id: 'reason',
      header: t('reason'),
      width: '170px',
      cell: (r) => (r.reason ? t(`reasons.${r.reason}`) : '—'),
    },
    {
      id: 'message',
      header: t('message'),
      width: 'minmax(200px,2fr)',
      cell: (r) => <span className="text-muted">{r.message ?? ''}</span>,
    },
    {
      id: 'from',
      header: t('from'),
      width: '170px',
      cell: (r) => <DateCell iso={r.startsAt} />,
      sortValue: (r) => r.startsAt,
    },
    {
      id: 'until',
      header: t('until'),
      width: '170px',
      cell: (r) =>
        r.expiresAt ? (
          <DateCell iso={r.expiresAt} />
        ) : (
          <span className="text-subtle">{r.kind === 'WARNING' ? '—' : t('noExpiry')}</span>
        ),
    },
    {
      id: 'by',
      header: t('issuedBy'),
      width: '160px',
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Badge tone={r.issuedBy === 'ADMIN' ? 'brand' : 'neutral'}>{t(`issuers.${r.issuedBy}`)}</Badge>
          {r.issuedByName ? <span className="text-muted text-xs">{r.issuedByName}</span> : null}
          {r.caseId ? <IdCode value={r.caseId} href={`/admin/moderation/${r.caseId}`} /> : null}
          {r.revokedAt ? <Badge tone="info">{t('revoked')}</Badge> : null}
        </span>
      ),
    },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        {can('moderation.sanction') ? null : <NoPermission />}
      </Heading>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select
          label={t('kind')}
          value={kind}
          onValueChange={setKind}
          className="w-full"
          options={[
            { value: ALL, label: tc('all') },
            ...KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) })),
          ]}
        />
        <Input
          type="search"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder={t('filterUser')}
          aria-label={t('filterUser')}
          className="h-10 text-base lg:text-sm"
          autoComplete="off"
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={activeOnly} onCheckedChange={(v) => setActiveOnly(v === true)} />
          {t('activeOnly')}
        </label>
      </div>
      <QueryState loading={q.isLoading} error={q.error}>
        <AdminTable
          caption={t('title')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          cardTitle={(r) => `${t(`kinds.${r.kind}`)} · ${r.directorName}`}
          actionsWidth="120px"
          actions={
            can('moderation.sanction')
              ? (r) =>
                  r.active || (r.kind === 'WARNING' && !r.revokedAt) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7"
                      onClick={() =>
                        revoke.ask(r, {
                          title: t('revokeTitle'),
                          description: t('revokeBody'),
                          targetId: r.id,
                          confirmLabel: t('revoke'),
                        })
                      }
                    >
                      {t('revoke')}
                    </Button>
                  ) : null
              : undefined
          }
          empty={<EmptyState title={t('empty')} />}
        />
        {q.hasNextPage ? (
          <Button variant="secondary" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {tc('loadMore')}
          </Button>
        ) : null}
      </QueryState>
      {can('moderation.sanction') ? <IssueSanction /> : null}
      {revoke.dialog}
    </>
  );
}

function IssueSanction() {
  const t = useTranslations('admin.sanctions');
  const [userId, setUserId] = React.useState('');
  const [kind, setKind] = React.useState<AdminSanctionRequest['kind']>('WARNING');
  const [hours, setHours] = React.useState('24');
  const [moderationReason, setModerationReason] = React.useState<string>(NONE);
  const [message, setMessage] = React.useState('');
  const issue = useReasonedAction<AdminSanctionRequest, AdminSanctionRow>({
    run: (body, reason) => adminApi.issueSanction(userId.trim(), { ...body, reason }),
    success: t('issuedDone'),
    invalidate: [qk.admin('sanctions'), qk.admin('moderationSummary')],
    onDone: () => {
      setMessage('');
    },
  });
  const userInvalid = !/^usr_[0-9A-Za-z]{26}$/.test(userId.trim());
  const parsedHours = Number(hours);
  const hoursInvalid = kind === 'MUTE_PLATFORM' && (!Number.isInteger(parsedHours) || parsedHours < 1);
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="issue-sanction">
      <h2 id="issue-sanction" className="font-semibold">
        {t('issueTitle')}
      </h2>
      <p className="text-muted text-sm">{t('issueHint')}</p>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (userInvalid || hoursInvalid) return;
          issue.ask(
            {
              kind,
              durationHours: kind === 'MUTE_PLATFORM' ? parsedHours : undefined,
              moderationReason:
                moderationReason === NONE
                  ? undefined
                  : (moderationReason as AdminSanctionRequest['moderationReason']),
              message: message.trim() || undefined,
              reason: '',
            },
            {
              title: t('issueConfirmTitle', { kind: t(`kinds.${kind}`) }),
              description: t('issueConfirmBody'),
              targetId: userId.trim(),
              confirmLabel: t('issue'),
            },
          );
        }}
      >
        <Field
          label={t('userId')}
          htmlFor="sanction-user"
          error={userId && userInvalid ? t('userInvalid') : null}
        >
          <Input
            id="sanction-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="usr_…"
            autoComplete="off"
          />
        </Field>
        <Select
          label={t('kind')}
          value={kind}
          onValueChange={(v) => setKind(v as AdminSanctionRequest['kind'])}
          className="w-full"
          options={[
            { value: 'WARNING', label: t('kinds.WARNING') },
            { value: 'MUTE_PLATFORM', label: t('kinds.MUTE_PLATFORM') },
          ]}
        />
        {kind === 'MUTE_PLATFORM' ? (
          <Field
            label={t('durationHours')}
            htmlFor="sanction-hours"
            error={hoursInvalid ? t('durationInvalid') : null}
          >
            <Input
              id="sanction-hours"
              type="number"
              min={1}
              max={8760}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </Field>
        ) : null}
        <Select
          label={t('reason')}
          value={moderationReason}
          onValueChange={setModerationReason}
          className="w-full"
          options={[
            { value: NONE, label: t('noReason') },
            ...REPORT_REASONS.map((r) => ({ value: r, label: t(`reasons.${r}`) })),
          ]}
        />
        <Field
          label={t('message')}
          htmlFor="sanction-message"
          hint={t('messageHint')}
          className="sm:col-span-2"
        >
          <Textarea
            id="sanction-message"
            value={message}
            maxLength={300}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="danger" disabled={issue.isPending || userInvalid}>
            {t('issue')}
          </Button>
        </div>
      </form>
      {issue.dialog}
    </section>
  );
}
