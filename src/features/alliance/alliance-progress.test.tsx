import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { CAREER_ID } from '@/test/fixtures';
import { OperationAlertHost } from './operation-alert';
import { OperationSection } from './operation-card';
import { ObjectivesSection } from './progress-cards';
import { RankingTab } from './ranking-tab';
import {
  objectives,
  operation,
  OPERATION_ID,
  page,
  ranking,
  renderGame,
  snapshotAlliance,
} from './test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/game/alliance',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/sound', () => ({ playCue: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const api = vi.hoisted(() => ({
  objectives: vi.fn(),
  xp: vi.fn(),
  ranking: vi.fn(),
  current: vi.fn(),
  history: vi.fn(),
  join: vi.fn(),
  decline: vi.fn(),
}));
vi.mock('@/lib/api/alliance', () => ({
  allianceApi: {},
  progressApi: { objectives: api.objectives, xp: api.xp, ranking: api.ranking },
  operationApi: { current: api.current, history: api.history, join: api.join, decline: api.decline },
  boardApi: {},
  chatApi: {},
  aidApi: {},
  moderationApi: { blocks: vi.fn().mockResolvedValue([]), communityRules: vi.fn() },
  accountApi: {},
}));

beforeEach(() => {
  api.objectives.mockResolvedValue(objectives());
  api.xp.mockResolvedValue(page([]));
  api.ranking.mockResolvedValue(ranking());
  api.current.mockResolvedValue(operation());
  api.history.mockResolvedValue(page([]));
  api.join.mockImplementation(() =>
    Promise.resolve(
      operation({ me: { status: 'JOINED', canJoin: false, blockedReason: 'ALREADY_JOINED', majorId: null } }),
    ),
  );
  api.decline.mockImplementation(() =>
    Promise.resolve(
      operation({ me: { status: 'DECLINED', canJoin: false, blockedReason: 'DECLINED', majorId: null } }),
    ),
  );
});
afterEach(() => vi.clearAllMocks());

describe('objectives', () => {
  it('shows the three objectives with progress, my contribution, the reward state and the contributors', async () => {
    const user = userEvent.setup();
    renderGame(<ObjectivesSection />);
    const rows = await screen.findAllByTestId('objective');
    expect(rows).toHaveLength(3);
    const volume = rows.find((r) => r.dataset.type === 'VOLUME')!;
    expect(within(volume).getByTestId('objective-progress')).toHaveTextContent('4 / 30');
    expect(within(volume).getByTestId('objective-mine')).toHaveTextContent('4');
    expect(within(volume).getByTestId('objective-reward-state')).toHaveTextContent('150');
    await user.click(within(volume).getByTestId('objective-contributions-toggle'));
    expect(within(volume).getByTestId('objective-contributions')).toHaveTextContent('Federico');
    const cooperation = rows.find((r) => r.dataset.type === 'COOPERATION')!;
    expect(within(cooperation).getByTestId('objective-done')).toBeInTheDocument();
    expect(within(cooperation).getByTestId('objective-reward-state')).toHaveTextContent('1 contributo');
    expect(screen.getByTestId('alliance-objectives')).toHaveTextContent('2/3');
  });
});

describe('ranking', () => {
  it('off: the explanation; on: the top 20, my alliance below with its position, who carried it, last week', async () => {
    api.ranking.mockResolvedValueOnce(ranking({ enabled: false, entries: [], mine: null, lastWeek: null }));
    const { unmount } = renderGame(<RankingTab />);
    expect(await screen.findByTestId('ranking-disabled')).toBeInTheDocument();
    unmount();
    renderGame(<RankingTab />);
    expect(await screen.findByTestId('ranking-mine')).toHaveAttribute('data-position', '23');
    expect(screen.getAllByTestId('ranking-row')).toHaveLength(21);
    expect(screen.getByTestId('ranking-list').lastElementChild).toHaveAttribute('data-mine', 'true');
    expect(screen.getByTestId('ranking-top')).toHaveTextContent('Federico');
    expect(screen.getByTestId('ranking-last-week')).toHaveTextContent('#2');
    expect(screen.getByTestId('ranking-last-week')).toHaveTextContent('argento');
  });
});

describe('operation card and alert', () => {
  it('ALERT: Partecipa and Non ora call the server; ENDED: the medal', async () => {
    const user = userEvent.setup();
    const { unmount } = renderGame(<OperationSection />);
    const card = await screen.findByTestId('operation-card');
    expect(card).toHaveAttribute('data-status', 'ALERT');
    expect(card).toHaveTextContent('1 partecipante');
    await user.click(screen.getByTestId('operation-join'));
    await waitFor(() => expect(api.join).toHaveBeenCalledWith(CAREER_ID));
    unmount();
    api.current.mockResolvedValue(
      operation({
        status: 'ENDED',
        outcome: 'GOLD',
        progress: 1,
        reward: { allianceXp: 600, trophy: true, quality: 0.9 },
      }),
    );
    renderGame(<OperationSection />);
    expect(await screen.findByTestId('operation-outcome')).toHaveAttribute('data-outcome', 'GOLD');
    expect(screen.queryByTestId('operation-join')).toBeNull();
  });

  it('the full-screen alert shows for an invited member while the alert runs; Non ora answers and closes it', async () => {
    const user = userEvent.setup();
    renderGame(<OperationAlertHost />, 5, {
      alliance: snapshotAlliance({ operationId: OPERATION_ID }),
      featureFlags: { alliance_operations: true },
    });
    const alert = await screen.findByTestId('operation-alert');
    expect(screen.getByTestId('operation-alert-title')).toHaveTextContent(/alluvione/i);
    expect(screen.getByTestId('operation-alert-joined')).toHaveTextContent('Marta');
    expect(alert).toHaveAttribute('data-operation-id', OPERATION_ID);
    await user.click(screen.getByTestId('operation-alert-decline'));
    await waitFor(() => expect(api.decline).toHaveBeenCalledWith(CAREER_ID));
    await waitFor(() => expect(screen.queryByTestId('operation-alert')).toBeNull());
  });

  it('no alert once answered or when the alert window is over', async () => {
    api.current.mockResolvedValue(
      operation({
        status: 'ACTIVE',
        me: { status: 'JOINED', canJoin: false, blockedReason: 'ALREADY_JOINED', majorId: null },
      }),
    );
    renderGame(<OperationAlertHost />, 5, {
      alliance: snapshotAlliance({ operationId: OPERATION_ID }),
      featureFlags: { alliance_operations: true },
    });
    await waitFor(() => expect(api.current).toHaveBeenCalled());
    expect(screen.queryByTestId('operation-alert')).toBeNull();
  });
});
