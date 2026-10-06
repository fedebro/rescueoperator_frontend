import { z } from 'zod';
import {
  AidColumnDto,
  AidRequestDto,
  AllianceMemberDto,
  AllianceMessageDto,
  AlliancePostDto,
  AllianceRealtimeEnvelope,
  type AllianceHomeDto,
  type AllianceSnapshotDto,
  MyAllianceDto,
  type SyncSnapshot,
  AllianceChannelDto,
} from '@/contracts';

/**
 * Pure reconciliation of the alliance stream (brief §2, contracts/alliances.ts "realtime"). The envelope's `type` is read
 * loosely: a type this client does not know still advances the sequence and is ignored (never a resync).
 */
export const LooseAllianceEnvelope = AllianceRealtimeEnvelope.extend({ type: z.string() });
export type LooseAllianceEnvelope = z.infer<typeof LooseAllianceEnvelope>;

export function parseAllianceEnvelope(raw: unknown): LooseAllianceEnvelope | null {
  const parsed = LooseAllianceEnvelope.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type AllianceScope =
  | 'home'
  | 'members'
  | 'requests'
  | 'invites'
  | 'log'
  | 'board'
  | 'chat'
  | 'aid'
  | 'progress'
  | 'operation'
  | 'all';

export type AllianceEffect =
  /** Patch the cached section (`qk.allianceHome`), when it is cached. */
  | { type: 'home'; update: (home: AllianceHomeDto) => AllianceHomeDto }
  /** Patch the cached member list (`qk.allianceMembers`), when it is cached. */
  | { type: 'members'; update: (members: AllianceMemberDto[]) => AllianceMemberDto[] }
  /** Patch the career snapshot's `alliance` field (the nav badge). */
  | { type: 'snapshot'; update: (ref: AllianceSnapshotDto | null) => AllianceSnapshotDto | null }
  | { type: 'invalidate'; scope: AllianceScope }
  /** Somebody joined / left / changed role… (`change` as the server names it). */
  | { type: 'member.changed'; member: AllianceMemberDto; change: string }
  /** The viewer himself is out (removed, banned, left from another device). */
  | { type: 'left' }
  /** Phase 2 payloads (full DTOs, viewer-neutral): the screens append / patch, the runtime toasts. */
  | { type: 'message.created'; message: AllianceMessageDto }
  | { type: 'message.removed'; channelId: string; messageId: string }
  | { type: 'channel.updated'; channel: AllianceChannelDto }
  | { type: 'post.created'; post: AlliancePostDto }
  | { type: 'post.updated'; post: AlliancePostDto }
  | { type: 'post.removed'; postId: string; replyId: string | null }
  | { type: 'aid.updated'; request: AidRequestDto }
  | { type: 'column.updated'; column: AidColumnDto };

const MemberChange = z.enum(['JOINED', 'LEFT', 'REMOVED', 'BANNED', 'ROLE', 'MUTED', 'UNMUTED', 'UPDATED']);
const GONE = new Set(['LEFT', 'REMOVED', 'BANNED']);
/** `alliance.updated` payload: `MyAllianceDto` minus the viewer-specific fields (backend notes §1b), every field optional. */
const NeutralAlliance = MyAllianceDto.omit({
  me: true,
  unread: true,
  viewer: true,
  weeklyRank: true,
  pendingJoinRequests: true,
  counts: true,
  operationId: true,
  generalChannelId: true,
})
  .partial()
  .required({ id: true })
  .nullable();

/** The room's member DTO has no viewer-specific presence or block flag: keep what this client already knows. */
function mergeMember(current: AllianceMemberDto | undefined, incoming: AllianceMemberDto): AllianceMemberDto {
  if (!current) return incoming;
  return {
    ...incoming,
    presence: incoming.presence ?? current.presence,
    lastSeen: incoming.lastSeen ?? current.lastSeen,
    blocked: incoming.blocked || current.blocked,
  };
}
const PresenceChanges = z.object({
  changes: z.array(z.object({ careerId: z.string(), presence: z.enum(['ON_DUTY', 'ONLINE', 'AWAY']) })),
});
const Authored = z
  .object({ author: z.object({ careerId: z.string().nullable() }).passthrough() })
  .passthrough();
const OperationRef = z.object({ id: z.string(), status: z.string() }).passthrough();

function upsert(list: AllianceMemberDto[], member: AllianceMemberDto): AllianceMemberDto[] {
  const idx = list.findIndex((m) => m.id === member.id);
  if (idx === -1) return [...list, member];
  const copy = list.slice();
  copy[idx] = mergeMember(list[idx], member);
  return copy;
}

const bumpUnread =
  (channel: 'chat' | 'board') =>
  (ref: AllianceSnapshotDto | null): AllianceSnapshotDto | null =>
    ref ? { ...ref, unread: { ...ref.unread, [channel]: ref.unread[channel] + 1 } } : ref;
/** The same count on the section (`home.alliance.unread`, the tabs' badges); the read marker resets both. */
const bumpHomeUnread =
  (channel: 'chat' | 'board') =>
  (home: AllianceHomeDto): AllianceHomeDto =>
    home.alliance
      ? {
          ...home,
          alliance: {
            ...home.alliance,
            unread: { ...home.alliance.unread, [channel]: home.alliance.unread[channel] + 1 },
          },
        }
      : home;

/** Who wrote the thing in `payload[key]` — null when the payload says nothing usable. */
function authorOf(payload: Record<string, unknown>, key: string): string | null {
  const parsed = Authored.safeParse(payload[key]);
  return parsed.success ? parsed.data.author.careerId : null;
}

export function reduceAllianceEvent(
  envelope: LooseAllianceEnvelope,
  me: { careerId: string },
): AllianceEffect[] {
  const p = envelope.payload;
  switch (envelope.type) {
    case 'alliance.updated': {
      // The room's view of the alliance: WITHOUT the viewer's own fields (`me`, `unread`, `viewer`, counts…), which the
      // cached section keeps. A payload this client cannot read (or `null`: disbanded) re-reads the section.
      const alliance = NeutralAlliance.safeParse(p.alliance);
      // No alliance in the payload (disbanded, or a change the server only signals): the whole section is re-read.
      if (!alliance.success || !alliance.data) return [{ type: 'invalidate', scope: 'all' }];
      const a = alliance.data;
      return [
        {
          type: 'home',
          update: (home) =>
            home.alliance && home.alliance.id === a.id
              ? { ...home, alliance: { ...home.alliance, ...a } }
              : home,
        },
        {
          type: 'snapshot',
          update: (ref) =>
            ref && ref.id === a.id ? { ...ref, name: a.name ?? ref.name, tag: a.tag ?? ref.tag } : ref,
        },
      ];
    }
    case 'alliance.member.updated': {
      const member = AllianceMemberDto.safeParse(p.member);
      const change = MemberChange.safeParse(p.change);
      if (!member.success)
        return [
          { type: 'invalidate', scope: 'members' },
          { type: 'invalidate', scope: 'home' },
        ];
      const m = member.data;
      const kind = change.success ? change.data : 'UPDATED';
      const effects: AllianceEffect[] = [
        {
          type: 'members',
          update: (list) => (GONE.has(kind) ? list.filter((x) => x.id !== m.id) : upsert(list, m)),
        },
        { type: 'member.changed', member: m, change: kind },
      ];
      if (kind !== 'UPDATED') effects.push({ type: 'invalidate', scope: 'home' });
      // A newcomer arrives without the viewer-specific fields (presence, block): the list is re-read behind the upsert.
      if (kind === 'JOINED') effects.push({ type: 'invalidate', scope: 'members' });
      if (m.careerId === me.careerId) {
        if (GONE.has(kind)) effects.push({ type: 'left' });
        else if (kind === 'ROLE')
          effects.push({ type: 'snapshot', update: (ref) => (ref ? { ...ref, role: m.role } : ref) });
      }
      return effects;
    }
    case 'alliance.presence.updated': {
      const parsed = PresenceChanges.safeParse(p);
      if (!parsed.success) return [];
      const byCareer = new Map(parsed.data.changes.map((c) => [c.careerId, c.presence] as const));
      return [
        {
          type: 'members',
          update: (list) =>
            list.map((m) => {
              const presence = byCareer.get(m.careerId);
              // A member who hides his state stays null (AWAY): the server never sends him, but be safe.
              return presence && m.presence !== null && m.presence !== presence ? { ...m, presence } : m;
            }),
        },
      ];
    }
    case 'alliance.post.created': {
      const post = AlliancePostDto.safeParse(p.post);
      const effects: AllianceEffect[] = post.success ? [{ type: 'post.created', post: post.data }] : [];
      effects.push({ type: 'invalidate', scope: 'board' });
      if (authorOf(p, 'post') !== me.careerId)
        effects.push(
          { type: 'snapshot', update: bumpUnread('board') },
          { type: 'home', update: bumpHomeUnread('board') },
        );
      return effects;
    }
    case 'alliance.post.updated': {
      const post = AlliancePostDto.safeParse(p.post);
      return post.success
        ? [{ type: 'post.updated', post: post.data }]
        : [{ type: 'invalidate', scope: 'board' }];
    }
    case 'alliance.post.removed':
      return typeof p.postId === 'string'
        ? [
            {
              type: 'post.removed',
              postId: p.postId,
              replyId: typeof p.replyId === 'string' ? p.replyId : null,
            },
          ]
        : [{ type: 'invalidate', scope: 'board' }];
    case 'alliance.message.created': {
      const message = AllianceMessageDto.safeParse(p.message);
      const effects: AllianceEffect[] = message.success
        ? [{ type: 'message.created', message: message.data }]
        : [{ type: 'invalidate', scope: 'chat' }];
      if (authorOf(p, 'message') !== me.careerId)
        effects.push(
          { type: 'snapshot', update: bumpUnread('chat') },
          { type: 'home', update: bumpHomeUnread('chat') },
        );
      return effects;
    }
    case 'alliance.message.removed':
      return typeof p.channelId === 'string' && typeof p.messageId === 'string'
        ? [{ type: 'message.removed', channelId: p.channelId, messageId: p.messageId }]
        : [{ type: 'invalidate', scope: 'chat' }];
    case 'alliance.channel.updated': {
      // Viewer-neutral (`unread: 0`): the cached count is kept; a new OPERATION channel appears, an archived one closes.
      const channel = AllianceChannelDto.safeParse(p.channel);
      return channel.success
        ? [{ type: 'channel.updated', channel: channel.data }]
        : [{ type: 'invalidate', scope: 'chat' }];
    }
    case 'alliance.aid.updated': {
      const request = AidRequestDto.safeParse(p.request);
      return [
        ...(request.success ? [{ type: 'aid.updated' as const, request: request.data }] : []),
        { type: 'invalidate', scope: 'aid' },
      ];
    }
    case 'alliance.column.updated': {
      const column = AidColumnDto.safeParse(p.column);
      return [
        ...(column.success ? [{ type: 'column.updated' as const, column: column.data }] : []),
        { type: 'invalidate', scope: 'aid' },
      ];
    }
    case 'alliance.objectives.updated':
    case 'alliance.ranking.updated':
      return [{ type: 'invalidate', scope: 'progress' }];
    case 'alliance.operation.updated': {
      const op = OperationRef.safeParse(p.operation);
      const effects: AllianceEffect[] = [
        { type: 'invalidate', scope: 'operation' },
        { type: 'invalidate', scope: 'chat' },
      ];
      if (op.success) {
        const running = op.data.status === 'ALERT' || op.data.status === 'ACTIVE';
        effects.push({
          type: 'snapshot',
          update: (ref) =>
            ref
              ? {
                  ...ref,
                  operationId: running ? op.data.id : ref.operationId === op.data.id ? null : ref.operationId,
                }
              : ref,
        });
      }
      return effects;
    }
    default:
      return [];
  }
}

/** The snapshot with its `alliance` field replaced by `update(current)`; the same object when nothing changed. */
export function patchSnapshotAlliance(
  snapshot: SyncSnapshot,
  update: (ref: AllianceSnapshotDto | null) => AllianceSnapshotDto | null,
): SyncSnapshot {
  const current = snapshot.alliance ?? null;
  const next = update(current);
  return next === current ? snapshot : { ...snapshot, alliance: next };
}
