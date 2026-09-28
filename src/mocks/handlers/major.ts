import { http } from 'msw';
import { majorOf } from '../domains/major';
import type { DomainHandlers } from './kit';

/**
 * REST handlers of the major incidents ("maxi-emergenze", ROUTES.md "Major incidents"): thin wrappers over the domain
 * (src/mocks/domains/major.ts). Literal segments first — MSW, like Express, matches in registration order.
 */
export const majorHandlers: DomainHandlers = ({ engine, url, ok, route, command, careerOf, query, C }) => {
  const major = () => majorOf(engine);
  const base = `${C}/major-incidents`;
  return [
    http.get(
      url(`${base}/current`),
      route((ctx) => ok(major().current(careerOf(ctx)))),
    ),
    http.get(
      url(`${base}/trophies`),
      route((ctx) => ok(major().trophies(careerOf(ctx)))),
    ),
    http.get(
      url(base),
      route((ctx) => {
        const limit = Math.min(50, Math.max(1, Number(query(ctx).get('limit') ?? 20) || 20));
        return ok(major().list(careerOf(ctx), limit));
      }),
    ),
    http.get(
      url(`${base}/:majorId/reinforcements/quote`),
      route((ctx) => ok(major().quote(careerOf(ctx), String(ctx.params.majorId)))),
    ),
    http.post(
      url(`${base}/:majorId/reinforcements`),
      command((ctx, _body, career) => major().requestReinforcements(career, String(ctx.params.majorId)), 201),
    ),
    http.get(
      url(`${base}/:majorId`),
      route((ctx) => ok(major().detail(careerOf(ctx), String(ctx.params.majorId)))),
    ),
  ];
};
