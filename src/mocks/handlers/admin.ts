import Ajv from 'ajv';
import { http, type HttpHandler } from 'msw';
import {
  AdminClosureBody,
  AdminCreditAdjustmentBody,
  AdminSpawnIncidentBody,
  HEADER_IDEMPOTENCY_KEY,
  PlatformRole,
  WeatherCode,
} from '@/contracts';
import {
  ADMIN_PERMISSIONS,
  CREDIT_ADJUSTMENT_THRESHOLD,
  canAdmin,
  type AdminAction,
  type AdminCareerRow,
  type AdminConfigVersionRow,
  type AdminUserRow,
} from '@/lib/api/admin';
import { INCIDENT_TEMPLATES } from '../data/catalog';
import { MockError, iso, text, type MockCareer, type MockEngine } from '../engine';
import {
  CONFIG_SCHEMA,
  FLAG_DESCRIPTIONS,
  activateConfig,
  adminState,
  adminWorld,
  allActionRows,
  allIncidentRows,
  assertReason,
  audit,
  broadcastWorld,
  careerOfIncident,
  catalogView,
  createClosure,
  createDraft,
  incidentRow,
  installAdminQa,
  personnelRows,
  retryAction,
  setFlag,
  type ConfigVersion,
} from '../domains/admin';
import { majorOf } from '../domains/major';
import type { Ctx, DomainHandlers, HandlerKit } from './kit';

type Account = ReturnType<HandlerKit['authed']>;
const CLOSED = ['RESOLVED', 'FAILED', 'EXPIRED', 'CANCELLED'];

const accounts = (engine: MockEngine) => Object.values(engine.state.users);
function accountById(engine: MockEngine, id: unknown): Account {
  const account = accounts(engine).find((a) => a.user.id === id);
  if (!account) throw new MockError(404, 'NOT_FOUND', 'User not found');
  return account;
}
function careerById(engine: MockEngine, id: unknown): MockCareer {
  const career = engine.state.careers[String(id)];
  if (!career) throw new MockError(404, 'NOT_FOUND', 'Career not found');
  return career;
}
function userRow(account: Account): AdminUserRow {
  const lastSeen =
    account.sessions
      .map((s) => s.lastUsedAt)
      .sort()
      .at(-1) ?? null;
  return {
    id: account.user.id,
    email: account.user.email,
    directorName: account.user.directorName,
    status: account.status,
    roles: account.user.roles,
    createdAt: account.user.createdAt,
    lastSeenAt: lastSeen,
    careerId: account.user.activeCareerId,
  };
}
function careerRow(career: MockCareer): AdminCareerRow {
  const s = career.summary;
  return {
    id: s.id,
    directorName: s.directorName,
    locationName: s.locationName,
    level: s.level,
    credits: s.credits,
    vehicles: career.vehicles.length,
    facilities: career.facilities.length,
    activeIncidents: career.incidents.length,
    onDuty: s.onDuty,
    lastActiveAt: career.lastSeenAt ? iso(career.lastSeenAt) : null,
  };
}
const includes = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle);
const limitOf = (sp: URLSearchParams) => Math.min(200, Math.max(1, Number(sp.get('limit') ?? 100) || 100));
function paged<T>(kit: HandlerKit, rows: T[], sp: URLSearchParams) {
  const start = Math.max(0, Number(sp.get('cursor') ?? 0) || 0);
  const limit = limitOf(sp);
  const hasMore = start + limit < rows.length;
  return kit.ok(rows.slice(start, start + limit), {
    meta: { hasMore, nextCursor: hasMore ? String(start + limit) : null },
  });
}

/** REST handlers of the `admin` area: every route listed in src/lib/api/admin.ts, with the same role matrix. */
export const adminHandlers: DomainHandlers = (kit) => {
  const { engine, ok, route, query, noContent } = kit;
  installAdminQa(engine);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateConfig = ajv.compile(CONFIG_SCHEMA);
  const admin = (path: string) => kit.url(`/admin${path}`);

  /** Any platform role may read; a mutation needs the minimum role of the shared permission matrix. */
  const reader = (ctx: Ctx) => kit.requireAdmin(ctx);
  const actor = (ctx: Ctx, action: AdminAction): string => {
    const account = kit.requireAdmin(ctx);
    if (!canAdmin(account.user.roles, action))
      throw new MockError(403, 'FORBIDDEN', `${action} requires ${ADMIN_PERMISSIONS[action]}`);
    return account.user.email;
  };
  /** Admin commands: Idempotency-Key required, replayed per key (the kit's `command` is career-scoped). */
  const command = (fn: (ctx: Ctx, body: Record<string, unknown>) => unknown) =>
    route((ctx, body) => {
      const key = ctx.request.headers.get(HEADER_IDEMPOTENCY_KEY);
      if (!key) throw new MockError(400, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
      reader(ctx);
      const store = adminState(engine).idempotency;
      if (key in store) return ok(store[key]);
      const result = fn(ctx, body) ?? null;
      store[key] = result;
      const keys = Object.keys(store);
      if (keys.length > 100) delete store[keys[0]!];
      engine.save();
      return ok(result);
    });
  const mutation = (fn: (ctx: Ctx, body: Record<string, unknown>) => Response) =>
    route((ctx, body) => {
      const res = fn(ctx, body);
      engine.save();
      return res;
    });
  const parse = <T>(
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
    v: unknown,
  ): T => {
    const parsed = schema.safeParse(v);
    if (!parsed.success) throw new MockError(422, 'VALIDATION_ERROR', 'Invalid body', parsed.error);
    return parsed.data as T;
  };

  const baseUrl = kit.url('').replace(/\/api\/v1$/, '');
  const handlers: HttpHandler[] = [
    /* Root endpoint of the real backend; `environment` is the assumed additive field. */
    http.get(`${baseUrl}/version`, () =>
      Response.json({
        data: {
          name: 'rescue-control-mock',
          version: '0.0.0-mock',
          gitSha: null,
          configVersion: adminState(engine).config.find((v) => v.status === 'PUBLISHED')?.version ?? null,
          catalogVersion: catalogView().version,
          environment: 'MOCK',
        },
        meta: { serverTime: iso(engine.now()) },
      }),
    ),

    /* ───────────── dashboard ───────────── */
    http.get(
      admin('/dashboard'),
      route((ctx) => {
        reader(ctx);
        const now = engine.now();
        const careers = Object.values(engine.state.careers);
        const actions = allActionRows(engine);
        const s = adminState(engine);
        return ok({
          users: accounts(engine).length,
          careers: careers.length,
          onDutyCareers: careers.filter((c) => c.summary.onDuty).length,
          activeIncidents: careers.reduce((n, c) => n + c.incidents.length, 0),
          overdueScheduledActions: actions.filter((a) => a.status !== 'PENDING').length,
          pendingOutbox: 0,
          queues: queueStats(engine),
          providers: [
            { name: 'mail', healthy: true, detail: null },
            { name: 'routing', healthy: false, detail: 'OSRM unreachable — straight-line × 1.4 fallback' },
            { name: 'weather', healthy: true, detail: null },
            { name: 'payments', healthy: true, detail: 'test mode' },
            { name: 'ads', healthy: true, detail: 'simulated provider' },
          ],
          revenueMinorLast30d: s.purchases
            .filter((p) => ['PAID', 'CREDITED'].includes(p.status))
            .filter((p) => now - Date.parse(p.createdAt) < 30 * 86_400_000)
            .reduce((n, p) => n + p.priceMinor, 0),
          signupsLast7d: accounts(engine).filter((a) => now - Date.parse(a.user.createdAt) < 7 * 86_400_000)
            .length,
        });
      }),
    ),
    http.get(
      admin('/queues'),
      route((ctx) => {
        reader(ctx);
        return ok(queueStats(engine));
      }),
    ),

    /* ───────────── users ───────────── */
    http.get(
      admin('/users'),
      route((ctx) => {
        reader(ctx);
        const sp = query(ctx);
        const q = (sp.get('q') ?? '').trim().toLowerCase();
        const status = sp.get('status');
        const rows = accounts(engine)
          .map(userRow)
          .filter((u) => !status || u.status === status)
          .filter((u) => !q || includes(u.email, q) || includes(u.directorName, q) || includes(u.id, q))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return paged(kit, rows, sp);
      }),
    ),
    http.get(
      admin('/users/:id'),
      route((ctx) => {
        reader(ctx);
        const account = accountById(engine, ctx.params.id);
        const s = adminState(engine);
        return ok({
          user: userRow(account),
          locale: account.user.locale,
          marketingConsent: account.marketingConsent,
          suspension: account.status === 'SUSPENDED' ? (s.suspensions[account.user.id] ?? null) : null,
          sessions: account.sessions,
          notes: s.notes[account.user.id] ?? [],
          audit: s.audit.filter((a) => a.targetId === account.user.id).slice(0, 20),
        });
      }),
    ),
    http.post(
      admin('/users/:id/suspend'),
      command((ctx, body) => {
        const by = actor(ctx, 'users.suspend');
        const reason = assertReason(body.reason);
        const account = accountById(engine, ctx.params.id);
        if (account.user.email === by) throw new MockError(409, 'CONFLICT', 'You cannot suspend yourself');
        if (account.status !== 'ACTIVE') throw new MockError(409, 'CONFLICT', 'User is not active');
        account.status = 'SUSPENDED';
        account.sessions = [];
        adminState(engine).suspensions[account.user.id] = { reason, at: iso(engine.now()), by };
        audit(engine, by, 'user.suspend', 'user', account.user.id, reason);
        return userRow(account);
      }),
    ),
    http.post(
      admin('/users/:id/reactivate'),
      command((ctx, body) => {
        const by = actor(ctx, 'users.suspend');
        const reason = assertReason(body.reason);
        const account = accountById(engine, ctx.params.id);
        if (account.status !== 'SUSPENDED') throw new MockError(409, 'CONFLICT', 'User is not suspended');
        account.status = 'ACTIVE';
        delete adminState(engine).suspensions[account.user.id];
        audit(engine, by, 'user.reactivate', 'user', account.user.id, reason);
        return userRow(account);
      }),
    ),
    http.delete(
      admin('/users/:id/sessions/:sessionId'),
      mutation((ctx) => {
        const by = actor(ctx, 'users.revokeSessions');
        const reason = assertReason(query(ctx).get('reason'));
        const account = accountById(engine, ctx.params.id);
        if (!account.sessions.some((s) => s.id === ctx.params.sessionId))
          throw new MockError(404, 'NOT_FOUND', 'Session not found');
        account.sessions = account.sessions.filter((s) => s.id !== ctx.params.sessionId);
        audit(engine, by, 'user.session.revoke', 'user', account.user.id, reason);
        return noContent();
      }),
    ),
    http.delete(
      admin('/users/:id/sessions'),
      mutation((ctx) => {
        const by = actor(ctx, 'users.revokeSessions');
        const reason = assertReason(query(ctx).get('reason'));
        const account = accountById(engine, ctx.params.id);
        // The caller's own current session survives, otherwise the admin would sign themselves out mid-action.
        const keep = account.user.email === by ? engine.state.currentSession?.sessionId : undefined;
        account.sessions = account.sessions.filter((s) => s.id === keep);
        audit(engine, by, 'user.session.revoke_all', 'user', account.user.id, reason);
        return noContent();
      }),
    ),
    http.put(
      admin('/users/:id/roles'),
      mutation((ctx, body) => {
        const by = actor(ctx, 'users.roles');
        const reason = assertReason(body.reason);
        const roles = parse(PlatformRole.array(), body.roles).filter((r) => r !== 'USER');
        const account = accountById(engine, ctx.params.id);
        if (account.user.email === by && !roles.includes('SUPER_ADMIN'))
          throw new MockError(409, 'CONFLICT', 'You cannot remove your own SUPER_ADMIN role');
        account.user = { ...account.user, roles: ['USER', ...new Set(roles)] };
        audit(
          engine,
          by,
          'user.roles.set',
          'user',
          account.user.id,
          `${reason} [${roles.join(', ') || '—'}]`,
        );
        return ok(userRow(account));
      }),
    ),
    http.post(
      admin('/users/:id/notes'),
      mutation((ctx, body) => {
        const by = actor(ctx, 'users.notes');
        const note = assertReason(body.text);
        const account = accountById(engine, ctx.params.id);
        const row = { id: engine.id('not'), author: by, text: note, createdAt: iso(engine.now()) };
        (adminState(engine).notes[account.user.id] ??= []).unshift(row);
        audit(engine, by, 'user.note.add', 'user', account.user.id, note);
        return ok(row, { status: 201 });
      }),
    ),

    /* ───────────── careers ───────────── */
    http.get(
      admin('/careers'),
      route((ctx) => {
        reader(ctx);
        const sp = query(ctx);
        const q = (sp.get('q') ?? '').trim().toLowerCase();
        const rows = Object.values(engine.state.careers)
          .map(careerRow)
          .filter(
            (c) => !q || includes(c.directorName, q) || includes(c.id, q) || includes(c.locationName, q),
          );
        return paged(kit, rows, sp);
      }),
    ),
    http.get(
      admin('/careers/:id'),
      route((ctx) => {
        const account = reader(ctx);
        const career = careerById(engine, ctx.params.id);
        const owner = accounts(engine).find((a) => a.user.id === career.userId);
        return ok({
          career: careerRow(career),
          userId: career.userId,
          email: owner?.user.email ?? '',
          summary: career.summary,
          stats: {
            incidentsResolved: career.stats.resolved,
            incidentsFailed: career.stats.failed,
            creditsEarned: String(career.stats.earned),
            creditsSpent: String(career.stats.spent),
          },
          creditAdjustmentLimit: canAdmin(account.user.roles, 'careers.creditAdjustmentLarge')
            ? null
            : canAdmin(account.user.roles, 'careers.creditAdjustment')
              ? String(CREDIT_ADJUSTMENT_THRESHOLD)
              : '0',
        });
      }),
    ),
    ...(
      [
        ['facilities', (c: MockCareer) => c.facilities],
        ['vehicles', (c: MockCareer) => c.vehicles],
        ['personnel', personnelRows],
        ['notifications', (c: MockCareer) => c.notifications],
        ['incidents', (c: MockCareer) => allIncidentRows(engine).filter((i) => i.careerId === c.summary.id)],
        [
          'progression',
          (c: MockCareer) => ({
            level: c.summary.level,
            xp: c.summary.xp,
            xpForCurrentLevel: c.summary.xpForCurrentLevel,
            xpForNextLevel: c.summary.xpForNextLevel,
            reputation: c.summary.reputation,
            unlockedFamilies: c.summary.unlockedFamilies,
            tutorialCompleted: c.summary.tutorial.completed,
            tutorialStep: c.summary.tutorial.step,
            incidentsResolved: c.stats.resolved,
            incidentsFailed: c.stats.failed,
          }),
        ],
      ] as const
    ).map(([name, read]) =>
      http.get(
        admin(`/careers/:id/${name}`),
        route((ctx) => {
          reader(ctx);
          return ok(read(careerById(engine, ctx.params.id)));
        }),
      ),
    ),
    http.get(
      admin('/careers/:id/ledger'),
      route((ctx) => {
        reader(ctx);
        return paged(kit, careerById(engine, ctx.params.id).ledger, query(ctx));
      }),
    ),
    http.post(
      admin('/careers/:id/credit-adjustment'),
      command((ctx, body) => {
        const by = actor(ctx, 'careers.creditAdjustment');
        const parsed = parse(AdminCreditAdjustmentBody, body);
        const amount = BigInt(parsed.amount);
        if (amount === 0n) throw new MockError(422, 'VALIDATION_ERROR', 'Amount must not be zero');
        const magnitude = amount < 0n ? -amount : amount;
        if (magnitude > CREDIT_ADJUSTMENT_THRESHOLD) actor(ctx, 'careers.creditAdjustmentLarge');
        const career = careerById(engine, ctx.params.id);
        // Append-only ledger: the adjustment is a NEW entry; the balance can never go below zero (422 INSUFFICIENT_CREDITS).
        engine.credit(career, Number(amount), 'ADMIN_ADJUSTMENT', false, text('ledger.ADMIN_ADJUSTMENT'));
        audit(
          engine,
          by,
          'career.credit_adjustment',
          'career',
          career.summary.id,
          `${parsed.reasonCode} ${parsed.amount}: ${parsed.note}`,
        );
        return { entry: career.ledger[0], credits: career.summary.credits };
      }),
    ),
    http.post(
      admin('/careers/:id/spawn-incident'),
      command((ctx, body) => {
        const by = actor(ctx, 'careers.spawnIncident');
        const parsed = parse(AdminSpawnIncidentBody, body);
        const career = careerById(engine, ctx.params.id);
        const template = INCIDENT_TEMPLATES.find((t) => t.code === parsed.templateCode);
        if (!template) throw new MockError(404, 'NOT_FOUND', 'Unknown incident template');
        const severity =
          parsed.severity === undefined
            ? undefined
            : Math.min(template.severity[1], Math.max(template.severity[0], parsed.severity));
        const position =
          Array.isArray(body.position) && body.position.length === 2
            ? ([Number(body.position[0]), Number(body.position[1])] as [number, number])
            : undefined;
        const incident = engine.spawnIncident(career, parsed.templateCode, false, {
          severity,
          position,
          address: position ? `${position[1].toFixed(5)}, ${position[0].toFixed(5)}` : undefined,
        });
        const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
        audit(engine, by, 'career.spawn_incident', 'incident', incident.id, reason ?? parsed.templateCode);
        return incident;
      }),
    ),
    /* QA / support: a major incident now (D-24 / D-69) — GAME_ADMIN, audited like the backend's `major_incident.spawn`. */
    http.post(
      admin('/careers/:id/major-incident'),
      command((ctx, body) => {
        const by = actor(ctx, 'careers.spawnMajor');
        const reason = assertReason(body.reason);
        const scenarioCode =
          typeof body.scenarioCode === 'string' && body.scenarioCode ? body.scenarioCode : undefined;
        if (scenarioCode && !/^MAJ_[A-Z0-9_]+$/.test(scenarioCode))
          throw new MockError(422, 'VALIDATION_ERROR', 'Invalid scenario code', { fields: ['scenarioCode'] });
        const career = careerById(engine, ctx.params.id);
        const major = majorOf(engine).start(career, { scenarioCode });
        audit(engine, by, 'major_incident.spawn', 'major_incident', major.id, reason);
        return major;
      }),
    ),
    http.post(
      admin('/careers/:id/duty'),
      command((ctx, body) => {
        const by = actor(ctx, 'careers.setDuty');
        const reason = assertReason(body.reason);
        const career = careerById(engine, ctx.params.id);
        engine.setDuty(career, body.onDuty === true);
        audit(
          engine,
          by,
          body.onDuty === true ? 'career.duty.on' : 'career.duty.off',
          'career',
          career.summary.id,
          reason,
        );
        return careerRow(career);
      }),
    ),

    /* ───────────── incidents ───────────── */
    http.get(
      admin('/incidents'),
      route((ctx) => {
        reader(ctx);
        const sp = query(ctx);
        const status = sp.get('status');
        const min = Number(sp.get('severityMin') ?? 1) || 1;
        const max = Number(sp.get('severityMax') ?? 10) || 10;
        const rows = allIncidentRows(engine)
          .filter((i) => !status || (status === 'ACTIVE' ? !CLOSED.includes(i.status) : i.status === status))
          .filter((i) => !sp.get('careerId') || i.careerId === sp.get('careerId'))
          .filter((i) => !sp.get('templateCode') || i.templateCode === sp.get('templateCode'))
          .filter((i) => i.severity >= min && i.severity <= max);
        return paged(kit, rows, sp);
      }),
    ),
    http.get(
      admin('/incidents/:id'),
      route((ctx) => {
        reader(ctx);
        const incidentId = String(ctx.params.id);
        const live = careerOfIncident(engine, incidentId);
        const closed = adminState(engine).closedIncidents.find((x) => x.incident.id === incidentId);
        const career = live ?? (closed ? engine.state.careers[closed.careerId] : undefined);
        const incident = live?.incidents.find((i) => i.id === incidentId) ?? closed?.incident;
        if (!career || !incident) throw new MockError(404, 'NOT_FOUND', 'Incident not found');
        return ok({
          row: incidentRow(career, incident, live ? null : (closed?.closedAt ?? null)),
          incident,
          vehicles: career.vehicles.filter(
            (v) => v.incidentId === incidentId || incident.assignedVehicleIds.includes(v.id),
          ),
          timeline: career.timelines[incidentId] ?? [],
          scheduledActions: allActionRows(engine).filter(
            (a) => a.aggregateId === incidentId || career.ung[a.aggregateId ?? ''] === incidentId,
          ),
        });
      }),
    ),
    ...(
      [
        ['force-resolve', 'incidents.forceResolve', 'RESOLVED', 'incident.force_resolve'],
        ['cancel', 'incidents.cancel', 'CANCELLED', 'incident.cancel'],
      ] as const
    ).map(([path, permission, status, action]) =>
      http.post(
        admin(`/incidents/:id/${path}`),
        command((ctx, body) => {
          const by = actor(ctx, permission);
          const reason = assertReason(body.reason);
          const incidentId = String(ctx.params.id);
          const career = careerOfIncident(engine, incidentId);
          const incident = career?.incidents.find((i) => i.id === incidentId);
          if (!career || !incident) throw new MockError(409, 'CONFLICT', 'Incident is not active');
          engine.close(career, incident, status, engine.now());
          audit(engine, by, action, 'incident', incidentId, reason);
          return incidentRow(career, { ...incident, status }, iso(engine.now()));
        }),
      ),
    ),

    /* ───────────── scheduled actions ───────────── */
    http.get(
      admin('/scheduled-actions'),
      route((ctx) => {
        reader(ctx);
        const sp = query(ctx);
        const rows = allActionRows(engine)
          .filter((a) => !sp.get('status') || a.status === sp.get('status'))
          .filter((a) => !sp.get('type') || a.type === sp.get('type'))
          .filter((a) => !sp.get('careerId') || a.careerId === sp.get('careerId'))
          .filter((a) => sp.get('overdue') !== 'true' || a.status !== 'PENDING');
        return paged(kit, rows, sp);
      }),
    ),
    http.get(
      admin('/scheduled-actions/:id'),
      route((ctx) => {
        reader(ctx);
        const row = allActionRows(engine).find((a) => a.id === ctx.params.id);
        if (!row) throw new MockError(404, 'NOT_FOUND', 'Scheduled action not found');
        return ok(row);
      }),
    ),
    http.post(
      admin('/scheduled-actions/:id/retry'),
      command((ctx, body) => {
        const by = actor(ctx, 'scheduledActions.retry');
        const reason = assertReason(body.reason);
        const row = retryAction(engine, String(ctx.params.id));
        audit(engine, by, 'scheduled_action.retry', 'scheduled_action', row.id, reason);
        return row;
      }),
    ),

    /* ───────────── config versions ───────────── */
    http.get(
      admin('/config/schema'),
      route((ctx) => {
        reader(ctx);
        return ok(CONFIG_SCHEMA);
      }),
    ),
    http.get(
      admin('/config/versions'),
      route((ctx) => {
        reader(ctx);
        return ok(adminState(engine).config.map(configRow));
      }),
    ),
    http.get(
      admin('/config/versions/:id'),
      route((ctx) => {
        reader(ctx);
        return ok(configVersion(engine, ctx.params.id));
      }),
    ),
    http.post(
      admin('/config/versions'),
      command((ctx, body) => {
        const by = actor(ctx, 'config.draft');
        const draft = createDraft(
          engine,
          by,
          typeof body.fromVersionId === 'string' ? body.fromVersionId : undefined,
          typeof body.note === 'string' ? body.note : undefined,
        );
        audit(engine, by, 'config.draft.create', 'config_version', draft.id, draft.note);
        return draft;
      }),
    ),
    http.put(
      admin('/config/versions/:id'),
      mutation((ctx, body) => {
        const by = actor(ctx, 'config.draft');
        const version = configVersion(engine, ctx.params.id);
        if (version.status !== 'DRAFT') throw new MockError(409, 'CONFLICT', 'Only a draft can be edited');
        if (!validateConfig(body.content))
          throw new MockError(422, 'VALIDATION_ERROR', 'Config does not match the schema', {
            errors: (validateConfig.errors ?? []).map((e) => ({ path: e.instancePath, message: e.message })),
          });
        version.content = body.content as Record<string, unknown>;
        if (typeof body.note === 'string' || body.note === null)
          version.note = typeof body.note === 'string' ? body.note.trim() || null : null;
        audit(engine, by, 'config.draft.save', 'config_version', version.id, null);
        return ok(version);
      }),
    ),
    http.delete(
      admin('/config/versions/:id'),
      mutation((ctx) => {
        const by = actor(ctx, 'config.draft');
        const reason = assertReason(query(ctx).get('reason'));
        const version = configVersion(engine, ctx.params.id);
        if (version.status !== 'DRAFT') throw new MockError(409, 'CONFLICT', 'Only a draft can be deleted');
        const s = adminState(engine);
        s.config = s.config.filter((v) => v.id !== version.id);
        audit(engine, by, 'config.draft.delete', 'config_version', version.id, reason);
        return noContent();
      }),
    ),
    http.post(
      admin('/config/versions/:id/publish'),
      command((ctx, body) => {
        const by = actor(ctx, 'config.publish');
        const reason = assertReason(body.reason);
        const version = configVersion(engine, ctx.params.id);
        if (version.status !== 'DRAFT') throw new MockError(409, 'CONFLICT', 'Only a draft can be published');
        if (!validateConfig(version.content))
          throw new MockError(422, 'VALIDATION_ERROR', 'Config does not match the schema');
        activateConfig(engine, version);
        audit(engine, by, 'config.publish', 'config_version', version.id, reason);
        return configRow(version);
      }),
    ),
    http.post(
      admin('/config/versions/:id/rollback'),
      command((ctx, body) => {
        const by = actor(ctx, 'config.rollback');
        const reason = assertReason(body.reason);
        const version = configVersion(engine, ctx.params.id);
        if (version.status !== 'SUPERSEDED')
          throw new MockError(409, 'CONFLICT', 'Only a superseded version can be restored');
        activateConfig(engine, version);
        audit(engine, by, 'config.rollback', 'config_version', version.id, reason);
        return configRow(version);
      }),
    ),

    /* ───────────── catalog, flags ───────────── */
    http.get(
      admin('/catalog'),
      route((ctx) => {
        reader(ctx);
        return ok(catalogView());
      }),
    ),
    http.get(
      admin('/feature-flags'),
      route((ctx) => {
        reader(ctx);
        return ok(Object.keys(engine.state.featureFlags).map((key) => flagRow(engine, key)));
      }),
    ),
    http.patch(
      admin('/feature-flags/:key'),
      mutation((ctx, body) => {
        const by = actor(ctx, 'flags.toggle');
        const reason = assertReason(body.reason);
        const key = String(ctx.params.key);
        if (!(key in engine.state.featureFlags))
          throw new MockError(404, 'NOT_FOUND', 'Unknown feature flag');
        if (typeof body.enabled !== 'boolean')
          throw new MockError(422, 'VALIDATION_ERROR', '`enabled` must be a boolean');
        setFlag(engine, key, body.enabled);
        audit(
          engine,
          by,
          body.enabled ? 'feature_flag.enable' : 'feature_flag.disable',
          'feature_flag',
          key,
          reason,
        );
        return ok(flagRow(engine, key));
      }),
    ),

    /* ───────────── world overrides ───────────── */
    http.get(
      admin('/world/closures'),
      route((ctx) => {
        reader(ctx);
        const now = engine.now();
        return ok(adminWorld(engine).closures.filter((c) => Date.parse(c.endsAt) > now));
      }),
    ),
    http.post(
      admin('/world/closures'),
      command((ctx, body) => {
        const by = actor(ctx, 'world.edit');
        const parsed = parse(AdminClosureBody, body);
        const row = createClosure(engine, by, parsed);
        const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
        audit(engine, by, 'world.closure.create', 'closure', row.id, reason ?? parsed.reasonKey);
        return row;
      }),
    ),
    http.delete(
      admin('/world/closures/:id'),
      mutation((ctx) => {
        const by = actor(ctx, 'world.edit');
        const reason = assertReason(query(ctx).get('reason'));
        const w = adminWorld(engine);
        if (!w.closures.some((c) => c.id === ctx.params.id))
          throw new MockError(404, 'NOT_FOUND', 'Closure not found');
        w.closures = w.closures.filter((c) => c.id !== ctx.params.id);
        broadcastWorld(engine);
        audit(engine, by, 'world.closure.delete', 'closure', String(ctx.params.id), reason);
        return noContent();
      }),
    ),
    http.get(
      admin('/world/weather-override'),
      route((ctx) => {
        reader(ctx);
        const current = adminWorld(engine).weatherOverride;
        return ok(current && Date.parse(current.endsAt) > engine.now() ? current : null);
      }),
    ),
    http.put(
      admin('/world/weather-override'),
      mutation((ctx, body) => {
        const by = actor(ctx, 'world.edit');
        const reason = assertReason(body.reason);
        const code = parse(WeatherCode, body.code);
        const seconds = Number(body.durationSeconds);
        if (!Number.isInteger(seconds) || seconds < 60)
          throw new MockError(422, 'VALIDATION_ERROR', '`durationSeconds` must be an integer ≥ 60');
        const now = engine.now();
        const row = { code, startedAt: iso(now), endsAt: iso(now + seconds * 1000), createdBy: by, reason };
        adminWorld(engine).weatherOverride = row;
        broadcastWorld(engine);
        audit(engine, by, 'world.weather_override.set', 'weather', code, reason);
        return ok(row);
      }),
    ),
    http.delete(
      admin('/world/weather-override'),
      mutation((ctx) => {
        const by = actor(ctx, 'world.edit');
        const reason = assertReason(query(ctx).get('reason'));
        adminWorld(engine).weatherOverride = null;
        broadcastWorld(engine);
        audit(engine, by, 'world.weather_override.clear', 'weather', null, reason);
        return noContent();
      }),
    ),

    /* ───────────── geodata releases ───────────── */
    http.get(
      admin('/geodata/releases'),
      route((ctx) => {
        reader(ctx);
        return ok([...adminState(engine).geodata].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      }),
    ),
    http.post(
      admin('/geodata/releases/:id/publish'),
      command((ctx, body) => {
        const by = actor(ctx, 'geodata.publish');
        const reason = assertReason(body.reason);
        const s = adminState(engine);
        const release = s.geodata.find((r) => r.id === ctx.params.id);
        if (!release) throw new MockError(404, 'NOT_FOUND', 'Release not found');
        if (release.status !== 'READY' && release.status !== 'ROLLED_BACK')
          throw new MockError(409, 'CONFLICT', 'Only a READY or ROLLED_BACK release can be published');
        for (const r of s.geodata) if (r.status === 'PUBLISHED') r.status = 'ROLLED_BACK';
        release.status = 'PUBLISHED';
        release.publishedAt = iso(engine.now());
        audit(engine, by, 'geodata.publish', 'geodata_release', release.id, reason);
        return release;
      }),
    ),
    http.post(
      admin('/geodata/releases/:id/rollback'),
      command((ctx, body) => {
        const by = actor(ctx, 'geodata.publish');
        const reason = assertReason(body.reason);
        const s = adminState(engine);
        const release = s.geodata.find((r) => r.id === ctx.params.id);
        if (!release) throw new MockError(404, 'NOT_FOUND', 'Release not found');
        if (release.status !== 'PUBLISHED')
          throw new MockError(409, 'CONFLICT', 'Only the published release can be rolled back');
        // The most recently published earlier release takes over, so the game never runs without geodata.
        const previous = s.geodata
          .filter((r) => r.id !== release.id && r.publishedAt)
          .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))[0];
        if (!previous) throw new MockError(409, 'CONFLICT', 'No earlier release to fall back to');
        release.status = 'ROLLED_BACK';
        previous.status = 'PUBLISHED';
        audit(engine, by, 'geodata.rollback', 'geodata_release', release.id, reason);
        return release;
      }),
    ),

    /* ───────────── referrals / purchases review ───────────── */
    http.get(
      admin('/referrals'),
      route((ctx) => {
        reader(ctx);
        const sp = query(ctx);
        return paged(
          kit,
          adminState(engine).referrals.filter((r) => !sp.get('status') || r.status === sp.get('status')),
          sp,
        );
      }),
    ),
    ...(
      [
        ['approve', 'ACTIVATED', 'referral.approve'],
        ['invalidate', 'INVALIDATED', 'referral.invalidate'],
      ] as const
    ).map(([path, status, action]) =>
      http.post(
        admin(`/referrals/:id/${path}`),
        command((ctx, body) => {
          const by = actor(ctx, 'referrals.review');
          const reason = assertReason(body.reason);
          const row = adminState(engine).referrals.find((r) => r.id === ctx.params.id);
          if (!row) throw new MockError(404, 'NOT_FOUND', 'Referral not found');
          if (row.status === 'REWARDED' || row.status === status)
            throw new MockError(409, 'CONFLICT', 'Referral cannot change to this status');
          row.status = status;
          row.reviewedAt = iso(engine.now());
          row.reviewNote = reason;
          audit(engine, by, action, 'referral', row.id, reason);
          return row;
        }),
      ),
    ),
    http.get(
      admin('/purchases'),
      route((ctx) => {
        reader(ctx);
        const sp = query(ctx);
        const q = (sp.get('q') ?? '').trim().toLowerCase();
        const rows = adminState(engine)
          .purchases.filter((p) => !sp.get('status') || p.status === sp.get('status'))
          .filter((p) => !q || includes(p.email, q) || includes(p.id, q) || includes(p.providerRef ?? '', q))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return paged(kit, rows, sp);
      }),
    ),
    http.post(
      admin('/purchases/:id/refund-review'),
      command((ctx, body) => {
        const by = actor(ctx, 'purchases.refundReview');
        const reason = assertReason(body.reason);
        const row = adminState(engine).purchases.find((p) => p.id === ctx.params.id);
        if (!row) throw new MockError(404, 'NOT_FOUND', 'Purchase not found');
        if (row.refunded || row.refundReview)
          throw new MockError(409, 'CONFLICT', 'Purchase is already refunded or under review');
        row.refundReview = { reason, by, at: iso(engine.now()) };
        audit(engine, by, 'purchase.refund_review', 'purchase', row.id, reason);
        return row;
      }),
    ),

    /* ───────────── audit ───────────── */
    http.get(
      admin('/audit'),
      route((ctx) => {
        reader(ctx);
        const sp = query(ctx);
        const has = (key: string, value: string | null) => {
          const wanted = (sp.get(key) ?? '').trim().toLowerCase();
          return !wanted || includes(value ?? '', wanted);
        };
        const rows = adminState(engine).audit.filter(
          (a) =>
            has('actor', a.actor) &&
            has('action', a.action) &&
            has('targetId', a.targetId) &&
            (!sp.get('targetType') || a.targetType === sp.get('targetType')),
        );
        return paged(kit, rows, sp);
      }),
    ),
  ];
  return handlers;
};

function configRow(v: ConfigVersion): AdminConfigVersionRow {
  return {
    id: v.id,
    version: v.version,
    status: v.status,
    createdAt: v.createdAt,
    publishedAt: v.publishedAt,
    author: v.author,
    note: v.note,
  };
}
function configVersion(engine: MockEngine, id: unknown) {
  const version = adminState(engine).config.find((v) => v.id === id);
  if (!version) throw new MockError(404, 'NOT_FOUND', 'Config version not found');
  return version;
}
function flagRow(engine: MockEngine, key: string) {
  return {
    key,
    enabled: engine.state.featureFlags[key] === true,
    description: FLAG_DESCRIPTIONS[key] ?? null,
    updatedAt: adminState(engine).flagUpdates[key] ?? iso(Date.parse('2026-09-01T08:00:00.000Z')),
  };
}
/** BullMQ-like counters derived from the simulated schedule (delayed = future actions, failed = parked ones). */
function queueStats(engine: MockEngine) {
  const actions = allActionRows(engine);
  const events = Object.values(engine.state.careers).reduce((n, c) => n + c.seq, 0);
  const count = (status: string) => actions.filter((a) => a.status === status).length;
  return [
    {
      name: 'scheduled-actions',
      waiting: count('QUEUED'),
      active: 0,
      delayed: count('PENDING'),
      failed: count('FAILED'),
      completed: events,
    },
    { name: 'outbox', waiting: 0, active: 0, delayed: 0, failed: 0, completed: events },
    {
      name: 'mail',
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: Object.keys(engine.state.users).length,
    },
    {
      name: 'coverage',
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: Object.keys(engine.state.careers).length,
    },
  ];
}
