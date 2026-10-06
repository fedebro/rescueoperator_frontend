import {
  AllianceEmblemColor,
  AllianceEmblemShape,
  AllianceEmblemSymbol,
  FoundAllianceBody,
  JoinAllianceBody,
  UpdateAllianceSettingsBody,
  type AllianceCardDto,
  type AllianceConfigDto,
  type AllianceEmblemDto,
  type AllianceHomeDto,
  type AllianceInviteDto,
  type AllianceInviteReceivedDto,
  type AllianceJoinBlock,
  type AllianceJoinRequestDto,
  type AllianceLastSeen,
  type AllianceLevelDto,
  type AllianceLogAction,
  type AllianceLogEntryDto,
  type AllianceMemberDto,
  type AllianceMemberRole,
  type AllianceMemberStatus,
  type AllianceMuteDuration,
  type AlliancePresence,
  type AllianceRealtimeEnvelope,
  type AllianceRealtimeEventType,
  type AllianceRestrictionsDto,
  type AllianceSnapshotDto,
  type AllianceSyncDelta,
  type DirectorCardDto,
  type JoinAllianceResult,
  type LeaveAllianceResult,
  type MyAllianceDto,
  type MyAllianceJoinRequestDto,
  type ProfileSettingsDto,
  type PublicAllianceInviteDto,
  type SupportedLocale,
  type TextCheckResult,
  type TextFilterReason,
  type AllianceFrame,
} from '@/contracts';
import { mockBus } from '../bus';
import { xpThreshold } from '../data/catalog';
import { MockError, iso, text, type MockCareer, type MockEngine } from '../engine';
import { domainState } from './index';
import {
  acceptCommunityRules,
  COMMUNITY_RULES_VERSION,
  hasBlocked,
  isBlockedEither,
  rulesAcceptedBy,
} from './community';

/**
 * Simulation of the `alliances` + `profiles` modules (study 02, 08 §3.1/§5/§6; rules copied from
 * analisi/note-agenti/alleanze-backend.md §Phase 1a "Rules the mock must mirror" — same identifiers, same limits).
 *
 * State: `engine.state.ext.alliances` (alliances, members, invites, join requests, profiles, reserved names, the per-alliance
 * event sequences + outbox) and `career.ext.alliance` (cooldown, read markers, simulated-ally switches). Simulated allies
 * (`qa.simulateAlly`) are ordinary careers of the mock world that act through the same functions as the REST handlers.
 */

/* ───────────────────────────── config (AllianceConfigDto defaults = the study's numbers) ───────────────────────────── */

/** Level · XP · members · deputies · pinned · columns (study 06 §1.2, backend notes). */
const LEVEL_TABLE: [number, number, number, number, number, number][] = [
  [1, 0, 10, 2, 3, 2],
  [2, 500, 13, 2, 3, 2],
  [3, 1500, 16, 3, 3, 2],
  [4, 3500, 20, 4, 4, 2],
  [5, 7000, 23, 4, 4, 2],
  [6, 12000, 26, 5, 4, 3],
  [7, 19000, 30, 6, 4, 3],
  [8, 28000, 33, 6, 5, 3],
  [9, 40000, 36, 7, 5, 3],
  [10, 55000, 40, 8, 5, 3],
];
export const ALLIANCE_LEVELS: AllianceLevelDto[] = LEVEL_TABLE.map(
  ([level, xp, members, deputies, pinned, columns], i) => ({
    level,
    xp,
    xpForCurrentLevel: xp,
    xpForNextLevel: LEVEL_TABLE[i + 1]?.[1] ?? null,
    memberSlots: members,
    deputySlots: deputies,
    pinnedSlots: pinned,
    concurrentColumns: columns,
  }),
);

/** Emblem codes and the alliance level that unlocks them (06 §1.3; the split is a mock decision, logged in the notes). */
const unlock = (codes: readonly string[], levels: number[]) =>
  codes.map((code, i) => ({ code, minLevel: levels[i] ?? 1 }));
const EMBLEM_OPTIONS: AllianceConfigDto['emblem'] = {
  shapes: unlock(AllianceEmblemShape.options, [1, 1, 1, 3, 3, 6, 6, 1]),
  symbols: unlock(AllianceEmblemSymbol.options, [1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 6, 6, 6, 6]),
  colors: unlock(AllianceEmblemColor.options, [1, 1, 1, 1, 1, 1, 4, 1, 1, 4, 4, 4]),
};

export interface AllianceKnobs {
  foundLevel: number;
  foundCost: number;
  joinLevel: number;
  writeMinLevel: number;
  accountMinAgeHours: number;
  cooldownHours: number;
  disbandNoticeHours: number;
  successionDays: number;
  inviteTtlDays: number;
  requestTtlDays: number;
  nameChangeCooldownDays: number;
  inactiveAfterDays: number;
  readOnly: { board: boolean; chat: boolean };
}
const DEFAULT_KNOBS: AllianceKnobs = {
  foundLevel: 5,
  foundCost: 1000,
  joinLevel: 3,
  writeMinLevel: 2,
  accountMinAgeHours: 24,
  cooldownHours: 24,
  disbandNoticeHours: 48,
  successionDays: 14,
  inviteTtlDays: 7,
  requestTtlDays: 7,
  nameChangeCooldownDays: 30,
  inactiveAfterDays: 30,
  readOnly: { board: false, chat: false },
};
export const BOARD_CFG: AllianceConfigDto['board'] = {
  postMaxChars: 1000,
  replyMaxChars: 500,
  postsPerDay: 5,
  repliesPerDay: 30,
  editWindowMinutes: 15,
  repliesPreview: 3,
  pageSize: 50,
};
export const CHAT_CFG: AllianceConfigDto['chat'] = {
  messageMaxChars: 500,
  minSecondsBetween: 2,
  burst: 5,
  perMinute: 30,
  selfDeleteMinutes: 5,
  retentionDays: 90,
  pageSize: 50,
  maxMentions: 5,
};
export const AID_CFG: AllianceConfigDto['aid'] = {
  maxOpenRequestsPerCareer: 2,
  minSecondsBetweenRequests: 60,
  maxVehiclesPerColumn: 4,
  maxVehiclesPerColumnMajor: 8,
  minEtaMinutes: 2,
  maxEtaMinutes: 15,
  maxStayMinutes: 20,
  rewardedPerDay: 8,
  fundShareIncident: 0.4,
  fundShareMajor: 0.25,
  minContributionShare: 0.1,
};

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
const OUTBOX_WINDOW = 500;
const MUTE_MS: Record<AllianceMuteDuration, number> = { H1: HOUR, H24: DAY, D7: 7 * DAY };

/* ───────────────────────────── state ───────────────────────────── */

export interface MockMember {
  id: string;
  careerId: string;
  role: AllianceMemberRole;
  status: AllianceMemberStatus;
  joinedAt: number | null;
  leftAt: number | null;
  mutedUntil: number | null;
}
export interface MockAlliance {
  id: string;
  name: string;
  tag: string;
  emblem: AllianceEmblemDto;
  description: string;
  language: SupportedLocale;
  joinPolicy: AllianceCardDto['joinPolicy'];
  minLevel: number | null;
  status: AllianceCardDto['status'];
  createdAt: number;
  lastActivityAt: number;
  xp: number;
  settings: { membersCanInvite: boolean; notesByHighRolesOnly: boolean };
  members: MockMember[];
  log: AllianceLogEntryDto[];
  disbandAt: number | null;
  readOnly: { board: boolean; chat: boolean };
  nameChangedAt: number | null;
  generalChannelId: string;
}
interface MockInvite {
  id: string;
  allianceId: string;
  code: string | null;
  createdBy: string;
  target: string | null;
  status: AllianceInviteDto['status'];
  createdAt: number;
  expiresAt: number;
  uses: number;
}
interface MockJoinRequest {
  id: string;
  allianceId: string;
  careerId: string;
  status: AllianceJoinRequestDto['status'];
  createdAt: number;
  expiresAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
}
export interface AllianceWorld {
  alliances: Record<string, MockAlliance>;
  invites: Record<string, MockInvite>;
  requests: Record<string, MockJoinRequest>;
  /** By user id (one active career per player, D-30). */
  profiles: Record<string, ProfileSettingsDto>;
  /** Names and tags of disbanded alliances stay taken for 30 days (02 §7). */
  reserved: { name: string; tag: string; until: number }[];
  seq: Record<string, number>;
  outbox: Record<string, AllianceRealtimeEnvelope[]>;
  knobs: Partial<AllianceKnobs>;
}
export interface CareerAllianceState {
  cooldownUntil: number | null;
  aidGiven: number;
  aidReceived: number;
  /** A simulated ally (`qa.simulateAlly`): what the "other player" is doing. */
  simulated: { onDuty: boolean; online: boolean; city: string | null } | null;
  /** Read markers (phase 2 fills them): board + per channel, as instants. */
  read: { board: number; channels: Record<string, number> };
}

export const allianceWorld = (engine: MockEngine): AllianceWorld =>
  (engine.state.ext.alliances ??= {
    alliances: {},
    invites: {},
    requests: {},
    profiles: {},
    reserved: [],
    seq: {},
    outbox: {},
    knobs: {},
  } satisfies AllianceWorld) as AllianceWorld;

export const careerAlliance = (career: MockCareer): CareerAllianceState =>
  domainState<CareerAllianceState>(career, 'alliance', () => ({
    cooldownUntil: null,
    aidGiven: 0,
    aidReceived: 0,
    simulated: null,
    read: { board: 0, channels: {} },
  }));

export const knobsOf = (engine: MockEngine): AllianceKnobs => ({
  ...DEFAULT_KNOBS,
  ...allianceWorld(engine).knobs,
});

/* ───────────────────────────── helpers ───────────────────────────── */

/** Case- and accent-insensitive form used for uniqueness and prefix search (server normalizes the same way). */
export const normalizeText = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** A tiny stand-in for the catalog text filter (04 §2.2): banned terms + the four refused patterns. */
const BANNED_TERMS = [
  'merda',
  'stronzo',
  'vaffanculo',
  'cazzo',
  'fuck',
  'shit',
  'bitch',
  'puta',
  'merde',
  'scheisse',
];
export function checkText(raw: string): TextCheckResult {
  const reasons: TextFilterReason[] = [];
  const n = normalizeText(raw);
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|it|net|org|eu|io|me|gg)\b)/i.test(raw)) reasons.push('URL');
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(raw)) reasons.push('EMAIL');
  if (/(\+?\d[\d\s.-]{7,}\d)/.test(raw)) reasons.push('PHONE');
  if (/(^|\s)@\w{3,}/.test(raw)) reasons.push('SOCIAL_HANDLE');
  if (BANNED_TERMS.some((term) => n.includes(term))) reasons.push('BANNED_TERM');
  return { ok: reasons.length === 0, tier: reasons.length ? 'REJECT' : null, masked: raw, reasons };
}
export function assertText(raw: string): void {
  const result = checkText(raw);
  if (!result.ok) throw new MockError(422, 'TEXT_REJECTED', 'Text refused by the filter', result);
}

export const levelOf = (xp: number): AllianceLevelDto =>
  [...ALLIANCE_LEVELS].reverse().find((l) => xp >= l.xp) ?? ALLIANCE_LEVELS[0]!;
export const progressOf = (a: MockAlliance): AllianceLevelDto => ({ ...levelOf(a.xp), xp: a.xp });
export const activeMembers = (a: MockAlliance): MockMember[] =>
  a.members.filter((m) => m.status === 'ACTIVE');
const memberOf = (a: MockAlliance, careerId: string): MockMember | undefined =>
  a.members.find((m) => m.careerId === careerId && m.status === 'ACTIVE');
const isHigh = (role: AllianceMemberRole) => role !== 'MEMBER';
/** Study 02 §3: deputies act on members; the coordinator on everybody but himself. */
const canActOn = (actor: AllianceMemberRole, target: AllianceMemberRole) =>
  actor === 'COORDINATOR' ? target !== 'COORDINATOR' : actor === 'DEPUTY' && target === 'MEMBER';

/** Random 10-char invite code `[A-Z2-9]` (no ambiguous letters), like the server's. */
const inviteCode = (random: () => number) =>
  Array.from({ length: 10 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(random() * 31)]).join('');

export function installAlliance(engine: MockEngine): void {
  const world = () => allianceWorld(engine);
  const knobs = () => knobsOf(engine);
  const flagOn = () => engine.state.featureFlags.alliances === true;
  const careerById = (id: string): MockCareer | undefined => engine.state.careers[id];
  const userOf = (career: MockCareer) =>
    Object.values(engine.state.users).find((u) => u.user.id === career.userId);
  const nameOf = (careerId: string | null): string | null =>
    careerId ? (careerById(careerId)?.summary.directorName ?? null) : null;
  const ref = (careerId: string | null) => ({
    careerId: careerId && careerById(careerId) ? careerId : null,
    directorName: nameOf(careerId),
  });

  /* ── membership lookups ── */
  const membershipOf = (careerId: string): { alliance: MockAlliance; member: MockMember } | null => {
    for (const alliance of Object.values(world().alliances)) {
      if (alliance.status === 'DISBANDED' || alliance.status === 'CLOSED') continue;
      const member = memberOf(alliance, careerId);
      if (member) return { alliance, member };
    }
    return null;
  };
  const requireMembership = (career: MockCareer) => {
    if (!flagOn()) throw new MockError(403, 'FEATURE_DISABLED', 'Alliances are not enabled');
    const m = membershipOf(career.summary.id);
    if (!m) throw new MockError(403, 'NOT_ALLIANCE_MEMBER', 'Not a member of an alliance');
    return m;
  };
  const requireRole = (member: MockMember, role: AllianceMemberRole) => {
    const rank: Record<AllianceMemberRole, number> = { MEMBER: 0, DEPUTY: 1, COORDINATOR: 2 };
    if (rank[member.role] < rank[role]) throw new MockError(403, 'ROLE_REQUIRED', 'Role required', { role });
  };
  const requireCommandAllowed = (career: MockCareer) => {
    if (!flagOn()) throw new MockError(403, 'FEATURE_DISABLED', 'Alliances are not enabled');
    if (userOf(career)?.status === 'SUSPENDED')
      throw new MockError(403, 'FORBIDDEN', 'Account suspended', { reason: 'SUSPENDED' });
  };

  /* ── events ── */
  const emitAlliance = (
    allianceId: string,
    type: AllianceRealtimeEventType,
    payload: Record<string, unknown>,
  ) => {
    const w = world();
    w.seq[allianceId] = (w.seq[allianceId] ?? 0) + 1;
    const now = iso(engine.now());
    const envelope: AllianceRealtimeEnvelope = {
      type,
      v: 1,
      allianceId,
      seq: w.seq[allianceId]!,
      occurredAt: now,
      serverTime: now,
      payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
    };
    const box = (w.outbox[allianceId] ??= []);
    box.push(envelope);
    if (box.length > OUTBOX_WINDOW) box.splice(0, box.length - OUTBOX_WINDOW);
    mockBus.emitAlliance(envelope);
  };
  /** The career stream carries the additive snapshot field when the membership (or its counters) changes. */
  const careerUpdated = (career: MockCareer) =>
    engine.emit(career, 'career.updated', { alliance: refOf(career) });
  const log = (
    a: MockAlliance,
    action: AllianceLogAction,
    actor: string | null,
    target: string | null,
    details: AllianceLogEntryDto['details'] = {},
    byAdmin = false,
  ) => {
    a.log.unshift({
      id: engine.id('alg'),
      at: iso(engine.now()),
      action,
      actor: actor ? ref(actor) : null,
      target: target ? ref(target) : null,
      byAdmin,
      details,
    });
    a.log = a.log.slice(0, 500);
    a.lastActivityAt = engine.now();
  };
  const notify = (
    career: MockCareer,
    code: string,
    params: Record<string, string | number>,
    targetId: string,
    priority: 'CRITICAL' | 'IMPORTANT' | 'INFO' = 'IMPORTANT',
  ) =>
    engine.notify(career, {
      category: 'ALLIANCE',
      priority,
      title: text(`alliance.notification.${code}.title`, params),
      body: text(`alliance.notification.${code}.body`, params),
      action: { kind: 'OPEN_ALLIANCE', targetId },
    });
  const touchAlliance = (a: MockAlliance) => {
    a.lastActivityAt = engine.now();
  };

  /* ── lazy expiries & succession (the real server schedules them; the mock checks on every access) ── */
  const expireStale = () => {
    const now = engine.now();
    const w = world();
    for (const invite of Object.values(w.invites))
      if (invite.status === 'ACTIVE' && invite.expiresAt <= now) invite.status = 'EXPIRED';
    for (const request of Object.values(w.requests))
      if (request.status === 'PENDING' && request.expiresAt <= now) request.status = 'EXPIRED';
    w.reserved = w.reserved.filter((r) => r.until > now);
    for (const a of Object.values(w.alliances)) {
      if (a.status === 'DISBANDING' && a.disbandAt !== null && a.disbandAt <= now) disbandNow(a, null);
      if (a.status === 'ACTIVE') checkSuccession(a);
    }
  };
  /** Study 02 §3: a coordinator absent for 14 days loses the role to the oldest active deputy, else the oldest member. */
  const checkSuccession = (a: MockAlliance) => {
    const coordinator = activeMembers(a).find((m) => m.role === 'COORDINATOR');
    if (!coordinator) return;
    const career = careerById(coordinator.careerId);
    const lastSeen = career?.lastSeenAt ?? 0;
    if (engine.now() - lastSeen < knobs().successionDays * DAY) return;
    const others = activeMembers(a).filter((m) => m.id !== coordinator.id);
    if (others.length === 0) return;
    // The successor was active within `successionDays`: the oldest such deputy, else the oldest such member, else the
    // most recently seen member (backend notes §1b).
    const seen = (m: MockMember) => careerById(m.careerId)?.lastSeenAt ?? 0;
    const recent = (m: MockMember) => engine.now() - seen(m) < knobs().successionDays * DAY;
    const byJoin = (x: MockMember, y: MockMember) => (x.joinedAt ?? 0) - (y.joinedAt ?? 0);
    const heir =
      others.filter((m) => m.role === 'DEPUTY' && recent(m)).sort(byJoin)[0] ??
      others.filter(recent).sort(byJoin)[0] ??
      [...others].sort((x, y) => seen(y) - seen(x))[0]!;
    coordinator.role = 'MEMBER';
    heir.role = 'COORDINATOR';
    log(a, 'LEADERSHIP_SUCCEEDED', null, heir.careerId, { previous: coordinator.careerId });
    const heirCareer = careerById(heir.careerId);
    if (heirCareer) {
      notify(
        heirCareer,
        'LEADERSHIP_SUCCEEDED',
        { tag: a.tag, name: a.name, count: knobs().successionDays },
        'members',
      );
      careerUpdated(heirCareer);
    }
    if (career) careerUpdated(career);
    emitAlliance(a.id, 'alliance.member.updated', { member: neutralMember(a, heir), change: 'ROLE' });
    emitAlliance(a.id, 'alliance.member.updated', { member: neutralMember(a, coordinator), change: 'ROLE' });
  };
  const disbandNow = (a: MockAlliance, actor: string | null) => {
    a.status = 'DISBANDED';
    a.disbandAt = null;
    world().reserved.push({
      name: normalizeText(a.name),
      tag: a.tag.toUpperCase(),
      until: engine.now() + 30 * DAY,
    });
    log(a, 'DISBANDED', actor, null);
    for (const m of activeMembers(a)) {
      m.status = 'LEFT';
      m.leftAt = engine.now();
      const career = careerById(m.careerId);
      if (career) {
        if (m.careerId !== actor)
          notify(career, 'ALLIANCE_DISBANDED', { tag: a.tag, name: a.name }, 'overview', 'INFO');
        careerUpdated(career);
      }
    }
    emitAlliance(a.id, 'alliance.updated', { alliance: null, status: 'DISBANDED' });
  };

  /* ── presence (03 §3.4) ── */
  const clientVisible = (): boolean =>
    (engine.state.ext.pushPresence as { visible?: boolean } | undefined)?.visible === true;
  const isCurrent = (career: MockCareer) => {
    const email = engine.state.currentSession?.email;
    return !!email && engine.state.users[email]?.user.activeCareerId === career.summary.id;
  };
  const presenceOf = (career: MockCareer): AlliancePresence => {
    const sim = careerAlliance(career).simulated;
    if (sim) return sim.onDuty && sim.online ? 'ON_DUTY' : sim.online ? 'ONLINE' : 'AWAY';
    if (!isCurrent(career)) return engine.now() - career.lastSeenAt < 3 * 60_000 ? 'ONLINE' : 'AWAY';
    if (clientVisible() && career.summary.onDuty) return 'ON_DUTY';
    return clientVisible() ? 'ONLINE' : 'AWAY';
  };
  const lastSeenOf = (career: MockCareer): AllianceLastSeen => {
    const ago = engine.now() - career.lastSeenAt;
    return ago < DAY ? 'TODAY' : ago < 7 * DAY ? 'THIS_WEEK' : 'EARLIER';
  };
  const profileOf = (userId: string): ProfileSettingsDto =>
    (world().profiles[userId] ??= { showOnDuty: true, acceptDirectInvites: true });
  const profileOfCareer = (career: MockCareer) => profileOf(career.userId);
  const familiesOf = (career: MockCareer) => career.summary.unlockedFamilies;
  const locationOf = (career: MockCareer) =>
    careerAlliance(career).simulated?.city ?? career.summary.locationName;

  /* ── DTOs ── */
  const emblemLocked = (emblem: AllianceEmblemDto, level: number): string | null => {
    const min = (list: { code: string; minLevel: number }[], code: string) =>
      list.find((o) => o.code === code)?.minLevel ?? 1;
    if (min(EMBLEM_OPTIONS.shapes, emblem.shape) > level) return 'shape';
    if (min(EMBLEM_OPTIONS.symbols, emblem.symbol) > level) return 'symbol';
    if (min(EMBLEM_OPTIONS.colors, emblem.primaryColor) > level) return 'primaryColor';
    if (min(EMBLEM_OPTIONS.colors, emblem.secondaryColor) > level) return 'secondaryColor';
    return null;
  };
  const joinBlockFor = (a: MockAlliance, career: MockCareer): AllianceJoinBlock | null => {
    if (!flagOn()) return 'FEATURE_DISABLED';
    if (a.status !== 'ACTIVE') return 'NOT_ACTIVE';
    if (membershipOf(career.summary.id)) return 'ALREADY_IN_ALLIANCE';
    if (a.members.some((m) => m.careerId === career.summary.id && m.status === 'BANNED')) return 'BANNED';
    const cooldown = careerAlliance(career).cooldownUntil;
    if (cooldown !== null && cooldown > engine.now()) return 'ALLIANCE_COOLDOWN';
    if (
      career.summary.level < knobs().joinLevel ||
      (a.minLevel !== null && career.summary.level < a.minLevel)
    )
      return 'LEVEL_TOO_LOW';
    if (pendingRequestOf(career.summary.id, a.id)) return 'REQUEST_PENDING';
    if (activeMembers(a).length >= progressOf(a).memberSlots && a.joinPolicy !== 'REQUEST')
      return 'ALLIANCE_FULL';
    if (a.joinPolicy === 'INVITE' && !pendingInviteFor(career.summary.id, a.id)) return 'INVITE_ONLY';
    return null;
  };
  const pendingRequestOf = (careerId: string, allianceId?: string) =>
    Object.values(world().requests).find(
      (r) =>
        r.careerId === careerId && r.status === 'PENDING' && (!allianceId || r.allianceId === allianceId),
    );
  const pendingInviteFor = (careerId: string, allianceId: string) =>
    Object.values(world().invites).find(
      (i) => i.target === careerId && i.allianceId === allianceId && i.status === 'ACTIVE',
    );
  const cardOf = (a: MockAlliance, viewer: MockCareer | null): AllianceCardDto => ({
    id: a.id,
    name: a.name,
    tag: a.tag,
    emblem: a.emblem,
    description: a.description,
    language: a.language,
    joinPolicy: a.joinPolicy,
    minLevel: a.minLevel,
    level: progressOf(a).level,
    members: activeMembers(a).length,
    memberSlots: progressOf(a).memberSlots,
    status: a.status,
    lastActivityAt: iso(a.lastActivityAt),
    createdAt: iso(a.createdAt),
    frame: progressProvider.frame(a.id),
    ...(viewer
      ? {
          viewer: {
            canJoin: joinBlockFor(a, viewer) === null,
            blockedReason: joinBlockFor(a, viewer),
            pendingRequestId: pendingRequestOf(viewer.summary.id, a.id)?.id ?? null,
            pendingInviteId: pendingInviteFor(viewer.summary.id, a.id)?.id ?? null,
          },
        }
      : {}),
  });
  const memberDto = (a: MockAlliance, m: MockMember, viewerCareerId: string): AllianceMemberDto => {
    const career = careerById(m.careerId);
    const show = career ? profileOfCareer(career).showOnDuty : false;
    const ally = !!memberOf(a, viewerCareerId);
    return {
      id: m.id,
      careerId: m.careerId,
      directorName: career?.summary.directorName ?? 'Direttore eliminato',
      role: m.role,
      status: m.status,
      level: career?.summary.level ?? 1,
      locationName: career ? locationOf(career) : '',
      families: career ? familiesOf(career) : [],
      joinedAt: m.joinedAt === null ? null : iso(m.joinedAt),
      presence: career && ally && show ? presenceOf(career) : null,
      lastSeen: career && ally && show ? lastSeenOf(career) : null,
      inactive: career ? engine.now() - career.lastSeenAt >= knobs().inactiveAfterDays * DAY : false,
      mutedUntil: m.mutedUntil !== null && m.mutedUntil > engine.now() ? iso(m.mutedUntil) : null,
      aid: career
        ? { given: careerAlliance(career).aidGiven, received: careerAlliance(career).aidReceived }
        : { given: 0, received: 0 },
      weeklyPoints: progressProvider.weeklyPoints(m.careerId),
      blocked: viewerCareerId !== m.careerId && hasBlocked(engine, viewerCareerId, m.careerId),
    };
  };
  // Phase 2 wires the read markers (board + chat domains), phase 3 the running operation — like the backend's providers.
  let unreadProvider: (career: MockCareer, a: MockAlliance) => { board: number; chat: number } = () => ({
    board: 0,
    chat: 0,
  });
  let operationProvider: (career: MockCareer, a: MockAlliance) => string | null = () => null;
  let progressProvider: AllianceProgressProvider = {
    weeklyRank: () => null,
    weeklyPoints: () => 0,
    frame: () => null,
  };
  const unreadOf = (career: MockCareer, a: MockAlliance): { board: number; chat: number } =>
    unreadProvider(career, a);
  const myAllianceDto = (a: MockAlliance, career: MockCareer): MyAllianceDto => {
    const me = memberOf(a, career.summary.id)!;
    const members = activeMembers(a);
    const coordinator = members.find((m) => m.role === 'COORDINATOR');
    return {
      ...cardOf(a, career),
      settings: {
        joinPolicy: a.joinPolicy,
        minLevel: a.minLevel,
        language: a.language,
        description: a.description,
        membersCanInvite: a.settings.membersCanInvite,
        notesByHighRolesOnly: a.settings.notesByHighRolesOnly,
      },
      progress: progressOf(a),
      coordinator: ref(coordinator?.careerId ?? null),
      deputies: members.filter((m) => m.role === 'DEPUTY').length,
      me: {
        memberId: me.id,
        role: me.role,
        joinedAt: iso(me.joinedAt ?? a.createdAt),
        mutedUntil: me.mutedUntil !== null && me.mutedUntil > engine.now() ? iso(me.mutedUntil) : null,
        canInvite: isHigh(me.role) || a.settings.membersCanInvite,
        isHighRole: isHigh(me.role),
      },
      disbandAt: a.disbandAt === null ? null : iso(a.disbandAt),
      readOnly: {
        board: a.readOnly.board || knobs().readOnly.board,
        chat: a.readOnly.chat || knobs().readOnly.chat,
      },
      pendingJoinRequests: isHigh(me.role)
        ? Object.values(world().requests).filter((r) => r.allianceId === a.id && r.status === 'PENDING')
            .length
        : 0,
      counts: {
        members: members.length,
        onDuty: members.filter((m) => {
          const c = careerById(m.careerId);
          return c && profileOfCareer(c).showOnDuty && presenceOf(c) === 'ON_DUTY';
        }).length,
        online: members.filter((m) => {
          const c = careerById(m.careerId);
          return c && profileOfCareer(c).showOnDuty && presenceOf(c) !== 'AWAY';
        }).length,
        inactive: members.filter((m) => {
          const c = careerById(m.careerId);
          return c && engine.now() - c.lastSeenAt >= knobs().inactiveAfterDays * DAY;
        }).length,
      },
      unread: unreadOf(career, a),
      operationId: operationProvider(career, a),
      weeklyRank: progressProvider.weeklyRank(a),
      generalChannelId: a.generalChannelId,
    };
  };
  /**
   * `alliance.updated` carries the alliance WITHOUT the viewer's own fields (`me`, `unread`, `viewer`, `weeklyRank`,
   * `pendingJoinRequests`, `counts`, `operationId`, `generalChannelId`) — one event for the whole room (backend notes §1b).
   */
  const neutralDto = (a: MockAlliance): Record<string, unknown> => {
    const members = activeMembers(a);
    const coordinator = members.find((m) => m.role === 'COORDINATOR');
    const { viewer: _viewer, ...card } = cardOf(a, null);
    void _viewer;
    return {
      ...card,
      settings: {
        joinPolicy: a.joinPolicy,
        minLevel: a.minLevel,
        language: a.language,
        description: a.description,
        membersCanInvite: a.settings.membersCanInvite,
        notesByHighRolesOnly: a.settings.notesByHighRolesOnly,
      },
      progress: progressOf(a),
      coordinator: ref(coordinator?.careerId ?? null),
      deputies: members.filter((m) => m.role === 'DEPUTY').length,
      disbandAt: a.disbandAt === null ? null : iso(a.disbandAt),
      readOnly: {
        board: a.readOnly.board || knobs().readOnly.board,
        chat: a.readOnly.chat || knobs().readOnly.chat,
      },
    };
  };
  /** `alliance.member.updated` carries the member as the room sees him: no viewer-specific presence or block flag. */
  const neutralMember = (a: MockAlliance, m: MockMember): AllianceMemberDto => ({
    ...memberDto(a, m, m.careerId),
    presence: null,
    lastSeen: null,
    blocked: false,
  });
  const refOf = (career: MockCareer): AllianceSnapshotDto | null => {
    if (!flagOn()) return null;
    const m = membershipOf(career.summary.id);
    if (!m) return null;
    return {
      id: m.alliance.id,
      name: m.alliance.name,
      tag: m.alliance.tag,
      role: m.member.role,
      unread: unreadOf(career, m.alliance),
      operationId: operationProvider(career, m.alliance),
    };
  };
  const restrictionsOf = (
    career: MockCareer,
    m: { alliance: MockAlliance; member: MockMember } | null,
  ): AllianceRestrictionsDto => {
    const k = knobs();
    const user = userOf(career);
    const rulesAccepted = user ? rulesAcceptedBy(engine, user.user.id) : false;
    const accountAgeOk = user
      ? engine.now() - Date.parse(user.user.createdAt) >= k.accountMinAgeHours * HOUR
      : false;
    const allianceMute = m?.member.mutedUntil ?? null;
    const muted = allianceMute !== null && allianceMute > engine.now();
    const suspended = user?.status === 'SUSPENDED';
    const readOnlyBoth = m
      ? (m.alliance.readOnly.board || k.readOnly.board) && (m.alliance.readOnly.chat || k.readOnly.chat)
      : k.readOnly.board && k.readOnly.chat;
    // Same order as the server (backend notes §1b): flag → suspended → muted → rules → level → account age → read-only.
    const reason: AllianceRestrictionsDto['writeBlockedReason'] = !flagOn()
      ? 'FEATURE_DISABLED'
      : suspended
        ? 'SUSPENDED'
        : muted
          ? 'MUTED'
          : !rulesAccepted
            ? 'RULES_NOT_ACCEPTED'
            : career.summary.level < k.writeMinLevel
              ? 'LEVEL_TOO_LOW'
              : !accountAgeOk
                ? 'ACCOUNT_TOO_NEW'
                : readOnlyBoth
                  ? 'READ_ONLY'
                  : null;
    return {
      rulesAccepted,
      level: career.summary.level,
      writeMinLevel: k.writeMinLevel,
      accountAgeOk,
      mutedUntil: muted ? iso(allianceMute) : null,
      muteScope: muted ? 'ALLIANCE' : null,
      suspended,
      canWriteText: reason === null,
      canUseQuick: !suspended && flagOn(),
      writeBlockedReason: reason,
    };
  };
  const configDto = (): AllianceConfigDto => {
    const k = knobs();
    const f = engine.state.featureFlags;
    return {
      flags: {
        alliances: f.alliances === true,
        board: f.alliance_board === true,
        chat: f.alliance_chat === true,
        aid: f.alliance_aid === true,
        objectives: f.alliance_objectives === true,
        ranking: f.alliance_ranking === true,
        operations: f.alliance_operations === true,
      },
      foundLevel: k.foundLevel,
      foundCost: String(k.foundCost),
      joinLevel: k.joinLevel,
      writeMinLevel: k.writeMinLevel,
      accountMinAgeHours: k.accountMinAgeHours,
      cooldownHours: k.cooldownHours,
      disbandNoticeHours: k.disbandNoticeHours,
      successionDays: k.successionDays,
      inviteTtlDays: k.inviteTtlDays,
      requestTtlDays: k.requestTtlDays,
      nameChangeCooldownDays: k.nameChangeCooldownDays,
      inactiveAfterDays: k.inactiveAfterDays,
      levels: ALLIANCE_LEVELS,
      emblem: EMBLEM_OPTIONS,
      board: BOARD_CFG,
      chat: CHAT_CFG,
      aid: AID_CFG,
      readOnly: k.readOnly,
    };
  };
  const inviteDto = (i: MockInvite): AllianceInviteDto => ({
    id: i.id,
    code: i.code,
    createdBy: ref(i.createdBy),
    target: i.target ? ref(i.target) : null,
    status: i.status,
    createdAt: iso(i.createdAt),
    expiresAt: iso(i.expiresAt),
    uses: i.uses,
  });
  const receivedInviteDto = (i: MockInvite, viewer: MockCareer): AllianceInviteReceivedDto => ({
    id: i.id,
    alliance: cardOf(world().alliances[i.allianceId]!, viewer),
    invitedBy: ref(i.createdBy),
    createdAt: iso(i.createdAt),
    expiresAt: iso(i.expiresAt),
  });
  const requestDto = (r: MockJoinRequest): AllianceJoinRequestDto => {
    const career = careerById(r.careerId);
    return {
      id: r.id,
      careerId: r.careerId,
      directorName: career?.summary.directorName ?? 'Direttore eliminato',
      level: career?.summary.level ?? 1,
      locationName: career ? locationOf(career) : '',
      families: career ? familiesOf(career) : [],
      status: r.status,
      createdAt: iso(r.createdAt),
      expiresAt: iso(r.expiresAt),
      decidedBy: r.decidedBy ? ref(r.decidedBy) : null,
      decidedAt: r.decidedAt === null ? null : iso(r.decidedAt),
    };
  };
  const myRequestDto = (r: MockJoinRequest, viewer: MockCareer): MyAllianceJoinRequestDto => ({
    id: r.id,
    alliance: cardOf(world().alliances[r.allianceId]!, viewer),
    status: r.status,
    createdAt: iso(r.createdAt),
    expiresAt: iso(r.expiresAt),
  });

  /* ───────────────────────────── reads ───────────────────────────── */

  const home = (career: MockCareer): AllianceHomeDto => {
    expireStale();
    const m = flagOn() ? membershipOf(career.summary.id) : null;
    const cooldown = careerAlliance(career).cooldownUntil;
    return {
      alliance: m ? myAllianceDto(m.alliance, career) : null,
      invites: flagOn()
        ? Object.values(world().invites)
            .filter(
              (i) =>
                i.target === career.summary.id &&
                i.status === 'ACTIVE' &&
                world().alliances[i.allianceId]?.status === 'ACTIVE',
            )
            .map((i) => receivedInviteDto(i, career))
        : [],
      joinRequests: flagOn()
        ? Object.values(world().requests)
            .filter((r) => r.careerId === career.summary.id && r.status === 'PENDING')
            .map((r) => myRequestDto(r, career))
        : [],
      cooldownUntil: cooldown !== null && cooldown > engine.now() ? iso(cooldown) : null,
      restrictions: restrictionsOf(career, m),
      config: configDto(),
    };
  };
  const search = (
    career: MockCareer,
    q: {
      q?: string;
      language?: string;
      joinPolicy?: string;
      hasSlots?: boolean;
      cursor?: string;
      limit?: number;
    },
  ): { data: AllianceCardDto[]; nextCursor: string | null; hasMore: boolean } => {
    expireStale();
    if (!flagOn() || career.summary.level < knobs().joinLevel)
      return { data: [], nextCursor: null, hasMore: false };
    const needle = q.q ? normalizeText(q.q) : '';
    const rows = Object.values(world().alliances)
      .filter((a) => a.status === 'ACTIVE' || a.status === 'DISBANDING')
      .filter(
        (a) => !needle || normalizeText(a.name).startsWith(needle) || a.tag.toLowerCase().startsWith(needle),
      )
      .filter((a) => !q.language || a.language === q.language)
      .filter((a) => !q.joinPolicy || a.joinPolicy === q.joinPolicy)
      .filter((a) => !q.hasSlots || activeMembers(a).length < progressOf(a).memberSlots)
      .sort((x, y) => y.lastActivityAt - x.lastActivityAt);
    const start = Number(q.cursor ?? 0) || 0;
    const limit = Math.min(50, q.limit ?? 20);
    const page = rows.slice(start, start + limit);
    const hasMore = start + limit < rows.length;
    return {
      data: page.map((a) => cardOf(a, career)),
      nextCursor: hasMore ? String(start + limit) : null,
      hasMore,
    };
  };
  const card = (career: MockCareer, allianceId: string): AllianceCardDto => {
    expireStale();
    const a = world().alliances[allianceId];
    if (!a || !flagOn() || a.status === 'DISBANDED' || a.status === 'CLOSED')
      throw new MockError(404, 'NOT_FOUND', 'Alliance not found');
    return cardOf(a, career);
  };
  const publicInvite = (code: string): PublicAllianceInviteDto => {
    expireStale();
    const i = Object.values(world().invites).find((x) => x.code?.toUpperCase() === code.toUpperCase());
    const a = i ? world().alliances[i.allianceId] : undefined;
    if (!i || !a || i.status !== 'ACTIVE' || a.status !== 'ACTIVE' || !flagOn())
      return { valid: false, alliance: null, invitedBy: null, expiresAt: null };
    const p = progressOf(a);
    return {
      valid: true,
      alliance: {
        id: a.id,
        name: a.name,
        tag: a.tag,
        emblem: a.emblem,
        level: p.level,
        members: activeMembers(a).length,
        memberSlots: p.memberSlots,
        language: a.language,
        description: a.description,
      },
      invitedBy: nameOf(i.createdBy),
      expiresAt: iso(i.expiresAt),
    };
  };
  const members = (career: MockCareer, status?: string): AllianceMemberDto[] => {
    expireStale();
    const { alliance, member } = requireMembership(career);
    if (status === 'BANNED') {
      requireRole(member, 'DEPUTY');
      return alliance.members
        .filter((m) => m.status === 'BANNED')
        .map((m) => memberDto(alliance, m, career.summary.id));
    }
    const rank: Record<AllianceMemberRole, number> = { COORDINATOR: 0, DEPUTY: 1, MEMBER: 2 };
    return activeMembers(alliance)
      .sort((x, y) => rank[x.role] - rank[y.role] || (x.joinedAt ?? 0) - (y.joinedAt ?? 0))
      .map((m) => memberDto(alliance, m, career.summary.id));
  };
  const logOf = (career: MockCareer, cursor?: string, limit = 50) => {
    const { alliance, member } = requireMembership(career);
    requireRole(member, 'DEPUTY');
    const start = Number(cursor ?? 0) || 0;
    const page = alliance.log.slice(start, start + limit);
    const hasMore = start + limit < alliance.log.length;
    return { data: page, nextCursor: hasMore ? String(start + limit) : null, hasMore };
  };
  const invites = (career: MockCareer): AllianceInviteDto[] => {
    expireStale();
    const { alliance, member } = requireMembership(career);
    return Object.values(world().invites)
      .filter(
        (i) => i.allianceId === alliance.id && (isHigh(member.role) || i.createdBy === career.summary.id),
      )
      .sort((x, y) => y.createdAt - x.createdAt)
      .map(inviteDto);
  };
  const joinRequests = (career: MockCareer): AllianceJoinRequestDto[] => {
    expireStale();
    const { alliance, member } = requireMembership(career);
    requireRole(member, 'DEPUTY');
    return Object.values(world().requests)
      .filter((r) => r.allianceId === alliance.id && r.status === 'PENDING')
      .sort((x, y) => x.createdAt - y.createdAt)
      .map(requestDto);
  };
  const sync = (career: MockCareer, since?: number): AllianceSyncDelta => {
    const m = flagOn() ? membershipOf(career.summary.id) : null;
    if (!m) return { seq: 0, events: [], resyncRequired: false };
    const seq = world().seq[m.alliance.id] ?? 0;
    if (since === undefined) return { seq, events: [], resyncRequired: false };
    const box = world().outbox[m.alliance.id] ?? [];
    const missed = box.filter((e) => e.seq > since);
    const replayable = since <= seq && missed.length === seq - since;
    return replayable
      ? { seq, events: missed, resyncRequired: false }
      : { seq, events: [], resyncRequired: true };
  };
  const directorCard = (viewer: MockCareer, careerId: string): DirectorCardDto => {
    const target = careerById(careerId);
    if (!target) throw new MockError(404, 'NOT_FOUND', 'Director not found');
    const m = membershipOf(careerId);
    const mine = membershipOf(viewer.summary.id);
    const isMe = viewer.summary.id === careerId;
    const isAlly = !!m && !!mine && m.alliance.id === mine.alliance.id;
    const profile = profileOfCareer(target);
    const show = (isAlly || isMe) && profile.showOnDuty;
    const blocked = isBlockedEither(engine, viewer.summary.id, careerId);
    // The major domain owns `career.ext.major`: read defensively, the shape may differ or be missing.
    const rawTrophies = (target.ext.major as { trophies?: unknown } | undefined)?.trophies;
    const trophies = Array.isArray(rawTrophies) ? (rawTrophies as { medal?: string }[]) : [];
    const medal = (kind: string) => trophies.filter((t) => t.medal === kind).length;
    return {
      careerId,
      directorName: target.summary.directorName,
      level: target.summary.level,
      locationName: locationOf(target),
      families: familiesOf(target),
      alliance: m
        ? {
            id: m.alliance.id,
            name: m.alliance.name,
            tag: m.alliance.tag,
            emblem: m.alliance.emblem,
            role: m.member.role,
          }
        : null,
      memberSince: m?.member.joinedAt ? iso(m.member.joinedAt) : null,
      aid: { given: careerAlliance(target).aidGiven, received: careerAlliance(target).aidReceived },
      medals: { gold: medal('GOLD'), silver: medal('SILVER'), bronze: medal('BRONZE') },
      presence: show ? presenceOf(target) : null,
      lastSeen: show ? lastSeenOf(target) : null,
      reliability: careerAlliance(target).aidGiven,
      isMe,
      isAlly,
      blocked:
        !isMe &&
        isBlockedEither(engine, viewer.summary.id, careerId) &&
        !isBlockedEither(engine, careerId, viewer.summary.id)
          ? true
          : !isMe && blocked,
      canInvite: !isMe && !m && profile.acceptDirectInvites && !blocked,
    };
  };
  /** Mock-only `GET /directors?q=` (the backend has no search yet — see the notes): registered players by name prefix. */
  const searchDirectors = (viewer: MockCareer, q: string): DirectorCardDto[] => {
    const needle = normalizeText(q);
    if (needle.length < 2) return [];
    return Object.values(engine.state.careers)
      .filter(
        (c) => c.summary.id !== viewer.summary.id && normalizeText(c.summary.directorName).startsWith(needle),
      )
      .slice(0, 10)
      .map((c) => directorCard(viewer, c.summary.id));
  };

  /* ───────────────────────────── commands ───────────────────────────── */

  const assertUniqueName = (name: string, tag: string, except?: string) => {
    const n = normalizeText(name);
    const t = tag.toUpperCase();
    const w = world();
    for (const a of Object.values(w.alliances)) {
      if (a.id === except || a.status === 'DISBANDED' || a.status === 'CLOSED') continue;
      if (normalizeText(a.name) === n)
        throw new MockError(409, 'CONFLICT', 'Alliance name taken', { reason: 'NAME_TAKEN' });
      if (a.tag === t) throw new MockError(409, 'CONFLICT', 'Alliance tag taken', { reason: 'TAG_TAKEN' });
    }
    for (const r of w.reserved) {
      if (r.name === n)
        throw new MockError(409, 'CONFLICT', 'Alliance name reserved', { reason: 'NAME_TAKEN' });
      if (r.tag === t) throw new MockError(409, 'CONFLICT', 'Alliance tag reserved', { reason: 'TAG_TAKEN' });
    }
  };
  const addMember = (
    a: MockAlliance,
    career: MockCareer,
    role: AllianceMemberRole,
    via: string,
    actor: string | null,
  ) => {
    const existing = a.members.find((m) => m.careerId === career.summary.id);
    const member: MockMember = existing ?? {
      id: engine.id('alm'),
      careerId: career.summary.id,
      role,
      status: 'ACTIVE',
      joinedAt: engine.now(),
      leftAt: null,
      mutedUntil: null,
    };
    if (existing)
      Object.assign(existing, {
        role,
        status: 'ACTIVE',
        joinedAt: engine.now(),
        leftAt: null,
        mutedUntil: null,
      });
    else a.members.push(member);
    // Pending requests elsewhere and direct invites to this career are settled: one alliance per career.
    for (const r of Object.values(world().requests))
      if (r.careerId === career.summary.id && r.status === 'PENDING') r.status = 'WITHDRAWN';
    for (const i of Object.values(world().invites))
      if (i.target === career.summary.id && i.status === 'ACTIVE')
        i.status = i.allianceId === a.id ? 'ACCEPTED' : 'DECLINED';
    log(a, 'MEMBER_JOINED', actor, career.summary.id, { via });
    touchAlliance(a);
    emitAlliance(a.id, 'alliance.member.updated', { member: neutralMember(a, member), change: 'JOINED' });
    emitAlliance(a.id, 'alliance.updated', { alliance: neutralDto(a) });
    careerUpdated(career);
    return member;
  };

  const found = (career: MockCareer, raw: unknown): MyAllianceDto => {
    requireCommandAllowed(career);
    expireStale();
    const k = knobs();
    const parsed = FoundAllianceBody.safeParse(raw);
    if (!parsed.success)
      throw new MockError(422, 'VALIDATION_ERROR', 'Invalid alliance', {
        issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    const body = parsed.data;
    if (career.summary.level < k.foundLevel)
      throw new MockError(403, 'LEVEL_TOO_LOW', 'Level too low', { required: k.foundLevel });
    if (membershipOf(career.summary.id))
      throw new MockError(409, 'ALREADY_IN_ALLIANCE', 'Already in an alliance');
    const cooldown = careerAlliance(career).cooldownUntil;
    if (cooldown !== null && cooldown > engine.now())
      throw new MockError(429, 'ALLIANCE_COOLDOWN', 'Cooldown', { until: iso(cooldown) });
    assertText(body.name);
    assertText(body.description ?? '');
    assertUniqueName(body.name, body.tag);
    const locked = emblemLocked(body.emblem, 1);
    if (locked)
      throw new MockError(422, 'VALIDATION_ERROR', 'Emblem option locked', {
        reason: 'EMBLEM_LOCKED',
        field: locked,
      });
    if (k.foundCost > 0) {
      if (BigInt(career.summary.credits) < BigInt(k.foundCost))
        throw new MockError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits', {
          required: String(k.foundCost),
        });
      engine.credit(career, -k.foundCost, 'ALLIANCE_FOUNDATION');
    }
    const a: MockAlliance = {
      id: engine.id('all'),
      name: body.name,
      tag: body.tag.toUpperCase(),
      emblem: body.emblem,
      description: body.description ?? '',
      language: body.language,
      joinPolicy: body.joinPolicy,
      minLevel: body.minLevel ?? null,
      status: 'ACTIVE',
      createdAt: engine.now(),
      lastActivityAt: engine.now(),
      xp: 0,
      settings: { membersCanInvite: true, notesByHighRolesOnly: false },
      members: [],
      log: [],
      disbandAt: null,
      readOnly: { board: false, chat: false },
      nameChangedAt: null,
      generalChannelId: engine.id('alc'),
    };
    world().alliances[a.id] = a;
    log(a, 'FOUNDED', career.summary.id, null, { name: a.name, tag: a.tag });
    addMember(a, career, 'COORDINATOR', 'FOUNDED', career.summary.id);
    engine.save();
    return myAllianceDto(a, career);
  };

  const join = (career: MockCareer, raw: unknown): JoinAllianceResult => {
    requireCommandAllowed(career);
    expireStale();
    const parsed = JoinAllianceBody.safeParse(raw);
    if (!parsed.success)
      throw new MockError(422, 'VALIDATION_ERROR', 'exactly one of allianceId, inviteCode, inviteId');
    const body = parsed.data;
    const k = knobs();
    let invite: MockInvite | undefined;
    if (body.inviteCode) {
      invite = Object.values(world().invites).find(
        (i) => i.code?.toUpperCase() === body.inviteCode!.toUpperCase(),
      );
      if (!invite || invite.status !== 'ACTIVE') throw new MockError(404, 'NOT_FOUND', 'Invite not found');
    } else if (body.inviteId) {
      invite = world().invites[body.inviteId];
      if (!invite || invite.status !== 'ACTIVE' || invite.target !== career.summary.id)
        throw new MockError(404, 'NOT_FOUND', 'Invite not found');
    }
    const a = world().alliances[invite ? invite.allianceId : body.allianceId!];
    if (!a || a.status === 'DISBANDED' || a.status === 'CLOSED')
      throw new MockError(404, 'NOT_FOUND', 'Alliance not found');
    if (a.status !== 'ACTIVE')
      throw new MockError(409, 'CONFLICT', 'Alliance is disbanding', { reason: 'ALLIANCE_NOT_ACTIVE' });
    if (membershipOf(career.summary.id))
      throw new MockError(409, 'ALREADY_IN_ALLIANCE', 'Already in an alliance');
    if (a.members.some((m) => m.careerId === career.summary.id && m.status === 'BANNED'))
      throw new MockError(403, 'FORBIDDEN', 'Banned from this alliance', { reason: 'BANNED' });
    const cooldown = careerAlliance(career).cooldownUntil;
    if (cooldown !== null && cooldown > engine.now())
      throw new MockError(429, 'ALLIANCE_COOLDOWN', 'Cooldown', { until: iso(cooldown) });
    if (career.summary.level < k.joinLevel || (a.minLevel !== null && career.summary.level < a.minLevel))
      throw new MockError(403, 'LEVEL_TOO_LOW', 'Level too low', {
        required: Math.max(k.joinLevel, a.minLevel ?? 0),
      });
    const full = activeMembers(a).length >= progressOf(a).memberSlots;
    if (!invite && a.joinPolicy === 'INVITE')
      throw new MockError(403, 'FORBIDDEN', 'Invite required', { reason: 'INVITE_REQUIRED' });
    if (!invite && a.joinPolicy === 'REQUEST') {
      const existing = pendingRequestOf(career.summary.id, a.id);
      if (existing)
        return { outcome: 'REQUESTED', alliance: null, joinRequest: myRequestDto(existing, career) };
      if (pendingRequestOf(career.summary.id))
        throw new MockError(409, 'CONFLICT', 'A join request is already pending', {
          reason: 'REQUEST_PENDING',
        });
      const request: MockJoinRequest = {
        id: engine.id('alj'),
        allianceId: a.id,
        careerId: career.summary.id,
        status: 'PENDING',
        createdAt: engine.now(),
        expiresAt: engine.now() + k.requestTtlDays * DAY,
        decidedBy: null,
        decidedAt: null,
      };
      world().requests[request.id] = request;
      for (const m of activeMembers(a).filter((x) => isHigh(x.role))) {
        const c = careerById(m.careerId);
        if (c)
          notify(
            c,
            'JOIN_REQUEST',
            { director: career.summary.directorName, tag: a.tag, name: a.name },
            'members',
          );
      }
      emitAlliance(a.id, 'alliance.updated', { alliance: null, joinRequests: 1 });
      engine.save();
      return { outcome: 'REQUESTED', alliance: null, joinRequest: myRequestDto(request, career) };
    }
    if (full)
      throw new MockError(409, 'ALLIANCE_FULL', 'No free slot', {
        members: activeMembers(a).length,
        slots: progressOf(a).memberSlots,
      });
    if (invite) {
      invite.uses += 1;
      if (invite.target) invite.status = 'ACCEPTED';
    }
    addMember(
      a,
      career,
      'MEMBER',
      invite ? (invite.target ? 'DIRECT_INVITE' : 'INVITE_LINK') : 'OPEN',
      invite?.createdBy ?? null,
    );
    engine.save();
    return { outcome: 'JOINED', alliance: myAllianceDto(a, career), joinRequest: null };
  };

  const leave = (career: MockCareer): LeaveAllianceResult => {
    requireCommandAllowed(career);
    const { alliance: a, member } = requireMembership(career);
    const others = activeMembers(a).filter((m) => m.id !== member.id);
    if (member.role === 'COORDINATOR' && others.length > 0)
      throw new MockError(409, 'CONFLICT', 'Transfer the leadership first', { reason: 'TRANSFER_FIRST' });
    member.status = 'LEFT';
    member.leftAt = engine.now();
    const cooldownUntil = engine.now() + knobs().cooldownHours * HOUR;
    careerAlliance(career).cooldownUntil = cooldownUntil;
    log(a, 'MEMBER_LEFT', career.summary.id, career.summary.id);
    if (others.length === 0) disbandNow(a, career.summary.id);
    else emitAlliance(a.id, 'alliance.member.updated', { member: neutralMember(a, member), change: 'LEFT' });
    careerUpdated(career);
    engine.save();
    return { cooldownUntil: iso(cooldownUntil) };
  };

  const updateSettings = (career: MockCareer, raw: unknown): MyAllianceDto => {
    requireCommandAllowed(career);
    const { alliance: a, member } = requireMembership(career);
    requireRole(member, 'COORDINATOR');
    const parsed = UpdateAllianceSettingsBody.safeParse(raw);
    if (!parsed.success)
      throw new MockError(422, 'VALIDATION_ERROR', 'Invalid settings', {
        issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    const body = parsed.data;
    const k = knobs();
    const renaming =
      (body.name !== undefined && normalizeText(body.name) !== normalizeText(a.name)) ||
      (body.tag !== undefined && body.tag.toUpperCase() !== a.tag);
    if (renaming) {
      if (a.nameChangedAt !== null && engine.now() - a.nameChangedAt < k.nameChangeCooldownDays * DAY)
        throw new MockError(429, 'NAME_CHANGE_COOLDOWN', 'Name changed recently', {
          until: iso(a.nameChangedAt + k.nameChangeCooldownDays * DAY),
        });
      if (body.name !== undefined) assertText(body.name);
      assertUniqueName(body.name ?? a.name, body.tag ?? a.tag, a.id);
    }
    if (body.description !== undefined) assertText(body.description);
    if (body.emblem) {
      const locked = emblemLocked(body.emblem, progressOf(a).level);
      if (locked)
        throw new MockError(422, 'VALIDATION_ERROR', 'Emblem option locked', {
          reason: 'EMBLEM_LOCKED',
          field: locked,
        });
    }
    const changed: string[] = [];
    const set = <K extends keyof MockAlliance>(key: K, value: MockAlliance[K] | undefined) => {
      if (value !== undefined && JSON.stringify(value) !== JSON.stringify(a[key])) {
        a[key] = value;
        changed.push(String(key));
      }
    };
    set('name', body.name);
    set('tag', body.tag?.toUpperCase());
    set('emblem', body.emblem);
    set('description', body.description);
    set('language', body.language);
    set('joinPolicy', body.joinPolicy);
    if (body.minLevel !== undefined) set('minLevel', body.minLevel);
    if (body.membersCanInvite !== undefined && body.membersCanInvite !== a.settings.membersCanInvite) {
      a.settings.membersCanInvite = body.membersCanInvite;
      changed.push('membersCanInvite');
    }
    if (
      body.notesByHighRolesOnly !== undefined &&
      body.notesByHighRolesOnly !== a.settings.notesByHighRolesOnly
    ) {
      a.settings.notesByHighRolesOnly = body.notesByHighRolesOnly;
      changed.push('notesByHighRolesOnly');
    }
    if (renaming && (changed.includes('name') || changed.includes('tag'))) a.nameChangedAt = engine.now();
    for (const field of changed) log(a, 'SETTINGS_CHANGED', career.summary.id, null, { field });
    if (changed.length) {
      emitAlliance(a.id, 'alliance.updated', { alliance: neutralDto(a) });
      if (changed.includes('name') || changed.includes('tag'))
        for (const m of activeMembers(a)) {
          const c = careerById(m.careerId);
          if (c) careerUpdated(c);
        }
    }
    engine.save();
    return myAllianceDto(a, career);
  };

  const transfer = (career: MockCareer, memberId: string): MyAllianceDto => {
    requireCommandAllowed(career);
    const { alliance: a, member: me } = requireMembership(career);
    requireRole(me, 'COORDINATOR');
    const target = activeMembers(a).find((m) => m.id === memberId);
    if (!target) throw new MockError(404, 'NOT_FOUND', 'Member not found');
    if (target.id === me.id)
      throw new MockError(409, 'CONFLICT', 'Already the coordinator', { reason: 'SELF' });
    target.role = 'COORDINATOR';
    const deputies = activeMembers(a).filter((m) => m.role === 'DEPUTY').length;
    me.role = deputies < progressOf(a).deputySlots ? 'DEPUTY' : 'MEMBER';
    log(a, 'LEADERSHIP_TRANSFERRED', career.summary.id, target.careerId);
    const targetCareer = careerById(target.careerId);
    if (targetCareer) {
      notify(
        targetCareer,
        'LEADERSHIP_TRANSFERRED',
        { director: career.summary.directorName, tag: a.tag, name: a.name },
        'members',
      );
      careerUpdated(targetCareer);
    }
    careerUpdated(career);
    emitAlliance(a.id, 'alliance.member.updated', { member: neutralMember(a, target), change: 'ROLE' });
    emitAlliance(a.id, 'alliance.member.updated', { member: neutralMember(a, me), change: 'ROLE' });
    emitAlliance(a.id, 'alliance.updated', { alliance: neutralDto(a) });
    engine.save();
    return myAllianceDto(a, career);
  };

  const disband = (career: MockCareer): MyAllianceDto => {
    requireCommandAllowed(career);
    const { alliance: a, member: me } = requireMembership(career);
    requireRole(me, 'COORDINATOR');
    if (a.status === 'DISBANDING')
      throw new MockError(409, 'CONFLICT', 'Already disbanding', { reason: 'ALREADY_DISBANDING' });
    if (activeMembers(a).length === 1) {
      const dto = myAllianceDto(a, career);
      me.status = 'LEFT';
      me.leftAt = engine.now();
      disbandNow(a, career.summary.id);
      careerUpdated(career);
      engine.save();
      return { ...dto, status: 'DISBANDED' };
    }
    a.status = 'DISBANDING';
    a.disbandAt = engine.now() + knobs().disbandNoticeHours * HOUR;
    engine.schedule(career, 'ALLIANCE_DISBAND', knobs().disbandNoticeHours * 3600, a.id);
    log(a, 'DISBAND_SCHEDULED', career.summary.id, null, { at: iso(a.disbandAt) });
    for (const m of activeMembers(a)) {
      const c = careerById(m.careerId);
      if (c && m.id !== me.id)
        notify(
          c,
          'DISBAND_SCHEDULED',
          { tag: a.tag, name: a.name, count: knobs().disbandNoticeHours },
          'overview',
        );
    }
    emitAlliance(a.id, 'alliance.updated', { alliance: neutralDto(a) });
    engine.save();
    return myAllianceDto(a, career);
  };
  const cancelDisband = (career: MockCareer): MyAllianceDto => {
    requireCommandAllowed(career);
    const { alliance: a, member: me } = requireMembership(career);
    requireRole(me, 'COORDINATOR');
    if (a.status !== 'DISBANDING')
      throw new MockError(409, 'CONFLICT', 'Not disbanding', { reason: 'NOT_DISBANDING' });
    a.status = 'ACTIVE';
    a.disbandAt = null;
    career.actions = career.actions.filter((x) => !(x.type === 'ALLIANCE_DISBAND' && x.ref === a.id));
    log(a, 'DISBAND_CANCELLED', career.summary.id, null);
    for (const m of activeMembers(a)) {
      const c = careerById(m.careerId);
      if (c && m.id !== me.id)
        notify(c, 'DISBAND_CANCELLED', { tag: a.tag, name: a.name }, 'overview', 'INFO');
    }
    emitAlliance(a.id, 'alliance.updated', { alliance: neutralDto(a) });
    engine.save();
    return myAllianceDto(a, career);
  };

  const targetMember = (a: MockAlliance, me: MockMember, memberId: string) => {
    const target = activeMembers(a).find((m) => m.id === memberId);
    if (!target) throw new MockError(404, 'NOT_FOUND', 'Member not found');
    if (target.id === me.id) throw new MockError(409, 'CONFLICT', 'Not on yourself', { reason: 'SELF' });
    if (target.role === 'COORDINATOR')
      throw new MockError(409, 'CONFLICT', 'Not on the coordinator', { reason: 'COORDINATOR' });
    if (!canActOn(me.role, target.role))
      throw new MockError(403, 'ROLE_REQUIRED', 'Role required', { role: 'COORDINATOR' });
    return target;
  };
  const setRole = (career: MockCareer, memberId: string, role: unknown): AllianceMemberDto => {
    requireCommandAllowed(career);
    const { alliance: a, member: me } = requireMembership(career);
    requireRole(me, 'COORDINATOR');
    if (role !== 'DEPUTY' && role !== 'MEMBER')
      throw new MockError(422, 'VALIDATION_ERROR', 'role must be DEPUTY or MEMBER');
    const target = targetMember(a, me, memberId);
    if (role === 'DEPUTY' && target.role !== 'DEPUTY') {
      const deputies = activeMembers(a).filter((m) => m.role === 'DEPUTY').length;
      if (deputies >= progressOf(a).deputySlots)
        throw new MockError(409, 'CONFLICT', 'No deputy slot left', {
          reason: 'DEPUTY_SLOTS_FULL',
          slots: progressOf(a).deputySlots,
        });
    }
    if (target.role !== role) {
      target.role = role;
      log(a, 'ROLE_CHANGED', career.summary.id, target.careerId, { role });
      const c = careerById(target.careerId);
      if (c) {
        notify(
          c,
          role === 'DEPUTY' ? 'ROLE_DEPUTY' : 'ROLE_MEMBER',
          { tag: a.tag, name: a.name },
          'members',
          'INFO',
        );
        careerUpdated(c);
      }
      emitAlliance(a.id, 'alliance.member.updated', { member: neutralMember(a, target), change: 'ROLE' });
      emitAlliance(a.id, 'alliance.updated', { alliance: neutralDto(a) });
      engine.save();
    }
    return memberDto(a, target, career.summary.id);
  };
  const removeMember = (career: MockCareer, memberId: string, ban: boolean): void => {
    requireCommandAllowed(career);
    const { alliance: a, member: me } = requireMembership(career);
    requireRole(me, 'DEPUTY');
    const target = targetMember(a, me, memberId);
    target.status = ban ? 'BANNED' : 'REMOVED';
    target.leftAt = engine.now();
    const c = careerById(target.careerId);
    if (c) {
      careerAlliance(c).cooldownUntil = engine.now() + knobs().cooldownHours * HOUR;
      notify(c, ban ? 'MEMBER_BANNED' : 'MEMBER_REMOVED', { tag: a.tag, name: a.name }, 'overview');
    }
    log(a, ban ? 'MEMBER_BANNED' : 'MEMBER_REMOVED', career.summary.id, target.careerId);
    emitAlliance(a.id, 'alliance.member.updated', {
      member: neutralMember(a, target),
      change: ban ? 'BANNED' : 'REMOVED',
    });
    emitAlliance(a.id, 'alliance.updated', { alliance: neutralDto(a) });
    if (c) careerUpdated(c);
    engine.save();
  };
  const mute = (career: MockCareer, memberId: string, duration: unknown): AllianceMemberDto => {
    requireCommandAllowed(career);
    const { alliance: a, member: me } = requireMembership(career);
    requireRole(me, 'DEPUTY');
    if (duration !== 'H1' && duration !== 'H24' && duration !== 'D7')
      throw new MockError(422, 'VALIDATION_ERROR', 'duration must be H1, H24 or D7');
    const target = targetMember(a, me, memberId);
    target.mutedUntil = engine.now() + MUTE_MS[duration];
    log(a, 'MEMBER_MUTED', career.summary.id, target.careerId, { duration });
    const c = careerById(target.careerId);
    if (c)
      notify(
        c,
        'MEMBER_MUTED',
        { tag: a.tag, name: a.name, count: Math.round(MUTE_MS[duration] / HOUR) },
        'chat',
      );
    emitAlliance(a.id, 'alliance.member.updated', { member: neutralMember(a, target), change: 'MUTED' });
    engine.save();
    return memberDto(a, target, career.summary.id);
  };
  const unmute = (career: MockCareer, memberId: string): AllianceMemberDto => {
    requireCommandAllowed(career);
    const { alliance: a, member: me } = requireMembership(career);
    requireRole(me, 'DEPUTY');
    const target = targetMember(a, me, memberId);
    if (target.mutedUntil !== null) {
      target.mutedUntil = null;
      log(a, 'MEMBER_UNMUTED', career.summary.id, target.careerId);
      emitAlliance(a.id, 'alliance.member.updated', { member: neutralMember(a, target), change: 'UNMUTED' });
      engine.save();
    }
    return memberDto(a, target, career.summary.id);
  };

  const createInvite = (career: MockCareer, targetCareerId?: string): AllianceInviteDto => {
    requireCommandAllowed(career);
    expireStale();
    const { alliance: a, member: me } = requireMembership(career);
    if (!isHigh(me.role) && !a.settings.membersCanInvite)
      throw new MockError(403, 'ROLE_REQUIRED', 'Members may not invite', { role: 'DEPUTY' });
    if (a.status !== 'ACTIVE')
      throw new MockError(409, 'CONFLICT', 'Alliance is disbanding', { reason: 'ALLIANCE_NOT_ACTIVE' });
    const k = knobs();
    if (targetCareerId) {
      const target = careerById(targetCareerId);
      if (!target) throw new MockError(404, 'NOT_FOUND', 'Director not found');
      if (isBlockedEither(engine, career.summary.id, targetCareerId))
        throw new MockError(403, 'BLOCKED', 'Blocked');
      if (!profileOfCareer(target).acceptDirectInvites)
        throw new MockError(403, 'FORBIDDEN', 'Direct invites disabled', { reason: 'DIRECT_INVITES_OFF' });
      if (membershipOf(targetCareerId))
        throw new MockError(409, 'ALREADY_IN_ALLIANCE', 'Already in an alliance');
      if (a.members.some((m) => m.careerId === targetCareerId && m.status === 'BANNED'))
        throw new MockError(403, 'FORBIDDEN', 'Banned', { reason: 'BANNED' });
      const existing = pendingInviteFor(targetCareerId, a.id);
      if (existing) return inviteDto(existing);
    }
    const invite: MockInvite = {
      id: engine.id('ali'),
      allianceId: a.id,
      code: targetCareerId ? null : inviteCode(engine.random),
      createdBy: career.summary.id,
      target: targetCareerId ?? null,
      status: 'ACTIVE',
      createdAt: engine.now(),
      expiresAt: engine.now() + k.inviteTtlDays * DAY,
      uses: 0,
    };
    world().invites[invite.id] = invite;
    engine.schedule(career, 'ALLIANCE_INVITE_EXPIRE', k.inviteTtlDays * 86_400, invite.id);
    log(a, 'MEMBER_INVITED', career.summary.id, targetCareerId ?? null, {
      kind: targetCareerId ? 'DIRECT' : 'LINK',
    });
    if (targetCareerId) {
      const target = careerById(targetCareerId);
      if (target) {
        notify(
          target,
          'INVITE_RECEIVED',
          { director: career.summary.directorName, tag: a.tag, name: a.name },
          'overview',
        );
        careerUpdated(target);
      }
    }
    engine.save();
    return inviteDto(invite);
  };
  /** `DELETE …/invites/:id`: the recipient declines a direct invite; a member (creator or high role) revokes one. */
  const deleteInvite = (career: MockCareer, inviteId: string): void => {
    requireCommandAllowed(career);
    const invite = world().invites[inviteId];
    if (!invite) throw new MockError(404, 'NOT_FOUND', 'Invite not found');
    if (invite.target === career.summary.id) {
      if (invite.status === 'ACTIVE') invite.status = 'DECLINED';
      engine.save();
      return;
    }
    const m = membershipOf(career.summary.id);
    if (!m || m.alliance.id !== invite.allianceId) throw new MockError(404, 'NOT_FOUND', 'Invite not found');
    if (!isHigh(m.member.role) && invite.createdBy !== career.summary.id)
      throw new MockError(403, 'ROLE_REQUIRED', 'Role required', { role: 'DEPUTY' });
    if (invite.status === 'ACTIVE') {
      invite.status = 'REVOKED';
      log(m.alliance, 'INVITE_REVOKED', career.summary.id, invite.target);
    }
    engine.save();
  };

  const decide = (career: MockCareer, requestId: string, decision: unknown): AllianceJoinRequestDto => {
    requireCommandAllowed(career);
    expireStale();
    const { alliance: a, member: me } = requireMembership(career);
    requireRole(me, 'DEPUTY');
    if (decision !== 'ACCEPT' && decision !== 'REJECT')
      throw new MockError(422, 'VALIDATION_ERROR', 'decision must be ACCEPT or REJECT');
    const request = world().requests[requestId];
    if (!request || request.allianceId !== a.id) throw new MockError(404, 'NOT_FOUND', 'Request not found');
    if (request.status !== 'PENDING')
      throw new MockError(409, 'CONFLICT', 'Already decided', { reason: 'ALREADY_DECIDED' });
    const requester = careerById(request.careerId);
    if (decision === 'ACCEPT') {
      if (!requester || membershipOf(request.careerId)) {
        request.status = 'WITHDRAWN';
        engine.save();
        throw new MockError(409, 'CONFLICT', 'Requester unavailable', { reason: 'REQUESTER_UNAVAILABLE' });
      }
      if (activeMembers(a).length >= progressOf(a).memberSlots)
        throw new MockError(409, 'ALLIANCE_FULL', 'No free slot', {
          members: activeMembers(a).length,
          slots: progressOf(a).memberSlots,
        });
      request.status = 'ACCEPTED';
      request.decidedBy = career.summary.id;
      request.decidedAt = engine.now();
      log(a, 'REQUEST_ACCEPTED', career.summary.id, request.careerId);
      notify(requester, 'REQUEST_ACCEPTED', { tag: a.tag, name: a.name }, 'overview');
      addMember(a, requester, 'MEMBER', 'REQUEST', career.summary.id);
    } else {
      request.status = 'REJECTED';
      request.decidedBy = career.summary.id;
      request.decidedAt = engine.now();
      log(a, 'REQUEST_REJECTED', career.summary.id, request.careerId);
      if (requester) notify(requester, 'REQUEST_REJECTED', { tag: a.tag, name: a.name }, 'overview', 'INFO');
    }
    emitAlliance(a.id, 'alliance.updated', { alliance: neutralDto(a) });
    engine.save();
    return requestDto(request);
  };
  const withdrawRequest = (career: MockCareer, requestId: string): void => {
    const request = world().requests[requestId];
    if (!request || request.careerId !== career.summary.id)
      throw new MockError(404, 'NOT_FOUND', 'Request not found');
    if (request.status === 'PENDING') request.status = 'WITHDRAWN';
    engine.save();
  };
  const updateProfile = (userId: string, body: Partial<ProfileSettingsDto>): ProfileSettingsDto => {
    const p = profileOf(userId);
    if (typeof body.showOnDuty === 'boolean') p.showOnDuty = body.showOnDuty;
    if (typeof body.acceptDirectInvites === 'boolean') p.acceptDirectInvites = body.acceptDirectInvites;
    engine.save();
    return { ...p };
  };

  /* ── scheduled actions (the mock also checks lazily; these keep the fixed names alive) ── */
  engine.registerExecutor('ALLIANCE_INVITE_EXPIRE', (_career, action) => {
    const invite = world().invites[action.ref];
    if (invite && invite.status === 'ACTIVE') invite.status = 'EXPIRED';
  });
  engine.registerExecutor('ALLIANCE_DISBAND', (career, action) => {
    const a = world().alliances[action.ref];
    if (a && a.status === 'DISBANDING') disbandNow(a, career.summary.id);
  });
  engine.registerExecutor('ALLIANCE_LEADER_SUCCESSION', (_career, action) => {
    const a = world().alliances[action.ref];
    if (a && a.status === 'ACTIVE') checkSuccession(a);
  });

  /* ── hooks ── */
  engine.hooks.snapshotView.push((career, snapshot) => ({ ...snapshot, alliance: refOf(career) }));

  /* ── the module's api for the handlers and the QA helpers ── */
  const api: AllianceMockApi = {
    home,
    search,
    card,
    publicInvite,
    members,
    log: logOf,
    invites,
    joinRequests,
    sync,
    directorCard,
    searchDirectors,
    profile: (userId) => ({ ...profileOf(userId) }),
    updateProfile,
    found,
    join,
    leave,
    updateSettings,
    transfer,
    disband,
    cancelDisband,
    setRole,
    removeMember,
    mute,
    unmute,
    createInvite,
    deleteInvite,
    decide,
    withdrawRequest,
    membershipOf,
    refOf,
    emitAlliance,
    careerUpdated,
    alliance: (id) => world().alliances[id],
    restrictions: (career) => restrictionsOf(career, membershipOf(career.summary.id)),
    logAction: (allianceId, action, actor, target, details) => {
      const a = world().alliances[allianceId];
      if (a) log(a, action, actor, target, details ?? {});
    },
    notify,
    setUnreadProvider: (fn) => {
      unreadProvider = fn;
    },
    setOperationProvider: (fn) => {
      operationProvider = fn;
    },
    setProgressProvider: (fn) => {
      progressProvider = fn;
    },
    memberDto: (allianceId, careerId, viewerCareerId) => {
      const a = world().alliances[allianceId];
      const m = a && memberOf(a, careerId);
      return a && m ? memberDto(a, m, viewerCareerId) : null;
    },
    presenceOf: (career) => presenceOf(career),
    progressOf,
  };
  apis.set(engine, api);
  installAllianceQa(engine, api);
}

/** Phase 3 (progression): the weekly rank, the members' weekly points and the frame of the week come from the progress domain. */
export interface AllianceProgressProvider {
  weeklyRank: (a: MockAlliance) => number | null;
  weeklyPoints: (careerId: string) => number;
  frame: (allianceId: string) => AllianceFrame | null;
}
export interface AllianceMockApi {
  home: (career: MockCareer) => AllianceHomeDto;
  search: (
    career: MockCareer,
    q: {
      q?: string;
      language?: string;
      joinPolicy?: string;
      hasSlots?: boolean;
      cursor?: string;
      limit?: number;
    },
  ) => { data: AllianceCardDto[]; nextCursor: string | null; hasMore: boolean };
  card: (career: MockCareer, allianceId: string) => AllianceCardDto;
  publicInvite: (code: string) => PublicAllianceInviteDto;
  members: (career: MockCareer, status?: string) => AllianceMemberDto[];
  log: (
    career: MockCareer,
    cursor?: string,
    limit?: number,
  ) => { data: AllianceLogEntryDto[]; nextCursor: string | null; hasMore: boolean };
  invites: (career: MockCareer) => AllianceInviteDto[];
  joinRequests: (career: MockCareer) => AllianceJoinRequestDto[];
  sync: (career: MockCareer, since?: number) => AllianceSyncDelta;
  directorCard: (viewer: MockCareer, careerId: string) => DirectorCardDto;
  searchDirectors: (viewer: MockCareer, q: string) => DirectorCardDto[];
  profile: (userId: string) => ProfileSettingsDto;
  updateProfile: (userId: string, body: Partial<ProfileSettingsDto>) => ProfileSettingsDto;
  found: (career: MockCareer, body: unknown) => MyAllianceDto;
  join: (career: MockCareer, body: unknown) => JoinAllianceResult;
  leave: (career: MockCareer) => LeaveAllianceResult;
  updateSettings: (career: MockCareer, body: unknown) => MyAllianceDto;
  transfer: (career: MockCareer, memberId: string) => MyAllianceDto;
  disband: (career: MockCareer) => MyAllianceDto;
  cancelDisband: (career: MockCareer) => MyAllianceDto;
  setRole: (career: MockCareer, memberId: string, role: unknown) => AllianceMemberDto;
  removeMember: (career: MockCareer, memberId: string, ban: boolean) => void;
  mute: (career: MockCareer, memberId: string, duration: unknown) => AllianceMemberDto;
  unmute: (career: MockCareer, memberId: string) => AllianceMemberDto;
  createInvite: (career: MockCareer, targetCareerId?: string) => AllianceInviteDto;
  deleteInvite: (career: MockCareer, inviteId: string) => void;
  decide: (career: MockCareer, requestId: string, decision: unknown) => AllianceJoinRequestDto;
  withdrawRequest: (career: MockCareer, requestId: string) => void;
  membershipOf: (careerId: string) => { alliance: MockAlliance; member: MockMember } | null;
  refOf: (career: MockCareer) => AllianceSnapshotDto | null;
  emitAlliance: (
    allianceId: string,
    type: AllianceRealtimeEventType,
    payload: Record<string, unknown>,
  ) => void;
  careerUpdated: (career: MockCareer) => void;
  alliance: (id: string) => MockAlliance | undefined;
  restrictions: (career: MockCareer) => AllianceRestrictionsDto;
  logAction: (
    allianceId: string,
    action: AllianceLogAction,
    actor: string | null,
    target: string | null,
    details?: AllianceLogEntryDto['details'],
  ) => void;
  notify: (
    career: MockCareer,
    code: string,
    params: Record<string, string | number>,
    targetId: string,
    priority?: 'CRITICAL' | 'IMPORTANT' | 'INFO',
  ) => void;
  setUnreadProvider: (fn: (career: MockCareer, a: MockAlliance) => { board: number; chat: number }) => void;
  setOperationProvider: (fn: (career: MockCareer, a: MockAlliance) => string | null) => void;
  setProgressProvider: (fn: AllianceProgressProvider) => void;
  memberDto: (allianceId: string, careerId: string, viewerCareerId: string) => AllianceMemberDto | null;
  presenceOf: (career: MockCareer) => AlliancePresence;
  progressOf: (a: MockAlliance) => AllianceLevelDto;
}

const apis = new WeakMap<MockEngine, AllianceMockApi>();
/** The alliance module of an engine (installed by `installDomains`). */
export function allianceApiOf(engine: MockEngine): AllianceMockApi {
  const api = apis.get(engine);
  if (!api) throw new Error('alliance domain not installed');
  return api;
}

/* ───────────────────────────── QA: simulated allies & shortcuts ───────────────────────────── */

function installAllianceQa(engine: MockEngine, api: AllianceMockApi): void {
  const careerById = (id: string): MockCareer => {
    const career = engine.state.careers[id];
    if (!career) throw new MockError(404, 'NOT_FOUND', 'Career not found');
    return career;
  };
  let allies = 0;
  /**
   * QA: another Director in the mock world — an account + a career past the tutorial — who can act through the same rules
   * (`allyJoin`, `allyRequestJoin`, `allyFound`, `allyInvite`, `allyDecide`, `allyLeave`, `allySetDuty`). Returns the career id.
   */
  engine.qa.simulateAlly = ((
    name: string,
    opts: { level?: number; city?: string; onDuty?: boolean; online?: boolean; rulesAccepted?: boolean } = {},
  ) => {
    const session = engine.state.currentSession;
    allies += 1;
    const email = `ally.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${allies}.${Math.floor(engine.random() * 1e6)}@example.com`;
    const taken = Object.values(engine.state.users).some(
      (u) => u.user.directorName.toLowerCase() === name.toLowerCase(),
    );
    const directorName = taken ? `${name} ${allies}` : name;
    const { challengeId } = engine.requestOtp(email);
    engine.verifyOtp(
      { challengeId, code: '123456', directorName, acceptTerms: true, confirmAge: true },
      'qa-ally',
    );
    const account = engine.state.users[email]!;
    const site = engine.starterSites()[0]!;
    const summary = engine.createCareer(account, { locationId: 'IT-068028', siteId: site.id });
    const career = engine.state.careers[summary.id]!;
    const tutorial = career.incidents.find((i) => i.isTutorial);
    if (tutorial) engine.close(career, tutorial, 'CANCELLED', engine.now());
    career.pendingOutcomes = [];
    engine.advanceTutorial(career, 'DONE');
    const level = opts.level ?? 5;
    const missing = xpThreshold(level) - Number(career.summary.xp);
    if (missing > 0) engine.awardXp(career, missing);
    // The ally's account is a day old: he may write free text (04 §2.1) and his rules are accepted.
    account.user.createdAt = iso(engine.now() - 2 * DAY);
    if (opts.rulesAccepted !== false) acceptCommunityRules(engine, account.user.id, COMMUNITY_RULES_VERSION);
    careerAlliance(career).simulated = {
      onDuty: opts.onDuty ?? true,
      online: opts.online ?? opts.onDuty ?? true,
      city: opts.city ?? null,
    };
    career.lastSeenAt = engine.now();
    // Creating the ally signed him in: give the session back to the player.
    engine.state.currentSession = session;
    engine.save();
    return { careerId: summary.id, directorName };
  }) as never;
  engine.qa.allyFound = ((careerId: string, body: Record<string, unknown>) =>
    api.found(careerById(careerId), {
      name: body.name,
      tag: body.tag,
      emblem: body.emblem ?? {
        shape: 'SHIELD',
        symbol: 'FLAME',
        primaryColor: 'RED',
        secondaryColor: 'SILVER',
      },
      description: body.description ?? '',
      language: body.language ?? 'it',
      joinPolicy: body.joinPolicy ?? 'OPEN',
      minLevel: body.minLevel ?? null,
    })) as never;
  /** QA: the current career founds an alliance (same defaults as `allyFound`); returns `MyAllianceDto`. */
  engine.qa.foundAlliance = ((body: Record<string, unknown>) => {
    const career = engine.qa.career();
    (engine.qa.allyFound as unknown as (id: string, b: Record<string, unknown>) => unknown)(
      career.summary.id,
      body,
    );
    return api.home(career).alliance;
  }) as never;
  engine.qa.allyJoin = ((careerId: string, body: Record<string, unknown>) =>
    api.join(careerById(careerId), body)) as never;
  engine.qa.allyRequestJoin = ((careerId: string, allianceId: string) =>
    api.join(careerById(careerId), { allianceId })) as never;
  engine.qa.allyLeave = ((careerId: string) => api.leave(careerById(careerId))) as never;
  engine.qa.allyInvite = ((careerId: string, targetCareerId?: string) =>
    api.createInvite(careerById(careerId), targetCareerId)) as never;
  engine.qa.allyDecide = ((careerId: string, requestId: string, decision: string) =>
    api.decide(careerById(careerId), requestId, decision)) as never;
  engine.qa.allySetDuty = ((careerId: string, onDuty: boolean, online = true) => {
    const career = careerById(careerId);
    const state = careerAlliance(career);
    state.simulated = { ...(state.simulated ?? { city: null, onDuty, online }), onDuty, online };
    career.lastSeenAt = engine.now();
    const m = api.membershipOf(careerId);
    if (m)
      api.emitAlliance(m.alliance.id, 'alliance.presence.updated', {
        changes: [{ careerId, presence: onDuty && online ? 'ON_DUTY' : online ? 'ONLINE' : 'AWAY' }],
      });
    engine.save();
  }) as never;
  /** QA: the alliance section of the current career (`AllianceHomeDto`). */
  engine.qa.allianceHome = (() => api.home(engine.qa.career())) as never;
  /** QA: sets the alliance XP so that it is at `level` (the slots follow). */
  engine.qa.setAllianceLevel = ((level: number) => {
    const career = engine.qa.career();
    const m = api.membershipOf(career.summary.id);
    if (!m) throw new MockError(404, 'NOT_FOUND', 'No alliance');
    m.alliance.xp = ALLIANCE_LEVELS[Math.min(10, Math.max(1, level)) - 1]!.xp;
    api.emitAlliance(m.alliance.id, 'alliance.updated', { alliance: api.home(career).alliance });
    engine.save();
  }) as never;
  /** QA: config knobs of the alliance system (`{ foundCost: 0 }`, `{ joinLevel: 1 }` …). */
  engine.qa.setAllianceKnobs = ((knobs: Partial<AllianceKnobs>) => {
    allianceWorld(engine).knobs = { ...allianceWorld(engine).knobs, ...knobs };
    engine.save();
  }) as never;
  /** QA: ends the join cooldown of the current career at once. */
  engine.qa.clearAllianceCooldown = (() => {
    careerAlliance(engine.qa.career()).cooldownUntil = null;
    engine.save();
  }) as never;
  /** QA: the coordinator of the current career's alliance has been away for `days` (succession check). */
  engine.qa.ageCoordinator = ((days: number) => {
    const career = engine.qa.career();
    const m = api.membershipOf(career.summary.id);
    if (!m) throw new MockError(404, 'NOT_FOUND', 'No alliance');
    const coordinator = activeMembers(m.alliance).find((x) => x.role === 'COORDINATOR');
    const c = coordinator && engine.state.careers[coordinator.careerId];
    if (c) c.lastSeenAt = engine.now() - days * DAY;
    engine.save();
  }) as never;
}
