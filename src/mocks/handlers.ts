import { http, HttpResponse, type HttpHandler } from 'msw';
import { HEADER_IDEMPOTENCY_KEY } from '@/contracts';
import { OTHER_LOCATIONS, PESCARA } from './data/pescara';
import { catalogDto, unlockList } from './catalog-dto';
import { MockError, type MockEngine } from './engine';
import { installDomains } from './domains';
import { createKit, type DomainHandlers } from './handlers/kit';
import { familiesHandlers } from './handlers/families';
import { facilitiesHandlers } from './handlers/facilities';
import { personnelHandlers } from './handlers/personnel';
import { medicalHandlers } from './handlers/medical';
import { logisticsHandlers } from './handlers/logistics';
import { worldHandlers } from './handlers/world';
import { worldApiOf } from './domains/world';
import { monetizationHandlers } from './handlers/monetization';
import { platformHandlers } from './handlers/platform';
import { adminHandlers } from './handlers/admin';

/** One file per feature area; each owns its routes (see contracts/ROUTES.md) and its domain module in src/mocks/domains. */
const DOMAIN_HANDLERS: DomainHandlers[] = [
  familiesHandlers,
  facilitiesHandlers,
  personnelHandlers,
  medicalHandlers,
  logisticsHandlers,
  worldHandlers,
  monetizationHandlers,
  platformHandlers,
  adminHandlers,
];

/** MSW request handlers implementing the v1 REST contract on top of the in-browser engine. */
export function createHandlers(engine: MockEngine, baseUrl: string): HttpHandler[] {
  installDomains(engine);
  const kit = createKit(engine, baseUrl);
  const { url, ok, route, command, authed, careerOf, query, C } = kit;
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
        const since = query(ctx).get('since');
        const body = since === null ? engine.snapshot(c) : engine.delta(c, Number(since));
        engine.touch(c);
        return ok(body);
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
      route((ctx) => ok(catalogDto(engine, careerOf(ctx)))),
    ),
    /* public: catalog texts (the real backend serves the same bundle, generated from the same YAML) */
    http.get(
      url('/public/i18n/catalog/:locale'),
      route(async (ctx) => {
        const locale = String(ctx.params.locale);
        if (!['it', 'en', 'fr', 'de', 'es'].includes(locale))
          throw new MockError(404, 'NOT_FOUND', 'Unknown locale');
        const bundle = (await import(`./data/generated/i18n/${locale}.json`)) as { default: unknown };
        return ok(bundle.default);
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
          ...worldApiOf(engine).progressionExtras(c),
        });
      }),
    ),
    http.get(
      url(`${C}/progression/unlocks`),
      route((ctx) => ok(unlockList(careerOf(ctx)))),
    ),
    http.post(
      url(`${C}/tutorial/advance`),
      route((ctx, body) => ok(engine.advanceTutorial(careerOf(ctx), String(body.step)))),
    ),
    ...DOMAIN_HANDLERS.flatMap((domain) => domain(kit)),
  ];
}
