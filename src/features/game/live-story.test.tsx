import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/api/query-keys';
import { renderWithIntl } from '@/test/render';
import { CAREER_ID, incident, snapshot, vehicle } from '@/test/fixtures';
import { CareerProvider } from './hooks';
import {
  DONE_LINE,
  deriveStory,
  roundedMeters,
  storyCategory,
  storyIncident,
  workDone,
} from './live-story-model';
import { LiveStoryCard, LiveStoryStrip } from './live-story';

const T = Date.parse('2026-01-01T10:00:00.000Z');
const at = (s: number) => new Date(T + s * 1000).toISOString();
const fire = (patch: Parameters<typeof incident>[0] = {}) => incident({ category: 'FIRE', ...patch });

describe('deriveStory (racconto in diretta)', () => {
  it('says nothing before the dispatch', () => {
    expect(deriveStory(fire(), [vehicle()], T)).toBeNull();
  });

  it('tells the crew getting ready, leaving, then the distance and the arrival in seconds', () => {
    const inc = fire({ status: 'RESPONDING', assignedVehicleIds: ['veh_01J8Z0000000000000000000AA'] });
    const preparing = vehicle({ status: 'PREPARING', incidentId: inc.id, busyUntil: at(6) });
    expect(deriveStory(inc, [preparing], T)).toMatchObject({
      phase: 'PREPARING',
      key: 'preparing',
      params: { callSign: 'APS 1', seconds: 6 },
    });
    expect(deriveStory(inc, [{ ...preparing, busyUntil: at(1) }], T)?.phase).toBe('LEAVING');
    const moving = vehicle({
      status: 'EN_ROUTE',
      incidentId: inc.id,
      movement: {
        path: [
          [14.2, 42.46],
          [14.21, 42.46],
        ],
        departAt: at(0),
        arriveAt: at(20),
        distanceMeters: 800,
        purpose: 'TO_INCIDENT',
      },
    });
    expect(deriveStory(inc, [moving], T + 1000)?.key).toBe('leaving');
    const half = deriveStory(inc, [moving], T + 10_000)!;
    expect(half).toMatchObject({ phase: 'EN_ROUTE', params: { meters: 400, seconds: 10 } });
    expect(half.progress).toBeGreaterThan(0.2);
    expect(half.progress).toBeLessThan(0.4);
  });

  it('on scene: who is there and what they do, then the work in steps of 10%', () => {
    const working = fire({
      status: 'ON_SCENE',
      work: { total: 100, remaining: 100, ratePerSecond: 1, anchorAt: at(0), estimatedEndAt: at(100) },
    });
    const there = vehicle({ status: 'ON_SCENE', incidentId: working.id });
    expect(deriveStory(working, [there], T + 2000)).toMatchObject({
      phase: 'ARRIVED',
      key: 'arrived',
      params: { category: 'FIRE', callSign: 'APS 1' },
    });
    expect(deriveStory(working, [there], T + 35_000)).toMatchObject({
      phase: 'WORKING',
      params: { pct: 30 },
    });
    const late = deriveStory(working, [there], T + 74_000)!;
    expect(late).toMatchObject({ phase: 'ALMOST_DONE', key: 'almostDone', params: { pct: 70 } });
    expect(late.progress).toBeCloseTo(0.4 + 0.6 * 0.74, 2);
  });

  it('announces a second unit still coming when the first one arrives', () => {
    const inc = fire({
      status: 'ON_SCENE',
      work: { total: 100, remaining: 100, ratePerSecond: 0.6, anchorAt: at(0), estimatedEndAt: at(160) },
    });
    const first = vehicle({ status: 'ON_SCENE', incidentId: inc.id });
    const second = vehicle({
      id: 'veh_01J8Z0000000000000000000BB',
      callSign: 'APS 2',
      status: 'EN_ROUTE',
      incidentId: inc.id,
      movement: {
        path: [
          [14.2, 42.46],
          [14.21, 42.46],
        ],
        departAt: at(-5),
        arriveAt: at(8),
        distanceMeters: 500,
        purpose: 'TO_INCIDENT',
      },
    });
    expect(deriveStory(inc, [first, second], T)).toMatchObject({
      key: 'arrivedOthersComing',
      params: { callSign: 'APS 1', other: 'APS 2', seconds: 8 },
    });
  });

  it('helpers: rounding, categories, the work model and which call the strip tells', () => {
    expect(roundedMeters(412)).toBe(400);
    expect(roundedMeters(12)).toBe(50);
    expect(roundedMeters(1260)).toBe(1300);
    expect(storyCategory({ category: 'fire_vehicle' })).toBe('FIRE');
    expect(storyCategory({ category: 'TECHNICAL' })).toBe('TECHNICAL');
    expect(storyCategory({ category: 'something' })).toBe('other');
    expect(
      workDone(
        { work: { total: 10, remaining: 10, ratePerSecond: 1, anchorAt: at(0), estimatedEndAt: null } },
        T + 5000,
      ),
    ).toBeCloseTo(0.5);
    const a = fire({ id: 'inc_a', status: 'RESPONDING', createdAt: at(0) });
    const b = fire({ id: 'inc_b', status: 'RESPONDING', createdAt: at(10) });
    const units = [
      vehicle({ id: 'veh_a', incidentId: 'inc_a', status: 'EN_ROUTE' }),
      vehicle({ id: 'veh_b', incidentId: 'inc_b', status: 'EN_ROUTE' }),
    ];
    expect(storyIncident([a, b], units)?.id).toBe('inc_b');
    expect(
      storyIncident(
        [a, fire({ ...b, firstShift: { mission: 2, lesson: 'CHOOSE_VEHICLE', arrivalCapSeconds: 25 } })],
        units,
      )?.id,
    ).toBe('inc_b');
    expect(storyIncident([fire({ status: 'PENDING_RESPONSE' })], [])).toBeNull();
    expect(DONE_LINE.progress).toBe(1);
  });
});

function renderWith(snap: ReturnType<typeof snapshot>, ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.sync(CAREER_ID), snap);
  const view = renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>{ui}</CareerProvider>
    </QueryClientProvider>,
  );
  return { qc, view };
}

describe('live story UI', () => {
  it('the card in the incident tells the line in Italian with a progress bar', () => {
    vi.useFakeTimers({ now: T + 10_000 });
    const inc = fire({ status: 'RESPONDING' });
    const moving = vehicle({
      status: 'EN_ROUTE',
      incidentId: inc.id,
      movement: {
        path: [
          [14.2, 42.46],
          [14.21, 42.46],
        ],
        departAt: at(0),
        arriveAt: at(20),
        distanceMeters: 800,
        purpose: 'TO_INCIDENT',
      },
    });
    renderWith(snapshot({ incidents: [inc], vehicles: [moving] }), <LiveStoryCard incident={inc} />);
    expect(screen.getByTestId('live-story-line')).toHaveTextContent('APS 1 a 400 m, arrivo tra 10 s');
    expect(screen.getByTestId('live-story-progress')).toHaveAttribute('aria-valuenow');
    vi.useRealTimers();
  });

  it('the map strip says «Intervento concluso» for a few seconds once the call has closed', () => {
    vi.useFakeTimers({ now: T });
    const inc = fire({
      status: 'ON_SCENE',
      work: { total: 10, remaining: 10, ratePerSecond: 1, anchorAt: at(0), estimatedEndAt: at(10) },
    });
    const there = vehicle({ status: 'ON_SCENE', incidentId: inc.id });
    const { qc } = renderWith(snapshot({ incidents: [inc], vehicles: [there] }), <LiveStoryStrip />);
    expect(screen.getByTestId('live-strip')).toHaveAttribute('data-phase', 'ARRIVED');
    act(() => {
      qc.setQueryData(
        qk.sync(CAREER_ID),
        snapshot({ incidents: [], vehicles: [vehicle({ status: 'RETURNING' })] }),
      );
      vi.advanceTimersByTime(1); // react-query notifies observers on a timer
    });
    expect(screen.getByTestId('live-strip-line')).toHaveTextContent('Intervento concluso');
    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    expect(screen.queryByTestId('live-strip')).toBeNull();
    vi.useRealTimers();
  });
});
