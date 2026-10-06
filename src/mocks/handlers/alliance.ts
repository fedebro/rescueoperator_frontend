import { http } from 'msw';
import { MockError } from '../engine';
import { allianceApiOf } from '../domains/alliance';
import { allianceProgressOf } from '../domains/alliance-progress';
import type { DomainHandlers } from './kit';

/**
 * REST handlers of the alliance system (routes: analisi/note-agenti/alleanze-backend.md §Phase 1a; `…` = /careers/:careerId/alliance).
 * Phase 1: alliance, members, roles, invites, join requests, search, Director card, profile, log, sync.
 */
export const allianceHandlers: DomainHandlers = ({
  engine,
  url,
  ok,
  route,
  command,
  authed,
  careerOf,
  noContent,
  query,
  C,
}) => {
  const api = () => allianceApiOf(engine);
  const A = `${C}/alliance`;
  const paged = <T>(page: { data: T[]; nextCursor: string | null; hasMore: boolean }) =>
    ok(page.data, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } });
  return [
    /* ── bearer routes ── */
    // Before `/alliances/:allianceId`: the literal path would otherwise be read as an alliance id.
    http.get(
      url('/alliances/ranking'),
      route((ctx) => {
        const a = authed(ctx);
        const career = engine.state.careers[a.user.activeCareerId ?? ''];
        if (!career) throw new MockError(403, 'NOT_ALLIANCE_MEMBER', 'No active career');
        return ok(allianceProgressOf(engine).ranking(career));
      }),
    ),
    http.get(
      url('/alliances'),
      route((ctx) => {
        const a = authed(ctx);
        const career = engine.state.careers[a.user.activeCareerId ?? ''];
        if (!career) return ok([], { meta: { nextCursor: null, hasMore: false } });
        const q = query(ctx);
        return paged(
          api().search(career, {
            q: q.get('q') ?? undefined,
            language: q.get('language') ?? undefined,
            joinPolicy: q.get('joinPolicy') ?? undefined,
            hasSlots: q.get('hasSlots') === 'true',
            cursor: q.get('cursor') ?? undefined,
            limit: q.get('limit') ? Number(q.get('limit')) : undefined,
          }),
        );
      }),
    ),
    http.get(
      url('/alliances/:allianceId'),
      route((ctx) => {
        const a = authed(ctx);
        const career = engine.state.careers[a.user.activeCareerId ?? ''];
        if (!career) return ok(null);
        return ok(api().card(career, String(ctx.params.allianceId)));
      }),
    ),
    http.get(
      url('/public/alliance-invite/:code'),
      route((ctx) => ok(api().publicInvite(String(ctx.params.code)))),
    ),
    http.get(
      url('/directors/:careerId'),
      route((ctx) => {
        const a = authed(ctx);
        const viewer = engine.state.careers[a.user.activeCareerId ?? ''];
        if (!viewer) return ok(null);
        return ok(api().directorCard(viewer, String(ctx.params.careerId)));
      }),
    ),
    // Mock-only: Directors by name (direct invites). The backend has no search yet — flagged in the notes.
    http.get(
      url('/directors'),
      route((ctx) => {
        const a = authed(ctx);
        const viewer = engine.state.careers[a.user.activeCareerId ?? ''];
        if (!viewer) return ok([]);
        return ok(api().searchDirectors(viewer, query(ctx).get('q') ?? ''));
      }),
    ),
    http.get(
      url('/me/profile'),
      route((ctx) => ok(api().profile(authed(ctx).user.id))),
    ),
    http.patch(
      url('/me/profile'),
      route((ctx, body) => ok(api().updateProfile(authed(ctx).user.id, body))),
    ),

    /* ── my alliance ── */
    http.get(
      url(A),
      route((ctx) => ok(api().home(careerOf(ctx)))),
    ),
    http.get(
      url(`${A}/sync`),
      route((ctx) => {
        const since = query(ctx).get('since');
        return ok(api().sync(careerOf(ctx), since === null ? undefined : Number(since)));
      }),
    ),
    http.post(
      url(A),
      command((_ctx, body, career) => api().found(career, body), 201),
    ),
    http.post(
      url(`${A}/join`),
      command((_ctx, body, career) => api().join(career, body)),
    ),
    http.post(
      url(`${A}/leave`),
      command((_ctx, _body, career) => api().leave(career)),
    ),
    http.patch(
      url(`${A}/settings`),
      route((ctx, body) => ok(api().updateSettings(careerOf(ctx), body))),
    ),
    http.post(
      url(`${A}/transfer`),
      command((_ctx, body, career) => api().transfer(career, String(body.memberId))),
    ),
    http.post(
      url(`${A}/disband/cancel`),
      command((_ctx, _body, career) => api().cancelDisband(career)),
    ),
    http.post(
      url(`${A}/disband`),
      command((_ctx, _body, career) => api().disband(career)),
    ),

    /* ── members ── */
    http.get(
      url(`${A}/members`),
      route((ctx) => ok(api().members(careerOf(ctx), query(ctx).get('status') ?? undefined))),
    ),
    http.post(
      url(`${A}/members/:memberId/role`),
      command((ctx, body, career) => api().setRole(career, String(ctx.params.memberId), body.role)),
    ),
    http.post(
      url(`${A}/members/:memberId/remove`),
      command((ctx, body, career) => {
        api().removeMember(career, String(ctx.params.memberId), body.ban === true);
        return null;
      }),
    ),
    http.post(
      url(`${A}/members/:memberId/mute`),
      command((ctx, body, career) => api().mute(career, String(ctx.params.memberId), body.duration)),
    ),
    http.post(
      url(`${A}/members/:memberId/unmute`),
      command((ctx, _body, career) => api().unmute(career, String(ctx.params.memberId))),
    ),
    http.get(
      url(`${A}/log`),
      route((ctx) => {
        const q = query(ctx);
        return paged(
          api().log(
            careerOf(ctx),
            q.get('cursor') ?? undefined,
            q.get('limit') ? Number(q.get('limit')) : undefined,
          ),
        );
      }),
    ),

    /* ── invites & join requests ── */
    http.get(
      url(`${A}/invites`),
      route((ctx) => ok(api().invites(careerOf(ctx)))),
    ),
    http.post(
      url(`${A}/invites`),
      command(
        (_ctx, body, career) =>
          api().createInvite(
            career,
            typeof body.targetCareerId === 'string' ? body.targetCareerId : undefined,
          ),
        201,
      ),
    ),
    http.delete(
      url(`${A}/invites/:inviteId`),
      route((ctx) => {
        api().deleteInvite(careerOf(ctx), String(ctx.params.inviteId));
        return noContent();
      }),
    ),
    http.get(
      url(`${A}/join-requests`),
      route((ctx) => ok(api().joinRequests(careerOf(ctx)))),
    ),
    http.post(
      url(`${A}/join-requests/:requestId/decide`),
      command((ctx, body, career) => api().decide(career, String(ctx.params.requestId), body.decision)),
    ),
    http.delete(
      url(`${A}/join-requests/:requestId`),
      route((ctx) => {
        api().withdrawRequest(careerOf(ctx), String(ctx.params.requestId));
        return noContent();
      }),
    ),
  ];
};
