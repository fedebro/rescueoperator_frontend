import { z } from 'zod';
import { API_PREFIX, ApiError, AuthResult, HEADER_IDEMPOTENCY_KEY, Meta } from '@/contracts';
import { env } from '@/lib/env';
import { observeServerTime } from '@/lib/clock';
import { uuid } from '@/lib/utils';
import { ApiClientError } from './errors';

/**
 * Typed fetch wrapper.
 * - bearer access token kept in memory only (never in storage)
 * - transparent single-flight refresh through POST /auth/refresh (HttpOnly cookie, credentials: include)
 * - `Idempotency-Key` generated per command and reused across the automatic retry
 * - `{ error }` envelope → ApiClientError with a typed `code`
 * - `meta.serverTime` feeds the clock-offset tracker
 */

export interface TokenState {
  accessToken: string | null;
  expiresAt: number | null;
}

type AuthListener = (result: AuthResult | null) => void;

const tokens: TokenState = { accessToken: null, expiresAt: null };
const authListeners = new Set<AuthListener>();
let refreshInFlight: Promise<AuthResult | null> | null = null;

/**
 * "A session may exist in this browser" marker. The refresh token itself is HttpOnly and scoped to `/api/v1/auth`, so
 * a script cannot tell a returning player from a brand-new visitor — and every first page load of a new visitor ended
 * in a 401 on `POST /auth/refresh` (twice, because of the rotation retry below): two red lines in the console on the
 * login screen.
 *
 * The authoritative marker is `rc_session`, a readable companion cookie the server sets and clears together with the
 * refresh cookie (see `SESSION_FLAG_COOKIE` in the backend): same lifetime, no value beyond the flag. A `localStorage`
 * copy is kept as a fallback for environments where the cookie is not visible (the in-browser mock backend, which has
 * no server to set it). Either one being present only costs the usual single refresh attempt; both missing only means
 * the visitor signs in, which they were going to do anyway.
 */
const SESSION_HINT_KEY = 'rc_session';
function readSessionCookie(): boolean {
  try {
    return /(?:^|;\s*)rc_session=1(?:;|$)/.test(globalThis.document?.cookie ?? '');
  } catch {
    return false;
  }
}
function readSessionHint(): boolean {
  try {
    return globalThis.localStorage?.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return true; // storage blocked (private window): fall back to always trying the cookie
  }
}
export function setSessionHint(value: boolean): void {
  try {
    if (value) globalThis.localStorage?.setItem(SESSION_HINT_KEY, '1');
    else globalThis.localStorage?.removeItem(SESSION_HINT_KEY);
  } catch {
    /* storage blocked: the hint is an optimisation, never a requirement */
  }
}
/** True when a refresh cookie may exist for this browser: `AuthBootstrap` skips the boot refresh otherwise. */
export function mayHaveSession(): boolean {
  return readSessionCookie() || readSessionHint();
}

export function setAccessToken(token: string | null, expiresAtIso?: string | null): void {
  tokens.accessToken = token;
  tokens.expiresAt = expiresAtIso ? Date.parse(expiresAtIso) : null;
  if (token) setSessionHint(true);
}
export function getAccessToken(): string | null {
  return tokens.accessToken;
}
/** Notified whenever a refresh succeeds (new AuthResult) or definitively fails (null → signed out). */
export function onAuthChange(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Zod schema of `data`. On mismatch the client warns and returns the raw data (additive contract changes must not break old clients). */
  schema?: z.ZodType<T>;
  /** true → generate an Idempotency-Key; string → use it (retry of a previous attempt). */
  idempotent?: boolean | string;
  auth?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiResponse<T> {
  data: T;
  meta: z.infer<typeof Meta>;
}

export function apiUrl(path: string, query?: RequestOptions<unknown>['query']): string {
  const url = new URL(`${env.apiUrl.replace(/\/$/, '')}${API_PREFIX}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query))
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function rawFetch(
  path: string,
  opts: RequestOptions<unknown>,
  idempotencyKey: string | null,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && tokens.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
  if (idempotencyKey) headers[HEADER_IDEMPOTENCY_KEY] = idempotencyKey;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException('timeout', 'TimeoutError')),
    opts.timeoutMs ?? 15_000,
  );
  const onAbort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(apiUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (cause) {
    if (opts.signal?.aborted) throw new ApiClientError({ code: 'ABORTED', message: 'Request aborted' });
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
    throw new ApiClientError({
      code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: timedOut ? 'Request timed out' : 'Network unreachable',
    });
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

async function toError(res: Response): Promise<ApiClientError> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const parsed = ApiError.safeParse(json);
  if (parsed.success) {
    const e = parsed.data.error;
    return new ApiClientError({
      code: e.code,
      message: e.message,
      details: e.details,
      requestId: e.requestId,
      status: res.status,
    });
  }
  const code =
    res.status === 401
      ? 'UNAUTHENTICATED'
      : res.status === 403
        ? 'FORBIDDEN'
        : res.status === 404
          ? 'NOT_FOUND'
          : res.status === 429
            ? 'RATE_LIMITED'
            : res.status === 503
              ? 'SERVICE_UNAVAILABLE'
              : 'INTERNAL_ERROR';
  return new ApiClientError({ code, message: `HTTP ${res.status}`, status: res.status });
}

/** Single-flight token refresh. Resolves to null when the session is gone. */
export function refreshSession(): Promise<AuthResult | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      let started = Date.now();
      let res = await rawFetch('/auth/refresh', { method: 'POST', auth: false }, null);
      if (res.status === 401 && readSessionHint()) {
        // Refresh tokens rotate: another tab may have just used ours. The server tolerates that race for a few seconds
        // and the browser already holds the new cookie — one delayed retry settles it.
        await new Promise((resolve) => setTimeout(resolve, 400));
        started = Date.now();
        res = await rawFetch('/auth/refresh', { method: 'POST', auth: false }, null);
      }
      if (!res.ok) {
        const err = await toError(res);
        if (err.transient) throw err;
        setAccessToken(null);
        setSessionHint(false);
        for (const l of authListeners) l(null);
        return null;
      }
      const json = (await res.json()) as { data: unknown; meta?: { serverTime?: string } };
      if (json.meta?.serverTime) observeServerTime(json.meta.serverTime, Date.now() - started);
      const result = AuthResult.parse(json.data);
      setAccessToken(result.accessToken, result.accessTokenExpiresAt);
      for (const l of authListeners) l(result);
      return result;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function request<T>(path: string, opts: RequestOptions<T> = {}): Promise<ApiResponse<T>> {
  const idempotencyKey =
    typeof opts.idempotent === 'string' ? opts.idempotent : opts.idempotent ? uuid() : null;
  const needsAuth = opts.auth !== false;

  // Proactive refresh when the token is about to expire (avoids a guaranteed 401 round trip).
  if (needsAuth && tokens.accessToken && tokens.expiresAt && tokens.expiresAt - Date.now() < 10_000)
    await refreshSession();

  let started = Date.now();
  let res = await rawFetch(path, opts as RequestOptions<unknown>, idempotencyKey);
  if (res.status === 401 && needsAuth) {
    const refreshed = await refreshSession();
    if (refreshed) {
      started = Date.now();
      res = await rawFetch(path, opts as RequestOptions<unknown>, idempotencyKey);
    }
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return { data: undefined as T, meta: { serverTime: new Date().toISOString() } };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiClientError({
      code: 'INVALID_RESPONSE',
      message: 'Response is not JSON',
      status: res.status,
    });
  }
  const envelope = z.object({ data: z.unknown(), meta: Meta }).safeParse(json);
  if (!envelope.success)
    throw new ApiClientError({
      code: 'INVALID_RESPONSE',
      message: 'Response is not a { data, meta } envelope',
      status: res.status,
    });
  observeServerTime(envelope.data.meta.serverTime, Date.now() - started);

  let data = envelope.data.data as T;
  if (opts.schema) {
    const parsed = opts.schema.safeParse(data);
    if (parsed.success) data = parsed.data;
    else if (process.env.NODE_ENV !== 'production')
      console.warn(
        `[api] contract mismatch on ${opts.method ?? 'GET'} ${path}`,
        parsed.error.issues.slice(0, 5),
      );
  }
  return { data, meta: envelope.data.meta };
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions<T>, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }).then((r) => r.data),
  getPage: <T>(path: string, opts?: Omit<RequestOptions<T>, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions<T>, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }).then((r) => r.data),
  /** Command: POST with an Idempotency-Key. */
  command: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions<T>, 'method' | 'body'>) =>
    request<T>(path, { idempotent: true, ...opts, method: 'POST', body: body ?? {} }).then((r) => r.data),
  patch: <T>(path: string, body: unknown, opts?: Omit<RequestOptions<T>, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }).then((r) => r.data),
  put: <T>(path: string, body: unknown, opts?: Omit<RequestOptions<T>, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }).then((r) => r.data),
  delete: <T = void>(path: string, opts?: Omit<RequestOptions<T>, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }).then((r) => r.data),
};
