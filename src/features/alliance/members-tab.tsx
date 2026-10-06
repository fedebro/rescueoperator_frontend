'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy, Link2, LogOut, MoreHorizontal, Search, Share2, UserPlus, X } from 'lucide-react';
import type { AllianceMemberDto, AllianceMuteDuration, DirectorCardDto, MyAllianceDto } from '@/contracts';
import { allianceApi } from '@/lib/api/alliance';
import { qk } from '@/lib/api/query-keys';
import { formatDateTime } from '@/lib/format';
import { useServerNow } from '@/hooks/use-server-now';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useSnapshot } from '@/features/game/hooks';
import { canNativeShare, copyText, nativeShare } from '@/features/monetization/share';
import { FamilyBadge } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { TimeAgo } from '@/components/ui/time-ago';
import { canActOn } from './contracts';
import { useAllianceInvites, useAllianceMembers, useAllianceMutation, useJoinRequests } from './hooks';

type Confirm =
  | { kind: 'remove'; member: AllianceMemberDto; ban: boolean }
  | { kind: 'transfer'; member: AllianceMemberDto }
  | { kind: 'leave' }
  | null;

export function PresenceDot({ presence }: { presence: AllianceMemberDto['presence'] }) {
  const t = useTranslations('alliance.presence');
  const shown = presence ?? 'AWAY';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs"
      data-testid="member-presence"
      data-presence={shown}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-2 rounded-full',
          shown === 'ON_DUTY' ? 'bg-success' : shown === 'ONLINE' ? 'bg-info' : 'bg-border-strong',
        )}
      />
      {t(shown)}
    </span>
  );
}

/** One member row: name + tag of the role, level, municipality, presence, services; the "…" menu for high roles. */
function MemberRow({
  member,
  alliance,
  now,
  onOpen,
  onAction,
}: {
  member: AllianceMemberDto;
  alliance: MyAllianceDto;
  /** Server time (ms): a mute that ended since the list was read no longer shows. */
  now: number;
  onOpen: (careerId: string) => void;
  onAction: (action: MemberAction, member: AllianceMemberDto) => void;
}) {
  const t = useTranslations('alliance.members');
  const tr = useTranslations('alliance.role');
  const locale = useLocale();
  const me = member.id === alliance.me.memberId;
  const actionable = !me && alliance.me.isHighRole && canActOn(alliance.me.role, member.role);
  const muted = member.mutedUntil !== null && Date.parse(member.mutedUntil) > now;
  return (
    <li className="flex items-center gap-3 py-2.5" data-testid="member-row" data-role={member.role}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => onOpen(member.careerId)}
        aria-label={t('card')}
      >
        <span
          className="bg-surface-3 text-fg grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold"
          aria-hidden
        >
          {member.directorName.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate font-semibold">{member.directorName}</span>
            {me ? <Badge tone="info">{t('you')}</Badge> : null}
            <Badge
              tone={member.role === 'COORDINATOR' ? 'brand' : member.role === 'DEPUTY' ? 'xp' : 'neutral'}
              data-testid="member-role"
            >
              {tr(member.role)}
            </Badge>
            {member.inactive ? <Badge tone="warning">{t('inactive')}</Badge> : null}
            {muted ? <Badge tone="warning">{t('mutedShort')}</Badge> : null}
            {member.blocked ? <Badge tone="danger">{t('blocked')}</Badge> : null}
          </span>
          <span className="text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span>{t('level', { level: member.level })}</span>
            <span>{member.locationName}</span>
            <PresenceDot presence={member.presence} />
            <span className="inline-flex gap-0.5">
              {member.families.map((f) => (
                <FamilyBadge key={f} family={f} size={16} />
              ))}
            </span>
          </span>
        </span>
      </button>
      {actionable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              variant="ghost"
              size="sm"
              label={t('actions', { name: member.directorName })}
              data-testid="member-actions"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{member.directorName}</DropdownMenuLabel>
            {alliance.me.role === 'COORDINATOR' ? (
              <>
                {member.role === 'MEMBER' ? (
                  <DropdownMenuItem
                    onSelect={() => onAction({ kind: 'role', role: 'DEPUTY' }, member)}
                    data-testid="action-promote"
                  >
                    {t('promote')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => onAction({ kind: 'role', role: 'MEMBER' }, member)}
                    data-testid="action-demote"
                  >
                    {t('demote')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => onAction({ kind: 'transfer' }, member)}
                  data-testid="action-transfer"
                >
                  {t('transfer')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {muted ? (
              <DropdownMenuItem onSelect={() => onAction({ kind: 'unmute' }, member)}>
                {t('unmute')}
              </DropdownMenuItem>
            ) : (
              (['H1', 'H24', 'D7'] as AllianceMuteDuration[]).map((d) => (
                <DropdownMenuItem
                  key={d}
                  onSelect={() => onAction({ kind: 'mute', duration: d }, member)}
                  data-testid={`action-mute-${d}`}
                >
                  {t('mute')} · {t(`muteFor.${d}`)}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              tone="danger"
              onSelect={() => onAction({ kind: 'remove', ban: false }, member)}
              data-testid="action-remove"
            >
              {t('remove')}
            </DropdownMenuItem>
            <DropdownMenuItem
              tone="danger"
              onSelect={() => onAction({ kind: 'remove', ban: true }, member)}
              data-testid="action-ban"
            >
              {t('ban')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {muted ? (
        <span className="sr-only">{t('muted', { until: formatDateTime(member.mutedUntil!, locale) })}</span>
      ) : null}
    </li>
  );
}

type MemberAction =
  | { kind: 'role'; role: 'DEPUTY' | 'MEMBER' }
  | { kind: 'transfer' }
  | { kind: 'mute'; duration: AllianceMuteDuration }
  | { kind: 'unmute' }
  | { kind: 'remove'; ban: boolean };

/** Join requests waiting for a high role (study 02 §4). */
function JoinRequestsSection({ alliance }: { alliance: MyAllianceDto }) {
  const t = useTranslations('alliance.requests');
  const requests = useJoinRequests(alliance.me.isHighRole);
  const decide = useAllianceMutation(
    (careerId, v: { requestId: string; decision: 'ACCEPT' | 'REJECT' }) =>
      allianceApi.decide(careerId, v.requestId, { decision: v.decision }),
    { successToast: (r) => (r.status === 'ACCEPTED' ? t('accepted') : t('rejected')) },
  );
  if (!alliance.me.isHighRole) return null;
  const list = requests.data ?? [];
  return (
    <Card>
      <SectionTitle>{t('title')}</SectionTitle>
      {requests.isPending ? (
        <Skeleton className="h-12" />
      ) : list.length === 0 ? (
        <p className="text-muted text-sm">{t('empty')}</p>
      ) : (
        <ul className="divide-border divide-y" data-testid="alliance-join-requests">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5" data-testid="join-request">
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-semibold">{r.directorName}</p>
                <p className="text-muted text-xs">
                  {t('who', { level: r.level, location: r.locationName })} · {t('expires')}{' '}
                  <TimeAgo at={r.expiresAt} />
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => decide.mutate({ requestId: r.id, decision: 'REJECT' })}
                loading={
                  decide.isPending &&
                  decide.variables?.requestId === r.id &&
                  decide.variables.decision === 'REJECT'
                }
              >
                <X className="size-4" aria-hidden />
                {t('reject')}
              </Button>
              <Button
                size="sm"
                onClick={() => decide.mutate({ requestId: r.id, decision: 'ACCEPT' })}
                loading={
                  decide.isPending &&
                  decide.variables?.requestId === r.id &&
                  decide.variables.decision === 'ACCEPT'
                }
                data-testid="request-accept"
              >
                <Check className="size-4" aria-hidden />
                {t('accept')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The alliance invite URL (`/invite/alliance/<code>`, contracts/alliances.ts). */
export const allianceInviteUrl = (
  code: string,
  origin = typeof window === 'undefined' ? '' : window.location.origin,
): string => `${origin}/invite/alliance/${encodeURIComponent(code)}`;

/** Invites: the link with its code (create / copy / share / revoke) and direct invites by name (study 02 §4). */
export function InvitesSection({
  alliance,
  focusRef,
}: {
  alliance: MyAllianceDto;
  focusRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations('alliance.invites');
  const invites = useAllianceInvites(alliance.me.canInvite);
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const create = useAllianceMutation(
    (careerId, body: { targetCareerId?: string }) => allianceApi.createInvite(careerId, body),
    {
      invalidate: (careerId) => [qk.allianceInvites(careerId)],
      successToast: (invite) =>
        invite.target ? t('inviteSent', { name: invite.target.directorName ?? '' }) : null,
    },
  );
  const revoke = useAllianceMutation(
    (careerId, inviteId: string) => allianceApi.revokeInvite(careerId, inviteId),
    { successToast: t('revoked') },
  );
  // Directors by name, 300 ms after the last keystroke, from two characters on.
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const search = useQuery({
    queryKey: qk.directorSearch(debounced),
    queryFn: () => allianceApi.searchDirectors(debounced),
    enabled: alliance.me.canInvite && debounced.length >= 2,
    staleTime: 15_000,
  });
  if (!alliance.me.canInvite) return null;
  const active = (invites.data ?? []).filter((i) => i.status === 'ACTIVE');
  const link = active.find((i) => i.code);
  const direct = active.filter((i) => i.target);
  const hits: DirectorCardDto[] | null =
    debounced.length >= 2 ? (search.data ?? (search.isError ? [] : null)) : null;
  const searching = debounced.length >= 2 && search.isFetching;
  const pendingFor = (careerId: string) => direct.some((i) => i.target?.careerId === careerId);
  const copy = async (code: string) => {
    const ok = await copyText(allianceInviteUrl(code));
    setCopied(ok);
    toast({ tone: ok ? 'success' : 'danger', title: ok ? t('copied') : t('copyFailed'), durationMs: 3000 });
    setTimeout(() => setCopied(false), 2000);
  };
  const share = async (code: string) => {
    const result = await nativeShare({
      title: alliance.name,
      text: t('shareText', { name: alliance.name, tag: alliance.tag }),
      url: allianceInviteUrl(code),
    });
    if (result === 'unsupported') await copy(code);
  };
  return (
    <div ref={focusRef}>
      <Card className="flex flex-col gap-4" data-testid="alliance-invites">
        <SectionTitle>{t('title')}</SectionTitle>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">{t('link')}</p>
          {link ? (
            <div className="flex flex-wrap items-center gap-2">
              <code
                className="bg-surface-2 border-border tabular rounded-md border px-3 py-2 text-sm"
                data-testid="invite-code"
              >
                {link.code}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void copy(link.code!)}
                data-testid="invite-copy"
              >
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {t('copy')}
              </Button>
              {canNativeShare() ? (
                <Button size="sm" variant="secondary" onClick={() => void share(link.code!)}>
                  <Share2 className="size-4" aria-hidden />
                  {t('share')}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revoke.mutate(link.id)}
                loading={revoke.isPending && revoke.variables === link.id}
                data-testid="invite-revoke"
              >
                {t('revoke')}
              </Button>
              <span className="text-subtle text-xs">
                {t('uses', { count: link.uses })} · {t('expires')} <TimeAgo at={link.expiresAt} />
              </span>
            </div>
          ) : (
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => create.mutate({})}
                loading={create.isPending && !create.variables?.targetCareerId}
                data-testid="invite-create"
              >
                <Link2 className="size-4" aria-hidden />
                {t('create')}
              </Button>
            </div>
          )}
          <p className="text-subtle text-xs">{t('linkHint', { days: 7 })}</p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">{t('direct')}</p>
          <Input
            leading={<Search className="size-4" aria-hidden />}
            placeholder={t('search')}
            aria-label={t('search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            data-testid="invite-search"
          />
          {hits !== null ? (
            hits.length === 0 && !searching ? (
              <p className="text-muted text-sm">{t('noResults')}</p>
            ) : (
              <ul className="divide-border divide-y" aria-busy={searching} data-testid="invite-hits">
                {hits.map((d) => (
                  <li key={d.careerId} className="flex items-center gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {d.directorName}
                        {d.alliance ? (
                          <span className="tabular text-muted ml-1 text-xs">[{d.alliance.tag}]</span>
                        ) : null}
                      </p>
                      <p className="text-muted text-xs">
                        {t('hitWho', { level: d.level, location: d.locationName })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!d.canInvite || pendingFor(d.careerId)}
                      onClick={() => create.mutate({ targetCareerId: d.careerId })}
                      loading={create.isPending && create.variables?.targetCareerId === d.careerId}
                      data-testid="invite-direct"
                    >
                      <UserPlus className="size-4" aria-hidden />
                      {pendingFor(d.careerId)
                        ? t('invitedShort')
                        : d.canInvite
                          ? t('invite')
                          : d.alliance
                            ? t('inAlliance')
                            : t('notInvitable')}
                    </Button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="text-subtle text-xs">{t('directHint')}</p>
          )}
          {direct.length > 0 ? (
            <ul
              className="mt-1 flex flex-wrap gap-1.5"
              aria-label={t('pending')}
              data-testid="invite-pending"
            >
              {direct.map((i) => (
                <li
                  key={i.id}
                  className="bg-surface-2 border-border flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-3 text-xs"
                >
                  {t('directTo', { name: i.target?.directorName ?? '' })}
                  <IconButton
                    variant="ghost"
                    size="sm"
                    className="size-7 min-h-0"
                    label={t('revoke')}
                    onClick={() => revoke.mutate(i.id)}
                  >
                    <X className="size-3" aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

/** Membri (study 09 §2.2): the list with roles and actions, the join requests, the invites, and "Esci dall'alleanza". */
export function MembersTab({
  alliance,
  onOpenMember,
  onLeft,
  invitesRef,
}: {
  alliance: MyAllianceDto;
  onOpenMember: (careerId: string) => void;
  onLeft: () => void;
  invitesRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations('alliance.members');
  const tc = useTranslations('common');
  const { career } = useSnapshot();
  const members = useAllianceMembers();
  const now = useServerNow(30_000);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const setRole = useAllianceMutation(
    (careerId, v: { memberId: string; role: 'DEPUTY' | 'MEMBER' }) =>
      allianceApi.setRole(careerId, v.memberId, { role: v.role }),
    {
      successToast: (m) =>
        m.role === 'DEPUTY'
          ? t('promoted', { name: m.directorName })
          : t('demoted', { name: m.directorName }),
    },
  );
  const mute = useAllianceMutation(
    (careerId, v: { memberId: string; duration: AllianceMuteDuration }) =>
      allianceApi.mute(careerId, v.memberId, { duration: v.duration }),
    { successToast: (m) => t('mutedToast', { name: m.directorName }) },
  );
  const unmute = useAllianceMutation((careerId, memberId: string) => allianceApi.unmute(careerId, memberId), {
    successToast: (m) => t('unmutedToast', { name: m.directorName }),
  });
  const remove = useAllianceMutation(
    (careerId, v: { memberId: string; ban: boolean; name: string }) =>
      allianceApi.remove(careerId, v.memberId, { ban: v.ban }),
    {
      successToast: (_d, v) =>
        v.ban ? t('bannedToast', { name: v.name }) : t('removedToast', { name: v.name }),
      onSuccess: () => setConfirm(null),
    },
  );
  const transfer = useAllianceMutation(
    (careerId, memberId: string) => allianceApi.transfer(careerId, { memberId }),
    {
      successToast: t('transferred'),
      onSuccess: () => setConfirm(null),
    },
  );
  const leave = useAllianceMutation((careerId) => allianceApi.leave(careerId), {
    successToast: t('left'),
    onSuccess: () => {
      setConfirm(null);
      onLeft();
    },
  });
  const onAction = (action: MemberAction, member: AllianceMemberDto) => {
    switch (action.kind) {
      case 'role':
        setRole.mutate({ memberId: member.id, role: action.role });
        break;
      case 'mute':
        mute.mutate({ memberId: member.id, duration: action.duration });
        break;
      case 'unmute':
        unmute.mutate(member.id);
        break;
      case 'remove':
        setConfirm({ kind: 'remove', member, ban: action.ban });
        break;
      case 'transfer':
        setConfirm({ kind: 'transfer', member });
        break;
    }
  };
  const list = members.data ?? [];
  const others = list.filter((m) => m.id !== alliance.me.memberId).length;
  const mustTransfer = alliance.me.role === 'COORDINATOR' && others > 0;
  void career;
  return (
    <div className="flex flex-col gap-4" data-testid="alliance-members">
      <Card>
        <SectionTitle>{t('title', { count: alliance.members, slots: alliance.memberSlots })}</SectionTitle>
        {members.isPending ? (
          <Skeleton className="h-32" />
        ) : list.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="divide-border divide-y" aria-label={t('listLabel')} data-testid="member-list">
            {list.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                alliance={alliance}
                now={now}
                onOpen={onOpenMember}
                onAction={onAction}
              />
            ))}
          </ul>
        )}
      </Card>
      <JoinRequestsSection alliance={alliance} />
      <InvitesSection alliance={alliance} focusRef={invitesRef} />
      <div className="flex flex-col items-start gap-1">
        <Button variant="danger" onClick={() => setConfirm({ kind: 'leave' })} data-testid="alliance-leave">
          <LogOut className="size-4" aria-hidden />
          {t('leave')}
        </Button>
        {mustTransfer ? <p className="text-subtle text-xs">{t('leaveTransferFirst')}</p> : null}
      </div>
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        {confirm?.kind === 'remove' ? (
          <DialogContent
            title={
              confirm.ban
                ? t('confirmBan', { name: confirm.member.directorName })
                : t('confirmRemove', { name: confirm.member.directorName })
            }
            description={confirm.ban ? t('confirmBanBody') : t('confirmRemoveBody')}
            closeLabel={tc('close')}
          >
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {tc('cancel')}
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate({
                    memberId: confirm.member.id,
                    ban: confirm.ban,
                    name: confirm.member.directorName,
                  })
                }
                data-testid="confirm-remove"
              >
                {confirm.ban ? t('ban') : t('remove')}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : confirm?.kind === 'transfer' ? (
          <DialogContent
            title={t('confirmTransfer', { name: confirm.member.directorName })}
            description={t('confirmTransferBody')}
            closeLabel={tc('close')}
          >
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {tc('cancel')}
              </Button>
              <Button
                loading={transfer.isPending}
                onClick={() => transfer.mutate(confirm.member.id)}
                data-testid="confirm-transfer"
              >
                {t('transfer')}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : confirm?.kind === 'leave' ? (
          <DialogContent
            title={t('confirmLeave', { name: alliance.name })}
            description={mustTransfer ? t('leaveTransferFirst') : t('confirmLeaveBody', { hours: 24 })}
            closeLabel={tc('close')}
          >
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {tc('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={mustTransfer}
                loading={leave.isPending}
                onClick={() => leave.mutate(undefined)}
                data-testid="confirm-leave"
              >
                {t('leave')}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
