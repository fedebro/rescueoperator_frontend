import {
  AllianceSnapshotDto,
  CareerSummary,
  FacilityDto,
  IncidentDto,
  IncidentOutcomeDto,
  MajorIncidentDto,
  RealtimeEnvelope,
  VehicleDto,
  WorldContextDto,
  type SyncSnapshot,
} from '@/contracts';
import { z } from 'zod';

/**
 * Pure reconciliation of realtime envelopes into the sync snapshot.
 * The payload always carries full DTOs, so applying an event is an upsert — idempotent by construction.
 */

export type ReconcileResult =
  | { kind: 'applied'; snapshot: SyncSnapshot; effects: Effect[] }
  | { kind: 'duplicate' } // seq already included in the snapshot
  | { kind: 'gap'; expected: number; received: number } // missed events → caller must refetch /sync
  | { kind: 'invalid'; reason: string };

export type Effect =
  | { type: 'incident.new'; incident: IncidentDto }
  | {
      type: 'incident.closed';
      incident: IncidentDto;
      result: 'resolved' | 'failed' | 'expired' | 'cancelled';
    }
  | { type: 'incident.escalated'; incident: IncidentDto }
  | { type: 'outcome'; outcome: IncidentOutcomeDto }
  | { type: 'vehicle.arrived'; vehicle: VehicleDto }
  | { type: 'vehicle.delivered'; vehicle: VehicleDto }
  | { type: 'vehicle.broke_down'; vehicle: VehicleDto }
  /** A closure appeared on the route: the vehicle is driving a detour and arrives `delaySeconds` later. */
  | { type: 'vehicle.rerouted'; vehicle: VehicleDto; delaySeconds: number }
  /** The vehicle is moving to another facility (reuses IN_DELIVERY, `transfer: true` on the event). */
  | { type: 'vehicle.transferring'; vehicle: VehicleDto }
  /** Back at its facility: AVAILABLE at once, or RESTOCKING when the single resupply rule stopped it (D-22). */
  | { type: 'vehicle.returned'; vehicle: VehicleDto }
  /** Its fuel just went under the reserve light (D-22): it will resupply on its own after the mission. */
  | { type: 'vehicle.reserve'; vehicle: VehicleDto }
  /**
   * An aircraft turned back at "bingo" (flight endurance): the flight home + the reserve is all it has left. With
   * `queuedIncidentId` it flies back to that incident on its own once refuelled.
   */
  | { type: 'vehicle.bingo'; vehicle: VehicleDto; queuedIncidentId: string | null }
  /** A vehicle was just committed to an incident (a dispatch, an automatic one included). */
  | { type: 'vehicle.committed'; vehicle: VehicleDto; incidentId: string }
  /**
   * A major incident changed (`career.updated` with `{ major }`): started (`started`: it was not the active one), phase,
   * growth, reinforcements, or ended.
   */
  | { type: 'major.updated'; major: MajorIncidentDto; started: boolean }
  | { type: 'level.reached'; level: number }
  | { type: 'unlock.granted'; codes: string[] }
  | { type: 'stipend.paid'; amount: string }
  | { type: 'notification'; payload: Record<string, unknown> }
  | {
      type: 'invalidate';
      scope:
        | 'catalog'
        | 'economy'
        | 'progression'
        | 'notifications'
        | 'facility'
        | 'config'
        | 'personnel'
        | 'medical'
        | 'inventory'
        | 'maintenance'
        | 'world'
        | 'monetization'
        | 'major'
        | 'alliance';
    };

const Payload = z
  .object({
    career: CareerSummary.optional(),
    incident: IncidentDto.optional(),
    incidents: z.array(IncidentDto).optional(),
    vehicle: VehicleDto.optional(),
    vehicles: z.array(VehicleDto).optional(),
    facility: FacilityDto.optional(),
    facilities: z.array(FacilityDto).optional(),
    world: WorldContextDto.optional(),
    outcome: IncidentOutcomeDto.optional(),
    credits: z.string().optional(),
    level: z.number().optional(),
    unlocks: z.array(z.string()).optional(),
    amount: z.string().optional(),
    unreadNotifications: z.number().optional(),
    /** `vehicle.updated` flags (additive): a detour around a new closure, or a transfer between facilities. */
    rerouted: z.boolean().optional(),
    previousArriveAt: z.string().optional(),
    transfer: z.boolean().optional(),
    /** `vehicle.updated` of an aircraft turned back at "bingo" (+ the incident it goes back to once refuelled). */
    bingo: z.boolean().optional(),
    queued: z.boolean().optional(),
    queuedIncidentId: z.string().nullable().optional(),
    /**
     * Major incidents: `career.updated` carries `{ major }` on every change of the running (or just ended) major. Parsed on
     * its own below: a view newer than this client never blocks the rest of the event.
     */
    major: z.unknown().optional(),
    /**
     * Alliances (D-102…D-123): `career.updated` may carry `{ alliance }` — the additive snapshot field (membership, role,
     * unread counters) — when the career joins, leaves or its counters change. Parsed on its own below.
     */
    alliance: z.unknown().optional(),
    featureFlags: z.record(z.boolean()).optional(),
    configVersion: z.string().optional(),
  })
  .passthrough();

const CLOSED = new Set(['RESOLVED', 'FAILED', 'EXPIRED', 'CANCELLED']);

function upsert<T extends { id: string }>(list: readonly T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const copy = list.slice();
  copy[idx] = item;
  return copy;
}

export function parseEnvelope(raw: unknown): RealtimeEnvelope | null {
  const parsed = RealtimeEnvelope.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function applyEvent(snapshot: SyncSnapshot, envelope: RealtimeEnvelope): ReconcileResult {
  if (envelope.careerId !== snapshot.career.id) return { kind: 'invalid', reason: 'career mismatch' };
  if (envelope.seq <= snapshot.seq) return { kind: 'duplicate' };
  if (envelope.seq > snapshot.seq + 1)
    return { kind: 'gap', expected: snapshot.seq + 1, received: envelope.seq };

  const parsed = Payload.safeParse(envelope.payload);
  if (!parsed.success) return { kind: 'invalid', reason: parsed.error.issues[0]?.message ?? 'payload' };
  const p = parsed.data;
  const effects: Effect[] = [];
  let next: SyncSnapshot = { ...snapshot, seq: envelope.seq };

  if (p.career) next = { ...next, career: p.career };
  if (p.credits !== undefined && !p.career)
    next = { ...next, career: { ...next.career, credits: p.credits } };
  if (p.world) next = { ...next, world: p.world };
  if (p.featureFlags) next = { ...next, featureFlags: p.featureFlags };
  if (p.configVersion) next = { ...next, configVersion: p.configVersion };
  if (p.unreadNotifications !== undefined) next = { ...next, unreadNotifications: p.unreadNotifications };

  for (const facility of [...(p.facilities ?? []), ...(p.facility ? [p.facility] : [])]) {
    next = { ...next, facilities: upsert(next.facilities, facility) };
  }
  for (const vehicle of [...(p.vehicles ?? []), ...(p.vehicle ? [p.vehicle] : [])]) {
    const before = next.vehicles.find((v) => v.id === vehicle.id);
    if (vehicle.autonomy?.fuel?.reserve === true && before?.autonomy?.fuel?.reserve !== true)
      effects.push({ type: 'vehicle.reserve', vehicle });
    if (vehicle.incidentId !== null && before && before.incidentId !== vehicle.incidentId)
      effects.push({ type: 'vehicle.committed', vehicle, incidentId: vehicle.incidentId });
    next = { ...next, vehicles: upsert(next.vehicles, vehicle) };
  }
  for (const incident of [...(p.incidents ?? []), ...(p.incident ? [p.incident] : [])]) {
    const known = next.incidents.some((i) => i.id === incident.id);
    // Closed incidents leave the operational snapshot (the outcome modal keeps its own copy).
    next = {
      ...next,
      incidents: CLOSED.has(incident.status)
        ? next.incidents.filter((i) => i.id !== incident.id)
        : upsert(next.incidents, incident),
    };
    if (!known && !CLOSED.has(incident.status)) effects.push({ type: 'incident.new', incident });
    // The backend emits `incident.resolved` when the reward is paid: the incident may still be RESOLVING (external
    // support, patients in transport) and leaves the snapshot with a later `incident.updated` → RESOLVED.
    if (CLOSED.has(incident.status))
      effects.push({
        type: 'incident.closed',
        incident,
        result: incident.status.toLowerCase() as 'resolved',
      });
  }
  const major = p.major === undefined ? null : MajorIncidentDto.safeParse(p.major);
  if (major?.success) {
    const m = major.data;
    const wasActive = snapshot.activeMajorIncidentId === m.id;
    const active =
      m.status === 'ACTIVE'
        ? m.id
        : next.activeMajorIncidentId === m.id
          ? null
          : (next.activeMajorIncidentId ?? null);
    next = { ...next, activeMajorIncidentId: active };
    effects.push({ type: 'major.updated', major: m, started: m.status === 'ACTIVE' && !wasActive });
    if (m.status === 'ENDED')
      effects.push({ type: 'invalidate', scope: 'economy' }, { type: 'invalidate', scope: 'progression' });
  } else if (major) effects.push({ type: 'invalidate', scope: 'major' });
  if (p.alliance !== undefined) {
    const alliance = AllianceSnapshotDto.nullable().safeParse(p.alliance);
    if (alliance.success) {
      const before = snapshot.alliance ?? null;
      next = { ...next, alliance: alliance.data };
      // Joined, left, or another alliance: the whole section is re-read; counters alone only move the badge.
      if ((before?.id ?? null) !== (alliance.data?.id ?? null) || before?.role !== alliance.data?.role)
        effects.push({ type: 'invalidate', scope: 'alliance' });
    } else effects.push({ type: 'invalidate', scope: 'alliance' });
  }
  if (p.outcome) {
    if (!next.pendingOutcomes.some((o) => o.incidentId === p.outcome!.incidentId)) {
      next = { ...next, pendingOutcomes: [...next.pendingOutcomes, p.outcome] };
    }
    effects.push({ type: 'outcome', outcome: p.outcome });
  }

  switch (envelope.type) {
    case 'incident.escalated':
      if (p.incident) effects.push({ type: 'incident.escalated', incident: p.incident });
      break;
    case 'incident.resolved':
    case 'incident.failed':
    case 'incident.expired':
    case 'incident.cancelled':
      effects.push({ type: 'invalidate', scope: 'economy' }, { type: 'invalidate', scope: 'progression' });
      break;
    case 'vehicle.arrived':
      if (p.vehicle) effects.push({ type: 'vehicle.arrived', vehicle: p.vehicle });
      break;
    case 'vehicle.delivered':
      if (p.vehicle) effects.push({ type: 'vehicle.delivered', vehicle: p.vehicle });
      break;
    case 'vehicle.broke_down':
      if (p.vehicle) effects.push({ type: 'vehicle.broke_down', vehicle: p.vehicle });
      effects.push({ type: 'invalidate', scope: 'maintenance' });
      break;
    case 'vehicle.updated':
      if (p.vehicle && p.rerouted) {
        const previous = p.previousArriveAt ? Date.parse(p.previousArriveAt) : NaN;
        const now = p.vehicle.movement?.arriveAt ? Date.parse(p.vehicle.movement.arriveAt) : NaN;
        effects.push({
          type: 'vehicle.rerouted',
          vehicle: p.vehicle,
          delaySeconds:
            Number.isNaN(previous) || Number.isNaN(now)
              ? 0
              : Math.max(0, Math.round((now - previous) / 1000)),
        });
      }
      if (p.vehicle && p.bingo)
        effects.push({
          type: 'vehicle.bingo',
          vehicle: p.vehicle,
          queuedIncidentId: p.queued ? (p.queuedIncidentId ?? null) : null,
        });
      if (p.vehicle && p.transfer) {
        effects.push(
          { type: 'vehicle.transferring', vehicle: p.vehicle },
          { type: 'invalidate', scope: 'facility' },
          { type: 'invalidate', scope: 'personnel' },
        );
      }
      break;
    case 'vehicle.returned':
      if (p.vehicle) effects.push({ type: 'vehicle.returned', vehicle: p.vehicle });
      effects.push(
        { type: 'invalidate', scope: 'maintenance' },
        { type: 'invalidate', scope: 'inventory' },
        { type: 'invalidate', scope: 'personnel' },
      );
      break;
    case 'level.reached':
      if (p.level !== undefined) effects.push({ type: 'level.reached', level: p.level });
      effects.push({ type: 'invalidate', scope: 'catalog' }, { type: 'invalidate', scope: 'progression' });
      break;
    case 'unlock.granted':
      effects.push(
        { type: 'unlock.granted', codes: p.unlocks ?? [] },
        { type: 'invalidate', scope: 'catalog' },
        { type: 'invalidate', scope: 'progression' },
      );
      break;
    case 'stipend.paid':
      if (p.amount) effects.push({ type: 'stipend.paid', amount: p.amount });
      effects.push({ type: 'invalidate', scope: 'economy' });
      break;
    case 'credits.changed':
      effects.push({ type: 'invalidate', scope: 'economy' }, { type: 'invalidate', scope: 'monetization' });
      break;
    case 'xp.awarded':
      effects.push({ type: 'invalidate', scope: 'progression' });
      break;
    case 'facility.updated':
      effects.push({ type: 'invalidate', scope: 'facility' }, { type: 'invalidate', scope: 'world' });
      break;
    // Depth domains are not part of the snapshot: their REST resources are refetched when the server says they changed.
    case 'personnel.updated':
      effects.push({ type: 'invalidate', scope: 'personnel' });
      break;
    case 'patient.updated':
      effects.push({ type: 'invalidate', scope: 'medical' });
      break;
    case 'inventory.updated':
      effects.push({ type: 'invalidate', scope: 'inventory' });
      break;
    case 'maintenance.updated':
      effects.push({ type: 'invalidate', scope: 'maintenance' });
      break;
    case 'world.updated':
      effects.push({ type: 'invalidate', scope: 'world' });
      break;
    case 'notification.created':
      effects.push(
        { type: 'notification', payload: envelope.payload },
        { type: 'invalidate', scope: 'notifications' },
      );
      break;
    case 'config.updated':
      effects.push({ type: 'invalidate', scope: 'config' }, { type: 'invalidate', scope: 'catalog' });
      break;
    default:
      break;
  }
  return { kind: 'applied', snapshot: next, effects };
}
