import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import type {
  I18nText,
  IncidentDto,
  MajorGroupDto,
  MajorIncidentDto,
  MajorIncidentRefDto,
  MajorPhase,
  ServiceFamily,
  VehicleDto,
} from '@/contracts';
import type { LngLat } from '@/lib/geo';

/**
 * Major incidents on the client ("maxi-emergenze", D-24 [U] / D-69 [C], analisi/studio-2026-09-27/06 §2.6). The server runs
 * the event (phases, linked incidents, growth, reinforcements, reward) and sends it as `MajorIncidentDto`; every member is a
 * normal incident carrying `IncidentDto.major`. These helpers only decide WHAT TO SHOW. Pure, tested.
 */

export const OPERATIONAL_PHASES = ['ALARM', 'CONTAINMENT', 'RESCUE', 'SECURING'] as const;
export type OperationalPhase = (typeof OPERATIONAL_PHASES)[number];
export const phaseIndex = (phase: MajorPhase): number =>
  phase === 'ENDED' ? OPERATIONAL_PHASES.length : OPERATIONAL_PHASES.indexOf(phase);

/** The magenta-red of the majors (map area, pins, pinned queue block) — `--rc-major` of globals.css. */
export const MAJOR_COLOR = '#FF4F86';

export const isMajorMember = (incident: Pick<IncidentDto, 'major'>): boolean => !!incident.major;
export const isMajorMain = (incident: Pick<IncidentDto, 'major'>): boolean => incident.major?.role === 'MAIN';

/* ───────────── queue: majors pinned on top ───────────── */

export interface MajorBlock {
  majorId: string;
  /** The reference of the main scene when it is still open, else of the first member. */
  ref: MajorIncidentRefDto;
  /** Main scene first, then the linked incidents in sector order. */
  members: IncidentDto[];
}

/**
 * The queue with the majors pinned on top (06 §2.6): one block per running major — its members in sector order —, then
 * every other incident in the usual order.
 */
export function splitQueue(
  incidents: readonly IncidentDto[],
  order: (a: IncidentDto, b: IncidentDto) => number,
): { majors: MajorBlock[]; others: IncidentDto[] } {
  const byMajor = new Map<string, IncidentDto[]>();
  const others: IncidentDto[] = [];
  for (const incident of incidents) {
    if (!incident.major) {
      others.push(incident);
      continue;
    }
    const list = byMajor.get(incident.major.id) ?? [];
    list.push(incident);
    byMajor.set(incident.major.id, list);
  }
  const majors = [...byMajor].map(([majorId, members]) => {
    const sorted = [...members].sort((a, b) => a.major!.sector - b.major!.sector);
    return { majorId, ref: sorted[0]!.major!, members: sorted };
  });
  return { majors, others: [...others].sort(order) };
}

/**
 * Signature of what the player changes on a major's members (their status, the vehicles committed to them): the server
 * sends no major event for a dispatch, yet the reinforcement quote depends on it ("send at least one of your vehicles").
 */
export const memberSignature = (
  members: readonly Pick<IncidentDto, 'id' | 'status' | 'assignedVehicleIds'>[],
): string => members.map((m) => `${m.id}:${m.status}:${m.assignedVehicleIds.length}`).join('|');

/** The id of the running major: the snapshot's own field, else the first member's reference. */
export function activeMajorIdOf(snapshot: {
  activeMajorIncidentId?: string | null;
  incidents: readonly Pick<IncidentDto, 'major'>[];
}): string | null {
  return snapshot.activeMajorIncidentId ?? snapshot.incidents.find((i) => i.major)?.major?.id ?? null;
}

/* ───────────── progress & live requirement bars ───────────── */

/**
 * Progress of the main scene now, from its anchored work model (the same maths as the incident inspector): the server's
 * `progress` is a snapshot, the member incident in the realtime snapshot is live.
 */
export function liveProgress(main: IncidentDto | undefined, fallback: number, nowMs: number): number {
  if (!main) return fallback;
  if (main.status === 'RESOLVING' || main.status === 'RESOLVED') return 1;
  const w = main.work;
  if (w.total <= 0) return fallback;
  const anchor = Date.parse(w.anchorAt);
  const end = w.estimatedEndAt ? Date.parse(w.estimatedEndAt) : null;
  const remaining =
    end && end > anchor
      ? w.remaining * Math.max(0, 1 - (nowMs - anchor) / (end - anchor))
      : Math.max(0, w.remaining - w.ratePerSecond * Math.max(0, (nowMs - anchor) / 1000));
  return Math.min(1, Math.max(0, 1 - remaining / w.total));
}

const FAMILY_ORDER = ['FIRE', 'EMS', 'POLICE', 'WILDFIRE', 'ALPINE', 'UNG', ''];
const levelRank = (level: string): number => (level === 'REQUIRED' ? 0 : level === 'RECOMMENDED' ? 1 : 2);

/**
 * Requirement bars grouped by service (study §2.6: "raggruppate per servizio, non 15 righe piatte") computed from the LIVE
 * member incidents of the snapshot — every dispatch and arrival moves them at once — with what reinforcement columns bring
 * taken from the server's view (`fromServer`, per family and capability). A need fully covered by a column is `external`
 * (`externalSource: REINFORCEMENTS`) and counts as covered.
 */
export function liveGroups(
  members: readonly IncidentDto[],
  fromServer: readonly MajorGroupDto[] = [],
): MajorGroupDto[] {
  const reinforcedOf = (family: string, capability: string) =>
    fromServer.find((g) => (g.family ?? '') === family)?.capabilities.find((c) => c.capability === capability)
      ?.reinforced ?? 0;
  type Acc = MajorGroupDto['capabilities'][number] & { measured: boolean; covered: boolean };
  const byFamily = new Map<string, Map<string, Acc>>();
  for (const incident of members) {
    if (['RESOLVED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(incident.status)) continue;
    for (const r of incident.requirements) {
      const family = r.family ?? '';
      const capabilities = byFamily.get(family) ?? new Map<string, Acc>();
      const byColumn = r.external === true && r.externalSource === 'REINFORCEMENTS';
      const current: Acc = capabilities.get(r.capability) ?? {
        capability: r.capability,
        level: r.level,
        required: 0,
        onScene: 0,
        enRoute: 0,
        reinforced: reinforcedOf(family, r.capability),
        external: true,
        measured: false,
        covered: true,
      };
      current.required += r.external ? 0 : r.required;
      current.onScene += r.onScene;
      current.enRoute += r.enRoute;
      current.external = current.external && r.external === true;
      current.measured = current.measured || !r.external || byColumn;
      if (levelRank(r.level) < levelRank(current.level)) current.level = r.level;
      capabilities.set(r.capability, current);
      byFamily.set(family, capabilities);
    }
  }
  const groups: MajorGroupDto[] = [];
  for (const [family, capabilities] of byFamily) {
    const list = [...capabilities.values()].sort(
      (a, b) => levelRank(a.level) - levelRank(b.level) || a.capability.localeCompare(b.capability),
    );
    const measured = list.filter((c) => c.level === 'REQUIRED' && c.measured);
    const coverage =
      measured.length === 0
        ? 1
        : measured.reduce(
            (sum, c) => sum + (c.external ? 1 : Math.min(1, c.onScene / Math.max(1, c.required))),
            0,
          ) / measured.length;
    groups.push({
      family: (family || null) as MajorGroupDto['family'],
      required: list.reduce((sum, c) => sum + c.required, 0),
      onScene: list.reduce((sum, c) => sum + c.onScene, 0),
      enRoute: list.reduce((sum, c) => sum + c.enRoute, 0),
      reinforced: list.reduce((sum, c) => sum + c.reinforced, 0),
      coverage: Math.round(coverage * 10_000) / 10_000,
      capabilities: list.map(({ measured: _m, covered: _c, ...c }) => c),
    });
  }
  return groups.sort((a, b) => FAMILY_ORDER.indexOf(a.family ?? '') - FAMILY_ORDER.indexOf(b.family ?? ''));
}

/**
 * A group's bar: the share of what the fleet has to bring (its own needs: external / fully reinforced ones excluded) that is
 * on scene, and the share on the way. Surplus on one capability never hides a shortage on another.
 */
export function groupShares(group: Pick<MajorGroupDto, 'capabilities'>): {
  onScene: number;
  enRoute: number;
} {
  const own = group.capabilities.filter((c) => !c.external && c.required > 0);
  const required = own.reduce((sum, c) => sum + c.required, 0);
  if (required <= 0) return { onScene: 1, enRoute: 0 };
  const onScene = own.reduce((sum, c) => sum + Math.min(c.onScene, c.required), 0);
  const enRoute = own.reduce((sum, c) => sum + Math.min(c.enRoute, Math.max(0, c.required - c.onScene)), 0);
  return { onScene: onScene / required, enRoute: enRoute / required };
}

type RequirementLevel = MajorGroupDto['capabilities'][number]['level'];

/**
 * A group's own needs in words: how many the fleet has to bring and how many are covered on scene, whether its coverage
 * means anything (`measured`: at least one indispensable need, own or brought by a column — else the server's coverage is
 * 1 by definition) and the most binding level of what is left.
 */
export function groupNeeds(group: Pick<MajorGroupDto, 'capabilities'>): {
  total: number;
  covered: number;
  measured: boolean;
  topLevel: RequirementLevel;
} {
  const own = group.capabilities.filter((c) => !c.external && c.required > 0);
  return {
    total: own.length,
    covered: own.filter((c) => c.onScene >= c.required).length,
    measured: group.capabilities.some((c) => c.level === 'REQUIRED' && (!c.external || c.reinforced > 0)),
    topLevel: own.reduce<RequirementLevel>(
      (best, c) => (levelRank(c.level) < levelRank(best) ? c.level : best),
      'OPTIONAL',
    ),
  };
}

/** Vehicles working on a sector, by service ("mezzi assegnati per settore"). */
export function vehiclesByFamily(
  vehicles: readonly VehicleDto[],
): { family: ServiceFamily; vehicles: VehicleDto[] }[] {
  const byFamily = new Map<ServiceFamily, VehicleDto[]>();
  for (const v of vehicles) byFamily.set(v.family, [...(byFamily.get(v.family) ?? []), v]);
  return [...byFamily]
    .map(([family, list]) => ({ family, vehicles: list }))
    .sort((a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family));
}

/** Vehicles committed to an incident: listed by the incident, or pointing at it. */
export const assignedVehicles = (
  incident: Pick<IncidentDto, 'id' | 'assignedVehicleIds'>,
  vehicles: readonly VehicleDto[],
): VehicleDto[] =>
  vehicles.filter((v) => incident.assignedVehicleIds.includes(v.id) || v.incidentId === incident.id);

export const percent = (share: number): number => Math.round(Math.max(0, share) * 100);

/* ───────────── the map: event area, links to the linked incidents ───────────── */

/** A circle as a closed polygon ring (the map draws metres, not pixels). */
export function circleRing(center: LngLat, radiusMeters: number, steps = 64): LngLat[] {
  const [lng, lat] = center;
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dLat = (radiusMeters * Math.cos(a)) / 111_320;
    const dLng = (radiusMeters * Math.sin(a)) / (111_320 * Math.cos((lat * Math.PI) / 180));
    ring.push([lng + dLng, lat + dLat]);
  }
  return ring;
}

/**
 * The event area of every running major (a translucent disc with a dashed rim) and a line from its centre to each linked
 * incident (`areas`), and a label point at each centre (`centres`, its own map source). Built from the members'
 * `IncidentDto.major` references alone.
 */
export function majorMapFeatures(
  incidents: readonly IncidentDto[],
  label: (ref: MajorIncidentRefDto) => string,
): { areas: FeatureCollection<Polygon | LineString>; centres: FeatureCollection<Point> } {
  const areas: Feature<Polygon | LineString>[] = [];
  const centres: Feature<Point>[] = [];
  const seen = new Set<string>();
  for (const incident of incidents) {
    const ref = incident.major;
    if (!ref) continue;
    if (!seen.has(ref.id)) {
      seen.add(ref.id);
      areas.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [circleRing(ref.center, ref.areaRadiusMeters)] },
        properties: { majorId: ref.id, area: 1 },
      });
      // `kind` / `id`: a tap on the label selects the major (its coordination view), like a marker.
      centres.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: ref.center },
        properties: { majorId: ref.id, label: label(ref), center: 1, kind: 'major', id: ref.id },
      });
    }
    if (ref.role === 'SUB') {
      const scene = incident.scenePosition ?? incident.position;
      areas.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [ref.center, scene] },
        properties: { majorId: ref.id, incidentId: incident.id, link: 1 },
      });
    }
  }
  return {
    areas: { type: 'FeatureCollection', features: areas },
    centres: { type: 'FeatureCollection', features: centres },
  };
}

/* ───────────── the full-screen alert: acknowledged majors (per career, per device) ───────────── */

const ACK_KEY = (careerId: string) => `rc-major-ack:${careerId}`;
export function acknowledgedMajors(careerId: string): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(ACK_KEY(careerId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
export function acknowledgeMajor(careerId: string, majorId: string): void {
  try {
    const list = [...acknowledgedMajors(careerId), majorId].slice(-20);
    globalThis.localStorage?.setItem(ACK_KEY(careerId), JSON.stringify(list));
  } catch {
    /* storage blocked: the alert may show once more after a reload, nothing else */
  }
}

/* ───────────── notifications, ledger, reinforcements ───────────── */

export const MAJOR_STARTED_TITLE = 'major.notification.STARTED.title';
export const isMajorNotification = (n: { title: I18nText }): boolean => n.title.key.startsWith('major.');
export const isMajorStartNotification = (n: { title: I18nText }): boolean =>
  n.title.key === MAJOR_STARTED_TITLE;

/** The bonus of a major in the ledger (`MAJOR_INCIDENT`): which scenario and how it ended, from the entry's params. */
export function majorLedgerDetail(entry: {
  entryType: string;
  description: I18nText;
}): { scenarioCode: string | null; outcome: string | null } | null {
  if (entry.entryType !== 'MAJOR_INCIDENT') return null;
  const params = entry.description.params ?? {};
  return {
    scenarioCode: typeof params.scenario === 'string' ? params.scenario : null,
    outcome: typeof params.outcome === 'string' ? params.outcome : null,
  };
}

/** Seconds until a reinforcement column is on scene (0 once there). */
export const columnEtaSeconds = (arriveAt: string, nowMs: number): number =>
  Math.max(0, Math.round((Date.parse(arriveAt) - nowMs) / 1000));

/** The reward shown while the major runs: the estimate; once ended: the real bonus. */
export function rewardLine(major: Pick<MajorIncidentDto, 'status' | 'reward'>): {
  kind: 'estimate' | 'final';
  min: string;
  max: string;
} {
  if (major.status === 'ENDED' && major.reward.credits !== null)
    return { kind: 'final', min: major.reward.credits, max: major.reward.credits };
  return { kind: 'estimate', min: major.reward.estimated.min, max: major.reward.estimated.max };
}
