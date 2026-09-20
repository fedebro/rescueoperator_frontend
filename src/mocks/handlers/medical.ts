import { http } from 'msw';
import { TransportPatientBody } from '@/contracts';
import { MockError } from '../engine';
import { medicalOf } from '../domains/medical';
import type { DomainHandlers } from './kit';

/** REST handlers of the `medical` area: thin wrappers over the domain (src/mocks/domains/medical.ts). */
export const medicalHandlers: DomainHandlers = (kit) => {
  const { url, ok, route, command, careerOf, C, engine } = kit;
  const medical = () => medicalOf(engine);
  return [
    http.get(
      url(`${C}/incidents/:incidentId/patients`),
      route((ctx) => ok(medical().patients(careerOf(ctx), String(ctx.params.incidentId)))),
    ),
    http.get(
      url(`${C}/patients/:patientId/hospital-options`),
      route((ctx) => ok(medical().hospitalOptions(careerOf(ctx), String(ctx.params.patientId)))),
    ),
    http.get(
      url(`${C}/patients/:patientId`),
      route((ctx) => ok(medical().patient(careerOf(ctx), String(ctx.params.patientId)))),
    ),
    http.post(
      url(`${C}/patients/:patientId/transport`),
      command((ctx, body, career) => {
        const parsed = TransportPatientBody.safeParse(body);
        if (!parsed.success)
          throw new MockError(422, 'VALIDATION_ERROR', 'Invalid transport request', {
            fields: parsed.error.issues.map((i) => i.path.join('.')),
          });
        return medical().transport(career, String(ctx.params.patientId), parsed.data);
      }),
    ),
    http.get(
      url(`${C}/hospitals`),
      route((ctx) => ok(medical().hospitals(careerOf(ctx)))),
    ),
  ];
};
