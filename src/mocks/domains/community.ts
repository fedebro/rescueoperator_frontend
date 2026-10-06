import {
  CreateReportBody,
  type AccountDeletionDto,
  type AccountExportDto,
  type BlockDto,
  type CommunityRulesDto,
  type MySanctionDto,
  type ReportDto,
} from '@/contracts';
import { MockError, iso, type MockCareer, type MockEngine } from '../engine';

/**
 * Player side of the platform agent's moderation + account contracts (study 04 §2.3, §6; contracts/moderation.ts,
 * account.ts): blocks, reports, community rules, sanctions, the real account deletion and the export. Admin moderation
 * (queue, decisions, text filter) is the platform agent's — not simulated here.
 */

/** The current version of the community rules (texts: `alliance.rules.*` in the client until the catalog serves them). */
export const COMMUNITY_RULES_VERSION = '2026-10';
/** `config.moderation.account.deletionGraceDays` (7) and `exportsPerDay` (3) of the backend. */
export const DELETION_GRACE_DAYS = 7;
export const EXPORTS_PER_DAY = 3;

interface CommunityWorld {
  /** Blocker career id → blocks. */
  blocks: Record<string, BlockDto[]>;
  /** Reporter career id → reports (newest first). */
  reports: Record<string, ReportDto[]>;
  /** User id → accepted version. */
  rules: Record<string, { version: string; acceptedAt: string }>;
  /** Email → scheduled deletion. */
  deletions: Record<string, { requestedAt: string; scheduledAt: string }>;
  /** User id → export instants of the day. */
  exports: Record<string, string[]>;
}

export const communityWorld = (engine: MockEngine): CommunityWorld =>
  (engine.state.ext.community ??= {
    blocks: {},
    reports: {},
    rules: {},
    deletions: {},
    exports: {},
  } satisfies CommunityWorld) as CommunityWorld;

/** `blocker` has blocked `target` (04 §2.3): the blocker no longer sees the target's texts; the target is never told. */
export function hasBlocked(engine: MockEngine, blocker: string, target: string): boolean {
  return !!communityWorld(engine).blocks[blocker]?.some((x) => x.careerId === target);
}
/** Either Director blocked the other: direct invites and mentions are refused both ways. */
export function isBlockedEither(engine: MockEngine, a: string, b: string): boolean {
  const w = communityWorld(engine);
  return !!w.blocks[a]?.some((x) => x.careerId === b) || !!w.blocks[b]?.some((x) => x.careerId === a);
}
export const rulesAcceptedBy = (engine: MockEngine, userId: string): boolean =>
  communityWorld(engine).rules[userId]?.version === COMMUNITY_RULES_VERSION;

export function listBlocks(engine: MockEngine, career: MockCareer): BlockDto[] {
  const list = communityWorld(engine).blocks[career.summary.id] ?? [];
  // Names are resolved at read time (a renamed or deleted Director).
  return list.map((b) => ({
    ...b,
    directorName: engine.state.careers[b.careerId]?.summary.directorName ?? 'Direttore eliminato',
  }));
}
export function block(engine: MockEngine, career: MockCareer, targetCareerId: unknown): BlockDto {
  if (typeof targetCareerId !== 'string' || !/^car_[0-9A-HJKMNP-TV-Z]{26}$/.test(targetCareerId))
    throw new MockError(422, 'VALIDATION_ERROR', 'careerId required');
  if (targetCareerId === career.summary.id)
    throw new MockError(409, 'CONFLICT', 'Cannot block yourself', { reason: 'SELF' });
  const target = engine.state.careers[targetCareerId];
  if (!target) throw new MockError(404, 'NOT_FOUND', 'Director not found');
  const list = (communityWorld(engine).blocks[career.summary.id] ??= []);
  const existing = list.find((b) => b.careerId === targetCareerId);
  if (existing) return existing;
  const row: BlockDto = {
    id: engine.id('blk'),
    careerId: targetCareerId,
    directorName: target.summary.directorName,
    createdAt: iso(engine.now()),
  };
  list.push(row);
  engine.save();
  return row;
}
export function unblock(engine: MockEngine, career: MockCareer, blockId: string): void {
  const w = communityWorld(engine);
  const list = w.blocks[career.summary.id] ?? [];
  if (!list.some((b) => b.id === blockId)) throw new MockError(404, 'NOT_FOUND', 'Block not found');
  w.blocks[career.summary.id] = list.filter((b) => b.id !== blockId);
  engine.save();
}

export function createReport(engine: MockEngine, career: MockCareer, raw: unknown): ReportDto {
  const parsed = CreateReportBody.safeParse(raw);
  if (!parsed.success)
    throw new MockError(422, 'VALIDATION_ERROR', 'Invalid report', {
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  const body = parsed.data;
  const list = (communityWorld(engine).reports[career.summary.id] ??= []);
  // One case per target and reporter: a repeat returns the existing case.
  const existing = list.find((r) => r.targetKind === body.targetKind && r.targetId === body.targetId);
  if (existing) return existing;
  if (list.filter((r) => engine.now() - Date.parse(r.createdAt) < 3_600_000).length >= 10)
    throw new MockError(429, 'RATE_LIMITED', 'Too many reports', { reason: 'HOURLY_LIMIT' });
  const report: ReportDto = {
    id: engine.id('rep'),
    targetKind: body.targetKind,
    targetId: body.targetId,
    reason: body.reason,
    note: body.note ?? null,
    status: 'OPEN',
    outcome: null,
    createdAt: iso(engine.now()),
    resolvedAt: null,
  };
  list.unshift(report);
  engine.save();
  return report;
}
export const myReports = (engine: MockEngine, career: MockCareer): ReportDto[] =>
  (communityWorld(engine).reports[career.summary.id] ?? []).slice(0, 50);

export function communityRules(engine: MockEngine, userId: string): CommunityRulesDto {
  const accepted = communityWorld(engine).rules[userId];
  return {
    version: COMMUNITY_RULES_VERSION,
    acceptedVersion: accepted?.version ?? null,
    acceptedAt: accepted?.acceptedAt ?? null,
    accepted: accepted?.version === COMMUNITY_RULES_VERSION,
  };
}
export function acceptCommunityRules(
  engine: MockEngine,
  userId: string,
  version: unknown,
): CommunityRulesDto {
  if (version !== COMMUNITY_RULES_VERSION)
    throw new MockError(409, 'CONFLICT', 'Not the current rules version', {
      reason: 'VERSION_MISMATCH',
      current: COMMUNITY_RULES_VERSION,
    });
  communityWorld(engine).rules[userId] = { version: COMMUNITY_RULES_VERSION, acceptedAt: iso(engine.now()) };
  engine.save();
  return communityRules(engine, userId);
}

export const mySanctions = (): MySanctionDto[] => [];

/** ★POST /me/delete: the account goes to DELETION_REQUESTED, every session is revoked, the job runs in 7 days. */
export function requestAccountDeletion(engine: MockEngine, email: string): AccountDeletionDto {
  const account = engine.state.users[email];
  if (!account) throw new MockError(404, 'NOT_FOUND', 'Account not found');
  const w = communityWorld(engine);
  const existing = w.deletions[email];
  const requestedAt = existing?.requestedAt ?? iso(engine.now());
  const scheduledAt = existing?.scheduledAt ?? iso(engine.now() + DELETION_GRACE_DAYS * 86_400_000);
  w.deletions[email] = { requestedAt, scheduledAt };
  account.status = 'DELETION_REQUESTED';
  account.sessions = [];
  for (const [token, owner] of [...engine.accessTokens])
    if (owner === email) engine.accessTokens.delete(token);
  if (engine.state.currentSession?.email === email) engine.logout();
  engine.save();
  return { status: 'DELETION_REQUESTED', requestedAt, scheduledAt };
}
export const deletionOf = (engine: MockEngine, email: string) => communityWorld(engine).deletions[email];
export function cancelAccountDeletion(engine: MockEngine, email: string): void {
  const account = engine.state.users[email];
  if (account && account.status === 'DELETION_REQUESTED') account.status = 'ACTIVE';
  delete communityWorld(engine).deletions[email];
}

/** GET /me/export: the player's own data, rate limited per day. */
export function exportAccount(engine: MockEngine, email: string): AccountExportDto {
  const account = engine.state.users[email];
  if (!account) throw new MockError(404, 'NOT_FOUND', 'Account not found');
  const w = communityWorld(engine);
  const today = (w.exports[account.user.id] ?? []).filter((at) => engine.now() - Date.parse(at) < 86_400_000);
  if (today.length >= EXPORTS_PER_DAY)
    throw new MockError(429, 'RATE_LIMITED', 'Export limit reached', { reason: 'DAILY_LIMIT' });
  w.exports[account.user.id] = [...today, iso(engine.now())];
  const careers = Object.values(engine.state.careers).filter((c) => c.userId === account.user.id);
  engine.save();
  return {
    exportedAt: iso(engine.now()),
    format: 'rescue-control-account-export/1',
    user: {
      id: account.user.id,
      email: account.user.email,
      directorName: account.user.directorName,
      locale: account.user.locale,
      createdAt: account.user.createdAt,
      status: account.status,
      marketingConsent: account.marketingConsent,
    },
    careers: careers.map((c) => ({
      id: c.summary.id,
      status: 'ACTIVE',
      level: c.summary.level,
      xpTotal: c.summary.xp,
      reputation: c.summary.reputation,
      incidentsResolved: c.stats.resolved,
      incidentsFailed: c.stats.failed,
      createdAt: c.summary.createdAt,
      locationName: c.summary.locationName,
    })),
    sections: {
      notifications: careers.flatMap((c) => c.notifications),
      ledger: careers.flatMap((c) => c.ledger),
      blocks: careers.flatMap((c) => w.blocks[c.summary.id] ?? []),
      reports: careers.flatMap((c) => w.reports[c.summary.id] ?? []),
      communityRules: w.rules[account.user.id] ?? null,
    },
  };
}

export function installCommunity(engine: MockEngine): void {
  /** QA: the current user accepted the community rules (needed before any free text). */
  engine.qa.acceptRules = (() => {
    const email = engine.state.currentSession?.email;
    const user = email ? engine.state.users[email] : undefined;
    if (!user) throw new MockError(404, 'NOT_FOUND', 'No session');
    acceptCommunityRules(engine, user.user.id, COMMUNITY_RULES_VERSION);
  }) as never;
  /** QA: the current career blocks a Director. */
  engine.qa.blockDirector = ((careerId: string) => block(engine, engine.qa.career(), careerId)) as never;
}
