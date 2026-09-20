import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsEventBody } from '@/contracts';
import { AnalyticsClient, createTransport, type QueuedEvent, type SendFn } from './analytics-client';

function setup(overrides: Partial<ConstructorParameters<typeof AnalyticsClient>[0]> = {}) {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  let enabled = true;
  const sent: QueuedEvent[][] = [];
  const send = vi.fn<SendFn>(async (events) => {
    sent.push(events);
  });
  const client = new AnalyticsClient({
    send,
    isEnabled: () => enabled,
    now: () => now,
    ...overrides,
  });
  return {
    client,
    send,
    sent,
    setEnabled: (v: boolean) => (enabled = v),
    advance: (ms: number) => (now += ms),
  };
}

describe('AnalyticsClient', () => {
  it('queues nothing and sends nothing without consent', async () => {
    const t = setup();
    t.setEnabled(false);
    t.client.track('level_up', { level: 2 });
    expect(t.client.size).toBe(0);
    await t.client.flush();
    expect(t.send).not.toHaveBeenCalled();
  });

  it('drops the queue when consent is withdrawn before the flush', async () => {
    const t = setup();
    t.client.track('level_up', { level: 2 });
    t.setEnabled(false);
    await t.client.flush();
    expect(t.send).not.toHaveBeenCalled();
    expect(t.client.size).toBe(0);
  });

  it('sends contract-valid batches of at most 50 events, sanitised, with the shared context', async () => {
    const t = setup({
      context: () => ({ sid: 'abc', layout: 'desktop', email: 'x@example.com' }),
      maxBatch: 50,
    });
    const hold = t.send.getMockImplementation()!;
    // Block the automatic "full batch" flush so that the queue really holds 120 events.
    t.send.mockImplementation(() => new Promise(() => undefined));
    for (let i = 0; i < 120; i++)
      t.client.track('dispatch_sent', { vehicleCount: i, directorName: 'Mario Rossi' });
    t.send.mockImplementation(hold);
    const blocked = t.send.mock.calls[0]![0];
    expect(blocked).toHaveLength(50);
    expect(AnalyticsEventBody.safeParse({ events: blocked }).success).toBe(true);
    expect(blocked[0]).toEqual({
      name: 'dispatch_sent',
      at: '2026-03-01T09:00:00.000Z',
      props: { sid: 'abc', layout: 'desktop', vehicleCount: 0 },
    });
    expect(JSON.stringify(blocked)).not.toMatch(/Mario|example\.com/);
  });

  it('flushes in batches until the queue is below one batch', async () => {
    const t = setup({ maxBatch: 10 });
    const original = t.send.getMockImplementation()!;
    t.send.mockImplementationOnce(async () => {
      throw new Error('first attempt fails');
    });
    for (let i = 0; i < 25; i++) t.client.track('screen_view', { screen: `s${i}` });
    await vi.waitFor(() => expect(t.send).toHaveBeenCalledTimes(1));
    t.send.mockImplementation(original);
    expect(t.client.size).toBe(25); // the failed batch went back in front
    t.advance(60_000);
    await t.client.flush();
    expect(t.sent.map((b) => b.length)).toEqual([10, 10]);
    expect(t.sent[0]![0]!.props).toEqual({ screen: 's0' }); // order preserved
    await t.client.flush();
    expect(t.client.size).toBe(0);
  });

  it('backs off exponentially after failures and recovers', async () => {
    const t = setup({ baseBackoffMs: 1000, maxBackoffMs: 8000 });
    expect([1, 2, 3, 4, 5, 9].map((n) => t.client.backoffMs(n))).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
    t.send.mockRejectedValue(new Error('offline'));
    t.client.track('level_up', { level: 2 });
    await t.client.flush();
    expect(t.send).toHaveBeenCalledTimes(1);
    await t.client.flush(); // inside the backoff window → not attempted
    expect(t.send).toHaveBeenCalledTimes(1);
    await t.client.flush('unload'); // last chance before the tab dies → always attempted
    expect(t.send).toHaveBeenCalledTimes(2);
    t.advance(2001);
    t.send.mockResolvedValue(undefined);
    await t.client.flush();
    expect(t.send).toHaveBeenCalledTimes(3);
    expect(t.client.size).toBe(0);
  });

  it('caps the queue by dropping the oldest events', async () => {
    const t = setup({ maxQueue: 5, maxBatch: 50 });
    for (let i = 0; i < 8; i++) t.client.track('screen_view', { screen: `s${i}` });
    expect(t.client.size).toBe(5);
    await t.client.flush();
    expect(t.sent[0]!.map((e) => e.props?.screen)).toEqual(['s3', 's4', 's5', 's6', 's7']);
  });

  it('ignores invalid event names', () => {
    const t = setup();
    t.client.track('Not Valid');
    expect(t.client.size).toBe(0);
  });

  describe('lifecycle', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('flushes on the interval, when the tab is hidden and on pagehide', async () => {
      const t = setup({ flushIntervalMs: 10_000 });
      const stop = t.client.start();
      t.client.track('level_up', { level: 2 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(t.send).toHaveBeenLastCalledWith(expect.any(Array), 'normal');

      t.client.track('level_up', { level: 3 });
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.send).toHaveBeenLastCalledWith(expect.any(Array), 'unload');

      t.client.track('level_up', { level: 4 });
      window.dispatchEvent(new Event('pagehide'));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.send).toHaveBeenCalledTimes(3);

      stop();
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      t.client.track('level_up', { level: 5 });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(t.send).toHaveBeenCalledTimes(3);
    });
  });
});

describe('transport', () => {
  const events: QueuedEvent[] = [{ name: 'level_up', at: '2026-03-01T09:00:00.000Z', props: { level: 2 } }];
  const ok = { ok: true, status: 204 } as Response;

  it('uses the API client for normal flushes, authenticated when a session exists', async () => {
    const post = vi.fn(async () => undefined);
    await createTransport({ apiUrl: 'http://api.test', getAccessToken: () => 'tok', post })(events, 'normal');
    expect(post).toHaveBeenCalledWith(events, true);
    await createTransport({ apiUrl: 'http://api.test', getAccessToken: () => null, post })(events, 'normal');
    expect(post).toHaveBeenLastCalledWith(events, false);
  });

  it('unload + session → fetch keepalive with the bearer, beacon as fallback', async () => {
    const fetchFn = vi.fn(async () => ok);
    const beacon = vi.fn(() => true);
    const send = createTransport({
      apiUrl: 'http://api.test/',
      getAccessToken: () => 'tok',
      post: vi.fn(),
      fetchFn: fetchFn as unknown as typeof fetch,
      beacon,
    });
    await send(events, 'unload');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/analytics/events');
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init.body))).toEqual({ events });
    expect(beacon).not.toHaveBeenCalled();

    fetchFn.mockRejectedValueOnce(new Error('network'));
    await send(events, 'unload');
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('unload without a session → beacon first, fetch keepalive as fallback', async () => {
    const fetchFn = vi.fn(async () => ok);
    const beacon = vi.fn(() => true);
    const send = createTransport({
      apiUrl: 'http://api.test',
      getAccessToken: () => null,
      post: vi.fn(),
      fetchFn: fetchFn as unknown as typeof fetch,
      beacon,
    });
    await send(events, 'unload');
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
    beacon.mockReturnValueOnce(false);
    await send(events, 'unload');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
