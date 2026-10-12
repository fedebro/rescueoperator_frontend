import type { IncidentDto, VehicleDto } from '@/contracts';
import { haversineMeters, movementPoint, type LngLat } from '@/lib/geo';
import { ECONOMY, MANAGERIAL_SCALE, VEHICLE_TYPES } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import {
  MockError,
  iso,
  text,
  type MockChainOption,
  type MockCareer,
  type MockDispatchOption,
  type MockEngine,
} from '../engine';
import type { QaHelpers } from '../qa';
import { domainState } from './index';
import { autonomyOf, type ChainAutonomyCheck } from './autonomy';
import { logisticsOf } from './logistics';
import { dispatchGate } from './water';
import {
  PERSONNEL_PARAMETERS,
  bandOf,
  fatigueAt,
  loadClassOf,
  personnelDomain,
  selectCrew,
  type MockOperator,
} from './personnel';

/**
 * Mission chaining of the mock — the in-browser counterpart of the backend's `chain()` (analisi/note-agenti/chaining-backend.md,
 * analisi/note-agenti/invio-mezzi-ui.md): a vehicle that is not free can be sent to another call. ONE command, the server
 * decides — REDIRECTED when the vehicle is on its way home and every condition holds right now (it turns where it is, crew
 * aboard), QUEUED otherwise (one slot per vehicle, fired through the normal dispatch the instant it is AVAILABLE again).
 * Every `chain` block of the dispatch options (`currentIncidentId`, `stockLow`, `estimate`…) follows the backend's
 * `chainOptionDto` / `freeAtEstimate` / `arrivalEstimate`, with the mock's time (game seconds ÷ speed).
 */

/** Statuses a `chain` block is offered for: on a mission, returning or resupplying (the backend's CHAIN_PREVIEW_STATUSES). */
const TRACKED = new Set<VehicleDto['status']>([
  'PREPARING',
  'EN_ROUTE',
  'ON_SCENE',
  'TRANSPORTING',
  'AT_HOSPITAL',
  'RETURNING',
  'RESTOCKING',
  'TO_WATER_SOURCE',
  'AT_WATER_SOURCE',
  'TAXIING',
  'TAKING_OFF',
]);
/** Straight line → road for the read-only way home out of a scene or a hospital (the routing fallback factor, 1.4). */
const STRAIGHT_LINE_FACTOR = 1.4;

interface QueueSlot {
  incidentId: string;
  queuedAt: number;
}
export interface ChainState {
  /** Vehicle → the incident it is coming back from (set when it heads home, cleared when it is back or sent again). */
  returnFrom: Record<string, string>;
  /** Vehicle → its one queue slot (a new `chain` replaces it). */
  queue: Record<string, QueueSlot>;
}
export const chainState = (career: MockCareer): ChainState =>
  domainState<ChainState>(career, 'chain', () => ({ returnFrom: {}, queue: {} }));

type Crew = NonNullable<MockChainOption['crew']>;
interface Eligibility {
  eligible: boolean;
  reason: string | null;
  crew: Crew | null;
  autonomy: ChainAutonomyCheck | null;
}
interface Free {
  freeAt: number | null;
  basis: NonNullable<MockChainOption['estimate']>['basis'];
  approximate: boolean;
}

export interface ChainResult {
  mode: 'REDIRECTED' | 'QUEUED';
  vehicle: VehicleDto;
  incident?: IncidentDto;
  queue?: { incidentId: string; queuedAt: string };
}

export interface ChainDomain {
  /** ★POST /vehicles/:id/chain */
  chain(
    career: MockCareer,
    vehicleId: string,
    incidentId: string,
    options?: { queueOnly?: boolean },
  ): ChainResult;
  /** POST /vehicles/:id/chain/cancel — idempotent. */
  cancelQueue(career: MockCareer, vehicleId: string): VehicleDto;
  /** The incident a vehicle on its way home is coming back from (null when it is not, or after it was sent again). */
  returningFrom(career: MockCareer, vehicleId: string): string | null;
}

const domains = new WeakMap<MockEngine, ChainDomain>();
export function chainOf(engine: MockEngine): ChainDomain {
  const domain = domains.get(engine);
  if (!domain) throw new Error('dispatch-chain domain not installed');
  return domain;
}

export function installDispatchChain(engine: MockEngine): void {
  const typeOf = (typeCode: string) => VEHICLE_TYPES.find((t) => t.code === typeCode);
  const vehicleOf = (career: MockCareer, id: string): VehicleDto => {
    const vehicle = career.vehicles.find((v) => v.id === id);
    if (!vehicle) throw new MockError(404, 'NOT_FOUND', 'Vehicle not found');
    return vehicle;
  };
  const homeOf = (career: MockCareer, vehicle: VehicleDto): LngLat => {
    const facility = career.facilities.find((f) => f.id === vehicle.facilityId);
    return facility ? engine.homePositionOf(facility, vehicle.typeCode) : vehicle.position;
  };
  /** Game seconds → real milliseconds (the engine's compression); nothing stays nothing (no 250 ms floor). */
  const ms = (gameSeconds: number): number => (gameSeconds <= 0 ? 0 : engine.dur(gameSeconds));

  /** The incident a vehicle is on: its dispatch, or — on its way home — the one it comes back from. `null` while resupplying. */
  const currentIdOf = (career: MockCareer, vehicle: VehicleDto): string | null => {
    if (vehicle.status === 'RESTOCKING') return null;
    if (vehicle.status === 'RETURNING') return chainState(career).returnFrom[vehicle.id] ?? null;
    return vehicle.incidentId;
  };

  /* ───────────── "when is it free": the backend's freeAtEstimate ───────────── */
  /** End of the work on a scene counted from `from` (an unattended scene is assumed to need what is left at full pace). */
  const workEndFrom = (incident: IncidentDto | undefined, from: number): number | null => {
    if (!incident || incident.status === 'RESOLVING') return null;
    const w = incident.work;
    const elapsed = (Math.max(0, from - Date.parse(w.anchorAt)) / 1000) * engine.speed;
    const remaining = Math.max(0, w.remaining - w.ratePerSecond * elapsed);
    return from + ms(remaining / (w.ratePerSecond > 0 ? w.ratePerSecond : 1));
  };

  const freeEstimate = (
    career: MockCareer,
    vehicle: VehicleDto,
    current: IncidentDto | undefined,
    resupplySeconds: number,
    now: number,
  ): Free => {
    const home = homeOf(career, vehicle);
    const wayHome = (from: LngLat): number =>
      ms(engine.travelSeconds(haversineMeters(from, home) * STRAIGHT_LINE_FACTOR, vehicle.typeCode));
    const unknown: Free = { freeAt: null, basis: 'UNKNOWN', approximate: true };
    switch (vehicle.status) {
      case 'RETURNING':
        return vehicle.busyUntil
          ? {
              freeAt: Date.parse(vehicle.busyUntil) + ms(resupplySeconds),
              basis: 'RETURNING',
              approximate: false,
            }
          : { freeAt: null, basis: 'UNKNOWN', approximate: true };
      case 'ON_SCENE': {
        const end = workEndFrom(current, now);
        return end === null
          ? unknown
          : {
              freeAt: end + wayHome(vehicle.position) + ms(resupplySeconds),
              basis: 'WORK_END',
              approximate: true,
            };
      }
      case 'PREPARING':
      case 'EN_ROUTE': {
        const busyUntil = vehicle.busyUntil ? Date.parse(vehicle.busyUntil) : now;
        // PREPARING: `busyUntil` is the departure, the trip comes on top.
        const arrive =
          vehicle.status === 'EN_ROUTE' || !current
            ? busyUntil
            : busyUntil + ms(engine.legFor(career, engine.atBase(career, vehicle), current).seconds);
        const there = Math.max(arrive, now);
        const end = workEndFrom(current, there);
        const scene = current ? engine.destinationOf(vehicle, current) : vehicle.position;
        return end === null
          ? unknown
          : { freeAt: end + wayHome(scene) + ms(resupplySeconds), basis: 'WORK_END', approximate: true };
      }
      case 'TRANSPORTING':
      case 'AT_HOSPITAL': {
        const handoff = ms(ECONOMY.medical.hospitalHandoffSeconds);
        const busyUntil = vehicle.busyUntil ? Date.parse(vehicle.busyUntil) : now;
        // On the road the hand-off starts at the arrival; at the hospital `busyUntil` is the end of the hand-off itself.
        const left = vehicle.status === 'TRANSPORTING' ? busyUntil + handoff : busyUntil;
        const hospital = vehicle.movement?.path.at(-1) ?? vehicle.position;
        return {
          freeAt: Math.max(left, now) + wayHome(hospital) + ms(resupplySeconds),
          basis: 'HOSPITAL',
          approximate: true,
        };
      }
      default:
        return unknown;
    }
  };

  /** `freeAt` + the preparation and trip to THIS incident (`etaSeconds`, real seconds, already in the option). */
  const arrivalEstimate = (
    free: Free,
    target: IncidentDto,
    etaSeconds: number,
  ): NonNullable<MockChainOption['estimate']> => {
    const arriveAt = free.freeAt === null ? null : free.freeAt + etaSeconds * 1000;
    const expiresAt =
      target.status === 'PENDING_RESPONSE' && target.expiresAt ? Date.parse(target.expiresAt) : null;
    return {
      freeAt: free.freeAt === null ? null : iso(free.freeAt),
      arriveAt: arriveAt === null ? null : iso(arriveAt),
      basis: free.basis,
      approximate: free.approximate,
      incidentExpiresAt: expiresAt === null ? null : iso(expiresAt),
      afterExpiry: arriveAt !== null && expiresAt !== null && arriveAt > expiresAt,
    };
  };

  /* ───────────── crew: the backend's chainCrewPreview / carryCrewForward ───────────── */
  const nightMultiplier = (now: number): number => {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: PESCARA.timezone }).format(
        now,
      ),
    );
    return hour >= 21 || hour < 5 ? PERSONNEL_PARAMETERS.fatigue.nightMultiplier : 1;
  };
  const missionFatigue = (op: MockOperator, load: ReturnType<typeof loadClassOf>, now: number): number => {
    const P = PERSONNEL_PARAMETERS.fatigue;
    const window = engine.dur(Math.max(10, Math.round(P.consecutiveWindowSeconds * MANAGERIAL_SCALE)));
    const recent = op.recentMissions.filter((at) => now - at < window).length;
    const extra = P.consecutiveMissionExtra[Math.min(recent, P.consecutiveMissionExtra.length - 1)] ?? 0;
    return (P.missionLoad[load] + extra) * nightMultiplier(now);
  };
  /** The crew aboard, with the fatigue the mission it is finishing adds — against the vehicle's OWN crew requirement. */
  const crewPreview = (
    career: MockCareer,
    vehicle: VehicleDto,
    now: number,
  ): { crew: Crew | null; blocked: string | null } => {
    const type = typeOf(vehicle.typeCode);
    const s = personnelDomain(engine).state(career);
    const ids = s.crews[vehicle.id];
    if (!type || !ids || ids.length === 0) return { crew: null, blocked: null };
    const load = loadClassOf(s.missions[vehicle.id] ?? 1);
    const aboard = s.people
      .filter((op) => ids.includes(op.id))
      .map((op): MockOperator => {
        const value = Math.min(100, fatigueAt(op.fatigue, now) + missionFatigue(op, load, now));
        // A crew on board is "ON_MISSION": drawn as if it were free, only the projected fatigue decides who can go on.
        return {
          ...op,
          status: 'AVAILABLE',
          fatigue: { value, ratePerSecond: 0, anchorAt: iso(now), band: bandOf(value) },
        };
      });
    if (aboard.length === 0) return { crew: null, blocked: null };
    const selection = selectCrew(type, aboard, { now, ownTeam: new Set(), target: 'OPTIMAL' });
    return {
      blocked: selection.blocked,
      crew: {
        available: selection.crew.length,
        min: type.crewMin,
        optimal: type.crewOptimal,
        missingQualifications: selection.missingQualifications,
        missingRoles: selection.missingRoles,
        maxFatigueBand: selection.maxFatigueBand,
        efficiency: selection.efficiency,
        restUntilSeconds: null,
      },
    };
  };
  /** The redirect commits: the mission it finishes tires the crew now, and the crew rides straight on (never released). */
  const carryCrewForward = (
    career: MockCareer,
    vehicle: VehicleDto,
    next: IncidentDto,
    now: number,
  ): void => {
    const s = personnelDomain(engine).state(career);
    const ids = s.crews[vehicle.id];
    if (!ids) return;
    const load = loadClassOf(s.missions[vehicle.id] ?? 1);
    for (const op of s.people.filter((x) => ids.includes(x.id) && x.status === 'ON_MISSION')) {
      const value = Math.min(100, fatigueAt(op.fatigue, now) + missionFatigue(op, load, now));
      const window = engine.dur(
        Math.max(10, Math.round(PERSONNEL_PARAMETERS.fatigue.consecutiveWindowSeconds * MANAGERIAL_SCALE)),
      );
      op.recentMissions = [...op.recentMissions.filter((at) => now - at < window), now];
      op.missions += 1;
      if (op.missions % 4 === 0) op.competence = Math.min(100, op.competence + 1);
      op.fatigue = { value, ratePerSecond: 0, anchorAt: iso(now), band: bandOf(value) };
      op.history = [
        {
          at: iso(now),
          kind: 'MISSION',
          text: text('personnel.history.MISSION', { vehicle: vehicle.callSign }),
        },
        ...op.history,
      ].slice(0, 30);
    }
    s.missions[vehicle.id] = next.severity;
    engine.emit(career, 'personnel.updated', {});
  };

  /* ───────────── the three-condition gate: the backend's chainEligibility ───────────── */
  const eligibility = (
    career: MockCareer,
    vehicle: VehicleDto,
    target: IncidentDto,
    now: number,
  ): Eligibility => {
    const { crew, blocked } = crewPreview(career, vehicle, now);
    if (vehicle.status !== 'RETURNING')
      return { eligible: false, reason: 'VEHICLE_NOT_RETURNING', crew, autonomy: null };
    // Computed for every vehicle on its way home, eligible or not: "free at" needs the resupply stop it predicts at base.
    const autonomy = autonomyOf(engine).chainCheck(
      career,
      vehicle.id,
      { position: engine.destinationOf(vehicle, target), workRemaining: target.work.remaining },
      now,
    );
    // A boat on its way home is on the water or on its trailer: queued, and sent from its base the moment it is back.
    if (typeOf(vehicle.typeCode)?.domain === 'WATER')
      return { eligible: false, reason: 'BOAT_NEEDS_BASE', crew, autonomy };
    if (vehicle.health <= 0) return { eligible: false, reason: 'VEHICLE_INOPERABLE', crew, autonomy };
    if (blocked) return { eligible: false, reason: blocked, crew, autonomy };
    if (logisticsOf(engine).maintenanceStatus(career, vehicle).due === 'OVERDUE')
      return { eligible: false, reason: 'MAINTENANCE_DUE', crew, autonomy };
    if (autonomy.blocked) return { eligible: false, reason: autonomy.blocked, crew, autonomy };
    return { eligible: true, reason: null, crew, autonomy };
  };

  /* ───────────── the `chain` block of a dispatch option ───────────── */
  engine.hooks.dispatchOption.push((career, vehicle, option, incident): MockDispatchOption => {
    if (!TRACKED.has(vehicle.status)) return option;
    // A vehicle the call itself refuses (a boat on a land call, an aircraft nobody asked for) is no use queued either: the
    // server sends no `chain` for it (`dispatchGateBlock`).
    if (dispatchGate(vehicle, incident)) return option;
    // Heading to, working on, or carrying a patient away from THIS very incident: nothing to chain. Only a unit coming back
    // from it can be sent again.
    if (vehicle.incidentId === incident.id && vehicle.status !== 'RETURNING') return option;
    const now = engine.now();
    const state = chainState(career);
    const queued = state.queue[vehicle.id];
    const queuedIncident = queued ? career.incidents.find((i) => i.id === queued.incidentId) : undefined;
    const currentId = currentIdOf(career, vehicle);
    const current = currentId ? career.incidents.find((i) => i.id === currentId) : undefined;

    if (vehicle.status === 'RESTOCKING') {
      // A vehicle resupplying at base has no leg any more: it can only be queued, free at the end of its stop.
      const free: Free = {
        freeAt: vehicle.busyUntil ? Date.parse(vehicle.busyUntil) : null,
        basis: 'RESTOCKING',
        approximate: false,
      };
      return {
        ...option,
        chain: {
          vehicleStatus: vehicle.status,
          redirectEligible: false,
          blockedReason: 'VEHICLE_RESTOCKING',
          queueable: true,
          availableAt: vehicle.busyUntil,
          crew: null,
          queuedIncidentId: queuedIncident?.id ?? null,
          currentIncidentId: null,
          stockLow: [],
          fuelStop: null,
          estimate: arrivalEstimate(free, incident, option.etaSeconds),
        },
      };
    }

    const elig = eligibility(career, vehicle, incident, now);
    const resupply = elig.autonomy?.resupplySecondsAtBase ?? 0;
    const free = freeEstimate(career, vehicle, current, resupply, now);
    const stop = elig.autonomy?.fuelStop ?? null;
    return {
      ...option,
      chain: {
        vehicleStatus: vehicle.status,
        redirectEligible: elig.eligible,
        blockedReason: elig.reason,
        queueable: true,
        // "Free at" includes the resupply stop the single rule predicts once home (it used to stop at the return arrival).
        availableAt:
          vehicle.status === 'RETURNING' && vehicle.busyUntil
            ? iso(Date.parse(vehicle.busyUntil) + ms(resupply))
            : null,
        crew: elig.crew,
        queuedIncidentId: queuedIncident?.id ?? null,
        currentIncidentId: currentId,
        stockLow: elig.autonomy?.stockLow ?? [],
        // The redirect would refuel at a filling station first (the pump stop is already in the new leg's ETA).
        fuelStop: stop
          ? { extraSeconds: Math.round(stop.extraSeconds / engine.speed), premium: String(stop.premium) }
          : null,
        estimate: arrivalEstimate(free, incident, option.etaSeconds),
      },
    };
  });

  /* ───────────── where a vehicle on its way home comes from ───────────── */
  // The vehicle says it, like the server's `VehicleDto.returningFromIncidentId`: the incident it comes back from while
  // RETURNING (`incidentId` is null then), null in every other status.
  engine.hooks.vehicleView.push((career, vehicle) => ({
    ...vehicle,
    returningFromIncidentId:
      vehicle.status === 'RETURNING' ? (chainState(career).returnFrom[vehicle.id] ?? null) : null,
  }));
  engine.hooks.vehicleSentHome.push((career, before) => {
    const state = chainState(career);
    if (!before.incidentId) return;
    state.returnFrom[before.id] = before.incidentId;
    // the stored vehicle was patched to RETURNING before it was known where from: read it again
    engine.patchVehicle(career, before.id, {});
  });
  engine.hooks.vehicleReturned.push((career, vehicle) => {
    delete chainState(career).returnFrom[vehicle.id];
  });

  /* ───────────── the queue: one slot per vehicle, fired through the normal dispatch ───────────── */
  const clearedNotice = (career: MockCareer, vehicle: VehicleDto, queueCleared = true): void => {
    engine.emit(career, 'vehicle.updated', {
      vehicle,
      queued: false,
      ...(queueCleared ? { queueCleared } : {}),
    });
    engine.notify(career, {
      category: 'FLEET',
      priority: 'INFO',
      title: text('notification.QUEUE_CLEARED.title'),
      body: text('notification.QUEUE_CLEARED.body', { callSign: vehicle.callSign }),
      action: { kind: 'OPEN_VEHICLE', targetId: vehicle.id },
    });
  };
  /**
   * The instant a queued vehicle is AVAILABLE again (back, resupplied, repaired…), it leaves for its slot through the NORMAL
   * dispatch — every check runs again (`origin` QUEUE: no free undo). A target that is no longer good clears the slot with
   * a notification instead of leaving the vehicle silently idle.
   */
  const fireQueues = (career: MockCareer): void => {
    const state = chainState(career);
    for (const [vehicleId, slot] of Object.entries(state.queue)) {
      const vehicle = career.vehicles.find((v) => v.id === vehicleId);
      if (!vehicle) {
        delete state.queue[vehicleId];
        continue;
      }
      if (vehicle.status !== 'AVAILABLE') continue;
      delete state.queue[vehicleId];
      const incident = career.incidents.find((i) => i.id === slot.incidentId);
      if (!incident || !engine.canReceive(career, incident)) {
        clearedNotice(career, vehicle);
        continue;
      }
      try {
        engine.dispatch(career, incident.id, [vehicle.id], 'QUEUE');
        engine.emit(career, 'vehicle.updated', {
          vehicle: career.vehicles.find((v) => v.id === vehicleId) ?? vehicle,
          queued: false,
        });
      } catch {
        clearedNotice(career, vehicle);
      }
    }
  };
  engine.hooks.settled.push((career) => fireQueues(career));

  /* ───────────── the commands ───────────── */
  const setQueue = (career: MockCareer, vehicle: VehicleDto, incident: IncidentDto): number => {
    const now = engine.now();
    chainState(career).queue[vehicle.id] = { incidentId: incident.id, queuedAt: now };
    engine.emit(career, 'vehicle.updated', {
      vehicle,
      queued: true,
      queuedIncidentId: incident.id,
    });
    return now;
  };

  /** Attempts the redirect; `null` = not eligible (the caller queues instead — never a hard failure). */
  const tryRedirect = (
    career: MockCareer,
    vehicle: VehicleDto,
    target: IncidentDto,
  ): { vehicle: VehicleDto; incident: IncidentDto } | null => {
    const now = engine.now();
    const elig = eligibility(career, vehicle, target, now);
    if (!elig.eligible) return null;

    // From where the vehicle actually is on its way home — never from its base.
    const from = vehicle.movement ? movementPoint(vehicle.movement, now).position : vehicle.position;
    const planned = engine.legFor(career, { ...vehicle, position: from }, target);
    const stop = elig.autonomy?.fuelStop ?? null;
    // A redirect in reserve goes through a filling station first: the stop is part of the new leg.
    const leg = stop ? { ...planned, seconds: planned.seconds + stop.extraSeconds } : planned;
    const fromId = chainState(career).returnFrom[vehicle.id] ?? null;

    // What the free undo would restore — a redirect has none, but the record keeps the incident as it was.
    const dueOf = (type: string) =>
      career.actions.find((a) => a.type === type && a.ref === target.id)?.dueAt ?? null;
    const prior = {
      status: target.status,
      expiresAt: target.expiresAt,
      nextEscalationAt: target.nextEscalationAt,
      escalating: target.escalating,
      expireDueAt: dueOf('INCIDENT_EXPIRE'),
      escalateDueAt: dueOf('INCIDENT_ESCALATE'),
    };

    // 1. The old leg closes like a normal return (fuel for what was driven; the crew stays aboard instead of going home).
    engine.cancelActions(career, (a) => a.ref === vehicle.id && a.type === 'VEHICLE_RETURNED');
    autonomyOf(engine).chainCommit(career, vehicle.id, target, now, stop);
    carryCrewForward(career, vehicle, target, now);
    delete chainState(career).returnFrom[vehicle.id];
    delete chainState(career).queue[vehicle.id];

    // 2. The new leg opens already EN_ROUTE (no PREPARING: the crew is on the road).
    const { movement, arriveAt } = engine.movementOf(leg, now, 'TO_INCIDENT');
    const patched = engine.patchVehicle(career, vehicle.id, {
      status: 'EN_ROUTE',
      incidentId: target.id,
      position: from,
      movement,
      busyUntil: iso(arriveAt),
    })!;
    career.legs.push({
      vehicleId: vehicle.id,
      incidentId: target.id,
      path: leg.path,
      distanceMeters: leg.distanceMeters,
      dispatchedAt: now,
      arrivedAt: null,
      ...(leg.fuelMeters !== undefined ? { fuelMeters: leg.fuelMeters } : {}),
      ...(leg.segments ? { segments: leg.segments } : {}),
    });
    career.actions.push({ id: engine.id('act'), type: 'VEHICLE_ARRIVE', dueAt: arriveAt, ref: vehicle.id });

    // 3. The call has somebody on its way: no more expiry / escalation clock.
    engine.cancelActions(
      career,
      (a) => (a.type === 'INCIDENT_EXPIRE' || a.type === 'INCIDENT_ESCALATE') && a.ref === target.id,
    );
    engine.patchIncident(career, target.id, { expiresAt: null, nextEscalationAt: null, escalating: false });
    const next = engine.recompute(career, target.id, now)!;
    engine.recordDispatch(career, {
      incidentId: target.id,
      vehicleIds: [vehicle.id],
      at: now,
      origin: 'REDIRECT',
      cancellableUntil: null,
      prior,
    });
    if (fromId && fromId !== target.id)
      engine.log(
        career,
        fromId,
        'vehicle.chained',
        text('timeline.vehicle_chained_away', { callSign: vehicle.callSign }),
        now,
        vehicle.id,
      );
    engine.log(
      career,
      target.id,
      'vehicle.dispatched',
      text('timeline.vehicle_dispatched', { callSign: vehicle.callSign }),
      now,
      vehicle.id,
    );
    engine.emit(career, 'vehicle.updated', {
      vehicle: patched,
      chained: true,
      fromIncidentId: fromId,
      toIncidentId: target.id,
    });
    engine.emit(career, 'incident.updated', { incident: next });
    return { vehicle: engine.view(career, patched), incident: next };
  };

  const chain: ChainDomain['chain'] = (career, vehicleId, incidentId, options = {}) => {
    const vehicle = vehicleOf(career, vehicleId);
    if (vehicle.status === 'AVAILABLE' || vehicle.status === 'IN_DELIVERY')
      throw new MockError(
        409,
        'VEHICLE_NOT_CHAINABLE',
        'This vehicle is already available (or not yet delivered): dispatch it directly instead of chaining it',
        { status: vehicle.status },
      );
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident) throw new MockError(404, 'NOT_FOUND', 'Incident not found');
    if (!engine.canReceive(career, incident))
      throw new MockError(409, 'INCIDENT_NOT_DISPATCHABLE', 'This incident can no longer receive vehicles', {
        status: incident.status,
      });
    // A unit coming back from this very incident (recalled by mistake, or released and needed again) may be sent straight
    // back: only a vehicle still heading there, working there or carrying its patient away is "already assigned".
    if (vehicle.incidentId === incident.id && vehicle.status !== 'RETURNING')
      throw new MockError(400, 'VALIDATION_ERROR', 'This vehicle is already assigned to that incident');

    if (vehicle.status === 'RETURNING' && !options.queueOnly) {
      const redirected = tryRedirect(career, vehicle, incident);
      if (redirected) {
        engine.save();
        return { mode: 'REDIRECTED', vehicle: redirected.vehicle, incident: redirected.incident };
      }
    }
    const queuedAt = setQueue(career, vehicle, incident);
    engine.save();
    return {
      mode: 'QUEUED',
      vehicle: engine.view(career, vehicleOf(career, vehicleId)),
      queue: { incidentId: incident.id, queuedAt: iso(queuedAt) },
    };
  };

  const cancelQueue: ChainDomain['cancelQueue'] = (career, vehicleId) => {
    const vehicle = vehicleOf(career, vehicleId);
    const state = chainState(career);
    if (state.queue[vehicleId]) {
      delete state.queue[vehicleId];
      engine.emit(career, 'vehicle.updated', { vehicle, queued: false });
      engine.save();
    }
    return engine.view(career, vehicle);
  };

  const domain: ChainDomain = {
    chain,
    cancelQueue,
    returningFrom: (career, vehicleId) => chainState(career).returnFrom[vehicleId] ?? null,
  };
  domains.set(engine, domain);

  /* ───────────── QA helpers ───────────── */
  const helpers = {
    /** Where the vehicles on their way home come from, and the queue slots (default: the whole career). */
    chainState: () => {
      const state = chainState(engine.qa.career());
      return { returnFrom: { ...state.returnFrom }, queue: { ...state.queue } };
    },
    /** Takes a vehicle back to a fresh queue state (tests that re-use a career). */
    clearQueues: () => {
      chainState(engine.qa.career()).queue = {};
      engine.save();
    },
  };
  const attach = () => Object.assign(engine.qa, helpers as unknown as Partial<QaHelpers>);
  if (engine.qa) attach();
  else queueMicrotask(attach);
}
