import { http, HttpResponse, type HttpHandler } from 'msw';
import { API_PREFIX, HEADER_IDEMPOTENCY_KEY } from '@/contracts';
import { FACILITY_TYPES, CAPABILITIES, FAMILIES, VEHICLE_TYPES, xpThreshold } from './data/catalog';
import { OTHER_LOCATIONS, PESCARA } from './data/pescara';
import { MockError, type MockCareer, type MockEngine } from './engine';

const t = (key: string) => ({ key });

/** MSW request handlers implementing the v1 REST contract on top of the in-browser engine. */
export function createHandlers(engine: MockEngine, baseUrl: string): HttpHandler[] {
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

  type Ctx = { request: Request; params: Record<string, string | readonly string[] | undefined> };
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
  const requireAdmin = (ctx: Ctx) => {
    const a = authed(ctx);
    if (!a.user.roles.some((r) => r !== 'USER')) throw new MockError(403, 'FORBIDDEN', 'Admin role required');
    return a;
  };

  const C = '/careers/:careerId';
  return [
    /* auth */
    http.post(
      url('/auth/otp/request'),
      route((_c, body) => {
        if (typeof body.email !== 'string' || !/^\S+@\S+\.\S+$/.test(body.email))
          throw new MockError(422, 'VALIDATION_ERROR', 'Invalid email');
        return ok(engine.requestOtp(body.email), { status: 202 });
      }),
    ),
    http.post(
      url('/auth/otp/verify'),
      route((ctx, body) => ok(engine.verifyOtp(body as never, ctx.request.headers.get('user-agent')))),
    ),
    http.post(
      url('/auth/refresh'),
      route(() => ok(engine.refresh())),
    ),
    http.post(
      url('/auth/logout'),
      route(() => {
        engine.logout();
        return new HttpResponse(null, { status: 204 });
      }),
    ),
    http.get(
      url('/me'),
      route((ctx) => ok(authed(ctx).user)),
    ),
    http.patch(
      url('/me'),
      route((ctx, body) => {
        const a = authed(ctx);
        a.user = {
          ...a.user,
          ...(typeof body.locale === 'string' ? { locale: body.locale as 'it' } : {}),
          ...(typeof body.directorName === 'string' ? { directorName: body.directorName } : {}),
        };
        if (typeof body.marketingConsent === 'boolean') a.marketingConsent = body.marketingConsent;
        engine.save();
        return ok(a.user);
      }),
    ),
    http.get(
      url('/me/sessions'),
      route((ctx) => {
        const a = authed(ctx);
        const cur = engine.state.currentSession?.sessionId;
        return ok(a.sessions.map((s) => ({ ...s, current: s.id === cur })));
      }),
    ),
    http.delete(
      url('/me/sessions/:id'),
      route((ctx) => {
        const a = authed(ctx);
        a.sessions = a.sessions.filter((s) => s.id !== ctx.params.id);
        engine.save();
        return new HttpResponse(null, { status: 204 });
      }),
    ),
    http.post(
      url('/me/delete-request'),
      route((ctx) => {
        authed(ctx).status = 'DELETION_REQUESTED';
        engine.save();
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    /* onboarding */
    http.get(
      url('/locations/search'),
      route((ctx) => {
        authed(ctx);
        const q = (new URL(ctx.request.url).searchParams.get('q') ?? '').trim().toLowerCase();
        const all = [
          { ...PESCARA, playable: true },
          ...OTHER_LOCATIONS.map((l) => ({ ...l, playable: false })),
        ];
        const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return ok(
          q.length < 2
            ? []
            : all
                .filter((l) => norm(l.name).includes(norm(q)))
                .map(({ id, name, province, region, population, center, playable }) => ({
                  id,
                  name,
                  province,
                  region,
                  population,
                  center,
                  playable,
                })),
        );
      }),
    ),
    http.get(
      url('/locations/:locationId/starter-sites'),
      route((ctx) => {
        authed(ctx);
        if (ctx.params.locationId !== PESCARA.id)
          throw new MockError(422, 'LOCATION_NOT_PLAYABLE', 'Location not playable yet');
        const sites = engine.starterSites();
        engine.save();
        return ok(sites);
      }),
    ),
    http.get(
      url('/locations/:locationId'),
      route((ctx) => {
        authed(ctx);
        const l = [
          { ...PESCARA, playable: true },
          ...OTHER_LOCATIONS.map((x) => ({ ...x, playable: false })),
        ].find((x) => x.id === ctx.params.locationId);
        if (!l) throw new MockError(404, 'NOT_FOUND', 'Location not found');
        return ok({
          id: l.id,
          name: l.name,
          province: l.province,
          region: l.region,
          population: l.population,
          center: l.center,
          playable: l.playable,
        });
      }),
    ),
    http.post(
      url('/careers'),
      route((ctx, body) => {
        if (!ctx.request.headers.get(HEADER_IDEMPOTENCY_KEY))
          throw new MockError(400, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
        return ok(engine.createCareer(authed(ctx), body as never), { status: 201 });
      }),
    ),
    http.get(
      url('/careers'),
      route((ctx) => {
        const a = authed(ctx);
        return ok(
          Object.values(engine.state.careers)
            .filter((c) => c.userId === a.user.id)
            .map((c) => c.summary),
        );
      }),
    ),

    /* game */
    http.get(
      url(`${C}/sync`),
      route((ctx) => {
        const c = careerOf(ctx);
        const snap = engine.snapshot(c);
        engine.touch(c);
        return ok(snap);
      }),
    ),
    http.get(
      url(`${C}/away-report`),
      route((ctx) => {
        const c = careerOf(ctx);
        const r = engine.awayReport(c);
        engine.save();
        return ok(r);
      }),
    ),
    http.post(
      url(`${C}/away-report/ack`),
      route((ctx) => {
        careerOf(ctx);
        return new HttpResponse(null, { status: 204 });
      }),
    ),
    http.patch(
      url(`${C}/duty`),
      route((ctx, body) => ok(engine.setDuty(careerOf(ctx), body.onDuty === true))),
    ),
    http.get(
      url(`${C}/summary`),
      route((ctx) => ok(careerOf(ctx).summary)),
    ),
    http.get(
      url(`${C}/catalog`),
      route((ctx) => {
        const c = careerOf(ctx);
        const lock = (family: string, level: number) =>
          !c.summary.unlockedFamilies.includes(family as 'FIRE')
            ? 'NOT_UNLOCKED'
            : level > c.summary.level
              ? 'LEVEL_TOO_LOW'
              : null;
        return ok({
          version: 'mock-1',
          families: FAMILIES.map((f) => ({
            code: f.code,
            name: t(`catalog.family.${f.code}`),
            color: f.color,
            requiredLevel: f.requiredLevel,
          })),
          capabilities: CAPABILITIES.map((code) => ({
            code,
            name: t(`catalog.capability.${code}`),
            icon: `cap_${code.toLowerCase()}`,
          })),
          vehicleTypes: VEHICLE_TYPES.map((v) => ({
            code: v.code,
            family: v.family,
            domain: v.domain,
            name: t(`catalog.vehicle.${v.code}.name`),
            description: t(`catalog.vehicle.${v.code}.description`),
            price: String(v.price),
            requiredLevel: v.requiredLevel,
            capacityPoints: v.capacityPoints,
            crewMin: v.crewMin,
            crewOptimal: v.crewOptimal,
            speedFactor: v.speedFactor,
            deliverySeconds: Math.round(v.deliverySeconds / engine.speed),
            capabilities: Object.entries(v.caps).map(([code, value]) => ({ code, value })),
            compatibleFacilityTypes: FACILITY_TYPES.filter(
              (f) => f.family === v.family && f.domains.includes(v.domain),
            ).map((f) => f.code),
            icon: v.icon,
            unlocked: lock(v.family, v.requiredLevel) === null,
            lockedReason: lock(v.family, v.requiredLevel),
          })),
          facilityTypes: FACILITY_TYPES.map((f) => ({
            code: f.code,
            family: f.family,
            name: t(`catalog.facility.${f.code}.name`),
            description: t(`catalog.facility.${f.code}.description`),
            tier: f.tier,
            price: String(f.price),
            requiredLevel: f.requiredLevel,
            domains: f.domains,
            baseCapacity: f.baseCapacity,
            icon: f.icon,
            unlocked:
              f.family === 'SHARED'
                ? f.requiredLevel <= c.summary.level
                : lock(f.family, f.requiredLevel) === null,
            lockedReason:
              f.family === 'SHARED'
                ? f.requiredLevel <= c.summary.level
                  ? null
                  : 'LEVEL_TOO_LOW'
                : lock(f.family, f.requiredLevel),
          })),
        });
      }),
    ),
    http.get(
      url(`${C}/facilities`),
      route((ctx) => ok(careerOf(ctx).facilities)),
    ),
    http.get(
      url(`${C}/facilities/:id`),
      route((ctx) => ok(engine.facilityDetail(careerOf(ctx), String(ctx.params.id)))),
    ),
    http.post(
      url(`${C}/facilities/:id/upgrades`),
      command((ctx, body, c) => engine.buyUpgrade(c, String(ctx.params.id), String(body.upgradeCode)), 201),
    ),
    http.get(
      url(`${C}/vehicles`),
      route((ctx) => ok(careerOf(ctx).vehicles)),
    ),
    http.get(
      url(`${C}/vehicles/:id`),
      route((ctx) => {
        const v = careerOf(ctx).vehicles.find((x) => x.id === ctx.params.id);
        if (!v) throw new MockError(404, 'NOT_FOUND', 'Vehicle not found');
        return ok(v);
      }),
    ),
    http.post(
      url(`${C}/shop/vehicles`),
      command((_ctx, body, c) => engine.buyVehicle(c, body as never), 201),
    ),
    http.post(
      url(`${C}/vehicles/:id/recall`),
      command((ctx, _b, c) => engine.recall(c, String(ctx.params.id))),
    ),
    http.get(
      url(`${C}/incidents`),
      route((ctx) => ok(careerOf(ctx).incidents)),
    ),
    http.get(
      url(`${C}/incidents/:id/dispatch-options`),
      route((ctx) => ok(engine.dispatchOptions(careerOf(ctx), String(ctx.params.id)))),
    ),
    http.get(
      url(`${C}/incidents/:id/timeline`),
      route((ctx) => ok(careerOf(ctx).timelines[String(ctx.params.id)] ?? [])),
    ),
    http.post(
      url(`${C}/incidents/:id/dispatch`),
      command((ctx, body, c) => {
        if (!Array.isArray(body.vehicleIds) || body.vehicleIds.length === 0)
          throw new MockError(422, 'VALIDATION_ERROR', 'vehicleIds must not be empty');
        return engine.dispatch(c, String(ctx.params.id), body.vehicleIds as string[]);
      }, 201),
    ),
    http.get(
      url(`${C}/incidents/:id`),
      route((ctx) => {
        const i = careerOf(ctx).incidents.find((x) => x.id === ctx.params.id);
        if (!i) throw new MockError(404, 'NOT_FOUND', 'Incident not found');
        return ok(i);
      }),
    ),
    http.get(
      url(`${C}/outcomes`),
      route((ctx) => ok(careerOf(ctx).pendingOutcomes)),
    ),
    http.post(
      url(`${C}/outcomes/:incidentId/ack`),
      route((ctx) => {
        engine.ackOutcome(careerOf(ctx), String(ctx.params.incidentId));
        return new HttpResponse(null, { status: 204 });
      }),
    ),
    http.get(
      url(`${C}/economy/balance`),
      route((ctx) => {
        const c = careerOf(ctx);
        return ok({
          credits: c.summary.credits,
          purchasedCredits: '0',
          lifetimeEarned: String(c.stats.earned),
          lifetimeSpent: String(c.stats.spent),
        });
      }),
    ),
    http.get(
      url(`${C}/economy/ledger`),
      route((ctx) => {
        const c = careerOf(ctx);
        const sp = new URL(ctx.request.url).searchParams;
        const start = Number(sp.get('cursor') ?? 0) || 0;
        const limit = Math.min(100, Number(sp.get('limit') ?? 50) || 50);
        const rows = c.ledger.slice(start, start + limit);
        const hasMore = start + limit < c.ledger.length;
        return ok(rows, { meta: { hasMore, nextCursor: hasMore ? String(start + limit) : null } });
      }),
    ),
    http.get(
      url(`${C}/economy/stipend`),
      route((ctx) => {
        const c = careerOf(ctx);
        const next = c.actions.find((a) => a.type === 'STIPEND');
        return ok({
          periodSeconds: 14_400,
          nextPaymentAt: next ? new Date(next.dueAt).toISOString() : null,
          estimatedAmount: String(60 + c.summary.level * 25),
          coveragePct: c.summary.coveragePct,
          accruedPeriods: 0,
          maxAccruedPeriods: 3,
        });
      }),
    ),
    http.get(
      url(`${C}/progression`),
      route((ctx) => {
        const c = careerOf(ctx);
        const s = c.summary;
        return ok({
          level: s.level,
          xp: s.xp,
          xpForCurrentLevel: s.xpForCurrentLevel,
          xpForNextLevel: s.xpForNextLevel,
          reputation: s.reputation,
          incidentsResolved: c.stats.resolved,
          incidentsFailed: c.stats.failed,
        });
      }),
    ),
    http.get(
      url(`${C}/progression/unlocks`),
      route((ctx) => {
        const level = careerOf(ctx).summary.level;
        return ok(
          [
            ...FAMILIES.filter((f) => f.code !== 'UNG').map((f) => ({
              code: f.code,
              kind: 'FAMILY',
              name: t(`catalog.family.${f.code}`),
              requiredLevel: f.requiredLevel,
              unlocked: f.requiredLevel <= level,
              family: f.code,
            })),
            ...VEHICLE_TYPES.map((v) => ({
              code: v.code,
              kind: 'VEHICLE_TYPE',
              name: t(`catalog.vehicle.${v.code}.name`),
              requiredLevel: v.requiredLevel,
              unlocked: v.requiredLevel <= level,
              family: v.family,
            })),
          ].sort((a, b) => a.requiredLevel - b.requiredLevel),
        );
      }),
    ),
    http.get(
      url(`${C}/progression/milestones`),
      route((ctx) => {
        careerOf(ctx);
        return ok([]);
      }),
    ),
    http.post(
      url(`${C}/tutorial/advance`),
      route((ctx, body) => ok(engine.advanceTutorial(careerOf(ctx), String(body.step)))),
    ),
    http.get(
      url(`${C}/notifications`),
      route((ctx) => ok(careerOf(ctx).notifications)),
    ),
    http.post(
      url(`${C}/notifications/read-all`),
      route((ctx) => {
        const c = careerOf(ctx);
        const now = new Date(engine.now()).toISOString();
        c.notifications = c.notifications.map((n) => ({ ...n, readAt: n.readAt ?? now }));
        engine.save();
        return new HttpResponse(null, { status: 204 });
      }),
    ),
    http.post(
      url(`${C}/notifications/:id/read`),
      route((ctx) => {
        const c = careerOf(ctx);
        const now = new Date(engine.now()).toISOString();
        c.notifications = c.notifications.map((n) =>
          n.id === ctx.params.id ? { ...n, readAt: n.readAt ?? now } : n,
        );
        engine.save();
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    /* admin */
    http.get(
      url('/admin/dashboard'),
      route((ctx) => {
        requireAdmin(ctx);
        const careers = Object.values(engine.state.careers);
        const now = engine.now();
        return ok({
          users: Object.keys(engine.state.users).length,
          careers: careers.length,
          activeCareers: careers.filter((c) => now - c.lastSeenAt < 900_000).length,
          activeIncidents: careers.reduce((s, c) => s + c.incidents.length, 0),
          pendingScheduledActions: careers.reduce((s, c) => s + c.actions.length, 0),
          overdueScheduledActions: careers.reduce(
            (s, c) => s + c.actions.filter((a) => a.dueAt < now - 5000).length,
            0,
          ),
          outboxPending: 0,
          creditsIssued24h: String(careers.reduce((s, c) => s + c.stats.earned, 0)),
          creditsSpent24h: String(careers.reduce((s, c) => s + c.stats.spent, 0)),
        });
      }),
    ),
    http.get(
      url('/admin/users'),
      route((ctx) => {
        requireAdmin(ctx);
        const q = (new URL(ctx.request.url).searchParams.get('q') ?? '').toLowerCase();
        return ok(
          Object.values(engine.state.users)
            .filter((u) => !q || u.user.email.includes(q) || u.user.directorName.toLowerCase().includes(q))
            .map((u) => ({
              id: u.user.id,
              email: u.user.email,
              directorName: u.user.directorName,
              roles: u.user.roles,
              locale: u.user.locale,
              status: u.status,
              createdAt: u.user.createdAt,
              lastSeenAt: u.sessions.at(-1)?.lastUsedAt ?? null,
            })),
        );
      }),
    ),
    http.patch(
      url('/admin/users/:id'),
      route((ctx, body) => {
        requireAdmin(ctx);
        const u = Object.values(engine.state.users).find((x) => x.user.id === ctx.params.id);
        if (!u) throw new MockError(404, 'NOT_FOUND', 'User not found');
        if (body.status === 'ACTIVE' || body.status === 'SUSPENDED') u.status = body.status;
        engine.save();
        return ok({
          id: u.user.id,
          email: u.user.email,
          directorName: u.user.directorName,
          roles: u.user.roles,
          locale: u.user.locale,
          status: u.status,
          createdAt: u.user.createdAt,
          lastSeenAt: u.sessions.at(-1)?.lastUsedAt ?? null,
        });
      }),
    ),
    http.get(
      url('/admin/careers'),
      route((ctx) => {
        requireAdmin(ctx);
        const q = (new URL(ctx.request.url).searchParams.get('q') ?? '').toLowerCase();
        return ok(
          Object.values(engine.state.careers)
            .filter(
              (c) =>
                !q ||
                c.summary.directorName.toLowerCase().includes(q) ||
                c.summary.id.toLowerCase().includes(q),
            )
            .map((c) => ({
              id: c.summary.id,
              userId: c.userId,
              directorName: c.summary.directorName,
              locationName: c.summary.locationName,
              level: c.summary.level,
              credits: c.summary.credits,
              onDuty: c.summary.onDuty,
              activeIncidents: c.incidents.length,
              vehicles: c.vehicles.length,
              createdAt: c.summary.createdAt,
            })),
        );
      }),
    ),
    http.get(
      url('/admin/incidents'),
      route((ctx) => {
        requireAdmin(ctx);
        const status = new URL(ctx.request.url).searchParams.get('status');
        return ok(
          Object.values(engine.state.careers)
            .flatMap((c) =>
              c.incidents.map((i) => ({
                id: i.id,
                careerId: c.summary.id,
                templateCode: i.templateCode,
                status: i.status,
                severity: i.severity,
                createdAt: i.createdAt,
                address: i.address,
              })),
            )
            .filter((i) => !status || i.status === status),
        );
      }),
    ),
    http.post(
      url('/admin/incidents/:id/cancel'),
      route((ctx) => {
        requireAdmin(ctx);
        for (const c of Object.values(engine.state.careers)) {
          const i = c.incidents.find((x) => x.id === ctx.params.id);
          if (i) {
            for (const v of c.vehicles.filter(
              (x) => x.incidentId === i.id && ['PREPARING', 'EN_ROUTE', 'ON_SCENE'].includes(x.status),
            ))
              engine.recall(c, v.id);
            c.incidents = c.incidents.filter((x) => x.id !== i.id);
            c.actions = c.actions.filter((a) => a.ref !== i.id);
            engine.save();
          }
        }
        return ok(null);
      }),
    ),
    http.get(
      url('/admin/scheduled-actions'),
      route((ctx) => {
        requireAdmin(ctx);
        return ok(
          Object.values(engine.state.careers)
            .flatMap((c) =>
              c.actions.map((a) => ({
                id: a.id,
                type: a.type,
                status: 'PENDING',
                careerId: c.summary.id,
                dueAt: new Date(a.dueAt).toISOString(),
                attempts: 0,
                lastError: null,
              })),
            )
            .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
        );
      }),
    ),
    http.post(
      url('/admin/scheduled-actions/:id/retry'),
      route((ctx) => {
        requireAdmin(ctx);
        return ok(null);
      }),
    ),
    http.get(
      url('/admin/queues'),
      route((ctx) => {
        requireAdmin(ctx);
        const delayed = Object.values(engine.state.careers).reduce((s, c) => s + c.actions.length, 0);
        return ok([
          { name: 'scheduled-actions', waiting: 0, active: 0, delayed, failed: 0, completed: 0 },
          { name: 'outbox', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
          { name: 'mail', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
        ]);
      }),
    ),
    http.post(
      url('/admin/ledger/adjustments'),
      route((ctx, body) => {
        requireAdmin(ctx);
        const c = engine.state.careers[String(body.careerId)];
        if (!c) throw new MockError(404, 'NOT_FOUND', 'Career not found');
        (engine as unknown as { credit: (c: MockCareer, a: number, t: string) => void }).credit(
          c,
          Number(body.amount),
          String(body.entryType ?? 'ADMIN_ADJUSTMENT'),
        );
        engine.save();
        return ok(null, { status: 201 });
      }),
    ),
    http.get(
      url('/admin/config-versions'),
      route((ctx) => {
        requireAdmin(ctx);
        return ok([
          {
            id: 'cfg_2',
            version: 'mock-2-draft',
            status: 'DRAFT',
            createdAt: new Date(engine.now() - 3_600_000).toISOString(),
            publishedAt: null,
            author: 'admin@rescue-control.test',
            notes: 'Reward curve +5%',
          },
          {
            id: 'cfg_1',
            version: 'mock-1',
            status: 'PUBLISHED',
            createdAt: new Date(engine.now() - 86_400_000).toISOString(),
            publishedAt: new Date(engine.now() - 80_000_000).toISOString(),
            author: 'system',
            notes: 'Initial balancing',
          },
        ]);
      }),
    ),
    http.post(
      url('/admin/config-versions/:id/publish'),
      route((ctx) => {
        requireAdmin(ctx);
        return ok(null);
      }),
    ),
    http.get(
      url('/admin/feature-flags'),
      route((ctx) => {
        requireAdmin(ctx);
        return ok(
          Object.entries(engine.state.featureFlags).map(([key, enabled]) => ({
            key,
            enabled,
            description: null,
            updatedAt: new Date(engine.now()).toISOString(),
          })),
        );
      }),
    ),
    http.patch(
      url('/admin/feature-flags/:key'),
      route((ctx, body) => {
        requireAdmin(ctx);
        const key = String(ctx.params.key);
        engine.state.featureFlags[key] = body.enabled === true;
        engine.save();
        return ok({
          key,
          enabled: engine.state.featureFlags[key],
          description: null,
          updatedAt: new Date(engine.now()).toISOString(),
        });
      }),
    ),
  ];
}

export { xpThreshold };
