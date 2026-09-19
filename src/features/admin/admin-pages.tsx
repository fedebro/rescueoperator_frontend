'use client';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { adminApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import {
  AdminLedgerAdjustmentBody,
  type AdminCareerDto,
  type AdminConfigVersionDto,
  type AdminFeatureFlagDto,
  type AdminIncidentDto,
  type AdminQueueDto,
  type AdminScheduledActionDto,
  type AdminUserDto,
} from '@/lib/api/assumed';
import { useErrorMessage } from '@/lib/api/error-message';
import { formatAmount, formatDateTime } from '@/lib/format';
import { toast } from '@/stores/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Field, Input } from '@/components/ui/input';
import { Card, EmptyState, SectionTitle, Skeleton, Stat } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { StatusChip } from '@/components/ui/status-chip';
import { Switch } from '@/components/ui/switch';

function Heading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-extrabold">{title}</h1>
        {subtitle ? <p className="text-muted mt-1 text-sm">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
function QueryState({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: unknown;
  children: React.ReactNode;
}) {
  const errorMessage = useErrorMessage();
  if (error)
    return (
      <p role="alert" className="panel text-danger p-4 text-sm">
        {errorMessage(error)}
      </p>
    );
  if (loading) return <Skeleton className="h-64" />;
  return <>{children}</>;
}
function useSearch(): [string, string, (v: string) => void] {
  const [value, setValue] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return [value, debounced, setValue];
}

export function AdminDashboard() {
  const t = useTranslations('admin.dashboard');
  const locale = useLocale();
  const q = useQuery({
    queryKey: qk.admin('dashboard'),
    queryFn: adminApi.dashboard,
    refetchInterval: 15_000,
  });
  const queues = useQuery({
    queryKey: qk.admin('queues'),
    queryFn: adminApi.queues,
    refetchInterval: 15_000,
  });
  const d = q.data;
  const queueColumns: Column<AdminQueueDto>[] = [
    {
      id: 'name',
      header: t('queue.name'),
      width: 'minmax(160px,2fr)',
      cell: (r) => <span className="font-semibold">{r.name}</span>,
    },
    ...(['waiting', 'active', 'delayed', 'failed', 'completed'] as const).map((k): Column<AdminQueueDto> => ({
      id: k,
      header: t(`queue.${k}`),
      width: '100px',
      align: 'right',
      cell: (r) => <span className={k === 'failed' && r.failed > 0 ? 'text-danger' : undefined}>{r[k]}</span>,
      sortValue: (r) => r[k],
    })),
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <QueryState loading={q.isLoading} error={q.error}>
        {d ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                ['users', d.users],
                ['careers', d.careers],
                ['activeCareers', d.activeCareers],
                ['activeIncidents', d.activeIncidents],
                ['pendingActions', d.pendingScheduledActions],
                ['overdueActions', d.overdueScheduledActions],
                ['outboxPending', d.outboxPending],
              ] as const
            ).map(([k, v]) => (
              <Card key={k}>
                <Stat
                  label={t(k)}
                  value={
                    <span className={k === 'overdueActions' && v > 0 ? 'text-danger' : undefined}>{v}</span>
                  }
                />
              </Card>
            ))}
            <Card>
              <Stat
                label={t('credits24h')}
                value={
                  <span className="text-sm">
                    +{formatAmount(d.creditsIssued24h, locale)} / −{formatAmount(d.creditsSpent24h, locale)}
                  </span>
                }
              />
            </Card>
          </div>
        ) : null}
      </QueryState>
      <SectionTitle className="mt-2">{t('queues')}</SectionTitle>
      <QueryState loading={queues.isLoading} error={queues.error}>
        <DataTable
          caption={t('queues')}
          columns={queueColumns}
          rows={queues.data ?? []}
          rowKey={(r) => r.name}
          maxHeight={260}
        />
      </QueryState>
    </>
  );
}

export function AdminUsers() {
  const t = useTranslations('admin.users');
  const locale = useLocale();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [value, search, setValue] = useSearch();
  const q = useQuery({
    queryKey: qk.admin('users', search),
    queryFn: () => adminApi.users(search || undefined),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) => adminApi.setUserStatus(v.id, v.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.admin('users') }),
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const columns: Column<AdminUserDto>[] = [
    {
      id: 'email',
      header: t('email'),
      width: 'minmax(220px,2fr)',
      cell: (u) => <span className="font-semibold">{u.email}</span>,
      sortValue: (u) => u.email,
    },
    {
      id: 'director',
      header: t('director'),
      width: 'minmax(140px,1fr)',
      cell: (u) => u.directorName,
      sortValue: (u) => u.directorName,
    },
    {
      id: 'roles',
      header: t('roles'),
      width: '170px',
      cell: (u) => (
        <span className="flex gap-1">
          {u.roles.map((r) => (
            <Badge key={r} tone={r === 'USER' ? 'neutral' : 'brand'}>
              {r}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('status'),
      width: '150px',
      cell: (u) => (
        <Badge tone={u.status === 'ACTIVE' ? 'success' : u.status === 'SUSPENDED' ? 'danger' : 'warning'}>
          {t(`statuses.${u.status}`)}
        </Badge>
      ),
      sortValue: (u) => u.status,
    },
    {
      id: 'created',
      header: t('created'),
      width: '170px',
      cell: (u) => <span className="tabular text-muted">{formatDateTime(u.createdAt, locale)}</span>,
      sortValue: (u) => u.createdAt,
    },
    {
      id: 'actions',
      header: '',
      width: '130px',
      align: 'right',
      cell: (u) =>
        u.status === 'DELETION_REQUESTED' ? null : (
          <Button
            size="sm"
            variant={u.status === 'ACTIVE' ? 'danger' : 'secondary'}
            className="h-6"
            onClick={() =>
              setStatus.mutate({ id: u.id, status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })
            }
          >
            {u.status === 'ACTIVE' ? t('suspend') : t('reactivate')}
          </Button>
        ),
    },
  ];
  return (
    <>
      <Heading title={t('title')}>
        <Input
          className="w-full sm:w-72"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          leading={<Search className="size-4" />}
        />
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        <DataTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(u) => u.id}
          density="compact"
          maxHeight="calc(100dvh - 220px)"
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
    </>
  );
}

export function AdminCareers() {
  const t = useTranslations('admin.careers');
  const locale = useLocale();
  const [value, search, setValue] = useSearch();
  const q = useQuery({
    queryKey: qk.admin('careers', search),
    queryFn: () => adminApi.careers(search || undefined),
  });
  const columns: Column<AdminCareerDto>[] = [
    {
      id: 'director',
      header: t('director'),
      width: 'minmax(160px,1.5fr)',
      cell: (c) => <span className="font-semibold">{c.directorName}</span>,
      sortValue: (c) => c.directorName,
    },
    {
      id: 'id',
      header: 'ID',
      width: 'minmax(260px,2fr)',
      cell: (c) => <code className="tabular text-muted text-xs select-all">{c.id}</code>,
    },
    { id: 'location', header: t('location'), width: '140px', cell: (c) => c.locationName },
    {
      id: 'level',
      header: t('level'),
      width: '80px',
      align: 'right',
      cell: (c) => c.level,
      sortValue: (c) => c.level,
    },
    {
      id: 'credits',
      header: t('credits'),
      width: '110px',
      align: 'right',
      cell: (c) => formatAmount(c.credits, locale),
      sortValue: (c) => BigInt(c.credits),
    },
    {
      id: 'incidents',
      header: t('incidents'),
      width: '100px',
      align: 'right',
      cell: (c) => c.activeIncidents,
      sortValue: (c) => c.activeIncidents,
    },
    {
      id: 'vehicles',
      header: t('vehicles'),
      width: '90px',
      align: 'right',
      cell: (c) => c.vehicles,
      sortValue: (c) => c.vehicles,
    },
    {
      id: 'duty',
      header: t('duty'),
      width: '110px',
      cell: (c) => (
        <Badge tone={c.onDuty ? 'success' : 'neutral'}>{c.onDuty ? t('onDuty') : t('offDuty')}</Badge>
      ),
    },
  ];
  return (
    <>
      <Heading title={t('title')}>
        <Input
          className="w-full sm:w-72"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          leading={<Search className="size-4" />}
        />
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        <DataTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(c) => c.id}
          maxHeight="calc(100dvh - 220px)"
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
    </>
  );
}

export function AdminIncidents() {
  const t = useTranslations('admin.incidents');
  const ts = useTranslations('status.incident');
  const locale = useLocale();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [status, setStatus] = React.useState('ALL');
  const q = useQuery({
    queryKey: qk.admin('incidents', status),
    queryFn: () => adminApi.incidents(status === 'ALL' ? undefined : status),
    refetchInterval: 10_000,
  });
  const cancel = useMutation({
    mutationFn: adminApi.cancelIncident,
    onSuccess: () => {
      toast({ tone: 'success', title: t('cancelled') });
      void qc.invalidateQueries({ queryKey: qk.admin('incidents') });
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const columns: Column<AdminIncidentDto>[] = [
    {
      id: 'sev',
      header: t('severity'),
      width: '90px',
      cell: (i) => <SeverityBadge severity={i.severity} label={t('severity')} size="sm" />,
      sortValue: (i) => i.severity,
    },
    {
      id: 'template',
      header: t('template'),
      width: 'minmax(170px,1.5fr)',
      cell: (i) => <code className="text-xs">{i.templateCode}</code>,
      sortValue: (i) => i.templateCode,
    },
    {
      id: 'status',
      header: t('status'),
      width: '170px',
      cell: (i) => (
        <StatusChip status={i.status} label={ts.has(i.status as never) ? ts(i.status as never) : i.status} />
      ),
    },
    {
      id: 'address',
      header: t('address'),
      width: 'minmax(180px,2fr)',
      cell: (i) => <span className="text-muted">{i.address}</span>,
    },
    {
      id: 'career',
      header: t('career'),
      width: 'minmax(250px,2fr)',
      cell: (i) => <code className="tabular text-muted text-xs select-all">{i.careerId}</code>,
    },
    {
      id: 'created',
      header: t('created'),
      width: '170px',
      cell: (i) => <span className="tabular text-muted">{formatDateTime(i.createdAt, locale)}</span>,
      sortValue: (i) => i.createdAt,
    },
    {
      id: 'actions',
      header: '',
      width: '110px',
      align: 'right',
      cell: (i) => (
        <Button size="sm" variant="danger" className="h-6" onClick={() => cancel.mutate(i.id)}>
          {t('cancel')}
        </Button>
      ),
    },
  ];
  return (
    <>
      <Heading title={t('title')}>
        <Select
          label={t('status')}
          value={status}
          onValueChange={setStatus}
          options={['ALL', 'PENDING_RESPONSE', 'RESPONDING', 'ON_SCENE', 'RESOLVING'].map((s) => ({
            value: s,
            label: s === 'ALL' ? t('all') : ts(s as never),
          }))}
        />
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        <DataTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(i) => i.id}
          maxHeight="calc(100dvh - 220px)"
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
    </>
  );
}

export function AdminScheduledActions() {
  const t = useTranslations('admin.scheduledActions');
  const locale = useLocale();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const q = useQuery({
    queryKey: qk.admin('scheduled-actions'),
    queryFn: () => adminApi.scheduledActions(),
    refetchInterval: 5_000,
  });
  const retry = useMutation({
    mutationFn: adminApi.retryScheduledAction,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.admin('scheduled-actions') }),
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const columns: Column<AdminScheduledActionDto>[] = [
    {
      id: 'type',
      header: t('type'),
      width: 'minmax(190px,1.5fr)',
      cell: (a) => <code className="text-xs font-semibold">{a.type}</code>,
      sortValue: (a) => a.type,
    },
    {
      id: 'status',
      header: t('status'),
      width: '120px',
      cell: (a) => (
        <Badge tone={a.status === 'FAILED' ? 'danger' : a.status === 'RUNNING' ? 'info' : 'neutral'}>
          {a.status}
        </Badge>
      ),
      sortValue: (a) => a.status,
    },
    {
      id: 'due',
      header: t('dueAt'),
      width: '180px',
      cell: (a) => <span className="tabular">{formatDateTime(a.dueAt, locale)}</span>,
      sortValue: (a) => a.dueAt,
    },
    { id: 'attempts', header: t('attempts'), width: '90px', align: 'right', cell: (a) => a.attempts },
    {
      id: 'career',
      header: t('career'),
      width: 'minmax(250px,2fr)',
      cell: (a) => <code className="tabular text-muted text-xs">{a.careerId ?? '—'}</code>,
    },
    {
      id: 'error',
      header: t('lastError'),
      width: 'minmax(160px,2fr)',
      cell: (a) => <span className="text-danger">{a.lastError ?? ''}</span>,
    },
    {
      id: 'actions',
      header: '',
      width: '100px',
      align: 'right',
      cell: (a) =>
        a.status === 'FAILED' ? (
          <Button size="sm" variant="secondary" className="h-6" onClick={() => retry.mutate(a.id)}>
            {t('retry')}
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <QueryState loading={q.isLoading} error={q.error}>
        <DataTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(a) => a.id}
          maxHeight="calc(100dvh - 200px)"
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
    </>
  );
}

export function AdminLedger() {
  const t = useTranslations('admin.ledger');
  const errorMessage = useErrorMessage();
  const form = useForm<AdminLedgerAdjustmentBody>({
    resolver: zodResolver(AdminLedgerAdjustmentBody),
    defaultValues: { careerId: '', amount: '', reason: '', entryType: 'ADMIN_ADJUSTMENT' },
  });
  const submit = useMutation({
    mutationFn: adminApi.adjustLedger,
    onSuccess: () => {
      toast({ tone: 'success', title: t('done') });
      form.reset();
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const entryType = useWatch({ control: form.control, name: 'entryType' });
  const e = form.formState.errors;
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <Card className="max-w-xl">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((v) => submit.mutate(v))}
        >
          <Field label={t('careerId')} htmlFor="careerId" error={e.careerId ? t('required') : null}>
            <Input id="careerId" placeholder="car_…" invalid={!!e.careerId} {...form.register('careerId')} />
          </Field>
          <Field
            label={t('amount')}
            htmlFor="amount"
            hint={t('amountHint')}
            error={e.amount ? t('amountInvalid') : null}
          >
            <Input
              id="amount"
              inputMode="numeric"
              placeholder="500"
              invalid={!!e.amount}
              className="tabular"
              {...form.register('amount')}
            />
          </Field>
          <Field label={t('entryType')} htmlFor="entryType">
            <Select
              id="entryType"
              label={t('entryType')}
              value={entryType}
              onValueChange={(v) => form.setValue('entryType', v as AdminLedgerAdjustmentBody['entryType'])}
              options={['ADMIN_ADJUSTMENT', 'COMPENSATION', 'PROMOTION'].map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <Field
            label={t('reason')}
            htmlFor="reason"
            hint={t('reasonHint')}
            error={e.reason ? t('reasonInvalid') : null}
          >
            <Input id="reason" invalid={!!e.reason} {...form.register('reason')} />
          </Field>
          <Button type="submit" loading={submit.isPending} className="self-start">
            {t('submit')}
          </Button>
        </form>
      </Card>
    </>
  );
}

export function AdminConfig() {
  const t = useTranslations('admin.config');
  const locale = useLocale();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const q = useQuery({ queryKey: qk.admin('config'), queryFn: adminApi.configVersions });
  const publish = useMutation({
    mutationFn: adminApi.publishConfigVersion,
    onSuccess: () => {
      toast({ tone: 'success', title: t('published') });
      void qc.invalidateQueries({ queryKey: qk.admin('config') });
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const columns: Column<AdminConfigVersionDto>[] = [
    {
      id: 'version',
      header: t('version'),
      width: 'minmax(160px,1fr)',
      cell: (c) => <code className="font-semibold">{c.version}</code>,
    },
    {
      id: 'status',
      header: t('status'),
      width: '130px',
      cell: (c) => (
        <Badge tone={c.status === 'PUBLISHED' ? 'success' : c.status === 'DRAFT' ? 'warning' : 'neutral'}>
          {c.status}
        </Badge>
      ),
    },
    { id: 'author', header: t('author'), width: 'minmax(180px,1fr)', cell: (c) => c.author },
    {
      id: 'created',
      header: t('created'),
      width: '170px',
      cell: (c) => <span className="tabular text-muted">{formatDateTime(c.createdAt, locale)}</span>,
      sortValue: (c) => c.createdAt,
    },
    {
      id: 'notes',
      header: t('notes'),
      width: 'minmax(200px,2fr)',
      cell: (c) => <span className="text-muted">{c.notes ?? ''}</span>,
    },
    {
      id: 'actions',
      header: '',
      width: '120px',
      align: 'right',
      cell: (c) =>
        c.status === 'DRAFT' ? (
          <Button size="sm" className="h-6" onClick={() => publish.mutate(c.id)}>
            {t('publish')}
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <QueryState loading={q.isLoading} error={q.error}>
        <DataTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(c) => c.id}
          density="compact"
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
    </>
  );
}

export function AdminFlags() {
  const t = useTranslations('admin.flags');
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const q = useQuery({ queryKey: qk.admin('flags'), queryFn: adminApi.featureFlags });
  const toggle = useMutation({
    mutationFn: (f: AdminFeatureFlagDto) => adminApi.setFeatureFlag(f.key, !f.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.admin('flags') }),
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <QueryState loading={q.isLoading} error={q.error}>
        {(q.data ?? []).length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <Card className="divide-border divide-y p-0">
            {(q.data ?? []).map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <code className="text-sm font-semibold">{f.key}</code>
                  {f.description ? <p className="text-muted text-xs">{f.description}</p> : null}
                </div>
                <Switch checked={f.enabled} onCheckedChange={() => toggle.mutate(f)} aria-label={f.key} />
              </div>
            ))}
          </Card>
        )}
      </QueryState>
    </>
  );
}
