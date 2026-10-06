import { http } from 'msw';
import { allianceAidOf } from '../domains/alliance-aid';
import type { DomainHandlers } from './kit';

/** REST handlers of mutual aid (backend notes §1a routes; `…` = /careers/:careerId/alliance). */
export const allianceAidHandlers: DomainHandlers = ({
  engine,
  url,
  ok,
  route,
  command,
  careerOf,
  query,
  C,
}) => {
  const api = () => allianceAidOf(engine);
  const A = `${C}/alliance`;
  const paged = <T>(page: { data: T[]; nextCursor: string | null; hasMore: boolean }) =>
    ok(page.data, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } });
  return [
    http.get(
      url(`${A}/aid-requests`),
      route((ctx) => {
        const q = query(ctx);
        return paged(
          api().listRequests(careerOf(ctx), {
            status: q.get('status') ?? undefined,
            cursor: q.get('cursor') ?? undefined,
            limit: q.get('limit') ? Number(q.get('limit')) : undefined,
          }),
        );
      }),
    ),
    http.get(
      url(`${A}/aid-requests/:requestId/column-options`),
      route((ctx) => ok(api().columnOptions(careerOf(ctx), String(ctx.params.requestId)))),
    ),
    http.get(
      url(`${A}/aid-requests/:requestId`),
      route((ctx) => ok(api().getRequest(careerOf(ctx), String(ctx.params.requestId)))),
    ),
    http.post(
      url(`${A}/aid-requests/:requestId/cancel`),
      command((ctx, _body, career) => api().cancelRequest(career, String(ctx.params.requestId))),
    ),
    http.post(
      url(`${A}/aid-requests/:requestId/columns`),
      command(
        (ctx, body, career) => api().sendColumn(career, String(ctx.params.requestId), body.vehicleIds),
        201,
      ),
    ),
    http.get(
      url(`${A}/aid-columns`),
      route((ctx) => {
        const q = query(ctx);
        return paged(
          api().listColumns(careerOf(ctx), {
            role: q.get('role') ?? undefined,
            active: q.get('active') === 'true' || q.get('active') === '1',
            cursor: q.get('cursor') ?? undefined,
            limit: q.get('limit') ? Number(q.get('limit')) : undefined,
          }),
        );
      }),
    ),
    http.post(
      url(`${A}/aid-columns/:columnId/recall`),
      command((ctx, _body, career) => api().recall(career, String(ctx.params.columnId))),
    ),
    http.post(
      url(`${C}/incidents/:incidentId/aid-request`),
      command((ctx, _body, career) => api().createRequest(career, String(ctx.params.incidentId), null), 201),
    ),
    http.post(
      url(`${C}/major-incidents/:majorId/aid-request`),
      command((ctx, _body, career) => {
        const majorId = String(ctx.params.majorId);
        const main =
          career.incidents.find((i) => i.major?.id === majorId && i.major.role === 'MAIN') ??
          career.incidents.find((i) => i.major?.id === majorId);
        if (!main) throw new Error('Major not found');
        return api().createRequest(career, main.id, majorId);
      }, 201),
    ),
  ];
};
