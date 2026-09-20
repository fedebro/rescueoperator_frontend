'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminFeatureFlagRow } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { EmptyState } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { useReasonedAction } from './confirm-with-reason';
import { DateCell, Heading, NoPermission, QueryState, StateBadge, useCan } from './shared';

/** A flag never flips on click: the switch opens the confirmation and shows the server state until it answers. */
export function AdminFlags() {
  const t = useTranslations('admin.flags');
  const can = useCan();
  const editable = can('flags.toggle');
  const q = useQuery({ queryKey: qk.admin('flags'), queryFn: adminApi.featureFlags });
  const toggle = useReasonedAction<AdminFeatureFlagRow, AdminFeatureFlagRow>({
    run: (flag, reason) => adminApi.setFeatureFlag(flag.key, !flag.enabled, reason),
    success: (row) =>
      row.enabled ? t('enabledDone', { key: row.key }) : t('disabledDone', { key: row.key }),
    invalidate: [qk.admin('flags')],
  });
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        {editable ? null : <NoPermission />}
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        {q.data?.length === 0 ? <EmptyState title={t('empty')} /> : null}
        <ul aria-label={t('title')} className="flex flex-col gap-2">
          {q.data?.map((flag) => (
            <li key={flag.key} className="panel flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <code className="font-semibold break-all">{flag.key}</code>
                  <StateBadge
                    tone={flag.enabled ? 'success' : 'neutral'}
                    label={flag.enabled ? t('enabled') : t('disabled')}
                  />
                </p>
                {flag.description ? <p className="text-muted mt-1 text-sm">{flag.description}</p> : null}
                <p className="text-subtle mt-1 text-xs">
                  {t('updated')} <DateCell iso={flag.updatedAt} />
                </p>
              </div>
              <Switch
                checked={flag.enabled}
                disabled={!editable}
                aria-label={flag.key}
                onCheckedChange={() =>
                  toggle.ask(flag, {
                    title: flag.enabled ? t('disableTitle') : t('enableTitle'),
                    description: t('toggleBody'),
                    targetId: flag.key,
                    confirmLabel: flag.enabled ? t('disable') : t('enable'),
                    tone: flag.enabled ? 'danger' : 'primary',
                  })
                }
              />
            </li>
          ))}
        </ul>
      </QueryState>
      {toggle.dialog}
    </>
  );
}
