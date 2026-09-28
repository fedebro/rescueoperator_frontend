import { http } from 'msw';
import { personnelDomain } from '../domains/personnel';
import type { DomainHandlers } from './kit';

/**
 * REST handlers of the `personnel` area (ROUTES.md §personnel). ★ routes are idempotent commands (`kit.command`);
 * the others are plain POST/PATCH/PUT exactly as the client wrappers (`personnelApi`) call them.
 */
export const personnelHandlers: DomainHandlers = ({
  engine,
  url,
  ok,
  route,
  command,
  careerOf,
  noContent,
  C,
}) => {
  const domain = () => personnelDomain(engine);
  const id = (value: string | readonly string[] | undefined) => String(value);
  /** Non-★ mutations: run, persist, answer. */
  const mutate = <T>(fn: (...args: Parameters<Parameters<typeof route>[0]>) => T) =>
    route((ctx, body) => {
      const result = fn(ctx, body);
      engine.save();
      return ok(result);
    });
  return [
    http.get(
      url(`${C}/personnel`),
      route((ctx) => ok(domain().list(careerOf(ctx)))),
    ),
    http.post(
      url(`${C}/personnel/hire`),
      command((_ctx, body, career) => domain().quickHire(career, body), 201),
    ),
    // Literal segment before `:personnelId` (MSW matches in order), like the backend's route registry.
    http.get(
      url(`${C}/personnel/vehicle-crew-gaps`),
      route((ctx) => ok(domain().vehicleCrewGaps(careerOf(ctx)))),
    ),
    http.get(
      url(`${C}/personnel/:personnelId`),
      route((ctx) => ok(domain().detail(careerOf(ctx), id(ctx.params.personnelId)))),
    ),
    http.post(
      url(`${C}/personnel/:personnelId/dismiss`),
      route((ctx) => {
        domain().dismiss(careerOf(ctx), id(ctx.params.personnelId));
        engine.save();
        return noContent();
      }),
    ),
    http.post(
      url(`${C}/personnel/:personnelId/rest`),
      command((ctx, _body, career) => domain().rest(career, id(ctx.params.personnelId))),
    ),
    http.post(
      url(`${C}/personnel/:personnelId/transfer`),
      command((ctx, body, career) => domain().transfer(career, id(ctx.params.personnelId), body.facilityId)),
    ),

    http.get(
      url(`${C}/candidates`),
      route((ctx) => {
        const result = domain().candidates(careerOf(ctx));
        engine.save();
        return ok(result);
      }),
    ),
    http.post(
      url(`${C}/candidates/:candidateId/hire`),
      command(
        (ctx, body, career) => domain().hireCandidate(career, id(ctx.params.candidateId), body.facilityId),
        201,
      ),
    ),

    http.get(
      url(`${C}/teams`),
      route((ctx) => ok(domain().teams(careerOf(ctx)))),
    ),
    http.post(
      url(`${C}/teams`),
      mutate((ctx, body) => domain().createTeam(careerOf(ctx), body)),
    ),
    http.patch(
      url(`${C}/teams/:teamId`),
      mutate((ctx, body) => domain().updateTeam(careerOf(ctx), id(ctx.params.teamId), body)),
    ),
    http.put(
      url(`${C}/teams/:teamId/members`),
      mutate((ctx, body) => domain().setTeamMembers(careerOf(ctx), id(ctx.params.teamId), body)),
    ),
    http.put(
      url(`${C}/teams/:teamId/vehicle`),
      mutate((ctx, body) => domain().setTeamVehicle(careerOf(ctx), id(ctx.params.teamId), body.vehicleId)),
    ),

    http.get(
      url(`${C}/departments`),
      route((ctx) => ok(domain().departments(careerOf(ctx)))),
    ),
    http.post(
      url(`${C}/departments`),
      mutate((ctx, body) => domain().createDepartment(careerOf(ctx), body)),
    ),

    http.get(
      url(`${C}/training/courses`),
      route((ctx) => ok(domain().training(careerOf(ctx)))),
    ),
    http.post(
      url(`${C}/training/enroll`),
      command((_ctx, body, career) => domain().enroll(career, body), 201),
    ),
    http.post(
      url(`${C}/training/:enrollmentId/cancel`),
      mutate((ctx) => domain().cancelEnrollment(careerOf(ctx), id(ctx.params.enrollmentId))),
    ),
  ];
};
