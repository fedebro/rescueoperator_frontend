import type {
  AidColumnDto,
  AidColumnOptionsDto,
  AidColumnVehicleOptionDto,
  AidGapDto,
  AidIncidentRefDto,
  AidRequestDto,
  AidSendBlock,
  IncidentAlliedColumnDto,
  IncidentDto,
  MajorIncidentDto,
  VehicleDto,
} from '@/contracts';
import { MockError, iso, type MockCareer, type MockEngine } from '../engine';
import { AID_CFG, DAY, activeMembers, allianceApiOf, careerAlliance, type MockAlliance } from './alliance';
import { majorOf } from './major';

/**
 * Simulation of the `alliance-aid` module — the allied column (study 05, 08 §3.4/§4; contracts alliance-aid.ts; backend notes
 * §1a "Aid"). Never two worlds in one step: departure on the helper's world, arrival / cover / settlement on the requester's,
 * return and payment on the helper's — each a scheduled action with its own ref.
 */

interface MockAidRequest {
  id: string;
  allianceId: string;
  requesterCareerId: string;
  incidentId: string;
  majorId: string | null;
  status: AidRequestDto['status'];
  gaps: { capability: string; level: AidGapDto['level']; initial: number }[];
  createdAt: number;
  expiresAt: number | null;
  closedAt: number | null;
}
interface MockAidColumn {
  id: string;
  requestId: string;
  allianceId: string;
  helperCareerId: string;
  requesterCareerId: string;
  status: AidColumnDto['status'];
  items: AidColumnDto['items'];
  fromFacilityId: string;
  departedAt: number;
  arriveAt: number;
  onSceneAt: number | null;
  maxStayUntil: number | null;
  recalledAt: number | null;
  returnAt: number | null;
  returnedAt: number | null;
  /** Helper-side real travel seconds (game), for the return leg. */
  travelSeconds: number;
  distanceKm: number;
  /** Capability points that were actually needed when the column arrived (05 §6.2). */
  usefulCoverage: number | null;
  /** Total gap (capability points) of the request when the column arrived — the denominator of the share. */
  gapAtArrival: number | null;
  secondsOnScene: number | null;
  /** Where the allied cover was applied (incident id → capability → value), to take it away again. */
  applied: Record<string, Record<string, number>>;
  reward: AidColumnDto['reward'];
  contributionShare: number | null;
}
interface AidWorld {
  requests: Record<string, MockAidRequest>;
  columns: Record<string, MockAidColumn>;
  /** helper career id → the day's rewarded aids and per-requester counts (05 §6.3). */
  daily: Record<string, { day: string; rewarded: number; pairs: Record<string, number> }>;
  lastRequestAt: Record<string, number>;
}
/** Listeners of the aid domain (no imports in the other direction: the dependants subscribe). */
export interface AidHooks {
  columnPaid: ((column: { helperCareerId: string; allianceId: string; columnId: string }) => void)[];
  /** The running operation a request belongs to (its incident is a front of the requester), set by the operations domain. */
  operationIdOf: (requesterCareerId: string, majorId: string | null) => string | null;
}
const hooks = new WeakMap<MockEngine, AidHooks>();
export const aidHooksOf = (engine: MockEngine): AidHooks => {
  let h = hooks.get(engine);
  if (!h) {
    h = { columnPaid: [], operationIdOf: () => null };
    hooks.set(engine, h);
  }
  return h;
};
export const aidWorld = (engine: MockEngine): AidWorld =>
  (engine.state.ext.allianceAid ??= {
    requests: {},
    columns: {},
    daily: {},
    lastRequestAt: {},
  } satisfies AidWorld) as AidWorld;

const PREP_SECONDS = 60;
const TRAVEL_COMPRESSION = 0.25;
const MIN_SHARE = AID_CFG.minContributionShare;
const CLOSED_INCIDENT = new Set(['RESOLVED', 'FAILED', 'EXPIRED', 'CANCELLED']);

export function installAllianceAid(engine: MockEngine): void {
  const alliances = allianceApiOf(engine);
  const world = () => aidWorld(engine);
  const careerById = (id: string): MockCareer | undefined => engine.state.careers[id];
  const flagOn = () => engine.state.featureFlags.alliance_aid === true;
  const dayKey = () => iso(engine.now()).slice(0, 10);
  const dailyOf = (helperId: string) => {
    const w = world();
    const d = w.daily[helperId];
    if (!d || d.day !== dayKey()) w.daily[helperId] = { day: dayKey(), rewarded: 0, pairs: {} };
    return w.daily[helperId]!;
  };
  const membership = (career: MockCareer) => {
    if (!flagOn()) throw new MockError(403, 'FEATURE_DISABLED', 'alliance_aid is off');
    const m = alliances.membershipOf(career.summary.id);
    if (!m) throw new MockError(403, 'NOT_ALLIANCE_MEMBER', 'Not a member of an alliance');
    return m;
  };
  const incidentOf = (career: MockCareer, id: string) => career.incidents.find((i) => i.id === id);
  const ref = (careerId: string) => ({
    careerId: careerById(careerId) ? careerId : null,
    directorName: careerById(careerId)?.summary.directorName ?? null,
  });
  const tagOf = (allianceId: string) => alliances.alliance(allianceId)?.tag ?? '';

  /* ───────────── gaps ───────────── */
  /** What the incident still misses (05 §2.1): REQUIRED / RECOMMENDED, not external, minus own on scene + en route minus allied. */
  const gapsOf = (incident: IncidentDto) =>
    incident.requirements
      .filter((r) => (r.level === 'REQUIRED' || r.level === 'RECOMMENDED') && !r.external)
      .map((r) => ({
        capability: r.capability,
        level: r.level as AidGapDto['level'],
        missing: Math.max(0, r.required - r.onScene - r.enRoute - (r.allied ?? 0)),
        allied: r.allied ?? 0,
      }))
      .filter((g) => g.missing > 0 || g.allied > 0);
  const incidentsOfRequest = (requester: MockCareer, request: MockAidRequest): IncidentDto[] => {
    if (!request.majorId) {
      const i = incidentOf(requester, request.incidentId);
      return i ? [i] : [];
    }
    const major = majorOf(engine).current(requester);
    if (!major || major.id !== request.majorId) return [];
    return requester.incidents.filter(
      (i) => i.major?.id === request.majorId && !CLOSED_INCIDENT.has(i.status),
    );
  };
  const gapDtos = (requester: MockCareer | undefined, request: MockAidRequest): AidGapDto[] => {
    const incidents = requester ? incidentsOfRequest(requester, request) : [];
    return request.gaps.map((g) => {
      const live = incidents.flatMap(gapsOf).filter((x) => x.capability === g.capability);
      return {
        capability: g.capability,
        level: g.level,
        missing: live.reduce((s, x) => s + x.missing, 0),
        allied: live.reduce((s, x) => s + x.allied, 0),
        initial: g.initial,
      };
    });
  };
  const incidentRef = (requester: MockCareer | undefined, request: MockAidRequest): AidIncidentRefDto => {
    const incident = requester ? incidentOf(requester, request.incidentId) : undefined;
    const major = request.majorId && requester ? majorOf(engine).current(requester) : null;
    return {
      id: request.incidentId,
      templateCode: incident?.templateCode ?? '',
      title:
        major && major.id === request.majorId
          ? major.title
          : (incident?.title ?? { key: 'incident.unknown' }),
      icon: incident?.icon ?? 'incident-generic',
      severity: incident?.severity ?? 0,
      municipality: incident?.municipality ?? requester?.summary.locationName ?? null,
      families: incident?.families ?? [],
      major:
        major && major.id === request.majorId
          ? { id: major.id, scenarioCode: major.scenarioCode, title: major.title }
          : null,
      expiresAt: request.expiresAt === null ? null : iso(request.expiresAt),
    };
  };

  /* ───────────── helper-side geometry ───────────── */
  const facilityOf = (career: MockCareer, vehicle: VehicleDto) =>
    career.facilities.find((f) => f.id === vehicle.facilityId);
  const etaFor = (helper: MockCareer, vehicle: VehicleDto, target: IncidentDto) => {
    const { distanceMeters, path } = engine.route(
      vehicle.position,
      target.position,
      `${vehicle.id}|aid|${target.id}`,
      vehicle.typeCode,
    );
    const travel = engine.travelSeconds(distanceMeters, vehicle.typeCode, helper, path);
    const seconds = Math.round(
      Math.min(
        AID_CFG.maxEtaMinutes * 60,
        Math.max(AID_CFG.minEtaMinutes * 60, PREP_SECONDS + travel * TRAVEL_COMPRESSION),
      ),
    );
    return { etaSeconds: seconds, travelSeconds: travel, distanceKm: distanceMeters / 1000 };
  };
  const nearestDistanceKm = (helper: MockCareer, target: IncidentDto | undefined): number | null => {
    if (!target || helper.facilities.length === 0) return null;
    const km = helper.facilities.map(
      (f) =>
        engine.route(f.position, target.position, `${f.id}|aid|${target.id}`, 'FIRE_APS').distanceMeters /
        1000,
    );
    return Math.round(Math.min(...km) * 10) / 10;
  };
  const usefulFor = (vehicle: VehicleDto, gaps: AidGapDto[]) =>
    vehicle.capabilities
      .map((c) => ({
        capability: c.code,
        value: c.value,
        useful: Math.min(c.value, gaps.find((g) => g.capability === c.code)?.missing ?? 0),
      }))
      .filter((c) => c.useful > 0 || gaps.some((g) => g.capability === c.capability));
  const activeColumnsOf = (helperId: string) =>
    Object.values(world().columns).filter(
      (c) => c.helperCareerId === helperId && (c.status === 'EN_ROUTE' || c.status === 'ON_SCENE'),
    );
  const maxColumnsFor = (a: MockAlliance) => alliances.progressOf(a).concurrentColumns;
  const pairFactorFor = (helperId: string, requesterId: string) => {
    const n = dailyOf(helperId).pairs[requesterId] ?? 0;
    return n < 3 ? 1 : n < 4 ? 0.5 : 0.25;
  };

  /* ───────────── DTOs ───────────── */
  const columnDto = (c: MockAidColumn, viewer: MockCareer): AidColumnDto => {
    const requester = careerById(c.requesterCareerId);
    const request = world().requests[c.requestId]!;
    const helper = careerById(c.helperCareerId);
    const mine = c.helperCareerId === viewer.summary.id;
    return {
      id: c.id,
      requestId: c.requestId,
      allianceId: c.allianceId,
      helper: ref(c.helperCareerId),
      requester: ref(c.requesterCareerId),
      incident: incidentRef(requester, request),
      status: c.status,
      items: c.items,
      fromFacility:
        mine && helper
          ? {
              id: c.fromFacilityId,
              name: helper.facilities.find((f) => f.id === c.fromFacilityId)?.name ?? '',
            }
          : null,
      departedAt: iso(c.departedAt),
      arriveAt: iso(c.arriveAt),
      onSceneAt: c.onSceneAt === null ? null : iso(c.onSceneAt),
      maxStayUntil: c.maxStayUntil === null ? null : iso(c.maxStayUntil),
      recalledAt: c.recalledAt === null ? null : iso(c.recalledAt),
      returnAt: c.returnAt === null ? null : iso(c.returnAt),
      returnedAt: c.returnedAt === null ? null : iso(c.returnedAt),
      contribution: {
        share: c.contributionShare,
        usefulCoverage: c.usefulCoverage,
        secondsOnScene: c.secondsOnScene,
      },
      reward: c.reward,
      operationId: aidHooksOf(engine).operationIdOf(
        c.requesterCareerId,
        world().requests[c.requestId]?.majorId ?? null,
      ),
      mine,
    };
  };
  const sendBlockFor = (
    viewer: MockCareer,
    request: MockAidRequest,
    requester: MockCareer | undefined,
  ): AidSendBlock | null => {
    if (!flagOn()) return 'FEATURE_DISABLED';
    if (request.requesterCareerId === viewer.summary.id) return 'OWN_REQUEST';
    if (request.status !== 'OPEN') return 'NOT_OPEN';
    if (
      Object.values(world().columns).some(
        (c) => c.requestId === request.id && c.helperCareerId === viewer.summary.id,
      )
    )
      return 'ALREADY_SENT';
    const a = alliances.alliance(request.allianceId);
    if (a && activeColumnsOf(viewer.summary.id).length >= maxColumnsFor(a)) return 'COLUMN_LIMIT';
    const gaps = gapDtos(requester, request);
    const target = requester ? incidentOf(requester, request.incidentId) : undefined;
    const useful = viewer.vehicles.filter(
      (v) => v.status === 'AVAILABLE' && usefulFor(v, gaps).some((c) => c.useful > 0),
    );
    if (useful.length === 0) return 'NO_USEFUL_VEHICLE';
    if (
      target &&
      request.expiresAt !== null &&
      useful.every(
        (v) => engine.now() + engine.dur(etaFor(viewer, v, target).etaSeconds) > request.expiresAt!,
      )
    )
      return 'TOO_LATE';
    return null;
  };
  const requestDto = (r: MockAidRequest, viewer: MockCareer): AidRequestDto => {
    const requester = careerById(r.requesterCareerId);
    const target = requester ? incidentOf(requester, r.incidentId) : undefined;
    const blocked = sendBlockFor(viewer, r, requester);
    return {
      id: r.id,
      allianceId: r.allianceId,
      requester: ref(r.requesterCareerId),
      incident: incidentRef(requester, r),
      status: r.status,
      gaps: gapDtos(requester, r),
      createdAt: iso(r.createdAt),
      expiresAt: r.expiresAt === null ? null : iso(r.expiresAt),
      closedAt: r.closedAt === null ? null : iso(r.closedAt),
      columns: Object.values(world().columns)
        .filter((c) => c.requestId === r.id)
        .map((c) => columnDto(c, viewer)),
      distanceKm: r.requesterCareerId === viewer.summary.id ? null : nearestDistanceKm(viewer, target),
      mine: r.requesterCareerId === viewer.summary.id,
      viewer: { canSend: blocked === null, blockedReason: blocked },
      operationId: aidHooksOf(engine).operationIdOf(r.requesterCareerId, r.majorId),
    };
  };
  const neutralRequest = (r: MockAidRequest): AidRequestDto => {
    const requester = careerById(r.requesterCareerId);
    const dto = requestDto(
      r,
      requester ??
        ({ summary: { id: '' }, vehicles: [], facilities: [], incidents: [] } as unknown as MockCareer),
    );
    return {
      ...dto,
      distanceKm: null,
      mine: false,
      viewer: { canSend: false, blockedReason: null },
      columns: dto.columns.map((c) => ({ ...c, mine: false, fromFacility: null })),
    };
  };
  const alliedRow = (c: MockAidColumn): IncidentAlliedColumnDto => ({
    columnId: c.id,
    requestId: c.requestId,
    helper: { ...ref(c.helperCareerId), tag: tagOf(c.allianceId) },
    status: c.status,
    arriveAt: iso(c.arriveAt),
    onSceneAt: c.onSceneAt === null ? null : iso(c.onSceneAt),
    vehicles: c.items.map((i) => ({ typeCode: i.typeCode, callSign: i.callSign, family: i.family })),
    capabilities: [
      ...c.items.reduce((m, i) => {
        for (const cap of i.capabilities) m.set(cap.capability, (m.get(cap.capability) ?? 0) + cap.value);
        return m;
      }, new Map<string, number>()),
    ].map(([capability, value]) => ({ capability, value })),
  });

  /* ───────────── requester-world bookkeeping ───────────── */
  const refreshIncidentAllied = (requester: MockCareer, incidentId: string) => {
    const incident = incidentOf(requester, incidentId);
    if (!incident) return;
    const columns = Object.values(world().columns).filter(
      (c) =>
        c.requesterCareerId === requester.summary.id &&
        (c.status === 'EN_ROUTE' || c.status === 'ON_SCENE') &&
        (c.applied[incidentId] || world().requests[c.requestId]?.incidentId === incidentId),
    );
    const allied = (capability: string) =>
      Object.values(world().columns)
        .filter((c) => c.status === 'ON_SCENE')
        .reduce((s, c) => s + (c.applied[incidentId]?.[capability] ?? 0), 0);
    const open = Object.values(world().requests).find(
      (r) =>
        r.requesterCareerId === requester.summary.id &&
        r.status === 'OPEN' &&
        (r.incidentId === incidentId || incidentsOfRequest(requester, r).some((i) => i.id === incidentId)),
    );
    engine.patchIncident(requester, incidentId, {
      requirements: incident.requirements.map((r) => ({ ...r, allied: allied(r.capability) })),
      visibility: open ? 'ALLIANCE' : 'PRIVATE',
      aidRequestId: open?.id ?? incident.aidRequestId ?? null,
      allied: columns.map(alliedRow),
    });
    const next = engine.recompute(requester, incidentId, engine.now());
    if (next) engine.emit(requester, 'incident.updated', { incident: next });
  };
  const applyArrival = (requester: MockCareer, request: MockAidRequest, column: MockAidColumn) => {
    const incidents = incidentsOfRequest(requester, request);
    let useful = 0;
    for (const item of column.items)
      for (const cap of item.capabilities) {
        // Each capability goes where it is missing most (a major: its sectors; a single incident: itself).
        const target = incidents
          .map((i) => ({ i, missing: gapsOf(i).find((g) => g.capability === cap.capability)?.missing ?? 0 }))
          .sort((x, y) => y.missing - x.missing)[0];
        if (!target) continue;
        const bucket = (column.applied[target.i.id] ??= {});
        bucket[cap.capability] = (bucket[cap.capability] ?? 0) + cap.value;
        useful += Math.min(cap.value, target.missing);
        engine.patchIncident(requester, target.i.id, {
          requirements: target.i.requirements.map((r) =>
            r.capability === cap.capability ? { ...r, allied: (r.allied ?? 0) + cap.value } : r,
          ),
        });
      }
    column.usefulCoverage = useful;
    column.gapAtArrival = Math.max(
      1,
      request.gaps.reduce((s, g) => s + g.initial, 0),
    );
    for (const id of Object.keys(column.applied)) refreshIncidentAllied(requester, id);
  };
  /** The column stops covering: its time on scene is recorded, its cover taken away, the incident(s) refreshed. */
  const leaveScene = (
    requester: MockCareer | undefined,
    column: MockAidColumn,
    nextStatus: MockAidColumn['status'],
  ) => {
    if (column.status === 'ON_SCENE' && column.onSceneAt !== null)
      column.secondsOnScene = Math.round(((engine.now() - column.onSceneAt) / 1000) * engine.speed);
    column.status = nextStatus;
    const touched = Object.keys(column.applied);
    column.applied = {};
    if (requester) for (const id of touched) refreshIncidentAllied(requester, id);
  };
  const startReturn = (column: MockAidColumn, status: MockAidColumn['status']) => {
    const helper = careerById(column.helperCareerId);
    column.status = status;
    column.returnAt = engine.now() + engine.dur(Math.max(30, column.travelSeconds * TRAVEL_COMPRESSION));
    if (helper) {
      for (const item of column.items) {
        const v = engine.patchVehicle(helper, item.vehicleId, {
          busyUntil: iso(column.returnAt),
          alliedSupport: supportOf(column),
        });
        if (v) engine.emit(helper, 'vehicle.updated', { vehicle: v });
      }
      engine.schedule(
        helper,
        'AID_COLUMN_RETURN',
        Math.max(30, column.travelSeconds * TRAVEL_COMPRESSION),
        column.id,
      );
    }
    alliances.emitAlliance(column.allianceId, 'alliance.column.updated', {
      column: columnDto(column, helper ?? ({ summary: { id: '' } } as MockCareer)),
    });
  };
  const supportOf = (column: MockAidColumn): VehicleDto['alliedSupport'] => {
    const requester = careerById(column.requesterCareerId);
    const request = world().requests[column.requestId]!;
    const r = incidentRef(requester, request);
    return {
      columnId: column.id,
      requestId: column.requestId,
      requester: { ...ref(column.requesterCareerId), tag: tagOf(column.allianceId) },
      incidentTitle: r.title,
      incidentIcon: r.icon,
      status: column.status,
      arriveAt: iso(column.arriveAt),
      returnAt: column.returnAt === null ? null : iso(column.returnAt),
    };
  };
  const closeRequest = (request: MockAidRequest, status: MockAidRequest['status']) => {
    request.status = status;
    request.closedAt = engine.now();
    const requester = careerById(request.requesterCareerId);
    if (requester)
      for (const i of incidentsOfRequest(requester, request)) refreshIncidentAllied(requester, i.id);
    if (requester) {
      const incident = incidentOf(requester, request.incidentId);
      if (incident && !CLOSED_INCIDENT.has(incident.status))
        refreshIncidentAllied(requester, request.incidentId);
    }
    alliances.emitAlliance(request.allianceId, 'alliance.aid.updated', { request: neutralRequest(request) });
  };
  /** Settlement (05 §6): fund × useful share × time factor, min 10 %, 8 rewarded / day, same-pair decay, travel cost off. */
  const settle = (request: MockAidRequest, incident: IncidentDto, resolved: boolean) => {
    const base = Math.round(Number(incident.estimatedReward.max) / 1.2);
    const fund = {
      credits: Math.round(base * AID_CFG.fundShareIncident),
      xp: Math.round(base * 0.5 * AID_CFG.fundShareIncident),
    };
    for (const column of Object.values(world().columns).filter((c) => c.requestId === request.id)) {
      if (column.reward.status !== 'PENDING') continue;
      const helper = careerById(column.helperCareerId);
      if (!resolved || column.usefulCoverage === null || column.gapAtArrival === null || !helper) {
        column.reward = { ...column.reward, status: 'NONE' };
        continue;
      }
      const waited = Math.max(1, Math.round(((column.arriveAt - request.createdAt) / 1000) * engine.speed));
      const timeFactor = Math.min(1, (column.secondsOnScene ?? 0) / waited);
      const share = Math.min(1, column.usefulCoverage / column.gapAtArrival) * timeFactor;
      column.contributionShare = Math.round(share * 1000) / 1000;
      if (share < MIN_SHARE) {
        column.reward = { ...column.reward, status: 'NONE' };
        continue;
      }
      const daily = dailyOf(column.helperCareerId);
      const pairFactor = pairFactorFor(column.helperCareerId, column.requesterCareerId);
      daily.pairs[column.requesterCareerId] = (daily.pairs[column.requesterCareerId] ?? 0) + 1;
      const travelCost = Math.round(column.distanceKm * 0.2 * column.items.length);
      const xp = Math.round(fund.xp * share * pairFactor);
      // No daily cap inside an alliance operation (07 §4): the columns between fronts are settled at the end.
      const inOperation =
        aidHooksOf(engine).operationIdOf(request.requesterCareerId, request.majorId) !== null;
      if (daily.rewarded >= AID_CFG.rewardedPerDay && !inOperation) {
        column.reward = { status: 'CAPPED', credits: '0', xp: String(xp), pairFactor, travelCost: '0' };
        engine.awardXp(helper, xp);
      } else {
        daily.rewarded += 1;
        const credits = Math.max(0, Math.round(fund.credits * share * pairFactor) - travelCost);
        column.reward = {
          status: 'PAID',
          credits: String(credits),
          xp: String(xp),
          pairFactor,
          travelCost: String(Math.min(travelCost, Math.round(fund.credits * share * pairFactor))),
        };
        if (credits > 0) engine.credit(helper, credits, 'ALLIANCE_AID');
        {
          const ma = alliances.membershipOf(column.helperCareerId)?.alliance;
          const requesterCareer = careerById(column.requesterCareerId);
          if (ma)
            alliances.notify(
              helper,
              'AID_PAID',
              {
                credits: String(credits),
                director: requesterCareer?.summary.directorName ?? '',
                tag: ma.tag,
                name: ma.name,
              },
              `aid:${column.requestId}`,
              'IMPORTANT',
            );
        }
        // Progression / operations listen here (06 §1.1, 07 §5.2): the domains that depend on aid subscribe at install.
        for (const hook of aidHooksOf(engine).columnPaid)
          hook({ helperCareerId: column.helperCareerId, allianceId: column.allianceId, columnId: column.id });
        engine.awardXp(helper, xp);
      }
      careerAlliance(helper).aidGiven += 1;
      const requester = careerById(column.requesterCareerId);
      if (requester) careerAlliance(requester).aidReceived += 1;
      alliances.emitAlliance(column.allianceId, 'alliance.column.updated', {
        column: columnDto(column, helper),
      });
    }
  };

  /* ───────────── commands ───────────── */
  const createRequest = (career: MockCareer, incidentId: string, majorId: string | null): AidRequestDto => {
    const m = membership(career);
    const a = m.alliance;
    const incident = incidentOf(career, incidentId);
    if (!incident || CLOSED_INCIDENT.has(incident.status))
      throw new MockError(404, 'NOT_FOUND', 'Incident not found');
    if (incident.isTutorial)
      throw new MockError(409, 'CONFLICT', 'Tutorial incident', { reason: 'INCIDENT_NOT_ACTIVE' });
    // A member of a major is asked for through the major route (one request spread over its sectors).
    if (!majorId && incident.major)
      throw new MockError(409, 'CONFLICT', 'Use the major request', { reason: 'USE_MAJOR_REQUEST' });
    const scope = majorId
      ? career.incidents.filter((i) => i.major?.id === majorId && !CLOSED_INCIDENT.has(i.status))
      : [incident];
    const merged = new Map<string, { capability: string; level: AidGapDto['level']; initial: number }>();
    for (const g of scope.flatMap(gapsOf).filter((g) => g.missing > 0)) {
      const cur = merged.get(g.capability);
      merged.set(g.capability, {
        capability: g.capability,
        level: cur?.level === 'REQUIRED' ? 'REQUIRED' : g.level,
        initial: (cur?.initial ?? 0) + g.missing,
      });
    }
    if (merged.size === 0) throw new MockError(409, 'NO_REAL_GAP', 'No uncovered need');
    const open = Object.values(world().requests).filter(
      (r) => r.requesterCareerId === career.summary.id && r.status === 'OPEN',
    );
    if (open.some((r) => r.incidentId === incidentId || (majorId && r.majorId === majorId)))
      throw new MockError(429, 'AID_LIMIT_REACHED', 'Already requested', { reason: 'ALREADY_REQUESTED' });
    if (open.filter((r) => r.majorId === null).length >= AID_CFG.maxOpenRequestsPerCareer && !majorId)
      throw new MockError(429, 'AID_LIMIT_REACHED', 'Too many open requests', {
        reason: 'OPEN_REQUESTS',
        limit: AID_CFG.maxOpenRequestsPerCareer,
      });
    const last = world().lastRequestAt[career.summary.id] ?? 0;
    if (engine.now() - last < engine.dur(AID_CFG.minSecondsBetweenRequests))
      throw new MockError(429, 'AID_LIMIT_REACHED', 'Wait between requests', { reason: 'MIN_INTERVAL' });
    const request: MockAidRequest = {
      id: engine.id('aid'),
      allianceId: a.id,
      requesterCareerId: career.summary.id,
      incidentId,
      majorId,
      status: 'OPEN',
      gaps: [...merged.values()],
      createdAt: engine.now(),
      expiresAt: incident.expiresAt ? Date.parse(incident.expiresAt) : null,
      closedAt: null,
    };
    world().requests[request.id] = request;
    world().lastRequestAt[career.summary.id] = engine.now();
    if (request.expiresAt !== null)
      engine.schedule(
        career,
        'AID_REQUEST_EXPIRE',
        Math.max(1, ((request.expiresAt - engine.now()) / 1000) * engine.speed),
        request.id,
      );
    for (const i of scope) refreshIncidentAllied(career, i.id);
    // Only the allies who can bring something are told (05 §3.1): at least one AVAILABLE vehicle with a missing capability.
    const gaps = gapDtos(career, request);
    for (const member of activeMembers(a)) {
      if (member.careerId === career.summary.id) continue;
      const c = careerById(member.careerId);
      if (
        !c ||
        !c.vehicles.some((v) => v.status === 'AVAILABLE' && usefulFor(v, gaps).some((x) => x.useful > 0))
      )
        continue;
      alliances.notify(
        c,
        'AID_REQUEST',
        { director: career.summary.directorName, tag: a.tag, name: a.name },
        `aid:${request.id}`,
        'IMPORTANT',
      );
    }
    alliances.emitAlliance(a.id, 'alliance.aid.updated', { request: neutralRequest(request) });
    engine.save();
    return requestDto(request, career);
  };
  const cancelRequest = (career: MockCareer, requestId: string): AidRequestDto => {
    membership(career);
    const request = world().requests[requestId];
    if (!request || request.requesterCareerId !== career.summary.id)
      throw new MockError(404, 'NOT_FOUND', 'Request not found');
    if (request.status === 'OPEN') closeRequest(request, 'CANCELLED');
    engine.save();
    return requestDto(request, career);
  };
  const listRequests = (career: MockCareer, q: { status?: string; cursor?: string; limit?: number }) => {
    if (!flagOn()) return { data: [] as AidRequestDto[], nextCursor: null, hasMore: false };
    const m = alliances.membershipOf(career.summary.id);
    if (!m) throw new MockError(403, 'NOT_ALLIANCE_MEMBER', 'Not a member of an alliance');
    const rows = Object.values(world().requests)
      .filter((r) => r.allianceId === m.alliance.id && (q.status === 'ALL' || r.status === 'OPEN'))
      .sort((x, y) => y.createdAt - x.createdAt);
    const start = Number(q.cursor ?? 0) || 0;
    const limit = Math.min(50, q.limit ?? 20);
    const page = rows.slice(start, start + limit);
    const hasMore = start + limit < rows.length;
    return {
      data: page.map((r) => requestDto(r, career)),
      nextCursor: hasMore ? String(start + limit) : null,
      hasMore,
    };
  };
  const getRequest = (career: MockCareer, requestId: string): AidRequestDto => {
    const m = membership(career);
    const r = world().requests[requestId];
    if (!r || r.allianceId !== m.alliance.id) throw new MockError(404, 'NOT_FOUND', 'Request not found');
    return requestDto(r, career);
  };
  const listColumns = (
    career: MockCareer,
    q: { role?: string; active?: boolean; cursor?: string; limit?: number },
  ) => {
    if (!flagOn()) return { data: [] as AidColumnDto[], nextCursor: null, hasMore: false };
    const rows = Object.values(world().columns)
      .filter((c) =>
        q.role === 'GIVEN'
          ? c.helperCareerId === career.summary.id
          : q.role === 'RECEIVED'
            ? c.requesterCareerId === career.summary.id
            : c.helperCareerId === career.summary.id || c.requesterCareerId === career.summary.id,
      )
      .filter(
        (c) =>
          !q.active ||
          c.status === 'EN_ROUTE' ||
          c.status === 'ON_SCENE' ||
          c.status === 'RECALLED' ||
          c.status === 'RETURNING',
      )
      .sort((x, y) => y.departedAt - x.departedAt);
    const start = Number(q.cursor ?? 0) || 0;
    const limit = Math.min(50, q.limit ?? 20);
    const page = rows.slice(start, start + limit);
    const hasMore = start + limit < rows.length;
    return {
      data: page.map((c) => columnDto(c, career)),
      nextCursor: hasMore ? String(start + limit) : null,
      hasMore,
    };
  };
  const columnOptions = (career: MockCareer, requestId: string): AidColumnOptionsDto => {
    const m = membership(career);
    const request = world().requests[requestId];
    if (!request || request.allianceId !== m.alliance.id)
      throw new MockError(404, 'NOT_FOUND', 'Request not found');
    const requester = careerById(request.requesterCareerId);
    const target = requester ? incidentOf(requester, request.incidentId) : undefined;
    const gaps = gapDtos(requester, request);
    const vehicles: AidColumnVehicleOptionDto[] = career.vehicles
      .filter((v) => v.status === 'AVAILABLE' && usefulFor(v, gaps).some((c) => c.useful > 0) && target)
      .map((v) => {
        const eta = etaFor(career, v, target!);
        const arriveAt = engine.now() + engine.dur(eta.etaSeconds);
        const tooLate = request.expiresAt !== null && arriveAt > request.expiresAt;
        return {
          vehicleId: v.id,
          typeCode: v.typeCode,
          callSign: v.callSign,
          family: v.family,
          facilityId: v.facilityId,
          facilityName: facilityOf(career, v)?.name ?? '',
          capabilities: usefulFor(v, gaps),
          etaSeconds: eta.etaSeconds,
          arriveAt: iso(arriveAt),
          tooLate,
          blockedReason: tooLate ? ('TOO_LATE' as const) : null,
        };
      })
      .sort((x, y) => x.etaSeconds - y.etaSeconds);
    const base = target ? Math.round(Number(target.estimatedReward.max) / 1.2) : 0;
    const available = career.vehicles.filter((v) => v.status === 'AVAILABLE').length;
    const current = career.summary.coveragePct ?? 0;
    return {
      request: requestDto(request, career),
      blockedReason: sendBlockFor(career, request, requester),
      maxVehicles: request.majorId ? AID_CFG.maxVehiclesPerColumnMajor : AID_CFG.maxVehiclesPerColumn,
      vehicles,
      fund: {
        credits: String(Math.round(base * AID_CFG.fundShareIncident)),
        xp: String(Math.round(base * 0.5 * AID_CFG.fundShareIncident)),
      },
      ownCoverage: {
        currentPct: current,
        ifAllSentPct:
          available > 0 ? Math.round(current * Math.max(0, 1 - vehicles.length / available)) : current,
      },
      dailyRewarded: { used: dailyOf(career.summary.id).rewarded, cap: AID_CFG.rewardedPerDay },
      pairFactor: pairFactorFor(career.summary.id, request.requesterCareerId),
    };
  };
  const sendColumn = (career: MockCareer, requestId: string, raw: unknown): AidColumnDto => {
    const m = membership(career);
    const request = world().requests[requestId];
    if (!request || request.allianceId !== m.alliance.id)
      throw new MockError(404, 'NOT_FOUND', 'Request not found');
    const ids = Array.isArray(raw)
      ? (raw as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    if (ids.length === 0) throw new MockError(422, 'VALIDATION_ERROR', 'vehicleIds required');
    const blocked = sendBlockFor(career, request, careerById(request.requesterCareerId));
    if (blocked === 'OWN_REQUEST')
      throw new MockError(409, 'CONFLICT', 'Own request', { reason: 'OWN_REQUEST' });
    if (blocked === 'NOT_OPEN')
      throw new MockError(409, 'CONFLICT', 'Request closed', { reason: 'REQUEST_NOT_OPEN' });
    if (blocked === 'ALREADY_SENT')
      throw new MockError(429, 'AID_LIMIT_REACHED', 'One column per request', { reason: 'ONE_PER_REQUEST' });
    if (blocked === 'COLUMN_LIMIT')
      throw new MockError(429, 'AID_LIMIT_REACHED', 'Too many columns in flight', {
        reason: 'ACTIVE_COLUMNS',
        limit: maxColumnsFor(m.alliance),
      });
    const max = request.majorId ? AID_CFG.maxVehiclesPerColumnMajor : AID_CFG.maxVehiclesPerColumn;
    if (ids.length > max)
      throw new MockError(429, 'AID_LIMIT_REACHED', 'Too many vehicles', {
        reason: 'TOO_MANY_VEHICLES',
        limit: max,
      });
    const requester = careerById(request.requesterCareerId);
    const target = requester ? incidentOf(requester, request.incidentId) : undefined;
    if (!requester || !target)
      throw new MockError(409, 'CONFLICT', 'Request closed', { reason: 'REQUEST_NOT_OPEN' });
    const gaps = gapDtos(requester, request);
    const vehicles = ids.map((id) => {
      const v = career.vehicles.find((x) => x.id === id);
      if (!v || v.status !== 'AVAILABLE')
        throw new MockError(409, 'VEHICLE_NOT_AVAILABLE', 'Vehicle not available', { vehicleId: id });
      if (!usefulFor(v, gaps).some((c) => c.useful > 0))
        throw new MockError(409, 'NO_REAL_GAP', 'Vehicle brings nothing useful', { vehicleId: id });
      return v;
    });
    const etas = vehicles.map((v) => etaFor(career, v, target));
    const etaSeconds = Math.max(...etas.map((e) => e.etaSeconds));
    const arriveAt = engine.now() + engine.dur(etaSeconds);
    if (request.expiresAt !== null && arriveAt > request.expiresAt)
      throw new MockError(409, 'COLUMN_TOO_LATE', 'Would arrive after the deadline', {
        arriveAt: iso(arriveAt),
      });
    const column: MockAidColumn = {
      id: engine.id('col'),
      requestId,
      allianceId: m.alliance.id,
      helperCareerId: career.summary.id,
      requesterCareerId: request.requesterCareerId,
      status: 'EN_ROUTE',
      items: vehicles.map((v) => ({
        vehicleId: v.id,
        typeCode: v.typeCode,
        callSign: v.callSign,
        family: v.family,
        capabilities: v.capabilities.map((c) => ({ capability: c.code, value: c.value })),
      })),
      fromFacilityId: vehicles[0]!.facilityId,
      departedAt: engine.now(),
      arriveAt,
      onSceneAt: null,
      maxStayUntil: null,
      recalledAt: null,
      returnAt: null,
      returnedAt: null,
      travelSeconds: Math.max(...etas.map((e) => e.travelSeconds)),
      distanceKm: Math.max(...etas.map((e) => e.distanceKm)),
      usefulCoverage: null,
      gapAtArrival: null,
      secondsOnScene: null,
      applied: {},
      reward: { status: 'PENDING', credits: null, xp: null, pairFactor: null, travelCost: null },
      contributionShare: null,
    };
    world().columns[column.id] = column;
    for (const v of vehicles) {
      const next = engine.patchVehicle(career, v.id, {
        status: 'ALLIED_SUPPORT',
        incidentId: null,
        movement: null,
        busyUntil: iso(arriveAt),
        alliedSupport: supportOf(column),
      });
      if (next) engine.emit(career, 'vehicle.updated', { vehicle: next });
    }
    engine.schedule(career, 'AID_COLUMN_ARRIVE', etaSeconds, column.id);
    refreshIncidentAllied(requester, target.id);
    alliances.emitAlliance(m.alliance.id, 'alliance.column.updated', {
      column: columnDto(column, { summary: { id: '' } } as MockCareer),
    });
    alliances.emitAlliance(m.alliance.id, 'alliance.aid.updated', { request: neutralRequest(request) });
    engine.save();
    return columnDto(column, career);
  };
  const recall = (career: MockCareer, columnId: string): AidColumnDto => {
    membership(career);
    const column = world().columns[columnId];
    if (!column || column.helperCareerId !== career.summary.id)
      throw new MockError(404, 'NOT_FOUND', 'Column not found');
    if (column.status === 'EN_ROUTE' || column.status === 'ON_SCENE') {
      column.recalledAt = engine.now();
      engine.cancelActions(career, (a) => a.type === 'AID_COLUMN_ARRIVE' && a.ref === column.id);
      leaveScene(careerById(column.requesterCareerId), column, 'RECALLED');
      startReturn(column, 'RECALLED');
      const request = world().requests[column.requestId];
      if (request)
        alliances.emitAlliance(request.allianceId, 'alliance.aid.updated', {
          request: neutralRequest(request),
        });
      engine.save();
    } else throw new MockError(409, 'CONFLICT', 'Column cannot be recalled', { reason: 'NOT_RECALLABLE' });
    return columnDto(column, career);
  };

  /* ───────────── scheduled actions ───────────── */
  engine.registerExecutor('AID_REQUEST_EXPIRE', (_career, action) => {
    const request = world().requests[action.ref];
    if (request && request.status === 'OPEN') closeRequest(request, 'EXPIRED');
  });
  engine.registerExecutor('AID_COLUMN_ARRIVE', (helper, action) => {
    const column = world().columns[action.ref];
    if (!column || column.status !== 'EN_ROUTE') return;
    const request = world().requests[column.requestId]!;
    const requester = careerById(column.requesterCareerId);
    const incident = requester ? incidentOf(requester, request.incidentId) : undefined;
    if (!requester || !incident || CLOSED_INCIDENT.has(incident.status) || request.status !== 'OPEN') {
      // Nothing left to cover: back home, no cost, no reward (05 §8).
      column.reward = { ...column.reward, status: 'NONE' };
      startReturn(column, 'ABORTED');
      engine.save();
      return;
    }
    column.status = 'ON_SCENE';
    column.onSceneAt = action.dueAt;
    column.maxStayUntil = action.dueAt + engine.dur(AID_CFG.maxStayMinutes * 60);
    applyArrival(requester, request, column);
    {
      const helper = careerById(column.helperCareerId);
      const ma = alliances.membershipOf(column.requesterCareerId)?.alliance;
      if (ma)
        alliances.notify(
          requester,
          'AID_ARRIVED',
          { director: helper?.summary.directorName ?? '', tag: ma.tag, name: ma.name },
          `aid:${request.id}`,
          'IMPORTANT',
        );
    }
    engine.schedule(helper, 'AID_COLUMN_RETURN', AID_CFG.maxStayMinutes * 60, `${column.id}|stay`);
    for (const item of column.items) {
      const v = engine.patchVehicle(helper, item.vehicleId, {
        busyUntil: iso(column.maxStayUntil),
        alliedSupport: supportOf(column),
      });
      if (v) engine.emit(helper, 'vehicle.updated', { vehicle: v });
    }
    const allGapsCovered = gapDtos(requester, request).every((g) => g.missing === 0);
    if (allGapsCovered) {
      request.status = 'FILLED';
      alliances.emitAlliance(request.allianceId, 'alliance.aid.updated', {
        request: neutralRequest(request),
      });
    }
    alliances.emitAlliance(column.allianceId, 'alliance.column.updated', {
      column: columnDto(column, helper),
    });
    engine.save();
  });
  engine.registerExecutor('AID_COLUMN_RETURN', (helper, action) => {
    const [columnId, phase] = action.ref.split('|');
    const column = world().columns[columnId!];
    if (!column) return;
    if (phase === 'stay') {
      // The 20 minutes on scene are over: leave and return.
      if (column.status !== 'ON_SCENE') return;
      leaveScene(careerById(column.requesterCareerId), column, 'RETURNING');
      startReturn(column, 'RETURNING');
      engine.save();
      return;
    }
    if (column.status !== 'RETURNING' && column.status !== 'RECALLED' && column.status !== 'ABORTED') return;
    column.status = 'RETURNED';
    column.returnedAt = action.dueAt;
    for (const item of column.items) {
      const facility = helper.facilities.find((f) => f.id === column.fromFacilityId);
      const v = engine.patchVehicle(helper, item.vehicleId, {
        status: 'AVAILABLE',
        busyUntil: null,
        alliedSupport: null,
        position: facility?.position ?? helper.vehicles.find((x) => x.id === item.vehicleId)?.position,
      });
      if (v) engine.emit(helper, 'vehicle.returned', { vehicle: v });
    }
    alliances.emitAlliance(column.allianceId, 'alliance.column.updated', {
      column: columnDto(column, helper),
    });
    engine.save();
  });

  /* ───────────── requester world: the incident ends ───────────── */
  engine.hooks.incidentClosed.push((requester, incident, status) => {
    for (const request of Object.values(world().requests).filter(
      (r) =>
        r.requesterCareerId === requester.summary.id &&
        (r.incidentId === incident.id || r.majorId === incident.major?.id),
    )) {
      const stillOpen = request.majorId
        ? requester.incidents.some(
            (i) => i.id !== incident.id && i.major?.id === request.majorId && !CLOSED_INCIDENT.has(i.status),
          )
        : false;
      for (const column of Object.values(world().columns).filter((c) => c.requestId === request.id)) {
        if (column.applied[incident.id]) {
          delete column.applied[incident.id];
          if (
            column.status === 'ON_SCENE' &&
            Object.keys(column.applied).length === 0 &&
            column.onSceneAt !== null
          )
            column.secondsOnScene = Math.round(((engine.now() - column.onSceneAt) / 1000) * engine.speed);
        }
        if (stillOpen) continue;
        if (column.status === 'EN_ROUTE') {
          const helper = careerById(column.helperCareerId);
          if (helper)
            engine.cancelActions(helper, (a) => a.type === 'AID_COLUMN_ARRIVE' && a.ref === column.id);
          column.reward = { ...column.reward, status: 'NONE' };
          startReturn(column, 'ABORTED');
        } else if (column.status === 'ON_SCENE') startReturn(column, 'RETURNING');
      }
      if (stillOpen) continue;
      if (request.status === 'OPEN' || request.status === 'FILLED') {
        request.status = 'CLOSED';
        request.closedAt = engine.now();
      }
      settle(request, incident, status === 'RESOLVED');
      alliances.emitAlliance(request.allianceId, 'alliance.aid.updated', {
        request: neutralRequest(request),
      });
    }
  });

  /* ───────────── the major's view: allied columns and the request (study 05 §7) ───────────── */
  majorOf(engine).viewHooks.push((career, major: MajorIncidentDto) => {
    const request = Object.values(world().requests).find(
      (r) => r.requesterCareerId === career.summary.id && r.majorId === major.id,
    );
    if (!request) return major;
    const columns = Object.values(world().columns).filter(
      (c) => c.requestId === request.id && c.status !== 'RETURNED',
    );
    return { ...major, aidRequestId: request.id, alliedColumns: columns.map(alliedRow) };
  });

  const api: AllianceAidApi = {
    createRequest,
    cancelRequest,
    listRequests,
    getRequest,
    listColumns,
    columnOptions,
    sendColumn,
    recall,
    gapsOf,
  };
  apis.set(engine, api);

  /* ───────────── QA ───────────── */
  const careerOrThrow = (id: string) => {
    const c = engine.state.careers[id];
    if (!c) throw new MockError(404, 'NOT_FOUND', 'Career not found');
    return c;
  };
  /** QA: an ally spawns an incident in his world and shares it with the alliance; returns the request. */
  engine.qa.allyRequestAid = ((
    careerId: string,
    templateCode = 'FIRE_DWELLING',
    severity = 6,
    opts: { expiresInSeconds?: number } = {},
  ) => {
    const career = careerOrThrow(careerId);
    const incident = engine.spawnIncident(career, templateCode, false, { severity });
    // QA knob: a deadline nobody can meet (min ETA is 2 min) → every option `TOO_LATE`.
    if (opts.expiresInSeconds !== undefined)
      incident.expiresAt = iso(engine.now() + opts.expiresInSeconds * 1000);
    engine.save();
    return createRequest(career, incident.id, null);
  }) as never;
  /** QA: an ally sends a column (his useful AVAILABLE vehicles, up to `count`) towards a request. */
  engine.qa.allySendColumn = ((careerId: string, requestId: string, count = 2) => {
    const career = careerOrThrow(careerId);
    const options = columnOptions(career, requestId);
    const ids = options.vehicles
      .filter((v) => !v.tooLate)
      .slice(0, count)
      .map((v) => v.vehicleId);
    return sendColumn(career, requestId, ids);
  }) as never;
  /** QA: gives an ally AVAILABLE vehicles of a type (staffed) so he can help. */
  engine.qa.allyAddVehicles = ((careerId: string, typeCode: string, count = 2) => {
    const session = engine.state.currentSession;
    const career = careerOrThrow(careerId);
    const owner = Object.values(engine.state.users).find((u) => u.user.id === career.userId);
    if (owner) engine.state.currentSession = { email: owner.user.email, sessionId: 'qa-ally' };
    try {
      const ids = engine.qa.addVehicles(typeCode, count);
      engine.qa.staffAll();
      return ids;
    } finally {
      engine.state.currentSession = session;
      engine.save();
    }
  }) as never;
  /** QA: an ally's incident ends (RESOLVED by default): the columns on it are settled as at a real end. */
  engine.qa.allyCloseIncident = ((
    careerId: string,
    incidentId: string,
    status: 'RESOLVED' | 'FAILED' | 'EXPIRED' = 'RESOLVED',
  ) => {
    const career = careerOrThrow(careerId);
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident) throw new MockError(404, 'NOT_FOUND', 'Incident not found');
    engine.close(career, incident, status, engine.now());
    engine.save();
  }) as never;
  /** QA: the current career's aid requests (`AidRequestDto[]`, OPEN or ALL). */
  engine.qa.aidRequests = ((status: 'OPEN' | 'ALL' = 'ALL') =>
    listRequests(engine.qa.career(), { status }).data) as never;
}

export interface AllianceAidApi {
  createRequest: (career: MockCareer, incidentId: string, majorId: string | null) => AidRequestDto;
  cancelRequest: (career: MockCareer, requestId: string) => AidRequestDto;
  listRequests: (
    career: MockCareer,
    q: { status?: string; cursor?: string; limit?: number },
  ) => { data: AidRequestDto[]; nextCursor: string | null; hasMore: boolean };
  getRequest: (career: MockCareer, requestId: string) => AidRequestDto;
  listColumns: (
    career: MockCareer,
    q: { role?: string; active?: boolean; cursor?: string; limit?: number },
  ) => { data: AidColumnDto[]; nextCursor: string | null; hasMore: boolean };
  columnOptions: (career: MockCareer, requestId: string) => AidColumnOptionsDto;
  sendColumn: (career: MockCareer, requestId: string, vehicleIds: unknown) => AidColumnDto;
  recall: (career: MockCareer, columnId: string) => AidColumnDto;
  gapsOf: (
    incident: IncidentDto,
  ) => { capability: string; level: AidGapDto['level']; missing: number; allied: number }[];
}
const apis = new WeakMap<MockEngine, AllianceAidApi>();
export function allianceAidOf(engine: MockEngine): AllianceAidApi {
  const api = apis.get(engine);
  if (!api) throw new Error('alliance aid domain not installed');
  return api;
}

void DAY;
