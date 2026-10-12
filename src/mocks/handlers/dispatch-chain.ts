import { http } from 'msw';
import { MockError } from '../engine';
import { chainOf } from '../domains/dispatch-chain';
import type { DomainHandlers } from './kit';

/** REST handlers of mission chaining (ROUTES.md "dispatch": ★POST /vehicles/:vehicleId/chain, POST …/chain/cancel). */
export const dispatchChainHandlers: DomainHandlers = (kit) => {
  const { url, route, command, ok, careerOf, C, engine } = kit;
  return [
    /* ★ ONE action for a busy vehicle: redirect from the way home when every condition holds, else the queue slot */
    http.post(
      url(`${C}/vehicles/:vehicleId/chain`),
      command((ctx, body, career) => {
        if (typeof body.incidentId !== 'string' || body.incidentId === '')
          throw new MockError(422, 'VALIDATION_ERROR', 'incidentId is required', { fields: ['incidentId'] });
        if (body.queueOnly !== undefined && typeof body.queueOnly !== 'boolean')
          throw new MockError(422, 'VALIDATION_ERROR', 'queueOnly must be a boolean', {
            fields: ['queueOnly'],
          });
        return chainOf(engine).chain(career, String(ctx.params.vehicleId), body.incidentId, {
          queueOnly: body.queueOnly === true,
        });
      }, 201),
    ),
    /* explicit, idempotent cancel of the queue slot (no Idempotency-Key needed) */
    http.post(
      url(`${C}/vehicles/:vehicleId/chain/cancel`),
      route((ctx) => ok(chainOf(engine).cancelQueue(careerOf(ctx), String(ctx.params.vehicleId)))),
    ),
  ];
};
