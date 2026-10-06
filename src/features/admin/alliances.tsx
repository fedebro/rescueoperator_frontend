'use client';
import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, Lock, ShieldX, XCircle } from 'lucide-react';
import { adminApi, type AdminAllianceDetail, type AdminAllianceRow } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
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
  useCan,
  useDebounced,
} from './shared';

const ALL = 'ALL';
const STATUSES = ['ACTIVE', 'DISBANDING', 'DISBANDED', 'CLOSED'] as const;
const STATUS_TONE = {
  ACTIVE: 'success',
  DISBANDING: 'warning',
  DISBANDED: 'neutral',
  CLOSED: 'danger',
} as const;

function AllianceStatusBadge({ status }: { status: AdminAllianceRow['status'] }) {
  const t = useTranslations('admin.alliances');
  const icon =
    status === 'ACTIVE'
      ? CheckCircle2
      : status === 'CLOSED'
        ? ShieldX
        : status === 'DISBANDED'
          ? XCircle
          : CircleDashed;
  return <StateBadge tone={STATUS_TONE[status]} icon={icon} label={t(`statuses.${status}`)} />;
}

/** Alliances for the staff (study 2026-10-06 §09 §8): list, detail with members and log, emergency read-only, closure, test operation. */
export function AdminAlliances() {
  const t = useTranslations('admin.alliances');
  const tc = useTranslations('admin.common');
  const [qValue, qDebounced, setQ] = useDebounced();
  const [status, setStatus] = React.useState<string>(ALL);
  const q = useQuery({
    queryKey: qk.admin('alliances', qDebounced, status),
    queryFn: () =>
      adminApi.alliances({ q: qDebounced || undefined, status: status === ALL ? undefined : status }),
  });
  const columns: Column<AdminAllianceRow>[] = [
    {
      id: 'name',
      header: t('name'),
      width: 'minmax(180px,2fr)',
      cell: (r) => (
        <span>
          <Badge tone="brand">{r.tag}</Badge> <span className="font-semibold">{r.name}</span>
        </span>
      ),
      sortValue: (r) => r.name,
    },
    {
      id: 'status',
      header: t('status'),
      width: '140px',
      cell: (r) => <AllianceStatusBadge status={r.status} />,
      sortValue: (r) => r.status,
    },
    {
      id: 'level',
      header: t('level'),
      width: '80px',
      align: 'right',
      cell: (r) => r.level,
      sortValue: (r) => r.level,
    },
    {
      id: 'members',
      header: t('members'),
      width: '110px',
      align: 'right',
      cell: (r) => `${r.members}/${r.memberSlots}`,
      sortValue: (r) => r.members,
    },
    {
      id: 'coordinator',
      header: t('coordinator'),
      width: 'minmax(140px,1.5fr)',
      cell: (r) => r.coordinator.directorName ?? '—',
    },
    {
      id: 'readOnly',
      header: t('readOnly'),
      width: '160px',
      cell: (r) =>
        r.readOnly.board || r.readOnly.chat ? (
          <span className="inline-flex flex-wrap gap-1">
            {r.readOnly.board ? <StateBadge tone="warning" icon={Lock} label={t('board')} /> : null}
            {r.readOnly.chat ? <StateBadge tone="warning" icon={Lock} label={t('chat')} /> : null}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        ),
    },
    {
      id: 'reports',
      header: t('openReports'),
      width: '110px',
      align: 'right',
      cell: (r) => (
        <span className={r.openReports > 0 ? 'text-danger font-semibold' : ''}>{r.openReports}</span>
      ),
      sortValue: (r) => r.openReports,
    },
    {
      id: 'activity',
      header: t('lastActivity'),
      width: '170px',
      cell: (r) => <DateCell iso={r.lastActivityAt} />,
      sortValue: (r) => r.lastActivityAt ?? '',
    },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          type="search"
          value={qValue}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="h-10 text-base lg:text-sm"
          autoComplete="off"
        />
        <Select
          label={t('status')}
          value={status}
          onValueChange={setStatus}
          className="w-full"
          options={[
            { value: ALL, label: tc('all') },
            ...STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) })),
          ]}
        />
      </div>
      <QueryState loading={q.isLoading} error={q.error}>
        <AdminTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(r) => r.id}
          cardTitle={(r) => `[${r.tag}] ${r.name}`}
          titleColumn="name"
          rowHref={(r) => `/admin/alliances/${r.id}`}
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
    </>
  );
}

export function AdminAllianceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('admin.alliances');
  const q = useQuery({ queryKey: qk.admin('alliance', id), queryFn: () => adminApi.alliance(id) });
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {q.data ? <AllianceDetail detail={q.data} /> : <EmptyState title={t('empty')} />}
    </QueryState>
  );
}

function AllianceDetail({ detail }: { detail: AdminAllianceDetail }) {
  const t = useTranslations('admin.alliances');
  const tc = useTranslations('admin.common');
  const can = useCan();
  const { alliance } = detail;
  const invalidate = [qk.admin('alliance', alliance.id), qk.admin('alliances')];
  const readOnly = useReasonedAction<{ readOnlyBoard?: boolean; readOnlyChat?: boolean }, AdminAllianceRow>({
    run: (body, reason) => adminApi.setAllianceReadOnly(alliance.id, { ...body, reason }),
    success: t('readOnlyDone'),
    invalidate,
  });
  const close = useReasonedAction<void, AdminAllianceRow>({
    run: (_, reason) => adminApi.closeAlliance(alliance.id, reason),
    success: t('closedDone'),
    invalidate,
  });
  const operation = useReasonedAction<void, Record<string, unknown>>({
    run: (_, reason) => adminApi.startAllianceOperation(alliance.id, reason),
    success: t('operationDone'),
    invalidate,
  });
  const memberColumns: Column<AdminAllianceDetail['members'][number]>[] = [
    {
      id: 'name',
      header: t('member'),
      width: 'minmax(160px,2fr)',
      cell: (m) => <IdCode value={m.directorName} href={`/admin/careers/${m.careerId}`} />,
      sortValue: (m) => m.directorName,
    },
    {
      id: 'role',
      header: t('role'),
      width: '130px',
      cell: (m) => (
        <Badge tone={m.role === 'COORDINATOR' ? 'brand' : m.role === 'DEPUTY' ? 'info' : 'neutral'}>
          {t(`roles.${m.role}`)}
        </Badge>
      ),
      sortValue: (m) => m.role,
    },
    {
      id: 'status',
      header: t('memberStatus'),
      width: '120px',
      cell: (m) => t(`memberStatuses.${m.status}`),
      sortValue: (m) => m.status,
    },
    {
      id: 'level',
      header: t('level'),
      width: '80px',
      align: 'right',
      cell: (m) => m.level,
      sortValue: (m) => m.level,
    },
    { id: 'location', header: t('location'), width: 'minmax(120px,1fr)', cell: (m) => m.locationName },
    {
      id: 'joined',
      header: t('joined'),
      width: '170px',
      cell: (m) => <DateCell iso={m.joinedAt} />,
      sortValue: (m) => m.joinedAt ?? '',
    },
  ];
  const toggleReadOnly = (part: 'board' | 'chat') => {
    const next = !alliance.readOnly[part];
    readOnly.ask(part === 'board' ? { readOnlyBoard: next } : { readOnlyChat: next }, {
      title: next ? t('readOnlyOnTitle', { part: t(part) }) : t('readOnlyOffTitle', { part: t(part) }),
      description: t('readOnlyBody'),
      targetId: alliance.id,
      confirmLabel: next ? t('readOnlyOn') : t('readOnlyOff'),
      tone: next ? 'danger' : 'primary',
    });
  };
  return (
    <>
      <Heading
        title={`[${alliance.tag}] ${alliance.name}`}
        subtitle={alliance.description || t('noDescription')}
      >
        <AllianceStatusBadge status={alliance.status} />
        {alliance.readOnly.board ? (
          <StateBadge tone="warning" icon={Lock} label={`${t('readOnly')}: ${t('board')}`} />
        ) : null}
        {alliance.readOnly.chat ? (
          <StateBadge tone="warning" icon={Lock} label={`${t('readOnly')}: ${t('chat')}`} />
        ) : null}
      </Heading>
      <section className="panel flex flex-col gap-3 p-4" aria-labelledby="alliance-facts">
        <h2 id="alliance-facts" className="font-semibold">
          {t('facts')}
        </h2>
        <DefinitionGrid
          items={[
            [tc('id'), <IdCode key="id" value={alliance.id} />],
            [t('level'), `${alliance.level} · ${detail.progress.xp} XP`],
            [t('members'), `${alliance.members}/${alliance.memberSlots}`],
            [
              t('coordinator'),
              alliance.coordinator.careerId ? (
                <IdCode
                  key="coord"
                  value={alliance.coordinator.directorName ?? alliance.coordinator.careerId}
                  href={`/admin/careers/${alliance.coordinator.careerId}`}
                />
              ) : (
                '—'
              ),
            ],
            [t('joinPolicy'), t(`joinPolicies.${detail.settings.joinPolicy}`)],
            [t('language'), detail.settings.language.toUpperCase()],
            [t('openReports'), String(alliance.openReports)],
            [t('created'), <DateCell key="created" iso={alliance.createdAt} />],
            [t('lastActivity'), <DateCell key="activity" iso={alliance.lastActivityAt} />],
            [t('operation'), detail.operation ? t('operationRunning') : tc('none')],
          ]}
        />
      </section>
      <section className="panel flex flex-col gap-3 p-4" aria-labelledby="alliance-actions">
        <h2 id="alliance-actions" className="font-semibold">
          {t('actions')}
        </h2>
        <p className="text-muted text-sm">{t('actionsHint')}</p>
        <div className="flex flex-wrap gap-2">
          {can('alliances.readOnly') ? (
            <>
              <Button
                variant="secondary"
                onClick={() => toggleReadOnly('board')}
                disabled={alliance.status !== 'ACTIVE'}
              >
                {alliance.readOnly.board
                  ? t('readOnlyOffLabel', { part: t('board') })
                  : t('readOnlyOnLabel', { part: t('board') })}
              </Button>
              <Button
                variant="secondary"
                onClick={() => toggleReadOnly('chat')}
                disabled={alliance.status !== 'ACTIVE'}
              >
                {alliance.readOnly.chat
                  ? t('readOnlyOffLabel', { part: t('chat') })
                  : t('readOnlyOnLabel', { part: t('chat') })}
              </Button>
            </>
          ) : null}
          {can('alliances.operation') ? (
            <Button
              variant="secondary"
              disabled={alliance.status !== 'ACTIVE' || detail.operation !== null}
              onClick={() =>
                operation.ask(undefined, {
                  title: t('operationTitle'),
                  description: t('operationBody'),
                  targetId: alliance.id,
                  confirmLabel: t('operationStart'),
                  tone: 'primary',
                })
              }
            >
              {t('operationStart')}
            </Button>
          ) : null}
          {can('alliances.close') ? (
            <Button
              variant="danger"
              disabled={alliance.status === 'CLOSED'}
              onClick={() =>
                close.ask(undefined, {
                  title: t('closeTitle'),
                  description: t('closeBody'),
                  targetId: alliance.id,
                  confirmLabel: t('close'),
                  typedConfirmation: alliance.tag,
                })
              }
            >
              {t('close')}
            </Button>
          ) : null}
          {!can('alliances.readOnly') && !can('alliances.close') ? <NoPermission /> : null}
        </div>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="alliance-members">
        <h2 id="alliance-members" className="font-semibold">
          {t('membersTitle', { count: detail.members.length })}
        </h2>
        <AdminTable
          caption={t('membersTitle', { count: detail.members.length })}
          columns={memberColumns}
          rows={detail.members}
          rowKey={(m) => m.id}
          cardTitle={(m) => m.directorName}
          titleColumn="name"
          maxHeight={360}
          empty={<EmptyState title={t('noMembers')} />}
        />
      </section>
      <section className="panel flex flex-col gap-2 p-4" aria-labelledby="alliance-log">
        <h2 id="alliance-log" className="font-semibold">
          {t('log')}
        </h2>
        {detail.log.length === 0 ? (
          <p className="text-subtle text-sm">{t('noLog')}</p>
        ) : (
          <ol className="scroll-y flex max-h-80 flex-col gap-1 text-sm">
            {detail.log.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2">
                <DateCell iso={entry.at} />
                <code className="text-xs">{entry.action}</code>
                {entry.actor?.directorName ? (
                  <span className="font-semibold">{entry.actor.directorName}</span>
                ) : null}
                {entry.target?.directorName ? (
                  <span className="text-muted">→ {entry.target.directorName}</span>
                ) : null}
                {entry.byAdmin ? <Badge tone="brand">{t('byAdmin')}</Badge> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
      {readOnly.dialog}
      {close.dialog}
      {operation.dialog}
    </>
  );
}
