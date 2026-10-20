import type { IncidentDto, VehicleDto } from '@/contracts';

/**
 * «Racconto in diretta» (primo turno, study 2026-10-20 §3.2): one short line about what is happening at an incident, from
 * the moment of the dispatch to the end — «APS 1 esce dalla caserma» → «A 400 m, arrivo tra 12 s» → «Sul posto: la squadra
 * attacca l'incendio» → «Fuoco quasi spento, 70%» → «Intervento concluso» — with an overall progress bar.
 *
 * Pure derivation from the states the client already has (incident status + work model, vehicle status + movement): no new
 * event, no new field. The UI re-evaluates it every second; the line itself only changes every few seconds (distances are
 * rounded, the work in steps of 10%).
 */
export type StoryPhase =
  'PREPARING' | 'LEAVING' | 'EN_ROUTE' | 'ARRIVED' | 'WORKING' | 'ALMOST_DONE' | 'RESOLVING' | 'DONE';

export interface StoryLine {
  phase: StoryPhase;
  /** Message key under `liveStory` and its ICU params. */
  key: string;
  params: Record<string, string | number>;
  /** Overall progress of the intervention, 0..1: travel up to 0.4, the work on scene the rest. */
  progress: number;
  /** The unit the line is about (its call sign is already in `params.callSign`). */
  vehicleId: string | null;
}

/** Seconds after the departure during which the unit is still «leaving the station». */
export const LEAVING_SECONDS = 3;
/** Share of the bar that belongs to the trip; the work on scene fills the rest. */
const TRAVEL_SHARE = 0.4;
const ON_THE_WAY: VehicleDto['status'][] = ['PREPARING', 'TAXIING', 'TAKING_OFF', 'EN_ROUTE'];

/** Fraction of the on-scene work already done at `now` (same anchored model as the inspector's work bar). */
export function workDone(incident: Pick<IncidentDto, 'work'>, now: number): number {
  const { work } = incident;
  if (work.total <= 0) return 0;
  const anchor = Date.parse(work.anchorAt);
  const end = work.estimatedEndAt ? Date.parse(work.estimatedEndAt) : null;
  const remaining =
    end && end > anchor
      ? work.remaining * Math.max(0, 1 - (now - anchor) / (end - anchor))
      : Math.max(0, work.remaining - work.ratePerSecond * Math.max(0, (now - anchor) / 1000));
  return Math.min(1, Math.max(0, 1 - remaining / work.total));
}

/** Distance rounded so the line does not flicker every second: 50 m steps below 1 km, 100 m steps above. */
export function roundedMeters(m: number): number {
  const step = m < 1000 ? 50 : 100;
  return Math.max(step, Math.round(m / step) * step);
}

/** The scene's category, reduced to the words the story has a sentence for (ICU `select` keys). */
export function storyCategory(incident: Pick<IncidentDto, 'category'>): string {
  const c = incident.category.toUpperCase();
  if (c.includes('FIRE') || c === 'WILDFIRE') return 'FIRE';
  if (c.includes('TECH')) return 'TECHNICAL';
  if (c.includes('ROAD')) return 'ROAD';
  if (c.includes('MED') || c === 'EMS') return 'MEDICAL';
  if (c.includes('WATER')) return 'WATER';
  if (c.includes('POLICE') || c.includes('PUBLIC')) return 'POLICE';
  return 'other';
}

const arrivalOf = (v: VehicleDto, now: number): number => {
  if (v.status === 'EN_ROUTE' && v.movement) return Date.parse(v.movement.arriveAt);
  // Still at base: leaves at `busyUntil`; nothing better is known about the trip before the movement exists.
  return Math.max(now, v.busyUntil ? Date.parse(v.busyUntil) : now) + 60_000;
};

/**
 * The line for `incident` at `now`, or null when nothing is moving yet (before the dispatch). `vehicles` may be the whole
 * fleet: only the units of this incident are read.
 */
export function deriveStory(incident: IncidentDto, vehicles: VehicleDto[], now: number): StoryLine | null {
  const units = vehicles.filter(
    (v) =>
      (v.incidentId === incident.id || incident.assignedVehicleIds.includes(v.id)) &&
      v.status !== 'RETURNING',
  );
  const category = storyCategory(incident);

  if (incident.status === 'RESOLVING') {
    const transporting = units.find((v) => v.status === 'TRANSPORTING' || v.status === 'AT_HOSPITAL');
    return {
      phase: 'RESOLVING',
      key: transporting ? 'transporting' : 'resolving',
      params: { callSign: transporting?.callSign ?? '' },
      progress: 0.98,
      vehicleId: transporting?.id ?? null,
    };
  }

  const onScene = units.filter((v) => v.status === 'ON_SCENE');
  const coming = units
    .filter((v) => ON_THE_WAY.includes(v.status))
    .sort((a, b) => arrivalOf(a, now) - arrivalOf(b, now));

  if (onScene.length > 0 || incident.status === 'ON_SCENE') {
    const done = workDone(incident, now);
    const lead = onScene[0] ?? null;
    const pct = Math.min(99, Math.floor((done * 100) / 10) * 10);
    const progress = TRAVEL_SHARE + (1 - TRAVEL_SHARE) * done;
    const next = coming[0];
    // Just arrived (the first 10% of the work): who is there and what they do; a unit still coming is announced too.
    if (done < 0.1) {
      if (next && next.status === 'EN_ROUTE' && next.movement)
        return {
          phase: 'ARRIVED',
          key: 'arrivedOthersComing',
          params: {
            category,
            callSign: lead?.callSign ?? '',
            other: next.callSign,
            seconds: Math.max(1, Math.ceil((Date.parse(next.movement.arriveAt) - now) / 1000)),
          },
          progress,
          vehicleId: lead?.id ?? null,
        };
      return {
        phase: 'ARRIVED',
        key: 'arrived',
        params: { category, callSign: lead?.callSign ?? '' },
        progress,
        vehicleId: lead?.id ?? null,
      };
    }
    return {
      phase: done >= 0.6 ? 'ALMOST_DONE' : 'WORKING',
      key: done >= 0.6 ? 'almostDone' : 'working',
      params: { category, pct },
      progress,
      vehicleId: lead?.id ?? null,
    };
  }

  const lead = coming[0];
  if (!lead) return null;
  if (lead.status === 'EN_ROUTE' && lead.movement) {
    const depart = Date.parse(lead.movement.departAt);
    const arrive = Date.parse(lead.movement.arriveAt);
    const span = Math.max(1, arrive - depart);
    const travel = Math.min(1, Math.max(0, (now - depart) / span));
    const progress = TRAVEL_SHARE * (0.1 + 0.9 * travel);
    if (now - depart < LEAVING_SECONDS * 1000)
      return {
        phase: 'LEAVING',
        key: 'leaving',
        params: { callSign: lead.callSign },
        progress,
        vehicleId: lead.id,
      };
    const meters = lead.movement.distanceMeters * (1 - travel);
    return {
      phase: 'EN_ROUTE',
      key: 'enRoute',
      params: {
        callSign: lead.callSign,
        meters: roundedMeters(meters),
        seconds: Math.max(1, Math.ceil((arrive - now) / 1000)),
      },
      progress,
      vehicleId: lead.id,
    };
  }
  // At base: the crew gets ready (PREPARING, or an aircraft taxiing / taking off).
  const leavesIn = lead.busyUntil ? Math.ceil((Date.parse(lead.busyUntil) - now) / 1000) : 0;
  if (leavesIn >= 2)
    return {
      phase: 'PREPARING',
      key: 'preparing',
      params: { callSign: lead.callSign, seconds: leavesIn },
      progress: TRAVEL_SHARE * 0.05,
      vehicleId: lead.id,
    };
  return {
    phase: 'LEAVING',
    key: 'leaving',
    params: { callSign: lead.callSign },
    progress: TRAVEL_SHARE * 0.08,
    vehicleId: lead.id,
  };
}

/** The line shown for a few seconds once the narrated incident has left the world. */
export const DONE_LINE: StoryLine = { phase: 'DONE', key: 'done', params: {}, progress: 1, vehicleId: null };

/**
 * Which incident the map strip narrates: the one whose units moved most recently (the latest dispatch), among the open
 * incidents that have units on the way or on scene. Null when nothing is happening.
 */
export function storyIncident(incidents: IncidentDto[], vehicles: VehicleDto[]): IncidentDto | null {
  const active = incidents.filter(
    (i) =>
      (i.status === 'RESPONDING' || i.status === 'ON_SCENE' || i.status === 'RESOLVING') &&
      !i.major &&
      vehicles.some((v) => v.incidentId === i.id || i.assignedVehicleIds.includes(v.id)),
  );
  if (active.length === 0) return null;
  // First-shift calls first (one at a time anyway), then the newest call.
  return (
    [...active].sort(
      (a, b) =>
        Number(!!b.firstShift) - Number(!!a.firstShift) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )[0] ?? null
  );
}
