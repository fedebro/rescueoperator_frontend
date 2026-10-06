import { http } from 'msw';
import { allianceProgressOf } from '../domains/alliance-progress';
import type { DomainHandlers } from './kit';

/** REST handlers of the progression (objectives, XP ledger, weekly ranking). `…` = /careers/:careerId/alliance. */
export const allianceProgressHandlers: DomainHandlers = ({ engine, url, ok, route, careerOf, query, C }) => {
  const api = () => allianceProgressOf(engine);
  const A = `${C}/alliance`;
  return [
    http.get(
      url(`${A}/objectives`),
      route((ctx) => ok(api().objectives(careerOf(ctx)))),
    ),
    http.get(
      url(`${A}/xp`),
      route((ctx) => {
        const q = query(ctx);
        const page = api().xp(careerOf(ctx), {
          cursor: q.get('cursor') ?? undefined,
          limit: q.get('limit') ? Number(q.get('limit')) : undefined,
        });
        return ok(page.data, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } });
      }),
    ),
  ];
};
