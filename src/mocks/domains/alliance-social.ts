import {
  AllianceQuickCode,
  AllianceReaction,
  type AllianceChannelDto,
  type AllianceMessageDto,
  type AlliancePostDto,
  type AlliancePostReplyDto,
  type AlliancePresenceDto,
  type AllianceSystemPostCode,
  type AllianceUnreadDto,
  type I18nText,
} from '@/contracts';
import { MockError, iso, text, type MockCareer, type MockEngine } from '../engine';
import {
  BOARD_CFG,
  CHAT_CFG,
  DAY,
  activeMembers,
  allianceApiOf,
  careerAlliance,
  checkText,
  type MockAlliance,
} from './alliance';
import { communityWorld, hasBlocked, isBlockedEither } from './community';

/**
 * Simulation of the `alliance-board` + `alliance-chat` modules (study 03, 04 §2, 08 §3.2; contracts alliance-board.ts /
 * alliance-chat.ts; backend notes §1a "Texts (board & chat)"). Same identifiers, same limits as the server.
 *
 * Write preconditions, in order: flag → membership → not suspended → read-only (QUICK / reactions still pass) → rules accepted
 * → level ≥ 2 and account ≥ 24 h → not muted (an alliance mute still allows QUICK and reactions) → text filter.
 */

export interface MockPost {
  id: string;
  allianceId: string;
  kind: AlliancePostDto['kind'];
  authorCareerId: string | null;
  text: string | null;
  system: { code: AllianceSystemPostCode; params: Record<string, string | number> } | null;
  pinned: boolean;
  pinnedAt: number | null;
  createdAt: number;
  editedAt: number | null;
  removed: boolean;
}
export interface MockReply {
  id: string;
  postId: string;
  authorCareerId: string;
  text: string;
  createdAt: number;
  editedAt: number | null;
  removed: boolean;
}
export interface MockChannel {
  id: string;
  allianceId: string;
  kind: AllianceChannelDto['kind'];
  operationId: string | null;
  operationTitle: I18nText | null;
  archived: boolean;
  createdAt: number;
}
export interface MockMessage {
  id: string;
  channelId: string;
  authorCareerId: string;
  kind: AllianceMessageDto['kind'];
  text: string | null;
  quick: { code: AllianceQuickCode; params: Record<string, string | number> } | null;
  mentions: string[];
  createdAt: number;
  removed: boolean;
}
interface SocialWorld {
  posts: Record<string, MockPost[]>;
  replies: Record<string, MockReply[]>;
  /** postId → careerId → reaction */
  reactions: Record<string, Record<string, AllianceReaction>>;
  channels: Record<string, MockChannel[]>;
  messages: Record<string, MockMessage[]>;
}
export const socialWorld = (engine: MockEngine): SocialWorld =>
  (engine.state.ext.allianceSocial ??= {
    posts: {},
    replies: {},
    reactions: {},
    channels: {},
    messages: {},
  } satisfies SocialWorld) as SocialWorld;

/** Auto-hide (04 §2.5): three distinct reporters on the same target hide it for everybody pending review. */
const AUTO_HIDE_REPORTS = 3;
const MIN = 60_000;

export function installAllianceSocial(engine: MockEngine): void {
  const alliances = allianceApiOf(engine);
  const world = () => socialWorld(engine);
  const careerById = (id: string | null): MockCareer | undefined =>
    id ? engine.state.careers[id] : undefined;
  const userOf = (career: MockCareer) =>
    Object.values(engine.state.users).find((u) => u.user.id === career.userId);
  const nameOf = (careerId: string | null) => careerById(careerId)?.summary.directorName ?? null;
  const flag = (part: 'board' | 'chat') => engine.state.featureFlags[`alliance_${part}`] === true;
  const reportedBy = (kind: 'MESSAGE' | 'POST' | 'REPLY', targetId: string): number =>
    Object.values(communityWorld(engine).reports).filter((list) =>
      list.some((r) => r.targetKind === kind && r.targetId === targetId),
    ).length;
  const isHidden = (kind: 'MESSAGE' | 'POST' | 'REPLY', targetId: string) =>
    reportedBy(kind, targetId) >= AUTO_HIDE_REPORTS;

  /* ───────────── preconditions ───────────── */
  const membership = (career: MockCareer, part: 'board' | 'chat') => {
    if (!flag(part)) throw new MockError(403, 'FEATURE_DISABLED', `alliance_${part} is off`);
    const m = alliances.membershipOf(career.summary.id);
    if (!m) throw new MockError(403, 'NOT_ALLIANCE_MEMBER', 'Not a member of an alliance');
    return m;
  };
  const readOnlyOf = (a: MockAlliance, part: 'board' | 'chat') => {
    const home = alliances.home(careerById(activeMembers(a)[0]?.careerId ?? '') ?? ({} as MockCareer));
    return part === 'board'
      ? (home.alliance?.readOnly.board ?? a.readOnly.board)
      : (home.alliance?.readOnly.chat ?? a.readOnly.chat);
  };
  /** Free text or structured (QUICK phrase / reaction): the latter passes a read-only state and an alliance mute. */
  const requireWrite = (career: MockCareer, part: 'board' | 'chat', structured: boolean) => {
    const m = membership(career, part);
    const restrictions = alliances.restrictions(career);
    if (restrictions.suspended)
      throw new MockError(403, 'FORBIDDEN', 'Account suspended', { reason: 'SUSPENDED' });
    if (readOnlyOf(m.alliance, part) && !structured)
      throw new MockError(409, 'CONFLICT', 'Read-only', { reason: 'READ_ONLY' });
    if (structured) {
      if (!restrictions.canUseQuick)
        throw new MockError(403, 'MUTED', 'Muted', { until: restrictions.mutedUntil, scope: 'PLATFORM' });
      return m;
    }
    if (!restrictions.rulesAccepted)
      throw new MockError(403, 'RULES_NOT_ACCEPTED', 'Accept the community rules first');
    if (career.summary.level < restrictions.writeMinLevel)
      throw new MockError(403, 'FORBIDDEN', 'Level too low to write', { reason: 'LEVEL' });
    if (!restrictions.accountAgeOk)
      throw new MockError(403, 'FORBIDDEN', 'Account too new', { reason: 'ACCOUNT_AGE' });
    if (restrictions.mutedUntil)
      throw new MockError(403, 'MUTED', 'Muted', {
        until: restrictions.mutedUntil,
        scope: restrictions.muteScope,
      });
    return m;
  };
  const requireText = (raw: string, max: number) => {
    const value = raw.trim();
    if (value.length === 0 || value.length > max)
      throw new MockError(422, 'VALIDATION_ERROR', `text must be 1-${max} chars`);
    const result = checkText(value);
    if (!result.ok) throw new MockError(422, 'TEXT_REJECTED', 'Text refused by the filter', result);
    return result.masked;
  };
  const isHigh = (role: string) => role !== 'MEMBER';
  const authorDto = (careerId: string | null, a: MockAlliance) => {
    const member = careerId ? activeMembers(a).find((m) => m.careerId === careerId) : undefined;
    return {
      careerId: careerId && careerById(careerId) ? careerId : null,
      directorName: nameOf(careerId),
      role: member?.role ?? null,
    };
  };
  const notifyMembers = (
    a: MockAlliance,
    except: string | null,
    code: string,
    params: Record<string, string | number>,
    targetId: string,
    priority: 'CRITICAL' | 'IMPORTANT' | 'INFO' = 'INFO',
    only?: (careerId: string) => boolean,
  ) => {
    for (const m of activeMembers(a)) {
      if (m.careerId === except || (only && !only(m.careerId))) continue;
      const c = careerById(m.careerId);
      if (c) alliances.notify(c, code, params, targetId, priority);
    }
  };

  /* ───────────── board ───────────── */
  const postsOf = (a: MockAlliance) => (world().posts[a.id] ??= []);
  const repliesOf = (postId: string) => (world().replies[postId] ??= []);
  const reactionsOf = (postId: string) => (world().reactions[postId] ??= {});
  const replyDto = (r: MockReply, viewer: MockCareer, a: MockAlliance): AlliancePostReplyDto => {
    const hidden = isHidden('REPLY', r.id);
    const blocked =
      r.authorCareerId !== viewer.summary.id && hasBlocked(engine, viewer.summary.id, r.authorCareerId);
    return {
      id: r.id,
      postId: r.postId,
      author: authorDto(r.authorCareerId, a),
      text: r.removed || hidden || blocked ? null : r.text,
      createdAt: iso(r.createdAt),
      editedAt: r.editedAt === null ? null : iso(r.editedAt),
      removed: r.removed,
      hidden: !r.removed && hidden,
      hiddenByBlock: !r.removed && !hidden && blocked,
      mine: r.authorCareerId === viewer.summary.id,
    };
  };
  const postDto = (p: MockPost, viewer: MockCareer, a: MockAlliance): AlliancePostDto => {
    const hidden = p.kind !== 'SYSTEM' && isHidden('POST', p.id);
    const blocked =
      p.authorCareerId !== null &&
      p.authorCareerId !== viewer.summary.id &&
      hasBlocked(engine, viewer.summary.id, p.authorCareerId);
    const reactions = reactionsOf(p.id);
    const mine = p.authorCareerId === viewer.summary.id;
    const editableUntil = p.createdAt + BOARD_CFG.editWindowMinutes * MIN;
    const replies = repliesOf(p.id);
    return {
      id: p.id,
      kind: p.kind,
      author: p.kind === 'SYSTEM' ? null : authorDto(p.authorCareerId, a),
      text: p.kind === 'SYSTEM' || p.removed || hidden || blocked ? null : p.text,
      system: p.system
        ? { code: p.system.code, text: text(`alliance.post.system.${p.system.code}`, p.system.params) }
        : null,
      pinned: p.pinned,
      pinnedAt: p.pinnedAt === null ? null : iso(p.pinnedAt),
      createdAt: iso(p.createdAt),
      editedAt: p.editedAt === null ? null : iso(p.editedAt),
      editableUntil: mine && !p.removed && engine.now() < editableUntil ? iso(editableUntil) : null,
      removed: p.removed,
      hidden: !p.removed && hidden,
      hiddenByBlock: !p.removed && !hidden && blocked,
      mine,
      reactions: AllianceReaction.options.map((reaction) => ({
        reaction,
        count: Object.values(reactions).filter((r) => r === reaction).length,
        mine: reactions[viewer.summary.id] === reaction,
      })),
      replyCount: replies.length,
      replies: replies.slice(-BOARD_CFG.repliesPreview).map((r) => replyDto(r, viewer, a)),
    };
  };
  /** The board as the room sees it: no viewer fields (`mine` false, `editableUntil` null, no block state). */
  const neutralPost = (p: MockPost, a: MockAlliance): AlliancePostDto => {
    const anyMember = careerById(activeMembers(a)[0]?.careerId ?? null);
    const dto = postDto(p, anyMember ?? ({ summary: { id: '' } } as MockCareer), a);
    return {
      ...dto,
      mine: false,
      editableUntil: null,
      hiddenByBlock: false,
      reactions: dto.reactions.map((r) => ({ ...r, mine: false })),
      replies: dto.replies.map((r) => ({ ...r, mine: false, hiddenByBlock: false })),
    };
  };
  const sortedPosts = (a: MockAlliance) =>
    [...postsOf(a)].sort(
      (x, y) =>
        Number(y.pinned) - Number(x.pinned) ||
        (y.pinned ? (y.pinnedAt ?? 0) - (x.pinnedAt ?? 0) : 0) ||
        y.createdAt - x.createdAt,
    );
  const dailyCount = (careerId: string, list: { authorCareerId: string | null; createdAt: number }[]) =>
    list.filter((x) => x.authorCareerId === careerId && engine.now() - x.createdAt < DAY).length;
  const findPost = (a: MockAlliance, postId: string) => {
    const p = postsOf(a).find((x) => x.id === postId);
    if (!p) throw new MockError(404, 'NOT_FOUND', 'Post not found');
    return p;
  };

  const listPosts = (career: MockCareer, q: { cursor?: string; limit?: number; kind?: string }) => {
    if (!flag('board')) return { data: [] as AlliancePostDto[], nextCursor: null, hasMore: false };
    const m = alliances.membershipOf(career.summary.id);
    if (!m) throw new MockError(403, 'NOT_ALLIANCE_MEMBER', 'Not a member of an alliance');
    const rows = sortedPosts(m.alliance).filter((p) => !q.kind || p.kind === q.kind);
    const start = Number(q.cursor ?? 0) || 0;
    const limit = Math.min(50, q.limit ?? BOARD_CFG.pageSize);
    const page = rows.slice(start, start + limit);
    const hasMore = start + limit < rows.length;
    return {
      data: page.map((p) => postDto(p, career, m.alliance)),
      nextCursor: hasMore ? String(start + limit) : null,
      hasMore,
    };
  };
  const getPost = (career: MockCareer, postId: string) => {
    const m = membership(career, 'board');
    return postDto(findPost(m.alliance, postId), career, m.alliance);
  };
  const listReplies = (career: MockCareer, postId: string, q: { cursor?: string; limit?: number }) => {
    const m = membership(career, 'board');
    findPost(m.alliance, postId);
    const rows = repliesOf(postId);
    const start = Number(q.cursor ?? 0) || 0;
    const limit = Math.min(100, q.limit ?? 50);
    const page = rows.slice(start, start + limit);
    const hasMore = start + limit < rows.length;
    return {
      data: page.map((r) => replyDto(r, career, m.alliance)),
      nextCursor: hasMore ? String(start + limit) : null,
      hasMore,
    };
  };
  const createPost = (
    career: MockCareer,
    body: { kind?: unknown; text?: unknown; pin?: unknown },
  ): AlliancePostDto => {
    const m = requireWrite(career, 'board', false);
    const a = m.alliance;
    if (body.kind !== 'NOTE' && body.kind !== 'ANNOUNCEMENT')
      throw new MockError(422, 'VALIDATION_ERROR', 'kind must be NOTE or ANNOUNCEMENT');
    if (body.kind === 'ANNOUNCEMENT' && !isHigh(m.member.role))
      throw new MockError(403, 'ROLE_REQUIRED', 'Announcements are for high roles', { role: 'DEPUTY' });
    if (body.kind === 'NOTE' && a.settings.notesByHighRolesOnly && !isHigh(m.member.role))
      throw new MockError(403, 'ROLE_REQUIRED', 'Notes are reserved to high roles here', { role: 'DEPUTY' });
    if (dailyCount(career.summary.id, postsOf(a)) >= BOARD_CFG.postsPerDay)
      throw new MockError(429, 'RATE_LIMITED', 'Daily post limit', {
        reason: 'DAILY_LIMIT',
        limit: BOARD_CFG.postsPerDay,
      });
    const value = requireText(String(body.text ?? ''), BOARD_CFG.postMaxChars);
    const pin = body.pin === true && body.kind === 'ANNOUNCEMENT';
    if (pin && postsOf(a).filter((p) => p.pinned).length >= alliances.progressOf(a).pinnedSlots)
      throw new MockError(409, 'CONFLICT', 'No pinned slot left', {
        reason: 'PIN_LIMIT',
        slots: alliances.progressOf(a).pinnedSlots,
      });
    const post: MockPost = {
      id: engine.id('alp'),
      allianceId: a.id,
      kind: body.kind,
      authorCareerId: career.summary.id,
      text: value,
      system: null,
      pinned: pin,
      pinnedAt: pin ? engine.now() : null,
      createdAt: engine.now(),
      editedAt: null,
      removed: false,
    };
    postsOf(a).push(post);
    a.lastActivityAt = engine.now();
    if (body.kind === 'ANNOUNCEMENT')
      notifyMembers(
        a,
        career.summary.id,
        'ANNOUNCEMENT',
        { director: career.summary.directorName, tag: a.tag, name: a.name },
        `post:${post.id}`,
        'INFO',
      );
    alliances.emitAlliance(a.id, 'alliance.post.created', { post: neutralPost(post, a) });
    engine.save();
    return postDto(post, career, a);
  };
  const updatePost = (career: MockCareer, postId: string, body: { text?: unknown }): AlliancePostDto => {
    const m = requireWrite(career, 'board', false);
    const post = findPost(m.alliance, postId);
    if (post.authorCareerId !== career.summary.id || post.removed)
      throw new MockError(404, 'NOT_FOUND', 'Post not found');
    if (engine.now() - post.createdAt > BOARD_CFG.editWindowMinutes * MIN)
      throw new MockError(409, 'CONFLICT', 'Edit window expired', { reason: 'EDIT_WINDOW_EXPIRED' });
    post.text = requireText(String(body.text ?? ''), BOARD_CFG.postMaxChars);
    post.editedAt = engine.now();
    alliances.emitAlliance(m.alliance.id, 'alliance.post.updated', { post: neutralPost(post, m.alliance) });
    engine.save();
    return postDto(post, career, m.alliance);
  };
  const deletePost = (career: MockCareer, postId: string): void => {
    const m = membership(career, 'board');
    const post = findPost(m.alliance, postId);
    const own = post.authorCareerId === career.summary.id;
    if (!own && !isHigh(m.member.role))
      throw new MockError(403, 'ROLE_REQUIRED', 'Role required', { role: 'DEPUTY' });
    if (post.kind === 'SYSTEM' && !isHigh(m.member.role))
      throw new MockError(403, 'ROLE_REQUIRED', 'Role required', { role: 'DEPUTY' });
    if (!post.removed) {
      post.removed = true;
      post.pinned = false;
      if (!own) alliances.logAction(m.alliance.id, 'POST_REMOVED', career.summary.id, post.authorCareerId);
      alliances.emitAlliance(m.alliance.id, 'alliance.post.removed', { postId: post.id });
      engine.save();
    }
  };
  const createReply = (
    career: MockCareer,
    postId: string,
    body: { text?: unknown },
  ): AlliancePostReplyDto => {
    const m = requireWrite(career, 'board', false);
    const post = findPost(m.alliance, postId);
    if (post.removed) throw new MockError(409, 'CONFLICT', 'Post removed', { reason: 'REMOVED' });
    const all = Object.values(world().replies).flat();
    if (dailyCount(career.summary.id, all) >= BOARD_CFG.repliesPerDay)
      throw new MockError(429, 'RATE_LIMITED', 'Daily reply limit', {
        reason: 'DAILY_LIMIT',
        limit: BOARD_CFG.repliesPerDay,
      });
    const reply: MockReply = {
      id: engine.id('alr'),
      postId,
      authorCareerId: career.summary.id,
      text: requireText(String(body.text ?? ''), BOARD_CFG.replyMaxChars),
      createdAt: engine.now(),
      editedAt: null,
      removed: false,
    };
    repliesOf(postId).push(reply);
    m.alliance.lastActivityAt = engine.now();
    alliances.emitAlliance(m.alliance.id, 'alliance.post.updated', { post: neutralPost(post, m.alliance) });
    engine.save();
    return replyDto(reply, career, m.alliance);
  };
  const deleteReply = (career: MockCareer, postId: string, replyId: string): void => {
    const m = membership(career, 'board');
    findPost(m.alliance, postId);
    const reply = repliesOf(postId).find((r) => r.id === replyId);
    if (!reply) throw new MockError(404, 'NOT_FOUND', 'Reply not found');
    const own = reply.authorCareerId === career.summary.id;
    if (!own && !isHigh(m.member.role))
      throw new MockError(403, 'ROLE_REQUIRED', 'Role required', { role: 'DEPUTY' });
    if (!reply.removed) {
      reply.removed = true;
      if (!own) alliances.logAction(m.alliance.id, 'REPLY_REMOVED', career.summary.id, reply.authorCareerId);
      alliances.emitAlliance(m.alliance.id, 'alliance.post.removed', { postId, replyId });
      engine.save();
    }
  };
  const react = (career: MockCareer, postId: string, body: { reaction?: unknown }): AlliancePostDto => {
    const m = requireWrite(career, 'board', true);
    const post = findPost(m.alliance, postId);
    if (post.removed) throw new MockError(409, 'CONFLICT', 'Post removed', { reason: 'REMOVED' });
    const reactions = reactionsOf(postId);
    if (body.reaction === null) delete reactions[career.summary.id];
    else {
      const parsed = AllianceReaction.safeParse(body.reaction);
      if (!parsed.success) throw new MockError(422, 'VALIDATION_ERROR', 'reaction');
      reactions[career.summary.id] = parsed.data;
    }
    alliances.emitAlliance(m.alliance.id, 'alliance.post.updated', { post: neutralPost(post, m.alliance) });
    engine.save();
    return postDto(post, career, m.alliance);
  };
  const pin = (career: MockCareer, postId: string, body: { pinned?: unknown }): AlliancePostDto => {
    const m = membership(career, 'board');
    if (!isHigh(m.member.role))
      throw new MockError(403, 'ROLE_REQUIRED', 'Role required', { role: 'DEPUTY' });
    const post = findPost(m.alliance, postId);
    if (post.kind !== 'ANNOUNCEMENT' || post.removed)
      throw new MockError(409, 'CONFLICT', 'Only announcements pin', { reason: 'NOT_AN_ANNOUNCEMENT' });
    const pinned = body.pinned === true;
    if (
      pinned &&
      !post.pinned &&
      postsOf(m.alliance).filter((p) => p.pinned).length >= alliances.progressOf(m.alliance).pinnedSlots
    )
      throw new MockError(409, 'CONFLICT', 'No pinned slot left', {
        reason: 'PIN_LIMIT',
        slots: alliances.progressOf(m.alliance).pinnedSlots,
      });
    if (post.pinned !== pinned) {
      post.pinned = pinned;
      post.pinnedAt = pinned ? engine.now() : null;
      if (pinned)
        notifyMembers(
          m.alliance,
          career.summary.id,
          'ANNOUNCEMENT',
          { director: career.summary.directorName, tag: m.alliance.tag, name: m.alliance.name },
          `post:${post.id}`,
          'INFO',
        );
      alliances.emitAlliance(m.alliance.id, 'alliance.post.updated', { post: neutralPost(post, m.alliance) });
      engine.save();
    }
    return postDto(post, career, m.alliance);
  };
  /** A system post (03 §2.1): structured, translated for the reader. */
  const systemPost = (
    a: MockAlliance,
    code: AllianceSystemPostCode,
    params: Record<string, string | number>,
  ) => {
    const post: MockPost = {
      id: engine.id('alp'),
      allianceId: a.id,
      kind: 'SYSTEM',
      authorCareerId: null,
      text: null,
      system: { code, params },
      pinned: false,
      pinnedAt: null,
      createdAt: engine.now(),
      editedAt: null,
      removed: false,
    };
    postsOf(a).push(post);
    alliances.emitAlliance(a.id, 'alliance.post.created', { post: neutralPost(post, a) });
  };

  /* ───────────── chat ───────────── */
  const channelsOf = (a: MockAlliance): MockChannel[] => {
    const list = (world().channels[a.id] ??= []);
    if (!list.some((c) => c.kind === 'GENERAL'))
      list.unshift({
        id: a.generalChannelId,
        allianceId: a.id,
        kind: 'GENERAL',
        operationId: null,
        operationTitle: null,
        archived: false,
        createdAt: a.createdAt,
      });
    return list;
  };
  const messagesOf = (channelId: string) => (world().messages[channelId] ??= []);
  const liveMessages = (channelId: string) =>
    messagesOf(channelId).filter((x) => engine.now() - x.createdAt < CHAT_CFG.retentionDays * DAY);
  const readMarks = (career: MockCareer) => careerAlliance(career).read;
  const unreadIn = (career: MockCareer, channelId: string) =>
    liveMessages(channelId).filter(
      (x) =>
        x.createdAt > (readMarks(career).channels[channelId] ?? 0) &&
        x.authorCareerId !== career.summary.id &&
        !x.removed,
    ).length;
  const channelDto = (c: MockChannel, viewer: MockCareer): AllianceChannelDto => {
    const last = liveMessages(c.id).at(-1);
    return {
      id: c.id,
      kind: c.kind,
      name:
        c.kind === 'GENERAL'
          ? text('alliance.channel.GENERAL')
          : (c.operationTitle ?? text('alliance.channel.OPERATION')),
      operationId: c.operationId,
      archived: c.archived,
      createdAt: iso(c.createdAt),
      lastMessageAt: last ? iso(last.createdAt) : null,
      unread: unreadIn(viewer, c.id),
    };
  };
  const messageDto = (x: MockMessage, viewer: MockCareer, a: MockAlliance): AllianceMessageDto => {
    const hidden = isHidden('MESSAGE', x.id);
    const mine = x.authorCareerId === viewer.summary.id;
    const blocked = !mine && hasBlocked(engine, viewer.summary.id, x.authorCareerId);
    const deletableUntil = x.createdAt + CHAT_CFG.selfDeleteMinutes * MIN;
    return {
      id: x.id,
      channelId: x.channelId,
      kind: x.kind,
      author: authorDto(x.authorCareerId, a),
      text: x.kind === 'QUICK' || x.removed || hidden || blocked ? null : x.text,
      quick: x.quick,
      mentions: x.mentions.map((careerId) => ({ careerId, directorName: nameOf(careerId) ?? '' })),
      createdAt: iso(x.createdAt),
      removed: x.removed,
      hidden: !x.removed && hidden,
      hiddenByBlock: !x.removed && !hidden && blocked,
      mine,
      deletableUntil: mine && !x.removed && engine.now() < deletableUntil ? iso(deletableUntil) : null,
    };
  };
  const neutralMessage = (x: MockMessage, a: MockAlliance): AllianceMessageDto => ({
    ...messageDto(x, { summary: { id: '' } } as MockCareer, a),
    mine: false,
    hiddenByBlock: false,
    deletableUntil: null,
  });
  const findChannel = (a: MockAlliance, channelId: string) => {
    const c = channelsOf(a).find((x) => x.id === channelId);
    if (!c) throw new MockError(404, 'NOT_FOUND', 'Channel not found');
    return c;
  };
  const listChannels = (career: MockCareer): AllianceChannelDto[] => {
    if (!flag('chat')) return [];
    const m = alliances.membershipOf(career.summary.id);
    if (!m) throw new MockError(403, 'NOT_ALLIANCE_MEMBER', 'Not a member of an alliance');
    return channelsOf(m.alliance).map((c) => channelDto(c, career));
  };
  const listMessages = (career: MockCareer, channelId: string, q: { cursor?: string; limit?: number }) => {
    if (!flag('chat')) return { data: [] as AllianceMessageDto[], nextCursor: null, hasMore: false };
    const m = alliances.membershipOf(career.summary.id);
    if (!m) throw new MockError(403, 'NOT_ALLIANCE_MEMBER', 'Not a member of an alliance');
    findChannel(m.alliance, channelId);
    // Newest first; the cursor is the id of the oldest message of the previous page → the next page is older than it.
    const all = liveMessages(channelId)
      .slice()
      .sort((x, y) => y.createdAt - x.createdAt);
    const start = q.cursor ? Math.max(0, all.findIndex((x) => x.id === q.cursor) + 1) : 0;
    const limit = Math.min(50, q.limit ?? CHAT_CFG.pageSize);
    const page = all.slice(start, start + limit);
    const hasMore = start + limit < all.length;
    return {
      data: page.map((x) => messageDto(x, career, m.alliance)),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      hasMore,
    };
  };
  const sendMessage = (
    career: MockCareer,
    channelId: string,
    body: Record<string, unknown>,
  ): AllianceMessageDto => {
    const quick = body.kind === 'QUICK';
    const m = requireWrite(career, 'chat', quick);
    const a = m.alliance;
    const channel = findChannel(a, channelId);
    if (channel.archived)
      throw new MockError(409, 'CONFLICT', 'Channel archived', { reason: 'CHANNEL_ARCHIVED' });
    const now = engine.now();
    const mineRecent = Object.values(world().messages)
      .flat()
      .filter((x) => x.authorCareerId === career.summary.id && now - x.createdAt < MIN);
    if (
      mineRecent.filter((x) => now - x.createdAt < CHAT_CFG.minSecondsBetween * 1000 * CHAT_CFG.burst)
        .length >= CHAT_CFG.burst ||
      mineRecent.length >= CHAT_CFG.perMinute
    )
      throw new MockError(429, 'RATE_LIMITED', 'Too many messages', { reason: 'CHAT_RATE' });
    let message: MockMessage;
    if (quick) {
      const code = AllianceQuickCode.safeParse(body.code);
      if (!code.success) throw new MockError(422, 'VALIDATION_ERROR', 'Unknown quick phrase');
      message = {
        id: engine.id('alx'),
        channelId,
        authorCareerId: career.summary.id,
        kind: 'QUICK',
        text: null,
        quick: { code: code.data, params: (body.params as Record<string, string | number>) ?? {} },
        mentions: [],
        createdAt: now,
        removed: false,
      };
    } else {
      const requested = Array.isArray(body.mentions)
        ? (body.mentions as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const members = new Set(activeMembers(a).map((x) => x.careerId));
      const mentions = [...new Set(requested)]
        .filter((id) => members.has(id) && id !== career.summary.id)
        .slice(0, CHAT_CFG.maxMentions);
      // A mention is structured data (03 §3.2): `@Nome` of a member named in `mentions` is not a social handle for
      // the filter; the stored text keeps the `@`.
      const raw = String(body.text ?? '');
      const checked = mentions.reduce((t, id) => {
        const name = nameOf(id);
        return name ? t.split(`@${name}`).join(name) : t;
      }, raw);
      requireText(checked, CHAT_CFG.messageMaxChars);
      const value = raw.trim();
      if (mineRecent.some((x) => x.kind === 'TEXT' && x.text === value))
        throw new MockError(409, 'CONFLICT', 'Duplicate message', { reason: 'DUPLICATE_MESSAGE' });
      message = {
        id: engine.id('alx'),
        channelId,
        authorCareerId: career.summary.id,
        kind: 'TEXT',
        text: value,
        quick: null,
        mentions,
        createdAt: now,
        removed: false,
      };
      for (const careerId of mentions) {
        if (isBlockedEither(engine, career.summary.id, careerId)) continue;
        const target = careerById(careerId);
        if (target)
          alliances.notify(
            target,
            'MENTION',
            { director: career.summary.directorName, tag: a.tag, name: a.name },
            'chat',
            'IMPORTANT',
          );
      }
    }
    messagesOf(channelId).push(message);
    readMarks(career).channels[channelId] = Math.max(readMarks(career).channels[channelId] ?? 0, now - 1);
    a.lastActivityAt = now;
    alliances.emitAlliance(a.id, 'alliance.message.created', { message: neutralMessage(message, a) });
    engine.save();
    return messageDto(message, career, a);
  };
  const deleteMessage = (career: MockCareer, messageId: string): void => {
    const m = membership(career, 'chat');
    for (const channel of channelsOf(m.alliance)) {
      const message = messagesOf(channel.id).find((x) => x.id === messageId);
      if (!message) continue;
      const own = message.authorCareerId === career.summary.id;
      if (!own && !isHigh(m.member.role))
        throw new MockError(403, 'ROLE_REQUIRED', 'Role required', { role: 'DEPUTY' });
      if (
        own &&
        engine.now() - message.createdAt > CHAT_CFG.selfDeleteMinutes * MIN &&
        !isHigh(m.member.role)
      )
        throw new MockError(409, 'CONFLICT', 'Delete window expired', { reason: 'DELETE_WINDOW_EXPIRED' });
      if (!message.removed) {
        message.removed = true;
        if (!own)
          alliances.logAction(m.alliance.id, 'MESSAGE_REMOVED', career.summary.id, message.authorCareerId);
        alliances.emitAlliance(m.alliance.id, 'alliance.message.removed', {
          channelId: channel.id,
          messageId,
        });
        engine.save();
      }
      return;
    }
    throw new MockError(404, 'NOT_FOUND', 'Message not found');
  };
  const readChannel = (
    career: MockCareer,
    channelId: string,
    body: { lastReadMessageId?: unknown },
  ): AllianceUnreadDto => {
    const m = membership(career, 'chat');
    findChannel(m.alliance, channelId);
    const upTo =
      typeof body.lastReadMessageId === 'string'
        ? messagesOf(channelId).find((x) => x.id === body.lastReadMessageId)?.createdAt
        : undefined;
    readMarks(career).channels[channelId] = Math.max(
      readMarks(career).channels[channelId] ?? 0,
      upTo ?? engine.now(),
    );
    engine.save();
    const unread = unreadProvider(career, m.alliance);
    alliances.careerUpdated(career);
    return unread;
  };
  const readBoard = (career: MockCareer): AllianceUnreadDto => {
    const m = membership(career, 'board');
    readMarks(career).board = engine.now();
    engine.save();
    const unread = unreadProvider(career, m.alliance);
    alliances.careerUpdated(career);
    return unread;
  };
  const presence = (career: MockCareer): AlliancePresenceDto[] => {
    const m = membership(career, 'chat');
    return activeMembers(m.alliance).map((x) => {
      const c = careerById(x.careerId);
      const dto = alliances.memberDto(m.alliance.id, x.careerId, career.summary.id);
      return { careerId: x.careerId, presence: c && dto?.presence ? dto.presence : 'AWAY' };
    });
  };
  const unreadProvider = (career: MockCareer, a: MockAlliance): AllianceUnreadDto => ({
    board: flag('board')
      ? postsOf(a).filter(
          (p) =>
            p.createdAt > readMarks(career).board && p.authorCareerId !== career.summary.id && !p.removed,
        ).length
      : 0,
    chat: flag('chat') ? channelsOf(a).reduce((sum, c) => sum + unreadIn(career, c.id), 0) : 0,
  });
  alliances.setUnreadProvider(unreadProvider);

  /** Where the quick-phrase catalog texts would be: the FE fallbacks `alliance.quick.<CODE>` render them. */
  void userOf;

  const api: AllianceSocialApi = {
    listPosts,
    getPost,
    listReplies,
    createPost,
    updatePost,
    deletePost,
    createReply,
    deleteReply,
    react,
    pin,
    readBoard,
    systemPost,
    listChannels,
    listMessages,
    sendMessage,
    deleteMessage,
    readChannel,
    presence,
    channelsOf,
    unreadOf: unreadProvider,
  };
  apis.set(engine, api);

  /* ───────────── QA: simulated allies write ───────────── */
  const careerOrThrow = (id: string) => {
    const c = engine.state.careers[id];
    if (!c) throw new MockError(404, 'NOT_FOUND', 'Career not found');
    return c;
  };
  engine.qa.allyPost = ((
    careerId: string,
    textValue: string,
    kind: 'NOTE' | 'ANNOUNCEMENT' = 'NOTE',
    pinned = false,
  ) => createPost(careerOrThrow(careerId), { kind, text: textValue, pin: pinned })) as never;
  engine.qa.allyReply = ((careerId: string, postId: string, textValue: string) =>
    createReply(careerOrThrow(careerId), postId, { text: textValue })) as never;
  engine.qa.allyReact = ((careerId: string, postId: string, reaction: string) =>
    react(careerOrThrow(careerId), postId, { reaction })) as never;
  engine.qa.allyMessage = ((careerId: string, body: string | Record<string, unknown>, channelId?: string) => {
    const career = careerOrThrow(careerId);
    const m = alliances.membershipOf(careerId);
    if (!m) throw new MockError(404, 'NOT_FOUND', 'No alliance');
    const channel = channelId ?? channelsOf(m.alliance)[0]!.id;
    return sendMessage(career, channel, typeof body === 'string' ? { kind: 'TEXT', text: body } : body);
  }) as never;
  /** QA: the current career's rules accepted, level and account age are fine for writing (04 §2.1). */
  engine.qa.enableWriting = (() => {
    const career = engine.qa.career();
    const user = Object.values(engine.state.users).find((u) => u.user.id === career.userId);
    if (user) user.user.createdAt = iso(engine.now() - 2 * DAY);
    engine.qa.acceptRules?.();
    engine.save();
  }) as never;
  /** QA: posts N messages from an ally quickly (history for the virtual list). */
  engine.qa.allyFlood = ((careerId: string, count: number, prefix = 'Messaggio') => {
    const career = careerOrThrow(careerId);
    const m = alliances.membershipOf(careerId);
    if (!m) throw new MockError(404, 'NOT_FOUND', 'No alliance');
    const channel = channelsOf(m.alliance)[0]!;
    const now = engine.now();
    for (let i = 0; i < count; i++)
      messagesOf(channel.id).push({
        id: engine.id('alx'),
        channelId: channel.id,
        authorCareerId: careerId,
        kind: 'TEXT',
        text: `${prefix} ${i + 1}`,
        quick: null,
        mentions: [],
        createdAt: now - (count - i) * 60_000,
        removed: false,
      });
    void career;
    engine.save();
  }) as never;
}

export interface AllianceSocialApi {
  listPosts: (
    career: MockCareer,
    q: { cursor?: string; limit?: number; kind?: string },
  ) => { data: AlliancePostDto[]; nextCursor: string | null; hasMore: boolean };
  getPost: (career: MockCareer, postId: string) => AlliancePostDto;
  listReplies: (
    career: MockCareer,
    postId: string,
    q: { cursor?: string; limit?: number },
  ) => { data: AlliancePostReplyDto[]; nextCursor: string | null; hasMore: boolean };
  createPost: (career: MockCareer, body: Record<string, unknown>) => AlliancePostDto;
  updatePost: (career: MockCareer, postId: string, body: Record<string, unknown>) => AlliancePostDto;
  deletePost: (career: MockCareer, postId: string) => void;
  createReply: (career: MockCareer, postId: string, body: Record<string, unknown>) => AlliancePostReplyDto;
  deleteReply: (career: MockCareer, postId: string, replyId: string) => void;
  react: (career: MockCareer, postId: string, body: Record<string, unknown>) => AlliancePostDto;
  pin: (career: MockCareer, postId: string, body: Record<string, unknown>) => AlliancePostDto;
  readBoard: (career: MockCareer) => AllianceUnreadDto;
  systemPost: (
    a: MockAlliance,
    code: AllianceSystemPostCode,
    params: Record<string, string | number>,
  ) => void;
  listChannels: (career: MockCareer) => AllianceChannelDto[];
  listMessages: (
    career: MockCareer,
    channelId: string,
    q: { cursor?: string; limit?: number },
  ) => { data: AllianceMessageDto[]; nextCursor: string | null; hasMore: boolean };
  sendMessage: (career: MockCareer, channelId: string, body: Record<string, unknown>) => AllianceMessageDto;
  deleteMessage: (career: MockCareer, messageId: string) => void;
  readChannel: (career: MockCareer, channelId: string, body: Record<string, unknown>) => AllianceUnreadDto;
  presence: (career: MockCareer) => AlliancePresenceDto[];
  channelsOf: (a: MockAlliance) => MockChannel[];
  unreadOf: (career: MockCareer, a: MockAlliance) => AllianceUnreadDto;
}
const apis = new WeakMap<MockEngine, AllianceSocialApi>();
export function allianceSocialOf(engine: MockEngine): AllianceSocialApi {
  const api = apis.get(engine);
  if (!api) throw new Error('alliance social domain not installed');
  return api;
}
