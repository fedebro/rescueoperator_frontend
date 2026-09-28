import { describe, expect, it, vi } from 'vitest';
import { pushFocusUrl, PUSH_HOME_URL } from '@/contracts';
import { FACILITY_ID, INCIDENT_ID, VEHICLE_ID, incident, snapshot, vehicle } from '@/test/fixtures';
import { MAJOR_ID, CENTER, linkedIncident } from '@/test/major-fixtures';
import { parseFocusParam, sameOriginPath } from './deep-link';
import { openFocusTarget } from './deep-link-focus';

describe('parseFocusParam', () => {
  it('reads every kind the server links to', () => {
    const param = (url: string) => new URL(url, 'https://game.test').searchParams.get('focus');
    expect(parseFocusParam(param(pushFocusUrl('incident', INCIDENT_ID)))).toEqual({
      kind: 'incident',
      id: INCIDENT_ID,
    });
    expect(parseFocusParam(param(pushFocusUrl('major', MAJOR_ID)))).toEqual({ kind: 'major', id: MAJOR_ID });
    expect(parseFocusParam(param(pushFocusUrl('vehicle', VEHICLE_ID)))).toEqual({
      kind: 'vehicle',
      id: VEHICLE_ID,
    });
    expect(parseFocusParam(param(pushFocusUrl('facility', FACILITY_ID)))).toEqual({
      kind: 'facility',
      id: FACILITY_ID,
    });
    expect(parseFocusParam(param(PUSH_HOME_URL))).toBeNull();
  });

  it('rejects anything malformed: unknown kind, an id of another kind, garbage', () => {
    expect(parseFocusParam(null)).toBeNull();
    expect(parseFocusParam('')).toBeNull();
    expect(parseFocusParam('incident')).toBeNull();
    expect(parseFocusParam(':inc_01J8Z0000000000000000000AA')).toBeNull();
    expect(parseFocusParam(`patient:${INCIDENT_ID}`)).toBeNull();
    expect(parseFocusParam(`vehicle:${INCIDENT_ID}`)).toBeNull();
    expect(parseFocusParam('incident:inc_<script>')).toBeNull();
    expect(parseFocusParam(`incident:${INCIDENT_ID}:extra`)).toBeNull();
  });
});

describe('sameOriginPath', () => {
  const origin = 'https://game.rescue-control.com';
  it('keeps in-app paths, refuses other origins and non-http schemes', () => {
    expect(sameOriginPath(`/game?focus=incident:${INCIDENT_ID}`, origin)).toBe(
      `/game?focus=incident:${INCIDENT_ID}`,
    );
    expect(sameOriginPath(`${origin}/game/fleet#x`, origin)).toBe('/game/fleet#x');
    expect(sameOriginPath('https://evil.example/game', origin)).toBeNull();
    expect(sameOriginPath('//evil.example/game', origin)).toBeNull();
    expect(sameOriginPath('javascript:alert(1)', origin)).toBeNull();
    expect(sameOriginPath(42, origin)).toBeNull();
    expect(sameOriginPath('', origin)).toBeNull();
  });
});

describe('openFocusTarget', () => {
  it('selects an open incident with the camera on its scene', () => {
    const select = vi.fn();
    const s = snapshot({ incidents: [incident()] });
    expect(openFocusTarget({ kind: 'incident', id: INCIDENT_ID }, s, select)).toBe('opened');
    expect(select).toHaveBeenCalledWith({ kind: 'incident', id: INCIDENT_ID }, { focus: [14.22, 42.465] });
  });

  it('a closed incident: its pending outcome dialog is the report, otherwise a short notice', () => {
    const select = vi.fn();
    const withOutcome = snapshot({
      pendingOutcomes: [{ incidentId: INCIDENT_ID } as never],
    });
    expect(openFocusTarget({ kind: 'incident', id: INCIDENT_ID }, withOutcome, select)).toBe('opened');
    expect(openFocusTarget({ kind: 'incident', id: INCIDENT_ID }, snapshot(), select)).toBe('incidentClosed');
    expect(select).not.toHaveBeenCalled();
  });

  it('opens the coordination view of a major, on its area when a member is known', () => {
    const select = vi.fn();
    expect(
      openFocusTarget({ kind: 'major', id: MAJOR_ID }, snapshot({ incidents: [linkedIncident()] }), select),
    ).toBe('opened');
    expect(select).toHaveBeenLastCalledWith({ kind: 'major', id: MAJOR_ID }, { focus: CENTER });
    openFocusTarget({ kind: 'major', id: MAJOR_ID }, snapshot(), select);
    expect(select).toHaveBeenLastCalledWith({ kind: 'major', id: MAJOR_ID }, undefined);
  });

  it('selects a vehicle or a facility on the map; gone ones say so', () => {
    const select = vi.fn();
    const facility = { id: FACILITY_ID, position: [14.2, 42.45] } as never;
    const s = snapshot({ vehicles: [vehicle()], facilities: [facility] });
    expect(openFocusTarget({ kind: 'vehicle', id: VEHICLE_ID }, s, select)).toBe('opened');
    expect(select).toHaveBeenLastCalledWith({ kind: 'vehicle', id: VEHICLE_ID }, { focus: [14.21, 42.46] });
    expect(openFocusTarget({ kind: 'facility', id: FACILITY_ID }, s, select)).toBe('opened');
    expect(select).toHaveBeenLastCalledWith({ kind: 'facility', id: FACILITY_ID }, { focus: [14.2, 42.45] });
    expect(openFocusTarget({ kind: 'vehicle', id: VEHICLE_ID }, snapshot({ vehicles: [] }), select)).toBe(
      'vehicleGone',
    );
    expect(openFocusTarget({ kind: 'facility', id: FACILITY_ID }, snapshot(), select)).toBe('facilityGone');
  });
});
