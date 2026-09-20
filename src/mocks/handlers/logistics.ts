import { http } from 'msw';
import { MockError } from '../engine';
import { logisticsOf, type WorkKind } from '../domains/logistics';
import type { DomainHandlers } from './kit';

const REPAIR_KINDS: WorkKind[] = ['REPAIR', 'FREE_EMERGENCY_REPAIR'];

/** REST handlers of the `logistics` area: inventory + maintenance (ROUTES.md "Inventory & maintenance"). */
export const logisticsHandlers: DomainHandlers = (kit) => {
  const { url, ok, route, command, careerOf, C, engine } = kit;
  const domain = () => logisticsOf(engine);
  return [
    http.get(
      url(`${C}/inventory`),
      route((ctx) => {
        const career = careerOf(ctx);
        const overview = domain().inventoryOverview(career);
        engine.save(); // starter stock lines are created lazily
        return ok(overview);
      }),
    ),
    http.get(
      url(`${C}/inventory/items`),
      route((ctx) => ok(domain().itemTypes(careerOf(ctx)))),
    ),
    http.post(
      url(`${C}/inventory/orders`),
      command((_ctx, body, career) => domain().placeOrder(career, body), 201),
    ),
    http.get(
      url(`${C}/maintenance`),
      route((ctx) => ok(domain().maintenanceOverview(careerOf(ctx)))),
    ),
    http.post(
      url(`${C}/vehicles/:vehicleId/maintenance`),
      command((ctx, body, career) => {
        if (body.kind !== undefined && body.kind !== 'SERVICE')
          throw new MockError(422, 'VALIDATION_ERROR', 'Use /repair for repairs', { fields: ['kind'] });
        return domain().startWork(career, String(ctx.params.vehicleId), 'SERVICE');
      }, 201),
    ),
    http.post(
      url(`${C}/vehicles/:vehicleId/repair`),
      command((ctx, body, career) => {
        const kind = (body.kind ?? 'REPAIR') as WorkKind;
        if (!REPAIR_KINDS.includes(kind))
          throw new MockError(422, 'VALIDATION_ERROR', 'Unknown repair kind', { fields: ['kind'] });
        return domain().startWork(career, String(ctx.params.vehicleId), kind);
      }, 201),
    ),
    http.get(
      url(`${C}/vehicles/:vehicleId/history`),
      route((ctx) => ok(domain().history(careerOf(ctx), String(ctx.params.vehicleId)))),
    ),
  ];
};
