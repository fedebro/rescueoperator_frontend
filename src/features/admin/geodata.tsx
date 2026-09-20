'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Hammer, PackageCheck, Undo2 } from 'lucide-react';
import { adminApi, type AdminGeodataRelease } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/misc';
import { useReasonedAction } from './confirm-with-reason';
import { AdminTable, DateCell, Heading, NoPermission, QueryState, StateBadge, useCan } from './shared';

const STATUS_VISUAL = {
  BUILDING: { tone: 'info', icon: Hammer },
  READY: { tone: 'warning', icon: PackageCheck },
  PUBLISHED: { tone: 'success', icon: CheckCircle2 },
  ROLLED_BACK: { tone: 'neutral', icon: Undo2 },
} as const;

export function AdminGeodata() {
  const t = useTranslations('admin.geodata');
  const locale = useLocale();
  const can = useCan();
  const q = useQuery({ queryKey: qk.admin('geodata'), queryFn: adminApi.geodataReleases });
  const action = useReasonedAction<{ release: AdminGeodataRelease; kind: 'publish' | 'rollback' }>({
    run: ({ release, kind }, reason) =>
      kind === 'publish'
        ? adminApi.publishGeodataRelease(release.id, reason)
        : adminApi.rollbackGeodataRelease(release.id, reason),
    success: t('done'),
    invalidate: [qk.admin('geodata')],
  });
  const count = (key: keyof AdminGeodataRelease['counts']): Column<AdminGeodataRelease> => ({
    id: key,
    header: t(`counts.${key}`),
    width: '120px',
    align: 'right',
    cell: (r) => r.counts[key].toLocaleString(locale),
    sortValue: (r) => r.counts[key],
  });
  const columns: Column<AdminGeodataRelease>[] = [
    {
      id: 'version',
      header: t('version'),
      width: '150px',
      cell: (r) => <span className="font-mono font-semibold">{r.version}</span>,
    },
    {
      id: 'status',
      header: t('status'),
      width: '170px',
      cell: (r) => (
        <StateBadge
          tone={STATUS_VISUAL[r.status].tone}
          icon={STATUS_VISUAL[r.status].icon}
          label={t(`statuses.${r.status}`)}
        />
      ),
    },
    count('municipalities'),
    count('sites'),
    count('hospitals'),
    count('populationCells'),
    { id: 'created', header: t('created'), width: '170px', cell: (r) => <DateCell iso={r.createdAt} /> },
    {
      id: 'published',
      header: t('publishedAt'),
      width: '170px',
      cell: (r) => <DateCell iso={r.publishedAt} />,
    },
    {
      id: 'note',
      header: t('note'),
      width: 'minmax(200px,2fr)',
      cell: (r) => <span className="text-muted">{r.note ?? ''}</span>,
    },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        {can('geodata.publish') ? null : <NoPermission />}
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        <AdminTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(r) => r.id}
          titleColumn="version"
          cardTitle={(r) => <span className="font-mono">{r.version}</span>}
          actionsWidth="150px"
          actions={
            can('geodata.publish')
              ? (r) =>
                  r.status === 'READY' || r.status === 'ROLLED_BACK' ? (
                    <Button
                      size="sm"
                      className="h-7"
                      onClick={() =>
                        action.ask(
                          { release: r, kind: 'publish' },
                          {
                            title: t('publishTitle'),
                            description: t('publishBody'),
                            targetId: r.id,
                            confirmLabel: t('publish'),
                            typedConfirmation: r.version,
                          },
                        )
                      }
                    >
                      {t('publish')}
                    </Button>
                  ) : r.status === 'PUBLISHED' ? (
                    <Button
                      size="sm"
                      variant="danger"
                      className="h-7"
                      onClick={() =>
                        action.ask(
                          { release: r, kind: 'rollback' },
                          {
                            title: t('rollbackTitle'),
                            description: t('rollbackBody'),
                            targetId: r.id,
                            confirmLabel: t('rollback'),
                            typedConfirmation: r.version,
                          },
                        )
                      }
                    >
                      {t('rollback')}
                    </Button>
                  ) : null
              : undefined
          }
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
      {action.dialog}
    </>
  );
}
