import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { CAREER_ID } from '@/test/fixtures';
import { realGap } from './aid-incident';
import { ColumnComposer, columnEstimate, coverageBand } from './column-composer';
import { columnOptions, renderGame, REQUEST_ID } from './test-fixtures';

const api = vi.hoisted(() => ({ columnOptions: vi.fn(), sendColumn: vi.fn() }));
vi.mock('@/lib/api/alliance', () => ({
  allianceApi: {},
  chatApi: {},
  boardApi: {},
  aidApi: { columnOptions: api.columnOptions, sendColumn: api.sendColumn },
  moderationApi: { blocks: vi.fn().mockResolvedValue([]), communityRules: vi.fn() },
  accountApi: {},
}));

describe('realGap', () => {
  const req = (patch: Record<string, unknown>) => ({
    capability: 'FIRE_SUPPRESSION',
    level: 'REQUIRED' as const,
    required: 3,
    onScene: 0,
    enRoute: 0,
    ...patch,
  });
  it('counts what is on scene, en route and already brought by allies against the requirement', () => {
    expect(realGap({ requirements: [req({ onScene: 1, enRoute: 1 })] })).toBe(true);
    expect(realGap({ requirements: [req({ onScene: 1, enRoute: 1, allied: 1 })] })).toBe(false);
    expect(realGap({ requirements: [req({ onScene: 3 })] })).toBe(false);
    expect(realGap({ requirements: [] })).toBe(false);
  });
});

describe('columnEstimate / coverageBand', () => {
  it('caps the useful contribution at what is missing; the slowest vehicle sets the arrival; the fund scales by share', () => {
    const options = columnOptions();
    const one = columnEstimate(options, ['veh_01J8Z0000000000000000000AA']);
    expect(one.share).toBe(1);
    expect(one.useful).toBe(2);
    expect(one.etaSeconds).toBe(300);
    expect(one.credits).toBe(400);
    const both = columnEstimate(options, [
      'veh_01J8Z0000000000000000000AA',
      'veh_01J8Z0000000000000000000AB',
    ]);
    expect(both.share).toBe(1);
    expect(both.etaSeconds).toBe(900);
    expect(columnEstimate(options, []).share).toBe(0);
    const half = columnEstimate(columnOptions({ pairFactor: 0.5 }), ['veh_01J8Z0000000000000000000AB']);
    expect(half.share).toBe(0.5);
    expect(half.credits).toBe(100);
  });
  it('bands the helper coverage', () => {
    expect(coverageBand(80)).toBe('OK');
    expect(coverageBand(60)).toBe('OK');
    expect(coverageBand(50)).toBe('LOW');
    expect(coverageBand(20)).toBe('CRITICAL');
    expect(coverageBand(null)).toBeNull();
  });
});

describe('ColumnComposer', () => {
  beforeEach(() => {
    api.columnOptions.mockResolvedValue(columnOptions());
    api.sendColumn.mockResolvedValue({ id: 'col_01J8Z0000000000000000000AA' });
  });
  afterEach(() => vi.clearAllMocks());

  it('lists my useful vehicles, greys the one that would be late, sums coverage and arrival, warns on my own coverage, sends', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderGame(<ColumnComposer requestId={REQUEST_ID} onOpenChange={onOpenChange} />);
    const rows = await screen.findAllByTestId('column-vehicle');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveAttribute('data-blocked', 'TOO_LATE');
    expect(screen.getByRole('checkbox', { name: 'ABP 1' })).toBeDisabled();
    expect(screen.getByTestId('column-send')).toBeDisabled();
    expect(screen.getByTestId('column-summary')).toHaveTextContent('0%');

    await user.click(screen.getByRole('checkbox', { name: 'APS 1' }));
    expect(screen.getByTestId('column-summary')).toHaveTextContent('100%');
    expect(screen.getByTestId('column-summary')).toHaveTextContent('5:00');
    expect(screen.getByTestId('column-coverage-warning')).toHaveTextContent('Critica');
    expect(screen.getByTestId('column-composer')).toHaveTextContent('1/8');

    await user.click(screen.getByTestId('column-send'));
    await waitFor(() =>
      expect(api.sendColumn).toHaveBeenCalledWith(CAREER_ID, REQUEST_ID, {
        vehicleIds: ['veh_01J8Z0000000000000000000AA'],
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('a blocked request keeps the list visible but disables sending and says why', async () => {
    api.columnOptions.mockResolvedValue(columnOptions({ blockedReason: 'COLUMN_LIMIT' }));
    renderGame(<ColumnComposer requestId={REQUEST_ID} onOpenChange={vi.fn()} />);
    expect(await screen.findByTestId('composer-blocked')).toHaveTextContent('massimo');
    expect(screen.getByTestId('column-send')).toBeDisabled();
  });
});
