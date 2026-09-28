import { http } from 'msw';
import { MockError } from '../engine';
import {
  acquireFacility,
  listSites,
  promoteFacility,
  transferVehicle,
  type SiteKind,
} from '../domains/facilities';
import type { DomainHandlers } from './kit';

/** REST handlers of the `facilities` area: candidate sites, acquisition, promotion, vehicle transfer (ROUTES.md §facilities). */
export const facilitiesHandlers: DomainHandlers = ({
  engine,
  url,
  ok,
  route,
  command,
  careerOf,
  query,
  C,
}) => [
  http.get(
    url(`${C}/sites`),
    route((ctx) => {
      const raw = query(ctx).get('bbox');
      const parts = raw ? raw.split(',').map(Number) : null;
      if (parts && (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))))
        throw new MockError(422, 'VALIDATION_ERROR', 'bbox must be w,s,e,n');
      const bbox = parts ? (parts as [number, number, number, number]) : null;
      const kind = query(ctx).get('kind') ?? 'ALL';
      if (!['ALL', 'STANDARD', 'NAUTICAL'].includes(kind))
        throw new MockError(422, 'VALIDATION_ERROR', 'kind must be ALL, STANDARD or NAUTICAL');
      return ok(listSites(engine, careerOf(ctx), bbox, query(ctx).get('family'), kind as SiteKind));
    }),
  ),
  http.post(
    url(`${C}/facilities`),
    command((_ctx, body, career) => acquireFacility(engine, career, body), 201),
  ),
  http.post(
    url(`${C}/facilities/:id/promote`),
    command((ctx, _body, career) => promoteFacility(engine, career, String(ctx.params.id))),
  ),
  http.post(
    url(`${C}/vehicles/:id/transfer`),
    command((ctx, body, career) => transferVehicle(engine, career, String(ctx.params.id), body.facilityId)),
  ),
];
