import { z } from 'zod';
import { MajorIncidentDto, MajorReinforcementQuoteDto, MajorTrophiesResult } from '@/contracts';
import { api } from '@/lib/api/client';

const c = (careerId: string) => `/careers/${careerId}/major-incidents`;

/**
 * Major incidents ("maxi-emergenze", ROUTES.md "Major incidents", contracts/src/major.ts). The members are normal incidents
 * (dispatched through `/incidents/:id/dispatch`); these routes serve the coordination view, the reinforcements and the
 * trophies. Live changes arrive as `career.updated` events carrying `{ major }`.
 */
export const majorApi = {
  /** The running major of the career, or null. */
  current: (careerId: string) => api.get(`${c(careerId)}/current`, { schema: MajorIncidentDto.nullable() }),
  /** Running and ended majors, newest first. */
  list: (careerId: string, limit = 10) =>
    api.get(c(careerId), { query: { limit }, schema: z.array(MajorIncidentDto) }),
  detail: (careerId: string, majorId: string) =>
    api.get(`${c(careerId)}/${majorId}`, { schema: MajorIncidentDto }),
  quote: (careerId: string, majorId: string) =>
    api.get(`${c(careerId)}/${majorId}/reinforcements/quote`, { schema: MajorReinforcementQuoteDto }),
  /** ★ "Chiedi rinforzi": 409 CONFLICT with `details.reason` when blocked (the quote says why beforehand). */
  requestReinforcements: (careerId: string, majorId: string) =>
    api.command(`${c(careerId)}/${majorId}/reinforcements`, {}, { schema: MajorIncidentDto }),
  trophies: (careerId: string) => api.get(`${c(careerId)}/trophies`, { schema: MajorTrophiesResult }),
};
