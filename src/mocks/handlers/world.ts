import { http } from 'msw';
import { worldApiOf } from '../domains/world';
import type { DomainHandlers } from './kit';

/** REST handlers of the `world` area: world context, coverage, stipend, milestones (all read-only). */
export const worldHandlers: DomainHandlers = ({ engine, url, ok, route, careerOf, C }) => {
  const world = () => worldApiOf(engine);
  return [
    http.get(
      url(`${C}/world`),
      route((ctx) => ok(world().world(careerOf(ctx)))),
    ),
    http.get(
      url(`${C}/coverage`),
      route((ctx) => ok(world().coverage(careerOf(ctx)))),
    ),
    http.get(
      url(`${C}/economy/stipend`),
      route((ctx) => ok(world().stipend(careerOf(ctx)))),
    ),
    http.get(
      url(`${C}/progression/milestones`),
      route((ctx) => {
        const career = careerOf(ctx);
        const list = world().milestones(career);
        engine.save();
        return ok(list);
      }),
    ),
  ];
};
