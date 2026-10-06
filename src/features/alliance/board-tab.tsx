'use client';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Lock, Megaphone, MoreHorizontal, Pin, Send } from 'lucide-react';
import {
  ALLIANCE_POST_MAX,
  ALLIANCE_REPLY_MAX,
  type AllianceReaction,
  type AllianceHomeDto,
  type AlliancePostDto,
  type AlliancePostReplyDto,
  type MyAllianceDto,
} from '@/contracts';
import { boardApi } from '@/lib/api/alliance';
import { qk } from '@/lib/api/query-keys';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, EmptyState, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TimeAgo } from '@/components/ui/time-ago';
import { useServerNow } from '@/hooks/use-server-now';
import { useAllianceMutation, useApplyUnread, useBoard } from './hooks';
import type { ReportTarget } from './report-dialog';

const REACTION_ICON: Record<AllianceReaction, string> = {
  ACK: '✓',
  WELL_DONE: '★',
  PRESENT: '●',
  THANKS: '♥',
};

/** Why the viewer cannot write free text right now (`AllianceRestrictionsDto.writeBlockedReason`), with the way out. */
export function WriteBlockedLine({
  home,
  surface,
  onRules,
}: {
  home: AllianceHomeDto;
  surface: 'board' | 'chat';
  onRules?: () => void;
}) {
  const t = useTranslations('alliance.restriction');
  const r = home.restrictions;
  const readOnly = surface === 'board' ? home.alliance?.readOnly.board : home.alliance?.readOnly.chat;
  const reason = readOnly ? 'READ_ONLY' : r.writeBlockedReason;
  if (!reason) return null;
  return (
    <div
      className="bg-surface-2 border-border text-muted flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
      role="status"
      data-testid={`write-blocked-${reason}`}
    >
      <Lock className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {t(reason, { level: r.writeMinLevel, until: r.mutedUntil ?? '' })}
        {reason === 'MUTED' && r.mutedUntil ? (
          <>
            {' '}
            <TimeAgo at={r.mutedUntil} />
          </>
        ) : null}
      </span>
      {reason === 'RULES_NOT_ACCEPTED' && onRules ? (
        <Button size="sm" variant="secondary" onClick={onRules} data-testid="write-blocked-rules">
          {t('readRules')}
        </Button>
      ) : null}
    </div>
  );
}

function Author({
  post,
  onOpenMember,
}: {
  post: { author: AlliancePostDto['author'] };
  onOpenMember: (careerId: string) => void;
}) {
  const t = useTranslations('alliance');
  const a = post.author;
  if (!a) return <span className="text-muted text-sm font-semibold">{t('board.system')}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {a.careerId ? (
        <button
          type="button"
          className="hover:text-fg truncate text-sm font-semibold"
          onClick={() => onOpenMember(a.careerId!)}
        >
          {a.directorName}
        </button>
      ) : (
        <span className="text-muted truncate text-sm font-semibold">{t('board.deletedDirector')}</span>
      )}
      {a.role && a.role !== 'MEMBER' ? (
        <Badge tone={a.role === 'COORDINATOR' ? 'brand' : 'xp'}>{t(`role.${a.role}`)}</Badge>
      ) : null}
    </span>
  );
}

function Placeholder({ kind }: { kind: 'removed' | 'hidden' | 'blocked' }) {
  const t = useTranslations('alliance.board');
  return <p className="text-subtle text-sm italic">{t(`placeholder.${kind}`)}</p>;
}

function ReplyRow({
  reply,
  post,
  alliance,
  onOpenMember,
  onReport,
  onBlock,
}: {
  reply: AlliancePostReplyDto;
  post: AlliancePostDto;
  alliance: MyAllianceDto;
  onOpenMember: (careerId: string) => void;
  onReport: (target: ReportTarget) => void;
  onBlock: (target: { careerId: string; directorName: string }) => void;
}) {
  const t = useTranslations('alliance.board');
  const remove = useAllianceMutation(
    (careerId, v: { postId: string; replyId: string }) => boardApi.removeReply(careerId, v.postId, v.replyId),
    {
      successToast: t('replyRemoved'),
    },
  );
  const canRemove = reply.mine || alliance.me.isHighRole;
  return (
    <li className="flex gap-2 py-1.5 text-sm" data-testid="board-reply">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <Author post={reply} onOpenMember={onOpenMember} />
          <TimeAgo at={reply.createdAt} className="text-subtle text-xs" />
        </div>
        {reply.removed ? (
          <Placeholder kind="removed" />
        ) : reply.hidden ? (
          <Placeholder kind="hidden" />
        ) : reply.hiddenByBlock ? (
          <Placeholder kind="blocked" />
        ) : (
          <p className="whitespace-pre-wrap">{reply.text}</p>
        )}
      </div>
      {!reply.removed ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" label={t('actions')} data-testid="reply-actions">
              <MoreHorizontal className="size-4" aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {!reply.mine && reply.author.careerId ? (
              <>
                <DropdownMenuItem
                  onSelect={() =>
                    onReport({ kind: 'REPLY', id: reply.id, label: reply.text?.slice(0, 60) ?? '' })
                  }
                >
                  {t('report')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    onBlock({
                      careerId: reply.author.careerId!,
                      directorName: reply.author.directorName ?? '',
                    })
                  }
                >
                  {t('blockAuthor')}
                </DropdownMenuItem>
              </>
            ) : null}
            {canRemove ? (
              <DropdownMenuItem
                tone="danger"
                onSelect={() => remove.mutate({ postId: post.id, replyId: reply.id })}
              >
                {t('remove')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

function PostCard({
  post,
  home,
  alliance,
  careerId,
  onOpenMember,
  onReport,
  onBlock,
  highlighted,
}: {
  post: AlliancePostDto;
  home: AllianceHomeDto;
  alliance: MyAllianceDto;
  careerId: string;
  onOpenMember: (careerId: string) => void;
  onReport: (target: ReportTarget) => void;
  onBlock: (target: { careerId: string; directorName: string }) => void;
  highlighted?: boolean;
}) {
  const t = useTranslations('alliance.board');
  const tr = useTranslations('alliance.reaction');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(post.text ?? '');
  const [replyDraft, setReplyDraft] = React.useState('');
  const [showAll, setShowAll] = React.useState(false);
  const qc = useQueryClient();
  const patch = (next: AlliancePostDto) => {
    // The returned post is the viewer's own view: patch the cached pages in place (no refetch flicker).
    qc.setQueriesData<{ pages: { data: AlliancePostDto[]; meta: unknown }[]; pageParams: unknown[] }>(
      { queryKey: ['career'], exact: false, predicate: (q) => q.queryKey.includes('board') },
      (cached) =>
        cached && 'pages' in cached
          ? {
              ...cached,
              pages: cached.pages.map((page) => ({
                ...page,
                data: page.data.map((p) => (p.id === next.id ? next : p)),
              })),
            }
          : cached,
    );
  };
  const react = useAllianceMutation(
    (cid, reaction: AllianceReaction | null) => boardApi.react(cid, post.id, { reaction }),
    { onSuccess: patch },
  );
  const edit = useAllianceMutation((cid, text: string) => boardApi.update(cid, post.id, { text }), {
    successToast: t('edited'),
    onSuccess: (next) => {
      patch(next);
      setEditing(false);
    },
  });
  const remove = useAllianceMutation((cid) => boardApi.remove(cid, post.id), { successToast: t('removed') });
  const pin = useAllianceMutation((cid, pinned: boolean) => boardApi.pin(cid, post.id, { pinned }), {
    onSuccess: patch,
  });
  const reply = useAllianceMutation((cid, text: string) => boardApi.reply(cid, post.id, { text }), {
    successToast: t('replied'),
    onSuccess: () => setReplyDraft(''),
  });
  const allReplies = useQuery({
    queryKey: qk.allianceBoardReplies(careerId, post.id),
    queryFn: () => boardApi.replies(careerId, post.id).then((r) => r.data),
    enabled: showAll,
  });
  const replies = showAll && allReplies.data ? allReplies.data : post.replies;
  const canWrite = home.restrictions.canWriteText && !alliance.readOnly.board;
  const now = useServerNow(30_000);
  const editable = post.mine && post.editableUntil !== null && Date.parse(post.editableUntil) > now;
  const body =
    post.kind === 'SYSTEM' && post.system ? (
      <p className="text-muted text-sm">{tx(post.system.text)}</p>
    ) : post.removed ? (
      <Placeholder kind="removed" />
    ) : post.hidden ? (
      <Placeholder kind="hidden" />
    ) : post.hiddenByBlock ? (
      <Placeholder kind="blocked" />
    ) : (
      <p className="text-sm whitespace-pre-wrap">{post.text}</p>
    );
  return (
    <Card
      className={cn(
        'flex flex-col gap-2',
        post.pinned && 'border-brand/40',
        highlighted && 'ring-focus/50 ring-2',
      )}
      data-testid="board-post"
      data-post-id={post.id}
      data-kind={post.kind}
      data-pinned={post.pinned}
    >
      <div className="flex items-center gap-2">
        {post.kind === 'ANNOUNCEMENT' ? (
          <Megaphone className="text-brand size-4 shrink-0" aria-hidden />
        ) : null}
        <Author post={post} onOpenMember={onOpenMember} />
        {post.pinned ? (
          <Badge tone="brand" data-testid="board-pinned">
            <Pin className="size-3" aria-hidden />
            {t('pinned')}
          </Badge>
        ) : null}
        <span className="text-subtle ml-auto flex items-center gap-1 text-xs">
          <TimeAgo at={post.createdAt} />
          {post.editedAt ? <span>· {t('editedMark')}</span> : null}
        </span>
        {!post.removed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" label={t('actions')} data-testid="post-actions">
                <MoreHorizontal className="size-4" aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {editable ? (
                <DropdownMenuItem onSelect={() => setEditing(true)} data-testid="post-edit">
                  {t('edit')}
                </DropdownMenuItem>
              ) : null}
              {alliance.me.isHighRole && post.kind === 'ANNOUNCEMENT' ? (
                <DropdownMenuItem onSelect={() => pin.mutate(!post.pinned)} data-testid="post-pin">
                  {post.pinned ? t('unpin') : t('pin')}
                </DropdownMenuItem>
              ) : null}
              {!post.mine && post.author?.careerId ? (
                <>
                  <DropdownMenuItem
                    onSelect={() =>
                      onReport({ kind: 'POST', id: post.id, label: post.text?.slice(0, 60) ?? '' })
                    }
                    data-testid="post-report"
                  >
                    {t('report')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      onBlock({
                        careerId: post.author!.careerId!,
                        directorName: post.author!.directorName ?? '',
                      })
                    }
                  >
                    {t('blockAuthor')}
                  </DropdownMenuItem>
                </>
              ) : null}
              {post.mine || alliance.me.isHighRole ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    tone="danger"
                    onSelect={() => remove.mutate(undefined)}
                    data-testid="post-remove"
                  >
                    {t('remove')}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2" data-testid="post-edit-form">
          <Textarea
            aria-label={t('edit')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={ALLIANCE_POST_MAX}
            counter
            autoGrow
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {tc('cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => edit.mutate(draft)}
              loading={edit.isPending}
              disabled={!draft.trim()}
            >
              {t('save')}
            </Button>
          </div>
        </div>
      ) : (
        body
      )}
      {!post.removed ? (
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label={t('reactions')}
          data-testid="post-reactions"
        >
          {post.reactions.map((r) => (
            <button
              key={r.reaction}
              type="button"
              aria-pressed={r.mine}
              disabled={!home.restrictions.canUseQuick}
              onClick={() => react.mutate(r.mine ? null : r.reaction)}
              className={cn(
                'border-border bg-surface-2 hover:bg-surface-3 inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-colors pointer-coarse:min-h-11',
                r.mine && 'border-focus text-fg',
                r.count === 0 && !r.mine && 'text-muted',
              )}
              data-testid={`reaction-${r.reaction}`}
            >
              <span aria-hidden>{REACTION_ICON[r.reaction]}</span>
              {tr(r.reaction)}
              {r.count > 0 ? <span className="tabular">{r.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {post.replyCount > 0 || canWrite ? (
        <div className="border-border mt-1 border-t pt-2">
          {replies.length > 0 ? (
            <ul className="divide-border divide-y" data-testid="board-replies">
              {replies.map((r) => (
                <ReplyRow
                  key={r.id}
                  reply={r}
                  post={post}
                  alliance={alliance}
                  onOpenMember={onOpenMember}
                  onReport={onReport}
                  onBlock={onBlock}
                />
              ))}
            </ul>
          ) : null}
          {post.replyCount > post.replies.length && !showAll ? (
            <Button variant="link" size="sm" onClick={() => setShowAll(true)} data-testid="board-all-replies">
              {t('allReplies', { count: post.replyCount })}
            </Button>
          ) : null}
          {canWrite && !post.removed ? (
            <form
              className="mt-2 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (replyDraft.trim()) reply.mutate(replyDraft);
              }}
            >
              <Textarea
                aria-label={t('replyPlaceholder')}
                placeholder={t('replyPlaceholder')}
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                maxLength={ALLIANCE_REPLY_MAX}
                counter
                autoGrow
                rows={1}
                wrapperClassName="flex-1"
                data-testid="reply-composer"
              />
              <IconButton
                type="submit"
                variant="secondary"
                label={t('reply')}
                disabled={!replyDraft.trim()}
                loading={reply.isPending}
                data-testid="reply-send"
              >
                <Send className="size-4" aria-hidden />
              </IconButton>
            </form>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** Bacheca (study 03 §2, 09 §2.2): composer, pinned announcements, posts with replies and reactions, the read marker. */
export function BoardTab({
  home,
  alliance,
  careerId,
  onOpenMember,
  onReport,
  onBlock,
  onRules,
  focusPostId,
}: {
  home: AllianceHomeDto;
  alliance: MyAllianceDto;
  careerId: string;
  onOpenMember: (careerId: string) => void;
  onReport: (target: ReportTarget) => void;
  onBlock: (target: { careerId: string; directorName: string }) => void;
  onRules: () => void;
  focusPostId?: string | null;
}) {
  const t = useTranslations('alliance.board');
  const board = useBoard();
  const applyUnread = useApplyUnread();
  const [kind, setKind] = React.useState<'NOTE' | 'ANNOUNCEMENT'>('NOTE');
  const [pinIt, setPinIt] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const create = useAllianceMutation(
    (cid, body: { kind: 'NOTE' | 'ANNOUNCEMENT'; text: string; pin?: boolean }) => boardApi.create(cid, body),
    {
      successToast: (p) => (p.kind === 'ANNOUNCEMENT' ? t('announced') : t('posted')),
      onSuccess: () => {
        setDraft('');
        setPinIt(false);
      },
    },
  );
  // Opening the board reads it (03 §4.3): the badge drops at once, the server keeps the marker.
  const read = useAllianceMutation((cid) => boardApi.read(cid), { onSuccess: applyUnread });
  const readOnce = React.useRef(false);
  React.useEffect(() => {
    if (readOnce.current || !board.data) return;
    readOnce.current = true;
    read.mutate(undefined);
  }, [board.data, read]);
  const posts = board.data?.pages.flatMap((p) => p.data) ?? [];
  const canWrite = home.restrictions.canWriteText && !alliance.readOnly.board;
  const notesAllowed = alliance.me.isHighRole || !alliance.settings.notesByHighRolesOnly;
  const kindOptions = [
    ...(notesAllowed ? [{ value: 'NOTE', label: t('kind.NOTE') }] : []),
    ...(alliance.me.isHighRole ? [{ value: 'ANNOUNCEMENT', label: t('kind.ANNOUNCEMENT') }] : []),
  ];
  const effectiveKind = kindOptions.some((o) => o.value === kind)
    ? kind
    : ((kindOptions[0]?.value as 'NOTE' | 'ANNOUNCEMENT') ?? 'NOTE');
  return (
    <div className="flex flex-col gap-3" data-testid="alliance-board">
      {alliance.readOnly.board ? (
        <div
          className="bg-warning/15 text-warning rounded-md px-3 py-2 text-sm"
          role="status"
          data-testid="board-read-only"
        >
          {t('readOnly')}
        </div>
      ) : null}
      {canWrite && kindOptions.length > 0 ? (
        <Card className="flex flex-col gap-2" data-testid="board-composer">
          <Textarea
            aria-label={t('composer')}
            placeholder={
              effectiveKind === 'ANNOUNCEMENT' ? t('announcementPlaceholder') : t('notePlaceholder')
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={ALLIANCE_POST_MAX}
            counter
            autoGrow
            rows={2}
            data-testid="board-textarea"
          />
          <div className="flex flex-wrap items-center gap-3">
            {kindOptions.length > 1 ? (
              <Select
                label={t('kindLabel')}
                value={effectiveKind}
                onValueChange={(v) => setKind(v as 'NOTE' | 'ANNOUNCEMENT')}
                options={kindOptions}
                className="w-44"
                id="board-kind"
              />
            ) : null}
            {effectiveKind === 'ANNOUNCEMENT' ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={pinIt}
                  onCheckedChange={(v) => setPinIt(v === true)}
                  aria-label={t('pinOnPost', { slots: alliance.progress.pinnedSlots })}
                  data-testid="board-pin-checkbox"
                />
                {t('pinOnPost', { slots: alliance.progress.pinnedSlots })}
              </label>
            ) : null}
            <Button
              className="ml-auto"
              onClick={() =>
                create.mutate({
                  kind: effectiveKind,
                  text: draft,
                  pin: effectiveKind === 'ANNOUNCEMENT' ? pinIt : undefined,
                })
              }
              disabled={!draft.trim()}
              loading={create.isPending}
              data-testid="board-post-button"
            >
              <Send className="size-4" aria-hidden />
              {effectiveKind === 'ANNOUNCEMENT' ? t('announce') : t('post')}
            </Button>
          </div>
          <p className="text-subtle text-xs">
            {t('limits', {
              posts: home.config.board.postsPerDay,
              replies: home.config.board.repliesPerDay,
              minutes: home.config.board.editWindowMinutes,
            })}
          </p>
        </Card>
      ) : (
        <WriteBlockedLine home={home} surface="board" onRules={onRules} />
      )}
      {board.isPending ? (
        <Skeleton className="h-40" />
      ) : posts.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <div className="flex flex-col gap-3" data-testid="board-list">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              home={home}
              alliance={alliance}
              careerId={careerId}
              onOpenMember={onOpenMember}
              onReport={onReport}
              onBlock={onBlock}
              highlighted={focusPostId === p.id}
            />
          ))}
          {board.hasNextPage ? (
            <Button
              variant="outline"
              className="self-center"
              onClick={() => void board.fetchNextPage()}
              loading={board.isFetchingNextPage}
            >
              {t('more')}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
