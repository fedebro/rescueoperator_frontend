import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type {
  AidColumnOptionsDto,
  AidRequestDto,
  AllianceChannelDto,
  AllianceHomeDto,
  AllianceMemberDto,
  AllianceMessageDto,
  AlliancePostDto,
  MyAllianceDto,
} from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { renderWithIntl } from '@/test/render';
import { CAREER_ID, snapshot } from '@/test/fixtures';
import { CareerProvider } from '@/features/game/hooks';

/** Fixtures of the alliance section for component tests (phase 2): a coordinator ("Federico") and a member ("Marta"). */
export const T0 = '2026-10-06T09:00:00.000Z';
export const ALLIANCE_ID = 'all_01J8Z0000000000000000000AA';
export const CHANNEL_ID = 'alc_01J8Z0000000000000000000AA';
export const MARTA_ID = 'car_01J8Z0000000000000000000AB';
export const REQUEST_ID = 'aid_01J8Z0000000000000000000AA';

export const config: AllianceHomeDto['config'] = {
  flags: {
    alliances: true,
    board: true,
    chat: true,
    aid: true,
    objectives: false,
    ranking: false,
    operations: false,
  },
  foundLevel: 5,
  foundCost: '1000',
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
  levels: [
    {
      level: 1,
      xp: 0,
      xpForCurrentLevel: 0,
      xpForNextLevel: 500,
      memberSlots: 10,
      deputySlots: 2,
      pinnedSlots: 3,
      concurrentColumns: 2,
    },
  ],
  emblem: {
    shapes: [{ code: 'SHIELD', minLevel: 1 }],
    symbols: [{ code: 'FLAME', minLevel: 1 }],
    colors: [
      { code: 'RED', minLevel: 1 },
      { code: 'SILVER', minLevel: 1 },
    ],
  },
  board: {
    postMaxChars: 1000,
    replyMaxChars: 500,
    postsPerDay: 5,
    repliesPerDay: 30,
    editWindowMinutes: 15,
    repliesPreview: 3,
    pageSize: 50,
  },
  chat: {
    messageMaxChars: 500,
    minSecondsBetween: 2,
    burst: 5,
    perMinute: 30,
    selfDeleteMinutes: 5,
    retentionDays: 90,
    pageSize: 50,
    maxMentions: 5,
  },
  aid: {
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
  },
  readOnly: { board: false, chat: false },
};

export const member = (patch: Partial<AllianceMemberDto> = {}): AllianceMemberDto => ({
  id: 'alm_01J8Z0000000000000000000AA',
  careerId: CAREER_ID,
  directorName: 'Federico',
  role: 'COORDINATOR',
  status: 'ACTIVE',
  level: 5,
  locationName: 'Pescara',
  families: ['FIRE'],
  joinedAt: T0,
  presence: 'ON_DUTY',
  lastSeen: 'TODAY',
  inactive: false,
  mutedUntil: null,
  aid: { given: 0, received: 0 },
  weeklyPoints: 0,
  blocked: false,
  ...patch,
});
export const MARTA = member({
  id: 'alm_01J8Z0000000000000000000AB',
  careerId: MARTA_ID,
  directorName: 'Marta',
  role: 'MEMBER',
  locationName: 'Chieti',
});

export const alliance = (patch: Partial<MyAllianceDto> = {}): MyAllianceDto => ({
  id: ALLIANCE_ID,
  name: 'Abruzzo Soccorso',
  tag: 'ABR',
  emblem: { shape: 'SHIELD', symbol: 'FLAME', primaryColor: 'RED', secondaryColor: 'SILVER' },
  description: 'Ci aiutiamo.',
  language: 'it',
  joinPolicy: 'OPEN',
  minLevel: null,
  level: 1,
  members: 2,
  memberSlots: 10,
  status: 'ACTIVE',
  lastActivityAt: T0,
  createdAt: T0,
  frame: null,
  settings: {
    joinPolicy: 'OPEN',
    minLevel: null,
    language: 'it',
    description: 'Ci aiutiamo.',
    membersCanInvite: true,
    notesByHighRolesOnly: false,
  },
  progress: config.levels[0]!,
  coordinator: { careerId: CAREER_ID, directorName: 'Federico' },
  deputies: 0,
  me: {
    memberId: 'alm_01J8Z0000000000000000000AA',
    role: 'COORDINATOR',
    joinedAt: T0,
    mutedUntil: null,
    canInvite: true,
    isHighRole: true,
  },
  disbandAt: null,
  readOnly: { board: false, chat: false },
  pendingJoinRequests: 0,
  counts: { members: 2, onDuty: 1, online: 1, inactive: 0 },
  unread: { board: 0, chat: 0 },
  operationId: null,
  weeklyRank: null,
  generalChannelId: CHANNEL_ID,
  ...patch,
});

/** A section whose viewer may write (rules accepted, level and age fine) and belongs to the alliance above. */
export const home = (patch: Partial<AllianceHomeDto> = {}): AllianceHomeDto => ({
  alliance: alliance(),
  invites: [],
  joinRequests: [],
  cooldownUntil: null,
  restrictions: {
    rulesAccepted: true,
    level: 5,
    writeMinLevel: 2,
    accountAgeOk: true,
    mutedUntil: null,
    muteScope: null,
    suspended: false,
    canWriteText: true,
    canUseQuick: true,
    writeBlockedReason: null,
  },
  config,
  ...patch,
});

export const channel = (patch: Partial<AllianceChannelDto> = {}): AllianceChannelDto => ({
  id: CHANNEL_ID,
  kind: 'GENERAL',
  name: { key: 'alliance.channel.GENERAL' },
  operationId: null,
  archived: false,
  createdAt: T0,
  lastMessageAt: T0,
  unread: 0,
  ...patch,
});

export const message = (patch: Partial<AllianceMessageDto> = {}): AllianceMessageDto => ({
  id: 'alx_01J8Z0000000000000000000AA',
  channelId: CHANNEL_ID,
  kind: 'TEXT',
  author: { careerId: MARTA_ID, directorName: 'Marta', role: 'MEMBER' },
  text: 'Ciao a tutti',
  quick: null,
  mentions: [],
  createdAt: T0,
  removed: false,
  hidden: false,
  hiddenByBlock: false,
  mine: false,
  deletableUntil: null,
  ...patch,
});

export const post = (patch: Partial<AlliancePostDto> = {}): AlliancePostDto => ({
  id: 'alp_01J8Z0000000000000000000AA',
  kind: 'NOTE',
  author: { careerId: MARTA_ID, directorName: 'Marta', role: 'MEMBER' },
  text: 'Nota di Marta',
  system: null,
  pinned: false,
  pinnedAt: null,
  createdAt: T0,
  editedAt: null,
  editableUntil: null,
  removed: false,
  hidden: false,
  hiddenByBlock: false,
  mine: false,
  reactions: [
    { reaction: 'ACK', count: 0, mine: false },
    { reaction: 'WELL_DONE', count: 0, mine: false },
    { reaction: 'PRESENT', count: 0, mine: false },
    { reaction: 'THANKS', count: 0, mine: false },
  ],
  replyCount: 0,
  replies: [],
  ...patch,
});

export const aidRequest = (patch: Partial<AidRequestDto> = {}): AidRequestDto => ({
  id: REQUEST_ID,
  allianceId: ALLIANCE_ID,
  requester: { careerId: MARTA_ID, directorName: 'Marta' },
  incident: {
    id: 'inc_01J8Z0000000000000000000AB',
    templateCode: 'FIRE_DWELLING',
    title: { key: 'incidents.FIRE_DWELLING.title', params: { fallback: 'Incendio abitazione' } },
    icon: 'flame',
    severity: 6,
    municipality: 'Chieti',
    families: ['FIRE'],
    major: null,
    expiresAt: '2026-10-06T09:40:00.000Z',
  },
  status: 'OPEN',
  gaps: [{ capability: 'FIRE_SUPPRESSION', level: 'REQUIRED', missing: 2, allied: 0, initial: 2 }],
  createdAt: T0,
  expiresAt: '2026-10-06T09:40:00.000Z',
  closedAt: null,
  columns: [],
  distanceKm: 18,
  mine: false,
  viewer: { canSend: true, blockedReason: null },
  operationId: null,
  ...patch,
});

/** Two useful vehicles: an engine that covers the whole gap in 5 min and a tanker that would arrive too late. */
export const columnOptions = (patch: Partial<AidColumnOptionsDto> = {}): AidColumnOptionsDto => ({
  request: aidRequest(),
  blockedReason: null,
  maxVehicles: 4,
  vehicles: [
    {
      vehicleId: 'veh_01J8Z0000000000000000000AA',
      typeCode: 'FIRE_APS',
      callSign: 'APS 1',
      family: 'FIRE',
      facilityId: 'fac_01J8Z0000000000000000000AA',
      facilityName: 'Distaccamento Pescara',
      capabilities: [{ capability: 'FIRE_SUPPRESSION', value: 2, useful: 2 }],
      etaSeconds: 300,
      arriveAt: '2026-10-06T09:05:00.000Z',
      tooLate: false,
      blockedReason: null,
    },
    {
      vehicleId: 'veh_01J8Z0000000000000000000AB',
      typeCode: 'FIRE_ABP',
      callSign: 'ABP 1',
      family: 'FIRE',
      facilityId: 'fac_01J8Z0000000000000000000AA',
      facilityName: 'Distaccamento Pescara',
      capabilities: [{ capability: 'FIRE_SUPPRESSION', value: 1, useful: 1 }],
      etaSeconds: 900,
      arriveAt: '2026-10-06T09:15:00.000Z',
      tooLate: true,
      blockedReason: 'TOO_LATE',
    },
  ],
  fund: { credits: '400', xp: '120' },
  ownCoverage: { currentPct: 80, ifAllSentPct: 30 },
  dailyRewarded: { used: 1, cap: 8 },
  pairFactor: 1,
  ...patch,
});

/** One page of a paged list, as the API client returns it. */
export const page = <T,>(data: T[]) => ({ data, meta: { nextCursor: null, hasMore: false, serverTime: T0 } });

/** Renders inside the query client + career context, with a sync snapshot of a level-5 Director. */
export function renderGame(ui: React.ReactElement, level = 5) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const snap = snapshot();
  qc.setQueryData(qk.sync(CAREER_ID), { ...snap, career: { ...snap.career, level, credits: '5000' } });
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>{ui}</CareerProvider>
    </QueryClientProvider>,
  );
}
