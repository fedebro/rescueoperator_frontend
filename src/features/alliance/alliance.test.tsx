import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import type { AllianceHomeDto, AllianceMemberDto, MyAllianceDto } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { renderWithIntl } from '@/test/render';
import { CAREER_ID, snapshot } from '@/test/fixtures';
import { CareerProvider } from '@/features/game/hooks';
import { reduceAllianceEvent, type LooseAllianceEnvelope } from '@/lib/realtime/alliance-reconcile';
import { focusToTab } from './alliance-screen';
import { MembersTab } from './members-tab';
import { NoAllianceScreen } from './no-alliance';
import { OverviewTab } from './overview-tab';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/game/alliance',
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  members: vi.fn(),
  joinRequests: vi.fn(),
  invites: vi.fn(),
  setRole: vi.fn(),
  remove: vi.fn(),
  leave: vi.fn(),
  search: vi.fn(),
  join: vi.fn(),
}));
vi.mock('@/lib/api/alliance', () => ({
  allianceApi: api,
  moderationApi: { blocks: vi.fn().mockResolvedValue([]), communityRules: vi.fn() },
  accountApi: {},
}));

const T0 = '2026-10-06T09:00:00.000Z';
const ALLIANCE_ID = 'all_01J8Z0000000000000000000AA';
const member = (patch: Partial<AllianceMemberDto>): AllianceMemberDto => ({
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
const MARTA = member({
  id: 'alm_01J8Z0000000000000000000AB',
  careerId: 'car_01J8Z0000000000000000000AB',
  directorName: 'Marta',
  role: 'MEMBER',
  locationName: 'Chieti',
});

const config: AllianceHomeDto['config'] = {
  flags: {
    alliances: true,
    board: false,
    chat: false,
    aid: false,
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
const alliance = (patch: Partial<MyAllianceDto> = {}): MyAllianceDto => ({
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
  generalChannelId: 'alc_01J8Z0000000000000000000AA',
  ...patch,
});
const home = (patch: Partial<AllianceHomeDto> = {}): AllianceHomeDto => ({
  alliance: null,
  invites: [],
  joinRequests: [],
  cooldownUntil: null,
  restrictions: {
    rulesAccepted: false,
    level: 5,
    writeMinLevel: 2,
    accountAgeOk: true,
    mutedUntil: null,
    muteScope: null,
    suspended: false,
    canWriteText: false,
    canUseQuick: true,
    writeBlockedReason: 'RULES_NOT_ACCEPTED',
  },
  config,
  ...patch,
});

function renderGame(ui: React.ReactElement, level = 5) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const snap = snapshot();
  qc.setQueryData(qk.sync(CAREER_ID), { ...snap, career: { ...snap.career, level, credits: '5000' } });
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>{ui}</CareerProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.members.mockResolvedValue([member({}), MARTA]);
  api.joinRequests.mockResolvedValue([]);
  api.invites.mockResolvedValue([]);
  api.search.mockResolvedValue({ data: [], meta: { serverTime: T0, hasMore: false, nextCursor: null } });
});
afterEach(() => vi.clearAllMocks());

describe('alliance section — no alliance', () => {
  it('below the join level shows only the locked row with the levels from the config', () => {
    renderGame(<NoAllianceScreen home={home()} onJoined={vi.fn()} />, 2);
    expect(screen.getByTestId('alliance-locked')).toHaveTextContent('Alleanze dal livello 3');
    expect(screen.getByTestId('alliance-locked')).toHaveTextContent('Il tuo livello: 2');
    expect(screen.queryByTestId('alliance-find')).toBeNull();
  });
  it('shows the invites received with Entra, the cooldown and the find / found tabs', async () => {
    const onJoined = vi.fn();
    api.join.mockResolvedValue({ outcome: 'JOINED', alliance: alliance(), joinRequest: null });
    renderGame(
      <NoAllianceScreen
        home={home({
          cooldownUntil: new Date(Date.now() + 3_600_000).toISOString(),
          invites: [
            {
              id: 'ali_01J8Z0000000000000000000AA',
              alliance: {
                ...alliance(),
                viewer: {
                  canJoin: true,
                  blockedReason: null,
                  pendingRequestId: null,
                  pendingInviteId: 'ali_01J8Z0000000000000000000AA',
                },
              },
              invitedBy: { careerId: 'car_01J8Z0000000000000000000AB', directorName: 'Marta' },
              createdAt: T0,
              expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            },
          ],
        })}
        onJoined={onJoined}
      />,
    );
    expect(screen.getByTestId('alliance-cooldown')).toBeInTheDocument();
    const invites = screen.getByTestId('alliance-invites-received');
    expect(invites).toHaveTextContent('Abruzzo Soccorso');
    expect(invites).toHaveTextContent('da Marta');
    await userEvent.click(within(invites).getByTestId('invite-accept'));
    await waitFor(() =>
      expect(api.join).toHaveBeenCalledWith(CAREER_ID, { inviteId: 'ali_01J8Z0000000000000000000AA' }),
    );
    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(screen.getByTestId('tab-find')).toBeInTheDocument();
    expect(screen.getByTestId('tab-found')).toBeInTheDocument();
  });
  it('the found form shows the cost and the level requirement from the config, never hard-coded', async () => {
    renderGame(
      <NoAllianceScreen
        home={home({ config: { ...config, foundLevel: 7, foundCost: '2500' } })}
        onJoined={vi.fn()}
      />,
      5,
    );
    await userEvent.click(screen.getByTestId('tab-found'));
    expect(screen.getByTestId('found-requirement')).toHaveTextContent('Serve il livello 7');
    expect(screen.getByTestId('found-summary')).toHaveTextContent('2.500');
    expect(screen.getByTestId('found-submit')).toBeDisabled();
  });
});

describe('alliance section — members and actions', () => {
  it('lists members with role, place and presence; the coordinator gets the actions menu on the others', async () => {
    renderGame(<MembersTab alliance={alliance()} onOpenMember={vi.fn()} onLeft={vi.fn()} />);
    const rows = await screen.findAllByTestId('member-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Federico');
    expect(within(rows[0]!).getByTestId('member-role')).toHaveTextContent('Coordinatore');
    expect(within(rows[0]!).queryByTestId('member-actions')).toBeNull(); // never on oneself
    expect(rows[1]).toHaveTextContent('Chieti');
    expect(within(rows[1]!).getByTestId('member-presence')).toHaveAttribute('data-presence', 'ON_DUTY');
    api.setRole.mockResolvedValue({ ...MARTA, role: 'DEPUTY' });
    await userEvent.click(within(rows[1]!).getByTestId('member-actions'));
    await userEvent.click(await screen.findByTestId('action-promote'));
    await waitFor(() => expect(api.setRole).toHaveBeenCalledWith(CAREER_ID, MARTA.id, { role: 'DEPUTY' }));
  });
  it('a member sees no actions and may leave; the coordinator with others must transfer first', async () => {
    const asMember = alliance({
      me: {
        memberId: MARTA.id,
        role: 'MEMBER',
        joinedAt: T0,
        mutedUntil: null,
        canInvite: true,
        isHighRole: false,
      },
    });
    api.leave.mockResolvedValue({ cooldownUntil: T0 });
    const onLeft = vi.fn();
    const { unmount } = renderGame(<MembersTab alliance={asMember} onOpenMember={vi.fn()} onLeft={onLeft} />);
    await screen.findAllByTestId('member-row');
    expect(screen.queryAllByTestId('member-actions')).toHaveLength(0);
    expect(screen.queryByTestId('alliance-join-requests')).toBeNull();
    await userEvent.click(screen.getByTestId('alliance-leave'));
    await userEvent.click(await screen.findByTestId('confirm-leave'));
    await waitFor(() => expect(api.leave).toHaveBeenCalledWith(CAREER_ID));
    await waitFor(() => expect(onLeft).toHaveBeenCalled());
    unmount();
    renderGame(<MembersTab alliance={alliance()} onOpenMember={vi.fn()} onLeft={vi.fn()} />);
    await screen.findAllByTestId('member-row');
    expect(
      screen.getByText('Sei il Coordinatore: cedi prima il ruolo a un altro membro.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('alliance-leave'));
    expect(await screen.findByTestId('confirm-leave')).toBeDisabled();
  });
  it('removal asks for a confirmation and names the member; banning says they cannot come back', async () => {
    api.remove.mockResolvedValue(undefined);
    renderGame(<MembersTab alliance={alliance()} onOpenMember={vi.fn()} onLeft={vi.fn()} />);
    const rows = await screen.findAllByTestId('member-row');
    await userEvent.click(within(rows[1]!).getByTestId('member-actions'));
    await userEvent.click(await screen.findByTestId('action-ban'));
    expect(await screen.findByText('Allontanare Marta?')).toBeInTheDocument();
    expect(screen.getByText('Non potrà più rientrare né essere invitato.')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('confirm-remove'));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(CAREER_ID, MARTA.id, { ban: true }));
  });
});

describe('alliance section — overview', () => {
  it('shows level, seats, who is on duty, the flag-off states of the parts not built yet, and the high-role shortcuts', async () => {
    const onSettings = vi.fn();
    renderGame(
      <OverviewTab
        home={home({ alliance: alliance() })}
        alliance={alliance()}
        onInvite={vi.fn()}
        onSettings={onSettings}
        onLog={vi.fn()}
        onRules={vi.fn()}
        onMember={vi.fn()}
      />,
    );
    const overview = screen.getByTestId('alliance-overview');
    expect(overview).toHaveTextContent('Livello 1');
    expect(overview).toHaveTextContent('2 / 10');
    expect(overview).toHaveTextContent('Abruzzo Soccorso');
    expect(await screen.findByTestId('overview-on-duty')).toHaveTextContent('Marta');
    expect(screen.getByTestId('alliance-off-board')).toHaveTextContent('Bacheca non attiva');
    expect(screen.getByTestId('alliance-off-aid')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('overview-settings'));
    expect(onSettings).toHaveBeenCalled();
  });
  it('a disbanding alliance shows the notice; a member does not get the settings button', () => {
    const asMember = alliance({
      disbandAt: new Date(Date.now() + 40 * 3_600_000).toISOString(),
      status: 'DISBANDING',
      me: {
        memberId: MARTA.id,
        role: 'MEMBER',
        joinedAt: T0,
        mutedUntil: null,
        canInvite: false,
        isHighRole: false,
      },
    });
    renderGame(
      <OverviewTab
        home={home({ alliance: asMember })}
        alliance={asMember}
        onInvite={vi.fn()}
        onSettings={vi.fn()}
        onLog={vi.fn()}
        onRules={vi.fn()}
        onMember={vi.fn()}
      />,
    );
    expect(screen.getByTestId('alliance-disbanding')).toHaveTextContent('Scioglimento previsto');
    expect(screen.queryByTestId('overview-settings')).toBeNull();
    expect(screen.queryByTestId('overview-invite')).toBeNull();
  });
});

describe('alliance stream reducer', () => {
  const envelope = (type: string, payload: Record<string, unknown>): LooseAllianceEnvelope => ({
    type,
    v: 1,
    allianceId: ALLIANCE_ID,
    seq: 3,
    occurredAt: T0,
    serverTime: T0,
    payload,
  });
  const me = { careerId: CAREER_ID };
  it('merges the room view of the alliance over the cached section and renames the badge', () => {
    const effects = reduceAllianceEvent(
      envelope('alliance.updated', { alliance: { id: ALLIANCE_ID, name: 'Nuovo Nome', tag: 'NEW' } }),
      me,
    );
    const homeEffect = effects.find((e) => e.type === 'home');
    const snapEffect = effects.find((e) => e.type === 'snapshot');
    expect(
      homeEffect && homeEffect.type === 'home' && homeEffect.update(home({ alliance: alliance() })).alliance,
    ).toMatchObject({ name: 'Nuovo Nome', tag: 'NEW', me: { role: 'COORDINATOR' } });
    expect(
      snapEffect &&
        snapEffect.type === 'snapshot' &&
        snapEffect.update({
          id: ALLIANCE_ID,
          name: 'x',
          tag: 'X',
          role: 'MEMBER',
          unread: { chat: 0, board: 0 },
          operationId: null,
        }),
    ).toMatchObject({ name: 'Nuovo Nome', role: 'MEMBER' });
  });
  it('a member event upserts, keeps the presence this client knows, and removes the gone; my own removal empties the section', () => {
    const joined = reduceAllianceEvent(
      envelope('alliance.member.updated', {
        member: { ...MARTA, presence: null, blocked: false },
        change: 'JOINED',
      }),
      me,
    );
    const list = joined.find((e) => e.type === 'members');
    expect(list && list.type === 'members' && list.update([member({})]).map((m) => m.directorName)).toEqual([
      'Federico',
      'Marta',
    ]);
    const roleChange = reduceAllianceEvent(
      envelope('alliance.member.updated', {
        member: { ...MARTA, role: 'DEPUTY', presence: null },
        change: 'ROLE',
      }),
      me,
    );
    const upd = roleChange.find((e) => e.type === 'members');
    expect(upd && upd.type === 'members' && upd.update([MARTA])[0]).toMatchObject({
      role: 'DEPUTY',
      presence: 'ON_DUTY',
    });
    const left = reduceAllianceEvent(
      envelope('alliance.member.updated', { member: MARTA, change: 'LEFT' }),
      me,
    );
    const gone = left.find((e) => e.type === 'members');
    expect(gone && gone.type === 'members' && gone.update([member({}), MARTA])).toHaveLength(1);
    const mine = reduceAllianceEvent(
      envelope('alliance.member.updated', { member: member({}), change: 'REMOVED' }),
      me,
    );
    expect(mine.some((e) => e.type === 'left')).toBe(true);
  });
  it('a message of somebody else bumps the chat badge; my own does not; unknown types are ignored', () => {
    const other = reduceAllianceEvent(
      envelope('alliance.message.created', { message: { author: { careerId: MARTA.careerId } } }),
      me,
    );
    const bump = other.find((e) => e.type === 'snapshot');
    expect(
      bump &&
        bump.type === 'snapshot' &&
        bump.update({
          id: ALLIANCE_ID,
          name: 'x',
          tag: 'X',
          role: 'MEMBER',
          unread: { chat: 1, board: 0 },
          operationId: null,
        })?.unread.chat,
    ).toBe(2);
    const mine = reduceAllianceEvent(
      envelope('alliance.message.created', { message: { author: { careerId: CAREER_ID } } }),
      me,
    );
    expect(mine.some((e) => e.type === 'snapshot')).toBe(false);
    expect(reduceAllianceEvent(envelope('alliance.something.new', {}), me)).toEqual([]);
  });
  it('maps notification targets to tabs', () => {
    expect(focusToTab('members')).toEqual({ tab: 'members', itemId: null });
    expect(focusToTab('post:alp_01J8Z0000000000000000000AA')).toEqual({
      tab: 'board',
      itemId: 'alp_01J8Z0000000000000000000AA',
    });
    expect(focusToTab('garbage')).toBeNull();
  });
});
