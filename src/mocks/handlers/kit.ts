import { HttpResponse, type HttpHandler } from 'msw';
import { API_PREFIX, HEADER_IDEMPOTENCY_KEY } from '@/contracts';
import type { UserDto } from '@/contracts';
import { MockError, type MockCareer, type MockEngine } from '../engine';

export type Ctx = { request: Request; params: Record<string, string | readonly string[] | undefined> };
export type HandlerKit = ReturnType<typeof createKit>;
/** A domain contributes its REST handlers through this signature (see src/mocks/handlers.ts). */
export type DomainHandlers = (kit: HandlerKit) => HttpHandler[];

/** Shared plumbing of every mock REST handler: envelope, errors, auth, idempotent commands, admin guard. */
export function createKit(engine: MockEngine, baseUrl: string) {
  const url = (path: string) => `${baseUrl.replace(/\/$/, '')}${API_PREFIX}${path}`;
  const ok = (data: unknown, init: { status?: number; meta?: Record<string, unknown> } = {}) =>
    HttpResponse.json(
      { data, meta: { serverTime: new Date(engine.now()).toISOString(), ...init.meta } },
      { status: init.status ?? 200 },
    );
  const fail = (e: unknown) => {
    const err =
      e instanceof MockError
        ? e
        : new MockError(500, 'INTERNAL_ERROR', e instanceof Error ? e.message : 'Unexpected mock error');
    if (!(e instanceof MockError)) console.error('[mock]', e);
    return HttpResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          requestId: `mock-${Math.floor(engine.now())}`,
        },
      },
      { status: err.status },
    );
  };

  const route =
    (fn: (ctx: Ctx, body: Record<string, unknown>) => Response | Promise<Response>) => async (ctx: Ctx) => {
      try {
        engine.process();
        let body: Record<string, unknown> = {};
        if (ctx.request.method !== 'GET' && ctx.request.method !== 'DELETE')
          body = ((await ctx.request
            .clone()
            .json()
            .catch(() => ({}))) ?? {}) as Record<string, unknown>;
        return await fn(ctx, body);
      } catch (e) {
        return fail(e);
      }
    };
  const authed = (ctx: Ctx) => engine.authenticate(ctx.request.headers.get('authorization'));
  const careerOf = (ctx: Ctx): MockCareer => engine.career(authed(ctx), String(ctx.params.careerId));
  /** Commands: require the Idempotency-Key header and replay the stored result for a repeated key. */
  const command = (
    fn: (ctx: Ctx, body: Record<string, unknown>, career: MockCareer) => unknown,
    status = 200,
  ) =>
    route((ctx, body) => {
      const key = ctx.request.headers.get(HEADER_IDEMPOTENCY_KEY);
      if (!key) throw new MockError(400, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
      const career = careerOf(ctx);
      if (key in career.idempotency) return ok(career.idempotency[key], { status });
      const result = fn(ctx, body, career);
      career.idempotency[key] = result ?? null;
      const keys = Object.keys(career.idempotency);
      if (keys.length > 100) delete career.idempotency[keys[0]!];
      engine.save();
      return ok(result ?? null, { status });
    });
  /** `roles` omitted = any platform role. SUPER_ADMIN always passes. */
  const requireAdmin = (ctx: Ctx, roles?: UserDto['roles']) => {
    const a = authed(ctx);
    const held = a.user.roles.filter((r) => r !== 'USER');
    if (held.length === 0) throw new MockError(403, 'FORBIDDEN', 'Admin role required');
    if (roles && !held.includes('SUPER_ADMIN') && !held.some((r) => roles.includes(r)))
      throw new MockError(403, 'FORBIDDEN', 'Insufficient admin role');
    return a;
  };
  const noContent = () => new HttpResponse(null, { status: 204 });
  const query = (ctx: Ctx) => new URL(ctx.request.url).searchParams;
  return {
    engine,
    url,
    ok,
    fail,
    route,
    command,
    authed,
    careerOf,
    requireAdmin,
    noContent,
    query,
    C: '/careers/:careerId',
  };
}
