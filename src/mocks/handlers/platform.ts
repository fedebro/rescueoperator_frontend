import { http } from 'msw';
import {
  ingestAnalytics,
  listNotifications,
  readAllNotifications,
  readNotification,
} from '../domains/platform';
import type { DomainHandlers } from './kit';

/** REST handlers of the `platform` area: notifications centre + product analytics ingestion. */
export const platformHandlers: DomainHandlers = ({ engine, url, ok, route, careerOf, noContent, C }) => [
  http.get(
    url(`${C}/notifications`),
    route((ctx) => ok(listNotifications(careerOf(ctx)))),
  ),
  // `read-all` is registered before `:id/read` on purpose: both are two segments long only by accident of naming.
  http.post(
    url(`${C}/notifications/read-all`),
    route((ctx) => {
      readAllNotifications(engine, careerOf(ctx));
      return noContent();
    }),
  ),
  http.post(
    url(`${C}/notifications/:notificationId/read`),
    route((ctx) => {
      readNotification(engine, careerOf(ctx), String(ctx.params.notificationId));
      return noContent();
    }),
  ),
  http.post(
    url('/analytics/events'),
    route((ctx, body) => {
      // Optional auth: anonymous funnel events are accepted, a valid bearer attributes the batch to the user id.
      let userId: string | null = null;
      const header = ctx.request.headers.get('authorization');
      if (header) {
        try {
          userId = engine.authenticate(header).user.id;
        } catch {
          userId = null;
        }
      }
      ingestAnalytics(engine, body, userId);
      return noContent();
    }),
  ),
];
