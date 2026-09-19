import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { HEADER_IDEMPOTENCY_KEY } from '@/contracts';
import { getClockOffset, resetClockForTests } from '@/lib/clock';
import { MockEngine, OTP_CODE, memoryStorage } from '@/mocks/engine';
import { createHandlers } from '@/mocks/handlers';
import { PESCARA } from '@/mocks/data/pescara';
import { api, getAccessToken, onAuthChange, setAccessToken } from './client';
import { authApi, gameApi, onboardingApi } from './endpoints';
import { ApiClientError, isApiError } from './errors';

const BASE = 'http://api.test';
let engine: MockEngine;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  engine = new MockEngine({ storage: memoryStorage(), speed: 50 });
  server.resetHandlers(...createHandlers(engine, BASE));
  setAccessToken(null);
  resetClockForTests();
});
afterEach(() => server.resetHandlers());

async function signIn(email = 'client@example.com') {
  const ch = await authApi.requestOtp({ email, locale: 'it' });
  const auth = await authApi.verifyOtp({
    challengeId: ch.challengeId,
    code: OTP_CODE,
    directorName: `Dir ${email.slice(0, 5)}`,
    acceptTerms: true,
    confirmAge: true,
  });
  setAccessToken(auth.accessToken, auth.accessTokenExpiresAt);
  return auth;
}

describe('api client', () => {
  it('maps the error envelope to a typed ApiClientError', async () => {
    const ch = await authApi.requestOtp({ email: 'typed@example.com' });
    const error = await authApi
      .verifyOtp({ challengeId: ch.challengeId, code: '000000' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(isApiError(error, 'OTP_INVALID')).toBe(true);
    expect((error as ApiClientError).status).toBe(400);
    expect((error as ApiClientError).requestId).toMatch(/^mock-/);
    expect((error as ApiClientError).transient).toBe(false);
  });

  it('tracks the server clock offset from meta.serverTime', async () => {
    server.use(
      http.get(`${BASE}/api/v1/ping`, () =>
        HttpResponse.json({ data: 1, meta: { serverTime: new Date(Date.now() + 90_000).toISOString() } }),
      ),
    );
    await api.get('/ping', { auth: false });
    expect(getClockOffset()).toBeGreaterThan(85_000);
    expect(getClockOffset()).toBeLessThan(95_000);
  });

  it('sends the bearer token and an Idempotency-Key on commands; a replayed key returns the stored result', async () => {
    await signIn();
    const seen: (string | null)[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/careers'))
        seen.push(request.headers.get(HEADER_IDEMPOTENCY_KEY), request.headers.get('authorization'));
    });
    const sites = await onboardingApi.starterSites(PESCARA.id);
    const career = await onboardingApi.createCareer({ locationId: PESCARA.id, siteId: sites[0]!.id });
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[1]).toBe(`Bearer ${getAccessToken()}`);

    const snap = await gameApi.sync(career.id);
    const key = 'fixed-key-1';
    const path = `/careers/${career.id}/incidents/${snap.incidents[0]!.id}/dispatch`;
    const first = await api.command<{ dispatchId: string }>(
      path,
      { vehicleIds: [snap.vehicles[0]!.id] },
      { idempotent: key },
    );
    const replay = await api.command<{ dispatchId: string }>(
      path,
      { vehicleIds: [snap.vehicles[0]!.id] },
      { idempotent: key },
    );
    expect(replay.dispatchId).toBe(first.dispatchId);
    await expect(
      gameApi.dispatch(career.id, snap.incidents[0]!.id, [snap.vehicles[0]!.id]),
    ).rejects.toMatchObject({ code: 'VEHICLE_NOT_AVAILABLE' });
    server.events.removeAllListeners();
  });

  it('refreshes transparently on 401, once, and retries the request', async () => {
    const auth = await signIn('refresh@example.com');
    let refreshes = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/auth/refresh')) refreshes++;
    });
    const notified: (string | null)[] = [];
    const off = onAuthChange((r) => notified.push(r?.user.id ?? null));
    setAccessToken('expired-token', new Date(Date.now() + 600_000).toISOString());
    const [me, again] = await Promise.all([authApi.me(), authApi.me()]);
    expect(me.id).toBe(auth.user.id);
    expect(again.id).toBe(auth.user.id);
    expect(refreshes).toBe(1); // single flight
    expect(getAccessToken()).not.toBe('expired-token');
    expect(notified).toEqual([auth.user.id]);
    off();
    server.events.removeAllListeners();
  });

  it('signs out when the refresh cookie is gone', async () => {
    await signIn('gone@example.com');
    engine.logout();
    setAccessToken('expired-token');
    const notified: unknown[] = [];
    const off = onAuthChange((r) => notified.push(r));
    await expect(authApi.me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(getAccessToken()).toBeNull();
    expect(notified).toEqual([null]);
    off();
  });

  it('reports network failures and non-envelope bodies with client codes', async () => {
    server.use(
      http.get(`${BASE}/api/v1/down`, () => HttpResponse.error()),
      http.get(`${BASE}/api/v1/weird`, () => HttpResponse.json({ nope: true })),
      http.get(`${BASE}/api/v1/boom`, () => new HttpResponse('<html>', { status: 503 })),
    );
    await expect(api.get('/down', { auth: false })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      transient: true,
    });
    await expect(api.get('/weird', { auth: false })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(api.get('/boom', { auth: false })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      transient: true,
    });
  });
});
