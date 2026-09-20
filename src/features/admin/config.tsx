'use client';
import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Ajv, { type ValidateFunction } from 'ajv';
import {
  Archive,
  CheckCircle2,
  FilePen,
  Minus,
  Pencil,
  Plus,
  Rocket,
  Undo2,
  WandSparkles,
} from 'lucide-react';
import { adminApi, type AdminConfigVersionDetail, type AdminConfigVersionRow } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { toast } from '@/stores/toast';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/ui/data-table';
import { Card, EmptyState, SectionTitle } from '@/components/ui/misc';
import { useReasonedAction } from './confirm-with-reason';
import { diffJson, parseJsonDocument, type DiffEntry } from './json-diff';
import {
  AdminTable,
  DateCell,
  DefinitionGrid,
  Heading,
  IdCode,
  JsonBlock,
  NoPermission,
  QueryState,
  StateBadge,
  useCan,
} from './shared';

const STATUS_VISUAL = {
  DRAFT: { tone: 'warning', icon: FilePen },
  PUBLISHED: { tone: 'success', icon: CheckCircle2 },
  SUPERSEDED: { tone: 'neutral', icon: Archive },
} as const;

function VersionStatus({ status }: { status: AdminConfigVersionRow['status'] }) {
  const t = useTranslations('admin.config');
  const visual = STATUS_VISUAL[status];
  return (
    <span data-testid={`config-status-${status}`}>
      <StateBadge tone={visual.tone} icon={visual.icon} label={t(`statuses.${status}`)} />
    </span>
  );
}

export function AdminConfig() {
  const t = useTranslations('admin.config');
  const router = useRouter();
  const can = useCan();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const q = useQuery({ queryKey: qk.admin('configVersions'), queryFn: adminApi.configVersions });
  const createDraft = useMutation({
    mutationFn: () => adminApi.createConfigDraft({}),
    onSuccess: (draft) => {
      toast({ tone: 'success', title: t('draftCreated', { version: draft.version }) });
      void qc.invalidateQueries({ queryKey: qk.admin('configVersions') });
      router.push(`/admin/config/${draft.id}`);
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const columns: Column<AdminConfigVersionRow>[] = [
    {
      id: 'version',
      header: t('version'),
      width: '150px',
      cell: (v) => <span className="font-mono font-semibold">{v.version}</span>,
      sortValue: (v) => v.version,
    },
    { id: 'status', header: t('status'), width: '160px', cell: (v) => <VersionStatus status={v.status} /> },
    { id: 'author', header: t('author'), width: 'minmax(200px,1.5fr)', cell: (v) => v.author ?? '—' },
    { id: 'created', header: t('created'), width: '170px', cell: (v) => <DateCell iso={v.createdAt} /> },
    {
      id: 'published',
      header: t('publishedAt'),
      width: '170px',
      cell: (v) => <DateCell iso={v.publishedAt} />,
    },
    {
      id: 'note',
      header: t('note'),
      width: 'minmax(220px,3fr)',
      cell: (v) => <span className="text-muted">{v.note ?? ''}</span>,
    },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        {can('config.draft') ? (
          <Button onClick={() => createDraft.mutate()} loading={createDraft.isPending}>
            <Plus className="size-4" aria-hidden />
            {t('createDraft')}
          </Button>
        ) : (
          <NoPermission />
        )}
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        <AdminTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(v) => v.id}
          titleColumn="version"
          cardTitle={(v) => <span className="font-mono">{v.version}</span>}
          onRowClick={(v) => router.push(`/admin/config/${v.id}`)}
          rowHref={(v) => `/admin/config/${v.id}`}
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
    </>
  );
}

export function AdminConfigVersionPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('admin.config');
  const version = useQuery({
    queryKey: qk.admin('configVersion', id),
    queryFn: () => adminApi.configVersion(id),
  });
  const versions = useQuery({ queryKey: qk.admin('configVersions'), queryFn: adminApi.configVersions });
  const publishedId = versions.data?.find((v) => v.status === 'PUBLISHED')?.id;
  const published = useQuery({
    queryKey: qk.admin('configVersion', publishedId),
    queryFn: () => adminApi.configVersion(publishedId!),
    enabled: !!publishedId,
  });
  return (
    <QueryState loading={version.isLoading || versions.isLoading} error={version.error ?? versions.error}>
      {version.data ? (
        <ConfigVersionView
          // A saved draft comes back with new content: remount so the editor starts from the server's text.
          key={`${version.data.id}:${version.data.status}`}
          version={version.data}
          published={published.data ?? null}
        />
      ) : (
        <EmptyState title={t('empty')} />
      )}
    </QueryState>
  );
}

function ConfigVersionView({
  version,
  published,
}: {
  version: AdminConfigVersionDetail;
  published: AdminConfigVersionDetail | null;
}) {
  const t = useTranslations('admin.config');
  const router = useRouter();
  const can = useCan();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const isDraft = version.status === 'DRAFT';
  const editable = isDraft && can('config.draft');
  const [source, setSource] = React.useState(() => JSON.stringify(version.content, null, 2));
  const [saved, setSaved] = React.useState(version.content);
  const schema = useQuery({
    queryKey: qk.admin('configSchema'),
    queryFn: adminApi.configSchema,
    staleTime: 600_000,
    enabled: isDraft,
  });
  const validation = useConfigValidation(source, schema.data);
  const dirty = validation.value !== null && JSON.stringify(validation.value) !== JSON.stringify(saved);
  const compared = validation.value ?? saved;
  const diff = React.useMemo(
    () => (published && published.id !== version.id ? diffJson(published.content, compared) : []),
    [published, version.id, compared],
  );
  const invalidate = [qk.admin('configVersions'), qk.admin('configVersion'), qk.admin('version')];

  const save = useMutation({
    mutationFn: (content: Record<string, unknown>) => adminApi.saveConfigDraft(version.id, { content }),
    onSuccess: (result) => {
      setSaved(result.content);
      toast({ tone: 'success', title: t('saved') });
      for (const queryKey of [qk.admin('configVersions'), qk.admin('configVersion'), qk.admin('audit')])
        void qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const publish = useReasonedAction<null>({
    run: (_v, reason) => adminApi.publishConfigVersion(version.id, reason),
    success: t('published', { version: version.version }),
    invalidate,
  });
  const rollback = useReasonedAction<null>({
    run: (_v, reason) => adminApi.rollbackConfigVersion(version.id, reason),
    success: t('rolledBack', { version: version.version }),
    invalidate,
  });
  const discard = useReasonedAction<null>({
    run: (_v, reason) => adminApi.deleteConfigDraft(version.id, reason),
    success: t('discarded'),
    invalidate: [qk.admin('configVersions')],
    onDone: () => router.push('/admin/config'),
  });

  return (
    <>
      <Heading title={t('versionTitle', { version: version.version })} subtitle={version.note ?? undefined}>
        <VersionStatus status={version.status} />
        {isDraft && can('config.publish') ? (
          <Button
            // Publishing what is on the server: unsaved or invalid text must be dealt with first.
            disabled={dirty || !validation.valid}
            onClick={() =>
              publish.ask(null, {
                title: t('publishTitle'),
                description: t('publishBody', { changes: diff.length }),
                targetId: version.id,
                confirmLabel: t('publish'),
                typedConfirmation: version.version,
                children: <DiffList diff={diff} compact />,
              })
            }
          >
            <Rocket className="size-4" aria-hidden />
            {t('publish')}
          </Button>
        ) : null}
        {version.status === 'SUPERSEDED' && can('config.rollback') ? (
          <Button
            variant="danger"
            onClick={() =>
              rollback.ask(null, {
                title: t('rollbackTitle'),
                description: t('rollbackBody', { version: version.version }),
                targetId: version.id,
                confirmLabel: t('rollback'),
                typedConfirmation: version.version,
                children: <DiffList diff={diff} compact />,
              })
            }
          >
            <Undo2 className="size-4" aria-hidden />
            {t('rollback')}
          </Button>
        ) : null}
        {editable ? (
          <Button
            variant="ghost"
            onClick={() =>
              discard.ask(null, {
                title: t('discardTitle'),
                description: t('discardBody'),
                targetId: version.id,
                confirmLabel: t('discard'),
              })
            }
          >
            {t('discard')}
          </Button>
        ) : null}
        {(isDraft && !can('config.publish')) ||
        (version.status === 'SUPERSEDED' && !can('config.rollback')) ? (
          <NoPermission />
        ) : null}
      </Heading>

      <Card>
        <DefinitionGrid
          items={[
            ['ID', <IdCode key="id" value={version.id} />],
            [t('author'), version.author ?? '—'],
            [t('created'), <DateCell key="c" iso={version.createdAt} />],
            [t('publishedAt'), <DateCell key="p" iso={version.publishedAt} />],
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="min-w-0">
          <SectionTitle
            action={
              editable ? (
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={validation.value === null}
                    onClick={() => validation.value && setSource(JSON.stringify(validation.value, null, 2))}
                  >
                    <WandSparkles className="size-3.5" aria-hidden />
                    {t('format')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!validation.valid || !dirty}
                    loading={save.isPending}
                    onClick={() => validation.value && save.mutate(validation.value)}
                  >
                    {t('save')}
                  </Button>
                </span>
              ) : null
            }
          >
            {editable ? t('editor') : t('content')}
          </SectionTitle>
          {editable ? (
            <>
              <JsonEditor
                value={source}
                onChange={setSource}
                label={t('editor')}
                errorLine={validation.line}
              />
              <ValidationPanel validation={validation} dirty={dirty} />
            </>
          ) : (
            <JsonBlock value={version.content} label={t('content')} />
          )}
        </section>
        <section className="min-w-0">
          <SectionTitle>{t('diffTitle', { version: published?.version ?? '—' })}</SectionTitle>
          {published && published.id === version.id ? (
            <p className="text-subtle panel p-4 text-sm">{t('diffSelf')}</p>
          ) : (
            <DiffList diff={diff} />
          )}
        </section>
      </div>
      {publish.dialog}
      {rollback.dialog}
      {discard.dialog}
    </>
  );
}

interface Validation {
  /** Parsed document, or null while the text is not valid JSON. */
  value: Record<string, unknown> | null;
  /** True only when the JSON parses AND matches the schema served by the API. */
  valid: boolean;
  line: number | null;
  syntaxError: string | null;
  schemaErrors: { path: string; message: string }[];
  schemaReady: boolean;
}

/** Live validation with the JSON Schema served by `GET /admin/config/schema` (the server validates again on save). */
function useConfigValidation(source: string, schema: Record<string, unknown> | undefined): Validation {
  const validate = React.useMemo<ValidateFunction | null>(() => {
    if (!schema) return null;
    try {
      return new Ajv({ allErrors: true, strict: false }).compile(schema);
    } catch {
      return null;
    }
  }, [schema]);
  return React.useMemo(() => {
    const parsed = parseJsonDocument(source);
    if (!parsed.ok)
      return {
        value: null,
        valid: false,
        line: parsed.line,
        syntaxError: parsed.message,
        schemaErrors: [],
        schemaReady: !!validate,
      };
    const ok = validate ? validate(parsed.value) === true : false;
    return {
      value: parsed.value,
      valid: ok,
      line: null,
      syntaxError: null,
      schemaErrors: ok
        ? []
        : (validate?.errors ?? []).map((e) => ({
            path: e.instancePath || '/',
            message: `${e.message ?? 'invalid'}${
              e.params && 'additionalProperty' in e.params ? `: ${String(e.params.additionalProperty)}` : ''
            }`,
          })),
      schemaReady: !!validate,
    };
  }, [source, validate]);
}

function ValidationPanel({ validation, dirty }: { validation: Validation; dirty: boolean }) {
  const t = useTranslations('admin.config');
  if (validation.syntaxError)
    return (
      <p role="alert" data-testid="config-validation" data-valid="false" className="text-danger mt-2 text-sm">
        {validation.line
          ? t('syntaxErrorAt', { line: validation.line, message: validation.syntaxError })
          : t('syntaxError', { message: validation.syntaxError })}
      </p>
    );
  if (!validation.schemaReady) return <p className="text-subtle mt-2 text-sm">{t('schemaLoading')}</p>;
  if (validation.schemaErrors.length > 0)
    return (
      <div
        role="alert"
        data-testid="config-validation"
        data-valid="false"
        className="text-danger mt-2 text-sm"
      >
        <p className="font-semibold">{t('schemaErrors', { count: validation.schemaErrors.length })}</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {validation.schemaErrors.map((e, i) => (
            <li key={`${e.path}-${i}`}>
              <code className="bg-danger/10 rounded-sm px-1 text-xs">{e.path}</code> {e.message}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <p
      data-testid="config-validation"
      data-valid="true"
      className="text-success mt-2 inline-flex items-center gap-1.5 text-sm"
    >
      <CheckCircle2 className="size-4" aria-hidden />
      {dirty ? t('validUnsaved') : t('valid')}
    </p>
  );
}

/** Plain textarea with a synchronised line-number gutter: no editor dependency, works with every keyboard and IME. */
function JsonEditor({
  value,
  onChange,
  label,
  errorLine,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  errorLine: number | null;
}) {
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const lines = value.split('\n').length;
  return (
    <div className="border-border-strong bg-surface-2 focus-within:border-focus flex h-[28rem] overflow-hidden rounded-md border font-mono text-[13px] leading-5">
      <div
        ref={gutterRef}
        aria-hidden
        className="text-subtle bg-surface-1 border-border w-11 shrink-0 overflow-hidden border-r py-2 pr-2 text-right select-none"
      >
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={errorLine === i + 1 ? 'bg-danger/25 text-danger font-bold' : undefined}>
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        aria-label={label}
        data-testid="config-editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={(e) => {
          // Tab indents instead of leaving the field; Escape releases the focus so keyboard users are never trapped.
          if (e.key === 'Escape') e.currentTarget.blur();
          if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart, selectionEnd } = el;
          onChange(`${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`);
          requestAnimationFrame(() => el.setSelectionRange(selectionStart + 2, selectionStart + 2));
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        className="text-fg min-w-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2 whitespace-pre outline-none"
      />
    </div>
  );
}

const DIFF_VISUAL = {
  added: { tone: 'success', icon: Plus },
  removed: { tone: 'danger', icon: Minus },
  changed: { tone: 'warning', icon: Pencil },
} as const;
const show = (v: unknown) => (v === undefined ? '' : JSON.stringify(v));

function DiffList({ diff, compact }: { diff: DiffEntry[]; compact?: boolean }) {
  const t = useTranslations('admin.config');
  if (diff.length === 0) return <p className="text-subtle panel p-4 text-sm">{t('diffEmpty')}</p>;
  return (
    <ul
      aria-label={t('diffLabel')}
      data-testid="config-diff"
      className={
        compact
          ? 'bg-surface-2 scroll-y flex max-h-40 flex-col gap-2 rounded-md p-3'
          : 'panel flex flex-col gap-3 p-4'
      }
    >
      {diff.map((d) => (
        <li key={d.path} className="flex flex-col gap-1 text-sm">
          <span className="flex flex-wrap items-center gap-2">
            <StateBadge
              tone={DIFF_VISUAL[d.kind].tone}
              icon={DIFF_VISUAL[d.kind].icon}
              label={t(`diff.${d.kind}`)}
            />
            <code className="text-xs font-semibold break-all">{d.path}</code>
          </span>
          <span className="font-mono text-xs break-all">
            {d.kind !== 'added' ? (
              <del className="text-danger decoration-danger/60">{show(d.before)}</del>
            ) : null}
            {d.kind === 'changed' ? <span className="text-subtle"> → </span> : null}
            {d.kind !== 'removed' ? <ins className="text-success no-underline">{show(d.after)}</ins> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
