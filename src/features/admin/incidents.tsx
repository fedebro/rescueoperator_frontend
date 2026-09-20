'use client';
import * as React from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Ban, CheckCheck } from 'lucide-react';
import { adminApi, type AdminIncidentDetail, type AdminIncidentRow } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { formatDateTime, formatPercent } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, EmptyState, ProgressBar, SectionTitle } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { StatusChip } from '@/components/ui/status-chip';
import { Timeline } from '@/components/ui/timeline';
import { IncidentRowsTable } from './careers';
import { useReasonedAction } from './confirm-with-reason';
import { ScheduledActionsTable } from './scheduled-actions';
import {
  AdminTable,
  DateCell,
  DefinitionGrid,
  Heading,
  IdCode,
  NoPermission,
  QueryState,
  UpdatedAt,
  useCan,
  useDebounced,
} from './shared';

const STATUSES = [
  'ACTIVE',
  'PENDING_RESPONSE',
  'RESPONDING',
  'ON_SCENE',
  'RESOLVING',
  'RESOLVED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
const FINAL = ['RESOLVED', 'FAILED', 'EXPIRED', 'CANCELLED'];
const ALL = 'ALL';

export function AdminIncidents() {
  const t = useTranslations('admin.incidents');
  const tc = useTranslations('admin.common');
  const ts = useTranslations('status.incident');
  const name = useCatalogName();
  const [status, setStatus] = React.useState<string>('ACTIVE');
  const [template, setTemplate] = React.useState(ALL);
  const [severityMin, setSeverityMin] = React.useState('1');
  const [careerValue, careerId, setCareerValue] = useDebounced();
  const catalog = useQuery({ queryKey: qk.admin('catalog'), queryFn: adminApi.catalog, staleTime: 600_000 });
  const q = useQuery({
    queryKey: qk.admin('incidents', status, template, severityMin, careerId),
    queryFn: () =>
      adminApi.incidents({
        status: status === ALL ? undefined : status,
        templateCode: template === ALL ? undefined : template,
        severityMin: Number(severityMin) > 1 ? Number(severityMin) : undefined,
        careerId: careerId || undefined,
      }),
    refetchInterval: 10_000,
  });
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        <UpdatedAt at={q.dataUpdatedAt} fetching={q.isFetching} onRefresh={() => void q.refetch()} />
      </Heading>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label={t('status')}
          value={status}
          onValueChange={setStatus}
          className="w-full"
          options={[
            { value: ALL, label: t('all') },
            ...STATUSES.map((s) => ({ value: s, label: s === 'ACTIVE' ? t('activeOnly') : ts(s) })),
          ]}
        />
        <Select
          label={t('template')}
          value={template}
          onValueChange={setTemplate}
          className="w-full"
          options={[
            { value: ALL, label: t('allTemplates') },
            ...(catalog.data?.sections.templates ?? []).map((e) => ({
              value: e.code,
              label: name('incident', e.code, 'title'),
            })),
          ]}
        />
        <Select
          label={t('severityMin')}
          value={severityMin}
          onValueChange={setSeverityMin}
          className="w-full"
          options={Array.from({ length: 10 }, (_, i) => ({
            value: String(i + 1),
            label: t('severityFrom', { severity: i + 1 }),
          }))}
        />
        <Input
          type="search"
          value={careerValue}
          onChange={(e) => setCareerValue(e.target.value)}
          placeholder={t('careerFilter')}
          aria-label={t('careerFilter')}
          className="h-10 text-base lg:text-sm"
          autoComplete="off"
        />
      </div>
      <QueryState loading={q.isLoading} error={q.error}>
        <IncidentRowsTable caption={t('title')} rows={q.data ?? []} showCareer />
        <p className="text-subtle text-xs">{tc('rows', { count: q.data?.length ?? 0 })}</p>
      </QueryState>
    </>
  );
}

export function AdminIncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('admin.incidents');
  const q = useQuery({
    queryKey: qk.admin('incident', id),
    queryFn: () => adminApi.incident(id),
    refetchInterval: 5_000,
  });
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {q.data ? <IncidentInspector detail={q.data} /> : <EmptyState title={t('empty')} />}
    </QueryState>
  );
}

function IncidentInspector({ detail }: { detail: AdminIncidentDetail }) {
  const t = useTranslations('admin.incidents');
  const tc = useTranslations('admin.common');
  const ts = useTranslations('status.incident');
  const tv = useTranslations('status.vehicle');
  const locale = useLocale();
  const tx = useI18nText();
  const name = useCatalogName();
  const can = useCan();
  const { incident, row } = detail;
  const active = !FINAL.includes(incident.status);
  const invalidate = [qk.admin('incident', incident.id), qk.admin('incidents'), qk.admin('careerIncidents')];
  const action = useReasonedAction<'resolve' | 'cancel', AdminIncidentRow>({
    run: (kind, reason) =>
      kind === 'resolve'
        ? adminApi.forceResolveIncident(incident.id, reason)
        : adminApi.cancelIncident(incident.id, reason),
    success: (result) => (result.status === 'RESOLVED' ? t('resolved') : t('cancelled')),
    invalidate,
  });
  const work = incident.work.total > 0 ? 1 - incident.work.remaining / incident.work.total : 0;
  const mayAct = can('incidents.forceResolve') || can('incidents.cancel');

  return (
    <>
      <Heading title={tx(incident.title)} subtitle={incident.address}>
        <SeverityBadge severity={incident.severity} label={t('severity')} escalating={incident.escalating} />
        <StatusChip
          status={incident.status}
          label={ts.has(incident.status) ? ts(incident.status) : incident.status}
        />
        {active && can('incidents.forceResolve') ? (
          <Button
            variant="secondary"
            onClick={() =>
              action.ask('resolve', {
                title: t('resolveTitle'),
                description: t('resolveBody'),
                targetId: incident.id,
                confirmLabel: t('forceResolve'),
              })
            }
          >
            <CheckCheck className="size-4" aria-hidden />
            {t('forceResolve')}
          </Button>
        ) : null}
        {active && can('incidents.cancel') ? (
          <Button
            variant="danger"
            onClick={() =>
              action.ask('cancel', {
                title: t('cancelTitle'),
                description: t('cancelBody'),
                targetId: incident.id,
                confirmLabel: t('cancel'),
              })
            }
          >
            <Ban className="size-4" aria-hidden />
            {t('cancel')}
          </Button>
        ) : null}
        {active && !mayAct ? <NoPermission /> : null}
      </Heading>

      <Card>
        <DefinitionGrid
          items={[
            [tc('id'), <IdCode key="id" value={incident.id} />],
            [
              t('career'),
              <IdCode key="career" value={row.careerId} href={`/admin/careers/${row.careerId}`} />,
            ],
            [t('director'), row.directorName],
            [
              t('template'),
              <code key="tpl" className="text-xs">
                {incident.templateCode}
              </code>,
            ],
            [t('category'), incident.category],
            [t('families'), incident.families.map((f) => name('family', f)).join(', ')],
            [t('created'), formatDateTime(incident.createdAt, locale)],
            [t('expires'), <DateCell key="exp" iso={incident.expiresAt} />],
            [t('closed'), <DateCell key="closed" iso={row.closedAt} />],
            [t('patients'), incident.patientCount],
            [t('coverage'), formatPercent(incident.coverageRatio, locale)],
            [t('position'), `${incident.position[1].toFixed(5)}, ${incident.position[0].toFixed(5)}`],
          ]}
        />
        <div className="mt-4">
          <SectionTitle>{t('work')}</SectionTitle>
          <ProgressBar value={work} label={t('work')} tone="info" showValue />
        </div>
      </Card>

      <section>
        <SectionTitle>{t('requirements')}</SectionTitle>
        <AdminTable
          caption={t('requirements')}
          columns={[
            {
              id: 'capability',
              header: t('capability'),
              width: 'minmax(200px,2fr)',
              cell: (r) => name('capability', r.capability),
            },
            {
              id: 'required',
              header: t('required'),
              width: '110px',
              align: 'right',
              cell: (r) => r.required,
            },
            { id: 'onScene', header: t('onScene'), width: '110px', align: 'right', cell: (r) => r.onScene },
            { id: 'enRoute', header: t('enRoute'), width: '110px', align: 'right', cell: (r) => r.enRoute },
          ]}
          rows={incident.requirements}
          rowKey={(r) => r.capability}
          titleColumn="capability"
          cardTitle={(r) => name('capability', r.capability)}
          density="dense"
          maxHeight={240}
          empty={<EmptyState title={tc('none')} />}
        />
      </section>

      <section>
        <SectionTitle>{t('vehicles', { count: detail.vehicles.length })}</SectionTitle>
        <AdminTable
          caption={t('vehiclesCaption')}
          columns={[
            {
              id: 'callSign',
              header: t('callSign'),
              width: '130px',
              cell: (v) => <span className="font-semibold">{v.callSign}</span>,
            },
            {
              id: 'type',
              header: t('vehicleType'),
              width: 'minmax(180px,2fr)',
              cell: (v) => name('vehicle', v.typeCode),
            },
            {
              id: 'status',
              header: t('status'),
              width: '180px',
              cell: (v) => (
                <StatusChip status={v.status} label={tv.has(v.status) ? tv(v.status) : v.status} />
              ),
            },
            {
              id: 'id',
              header: tc('id'),
              width: 'minmax(250px,1.5fr)',
              cell: (v) => <IdCode value={v.id} />,
            },
          ]}
          rows={detail.vehicles}
          rowKey={(v) => v.id}
          titleColumn="callSign"
          cardTitle={(v) => v.callSign}
          density="dense"
          maxHeight={240}
          empty={<EmptyState title={t('noVehicles')} />}
        />
      </section>

      {incident.externalSupport?.length ? (
        <section>
          <SectionTitle>{t('externalSupport')}</SectionTitle>
          <ul className="panel divide-border/60 divide-y">
            {incident.externalSupport.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{tx(u.name)}</span>
                <code className="text-muted text-xs">{u.status}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionTitle>{t('scheduled')}</SectionTitle>
        <ScheduledActionsTable rows={detail.scheduledActions} maxHeight={240} />
      </section>

      <section>
        <SectionTitle>{t('timeline')}</SectionTitle>
        <Card>
          {detail.timeline.length === 0 ? (
            <p className="text-subtle text-sm">{tc('none')}</p>
          ) : (
            <Timeline
              label={t('timeline')}
              items={detail.timeline.map((e) => ({
                id: e.id,
                time: formatDateTime(e.at, locale),
                title: tx(e.text),
              }))}
            />
          )}
        </Card>
      </section>
      {action.dialog}
    </>
  );
}
