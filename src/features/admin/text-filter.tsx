'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, CheckCircle2, EyeOff, Flag } from 'lucide-react';
import {
  adminApi,
  type AdminTextFilterTermRequest,
  type AdminTextFilterTermRow,
  type TextCheckResult,
} from '@/lib/api/admin';
import { useErrorMessage } from '@/lib/api/error-message';
import { qk } from '@/lib/api/query-keys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/ui/data-table';
import { Field, Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useReasonedAction } from './confirm-with-reason';
import { REPORT_KINDS, REPORT_REASONS } from './moderation';
import {
  AdminTable,
  DateCell,
  Heading,
  NoPermission,
  QueryState,
  StateBadge,
  Textarea,
  useCan,
  useDebounced,
} from './shared';

const ALL = 'ALL';
const NONE = 'NONE';
export const LOCALES = ['it', 'en', 'fr', 'de', 'es'] as const;
export const TIERS = ['REJECT', 'MASK', 'FLAG'] as const;
const TIER_VISUAL = {
  REJECT: { tone: 'danger', icon: Ban },
  MASK: { tone: 'warning', icon: EyeOff },
  FLAG: { tone: 'info', icon: Flag },
} as const;

/** The term lists of the text filter: per locale and tier, editable by a game admin without a release; plus a "try a text" panel. */
export function AdminTextFilter() {
  const t = useTranslations('admin.textFilter');
  const tc = useTranslations('admin.common');
  const can = useCan();
  const editable = can('moderation.textFilter');
  const [locale, setLocale] = React.useState<string>(ALL);
  const [tier, setTier] = React.useState<string>(ALL);
  const [qValue, qDebounced, setQ] = useDebounced();
  const q = useQuery({
    queryKey: qk.admin('textFilter', locale, tier, qDebounced),
    queryFn: () =>
      adminApi.textFilterTerms({
        locale: locale === ALL ? undefined : locale,
        tier: tier === ALL ? undefined : tier,
        q: qDebounced || undefined,
      }),
  });
  const invalidate = [qk.admin('textFilter')];
  const toggle = useReasonedAction<AdminTextFilterTermRow, AdminTextFilterTermRow>({
    run: (row, reason) => adminApi.patchTextFilterTerm(row.id, { enabled: !row.enabled, reason }),
    success: (row) =>
      row.enabled ? t('enabledDone', { term: row.term }) : t('disabledDone', { term: row.term }),
    invalidate,
  });
  const retier = useReasonedAction<
    { row: AdminTextFilterTermRow; tier: AdminTextFilterTermRow['tier'] },
    AdminTextFilterTermRow
  >({
    run: ({ row, tier: next }, reason) => adminApi.patchTextFilterTerm(row.id, { tier: next, reason }),
    success: t('tierDone'),
    invalidate,
  });
  const remove = useReasonedAction<AdminTextFilterTermRow>({
    run: (row, reason) => adminApi.deleteTextFilterTerm(row.id, reason),
    success: t('deletedDone'),
    invalidate,
  });
  const columns: Column<AdminTextFilterTermRow>[] = [
    {
      id: 'term',
      header: t('term'),
      width: 'minmax(160px,2fr)',
      cell: (r) => <code className={r.enabled ? 'font-semibold' : 'text-subtle line-through'}>{r.term}</code>,
      sortValue: (r) => r.term,
    },
    {
      id: 'locale',
      header: t('locale'),
      width: '80px',
      cell: (r) => r.locale.toUpperCase(),
      sortValue: (r) => r.locale,
    },
    {
      id: 'tier',
      header: t('tier'),
      width: '150px',
      cell: (r) => (
        <StateBadge
          tone={TIER_VISUAL[r.tier].tone}
          icon={TIER_VISUAL[r.tier].icon}
          label={t(`tiers.${r.tier}`)}
        />
      ),
      sortValue: (r) => r.tier,
    },
    {
      id: 'reason',
      header: t('reason'),
      width: '170px',
      cell: (r) => (r.reason ? t(`reasons.${r.reason}`) : '—'),
    },
    {
      id: 'source',
      header: t('source'),
      width: '110px',
      cell: (r) => (
        <Badge tone={r.source === 'ADMIN' ? 'brand' : 'neutral'}>{t(`sources.${r.source}`)}</Badge>
      ),
    },
    {
      id: 'enabled',
      header: t('enabled'),
      width: '100px',
      cell: (r) =>
        r.enabled ? (
          <StateBadge tone="success" icon={CheckCircle2} label={tc('yes')} />
        ) : (
          <StateBadge tone="neutral" label={tc('no')} />
        ),
    },
    {
      id: 'updated',
      header: t('updated'),
      width: '170px',
      cell: (r) => <DateCell iso={r.updatedAt} />,
      sortValue: (r) => r.updatedAt,
    },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        {editable ? null : <NoPermission />}
      </Heading>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select
          label={t('locale')}
          value={locale}
          onValueChange={setLocale}
          className="w-full"
          options={[
            { value: ALL, label: tc('all') },
            ...LOCALES.map((l) => ({ value: l, label: l.toUpperCase() })),
          ]}
        />
        <Select
          label={t('tier')}
          value={tier}
          onValueChange={setTier}
          className="w-full"
          options={[
            { value: ALL, label: tc('all') },
            ...TIERS.map((x) => ({ value: x, label: t(`tiers.${x}`) })),
          ]}
        />
        <Input
          type="search"
          value={qValue}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="h-10 text-base lg:text-sm"
          autoComplete="off"
        />
      </div>
      <QueryState loading={q.isLoading} error={q.error}>
        <AdminTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(r) => r.id}
          cardTitle={(r) => r.term}
          titleColumn="term"
          actionsWidth="300px"
          maxHeight="calc(100dvh - 420px)"
          actions={
            editable
              ? (r) => (
                  <>
                    <Select
                      label={t('tier')}
                      value={r.tier}
                      onValueChange={(next) => {
                        if (next !== r.tier)
                          retier.ask(
                            { row: r, tier: next as AdminTextFilterTermRow['tier'] },
                            {
                              title: t('tierTitle', { term: r.term }),
                              description: t(`tierHelp.${next as AdminTextFilterTermRow['tier']}`),
                              targetId: r.term,
                              confirmLabel: t('change'),
                            },
                          );
                      }}
                      className="w-36"
                      options={TIERS.map((x) => ({ value: x, label: t(`tiers.${x}`) }))}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7"
                      onClick={() =>
                        toggle.ask(r, {
                          title: r.enabled
                            ? t('disableTitle', { term: r.term })
                            : t('enableTitle', { term: r.term }),
                          targetId: r.term,
                          confirmLabel: r.enabled ? t('disable') : t('enable'),
                        })
                      }
                    >
                      {r.enabled ? t('disable') : t('enable')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      className="h-7"
                      onClick={() =>
                        remove.ask(r, {
                          title: t('deleteTitle', { term: r.term }),
                          description: t('deleteBody'),
                          targetId: r.term,
                          confirmLabel: t('delete'),
                        })
                      }
                    >
                      {t('delete')}
                    </Button>
                  </>
                )
              : undefined
          }
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {editable ? <AddTerm /> : null}
        <TryText />
      </div>
      {toggle.dialog}
      {retier.dialog}
      {remove.dialog}
    </>
  );
}

function AddTerm() {
  const t = useTranslations('admin.textFilter');
  const [locale, setLocale] = React.useState<string>('it');
  const [term, setTerm] = React.useState('');
  const [tier, setTier] = React.useState<string>('MASK');
  const [reason, setReason] = React.useState<string>(NONE);
  const create = useReasonedAction<Omit<AdminTextFilterTermRequest, 'reason'>, AdminTextFilterTermRow>({
    run: (body, reasonText) => adminApi.createTextFilterTerm({ ...body, reason: reasonText }),
    success: (row) => t('createdDone', { term: row.term }),
    invalidate: [qk.admin('textFilter')],
    onDone: () => setTerm(''),
  });
  const trimmed = term.trim();
  const invalid = trimmed.replace(/\*/g, '').length < 2;
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="add-term">
      <h2 id="add-term" className="font-semibold">
        {t('addTitle')}
      </h2>
      <p className="text-muted text-sm">{t('syntax')}</p>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          create.ask(
            {
              locale: locale as AdminTextFilterTermRequest['locale'],
              term: trimmed,
              tier: tier as AdminTextFilterTermRequest['tier'],
              moderationReason:
                reason === NONE ? undefined : (reason as AdminTextFilterTermRequest['moderationReason']),
            },
            {
              title: t('addConfirmTitle', { term: trimmed }),
              description: t(`tierHelp.${tier as AdminTextFilterTermRow['tier']}`),
              targetId: trimmed,
              confirmLabel: t('add'),
              tone: 'primary',
            },
          );
        }}
      >
        <Field label={t('term')} htmlFor="new-term" error={term && invalid ? t('termInvalid') : null}>
          <Input
            id="new-term"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            autoComplete="off"
            maxLength={64}
          />
        </Field>
        <Select
          label={t('locale')}
          value={locale}
          onValueChange={setLocale}
          className="w-full"
          options={LOCALES.map((l) => ({ value: l, label: l.toUpperCase() }))}
        />
        <Select
          label={t('tier')}
          value={tier}
          onValueChange={setTier}
          className="w-full"
          options={TIERS.map((x) => ({ value: x, label: t(`tiers.${x}`) }))}
        />
        <Select
          label={t('reason')}
          value={reason}
          onValueChange={setReason}
          className="w-full"
          options={[
            { value: NONE, label: t('noReason') },
            ...REPORT_REASONS.map((r) => ({ value: r, label: t(`reasons.${r}`) })),
          ]}
        />
        <div className="sm:col-span-2">
          <Button type="submit" disabled={invalid || create.isPending}>
            {t('add')}
          </Button>
        </div>
      </form>
      {create.dialog}
    </section>
  );
}

function TryText() {
  const t = useTranslations('admin.textFilter');
  const errorMessage = useErrorMessage();
  const [text, setText] = React.useState('');
  const [kind, setKind] = React.useState<string>('MESSAGE');
  const run = useMutation({
    mutationFn: () => adminApi.testTextFilter({ text, kind: kind as (typeof REPORT_KINDS)[number] }),
  });
  const result: TextCheckResult | undefined = run.data;
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="try-text">
      <h2 id="try-text" className="font-semibold">
        {t('tryTitle')}
      </h2>
      <p className="text-muted text-sm">{t('tryHint')}</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) run.mutate();
        }}
      >
        <Field label={t('tryText')} htmlFor="try-text-input">
          <Textarea
            id="try-text-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
          />
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label={t('tryKind')}
            value={kind}
            onValueChange={setKind}
            className="w-48"
            options={REPORT_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
          />
          <Button type="submit" variant="secondary" disabled={!text.trim() || run.isPending}>
            {t('try')}
          </Button>
        </div>
      </form>
      {run.error ? (
        <p role="alert" className="text-danger text-sm">
          {errorMessage(run.error)}
        </p>
      ) : null}
      {result ? (
        <div
          className="bg-surface-2 border-border flex flex-col gap-2 rounded-md border p-3 text-sm"
          aria-live="polite"
        >
          <p className="flex flex-wrap items-center gap-2">
            {result.ok ? (
              <StateBadge tone="success" icon={CheckCircle2} label={t('verdictOk')} />
            ) : (
              <StateBadge tone="danger" icon={Ban} label={t('verdictRejected')} />
            )}
            {result.tier ? (
              <StateBadge
                tone={TIER_VISUAL[result.tier].tone}
                icon={TIER_VISUAL[result.tier].icon}
                label={t(`tiers.${result.tier}`)}
              />
            ) : null}
            {result.reasons.map((r) => (
              <Badge key={r} tone="neutral">
                {t(`filterReasons.${r}`)}
              </Badge>
            ))}
          </p>
          <p>
            <span className="text-subtle text-xs font-semibold tracking-wide uppercase">{t('stored')}</span>{' '}
            <span className="break-words">{result.masked}</span>
          </p>
        </div>
      ) : null}
    </section>
  );
}
