import { http } from 'msw';
import { monetizationApiOf } from '../domains/monetization';
import type { DomainHandlers } from './kit';

/**
 * REST handlers of the business area (ROUTES.md § Monetization + `GET /public/invite/:code`).
 * `POST /webhooks/stripe` is the simulated provider callback used by the in-app "simulated checkout" page: the mock
 * accepts `{ type: 'checkout.session.completed' | 'checkout.session.expired', data: { purchaseId } }` without a signature.
 */
export const monetizationHandlers: DomainHandlers = ({
  engine,
  url,
  ok,
  route,
  command,
  careerOf,
  query,
  C,
}) => {
  const api = () => monetizationApiOf(engine);
  return [
    http.get(
      url(`${C}/shop/packages`),
      route((ctx) => ok(api().packages(careerOf(ctx)))),
    ),
    http.post(
      url(`${C}/shop/checkout`),
      command((_ctx, body, career) => api().checkout(career, body)),
    ),
    http.get(
      url(`${C}/shop/purchases`),
      route((ctx) => ok(api().purchases(careerOf(ctx)))),
    ),
    http.post(
      url('/webhooks/stripe'),
      route((_ctx, body) => ok(api().webhook(body))),
    ),
    http.get(
      url(`${C}/speedups/quote`),
      route((ctx) => {
        const q = query(ctx);
        return ok(api().speedupQuote(careerOf(ctx), q.get('target'), q.get('targetId')));
      }),
    ),
    http.post(
      url(`${C}/speedups`),
      command((_ctx, body, career) => api().speedup(career, body.target, body.targetId)),
    ),
    http.get(
      url(`${C}/ads/status`),
      route((ctx) => ok(api().adsStatus(careerOf(ctx)))),
    ),
    http.post(
      url(`${C}/ads/start`),
      command((_ctx, _body, career) => api().adStart(career)),
    ),
    http.post(
      url(`${C}/ads/complete`),
      command((_ctx, body, career) => api().adComplete(career, body)),
    ),
    http.get(
      url(`${C}/referrals`),
      route((ctx) => ok(api().referrals(careerOf(ctx)))),
    ),
    http.get(
      url('/public/invite/:code'),
      route((ctx) => ok(api().publicInvite(String(ctx.params.code)))),
    ),
  ];
};
