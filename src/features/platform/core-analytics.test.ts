import { describe, expect, it, vi } from 'vitest';
import { INCIDENT_ID, incident, snapshot, vehicle } from '@/test/fixtures';
import { sanitizeProps } from '@/lib/analytics';
import { CoreAnalyticsTracker } from './core-analytics';

function setup() {
  const track = vi.fn();
  return { track, tracker: new CoreAnalyticsTracker(track), names: () => track.mock.calls.map((c) => c[0]) };
}

describe('CoreAnalyticsTracker', () => {
  it('fires session_start once per page load', () => {
    const t = setup();
    const s = snapshot();
    t.tracker.sessionStart(s, { layout: 'mobile', standalone: false });
    t.tracker.sessionStart(s, { layout: 'mobile', standalone: false });
    expect(t.track).toHaveBeenCalledTimes(1);
    expect(t.track.mock.calls[0]![1]).toMatchObject({
      layout: 'mobile',
      standalone: false,
      level: s.career.level,
    });
  });

  it('derives dispatch_sent and vehicle_bought from snapshot transitions', () => {
    const t = setup();
    const before = snapshot({ incidents: [incident({ assignedVehicleIds: [] })], vehicles: [vehicle()] });
    t.tracker.onSnapshot(before);
    expect(t.track).not.toHaveBeenCalled(); // the first snapshot is only a baseline
    const bought = vehicle({ id: 'veh_01J8Z0000000000000000000BB', status: 'IN_DELIVERY' });
    t.tracker.onSnapshot({
      ...before,
      incidents: [incident({ assignedVehicleIds: [before.vehicles[0]!.id], status: 'RESPONDING' })],
      vehicles: [...before.vehicles, bought],
    });
    expect(t.names()).toEqual(['dispatch_sent', 'vehicle_bought']);
    expect(t.track.mock.calls[0]![1]).toMatchObject({ incidentId: INCIDENT_ID, vehicleCount: 1 });
    expect(t.track.mock.calls[1]![1]).toMatchObject({ typeCode: bought.typeCode, family: bought.family });
  });

  it('reports the first_* funnel events on the tutorial incident only', () => {
    const t = setup();
    const tutorial = incident({ isTutorial: true, assignedVehicleIds: [] });
    t.tracker.onEffect({ type: 'incident.new', incident: tutorial });
    const before = snapshot({ incidents: [tutorial], vehicles: [vehicle()] });
    t.tracker.onSnapshot(before);
    t.tracker.onSnapshot({
      ...before,
      incidents: [{ ...tutorial, assignedVehicleIds: [before.vehicles[0]!.id] }],
    });
    expect(t.names()).toEqual(['first_incident', 'dispatch_sent', 'first_dispatch', 'first_mission_started']);
  });

  it('dedupes closed incidents, levels and viewed incidents across realtime replays', () => {
    const t = setup();
    const closed = incident({ status: 'RESOLVED' });
    t.tracker.onEffect({ type: 'incident.closed', incident: closed, result: 'resolved' });
    t.tracker.onEffect({ type: 'incident.closed', incident: closed, result: 'resolved' });
    t.tracker.onEffect({
      type: 'incident.closed',
      incident: incident({ id: 'inc_2' as never }),
      result: 'expired',
    });
    t.tracker.onEffect({
      type: 'incident.closed',
      incident: incident({ id: 'inc_3' as never }),
      result: 'cancelled',
    });
    t.tracker.onEffect({ type: 'level.reached', level: 3 });
    t.tracker.onEffect({ type: 'level.reached', level: 3 });
    t.tracker.onEffect({ type: 'unlock.granted', codes: ['FIRE_APS', 'EMS_MSB'] });
    const s = snapshot({ incidents: [incident()] });
    t.tracker.onSelection({ kind: 'incident', id: INCIDENT_ID }, s);
    t.tracker.onSelection({ kind: 'incident', id: INCIDENT_ID }, s);
    t.tracker.onSelection({ kind: 'vehicle', id: 'veh_x' }, s);
    expect(t.names()).toEqual([
      'incident_resolved',
      'incident_expired',
      'level_up',
      'unlock_granted',
      'incident_viewed',
    ]);
  });

  it('only ever emits props that survive the PII guard unchanged', () => {
    const t = setup();
    const before = snapshot({ incidents: [incident({ assignedVehicleIds: [] })], vehicles: [vehicle()] });
    t.tracker.sessionStart(before, { layout: 'desktop', standalone: true });
    t.tracker.onSnapshot(before);
    t.tracker.onSnapshot({
      ...before,
      incidents: [incident({ assignedVehicleIds: [before.vehicles[0]!.id] })],
    });
    t.tracker.onEffect({ type: 'stipend.paid', amount: '1500' });
    t.tracker.onSelection({ kind: 'incident', id: INCIDENT_ID }, before);
    for (const [, props] of t.track.mock.calls) expect(sanitizeProps(props)).toEqual(props);
  });
});
