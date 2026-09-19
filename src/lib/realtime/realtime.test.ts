import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { SyncSnapshot } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { CAREER_ID, INCIDENT_ID, envelope, incident, snapshot, vehicle } from '@/test/fixtures';
import { applyEvent, parseEnvelope } from './reconcile';
import { RealtimeController } from './controller';
import type { TransportHandlers } from './transport';

describe('applyEvent', () => {
  it('upserts a new incident and reports it as an effect', () => {
    const r = applyEvent(snapshot(), envelope('incident.created', 11, { incident: incident() }));
    expect(r.kind).toBe('applied');
    if (r.kind !== 'applied') return;
    expect(r.snapshot.seq).toBe(11);
    expect(r.snapshot.incidents).toHaveLength(1);
    expect(r.effects).toContainEqual(expect.objectContaining({ type: 'incident.new' }));
  });
  it('is idempotent: an already applied seq is a duplicate', () => {
    expect(
      applyEvent(snapshot({ seq: 11 }), envelope('incident.created', 11, { incident: incident() })).kind,
    ).toBe('duplicate');
  });
  it('detects a sequence gap', () => {
    expect(applyEvent(snapshot(), envelope('incident.updated', 13, { incident: incident() }))).toEqual({
      kind: 'gap',
      expected: 11,
      received: 13,
    });
  });
  it('rejects events of another career and malformed payloads', () => {
    expect(
      applyEvent(snapshot(), {
        ...envelope('incident.updated', 11, {}),
        careerId: 'car_01J8Z0000000000000000000ZZ',
      }).kind,
    ).toBe('invalid');
    expect(applyEvent(snapshot(), envelope('incident.updated', 11, { incident: { id: 'nope' } })).kind).toBe(
      'invalid',
    );
  });
  it('updates an existing incident without announcing it again', () => {
    const s = snapshot({ incidents: [incident()] });
    const r = applyEvent(
      s,
      envelope('incident.updated', 11, {
        incident: incident({ status: 'RESPONDING' }),
        vehicles: [vehicle({ status: 'PREPARING', incidentId: INCIDENT_ID })],
      }),
    );
    if (r.kind !== 'applied') throw new Error('not applied');
    expect(r.snapshot.incidents[0]!.status).toBe('RESPONDING');
    expect(r.snapshot.vehicles[0]!.status).toBe('PREPARING');
    expect(r.effects.some((e) => e.type === 'incident.new')).toBe(false);
  });
  it('removes a resolved incident, queues its outcome once and refreshes economy/progression', () => {
    const outcome = {
      incidentId: INCIDENT_ID,
      result: 'SUCCESS',
      stars: 3,
      responseSeconds: 60,
      durationSeconds: 120,
      grossCredits: '80',
      costs: [],
      netCredits: '75',
      xp: '40',
      reputationDelta: 1,
      notes: [],
    };
    const s = snapshot({ incidents: [incident({ status: 'ON_SCENE' })] });
    const r = applyEvent(
      s,
      envelope('incident.resolved', 11, {
        incident: incident({ status: 'RESOLVED' }),
        outcome,
        career: { ...s.career, credits: '475' },
      }),
    );
    if (r.kind !== 'applied') throw new Error('not applied');
    expect(r.snapshot.incidents).toHaveLength(0);
    expect(r.snapshot.pendingOutcomes).toHaveLength(1);
    expect(r.snapshot.career.credits).toBe('475');
    expect(r.effects.map((e) => e.type)).toEqual(
      expect.arrayContaining(['outcome', 'incident.closed', 'invalidate']),
    );
    const again = applyEvent(
      r.snapshot,
      envelope('incident.resolved', 12, { incident: incident({ status: 'RESOLVED' }), outcome }),
    );
    if (again.kind !== 'applied') throw new Error('not applied');
    expect(again.snapshot.pendingOutcomes).toHaveLength(1);
  });
  it('applies a bare credits change and level effects', () => {
    const r = applyEvent(snapshot(), envelope('credits.changed', 11, { credits: '1234' }));
    if (r.kind !== 'applied') throw new Error('not applied');
    expect(r.snapshot.career.credits).toBe('1234');
    const lvl = applyEvent(snapshot(), envelope('level.reached', 11, { level: 2 }));
    if (lvl.kind !== 'applied') throw new Error('not applied');
    expect(lvl.effects).toContainEqual({ type: 'level.reached', level: 2 });
  });
});

describe('parseEnvelope', () => {
  it('validates the envelope with Zod', () => {
    expect(parseEnvelope(envelope('vehicle.updated', 1, {}))).not.toBeNull();
    expect(parseEnvelope({ type: 'made.up', v: 1 })).toBeNull();
    expect(parseEnvelope({ ...envelope('vehicle.updated', 1, {}), v: 2 })).toBeNull();
    expect(parseEnvelope('nope')).toBeNull();
  });
});

function setup(fetchSnapshot: () => Promise<SyncSnapshot>, initial: SyncSnapshot | null = snapshot()) {
  const queryClient = new QueryClient();
  if (initial) queryClient.setQueryData(qk.sync(CAREER_ID), initial);
  let handlers!: TransportHandlers;
  const onEffect = vi.fn();
  const onConnection = vi.fn();
  const close = vi.fn();
  const controller = new RealtimeController({
    careerId: CAREER_ID,
    queryClient,
    fetchSnapshot,
    onEffect,
    onConnection,
    pollIntervalMs: 50,
    retryDelayMs: 20,
    connect: (h) => {
      handlers = h;
      return { close };
    },
  });
  controller.start();
  const current = () => queryClient.getQueryData<SyncSnapshot>(qk.sync(CAREER_ID))!;
  return { controller, handlers: () => handlers, onEffect, onConnection, current, close };
}

describe('RealtimeController', () => {
  it('applies in-order events to the query cache', () => {
    const t = setup(() => Promise.reject(new Error('unused')));
    t.handlers().onEvent(envelope('incident.created', 11, { incident: incident() }));
    expect(t.current().incidents).toHaveLength(1);
    expect(t.onEffect).toHaveBeenCalledWith(expect.objectContaining({ type: 'incident.new' }));
    t.controller.stop();
  });
  it('drops invalid envelopes', () => {
    const t = setup(() => Promise.reject(new Error('unused')));
    t.handlers().onEvent({ hello: 'world' });
    expect(t.current().seq).toBe(10);
    t.controller.stop();
  });
  it('refetches /sync on a seq gap and replays what arrived meanwhile', async () => {
    const fetchSnapshot = vi.fn(() => Promise.resolve(snapshot({ seq: 12, incidents: [incident()] })));
    const t = setup(fetchSnapshot);
    t.handlers().onEvent(envelope('incident.updated', 13, { incident: incident({ severity: 5 }) })); // 11 and 12 were missed
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    t.handlers().onEvent(envelope('incident.escalated', 14, { incident: incident({ severity: 6 }) })); // buffered during the resync
    await t.controller.resync();
    expect(t.current().seq).toBe(14);
    expect(t.current().incidents[0]!.severity).toBe(6);
    t.controller.stop();
  });
  it('resyncs on reconnect and polls while the socket is down', async () => {
    const fetchSnapshot = vi.fn(() => Promise.resolve(snapshot({ seq: 20 })));
    const t = setup(fetchSnapshot);
    t.handlers().onReconnect();
    await t.controller.resync();
    expect(t.current().seq).toBe(20);
    t.handlers().onStatus('failed');
    expect(t.onConnection).toHaveBeenLastCalledWith('polling');
    await new Promise((r) => setTimeout(r, 130));
    expect(fetchSnapshot.mock.calls.length).toBeGreaterThanOrEqual(3);
    t.handlers().onStatus('online');
    const calls = fetchSnapshot.mock.calls.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(fetchSnapshot.mock.calls.length).toBe(calls);
    t.controller.stop();
    expect(t.close).toHaveBeenCalled();
  });
  it('keeps buffering and retries when the resync fails', async () => {
    let fail = true;
    const fetchSnapshot = vi.fn(() =>
      fail ? Promise.reject(new Error('down')) : Promise.resolve(snapshot({ seq: 12 })),
    );
    const t = setup(fetchSnapshot);
    t.handlers().onEvent(envelope('incident.created', 13, { incident: incident() }));
    await t.controller.resync();
    expect(t.current().seq).toBe(10);
    fail = false;
    await new Promise((r) => setTimeout(r, 80));
    expect(t.current().seq).toBe(13);
    t.controller.stop();
  });
});
