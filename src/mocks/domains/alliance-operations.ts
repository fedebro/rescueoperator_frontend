import type {
  AllianceOperationDto,
  AllianceOperationFrontDto,
  AllianceOperationJoinBlock,
  AllianceOperationOutcome,
  AllianceOperationParticipantDto,
  AllianceOperationParticipantStatus,
  AllianceOperationStatus,
  MajorIncidentDto,
  MajorPhase,
} from '@/contracts';
import { MockError, type MockCareer, type MockEngine } from '../engine';
import { allianceApiOf, activeMembers, careerAlliance, type MockAlliance } from './alliance';
import { aidHooksOf, aidWorld } from './alliance-aid';
import { allianceProgressOf } from './alliance-progress';
import { allianceSocialOf } from './alliance-social';
import { majorOf } from './major';

/**
 * Alliance operations (study 07, 09 §5): one major incident per participant (the "front", a real major in the player's
 * world, a synthetic one for simulated allies) linked by a shared board and clock. ALERT (5 min, Partecipa / Non ora) →
 * ACTIVE (60–120 min, late join until the last phase) → ENDED with a collective outcome, or CANCELLED when fewer than two
 * joined. Started by QA / admin here (the organic trigger lives on the server).
 */
export const OPERATION_CFG = {
  alertSeconds: 300,
  minJoined: 2,
  minLevel: 5,
  lateJoinShare: 0.75,
  tickSeconds: 60,
  cooldownHours: 20,
  frontShare: 0.7,
  baseFrontCredits: 300,
  multiplier: { GOLD: 1.3, SILVER: 1.15, BRONZE: 1, FAILED: 0.7 } as Record<AllianceOperationOutcome, number>,
  allianceXp: { GOLD: 600, SILVER: 400, BRONZE: 300, FAILED: 200 } as Record<
    AllianceOperationOutcome,
    number
  >,
  recentMinutes: 60,
};
/** Alliance-scale scenarios (07 §6) and the catalog major each front is built from. */
export const OPERATION_SCENARIOS: Record<string, { front: string; durationMinutes: number; icon: string }> = {
  AOP_VALLEY_FLOOD: { front: 'MAJ_STORM_DAMAGE', durationMinutes: 90, icon: 'waves' },
  AOP_SEISMIC_SWARM: { front: 'MAJ_STRUCTURAL_COLLAPSE', durationMinutes: 120, icon: 'activity' },
  AOP_WILDFIRE: { front: 'MAJ_WILDFIRE_FRONT', durationMinutes: 90, icon: 'flame' },
  AOP_STORM_WAVE: { front: 'MAJ_STORM_DAMAGE', durationMinutes: 60, icon: 'cloud-lightning' },
  AOP_SNOWFALL: { front: 'MAJ_WINTER_STORM', durationMinutes: 90, icon: 'snowflake' },
};
/** The four operational phases of a front, in order (`ENDED` is terminal, not a phase of the board). */
const PHASES: readonly MajorPhase[] = ['ALARM', 'CONTAINMENT', 'RESCUE', 'SECURING'];
const iso = (ms: number) => new Date(ms).toISOString();

interface SyntheticFront {
  progress: number;
  coverage: number;
  sectors: number;
  sectorsClosed: number;
  ended: boolean;
}
interface MockParticipant {
  careerId: string;
  status: AllianceOperationParticipantStatus;
  joinedAt: number | null;
  majorId: string | null;
  synthetic: SyntheticFront | null;
  usefulColumns: number;
  reward: { eligible: boolean; multiplier: number | null; credits: number | null; xp: number | null };
}
export interface MockOperation {
  id: string;
  allianceId: string;
  scenarioCode: string;
  status: AllianceOperationStatus;
  triggeredBy: 'SYSTEM' | 'ADMIN';
  durationMinutes: number;
  alertedAt: number;
  alertEndsAt: number;
  startedAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  lateJoinUntil: number | null;
  outcome: AllianceOperationOutcome | null;
  participants: Record<string, MockParticipant>;
  channelId: string | null;
  reward: { allianceXp: number | null; trophy: boolean; quality: number | null };
}
export interface OperationsWorld {
  operations: Record<string, MockOperation>;
}
export const operationsWorld = (engine: MockEngine): OperationsWorld =>
  (engine.state.ext.allianceOperations ??= { operations: {} } satisfies OperationsWorld) as OperationsWorld;

export function installAllianceOperations(engine: MockEngine): void {
  const alliances = allianceApiOf(engine);
  const majors = majorOf(engine);
  const world = () => operationsWorld(engine);
  const flagOn = () => engine.state.featureFlags.alliance_operations === true;
  const careerById = (id: string): MockCareer | undefined => engine.state.careers[id];
  const nameOf = (careerId: string) => careerById(careerId)?.summary.directorName ?? null;
  const ref = (careerId: string) => ({ careerId, directorName: nameOf(careerId) });
  const membership = (career: MockCareer) => {
    const m = alliances.membershipOf(career.summary.id);
    if (!m) throw new MockError(403, 'NOT_ALLIANCE_MEMBER', 'Not a member of an alliance');
    return m;
  };
  const runningOf = (allianceId: string) =>
    Object.values(world().operations).find(
      (o) => o.allianceId === allianceId && (o.status === 'ALERT' || o.status === 'ACTIVE'),
    );
  const hostCareer = (a: MockAlliance): MockCareer | undefined => {
    const coordinator = activeMembers(a).find((m) => m.role === 'COORDINATOR') ?? activeMembers(a)[0];
    return coordinator ? careerById(coordinator.careerId) : undefined;
  };
  const isSimulated = (careerId: string) => {
    const career = careerById(careerId);
    return career ? careerAlliance(career).simulated != null : false;
  };

  /* ───────────── fronts ───────────── */
  const myMajor = (p: MockParticipant): MajorIncidentDto | null => {
    const career = careerById(p.careerId);
    if (!career || !p.majorId) return null;
    try {
      return majors.detail(career, p.majorId);
    } catch {
      return null;
    }
  };
  const frontOf = (op: MockOperation, p: MockParticipant): AllianceOperationFrontDto | null => {
    if (p.status !== 'JOINED') return null;
    if (p.synthetic) {
      const s = p.synthetic;
      const phase = PHASES[Math.min(PHASES.length - 1, Math.floor(s.progress * PHASES.length))]!;
      return {
        majorId: p.majorId ?? `mjr_${'0'.repeat(26)}`,
        phase,
        progress: Math.min(1, s.progress),
        coverage: s.coverage,
        sectors: s.sectors,
        sectorsClosed: s.sectorsClosed,
        openAidRequestId: null,
        ended: s.ended,
      };
    }
    const major = myMajor(p);
    if (!major) return null;
    const open = major.sectors.filter(
      (x) => !['RESOLVED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(x.status),
    );
    const coverage = open.length ? open.reduce((s, x) => s + x.coverageRatio, 0) / open.length : 1;
    const request = Object.values(aidWorld(engine).requests).find(
      (r) => r.requesterCareerId === p.careerId && r.status === 'OPEN' && r.majorId === major.id,
    );
    return {
      majorId: major.id,
      phase: major.phase,
      progress: major.progress,
      coverage: Math.round(coverage * 100) / 100,
      sectors: major.sectors.length,
      sectorsClosed: major.sectors.filter((x) => x.status === 'RESOLVED').length,
      openAidRequestId: request?.id ?? null,
      ended: major.status === 'ENDED',
    };
  };
  const incidentsClosedOf = (p: MockParticipant) => {
    if (p.synthetic) return p.synthetic.sectorsClosed;
    const major = myMajor(p);
    return major ? major.sectors.filter((x) => x.status === 'RESOLVED').length : 0;
  };
  const pointsOf = (p: MockParticipant) => incidentsClosedOf(p) * 10 + p.usefulColumns * 15;
  const joined = (op: MockOperation) => Object.values(op.participants).filter((p) => p.status === 'JOINED');
  const overall = (op: MockOperation) => {
    const fronts = joined(op)
      .map((p) => frontOf(op, p))
      .filter((f): f is AllianceOperationFrontDto => f !== null);
    const progress = fronts.length ? fronts.reduce((s, f) => s + f.progress, 0) / fronts.length : 0;
    const openFronts = fronts.filter((f) => !f.ended);
    const phase = openFronts.length
      ? openFronts.reduce(
          (min, f) => (PHASES.indexOf(f.phase) < PHASES.indexOf(min) ? f.phase : min),
          openFronts[0]!.phase,
        )
      : null;
    const quality = fronts.length ? fronts.reduce((s, f) => s + f.coverage, 0) / fronts.length : null;
    return {
      fronts,
      progress: Math.round(progress * 1000) / 1000,
      phase,
      quality,
      allEnded: fronts.length > 0 && openFronts.length === 0,
    };
  };
  const openFront = (op: MockOperation, p: MockParticipant) => {
    const career = careerById(p.careerId);
    if (!career) return;
    if (isSimulated(p.careerId)) {
      p.synthetic = {
        progress: 0,
        coverage: 0.7 + engine.random() * 0.25,
        sectors: 4,
        sectorsClosed: 0,
        ended: false,
      };
      return;
    }
    const scenario = OPERATION_SCENARIOS[op.scenarioCode]!;
    const major = majors.start(career, {
      scenarioCode: scenario.front,
      targetVehicles: Math.max(4, Math.round(career.vehicles.length * OPERATION_CFG.frontShare)),
    });
    p.majorId = major.id;
  };

  /* ───────────── DTO ───────────── */
  const participantDto = (op: MockOperation, p: MockParticipant): AllianceOperationParticipantDto => ({
    participant: ref(p.careerId),
    status: p.status,
    joinedAt: p.joinedAt === null ? null : iso(p.joinedAt),
    front: frontOf(op, p),
    contribution: {
      incidentsClosed: incidentsClosedOf(p),
      usefulColumns: p.usefulColumns,
      points: pointsOf(p),
    },
    reward: {
      eligible: p.reward.eligible,
      multiplier: p.reward.multiplier,
      credits: p.reward.credits === null ? null : String(p.reward.credits),
      xp: p.reward.xp === null ? null : String(p.reward.xp),
    },
  });
  const blockedReasonFor = (op: MockOperation, career: MockCareer): AllianceOperationJoinBlock | null => {
    const p = op.participants[career.summary.id];
    if (!flagOn()) return 'FEATURE_DISABLED';
    if (p?.status === 'JOINED') return 'ALREADY_JOINED';
    if (p?.status === 'DECLINED') return 'DECLINED';
    if (op.status === 'ALERT') {
      if (career.summary.level < OPERATION_CFG.minLevel) return 'LEVEL_TOO_LOW';
      if (majors.current(career)) return 'PERSONAL_MAJOR_OPEN';
      return null;
    }
    if (op.status !== 'ACTIVE') return 'NOT_RUNNING';
    if (op.lateJoinUntil !== null && engine.now() > op.lateJoinUntil) return 'TOO_LATE';
    if (career.summary.level < OPERATION_CFG.minLevel) return 'LEVEL_TOO_LOW';
    if (majors.current(career)) return 'PERSONAL_MAJOR_OPEN';
    return null;
  };
  const dto = (op: MockOperation, viewer: MockCareer | null): AllianceOperationDto => {
    const o = overall(op);
    const me = viewer ? op.participants[viewer.summary.id] : undefined;
    const blocked = viewer ? blockedReasonFor(op, viewer) : 'NOT_RUNNING';
    const a = alliances.alliance(op.allianceId);
    const columns = Object.values(aidWorld(engine).columns)
      .filter(
        (c) =>
          c.allianceId === op.allianceId &&
          c.status === 'EN_ROUTE' &&
          op.participants[c.requesterCareerId]?.status === 'JOINED',
      )
      .map((c) => ({
        columnId: c.id,
        helper: ref(c.helperCareerId),
        requester: ref(c.requesterCareerId),
        arriveAt: iso(c.arriveAt),
      }));
    return {
      id: op.id,
      allianceId: op.allianceId,
      scenarioCode: op.scenarioCode,
      title: { key: `alliance.operation.scenario.${op.scenarioCode}.title` },
      description: { key: `alliance.operation.scenario.${op.scenarioCode}.description` },
      alert: { key: `alliance.operation.scenario.${op.scenarioCode}.alert`, params: { tag: a?.tag ?? '' } },
      icon: OPERATION_SCENARIOS[op.scenarioCode]?.icon ?? 'siren',
      status: op.status,
      triggeredBy: op.triggeredBy,
      phase: op.status === 'ACTIVE' ? o.phase : null,
      progress: op.status === 'ALERT' ? 0 : o.progress,
      durationMinutes: op.durationMinutes,
      alertedAt: iso(op.alertedAt),
      alertEndsAt: iso(op.alertEndsAt),
      startedAt: op.startedAt === null ? null : iso(op.startedAt),
      endsAt: op.endsAt === null ? null : iso(op.endsAt),
      endedAt: op.endedAt === null ? null : iso(op.endedAt),
      lateJoinUntil: op.lateJoinUntil === null ? null : iso(op.lateJoinUntil),
      outcome: op.outcome,
      participants: Object.values(op.participants).map((p) => participantDto(op, p)),
      joinedCount: joined(op).length,
      columnsInFlight: columns,
      channelId: op.channelId,
      me: {
        status: me?.status ?? null,
        canJoin: blocked === null,
        blockedReason: blocked,
        majorId: me?.majorId ?? null,
      },
      reward: op.reward,
    };
  };
  const emit = (op: MockOperation) =>
    alliances.emitAlliance(op.allianceId, 'alliance.operation.updated', { operation: dto(op, null) });
  const notifyAll = (
    op: MockOperation,
    code: string,
    params: Record<string, string | number>,
    priority: 'CRITICAL' | 'IMPORTANT' | 'INFO',
    only?: (p: MockParticipant) => boolean,
  ) => {
    for (const p of Object.values(op.participants)) {
      if (only && !only(p)) continue;
      const career = careerById(p.careerId);
      if (career) alliances.notify(career, code, params, `operation:${op.id}`, priority);
    }
  };

  /* ───────────── lifecycle ───────────── */
  const start = (
    a: MockAlliance,
    scenarioCode: string,
    opts: { alertSeconds?: number; durationMinutes?: number; triggeredBy?: 'SYSTEM' | 'ADMIN' },
  ) => {
    if (!flagOn()) throw new MockError(403, 'FEATURE_DISABLED', 'alliance_operations is off');
    if (runningOf(a.id))
      throw new MockError(409, 'CONFLICT', 'Operation running', { reason: 'OPERATION_RUNNING' });
    const scenario = OPERATION_SCENARIOS[scenarioCode];
    if (!scenario) throw new MockError(404, 'NOT_FOUND', 'Unknown scenario');
    const now = engine.now();
    const alertSeconds = opts.alertSeconds ?? OPERATION_CFG.alertSeconds;
    const op: MockOperation = {
      id: engine.id('aop'),
      allianceId: a.id,
      scenarioCode,
      status: 'ALERT',
      triggeredBy: opts.triggeredBy ?? 'SYSTEM',
      durationMinutes: opts.durationMinutes ?? scenario.durationMinutes,
      alertedAt: now,
      alertEndsAt: now + engine.dur(alertSeconds),
      startedAt: null,
      endsAt: null,
      endedAt: null,
      lateJoinUntil: null,
      outcome: null,
      participants: Object.fromEntries(
        activeMembers(a).map((m) => [
          m.careerId,
          {
            careerId: m.careerId,
            status: 'INVITED',
            joinedAt: null,
            majorId: null,
            synthetic: null,
            usefulColumns: 0,
            reward: { eligible: false, multiplier: null, credits: null, xp: null },
          } satisfies MockParticipant,
        ]),
      ),
      channelId: null,
      reward: { allianceXp: null, trophy: false, quality: null },
    };
    world().operations[op.id] = op;
    const host = hostCareer(a);
    if (host) engine.schedule(host, 'ALLIANCE_OPERATION_ALERT_END', alertSeconds, op.id);
    notifyAll(op, 'OPERATION_ALERT', { tag: a.tag, name: a.name, minutes: op.durationMinutes }, 'CRITICAL');
    alliances.logAction(a.id, 'OPERATION_STARTED', null, null, {
      operationId: op.id,
      scenarioCode,
    } as never);
    emit(op);
    engine.save();
    return op;
  };
  const activate = (op: MockOperation) => {
    const a = alliances.alliance(op.allianceId);
    if (!a) return;
    const now = engine.now();
    op.status = 'ACTIVE';
    op.startedAt = now;
    op.endsAt = now + engine.dur(op.durationMinutes * 60);
    op.lateJoinUntil = now + engine.dur(op.durationMinutes * 60 * OPERATION_CFG.lateJoinShare);
    for (const p of joined(op)) openFront(op, p);
    // The OPERATION channel (03 §3.1): created at ACTIVE, archived at the end.
    const social = allianceSocialOf(engine);
    const channel = {
      id: engine.id('alc'),
      allianceId: a.id,
      kind: 'OPERATION' as const,
      operationId: op.id,
      operationTitle: { key: `alliance.operation.scenario.${op.scenarioCode}.title` },
      archived: false,
      createdAt: now,
    };
    social.channelsOf(a).push(channel);
    op.channelId = channel.id;
    const host = hostCareer(a);
    if (host) {
      engine.schedule(host, 'ALLIANCE_OPERATION_END', op.durationMinutes * 60, op.id);
      engine.schedule(host, 'ALLIANCE_OPERATION_TICK', OPERATION_CFG.tickSeconds, op.id);
    }
    notifyAll(op, 'OPERATION_STARTED', { tag: a.tag, name: a.name, joined: joined(op).length }, 'IMPORTANT');
    emit(op);
  };
  const cancel = (op: MockOperation) => {
    const a = alliances.alliance(op.allianceId);
    op.status = 'CANCELLED';
    op.endedAt = engine.now();
    if (a) notifyAll(op, 'OPERATION_CANCELLED', { tag: a.tag, name: a.name }, 'INFO');
    emit(op);
  };
  const outcomeFor = (progress: number, allEnded: boolean): AllianceOperationOutcome =>
    progress >= 0.95 && allEnded
      ? 'GOLD'
      : progress >= 0.8
        ? 'SILVER'
        : progress >= 0.5
          ? 'BRONZE'
          : 'FAILED';
  const end = (op: MockOperation) => {
    if (op.status !== 'ACTIVE') return;
    const a = alliances.alliance(op.allianceId);
    const o = overall(op);
    const now = engine.now();
    const outcome = outcomeFor(o.progress, o.allEnded);
    op.status = 'ENDED';
    op.endedAt = now;
    op.outcome = outcome;
    op.reward = {
      allianceXp: OPERATION_CFG.allianceXp[outcome],
      trophy: outcome !== 'FAILED',
      quality: o.quality === null ? null : Math.round(o.quality * 100) / 100,
    };
    const multiplier = OPERATION_CFG.multiplier[outcome];
    for (const p of joined(op)) {
      const front = frontOf(op, p);
      const eligible = incidentsClosedOf(p) >= 1 || p.usefulColumns >= 1;
      const credits = eligible
        ? Math.round(OPERATION_CFG.baseFrontCredits * (front?.progress ?? 0) * multiplier)
        : null;
      p.reward = { eligible, multiplier, credits, xp: credits === null ? null : Math.round(credits / 3) };
      const career = careerById(p.careerId);
      if (career && credits !== null && !isSimulated(p.careerId)) {
        if (credits > 0) engine.credit(career, credits, 'ALLIANCE_OPERATION', true);
        engine.awardXp(career, Math.round(credits / 3));
      }
    }
    if (op.channelId) {
      const channel = a
        ? allianceSocialOf(engine)
            .channelsOf(a)
            .find((c) => c.id === op.channelId)
        : undefined;
      if (channel) channel.archived = true;
    }
    const host = a ? hostCareer(a) : undefined;
    if (host) engine.cancelActions(host, (x) => x.type === 'ALLIANCE_OPERATION_TICK' && x.ref === op.id);
    allianceProgressOf(engine).recordOperation(
      op.allianceId,
      outcome !== 'FAILED',
      OPERATION_CFG.allianceXp[outcome],
      joined(op).map((p) => ({ careerId: p.careerId, points: pointsOf(p) })),
    );
    if (a) {
      notifyAll(op, 'OPERATION_ENDED', { tag: a.tag, name: a.name, outcome }, 'IMPORTANT');
      alliances.logAction(a.id, 'OPERATION_ENDED', null, null, {
        operationId: op.id,
        outcome,
      } as never);
    }
    emit(op);
  };
  const tick = (op: MockOperation) => {
    if (op.status !== 'ACTIVE') return;
    for (const p of joined(op)) {
      const s = p.synthetic;
      if (!s || s.ended) continue;
      s.progress = Math.min(1, s.progress + 0.05 + engine.random() * 0.08);
      s.sectorsClosed = Math.min(s.sectors, Math.floor(s.progress * s.sectors));
      if (s.progress >= 1) s.ended = true;
    }
    if (overall(op).allEnded) {
      end(op);
      return;
    }
    const a = alliances.alliance(op.allianceId);
    const host = a ? hostCareer(a) : undefined;
    if (host) engine.schedule(host, 'ALLIANCE_OPERATION_TICK', OPERATION_CFG.tickSeconds, op.id);
    emit(op);
  };
  engine.registerExecutor('ALLIANCE_OPERATION_ALERT_END', (_career, action) => {
    const op = world().operations[action.ref];
    if (!op || op.status !== 'ALERT') return;
    if (joined(op).length < OPERATION_CFG.minJoined) cancel(op);
    else activate(op);
  });
  engine.registerExecutor('ALLIANCE_OPERATION_END', (_career, action) => {
    const op = world().operations[action.ref];
    if (op) end(op);
  });
  engine.registerExecutor('ALLIANCE_OPERATION_TICK', (_career, action) => {
    const op = world().operations[action.ref];
    if (op) tick(op);
  });

  /* ───────────── commands ───────────── */
  const join = (career: MockCareer): AllianceOperationDto => {
    const m = membership(career);
    const op = runningOf(m.alliance.id);
    if (!op) throw new MockError(409, 'CONFLICT', 'No operation running', { reason: 'NOT_RUNNING' });
    const blocked = blockedReasonFor(op, career);
    if (blocked === 'FEATURE_DISABLED')
      throw new MockError(403, 'FEATURE_DISABLED', 'alliance_operations is off');
    if (blocked) throw new MockError(409, 'CONFLICT', 'Cannot join', { reason: blocked });
    const p = (op.participants[career.summary.id] ??= {
      careerId: career.summary.id,
      status: 'INVITED',
      joinedAt: null,
      majorId: null,
      synthetic: null,
      usefulColumns: 0,
      reward: { eligible: false, multiplier: null, credits: null, xp: null },
    });
    p.status = 'JOINED';
    p.joinedAt = engine.now();
    if (op.status === 'ACTIVE') openFront(op, p);
    emit(op);
    engine.save();
    return dto(op, career);
  };
  const decline = (career: MockCareer): AllianceOperationDto => {
    const m = membership(career);
    const op = runningOf(m.alliance.id);
    if (!op) throw new MockError(409, 'CONFLICT', 'No operation running', { reason: 'NOT_RUNNING' });
    const p = op.participants[career.summary.id];
    if (!p || p.status === 'JOINED')
      throw new MockError(409, 'CONFLICT', 'Already joined', { reason: 'ALREADY_JOINED' });
    p.status = 'DECLINED';
    emit(op);
    engine.save();
    return dto(op, career);
  };
  const current = (career: MockCareer): AllianceOperationDto | null => {
    if (!flagOn()) return null;
    const m = membership(career);
    const running = runningOf(m.alliance.id);
    if (running) return dto(running, career);
    const recent = Object.values(world().operations)
      .filter(
        (o) =>
          o.allianceId === m.alliance.id &&
          o.endedAt !== null &&
          engine.now() - o.endedAt < engine.dur(OPERATION_CFG.recentMinutes * 60),
      )
      .sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))[0];
    return recent ? dto(recent, career) : null;
  };
  const history = (career: MockCareer, q: { cursor?: string; limit?: number }) => {
    const m = membership(career);
    const list = Object.values(world().operations)
      .filter((o) => o.allianceId === m.alliance.id && (o.status === 'ENDED' || o.status === 'CANCELLED'))
      .sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0));
    const limit = Math.min(50, Math.max(1, q.limit ?? 20));
    const startAt = q.cursor ? Math.max(0, list.findIndex((o) => o.id === q.cursor) + 1) : 0;
    const page = list.slice(startAt, startAt + limit);
    return {
      data: page.map((o) => dto(o, career)),
      nextCursor: startAt + limit < list.length ? (page.at(-1)?.id ?? null) : null,
      hasMore: startAt + limit < list.length,
    };
  };

  /* ───────────── integration ───────────── */
  alliances.setOperationProvider((_career, a) => runningOf(a.id)?.id ?? null);
  majors.viewHooks.push((career, major) => {
    const m = alliances.membershipOf(career.summary.id);
    const op = m ? runningOf(m.alliance.id) : undefined;
    const p = op?.participants[career.summary.id];
    return p && p.majorId === major.id ? { ...major, allianceOperationId: op!.id } : major;
  });

  const api: AllianceOperationsApi = {
    current,
    history,
    join,
    decline,
    start: (allianceId, scenarioCode, opts) => {
      const a = alliances.alliance(allianceId);
      if (!a) throw new MockError(404, 'NOT_FOUND', 'Alliance not found');
      return dto(start(a, scenarioCode, opts), null);
    },
    noteUsefulColumn: (helperCareerId) => {
      for (const op of Object.values(world().operations)) {
        const p = op.status === 'ACTIVE' ? op.participants[helperCareerId] : undefined;
        if (p?.status === 'JOINED') {
          p.usefulColumns += 1;
          emit(op);
        }
      }
    },
  };
  apis.set(engine, api);
  aidHooksOf(engine).columnPaid.push((c) => api.noteUsefulColumn(c.helperCareerId));

  /* ───────────── QA ───────────── */
  const myAlliance = () => {
    const career = engine.qa.career();
    const m = alliances.membershipOf(career.summary.id);
    if (!m) throw new MockError(404, 'NOT_FOUND', 'No alliance');
    return { career, a: m.alliance };
  };
  const runningOrThrow = () => {
    const { a } = myAlliance();
    const op = runningOf(a.id);
    if (!op) throw new MockError(404, 'NOT_FOUND', 'No operation running');
    return op;
  };
  /** QA: an operation alert for the current career's alliance (defaults: 5 real-time-scaled minutes of alert). */
  engine.qa.startOperation = ((
    scenarioCode = 'AOP_VALLEY_FLOOD',
    opts: { alertSeconds?: number; durationMinutes?: number } = {},
  ) => {
    const { career, a } = myAlliance();
    return dto(start(a, scenarioCode, { ...opts, triggeredBy: 'ADMIN' }), career);
  }) as never;
  engine.qa.allyJoinOperation = ((careerId: string) => {
    const career = careerById(careerId);
    if (!career) throw new MockError(404, 'NOT_FOUND', 'Career not found');
    return join(career);
  }) as never;
  engine.qa.allyDeclineOperation = ((careerId: string) => {
    const career = careerById(careerId);
    if (!career) throw new MockError(404, 'NOT_FOUND', 'Career not found');
    return decline(career);
  }) as never;
  /** QA: the alert ends now (ACTIVE with ≥ 2 joined, else CANCELLED). */
  engine.qa.operationAlertEnd = (() => {
    const op = runningOrThrow();
    if (op.status !== 'ALERT') throw new MockError(409, 'CONFLICT', 'Not in alert');
    const host = hostCareer(myAlliance().a);
    if (host) engine.cancelActions(host, (x) => x.type === 'ALLIANCE_OPERATION_ALERT_END' && x.ref === op.id);
    if (joined(op).length < OPERATION_CFG.minJoined) cancel(op);
    else activate(op);
    engine.save();
    return dto(op, myAlliance().career);
  }) as never;
  /** QA: every simulated front jumps to `progress` (0..1). */
  engine.qa.advanceOperation = ((progress: number) => {
    const op = runningOrThrow();
    for (const p of joined(op)) {
      if (!p.synthetic) continue;
      p.synthetic.progress = Math.min(1, progress);
      p.synthetic.sectorsClosed = Math.min(p.synthetic.sectors, Math.floor(progress * p.synthetic.sectors));
      p.synthetic.ended = progress >= 1;
    }
    emit(op);
    engine.save();
    return dto(op, myAlliance().career);
  }) as never;
  /** QA: the clock runs out now. */
  engine.qa.endOperation = (() => {
    const op = runningOrThrow();
    if (op.status === 'ALERT') throw new MockError(409, 'CONFLICT', 'Still in alert');
    const host = hostCareer(myAlliance().a);
    if (host) engine.cancelActions(host, (x) => x.type === 'ALLIANCE_OPERATION_END' && x.ref === op.id);
    end(op);
    engine.save();
    return dto(op, myAlliance().career);
  }) as never;
  engine.qa.allianceOperation = (() => current(engine.qa.career())) as never;
}

export interface AllianceOperationsApi {
  current: (career: MockCareer) => AllianceOperationDto | null;
  history: (
    career: MockCareer,
    q: { cursor?: string; limit?: number },
  ) => { data: AllianceOperationDto[]; nextCursor: string | null; hasMore: boolean };
  join: (career: MockCareer) => AllianceOperationDto;
  decline: (career: MockCareer) => AllianceOperationDto;
  start: (
    allianceId: string,
    scenarioCode: string,
    opts: { alertSeconds?: number; durationMinutes?: number; triggeredBy?: 'SYSTEM' | 'ADMIN' },
  ) => AllianceOperationDto;
  noteUsefulColumn: (helperCareerId: string) => void;
}
const apis = new WeakMap<MockEngine, AllianceOperationsApi>();
export function allianceOperationsOf(engine: MockEngine): AllianceOperationsApi {
  const api = apis.get(engine);
  if (!api) throw new Error('alliance operations domain not installed');
  return api;
}
