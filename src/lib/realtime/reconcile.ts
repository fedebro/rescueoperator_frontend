import {
  CareerSummary,
  FacilityDto,
  IncidentDto,
  IncidentOutcomeDto,
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
  | { type: 'level.reached'; level: number }
  | { type: 'unlock.granted'; codes: string[] }
  | { type: 'stipend.paid'; amount: string }
  | { type: 'notification'; payload: Record<string, unknown> }
  | {
      type: 'invalidate';
      scope: 'catalog' | 'economy' | 'progression' | 'notifications' | 'facility' | 'config';
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
      if (p.incident)
        effects.push({
          type: 'incident.closed',
          incident: p.incident,
          result: envelope.type.slice('incident.'.length) as 'resolved',
        });
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
      effects.push({ type: 'invalidate', scope: 'economy' });
      break;
    case 'xp.awarded':
      effects.push({ type: 'invalidate', scope: 'progression' });
      break;
    case 'facility.updated':
      effects.push({ type: 'invalidate', scope: 'facility' });
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
