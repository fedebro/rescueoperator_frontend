'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useInfiniteQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Heading, QueryState, useDebounced } from './shared';
import { AuditList } from './users';

const ALL = 'ALL';
const TARGET_TYPES = [
  'user',
  'career',
  'incident',
  'scheduled_action',
  'config_version',
  'feature_flag',
  'closure',
  'weather',
  'geodata_release',
  'referral',
  'purchase',
] as const;

/** Append-only trail of every admin mutation: nothing here can be edited or deleted (Spec 18 §38). */
export function AdminAudit() {
  const t = useTranslations('admin.audit');
  const tc = useTranslations('admin.common');
  const [actorValue, actor, setActor] = useDebounced();
  const [actionValue, action, setAction] = useDebounced();
  const [targetValue, targetId, setTarget] = useDebounced();
  const [targetType, setTargetType] = React.useState<string>(ALL);
  const q = useInfiniteQuery({
    queryKey: qk.admin('audit', actor, action, targetId, targetType),
    queryFn: ({ pageParam }) =>
      adminApi.audit(
        {
          actor: actor || undefined,
          action: action || undefined,
          targetId: targetId || undefined,
          targetType: targetType === ALL ? undefined : targetType,
        },
        pageParam,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const filter = (label: string, value: string, set: (v: string) => void) => (
    <Input
      type="search"
      value={value}
      onChange={(e) => set(e.target.value)}
      placeholder={label}
      aria-label={label}
      className="h-10 text-base lg:text-sm"
      autoComplete="off"
    />
  );
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {filter(t('filterActor'), actorValue, setActor)}
        {filter(t('filterAction'), actionValue, setAction)}
        {filter(t('filterTarget'), targetValue, setTarget)}
        <Select
          label={t('targetType')}
          value={targetType}
          onValueChange={setTargetType}
          className="w-full"
          options={[
            { value: ALL, label: t('allTargets') },
            ...TARGET_TYPES.map((k) => ({ value: k, label: k })),
          ]}
        />
      </div>
      <QueryState loading={q.isLoading} error={q.error}>
        <AuditList rows={rows} maxHeight="calc(100dvh - 320px)" />
        {q.hasNextPage ? (
          <Button
            className="self-start"
            variant="secondary"
            onClick={() => void q.fetchNextPage()}
            loading={q.isFetchingNextPage}
          >
            {tc('loadMore')}
          </Button>
        ) : null}
      </QueryState>
    </>
  );
}
