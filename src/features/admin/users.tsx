'use client';
import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Search, Trash2 } from 'lucide-react';
import {
  adminApi,
  type AdminAuditRow,
  type AdminRole,
  type AdminUserDetail,
  type AdminUserRow,
} from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/ui/data-table';
import { Field, Input } from '@/components/ui/input';
import { Card, EmptyState, SectionTitle } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/switch';
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
  Textarea,
  useCan,
  useDebounced,
} from './shared';

const STATUS_TONE = { ACTIVE: 'success', SUSPENDED: 'danger', DELETION_REQUESTED: 'warning' } as const;
const STATUS_ICON = { ACTIVE: CheckCircle2, SUSPENDED: Ban, DELETION_REQUESTED: Trash2 } as const;
const STAFF_ROLES: AdminRole[] = ['SUPPORT', 'GAME_ADMIN', 'SUPER_ADMIN'];

function UserStatus({ status }: { status: string }) {
  const t = useTranslations('admin.users');
  const known = status in STATUS_TONE ? (status as keyof typeof STATUS_TONE) : null;
  return (
    <StateBadge
      tone={known ? STATUS_TONE[known] : 'neutral'}
      icon={known ? STATUS_ICON[known] : undefined}
      label={known ? t(`statuses.${known}`) : status}
    />
  );
}
function RoleBadges({ roles }: { roles: readonly string[] }) {
  const t = useTranslations('admin.shell');
  const staff = roles.filter((r): r is AdminRole => (STAFF_ROLES as string[]).includes(r));
  if (staff.length === 0) return <span className="text-subtle">{t('roles.USER')}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {staff.map((r) => (
        <Badge key={r} tone="brand">
          {t(`roles.${r}`)}
        </Badge>
      ))}
    </span>
  );
}

export function AdminUsers() {
  const t = useTranslations('admin.users');
  const tc = useTranslations('admin.common');
  const router = useRouter();
  const [value, search, setValue] = useDebounced();
  const [status, setStatus] = React.useState('ALL');
  const q = useQuery({
    queryKey: qk.admin('users', search, status),
    queryFn: () => adminApi.users({ q: search || undefined, status: status === 'ALL' ? undefined : status }),
  });
  const columns: Column<AdminUserRow>[] = [
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
    { id: 'status', header: t('status'), width: '170px', cell: (u) => <UserStatus status={u.status} /> },
    { id: 'roles', header: t('roles'), width: '190px', cell: (u) => <RoleBadges roles={u.roles} /> },
    {
      id: 'lastSeen',
      header: t('lastSeen'),
      width: '160px',
      cell: (u) => <DateCell iso={u.lastSeenAt} />,
      sortValue: (u) => u.lastSeenAt ?? '',
    },
    { id: 'id', header: tc('id'), width: 'minmax(250px,1.5fr)', cell: (u) => <IdCode value={u.id} /> },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        <Select
          label={t('status')}
          value={status}
          onValueChange={setStatus}
          options={[
            { value: 'ALL', label: tc('all') },
            ...(['ACTIVE', 'SUSPENDED', 'DELETION_REQUESTED'] as const).map((s) => ({
              value: s,
              label: t(`statuses.${s}`),
            })),
          ]}
        />
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
        <AdminTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(u) => u.id}
          titleColumn="email"
          cardTitle={(u) => u.email}
          onRowClick={(u) => router.push(`/admin/users/${u.id}`)}
          rowHref={(u) => `/admin/users/${u.id}`}
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
    </>
  );
}

export function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('admin.users');
  const q = useQuery({ queryKey: qk.admin('user', id), queryFn: () => adminApi.user(id) });
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {q.data ? <UserDetail detail={q.data} /> : <EmptyState title={t('empty')} />}
    </QueryState>
  );
}

function UserDetail({ detail }: { detail: AdminUserDetail }) {
  const t = useTranslations('admin.users');
  const tc = useTranslations('admin.common');
  const can = useCan();
  const me = useAuthStore((s) => s.user);
  const { user } = detail;
  const invalidate = [qk.admin('user', user.id), qk.admin('users')];
  const isSelf = me?.id === user.id;

  const status = useReasonedAction<'suspend' | 'reactivate', AdminUserRow>({
    run: (kind, reason) =>
      kind === 'suspend' ? adminApi.suspendUser(user.id, reason) : adminApi.reactivateUser(user.id, reason),
    success: (row) => (row.status === 'SUSPENDED' ? t('suspended') : t('reactivated')),
    invalidate,
  });
  const sessions = useReasonedAction<string | null>({
    run: (sessionId, reason) =>
      sessionId
        ? adminApi.revokeSession(user.id, sessionId, reason)
        : adminApi.revokeAllSessions(user.id, reason),
    success: t('sessionsRevoked'),
    invalidate,
  });

  return (
    <>
      <Heading title={user.email} subtitle={user.directorName}>
        <UserStatus status={user.status} />
        {can('users.suspend') ? (
          user.status === 'ACTIVE' ? (
            <Button
              variant="danger"
              disabled={isSelf}
              onClick={() =>
                status.ask('suspend', {
                  title: t('suspendTitle'),
                  description: t('suspendBody'),
                  targetId: user.id,
                  confirmLabel: t('suspend'),
                })
              }
            >
              <Ban className="size-4" aria-hidden />
              {t('suspend')}
            </Button>
          ) : user.status === 'SUSPENDED' ? (
            <Button
              variant="secondary"
              onClick={() =>
                status.ask('reactivate', {
                  title: t('reactivateTitle'),
                  description: t('reactivateBody'),
                  targetId: user.id,
                  confirmLabel: t('reactivate'),
                  tone: 'primary',
                })
              }
            >
              {t('reactivate')}
            </Button>
          ) : null
        ) : null}
      </Heading>

      <Card>
        <SectionTitle>{t('profile')}</SectionTitle>
        <DefinitionGrid
          items={[
            [tc('id'), <IdCode key="id" value={user.id} />],
            [t('director'), user.directorName],
            [t('roles'), <RoleBadges key="roles" roles={user.roles} />],
            [t('locale'), detail.locale.toUpperCase()],
            [t('marketing'), detail.marketingConsent ? tc('yes') : tc('no')],
            [t('created'), <DateCell key="created" iso={user.createdAt} />],
            [t('lastSeen'), <DateCell key="seen" iso={user.lastSeenAt} />],
            [
              t('career'),
              user.careerId ? (
                <IdCode key="career" value={user.careerId} href={`/admin/careers/${user.careerId}`} />
              ) : (
                tc('none')
              ),
            ],
          ]}
        />
        {detail.suspension ? (
          <p
            role="note"
            className="border-danger/40 bg-danger/10 text-danger mt-4 rounded-md border p-3 text-sm"
          >
            {t('suspensionNote', { by: detail.suspension.by, reason: detail.suspension.reason })}
          </p>
        ) : null}
      </Card>

      <section>
        <SectionTitle
          action={
            can('users.revokeSessions') && detail.sessions.length > 0 ? (
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  sessions.ask(null, {
                    title: t('revokeAllTitle'),
                    description: t('revokeBody'),
                    targetId: user.id,
                    confirmLabel: t('revokeAll'),
                  })
                }
              >
                {t('revokeAll')}
              </Button>
            ) : null
          }
        >
          {t('sessions', { count: detail.sessions.length })}
        </SectionTitle>
        <AdminTable
          caption={t('sessionsCaption')}
          columns={[
            {
              id: 'agent',
              header: t('device'),
              width: 'minmax(240px,3fr)',
              cell: (s) => <span className="text-muted">{s.userAgent ?? tc('none')}</span>,
            },
            {
              id: 'created',
              header: t('signedIn'),
              width: '170px',
              cell: (s) => <DateCell iso={s.createdAt} />,
            },
            {
              id: 'used',
              header: t('lastUsed'),
              width: '170px',
              cell: (s) => <DateCell iso={s.lastUsedAt} />,
            },
          ]}
          rows={detail.sessions}
          rowKey={(s) => s.id}
          cardTitle={(s) => <IdCode value={s.id} />}
          maxHeight={240}
          actionsWidth="130px"
          actions={
            can('users.revokeSessions')
              ? (s) => (
                  <Button
                    size="sm"
                    variant="danger"
                    className="h-7"
                    onClick={() =>
                      sessions.ask(s.id, {
                        title: t('revokeTitle'),
                        description: t('revokeBody'),
                        targetId: s.id,
                        confirmLabel: t('revoke'),
                      })
                    }
                  >
                    {t('revoke')}
                  </Button>
                )
              : undefined
          }
          empty={<EmptyState title={t('noSessions')} />}
        />
      </section>

      <RolesCard user={user} isSelf={isSelf} />
      <NotesCard detail={detail} />

      <section>
        <SectionTitle>{t('auditExcerpt')}</SectionTitle>
        <AuditList rows={detail.audit} />
      </section>
      {status.dialog}
      {sessions.dialog}
    </>
  );
}

function RolesCard({ user, isSelf }: { user: AdminUserRow; isSelf: boolean }) {
  const t = useTranslations('admin.users');
  const ts = useTranslations('admin.shell');
  const can = useCan();
  const current = STAFF_ROLES.filter((r) => user.roles.includes(r));
  const [draft, setDraft] = React.useState<AdminRole[]>(current);
  const action = useReasonedAction<AdminRole[]>({
    run: (roles, reason) => adminApi.setUserRoles(user.id, roles, reason),
    success: t('rolesSaved'),
    invalidate: [qk.admin('user', user.id), qk.admin('users')],
  });
  const dirty = draft.length !== current.length || draft.some((r) => !current.includes(r));
  if (!can('users.roles')) return null;
  return (
    <Card>
      <SectionTitle>{t('rolesTitle')}</SectionTitle>
      <p className="text-muted mb-3 text-sm">{t('rolesHint')}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-6">
        {STAFF_ROLES.map((role) => (
          <label key={role} className="flex min-h-8 items-center gap-2 text-sm">
            <Checkbox
              checked={draft.includes(role)}
              // Removing your own SUPER_ADMIN would lock you out of this very screen.
              disabled={isSelf && role === 'SUPER_ADMIN'}
              onCheckedChange={(checked) =>
                setDraft((d) => (checked === true ? [...d, role] : d.filter((r) => r !== role)))
              }
            />
            {ts(`roles.${role}`)}
          </label>
        ))}
      </div>
      <Button
        className="mt-4"
        disabled={!dirty}
        onClick={() =>
          action.ask(draft, {
            title: t('rolesConfirmTitle'),
            description: t('rolesConfirmBody', {
              roles: draft.map((r) => ts(`roles.${r}`)).join(', ') || ts('roles.USER'),
            }),
            targetId: user.id,
            confirmLabel: t('rolesSave'),
          })
        }
      >
        {t('rolesSave')}
      </Button>
      {action.dialog}
    </Card>
  );
}

function NotesCard({ detail }: { detail: AdminUserDetail }) {
  const t = useTranslations('admin.users');
  const can = useCan();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [text, setText] = React.useState('');
  const add = useMutation({
    mutationFn: () => adminApi.addUserNote(detail.user.id, text.trim()),
    onSuccess: () => {
      setText('');
      toast({ tone: 'success', title: t('noteAdded') });
      void qc.invalidateQueries({ queryKey: qk.admin('user', detail.user.id) });
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  return (
    <Card>
      <SectionTitle>{t('notes')}</SectionTitle>
      {detail.notes.length === 0 ? (
        <p className="text-subtle text-sm">{t('noNotes')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.notes.map((n) => (
            <li key={n.id} className="bg-surface-2 rounded-md p-3 text-sm">
              <p className="break-words whitespace-pre-wrap">{n.text}</p>
              <p className="text-subtle mt-1 text-xs">
                {n.author} · <DateCell iso={n.createdAt} />
              </p>
            </li>
          ))}
        </ul>
      )}
      {can('users.notes') ? (
        <form
          className="mt-4 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 5) add.mutate();
          }}
        >
          <Field label={t('noteLabel')} htmlFor="admin-user-note" hint={t('noteHint')}>
            <Textarea
              id="admin-user-note"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </Field>
          <Button
            type="submit"
            className="self-start"
            disabled={text.trim().length < 5}
            loading={add.isPending}
          >
            {t('noteAdd')}
          </Button>
        </form>
      ) : (
        <NoPermission className="mt-3" />
      )}
    </Card>
  );
}

/** Compact audit rows reused by the user detail and the audit page. */
export function AuditList({ rows, maxHeight = 360 }: { rows: AdminAuditRow[]; maxHeight?: number | string }) {
  const t = useTranslations('admin.audit');
  const columns: Column<AdminAuditRow>[] = [
    { id: 'time', header: t('time'), width: '170px', cell: (a) => <DateCell iso={a.createdAt} /> },
    { id: 'actor', header: t('actor'), width: 'minmax(200px,1.5fr)', cell: (a) => a.actor },
    {
      id: 'action',
      header: t('action'),
      width: 'minmax(190px,1.5fr)',
      cell: (a) => <code className="text-xs">{a.action}</code>,
    },
    {
      id: 'target',
      header: t('target'),
      width: 'minmax(260px,2fr)',
      cell: (a) => (
        <span className="text-muted text-xs">
          {a.targetType}
          {a.targetId ? (
            <>
              {' · '}
              <code className="select-all">{a.targetId}</code>
            </>
          ) : null}
        </span>
      ),
    },
    {
      id: 'reason',
      header: t('reason'),
      width: 'minmax(260px,3fr)',
      cell: (a) => <span title={a.reason ?? undefined}>{a.reason ?? '—'}</span>,
    },
  ];
  return (
    <AdminTable
      caption={t('title')}
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      titleColumn="action"
      cardTitle={(a) => <code className="text-sm">{a.action}</code>}
      maxHeight={maxHeight}
      empty={<EmptyState title={t('empty')} />}
    />
  );
}
