'use client';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowLeft, Lock, MoreHorizontal, Send, Users, Zap } from 'lucide-react';
import {
  ALLIANCE_MAX_MENTIONS,
  ALLIANCE_MESSAGE_MAX,
  ALLIANCE_QUICK_GROUPS,
  type AidRequestDto,
  type AllianceChannelDto,
  type AllianceHomeDto,
  type AllianceMemberDto,
  type AllianceMessageDto,
  type AllianceQuickCode,
  type MyAllianceDto,
} from '@/contracts';
import { allianceApi, chatApi } from '@/lib/api/alliance';
import { invalidateFresh } from '@/lib/api/invalidate';
import { qk } from '@/lib/api/query-keys';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { copyText } from '@/features/monetization/share';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KeyboardAwareScreen } from '@/components/ui/keyboard-aware-screen';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/textarea';
import { TimeAgo } from '@/components/ui/time-ago';
import { useServerNow } from '@/hooks/use-server-now';
import { VirtualList, type VirtualListHandle } from '@/components/ui/virtual-list';
import { AidRequestCard } from './aid-request-card';
import { ColumnComposer } from './column-composer';
import { DirectorCardDialog } from './director-card';
import {
  useAidRequests,
  useAllianceErrorMessage,
  useAllianceHome,
  useAllianceMembers,
  useAllianceMutation,
  useApplyUnread,
  useChannels,
  useMessages,
} from './hooks';
import { PresenceDot } from './members-tab';
import { BlockConfirmDialog, ReportDialog, type ReportTarget } from './report-dialog';

type Item =
  | { kind: 'message'; at: number; message: AllianceMessageDto }
  | { kind: 'aid'; at: number; request: AidRequestDto };

/** `@` mention state: the word being typed after the last `@` before the caret, or null. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query) || (at > 0 && !/\s/.test(before[at - 1]!))) return null;
  return { start: at, query };
}

/** Renders `@Nome` in bold when it names one of the message's mentions. */
function MessageText({ text, mentions }: { text: string; mentions: AllianceMessageDto['mentions'] }) {
  if (mentions.length === 0) return <>{text}</>;
  const names = mentions.map((m) => m.directorName).filter(Boolean);
  const pattern = new RegExp(
    `(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`,
    'g',
  );
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="text-fg">
            {part}
          </strong>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/** A press of 500 ms on touch screens opens the message menu (09 §3 #6). */
function useLongPress(onLongPress: () => void) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      cancel();
      timer.current = setTimeout(onLongPress, 500);
    },
    onPointerUp: cancel,
    onPointerMove: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
  };
}

function MessageBubble({
  message,
  alliance,
  members,
  onReport,
  onBlock,
  onOpenMember,
}: {
  message: AllianceMessageDto;
  alliance: MyAllianceDto;
  members: AllianceMemberDto[];
  onReport: (target: ReportTarget) => void;
  onBlock: (target: { careerId: string; directorName: string }) => void;
  onOpenMember: (careerId: string) => void;
}) {
  const t = useTranslations('alliance.chat');
  const tq = useTranslations('alliance.quick');
  const tr = useTranslations('alliance.role');
  const tx = useI18nText();
  const [menu, setMenu] = React.useState(false);
  const press = useLongPress(() => setMenu(true));
  const remove = useAllianceMutation((cid, id: string) => chatApi.remove(cid, id), {
    successToast: t('removed'),
  });
  const mute = useAllianceMutation(
    (cid, memberId: string) => allianceApi.mute(cid, memberId, { duration: 'H1' }),
    { successToast: t('mutedToast') },
  );
  const now = useServerNow(30_000);
  const deletable = message.mine
    ? message.deletableUntil !== null && Date.parse(message.deletableUntil) > now
    : alliance.me.isHighRole;
  const member = members.find((m) => m.careerId === message.author.careerId);
  const quickText = message.quick
    ? tq.has(message.quick.code)
      ? tq(message.quick.code, message.quick.params as Record<string, string | number>)
      : tx({ key: `alliance.quick.${message.quick.code}`, params: message.quick.params })
    : null;
  const content = message.removed ? (
    <span className="text-subtle italic">{t('placeholder.removed')}</span>
  ) : message.hidden ? (
    <span className="text-subtle italic">{t('placeholder.hidden')}</span>
  ) : message.hiddenByBlock ? (
    <span className="text-subtle italic">{t('placeholder.blocked')}</span>
  ) : message.kind === 'QUICK' ? (
    <span className="inline-flex items-center gap-1.5">
      <Zap className="text-warning size-3.5 shrink-0" aria-hidden />
      {quickText}
    </span>
  ) : (
    <MessageText text={message.text ?? ''} mentions={message.mentions} />
  );
  return (
    <div
      className={cn('group flex px-3 py-1', message.mine ? 'justify-end' : 'justify-start')}
      data-testid="chat-message"
      data-message-id={message.id}
      data-mine={message.mine}
      data-kind={message.kind}
    >
      <div
        className={cn(
          'relative max-w-[85%] rounded-md border px-3 py-1.5 text-sm select-text',
          message.mine ? 'bg-brand/10 border-brand/30' : 'bg-surface-2 border-border',
        )}
        {...press}
      >
        {!message.mine ? (
          <div className="mb-0.5 flex items-center gap-1.5 text-xs">
            {message.author.careerId ? (
              <button
                type="button"
                className="text-fg font-semibold"
                onClick={() => onOpenMember(message.author.careerId!)}
              >
                {message.author.directorName}
              </button>
            ) : (
              <span className="text-muted font-semibold">{t('deletedDirector')}</span>
            )}
            {message.author.role && message.author.role !== 'MEMBER' ? (
              <Badge tone={message.author.role === 'COORDINATOR' ? 'brand' : 'xp'}>
                {tr(message.author.role)}
              </Badge>
            ) : null}
          </div>
        ) : null}
        <p className="whitespace-pre-wrap">{content}</p>
        <div className="mt-0.5 flex items-center justify-end gap-1">
          <TimeAgo at={message.createdAt} className="text-subtle text-[11px]" />
          {!message.removed ? (
            <DropdownMenu open={menu} onOpenChange={setMenu}>
              <DropdownMenuTrigger asChild>
                <IconButton
                  size="sm"
                  label={t('actions')}
                  className="size-6 min-h-0 opacity-60 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"
                  data-testid="message-actions"
                >
                  <MoreHorizontal className="size-3.5" aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {!message.mine && message.author.careerId ? (
                  <>
                    <DropdownMenuItem
                      onSelect={() =>
                        onReport({
                          kind: 'MESSAGE',
                          id: message.id,
                          label: message.text?.slice(0, 60) ?? quickText ?? '',
                        })
                      }
                      data-testid="message-report"
                    >
                      {t('report')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        onBlock({
                          careerId: message.author.careerId!,
                          directorName: message.author.directorName ?? '',
                        })
                      }
                      data-testid="message-block"
                    >
                      {t('block')}
                    </DropdownMenuItem>
                  </>
                ) : null}
                {message.text ? (
                  <DropdownMenuItem onSelect={() => void copyText(message.text ?? '')}>
                    {t('copy')}
                  </DropdownMenuItem>
                ) : null}
                {deletable ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      tone="danger"
                      onSelect={() => remove.mutate(message.id)}
                      data-testid="message-remove"
                    >
                      {t('remove')}
                    </DropdownMenuItem>
                  </>
                ) : null}
                {alliance.me.isHighRole && !message.mine && member && member.role === 'MEMBER' ? (
                  <DropdownMenuItem
                    tone="danger"
                    onSelect={() => mute.mutate(member.id)}
                    data-testid="message-mute"
                  >
                    {t('mute')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Chi c'è (03 §3.4): the members by presence — on duty, online, away. */
function PresenceDialog({
  open,
  onOpenChange,
  members,
  onOpenMember,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: AllianceMemberDto[];
  onOpenMember: (careerId: string) => void;
}) {
  const t = useTranslations('alliance.chat');
  const tp = useTranslations('alliance.presence');
  const tc = useTranslations('common');
  const groups = (['ON_DUTY', 'ONLINE', 'AWAY'] as const).map((p) => ({
    p,
    list: members.filter((m) => (m.presence ?? 'AWAY') === p),
  }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('whoIsHere')} closeLabel={tc('close')} aria-describedby={undefined}>
        <div className="scroll-y flex min-h-0 flex-col gap-3 px-4 pb-4" data-testid="chat-presence">
          {groups.map(({ p, list }) => (
            <div key={p}>
              <p className="text-subtle mb-1 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                <PresenceDot presence={p} /> <span className="tabular">{list.length}</span>
              </p>
              {list.length === 0 ? (
                <p className="text-subtle text-xs">{t('nobody', { state: tp(p) })}</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {list.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="bg-surface-2 border-border hover:bg-surface-3 rounded-full border px-3 py-1 text-sm"
                        onClick={() => onOpenMember(m.careerId)}
                      >
                        {m.directorName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChatBody({
  home,
  alliance,
  channels,
  channelId,
}: {
  home: AllianceHomeDto;
  alliance: MyAllianceDto;
  channels: AllianceChannelDto[];
  channelId: string;
}) {
  const t = useTranslations('alliance.chat');
  const tq = useTranslations('alliance.quick');
  const tc = useTranslations('common');
  const careerId = useCareerId();
  const qc = useQueryClient();
  const router = useRouter();
  const desktop = useIsDesktop();
  const { career } = useSnapshot();
  const members = useAllianceMembers();
  const messages = useMessages(channelId);
  const requests = useAidRequests('OPEN', home.config.flags.aid);
  const applyUnread = useApplyUnread();
  const errorMessage = useAllianceErrorMessage();
  const list = React.useRef<VirtualListHandle>(null);
  const [draft, setDraft] = React.useState('');
  const [mentions, setMentions] = React.useState<{ careerId: string; directorName: string }[]>([]);
  const [picker, setPicker] = React.useState<{ start: number; query: string } | null>(null);
  const [unsent, setUnsent] = React.useState<{ text: string; key: string; error: string } | null>(null);
  const [newBelow, setNewBelow] = React.useState(0);
  const [presenceOpen, setPresenceOpen] = React.useState(false);
  const [member, setMember] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<ReportTarget | null>(null);
  const [block, setBlock] = React.useState<{ careerId: string; directorName: string } | null>(null);
  const [compose, setCompose] = React.useState<string | null>(null);
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const channel = channels.find((c) => c.id === channelId) ?? null;

  // Items oldest → newest: the pages come newest-first; OPEN aid requests are merged by time (03 §3.1).
  const items = React.useMemo<Item[]>(() => {
    const msgs: Item[] = (messages.data?.pages ?? [])
      .flatMap((p) => p.data)
      .map((m) => ({ kind: 'message', at: Date.parse(m.createdAt), message: m }));
    const aids: Item[] =
      channel?.kind === 'GENERAL'
        ? (requests.data?.pages ?? [])
            .flatMap((p) => p.data)
            .filter((r) => r.status === 'OPEN')
            .map((r) => ({ kind: 'aid', at: Date.parse(r.createdAt), request: r }))
        : [];
    return [...msgs, ...aids].sort((a, b) => a.at - b.at);
  }, [messages.data, requests.data, channel?.kind]);

  // The read marker: on open, and when a new message lands while the viewer is at the end (03 §4.3).
  const markRead = useAllianceMutation((cid, id: string) => chatApi.read(cid, id), {
    onSuccess: (unread) => {
      applyUnread(unread);
      qc.setQueryData<AllianceChannelDto[]>(qk.allianceChannels(cid), (cached) =>
        cached?.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c)),
      );
    },
  });
  const cid = careerId;
  const lastReadCount = React.useRef(0);
  React.useEffect(() => {
    if (!messages.data || items.length === lastReadCount.current) return;
    if (list.current?.isAtEnd() ?? true) {
      lastReadCount.current = items.length;
      markRead.mutate(channelId);
    }
  }, [items.length, messages.data, channelId, markRead]);
  // Back from the background (09 §3 #8): the history is re-read, the socket may have dropped meanwhile.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void invalidateFresh(qc, qk.allianceChat(careerId));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [qc, careerId]);

  const send = useAllianceMutation(
    (cid2, body: { text: string; key: string; mentions: string[] }) =>
      chatApi.send(
        cid2,
        channelId,
        { kind: 'TEXT', text: body.text, mentions: body.mentions.length ? body.mentions : undefined },
        body.key,
      ),
    {
      onSuccess: () => {
        setDraft('');
        setMentions([]);
        setUnsent(null);
        requestAnimationFrame(() => list.current?.scrollToEnd('smooth'));
      },
      onError: (e, v) => setUnsent({ text: v.text, key: v.key, error: errorMessage(e) }),
    },
  );
  const quick = useAllianceMutation(
    (cid2, code: AllianceQuickCode) => chatApi.send(cid2, channelId, { kind: 'QUICK', code }),
    {
      onSuccess: () => requestAnimationFrame(() => list.current?.scrollToEnd('smooth')),
    },
  );
  const submit = () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    const key = unsent?.text === text ? unsent.key : crypto.randomUUID();
    const ids = mentions
      .filter((m) => text.includes(`@${m.directorName}`))
      .map((m) => m.careerId)
      .slice(0, ALLIANCE_MAX_MENTIONS);
    send.mutate({ text, key, mentions: [...new Set(ids)] });
  };
  const onDraftChange = (value: string, caret: number) => {
    setDraft(value);
    setPicker(mentionQuery(value, caret));
    if (unsent && value !== unsent.text) setUnsent(null);
  };
  const pickMention = (m: AllianceMemberDto) => {
    if (!picker) return;
    const before = draft.slice(0, picker.start);
    const after = draft.slice(picker.start + 1 + picker.query.length);
    const next = `${before}@${m.directorName} ${after}`;
    setDraft(next);
    setMentions((list) =>
      list.some((x) => x.careerId === m.careerId)
        ? list
        : [...list, { careerId: m.careerId, directorName: m.directorName }],
    );
    setPicker(null);
    requestAnimationFrame(() => textarea.current?.focus());
  };
  const candidates = picker
    ? (members.data ?? [])
        .filter(
          (m) =>
            m.careerId !== career.id && m.directorName.toLowerCase().startsWith(picker.query.toLowerCase()),
        )
        .slice(0, 6)
    : [];
  const readOnly = alliance.readOnly.chat || channel?.archived === true;
  const canText = home.restrictions.canWriteText && !readOnly;
  const canQuick = home.restrictions.canUseQuick && !channel?.archived;
  const restrictionReason = readOnly ? 'READ_ONLY' : home.restrictions.writeBlockedReason;
  const onDuty = (members.data ?? []).filter((m) => m.presence === 'ON_DUTY').length;
  const header = (
    <div className="border-border flex h-13 items-center gap-2 border-b px-2">
      {!desktop ? (
        <IconButton label={tc('back')} onClick={() => router.push('/game/alliance')} data-testid="chat-back">
          <ArrowLeft className="size-5" aria-hidden />
        </IconButton>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="font-display truncate text-base font-bold">
          {t('title')} <span className="tabular text-muted text-sm font-normal">[{alliance.tag}]</span>
        </h1>
        {channels.length > 1 ? (
          <div className="flex gap-1" role="tablist" aria-label={t('channels')}>
            {channels.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={c.id === channelId}
                onClick={() => router.replace(`/game/alliance/chat?channel=${encodeURIComponent(c.id)}`)}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  c.id === channelId ? 'bg-surface-3 text-fg' : 'text-muted',
                )}
                data-testid={`chat-channel-${c.kind}`}
              >
                {c.kind === 'GENERAL' ? t('general') : t('operation')}
                {c.unread > 0 && c.id !== channelId ? (
                  <span
                    className="bg-brand ml-1 inline-block size-2 rounded-full"
                    aria-label={t('unreadIn', { count: c.unread })}
                  />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setPresenceOpen(true)}
        aria-label={t('whoIsHere')}
        data-testid="chat-presence-button"
      >
        <Users className="size-4" aria-hidden />
        <span className="tabular">{onDuty}</span>
      </Button>
    </div>
  );
  const footer = (
    <div className="border-border flex flex-col gap-1.5 border-t p-2">
      {canQuick ? (
        <div
          className="scroll-x -mx-2 flex gap-1.5 overflow-x-auto px-2 pb-0.5"
          role="group"
          aria-label={t('quickPhrases')}
          data-testid="quick-phrases"
        >
          {Object.entries(ALLIANCE_QUICK_GROUPS).flatMap(([group, codes]) =>
            codes.map((code) => (
              <Button
                key={code}
                size="sm"
                variant="secondary"
                className="shrink-0 whitespace-nowrap"
                onClick={() => quick.mutate(code)}
                disabled={quick.isPending}
                data-quick-group={group}
                data-testid={`quick-${code}`}
              >
                {tq(code)}
              </Button>
            )),
          )}
        </div>
      ) : null}
      {restrictionReason ? (
        <div
          className="bg-surface-2 text-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm"
          role="status"
          data-testid={`chat-blocked-${restrictionReason}`}
        >
          <Lock className="size-4 shrink-0" aria-hidden />
          <span>
            {t(`blocked.${restrictionReason}`)}
            {restrictionReason === 'MUTED' && home.restrictions.mutedUntil ? (
              <>
                {' '}
                <TimeAgo at={home.restrictions.mutedUntil} />
              </>
            ) : null}
          </span>
        </div>
      ) : canText ? (
        <div className="relative flex items-end gap-2">
          {picker && candidates.length > 0 ? (
            <ul
              className="bg-surface-2 border-border-strong shadow-panel absolute bottom-full left-0 z-10 mb-1 w-64 rounded-md border p-1"
              role="listbox"
              aria-label={t('mentionPicker')}
              data-testid="mention-picker"
            >
              {candidates.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="hover:bg-surface-3 flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm pointer-coarse:min-h-11"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickMention(m)}
                  >
                    <PresenceDot presence={m.presence} />
                    {m.directorName}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <Textarea
            ref={textarea}
            aria-label={t('composerPlaceholder')}
            placeholder={t('composerPlaceholder')}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') setPicker(null);
            }}
            maxLength={ALLIANCE_MESSAGE_MAX}
            counter
            autoGrow
            rows={1}
            wrapperClassName="flex-1"
            invalid={unsent !== null}
            data-testid="chat-composer"
          />
          <IconButton
            label={unsent ? t('retry') : t('send')}
            variant="primary"
            onClick={submit}
            disabled={!draft.trim()}
            loading={send.isPending}
            data-testid="chat-send"
          >
            <Send className="size-4" aria-hidden />
          </IconButton>
        </div>
      ) : null}
      {unsent ? (
        <p
          className="text-danger flex items-center justify-between gap-2 text-xs"
          role="alert"
          data-testid="chat-unsent"
        >
          <span>{unsent.error}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={submit}
            loading={send.isPending}
            data-testid="chat-retry"
          >
            {t('retry')}
          </Button>
        </p>
      ) : null}
    </div>
  );
  return (
    <KeyboardAwareScreen aria-label={t('title')} header={header} footer={footer} testId="alliance-chat">
      {messages.isPending ? (
        <Skeleton className="m-3 h-40" />
      ) : items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <VirtualList
          ref={list}
          items={items}
          getKey={(i) => (i.kind === 'message' ? i.message.id : `aid:${i.request.id}`)}
          estimateSize={(i) => (i.kind === 'aid' ? 160 : 64)}
          reverse
          hasMore={messages.hasNextPage}
          loadingMore={messages.isFetchingNextPage}
          onLoadMore={() => void messages.fetchNextPage()}
          loader={<p className="bg-surface-2 text-muted py-1 text-center text-xs">{t('loadingEarlier')}</p>}
          onNewBelow={(n) => setNewBelow((c) => c + n)}
          onEndStateChange={(atEnd) => {
            if (atEnd) {
              setNewBelow(0);
              if (items.length !== lastReadCount.current) {
                lastReadCount.current = items.length;
                markRead.mutate(channelId);
              }
            }
          }}
          role="log"
          aria-label={t('title')}
          testId="chat-list"
          renderItem={(item) =>
            item.kind === 'message' ? (
              <MessageBubble
                message={item.message}
                alliance={alliance}
                members={members.data ?? []}
                onReport={setReport}
                onBlock={setBlock}
                onOpenMember={setMember}
              />
            ) : (
              <div className="px-3 py-1.5">
                <AidRequestCard
                  request={item.request}
                  compact
                  onSend={() => setCompose(item.request.id)}
                  onOpenRequest={() => router.push(`/game/alliance?focus=aid:${item.request.id}`)}
                />
              </div>
            )
          }
        />
      )}
      {newBelow > 0 ? (
        <Button
          size="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg"
          onClick={() => {
            list.current?.scrollToEnd('smooth');
            setNewBelow(0);
          }}
          data-testid="chat-new-below"
        >
          <ArrowDown className="size-4" aria-hidden />
          {t('newBelow', { count: newBelow })}
        </Button>
      ) : null}
      <PresenceDialog
        open={presenceOpen}
        onOpenChange={setPresenceOpen}
        members={members.data ?? []}
        onOpenMember={(id) => {
          setPresenceOpen(false);
          setMember(id);
        }}
      />
      <DirectorCardDialog
        careerId={member}
        onOpenChange={(o) => !o && setMember(null)}
        canInviteFrom={false}
      />
      <ReportDialog target={report} onOpenChange={(o) => !o && setReport(null)} />
      <BlockConfirmDialog target={block} onOpenChange={(o) => !o && setBlock(null)} />
      <ColumnComposer requestId={compose} onOpenChange={(o) => !o && setCompose(null)} />
      <span className="sr-only">{cid}</span>
    </KeyboardAwareScreen>
  );
}

/** `/game/alliance/chat` — the chat page (study 09 §3): channel picked by `?channel=`, GENERAL by default. */
export function AllianceChatScreen() {
  return (
    <React.Suspense fallback={<Skeleton className="m-4 h-40" />}>
      <ChatScreenInner />
    </React.Suspense>
  );
}

function ChatScreenInner() {
  const t = useTranslations('alliance.chat');
  const router = useRouter();
  const params = useSearchParams();
  const home = useAllianceHome();
  const channels = useChannels(home.data?.config.flags.chat === true && !!home.data.alliance);
  const requested = params.get('channel');
  if (home.isPending || (home.data?.alliance && home.data.config.flags.chat && channels.isPending))
    return <Skeleton className="m-4 h-40" />;
  const data = home.data;
  if (!data?.alliance || !data.config.flags.chat)
    return (
      <div className="p-4">
        <EmptyState
          title={t('unavailable')}
          action={
            <Button variant="secondary" onClick={() => router.push('/game/alliance')}>
              {t('backToAlliance')}
            </Button>
          }
        />
      </div>
    );
  const list = channels.data ?? [];
  const channelId =
    (requested && list.some((c) => c.id === requested)
      ? requested
      : list.find((c) => c.kind === 'GENERAL')?.id) ?? data.alliance.generalChannelId;
  return (
    <ChatBody key={channelId} home={data} alliance={data.alliance} channels={list} channelId={channelId} />
  );
}
