import type {
  AllianceObjectiveDto,
  AllianceObjectiveType,
  AllianceObjectivesDto,
  AllianceRankingDto,
  AllianceRankingEntryDto,
  AllianceXpEntryDto,
  AllianceXpSource,
  IncidentDto,
} from '@/contracts';
import { MockError, type MockCareer, type MockEngine } from '../engine';
import { allianceApiOf, activeMembers, DAY, HOUR, type MockAlliance } from './alliance';
import { aidHooksOf } from './alliance-aid';

/**
 * Alliance progression (study 06, backend notes §Phase 3 when they land): the XP ledger with its weekly per-member cap, the
 * three weekly objectives sized on the active members, the weekly ranking of alliances (sum of the 10 best members, at least
 * 3 scoring) and the Monday rollover. Simulated competitors are synthetic alliances (`qa.simulateRanking`).
 */
export const PROGRESS_CFG = {
  incidentXp: 1,
  incidentXpWeeklyCap: 60,
  columnXp: 15,
  objectiveXp: {
    VOLUME: 150,
    COOPERATION: 200,
    QUALITY: 250,
    MEDICAL: 250,
    OPERATIONS: 300,
    PRESENCE: 150,
  } as Record<AllianceObjectiveType, number>,
  objectiveMemberCredits: 150,
  objectiveMemberXp: 60,
  objectiveMinShare: 0.05,
  objectiveMinCount: 3,
  rankingBestOf: 10,
  rankingMinScoringMembers: 3,
  rankingXp: [400, 250, 100],
  topEntries: 20,
};
/** Mock-local Europe/Rome: a fixed +2 h (the week turns on Monday 00:00 local). */
const TZ_OFFSET = 2 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
export const weekStartOf = (now: number): number => {
  const local = new Date(now + TZ_OFFSET);
  const day = (local.getUTCDay() + 6) % 7;
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - day * DAY - TZ_OFFSET;
};
const weekKeyOf = (now: number) => iso(weekStartOf(now)).slice(0, 10);

export const FRAMES: readonly (string | null)[] = ['GOLD', 'SILVER', 'BRONZE'];

interface MockObjective {
  id: string;
  type: AllianceObjectiveType;
  target: number;
  progress: number;
  completed: boolean;
  completedAt: number | null;
  contributions: Record<string, number>;
  paid: Record<string, number>;
}
interface MockXpEntry {
  id: string;
  source: AllianceXpSource;
  points: number;
  careerId: string | null;
  capped: boolean;
  createdAt: number;
}
export interface SyntheticAlliance {
  id: string;
  name: string;
  tag: string;
  level: number;
  score: number;
  scoringMembers: number;
}
export interface ProgressWorld {
  objectives: Record<
    string,
    {
      week: string;
      list: MockObjective[];
      generatedAt: number;
      lastWeek: { completed: number; total: number } | null;
    }
  >;
  xp: Record<string, MockXpEntry[]>;
  points: Record<string, Record<string, number>>;
  incidentXp: Record<string, Record<string, number>>;
  presence: Record<string, Record<string, string[]>>;
  synthetic: SyntheticAlliance[];
  lastWeek: Record<string, AllianceRankingDto['lastWeek']>;
  rolloverScheduled: string | null;
}
export const progressWorld = (engine: MockEngine): ProgressWorld =>
  (engine.state.ext.allianceProgress ??= {
    objectives: {},
    xp: {},
    points: {},
    incidentXp: {},
    presence: {},
    synthetic: [],
    lastWeek: {},
    rolloverScheduled: null,
  } satisfies ProgressWorld) as ProgressWorld;

const ROTATION: AllianceObjectiveType[] = ['QUALITY', 'MEDICAL', 'OPERATIONS', 'PRESENCE'];
const SYNTHETIC_NAMES = [
  ['Soccorso Marsica', 'MARS'],
  ['Gran Sasso Rescue', 'GSR'],
  ['Adriatico Nord', 'ADRN'],
  ['Valle Peligna', 'VPEL'],
  ['Costa dei Trabocchi', 'CDT'],
  ['Majella Soccorso', 'MAJ'],
  ['Aterno Pescara', 'ATP'],
  ['Teramo Centrale', 'TERC'],
  ['Sangro Aventino', 'SNGR'],
  ['Alto Vastese', 'AVST'],
  ['Fucino Operativa', 'FUC'],
  ['Trigno Sinello', 'TRIG'],
];

export function installAllianceProgress(engine: MockEngine): void {
  const alliances = allianceApiOf(engine);
  const world = () => progressWorld(engine);
  const flagOn = (flag: 'alliance_objectives' | 'alliance_ranking') =>
    engine.state.featureFlags[flag] === true;
  const careerById = (id: string): MockCareer | undefined => engine.state.careers[id];
  const nameOf = (careerId: string | null) =>
    careerId ? (careerById(careerId)?.summary.directorName ?? null) : null;
  const membership = (career: MockCareer) => {
    const m = alliances.membershipOf(career.summary.id);
    if (!m) throw new MockError(403, 'NOT_ALLIANCE_MEMBER', 'Not a member of an alliance');
    return m;
  };
  const week = (now = engine.now()) => ({ start: weekStartOf(now), end: weekStartOf(now) + 7 * DAY });
  const pointsOf = (now = engine.now()) => (world().points[weekKeyOf(now)] ??= {});

  /* ───────────── XP ledger ───────────── */
  const addXp = (a: MockAlliance, source: AllianceXpSource, points: number, careerId: string | null) => {
    let capped = false;
    let granted = points;
    if (source === 'INCIDENT_RESOLVED' && careerId) {
      const bucket = (world().incidentXp[weekKeyOf(engine.now())] ??= {});
      const used = bucket[careerId] ?? 0;
      granted = Math.max(0, Math.min(points, PROGRESS_CFG.incidentXpWeeklyCap - used));
      capped = granted < points;
      bucket[careerId] = used + granted;
    }
    (world().xp[a.id] ??= []).unshift({
      id: engine.id('axp'),
      source,
      points: granted,
      careerId,
      capped,
      createdAt: engine.now(),
    });
    if (granted > 0) {
      a.xp += granted;
      // The level and the XP live on the alliance itself: the section re-reads (reducer: invalidate all).
      alliances.emitAlliance(a.id, 'alliance.updated', { alliance: null });
    }
  };
  const xpDto = (e: MockXpEntry): AllianceXpEntryDto => ({
    id: e.id,
    source: e.source,
    points: e.points,
    member: e.careerId ? { careerId: e.careerId, directorName: nameOf(e.careerId) } : null,
    capped: e.capped,
    createdAt: iso(e.createdAt),
  });

  /* ───────────── objectives ───────────── */
  const targetFor = (type: AllianceObjectiveType, members: number): number => {
    const n = Math.max(2, members);
    switch (type) {
      case 'VOLUME':
        return 15 * n;
      case 'COOPERATION':
        return 2 * n;
      case 'QUALITY':
        return 5 * n;
      case 'MEDICAL':
        return 4 * n;
      case 'OPERATIONS':
        return 1;
      case 'PRESENCE':
        return Math.min(n, 6);
    }
  };
  const generate = (a: MockAlliance, now: number) => {
    const key = weekKeyOf(now);
    const members = activeMembers(a).length;
    const weekNo = Math.floor(weekStartOf(now) / (7 * DAY));
    const types: AllianceObjectiveType[] = ['VOLUME', 'COOPERATION', ROTATION[weekNo % ROTATION.length]!];
    return {
      week: key,
      generatedAt: now,
      lastWeek: null as { completed: number; total: number } | null,
      list: types.map((type) => ({
        id: engine.id('aob'),
        type,
        target: targetFor(type, members),
        progress: 0,
        completed: false,
        completedAt: null,
        contributions: {},
        paid: {},
      })),
    };
  };
  const objectivesOf = (a: MockAlliance) => {
    const now = engine.now();
    const current = world().objectives[a.id];
    if (!current || current.week !== weekKeyOf(now)) {
      const next = generate(a, now);
      next.lastWeek = current
        ? { completed: current.list.filter((o) => o.completed).length, total: current.list.length }
        : null;
      world().objectives[a.id] = next;
    }
    return world().objectives[a.id]!;
  };
  const thresholdOf = (o: MockObjective) =>
    Math.max(
      1,
      Math.min(Math.ceil(o.target * PROGRESS_CFG.objectiveMinShare), PROGRESS_CFG.objectiveMinCount),
    );
  const objectiveDto = (o: MockObjective, viewerId: string): AllianceObjectiveDto => {
    const mine = o.contributions[viewerId] ?? 0;
    return {
      id: o.id,
      type: o.type,
      title: { key: `alliance.objective.${o.type}.title`, params: { target: o.target } },
      description: { key: `alliance.objective.${o.type}.description`, params: { target: o.target } },
      target: o.target,
      progress: Math.min(o.progress, o.target),
      completed: o.completed,
      completedAt: o.completedAt === null ? null : iso(o.completedAt),
      reward: {
        allianceXp: PROGRESS_CFG.objectiveXp[o.type],
        memberCredits: String(PROGRESS_CFG.objectiveMemberCredits),
        memberXp: String(PROGRESS_CFG.objectiveMemberXp),
        minShare: PROGRESS_CFG.objectiveMinShare,
        minCount: PROGRESS_CFG.objectiveMinCount,
      },
      contributions: Object.entries(o.contributions)
        .sort((x, y) => y[1] - x[1])
        .map(([careerId, value]) => ({ careerId, directorName: nameOf(careerId), value })),
      myContribution: mine,
      myRewardEligible: mine >= thresholdOf(o),
      myRewardPaidAt: o.paid[viewerId] === undefined ? null : iso(o.paid[viewerId]!),
    };
  };
  const objectivesDto = (a: MockAlliance, viewerId: string): AllianceObjectivesDto => {
    const state = objectivesOf(a);
    const w = week();
    return {
      week: { start: iso(w.start), end: iso(w.end) },
      objectives: state.list.map((o) => objectiveDto(o, viewerId)),
      activeMembersLastWeek: activeMembers(a).length,
      generatedAt: iso(state.generatedAt),
      lastWeek: state.lastWeek,
    };
  };
  const emitObjectives = (a: MockAlliance) =>
    alliances.emitAlliance(a.id, 'alliance.objectives.updated', { objectives: objectivesDto(a, '') });
  const complete = (a: MockAlliance, o: MockObjective) => {
    o.completed = true;
    o.completedAt = engine.now();
    addXp(a, 'OBJECTIVE', PROGRESS_CFG.objectiveXp[o.type], null);
    const threshold = thresholdOf(o);
    for (const m of activeMembers(a)) {
      const value = o.contributions[m.careerId] ?? 0;
      const career = careerById(m.careerId);
      if (!career) continue;
      if (value >= threshold) {
        engine.credit(career, PROGRESS_CFG.objectiveMemberCredits, 'ALLIANCE_OBJECTIVE', true);
        engine.awardXp(career, PROGRESS_CFG.objectiveMemberXp);
        o.paid[m.careerId] = engine.now();
      }
      alliances.notify(
        career,
        'OBJECTIVE_COMPLETED',
        { tag: a.tag, name: a.name, credits: value >= threshold ? PROGRESS_CFG.objectiveMemberCredits : 0 },
        'overview',
        'INFO',
      );
    }
    alliances.logAction(a.id, 'OBJECTIVE_COMPLETED' as never, null, null, {
      objectiveId: o.id,
      type: o.type,
    } as never);
  };
  const advance = (a: MockAlliance, type: AllianceObjectiveType, careerId: string | null, value: number) => {
    const o = objectivesOf(a).list.find((x) => x.type === type);
    if (!o || o.completed || value <= 0) return;
    o.progress += value;
    if (careerId) o.contributions[careerId] = (o.contributions[careerId] ?? 0) + value;
    if (o.progress >= o.target) complete(a, o);
    emitObjectives(a);
  };
  const setPresence = (a: MockAlliance, type: 'PRESENCE', value: number) => {
    const o = objectivesOf(a).list.find((x) => x.type === type);
    if (!o || o.completed || value <= o.progress) return;
    o.progress = value;
    if (o.progress >= o.target) complete(a, o);
    emitObjectives(a);
  };
  /** PRESENCE: distinct members on duty on the same day (sampled whenever the objectives are read or something lands). */
  const samplePresence = (a: MockAlliance) => {
    const bucket = (world().presence[weekKeyOf(engine.now())] ??= {});
    const dayKey = iso(engine.now() + TZ_OFFSET).slice(0, 10);
    const today = new Set(bucket[dayKey] ?? []);
    for (const m of activeMembers(a)) {
      const career = careerById(m.careerId);
      if (career && alliances.presenceOf(career) === 'ON_DUTY') today.add(m.careerId);
    }
    bucket[dayKey] = [...today];
    setPresence(a, 'PRESENCE', Math.max(...Object.values(bucket).map((d) => d.length), 0));
  };

  /* ───────────── weekly points (ranking) ───────────── */
  const addPoints = (careerId: string, points: number) => {
    const bucket = pointsOf();
    bucket[careerId] = (bucket[careerId] ?? 0) + points;
  };
  const scoreOf = (a: MockAlliance, now = engine.now()) => {
    const bucket = pointsOf(now);
    const members = activeMembers(a)
      .map((m) => ({ careerId: m.careerId, points: bucket[m.careerId] ?? 0 }))
      .filter((m) => m.points > 0)
      .sort((x, y) => y.points - x.points);
    return {
      score: members.slice(0, PROGRESS_CFG.rankingBestOf).reduce((s, m) => s + m.points, 0),
      scoringMembers: members.length,
      top: members.slice(0, 3),
    };
  };
  const allRealAlliances = (): MockAlliance[] => {
    const seen = new Map<string, MockAlliance>();
    for (const career of Object.values(engine.state.careers)) {
      const m = alliances.membershipOf(career.summary.id);
      if (m && m.alliance.status === 'ACTIVE') seen.set(m.alliance.id, m.alliance);
    }
    return [...seen.values()];
  };
  const table = (now = engine.now()) => {
    const rows = [
      ...world().synthetic.map((s) => ({
        id: s.id,
        name: s.name,
        tag: s.tag,
        emblem: { shape: 'SHIELD', symbol: 'FLAME', primaryColor: 'RED', secondaryColor: 'SILVER' },
        level: s.level,
        score: s.score,
        scoringMembers: s.scoringMembers,
        top: null as { careerId: string; points: number }[] | null,
      })),
      ...allRealAlliances().map((a) => {
        const s = scoreOf(a, now);
        return {
          id: a.id,
          name: a.name,
          tag: a.tag,
          emblem: a.emblem,
          level: alliances.progressOf(a).level,
          score: s.score,
          scoringMembers: s.scoringMembers,
          top: s.top,
        };
      }),
    ];
    const ranked = rows
      .filter((r) => r.scoringMembers >= PROGRESS_CFG.rankingMinScoringMembers)
      .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
    return { rows, ranked };
  };
  const entryDto = (
    r: ReturnType<typeof table>['rows'][number],
    position: number,
    mineId: string | null,
  ): AllianceRankingEntryDto => ({
    position,
    alliance: { id: r.id, name: r.name, tag: r.tag, emblem: r.emblem as never, level: r.level },
    score: r.score,
    scoringMembers: r.scoringMembers,
    topContributors:
      r.id === mineId && r.top
        ? r.top.map((m) => ({ careerId: m.careerId, directorName: nameOf(m.careerId), points: m.points }))
        : null,
    isMine: r.id === mineId,
  });
  const ranking = (career: MockCareer): AllianceRankingDto => {
    const now = engine.now();
    const w = week(now);
    const base = {
      week: { start: iso(w.start), end: iso(w.end) },
      bestOf: PROGRESS_CFG.rankingBestOf,
      minScoringMembers: PROGRESS_CFG.rankingMinScoringMembers,
      rolloverAt: iso(w.end),
    };
    if (!flagOn('alliance_ranking'))
      return { enabled: false, ...base, entries: [], mine: null, myPoints: 0, lastWeek: null };
    const m = alliances.membershipOf(career.summary.id);
    const mineId = m?.alliance.id ?? null;
    const { rows, ranked } = table(now);
    const entries = ranked.slice(0, PROGRESS_CFG.topEntries).map((r, i) => entryDto(r, i + 1, mineId));
    const mineIndex = ranked.findIndex((r) => r.id === mineId);
    const mineRow = rows.find((r) => r.id === mineId);
    return {
      enabled: true,
      ...base,
      entries,
      mine: mineRow ? entryDto(mineRow, mineIndex === -1 ? 0 : mineIndex + 1, mineId) : null,
      myPoints: pointsOf(now)[career.summary.id] ?? 0,
      lastWeek: mineId ? (world().lastWeek[mineId] ?? null) : null,
    };
  };

  /* ───────────── rollover (Monday 00:00) ───────────── */
  const rollover = (at: number) => {
    const { ranked } = table(at - 1);
    for (const a of allRealAlliances()) {
      const index = ranked.findIndex((r) => r.id === a.id);
      world().lastWeek[a.id] = {
        position: index === -1 ? 0 : index + 1,
        score: index === -1 ? 0 : ranked[index]!.score,
        frame: (index >= 0 && index < 3 ? FRAMES[index] : null) as never,
        totalRanked: ranked.length,
      };
      if (index >= 0 && index < PROGRESS_CFG.rankingXp.length)
        addXp(a, 'RANKING', PROGRESS_CFG.rankingXp[index]!, null);
      // A new period starts now (also when QA forces it inside the same calendar week): fresh objectives, the old ones
      // summarised as `lastWeek`.
      const current = world().objectives[a.id];
      const next = generate(a, at);
      next.lastWeek = current
        ? { completed: current.list.filter((o) => o.completed).length, total: current.list.length }
        : null;
      world().objectives[a.id] = next;
      for (const m of activeMembers(a)) {
        const career = careerById(m.careerId);
        if (career)
          alliances.notify(
            career,
            'RANKING_RESULT',
            { tag: a.tag, name: a.name, position: index === -1 ? 0 : index + 1 },
            'ranking',
            'INFO',
          );
      }
      emitObjectives(a);
      alliances.emitAlliance(a.id, 'alliance.ranking.updated', { ranking: null });
    }
    // The week's points start from zero (06 §3.3); the synthetic competitors move a little.
    world().points[weekKeyOf(at)] = {};
    world().presence[weekKeyOf(at)] = {};
    for (const s of world().synthetic) s.score = Math.round(s.score * (0.6 + engine.random() * 0.8));
  };
  engine.registerExecutor('ALLIANCE_WEEKLY_ROLLOVER', () => {
    world().rolloverScheduled = null;
    rollover(engine.now());
  });

  /* ───────────── sources ───────────── */
  const resolvedQuality = (incident: IncidentDto) =>
    incident.requirements.every((r) => r.onScene + (r.allied ?? 0) >= r.required);
  engine.hooks.incidentClosed.push((career, incident, status) => {
    const m = alliances.membershipOf(career.summary.id);
    if (!m || incident.isTutorial) return;
    const a = m.alliance;
    if (status === 'RESOLVED') {
      if (flagOn('alliance_objectives')) {
        advance(a, 'VOLUME', career.summary.id, 1);
        if (resolvedQuality(incident)) advance(a, 'QUALITY', career.summary.id, 1);
        if (incident.families.some((f) => String(f).startsWith('MED')))
          advance(a, 'MEDICAL', career.summary.id, 1);
        samplePresence(a);
      }
      addXp(a, 'INCIDENT_RESOLVED', PROGRESS_CFG.incidentXp, career.summary.id);
      addPoints(career.summary.id, incident.severity * 2);
    } else if (status === 'FAILED') addPoints(career.summary.id, Math.round(incident.severity * 0.5));
    engine.save();
  });

  const api: AllianceProgressApi = {
    objectives: (career) => {
      if (!flagOn('alliance_objectives')) return null;
      const m = membership(career);
      samplePresence(m.alliance);
      return objectivesDto(m.alliance, career.summary.id);
    },
    xp: (career, q) => {
      const m = membership(career);
      const list = world().xp[m.alliance.id] ?? [];
      const limit = Math.min(100, Math.max(1, q.limit ?? 50));
      const start = q.cursor ? Math.max(0, list.findIndex((e) => e.id === q.cursor) + 1) : 0;
      const page = list.slice(start, start + limit);
      const last = page.at(-1);
      return {
        data: page.map(xpDto),
        nextCursor: last && start + limit < list.length ? last.id : null,
        hasMore: start + limit < list.length,
      };
    },
    ranking,
    addXp: (allianceId, source, points, careerId) => {
      const a = alliances.alliance(allianceId);
      if (a) addXp(a, source, points, careerId);
    },
    addPoints,
    recordColumn: (helperCareerId, allianceId) => {
      const a = alliances.alliance(allianceId);
      if (!a) return;
      if (flagOn('alliance_objectives')) advance(a, 'COOPERATION', helperCareerId, 1);
      addXp(a, 'AID_COLUMN', PROGRESS_CFG.columnXp, helperCareerId);
      addPoints(helperCareerId, PROGRESS_CFG.columnXp);
    },
    recordOperation: (allianceId, succeeded, xp, participants) => {
      const a = alliances.alliance(allianceId);
      if (!a) return;
      addXp(a, 'OPERATION', xp, null);
      for (const p of participants) {
        addPoints(p.careerId, p.points);
        if (succeeded && flagOn('alliance_objectives')) advance(a, 'OPERATIONS', p.careerId, 1);
      }
    },
    rollover: () => rollover(engine.now()),
  };
  apis.set(engine, api);
  aidHooksOf(engine).columnPaid.push((c) => api.recordColumn(c.helperCareerId, c.allianceId));

  /* ───────────── QA ───────────── */
  engine.qa.simulateRanking = ((count = 11) => {
    const w = world();
    w.synthetic = Array.from({ length: Math.min(count, SYNTHETIC_NAMES.length) }, (_, i) => ({
      id: engine.id('all'),
      name: SYNTHETIC_NAMES[i]![0]!,
      tag: SYNTHETIC_NAMES[i]![1]!,
      level: 1 + Math.floor(engine.random() * 6),
      score: 200 + Math.floor(engine.random() * 2300),
      scoringMembers: 3 + Math.floor(engine.random() * 8),
    }));
    engine.save();
    return w.synthetic.length;
  }) as never;
  /** QA: weekly (ranking) points for a career — the current one when null. */
  engine.qa.addWeeklyPoints = ((careerId: string | null, points: number) => {
    addPoints(careerId ?? engine.qa.career().summary.id, points);
    engine.save();
  }) as never;
  /** QA: `value` more on an objective, credited to `careerId` (the current career when null). */
  engine.qa.objectiveProgress = ((type: AllianceObjectiveType, careerId: string | null, value: number) => {
    careerId ??= engine.qa.career().summary.id;
    const m = alliances.membershipOf(careerId);
    if (!m) throw new MockError(404, 'NOT_FOUND', 'No alliance');
    advance(m.alliance, type, careerId, value);
    engine.save();
    return objectivesDto(m.alliance, careerId);
  }) as never;
  engine.qa.weeklyRollover = (() => {
    rollover(engine.now());
    engine.save();
  }) as never;
  engine.qa.allianceXp = ((points: number) => {
    const career = engine.qa.career();
    const m = alliances.membershipOf(career.summary.id);
    if (!m) throw new MockError(404, 'NOT_FOUND', 'No alliance');
    addXp(m.alliance, 'OBJECTIVE', points, null);
    engine.save();
  }) as never;
}

export interface AllianceProgressApi {
  objectives: (career: MockCareer) => AllianceObjectivesDto | null;
  xp: (
    career: MockCareer,
    q: { cursor?: string; limit?: number },
  ) => { data: AllianceXpEntryDto[]; nextCursor: string | null; hasMore: boolean };
  ranking: (career: MockCareer) => AllianceRankingDto;
  addXp: (allianceId: string, source: AllianceXpSource, points: number, careerId: string | null) => void;
  addPoints: (careerId: string, points: number) => void;
  recordColumn: (helperCareerId: string, allianceId: string) => void;
  recordOperation: (
    allianceId: string,
    succeeded: boolean,
    xp: number,
    participants: { careerId: string; points: number }[],
  ) => void;
  rollover: () => void;
}
const apis = new WeakMap<MockEngine, AllianceProgressApi>();
export function allianceProgressOf(engine: MockEngine): AllianceProgressApi {
  const api = apis.get(engine);
  if (!api) throw new Error('alliance progress domain not installed');
  return api;
}
