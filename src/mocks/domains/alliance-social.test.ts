import { describe, expect, it } from 'vitest';
import { AllianceMessageDto, AlliancePostDto, type RealtimeEnvelope } from '@/contracts';
import { xpThreshold } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { MockEngine, OTP_CODE, memoryStorage, type MockCareer, type MockError } from '../engine';
import { installDomains } from './index';
import { allianceApiOf } from './alliance';
import { allianceSocialOf } from './alliance-social';
import { acceptCommunityRules, block, COMMUNITY_RULES_VERSION } from './community';

const MIN = 60_000;

function world() {
  let now = Date.parse('2026-10-06T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 11;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random,
  });
  installDomains(engine);
  engine.state.featureFlags.alliance_board = true;
  engine.state.featureFlags.alliance_chat = true;
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
  engine.awardXp(career, xpThreshold(5));
  engine.credit(career, 5000, 'ADMIN_ADJUSTMENT');
  // Writing needs an account older than 24 h and the rules accepted (04 §2.1).
  account.user.createdAt = new Date(now - 2 * 86_400_000).toISOString();
  acceptCommunityRules(engine, account.user.id, COMMUNITY_RULES_VERSION);
  const alliances = allianceApiOf(engine);
  const social = allianceSocialOf(engine);
  const qa = engine.qa as unknown as Record<string, (...a: never[]) => unknown>;
  const ally = (name: string) =>
    (qa.simulateAlly as (n: string, o?: Record<string, unknown>) => { careerId: string })(name, {}).careerId;
  const careerOf = (id: string) => engine.state.careers[id]!;
  alliances.found(career, {
    name: 'Abruzzo Soccorso',
    tag: 'ABR',
    emblem: { shape: 'SHIELD', symbol: 'FLAME', primaryColor: 'RED', secondaryColor: 'SILVER' },
    description: '',
    language: 'it',
    joinPolicy: 'OPEN',
    minLevel: null,
  });
  const invite = alliances.createInvite(career);
  const marta = ally('Marta');
  const martaCareer = careerOf(marta);
  alliances.join(martaCareer, { inviteCode: invite.code });
  const martaUser = Object.values(engine.state.users).find((u) => u.user.id === martaCareer.userId)!;
  acceptCommunityRules(engine, martaUser.user.id, COMMUNITY_RULES_VERSION);
  const allianceId = alliances.membershipOf(career.summary.id)!.alliance.id;
  const general = alliances.membershipOf(career.summary.id)!.alliance.generalChannelId;
  return {
    engine,
    career,
    martaCareer,
    allianceId,
    general,
    events,
    alliances,
    social,
    careerOf,
    tick: (ms: number) => (now += ms),
  };
}
const error = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as MockError;
  }
  throw new Error('expected a MockError');
};

describe('mock board', () => {
  it('posts a note, an announcement pinned by a high role, replies and reactions; the stream carries viewer-neutral DTOs', () => {
    const w = world();
    const note = w.social.createPost(w.martaCareer, { kind: 'NOTE', text: 'Turno di stasera: chi c’è?' });
    expect(AlliancePostDto.safeParse(note).success).toBe(true);
    expect(note).toMatchObject({
      kind: 'NOTE',
      mine: true,
      pinned: false,
      author: { directorName: 'Marta', role: 'MEMBER' },
    });
    expect(note.editableUntil).not.toBeNull();
    // A member cannot announce; the coordinator can and pins it.
    expect(error(() => w.social.createPost(w.martaCareer, { kind: 'ANNOUNCEMENT', text: 'x' })).code).toBe(
      'ROLE_REQUIRED',
    );
    const ann = w.social.createPost(w.career, { kind: 'ANNOUNCEMENT', text: 'Regole del turno', pin: true });
    expect(ann.pinned).toBe(true);
    expect(w.martaCareer.notifications[0]).toMatchObject({
      category: 'ALLIANCE',
      action: { targetId: `post:${ann.id}` },
    });
    // Order: pinned first, then newest.
    const page = w.social.listPosts(w.career, {});
    expect(page.data.map((p) => p.id)).toEqual([ann.id, note.id]);
    // Replies and one reaction per member.
    const reply = w.social.createReply(w.career, note.id, { text: 'Ci sono io.' });
    expect(reply.mine).toBe(true);
    const reacted = w.social.react(w.career, note.id, { reaction: 'PRESENT' });
    expect(reacted.reactions.find((r) => r.reaction === 'PRESENT')).toMatchObject({ count: 1, mine: true });
    expect(
      w.social.react(w.career, note.id, { reaction: 'ACK' }).reactions.filter((r) => r.count > 0),
    ).toHaveLength(1);
    expect(w.social.react(w.career, note.id, { reaction: null }).reactions.every((r) => r.count === 0)).toBe(
      true,
    );
    expect(w.social.getPost(w.martaCareer, note.id)).toMatchObject({ replyCount: 1, mine: true });
    // The room's view of the post has no viewer fields.
    const box = w.engine.state.ext.alliances as {
      outbox: Record<string, { type: string; payload: Record<string, unknown> }[]>;
    };
    const created = box.outbox[w.allianceId]!.filter((e) => e.type === 'alliance.post.created');
    expect(created).toHaveLength(2);
    expect(created[0]!.payload.post).toMatchObject({ mine: false, editableUntil: null });
  });

  it('enforces the edit window, the daily limits, removal rights and the text filter', () => {
    const w = world();
    const note = w.social.createPost(w.martaCareer, { kind: 'NOTE', text: 'Prima versione' });
    expect(w.social.updatePost(w.martaCareer, note.id, { text: 'Seconda versione' }).editedAt).not.toBeNull();
    w.tick(16 * MIN);
    expect(error(() => w.social.updatePost(w.martaCareer, note.id, { text: 'Terza' })).details).toMatchObject(
      { reason: 'EDIT_WINDOW_EXPIRED' },
    );
    expect(
      error(() => w.social.createPost(w.martaCareer, { kind: 'NOTE', text: 'Scrivimi su www.esempio.it' }))
        .code,
    ).toBe('TEXT_REJECTED');
    for (let i = 0; i < 4; i++) w.social.createPost(w.martaCareer, { kind: 'NOTE', text: `Nota ${i}` });
    expect(
      error(() => w.social.createPost(w.martaCareer, { kind: 'NOTE', text: 'Una di troppo' })).details,
    ).toMatchObject({ reason: 'DAILY_LIMIT' });
    // Removal: own anytime; others only by a high role (logged).
    const first = w.social.listPosts(w.career, {}).data.at(-1)!;
    expect(
      error(() =>
        w.social.deletePost(
          w.martaCareer,
          w.social.createPost(w.career, { kind: 'ANNOUNCEMENT', text: 'Del coordinatore' }).id,
        ),
      ).code,
    ).toBe('ROLE_REQUIRED');
    w.social.deletePost(w.career, first.id);
    expect(w.social.getPost(w.martaCareer, first.id)).toMatchObject({ removed: true, text: null });
    expect(w.alliances.log(w.career).data[0]).toMatchObject({ action: 'POST_REMOVED' });
    // Preconditions: rules not accepted → 403; read-only → 409 for text, reactions still fine.
    const luca = (
      w.engine.qa as unknown as {
        simulateAlly: (n: string, o: { rulesAccepted: boolean }) => { careerId: string };
      }
    ).simulateAlly('Luca', { rulesAccepted: false });
    w.alliances.join(w.careerOf(luca.careerId), { inviteCode: w.alliances.invites(w.career)[0]!.code });
    expect(
      error(() => w.social.createPost(w.careerOf(luca.careerId), { kind: 'NOTE', text: 'Ciao' })).code,
    ).toBe('RULES_NOT_ACCEPTED');
    const mine = w.social.createPost(w.career, { kind: 'NOTE', text: 'La mia nota' });
    w.alliances.alliance(w.allianceId)!.readOnly.board = true;
    expect(error(() => w.social.createPost(w.career, { kind: 'NOTE', text: 'Ciao' })).details).toMatchObject({
      reason: 'READ_ONLY',
    });
    expect(w.social.react(w.career, mine.id, { reaction: 'THANKS' }).reactions.some((r) => r.mine)).toBe(
      true,
    );
  });

  it('counts the unread board posts of others until the read marker moves', () => {
    const w = world();
    w.social.createPost(w.martaCareer, { kind: 'NOTE', text: 'Uno' });
    w.social.createPost(w.career, { kind: 'NOTE', text: 'Mio' });
    expect(w.engine.snapshot(w.career).alliance?.unread.board).toBe(1);
    expect(w.social.readBoard(w.career).board).toBe(0);
    expect(w.engine.snapshot(w.career).alliance?.unread.board).toBe(0);
  });
});

describe('mock chat', () => {
  it('sends text and quick phrases, pages newest-first towards older, mentions notify, unread follows the marker', () => {
    const w = world();
    const m1 = w.social.sendMessage(w.martaCareer, w.general, {
      kind: 'TEXT',
      text: 'Serve una pompa a Chieti',
      mentions: [w.career.summary.id],
    });
    expect(AllianceMessageDto.safeParse(m1).success).toBe(true);
    expect(m1).toMatchObject({
      kind: 'TEXT',
      mentions: [{ careerId: w.career.summary.id, directorName: 'Federico' }],
      mine: true,
    });
    expect(m1.deletableUntil).not.toBeNull();
    expect(w.career.notifications[0]).toMatchObject({
      category: 'ALLIANCE',
      action: { kind: 'OPEN_ALLIANCE', targetId: 'chat' },
    });
    w.tick(1000);
    const q = w.social.sendMessage(w.career, w.general, { kind: 'QUICK', code: 'COMING' });
    expect(q).toMatchObject({ kind: 'QUICK', quick: { code: 'COMING' }, text: null });
    expect(w.social.listChannels(w.career)[0]).toMatchObject({ kind: 'GENERAL', unread: 0 });
    expect(w.social.listChannels(w.martaCareer)[0]!.unread).toBe(1);
    expect(w.engine.snapshot(w.martaCareer).alliance?.unread.chat).toBe(1);
    expect(w.social.readChannel(w.martaCareer, w.general, {}).chat).toBe(0);
    // Pages: newest first; the cursor walks towards older.
    (w.engine.qa as unknown as { allyFlood: (id: string, n: number) => void }).allyFlood(
      w.martaCareer.summary.id,
      120,
    );
    const page1 = w.social.listMessages(w.career, w.general, {});
    expect(page1.data).toHaveLength(50);
    expect(page1.hasMore).toBe(true);
    expect(Date.parse(page1.data[0]!.createdAt)).toBeGreaterThanOrEqual(
      Date.parse(page1.data[49]!.createdAt),
    );
    const page2 = w.social.listMessages(w.career, w.general, { cursor: page1.nextCursor! });
    expect(page2.data[0]!.id).not.toBe(page1.data[49]!.id);
    expect(Date.parse(page2.data[0]!.createdAt)).toBeLessThanOrEqual(Date.parse(page1.data[49]!.createdAt));
  });

  it('rate limits, refuses duplicates and links, deletes within 5 minutes, hides blocked authors', () => {
    const w = world();
    expect(
      error(() =>
        w.social.sendMessage(w.career, w.general, { kind: 'TEXT', text: 'chiamami al 333 1234567' }),
      ).code,
    ).toBe('TEXT_REJECTED');
    w.social.sendMessage(w.career, w.general, { kind: 'TEXT', text: 'Stesso testo' });
    expect(
      error(() => w.social.sendMessage(w.career, w.general, { kind: 'TEXT', text: 'Stesso testo' })).details,
    ).toMatchObject({ reason: 'DUPLICATE_MESSAGE' });
    for (let i = 0; i < 4; i++)
      w.social.sendMessage(w.career, w.general, { kind: 'TEXT', text: `Raffica ${i}` });
    expect(error(() => w.social.sendMessage(w.career, w.general, { kind: 'TEXT', text: 'Sesto' })).code).toBe(
      'RATE_LIMITED',
    );
    w.tick(2 * MIN);
    const mine = w.social.sendMessage(w.career, w.general, { kind: 'TEXT', text: 'Da cancellare' });
    w.social.deleteMessage(w.career, mine.id);
    expect(w.social.listMessages(w.martaCareer, w.general, {}).data[0]).toMatchObject({
      removed: true,
      text: null,
    });
    const old = w.social.sendMessage(w.martaCareer, w.general, { kind: 'TEXT', text: 'Vecchio' });
    w.tick(6 * MIN);
    expect(error(() => w.social.deleteMessage(w.martaCareer, old.id)).details).toMatchObject({
      reason: 'DELETE_WINDOW_EXPIRED',
    });
    // A high role removes anytime (logged); a muted member keeps the quick phrases.
    w.social.deleteMessage(w.career, old.id);
    expect(w.alliances.log(w.career).data[0]).toMatchObject({ action: 'MESSAGE_REMOVED' });
    const martaMember = w.alliances.members(w.career).find((m) => m.directorName === 'Marta')!;
    w.alliances.mute(w.career, martaMember.id, 'H1');
    expect(
      error(() => w.social.sendMessage(w.martaCareer, w.general, { kind: 'TEXT', text: 'Zitto?' })).code,
    ).toBe('MUTED');
    expect(w.social.sendMessage(w.martaCareer, w.general, { kind: 'QUICK', code: 'THANKS' }).kind).toBe(
      'QUICK',
    );
    // Blocks: the blocker no longer sees the text; the author is not told.
    block(w.engine, w.career, w.martaCareer.summary.id);
    const seen = w.social
      .listMessages(w.career, w.general, {})
      .data.find((x) => x.author.careerId === w.martaCareer.summary.id && x.kind === 'QUICK');
    expect(seen).toMatchObject({ hiddenByBlock: true });
    expect(w.social.listMessages(w.martaCareer, w.general, {}).data.every((x) => !x.hiddenByBlock)).toBe(
      true,
    );
  });
});
