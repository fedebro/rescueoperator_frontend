'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  ADMIN_CATALOG_SECTIONS,
  adminApi,
  type AdminCatalogEntry,
  type AdminCatalogSection,
} from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { CreditAmount } from '@/components/ui/credit-amount';
import type { Column } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Card, EmptyState } from '@/components/ui/misc';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminTable, DefinitionGrid, Heading, QueryState, useDebounced } from './shared';

/** Incident templates are titled, every other catalog entity is named. */
export const catalogField = (kind: string): string => (kind === 'incident' ? 'title' : 'name');

/**
 * Read-only view of the content the server has loaded (decision: a dedicated, career-independent `GET /admin/catalog`
 * instead of a player's catalog, whose locks and prices are resolved for one career).
 */
export function AdminCatalog() {
  const t = useTranslations('admin.catalog');
  const locale = useLocale();
  const name = useCatalogName();
  const [section, setSection] = React.useState<AdminCatalogSection>('vehicles');
  const [value, search, setValue] = useDebounced(150);
  const q = useQuery({ queryKey: qk.admin('catalog'), queryFn: adminApi.catalog, staleTime: 600_000 });

  const rows = React.useMemo(() => {
    const needle = search.toLowerCase();
    return (q.data?.sections[section] ?? []).filter(
      (e) =>
        !needle ||
        e.code.toLowerCase().includes(needle) ||
        name(e.kind, e.code, catalogField(e.kind)).toLowerCase().includes(needle) ||
        (e.family ?? '').toLowerCase().includes(needle),
    );
  }, [q.data, section, search, name]);

  const columns: Column<AdminCatalogEntry>[] = [
    {
      id: 'name',
      header: t('name'),
      width: 'minmax(220px,2fr)',
      cell: (e) => <span className="font-semibold">{name(e.kind, e.code, catalogField(e.kind))}</span>,
      sortValue: (e) => name(e.kind, e.code, catalogField(e.kind)),
    },
    {
      id: 'code',
      header: t('code'),
      width: 'minmax(200px,1.5fr)',
      cell: (e) => <code className="text-xs select-all">{e.code}</code>,
      sortValue: (e) => e.code,
    },
    {
      id: 'family',
      header: t('family'),
      width: '150px',
      cell: (e) => (e.family ? name('family', e.family) : '—'),
      sortValue: (e) => e.family ?? '',
    },
    {
      id: 'level',
      header: t('level'),
      width: '90px',
      align: 'right',
      cell: (e) => e.requiredLevel ?? '—',
      sortValue: (e) => e.requiredLevel ?? 0,
    },
    {
      id: 'price',
      header: t('price'),
      width: '120px',
      align: 'right',
      cell: (e) => (e.price === null ? '—' : <CreditAmount value={e.price} label={t('price')} size="sm" />),
      sortValue: (e) => BigInt(e.price ?? '0'),
    },
    {
      id: 'attributes',
      header: t('attributes'),
      width: 'minmax(320px,4fr)',
      cell: (e) => (
        <span className="text-muted tabular text-xs">
          {Object.entries(e.attributes)
            .filter(([, v]) => v !== null && v !== '')
            .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toLocaleString(locale) : String(v)}`)
            .join(' · ')}
        </span>
      ),
    },
  ];

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        <Input
          className="w-full text-base sm:w-72 lg:text-sm"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          leading={<Search className="size-4" />}
        />
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        {q.data ? (
          <>
            <Card>
              <DefinitionGrid
                items={[
                  [
                    t('version'),
                    <code key="v" className="text-xs">
                      {q.data.version}
                    </code>,
                  ],
                  [
                    t('contentHash'),
                    <code key="h" className="text-xs select-all">
                      {q.data.contentHash}
                    </code>,
                  ],
                  [
                    t('i18nHash'),
                    <code key="i" className="text-xs select-all">
                      {q.data.i18nHash ?? '—'}
                    </code>,
                  ],
                ]}
              />
            </Card>
            <Tabs value={section} onValueChange={(v) => setSection(v as AdminCatalogSection)}>
              <TabsList aria-label={t('sectionsLabel')}>
                {ADMIN_CATALOG_SECTIONS.map((key) => (
                  <TabsTrigger key={key} value={key}>
                    {t(`sections.${key}`)}
                    <span className="text-subtle tabular text-xs">{q.data.sections[key]?.length ?? 0}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <AdminTable
              caption={t(`sections.${section}`)}
              columns={columns}
              rows={rows}
              rowKey={(e) => e.code}
              titleColumn="name"
              cardTitle={(e) => name(e.kind, e.code, catalogField(e.kind))}
              density="dense"
              maxHeight="calc(100dvh - 400px)"
              empty={<EmptyState title={t('empty')} />}
            />
          </>
        ) : null}
      </QueryState>
    </>
  );
}
