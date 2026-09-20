import type { IncidentDto, SyncSnapshot } from '@/contracts';
import { track as defaultTrack } from '@/lib/analytics';
import type { Effect } from '@/lib/realtime/reconcile';
import type { Selection } from '@/stores/ui';

type TrackFn = (name: string, props?: Record<string, string | number | boolean | null>) => void;

const incidentProps = (i: IncidentDto) => ({
  incidentId: i.id,
  templateCode: i.templateCode,
  severity: i.severity,
});

/**
 * Product events of the core loop, derived from what the client already observes (realtime effects, snapshot
 * transitions, the selection) so that no core screen needs analytics code. Every event fires at most once per
 * entity per page load: realtime replays after a resync must not inflate the numbers.
 */
export class CoreAnalyticsTracker {
  private readonly seen = new Set<string>();
  private previous: SyncSnapshot | null = null;

  constructor(private readonly track: TrackFn = defaultTrack as TrackFn) {}

  private once(key: string, fire: () => void): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    fire();
  }

  sessionStart(snapshot: SyncSnapshot, env: { layout: 'desktop' | 'mobile'; standalone: boolean }): void {
    this.once('session', () =>
      this.track('session_start', {
        level: snapshot.career.level,
        layout: env.layout,
        standalone: env.standalone,
        returning: snapshot.career.tutorial.completed,
      }),
    );
  }

  onEffect(effect: Effect): void {
    switch (effect.type) {
      case 'incident.new':
        if (effect.incident.isTutorial)
          this.once('first_incident', () =>
            this.track('first_incident', {
              templateCode: effect.incident.templateCode,
              severity: effect.incident.severity,
            }),
          );
        break;
      case 'incident.closed': {
        const name =
          effect.result === 'resolved'
            ? 'incident_resolved'
            : effect.result === 'failed'
              ? 'incident_failed'
              : effect.result === 'expired'
                ? 'incident_expired'
                : null;
        if (name)
          this.once(`closed:${effect.incident.id}`, () => this.track(name, incidentProps(effect.incident)));
        break;
      }
      case 'outcome': {
        const o = effect.outcome;
        this.once(`outcome:${o.incidentId}`, () => {
          const incident = this.previous?.incidents.find((i) => i.id === o.incidentId);
          this.track('credits_earned', { amount: o.netCredits, source: 'INCIDENT_REWARD' });
          if (incident?.isTutorial)
            this.track('first_mission_completed', {
              incidentId: o.incidentId,
              result: o.result,
              stars: o.stars,
            });
        });
        break;
      }
      case 'level.reached':
        this.once(`level:${effect.level}`, () => this.track('level_up', { level: effect.level }));
        break;
      case 'unlock.granted':
        if (effect.codes.length > 0)
          this.once(`unlock:${effect.codes.join(',')}`, () =>
            this.track('unlock_granted', { count: effect.codes.length, code: effect.codes[0]! }),
          );
        break;
      case 'stipend.paid':
        this.track('stipend_paid', { amount: effect.amount });
        break;
      case 'notification': {
        const n = effect.payload.notification as
          { id?: unknown; category?: unknown; priority?: unknown } | undefined;
        if (n && typeof n.id === 'string' && typeof n.category === 'string' && typeof n.priority === 'string')
          this.once(`ntf:${n.id}`, () =>
            this.track('notification_received', {
              category: String(n.category),
              priority: String(n.priority),
            }),
          );
        break;
      }
      default:
        break;
    }
  }

  /** Snapshot transitions: dispatches (PENDING_RESPONSE → responding), purchases (a vehicle appears IN_DELIVERY), tutorial steps. */
  onSnapshot(next: SyncSnapshot): void {
    const prev = this.previous;
    this.previous = next;
    if (!prev || prev.career.id !== next.career.id) return;

    for (const incident of next.incidents) {
      const before = prev.incidents.find((i) => i.id === incident.id);
      const added = incident.assignedVehicleIds.filter(
        (id) => !before?.assignedVehicleIds.includes(id),
      ).length;
      if (!before || added === 0) continue;
      this.track('dispatch_sent', { ...incidentProps(incident), vehicleCount: added });
      if (incident.isTutorial)
        this.once('first_dispatch', () => {
          this.track('first_dispatch', { incidentId: incident.id, vehicleCount: added });
          this.track('first_mission_started', {
            incidentId: incident.id,
            templateCode: incident.templateCode,
          });
        });
    }

    const knownVehicles = new Set(prev.vehicles.map((v) => v.id));
    for (const v of next.vehicles)
      if (!knownVehicles.has(v.id) && v.status === 'IN_DELIVERY')
        this.once(`bought:${v.id}`, () =>
          this.track('vehicle_bought', { typeCode: v.typeCode, family: v.family, facilityId: v.facilityId }),
        );

    const a = prev.career.tutorial;
    const b = next.career.tutorial;
    if (b.step && b.step !== a.step)
      this.once(`tutorial:${b.step}`, () => this.track('tutorial_step', { step: b.step! }));
    if (b.completed && !a.completed) this.once('tutorial:done', () => this.track('tutorial_completed'));
    if (prev.career.onDuty !== next.career.onDuty) this.track('duty_changed', { onDuty: next.career.onDuty });
  }

  onSelection(selection: Selection, snapshot: SyncSnapshot | undefined): void {
    if (selection?.kind !== 'incident') return;
    const incident = snapshot?.incidents.find((i) => i.id === selection.id);
    if (!incident) return;
    this.once(`viewed:${incident.id}`, () =>
      this.track('incident_viewed', { ...incidentProps(incident), status: incident.status }),
    );
  }
}
