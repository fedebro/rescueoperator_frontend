import { describe, expect, it } from 'vitest';
import { AllianceHomeDto, AllianceMemberDto, MyAllianceDto, type RealtimeEnvelope } from '@/contracts';
import { xpThreshold } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { MockEngine, OTP_CODE, memoryStorage, type MockCareer, type MockError } from '../engine';
import { installDomains } from './index';
import { allianceApiOf, allianceWorld, careerAlliance } from './alliance';
import { block, requestAccountDeletion } from './community';

const DAY = 86_400_000;

function world(level = 5) {
  let now = Date.parse('2026-10-06T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  // Several careers are created at the same instant: ids need a moving random source (a constant one would collide).
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random,
  });
  installDomains(engine);
  const ch = engine.requestOtp('founder@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'Federico',
      acceptTerms: true,
      confirmAge: true,
    },
    'vitest',
  );
  const account = engine.authenticate(`Bearer ${auth.accessToken}`);
  const summary = engine.createCareer(account, {
    locationId: PESCARA.id,
    siteId: engine.starterSites()[0]!.id,
  });
  const career = engine.state.careers[summary.id] as MockCareer;
  if (level > 1) engine.awardXp(career, xpThreshold(level));
  engine.credit(career, 5000, 'ADMIN_ADJUSTMENT');
  const api = allianceApiOf(engine);
  const qa = engine.qa as unknown as Record<string, (...a: never[]) => unknown>;
  const ally = (name: string, opts?: Record<string, unknown>) =>
    (
      qa.simulateAlly as (
        n: string,
        o?: Record<string, unknown>,
      ) => { careerId: string; directorName: string }
    )(name, opts);
  const careerOf = (id: string) => engine.state.careers[id]!;
  return { engine, career, account, events, api, qa, ally, careerOf, tick: (ms: number) => (now += ms) };
}

const FOUND = {
  name: 'Abruzzo Soccorso',
  tag: 'abr',
  emblem: { shape: 'SHIELD', symbol: 'FLAME', primaryColor: 'RED', secondaryColor: 'SILVER' },
  description: 'Ci aiutiamo tra province.',
  language: 'it',
  joinPolicy: 'OPEN',
  minLevel: null,
};

const error = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as MockError;
  }
  throw new Error('expected a MockError');
};

describe('mock alliances — home, founding, search', () => {
  it('serves the section without an alliance: knobs from the config, nothing hard-coded in the client', () => {
    const w = world(1);
    const home = w.api.home(w.career);
    expect(AllianceHomeDto.safeParse(home).success).toBe(true);
    expect(home.alliance).toBeNull();
    expect(home.config).toMatchObject({ foundLevel: 5, joinLevel: 3, foundCost: '1000', cooldownHours: 24 });
    expect(home.config.levels[0]).toMatchObject({ level: 1, memberSlots: 10, deputySlots: 2 });
    expect(home.config.levels[9]).toMatchObject({ level: 10, memberSlots: 40 });
    // Below the join level the search is empty (the screen shows the locked row).
    expect(w.api.search(w.career, {}).data).toEqual([]);
    expect(w.api.home(w.career).restrictions.writeBlockedReason).toBe('RULES_NOT_ACCEPTED');
  });

  it('founds at level 5 for the configured cost, the founder is the coordinator, the snapshot carries the ref', () => {
    const w = world(4);
    expect(error(() => w.api.found(w.career, FOUND)).code).toBe('LEVEL_TOO_LOW');
    w.engine.awardXp(w.career, xpThreshold(5) - Number(w.career.summary.xp));
    const before = BigInt(w.career.summary.credits);
    const mine = w.api.found(w.career, FOUND);
    expect(MyAllianceDto.safeParse(mine).success).toBe(true);
    expect(mine).toMatchObject({
      name: 'Abruzzo Soccorso',
      tag: 'ABR',
      members: 1,
      memberSlots: 10,
      status: 'ACTIVE',
    });
    expect(mine.me).toMatchObject({ role: 'COORDINATOR', isHighRole: true, canInvite: true });
    expect(BigInt(w.career.summary.credits)).toBe(before - 1000n);
    expect(w.engine.snapshot(w.career).alliance).toMatchObject({
      tag: 'ABR',
      role: 'COORDINATOR',
      unread: { chat: 0, board: 0 },
    });
    expect(w.api.log(w.career).data.map((l) => l.action)).toEqual(['MEMBER_JOINED', 'FOUNDED']);
    // One alliance per career; names and tags unique ignoring case and accents; the text filter applies.
    expect(error(() => w.api.found(w.career, FOUND)).code).toBe('ALREADY_IN_ALLIANCE');
    const other = w.ally('Marta');
    expect(
      error(() => w.api.found(w.careerOf(other.careerId), { ...FOUND, name: 'ABRUZZO SOCCORSO', tag: 'XYZ' }))
        .details,
    ).toMatchObject({
      reason: 'NAME_TAKEN',
    });
    expect(
      error(() =>
        w.api.found(w.careerOf(other.careerId), { ...FOUND, name: 'Visita www.esempio.it', tag: 'XYZ' }),
      ).code,
    ).toBe('TEXT_REJECTED');
    expect(
      error(() => w.api.found(w.careerOf(other.careerId), { ...FOUND, name: 'Ok', tag: 'XYZ' })).code,
    ).toBe('VALIDATION_ERROR');
    // The search lists it, sorted by activity, with the viewer's relation.
    const page = w.api.search(w.careerOf(other.careerId), { q: 'abr' });
    expect(page.data.map((a) => a.tag)).toEqual(['ABR']);
    expect(page.data[0]!.viewer).toMatchObject({ canJoin: true, blockedReason: null });
  });
});

describe('mock alliances — invites, membership, roles, leaving', () => {
  it('a link invite lets a simulated ally in; the alliance stream carries the change with its own sequence', () => {
    const w = world();
    w.api.found(w.career, FOUND);
    const invite = w.api.createInvite(w.career);
    expect(invite.code).toMatch(/^[A-Z2-9]{10}$/);
    const marta = w.ally('Marta', { level: 4, city: 'Chieti', onDuty: true });
    const joined = w.api.join(w.careerOf(marta.careerId), { inviteCode: invite.code!.toLowerCase() });
    expect(joined.outcome).toBe('JOINED');
    expect(joined.alliance?.me.role).toBe('MEMBER');
    const members = w.api.members(w.career);
    expect(members.map((m) => [m.directorName, m.role])).toEqual([
      ['Federico', 'COORDINATOR'],
      ['Marta', 'MEMBER'],
    ]);
    expect(members[1]).toMatchObject({
      locationName: 'Chieti',
      presence: 'ON_DUTY',
      lastSeen: 'TODAY',
      level: 4,
    });
    expect(AllianceMemberDto.safeParse(members[1]).success).toBe(true);
    expect(w.api.invites(w.career)[0]!.uses).toBe(1);
    // The ally cannot be in two alliances; the sequence grew by one per event and replays.
    expect(error(() => w.api.join(w.careerOf(marta.careerId), { inviteCode: invite.code! })).code).toBe(
      'ALREADY_IN_ALLIANCE',
    );
    const allianceId = joined.alliance!.id;
    const box = allianceWorld(w.engine).outbox[allianceId]!;
    expect(box.map((e) => e.seq)).toEqual(box.map((_, i) => i + 1));
    expect(box.at(-2)?.type).toBe('alliance.member.updated');
    expect(box.at(-2)?.payload).toMatchObject({ change: 'JOINED' });
    const delta = w.api.sync(w.career, box.length - 2);
    expect(delta).toMatchObject({ seq: box.length, resyncRequired: false });
    expect(delta.events).toHaveLength(2);
    expect(w.api.sync(w.career, -5).resyncRequired).toBe(true);
    // The career stream of the ally got the snapshot ref.
    const refEvent = w.events
      .filter((e) => e.careerId === marta.careerId && e.type === 'career.updated')
      .at(-1);
    expect(refEvent?.payload.alliance).toMatchObject({ tag: 'ABR', role: 'MEMBER' });
  });

  it('roles follow the matrix: deputies act on members, the coordinator hands over before leaving', () => {
    const w = world();
    w.api.found(w.career, FOUND);
    const invite = w.api.createInvite(w.career);
    const marta = w.ally('Marta');
    const luca = w.ally('Luca');
    w.api.join(w.careerOf(marta.careerId), { inviteCode: invite.code! });
    w.api.join(w.careerOf(luca.careerId), { inviteCode: invite.code! });
    const martaMember = w.api.members(w.career).find((m) => m.directorName === 'Marta')!;
    const lucaMember = w.api.members(w.career).find((m) => m.directorName === 'Luca')!;
    const meMember = w.api.members(w.career).find((m) => m.directorName === 'Federico')!;
    // A member cannot promote; the coordinator can (2 deputy slots at level 1).
    expect(error(() => w.api.setRole(w.careerOf(marta.careerId), lucaMember.id, 'DEPUTY')).code).toBe(
      'ROLE_REQUIRED',
    );
    expect(w.api.setRole(w.career, martaMember.id, 'DEPUTY').role).toBe('DEPUTY');
    expect(w.api.home(w.career).alliance?.deputies).toBe(1);
    // A deputy may mute / remove a member, never the coordinator or another deputy.
    expect(w.api.mute(w.careerOf(marta.careerId), lucaMember.id, 'H1').mutedUntil).toBe(
      new Date(w.engine.now() + 3_600_000).toISOString(),
    );
    expect(w.api.unmute(w.careerOf(marta.careerId), lucaMember.id).mutedUntil).toBeNull();
    // Never the coordinator, never oneself (409, as the server), another deputy → ROLE_REQUIRED.
    expect(
      error(() => w.api.removeMember(w.careerOf(marta.careerId), meMember.id, false)).details,
    ).toMatchObject({ reason: 'COORDINATOR' });
    expect(error(() => w.api.mute(w.careerOf(marta.careerId), martaMember.id, 'H24')).details).toMatchObject({
      reason: 'SELF',
    });
    const lucaDeputy = w.api.setRole(w.career, lucaMember.id, 'DEPUTY');
    expect(error(() => w.api.mute(w.careerOf(marta.careerId), lucaDeputy.id, 'H24')).code).toBe(
      'ROLE_REQUIRED',
    );
    w.api.setRole(w.career, lucaMember.id, 'MEMBER');
    // Leaving as coordinator with others inside: transfer first.
    expect(error(() => w.api.leave(w.career)).details).toMatchObject({ reason: 'TRANSFER_FIRST' });
    const after = w.api.transfer(w.career, martaMember.id);
    expect(after.me.role).toBe('DEPUTY');
    expect(after.coordinator.directorName).toBe('Marta');
    // Now I may leave: 24 h cooldown, then no join or founding until it ends.
    const left = w.api.leave(w.career);
    expect(Date.parse(left.cooldownUntil) - w.engine.now()).toBe(24 * 3_600_000);
    expect(w.engine.snapshot(w.career).alliance).toBeNull();
    expect(error(() => w.api.join(w.career, { inviteCode: invite.code! })).code).toBe('ALLIANCE_COOLDOWN');
    expect(error(() => w.api.found(w.career, { ...FOUND, name: 'Altra', tag: 'ALT' })).code).toBe(
      'ALLIANCE_COOLDOWN',
    );
    w.tick(25 * 3_600_000);
    expect(w.api.join(w.career, { inviteCode: invite.code! }).outcome).toBe('JOINED');
    expect(w.api.home(w.career).alliance?.me.role).toBe('MEMBER');
    // Removal by the new coordinator: cooldown for the removed, a notification, a log line.
    const me = w.api.members(w.careerOf(marta.careerId)).find((m) => m.directorName === 'Federico')!;
    w.api.removeMember(w.careerOf(marta.careerId), me.id, true);
    expect(w.api.home(w.career).alliance).toBeNull();
    expect(w.career.notifications[0]).toMatchObject({
      category: 'ALLIANCE',
      action: { kind: 'OPEN_ALLIANCE', targetId: 'overview' },
    });
    expect(w.api.log(w.careerOf(marta.careerId)).data[0]).toMatchObject({ action: 'MEMBER_BANNED' });
    // Banned: no way back, not even by invite.
    careerAlliance(w.career).cooldownUntil = null;
    expect(error(() => w.api.join(w.career, { inviteCode: invite.code! })).details).toMatchObject({
      reason: 'BANNED',
    });
  });

  it('REQUEST policy: the request waits for a high role; INVITE policy needs a code; the last member disbands', () => {
    const w = world();
    const marta = w.ally('Marta');
    w.api.found(w.careerOf(marta.careerId), { ...FOUND, joinPolicy: 'REQUEST' });
    const allianceId = w.api.search(w.career, {}).data[0]!.id;
    const requested = w.api.join(w.career, { allianceId });
    expect(requested.outcome).toBe('REQUESTED');
    expect(w.api.home(w.career).joinRequests).toHaveLength(1);
    expect(w.api.card(w.career, allianceId).viewer).toMatchObject({
      blockedReason: 'REQUEST_PENDING',
      canJoin: false,
    });
    // Idempotent: asking again returns the same request; the high role sees it and decides.
    expect(w.api.join(w.career, { allianceId }).joinRequest?.id).toBe(requested.joinRequest!.id);
    const pending = w.api.joinRequests(w.careerOf(marta.careerId));
    expect(pending).toHaveLength(1);
    expect(w.careerOf(marta.careerId).notifications[0]).toMatchObject({ category: 'ALLIANCE' });
    expect(w.api.decide(w.careerOf(marta.careerId), pending[0]!.id, 'ACCEPT').status).toBe('ACCEPTED');
    expect(w.api.home(w.career).alliance?.me.role).toBe('MEMBER');
    expect(w.career.notifications[0]!.title.key).toBe('alliance.notification.REQUEST_ACCEPTED.title');
    // Switch to INVITE: nobody gets in without a code.
    w.api.updateSettings(w.careerOf(marta.careerId), { joinPolicy: 'INVITE' });
    const luca = w.ally('Luca');
    expect(error(() => w.api.join(w.careerOf(luca.careerId), { allianceId })).details).toMatchObject({
      reason: 'INVITE_REQUIRED',
    });
    // Members may invite only when the alliance allows it.
    w.api.updateSettings(w.careerOf(marta.careerId), { membersCanInvite: false });
    expect(error(() => w.api.createInvite(w.career)).code).toBe('ROLE_REQUIRED');
    // Everybody leaves: the alliance dissolves, its name is reserved for 30 days.
    w.api.leave(w.career);
    w.api.leave(w.careerOf(marta.careerId));
    expect(w.api.search(w.careerOf(luca.careerId), {}).data).toEqual([]);
    expect(
      error(() => w.api.found(w.careerOf(luca.careerId), { ...FOUND, tag: 'NEW' })).details,
    ).toMatchObject({ reason: 'NAME_TAKEN' });
    w.tick(31 * DAY);
    expect(w.api.found(w.careerOf(luca.careerId), { ...FOUND, tag: 'NEW' }).name).toBe('Abruzzo Soccorso');
  });

  it('direct invites respect privacy and blocks; the Director card shows presence to allies only', () => {
    const w = world();
    w.api.found(w.career, FOUND);
    const marta = w.ally('Marta', { onDuty: true });
    const card = w.api.directorCard(w.career, marta.careerId);
    expect(card).toMatchObject({
      directorName: 'Marta',
      isAlly: false,
      presence: null,
      canInvite: true,
      alliance: null,
    });
    const direct = w.api.createInvite(w.career, marta.careerId);
    expect(direct.code).toBeNull();
    expect(direct.target?.directorName).toBe('Marta');
    expect(w.api.home(w.careerOf(marta.careerId)).invites[0]).toMatchObject({
      id: direct.id,
      invitedBy: { directorName: 'Federico' },
    });
    // Declining is a DELETE by the recipient; a repeat invite is idempotent while pending.
    expect(w.api.createInvite(w.career, marta.careerId).id).toBe(direct.id);
    w.api.deleteInvite(w.careerOf(marta.careerId), direct.id);
    expect(w.api.home(w.careerOf(marta.careerId)).invites).toEqual([]);
    // Direct invites off → forbidden; a block → BLOCKED.
    w.api.updateProfile(w.careerOf(marta.careerId).userId, { acceptDirectInvites: false });
    expect(error(() => w.api.createInvite(w.career, marta.careerId)).details).toMatchObject({
      reason: 'DIRECT_INVITES_OFF',
    });
    w.api.updateProfile(w.careerOf(marta.careerId).userId, { acceptDirectInvites: true });
    block(w.engine, w.careerOf(marta.careerId), w.career.summary.id);
    expect(error(() => w.api.createInvite(w.career, marta.careerId)).code).toBe('BLOCKED');
    expect(w.api.directorCard(w.career, marta.careerId).canInvite).toBe(false);
    // As an ally her presence is visible — unless she hides it.
    const invite2 = w.api.createInvite(w.career);
    const luca = w.ally('Luca', { onDuty: false, online: true });
    w.api.join(w.careerOf(luca.careerId), { inviteCode: invite2.code! });
    expect(w.api.directorCard(w.career, luca.careerId)).toMatchObject({
      isAlly: true,
      presence: 'ONLINE',
      lastSeen: 'TODAY',
    });
    w.api.updateProfile(w.careerOf(luca.careerId).userId, { showOnDuty: false });
    expect(w.api.directorCard(w.career, luca.careerId).presence).toBeNull();
    expect(w.api.members(w.career).find((m) => m.directorName === 'Luca')?.presence).toBeNull();
  });

  it('succession: a coordinator away for 14 days hands the role to the oldest deputy', () => {
    const w = world();
    w.api.found(w.career, FOUND);
    const invite = w.api.createInvite(w.career);
    const marta = w.ally('Marta');
    const luca = w.ally('Luca');
    w.api.join(w.careerOf(marta.careerId), { inviteCode: invite.code! });
    w.api.join(w.careerOf(luca.careerId), { inviteCode: invite.code! });
    const luc = w.api.members(w.career).find((m) => m.directorName === 'Luca')!;
    w.api.setRole(w.career, luc.id, 'DEPUTY');
    w.career.lastSeenAt = w.engine.now() - 15 * DAY;
    const home = w.api.home(w.careerOf(marta.careerId));
    expect(home.alliance?.coordinator.directorName).toBe('Luca');
    expect(w.api.home(w.career).alliance?.me.role).toBe('MEMBER');
    expect(w.api.log(w.careerOf(luca.careerId)).data[0]).toMatchObject({ action: 'LEADERSHIP_SUCCEEDED' });
  });

  it('account deletion: sessions revoked, sign-in refused until cancelled', () => {
    const w = world();
    const result = requestAccountDeletion(w.engine, 'founder@example.com');
    expect(result.status).toBe('DELETION_REQUESTED');
    expect(Date.parse(result.scheduledAt) - w.engine.now()).toBe(7 * DAY);
    expect(w.engine.state.currentSession).toBeNull();
    const ch = w.engine.requestOtp('founder@example.com');
    expect(
      error(() => w.engine.verifyOtp({ challengeId: ch.challengeId, code: OTP_CODE }, 'vitest')).code,
    ).toBe('ACCOUNT_DELETING');
    const ch2 = w.engine.requestOtp('founder@example.com');
    w.engine.verifyOtp({ challengeId: ch2.challengeId, code: OTP_CODE, cancelDeletion: true }, 'vitest');
    expect(w.engine.state.users['founder@example.com']!.status).toBe('ACTIVE');
  });
});
