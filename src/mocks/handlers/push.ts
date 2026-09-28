import { http } from 'msw';
import {
  pushConfig,
  pushState,
  sendTestPush,
  subscribePush,
  unsubscribePush,
  updatePushPreferences,
} from '../domains/push';
import type { DomainHandlers } from './kit';

/** REST handlers of the `push` area (contracts/push.ts, ROUTES.md "Push notifications"). */
export const pushHandlers: DomainHandlers = ({
  engine,
  url,
  ok,
  route,
  command,
  authed,
  careerOf,
  noContent,
  C,
}) => [
  http.get(
    url('/push/config'),
    route((ctx) => {
      authed(ctx);
      return ok(pushConfig(engine));
    }),
  ),
  http.post(
    url(`${C}/push/subscriptions`),
    command((_ctx, body, career) => subscribePush(engine, career, body), 201),
  ),
  http.delete(
    url(`${C}/push/subscriptions`),
    route(async (ctx) => {
      const career = careerOf(ctx);
      // The kit only reads bodies of POST/PUT/PATCH: this DELETE carries `{ endpoint }`.
      const body = ((await ctx.request
        .clone()
        .json()
        .catch(() => ({}))) ?? {}) as Record<string, unknown>;
      unsubscribePush(engine, career, body);
      return noContent();
    }),
  ),
  http.get(
    url(`${C}/push/preferences`),
    route((ctx) => ok(pushState(careerOf(ctx)).preferences)),
  ),
  http.put(
    url(`${C}/push/preferences`),
    route((ctx, body) => ok(updatePushPreferences(engine, careerOf(ctx), body))),
  ),
  http.post(
    url(`${C}/push/test`),
    route((ctx) => ok(sendTestPush(engine, careerOf(ctx)), { status: 202 })),
  ),
];
