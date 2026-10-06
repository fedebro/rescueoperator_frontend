import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { useAuthStore } from '@/stores/auth';
import type { AdminReportDetail, AdminReportRow } from '@/lib/api/admin';
import type * as AdminApiModule from '@/lib/api/admin';
import { AdminModeration, AdminModerationCasePage, decisionsFor } from './moderation';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'rep_01J8ZABCDEFGHJKMNPQRSTVWXY' }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/moderation',
}));

const row = (over: Partial<AdminReportRow> = {}): AdminReportRow => ({
  id: 'rep_01J8ZABCDEFGHJKMNPQRSTVWXY',
  status: 'OPEN',
  severity: 'NORMAL',
  targetKind: 'MESSAGE',
  targetId: 'alx_01J8ZABCDEFGHJKMNPQRSTVWXY',
  reason: 'HARASSMENT',
  reporterCount: 2,
  flaggedByFilter: false,
  hidden: false,
  reportedUserId: 'usr_01J8ZABCDEFGHJKMNPQRSTVWXY',
  reportedCareerId: 'car_01J8ZABCDEFGHJKMNPQRSTVWXY',
  reportedDirectorName: 'Direttore Rossi',
  allianceId: 'all_01J8ZABCDEFGHJKMNPQRSTVWXY',
  excerpt: 'sei proprio un deficiente',
  decision: null,
  createdAt: '2026-10-06T09:00:00.000Z',
  lastReportedAt: '2026-10-06T09:30:00.000Z',
  decidedAt: null,
  ...over,
});
const detail = (over: Partial<AdminReportRow> = {}): AdminReportDetail => ({
  ...row(over),
  content: {
    text: 'sei proprio un deficiente',
    locale: 'it',
    createdAt: '2026-10-06T08:59:00.000Z',
    live: true,
  },
  context: [
    {
      id: 'alx_prev',
      authorDirectorName: 'Altro',
      authorUserId: null,
      text: 'ciao a tutti',
      createdAt: '2026-10-06T08:58:00.000Z',
      isTarget: false,
    },
  ],
  reporters: [
    {
      reporterUserId: null,
      reporterDirectorName: 'Bianchi',
      source: 'PLAYER',
      reason: 'HARASSMENT',
      note: null,
      createdAt: '2026-10-06T09:00:00.000Z',
    },
  ],
  filter: { ok: true, tier: 'MASK', masked: 'sei proprio un d*********', reasons: ['BANNED_TERM'] },
  author: { cases: 1, sanctions: [], accountStatus: 'ACTIVE', accountCreatedAt: '2026-09-01T00:00:00.000Z' },
  decidedBy: null,
  decisionReason: null,
  decisionMessage: null,
});

const api = vi.hoisted(() => ({
  moderationSummary: vi.fn(),
  moderationReports: vi.fn(),
  moderationReport: vi.fn(),
  decideReport: vi.fn(),
}));
vi.mock('@/lib/api/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminApiModule>();
  return { ...actual, adminApi: { ...actual.adminApi, ...api } };
});

function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithIntl(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const signInAs = (roles: string[]) =>
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id: 'usr_01J8ZABCDEFGHJKMNPQRSTVWXA',
      email: 'admin@example.test',
      directorName: 'Admin',
      locale: 'it',
      roles: ['USER', ...roles] as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      activeCareerId: null,
    },
  });

beforeEach(() => {
  api.moderationSummary.mockResolvedValue({
    open: 3,
    openHigh: 1,
    underReview: 0,
    decidedLast7Days: 2,
    meanDecisionHours: 4.5,
    activeMutes: 1,
    rolesAlerted: ['SUPPORT'],
  });
  api.moderationReports.mockResolvedValue({
    data: [
      row({ severity: 'HIGH', hidden: true, excerpt: 'contenuto grave', reason: 'THREAT_SELF_HARM' }),
      row({ id: 'rep_01J8ZABCDEFGHJKMNPQRSTVWXZ' }),
    ],
    meta: { serverTime: '2026-10-06T10:00:00.000Z', nextCursor: null, hasMore: false },
  });
  api.moderationReport.mockResolvedValue(detail());
});

describe('decisionsFor', () => {
  it('offers only the decisions that fit the case and the role', () => {
    expect(decisionsFor(row(), false)).toEqual(['DISMISS', 'REMOVE_CONTENT', 'WARN', 'MUTE_PLATFORM']);
    expect(decisionsFor(row(), true)).toEqual([
      'DISMISS',
      'REMOVE_CONTENT',
      'WARN',
      'MUTE_PLATFORM',
      'SUSPEND',
      'FORCE_NEUTRAL_NAME',
      'CLOSE_ALLIANCE',
    ]);
    expect(decisionsFor(row({ targetKind: 'DIRECTOR_NAME', allianceId: null }), true)).toEqual([
      'DISMISS',
      'WARN',
      'MUTE_PLATFORM',
      'SUSPEND',
      'FORCE_NEUTRAL_NAME',
    ]);
    expect(decisionsFor(row({ reportedUserId: null, allianceId: null }), true)).toEqual([
      'DISMISS',
      'REMOVE_CONTENT',
    ]);
  });
});

describe('AdminModeration', () => {
  it('shows the summary and the queue with the grave case marked', async () => {
    signInAs(['SUPPORT']);
    render(<AdminModeration />);
    await waitFor(() => expect(screen.getByText('contenuto grave')).toBeInTheDocument());
    expect(screen.getByText('sei proprio un deficiente')).toBeInTheDocument();
    expect(screen.getAllByText('Grave').length).toBeGreaterThan(0);
    expect(screen.getByText('Casi aperti')).toBeInTheDocument();
    expect(api.moderationReports).toHaveBeenCalledWith(
      { status: 'OPEN', severity: undefined, targetKind: undefined },
      null,
    );
  });
});

describe('AdminModerationCasePage', () => {
  it('shows the content, the context and a decision form limited to the support actions', async () => {
    signInAs(['SUPPORT']);
    render(<AdminModerationCasePage />);
    await waitFor(() => expect(screen.getByText('Contenuto segnalato')).toBeInTheDocument());
    expect(screen.getByText('ciao a tutti')).toBeInTheDocument();
    expect(screen.getByText('Bianchi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archivia' })).toBeInTheDocument();
    expect(screen.queryByText('Sospendi l’account')).not.toBeInTheDocument();
  });

  it('hides the decision form from a reader without the permission', async () => {
    signInAs([]);
    render(<AdminModerationCasePage />);
    await waitFor(() => expect(screen.getByText('Contenuto segnalato')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Archivia' })).not.toBeInTheDocument();
  });
});
