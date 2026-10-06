import { http } from 'msw';
import { allianceOperationsOf } from '../domains/alliance-operations';
import type { DomainHandlers } from './kit';

/** REST handlers of the alliance operations. `…` = /careers/:careerId/alliance. */
export const allianceOperationsHandlers: DomainHandlers = ({
  engine,
  url,
  ok,
  route,
  command,
  careerOf,
  query,
  C,
}) => {
  const api = () => allianceOperationsOf(engine);
  const A = `${C}/alliance`;
  return [
    http.get(
      url(`${A}/operation`),
      route((ctx) => ok(api().current(careerOf(ctx)))),
    ),
    http.get(
      url(`${A}/operations`),
      route((ctx) => {
        const q = query(ctx);
        const page = api().history(careerOf(ctx), {
          cursor: q.get('cursor') ?? undefined,
          limit: q.get('limit') ? Number(q.get('limit')) : undefined,
        });
        return ok(page.data, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } });
      }),
    ),
    http.post(
      url(`${A}/operation/join`),
      command((_ctx, _body, career) => api().join(career)),
    ),
    http.post(
      url(`${A}/operation/decline`),
      command((_ctx, _body, career) => api().decline(career)),
    ),
  ];
};
