/** Hierarchical TanStack Query keys: everything of a career lives under ['career', id, …]. */
export const qk = {
  me: ['me'] as const,
  sessions: ['me', 'sessions'] as const,
  careers: ['careers'] as const,
  locationSearch: (q: string) => ['locations', 'search', q] as const,
  starterSites: (locationId: string) => ['locations', locationId, 'starter-sites'] as const,
  career: (id: string) => ['career', id] as const,
  sync: (id: string) => ['career', id, 'sync'] as const,
  catalog: (id: string) => ['career', id, 'catalog'] as const,
  awayReport: (id: string) => ['career', id, 'away-report'] as const,
  facility: (id: string, facilityId: string) => ['career', id, 'facility', facilityId] as const,
  dispatchOptions: (id: string, incidentId: string) =>
    ['career', id, 'incident', incidentId, 'dispatch-options'] as const,
  timeline: (id: string, incidentId: string) => ['career', id, 'incident', incidentId, 'timeline'] as const,
  balance: (id: string) => ['career', id, 'economy', 'balance'] as const,
  ledger: (id: string) => ['career', id, 'economy', 'ledger'] as const,
  stipend: (id: string) => ['career', id, 'economy', 'stipend'] as const,
  progression: (id: string) => ['career', id, 'progression'] as const,
  unlocks: (id: string) => ['career', id, 'progression', 'unlocks'] as const,
  notifications: (id: string) => ['career', id, 'notifications'] as const,
  admin: (resource: string, ...rest: unknown[]) => ['admin', resource, ...rest] as const,
};
