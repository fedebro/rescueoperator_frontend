import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { VehicleAutonomyDto, VehicleDto } from '@/contracts';
import { applyEvent } from '@/lib/realtime/reconcile';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { useToastStore } from '@/stores/toast';
import { useSettingsStore } from '@/stores/settings';
import { CAREER_ID, envelope, incident, snapshot, vehicle } from '@/test/fixtures';
import { useUiStore } from '@/stores/ui';
import { useMajorStore } from '@/features/major/store';
import { loadMessagesSync } from '@/test/messages';
import { renderWithIntl } from '@/test/render';
import { CareerProvider } from '@/features/game/hooks';
import { resetCoachSeen } from '@/features/coaching/store';
import {
  autonomyFlagOf,
  autonomyTone,
  canRequestResupply,
  enteredReserve,
  fuelLedgerDetail,
  isAutonomyTracked,
  isFull,
  needsResupply,
  reloadBeforeDeparture,
  returnedWithoutStop,
  stockRatio,
} from './autonomy';
import { AUTONOMY_COACH_KEYS, useAutonomyCoaching } from './coaching';
import { ChainFuelStop, DispatchAutonomyFlag, DispatchReloadNote } from './dispatch-autonomy';
import { AutonomyChip } from './gauge';
import { LedgerDescription } from './ledger';
import { VehicleAutonomySection } from './vehicle-autonomy';

vi.mock('@/lib/api/endpoints', () => ({ gameApi: { resupplyVehicle: vi.fn() } }));

/** The backend example of autonomy-fuel.md §3: a pumper at level 3 after one trash-bin fire. */
const autonomy = (patch: Partial<VehicleAutonomyDto> = {}): VehicleAutonomyDto => ({
  unlocked: { stock: true, fuel: true },
  fuel: { km: 108.4, rangeKm: 120, ratio: 0.903, reserve: false, low: false },
  items: [
    { itemCode: 'ABSORBENT', quantity: 16, capacity: 16, low: false },
    { itemCode: 'EXTRICATION_KIT', quantity: 3, capacity: 3, low: false },
    { itemCode: 'FOAM', quantity: 43, capacity: 45, low: false },
  ],
  missionsLeftEstimate: 5,
  needsResupply: false,
  resupplyRequested: false,
  ...patch,
});
const LOCKED = autonomy({
  unlocked: { stock: false, fuel: false },
  fuel: null,
  items: [],
  missionsLeftEstimate: null,
});
const RESERVE = autonomy({
  fuel: { km: 12, rangeKm: 120, ratio: 0.1, reserve: true, low: true },
  missionsLeftEstimate: 0,
  needsResupply: true,
});

describe('autonomy helpers', () => {
  it('shows nothing below the unlock levels', () => {
    expect(isAutonomyTracked(undefined)).toBe(false);
    expect(isAutonomyTracked(LOCKED)).toBe(false);
    // Stock unlocked for a vehicle that carries nothing (a patrol car at level 2): nothing to show either.
    expect(
      isAutonomyTracked(autonomy({ unlocked: { stock: true, fuel: false }, fuel: null, items: [] })),
    ).toBe(false);
    expect(isAutonomyTracked(autonomy())).toBe(true);
  });

  it('summarises the stock by its most depleted item and knows when nothing can be reloaded', () => {
    expect(stockRatio(autonomy())).toBeCloseTo(43 / 45);
    expect(stockRatio({ items: [] })).toBeNull();
    expect(isFull(autonomy())).toBe(false);
    expect(
      isFull(
        autonomy({
          fuel: { km: 120, rangeKm: 120, ratio: 1, reserve: false, low: false },
          items: [{ itemCode: 'FOAM', quantity: 45, capacity: 45, low: false }],
        }),
      ),
    ).toBe(true);
  });

  it('tones: reserve = danger, anything to reload or one mission left = warning', () => {
    expect(autonomyTone(autonomy())).toBe('ok');
    expect(autonomyTone(autonomy({ missionsLeftEstimate: 1 }))).toBe('warning');
    expect(autonomyTone(autonomy({ needsResupply: true }))).toBe('warning');
    expect(autonomyTone(RESERVE)).toBe('danger');
  });

  it('offers "Rientra a rifornire" when available with partial autonomy or on the way home, never twice', () => {
    const v = (status: VehicleDto['status'], a: VehicleAutonomyDto) => ({ status, autonomy: a });
    expect(canRequestResupply(v('AVAILABLE', autonomy()))).toBe(true);
    expect(canRequestResupply(v('RETURNING', autonomy()))).toBe(true);
    expect(canRequestResupply(v('ON_SCENE', autonomy()))).toBe(false);
    expect(canRequestResupply(v('RESTOCKING', autonomy()))).toBe(false);
    expect(canRequestResupply(v('AVAILABLE', autonomy({ resupplyRequested: true })))).toBe(false);
    expect(canRequestResupply(v('AVAILABLE', LOCKED))).toBe(false);
    const full = autonomy({
      fuel: { km: 120, rangeKm: 120, ratio: 1, reserve: false, low: false },
      items: [{ itemCode: 'FOAM', quantity: 45, capacity: 45, low: false }],
    });
    expect(canRequestResupply(v('AVAILABLE', full))).toBe(false);
    expect(needsResupply({ autonomy: RESERVE })).toBe(true);
    expect(needsResupply({ autonomy: undefined })).toBe(false);
  });

  it('picks the one flag of a dispatch option, most severe first, and the reload before departure', () => {
    expect(autonomyFlagOf({ warnings: [] })).toBeNull();
    expect(autonomyFlagOf({ warnings: ['LAST_MISSION_BEFORE_RESUPPLY', 'FUEL_RESERVE'] })).toBe(
      'FUEL_RESERVE',
    );
    expect(autonomyFlagOf({ warnings: ['FUEL_RANGE_INSUFFICIENT', 'FUEL_RESERVE'] })).toBe(
      'FUEL_RANGE_INSUFFICIENT',
    );
    expect(autonomyFlagOf({ warnings: [], autonomy: { lastMissionBeforeResupply: true } })).toBe(
      'LAST_MISSION_BEFORE_RESUPPLY',
    );
    expect(reloadBeforeDeparture({ warnings: [] })).toBeNull();
    expect(reloadBeforeDeparture({ warnings: [], autonomy: { resupplyBeforeDepartureSeconds: 35 } })).toBe(
      35,
    );
    expect(reloadBeforeDeparture({ warnings: ['RESUPPLY_BEFORE_DEPARTURE'] })).toBe(0);
  });

  it('reads the fuel-station ledger entry and the coaching conditions', () => {
    const entry = {
      entryType: 'FUEL',
      description: { key: 'ledger.FUEL', params: { refilledKm: 41.6, callSign: 'APS 1' } },
    };
    expect(fuelLedgerDetail(entry)).toEqual({ callSign: 'APS 1', km: 42 });
    expect(fuelLedgerDetail({ ...entry, entryType: 'MISSION_REWARD' })).toBeNull();
    expect(returnedWithoutStop({ status: 'AVAILABLE', autonomy: autonomy() })).toBe(true);
    expect(returnedWithoutStop({ status: 'RESTOCKING', autonomy: autonomy() })).toBe(false);
    expect(returnedWithoutStop({ status: 'AVAILABLE', autonomy: LOCKED })).toBe(false);
    expect(enteredReserve({ autonomy: autonomy() }, { autonomy: RESERVE })).toBe(true);
    expect(enteredReserve({ autonomy: RESERVE }, { autonomy: RESERVE })).toBe(false);
  });
});

describe('realtime: autonomy effects', () => {
  it('turns vehicle.returned and a first reserve into effects', () => {
    const base = snapshot({ vehicles: [vehicle({ autonomy: autonomy() })] });
    const returned = applyEvent(
      base,
      envelope('vehicle.returned', 11, { vehicle: vehicle({ autonomy: autonomy() }) }),
    );
    expect(returned.kind).toBe('applied');
    if (returned.kind !== 'applied') return;
    expect(returned.effects.map((e) => e.type)).toContain('vehicle.returned');
    const reserve = applyEvent(
      returned.snapshot,
      envelope('vehicle.updated', 12, { vehicle: vehicle({ autonomy: RESERVE }) }),
    );
    expect(reserve.kind === 'applied' && reserve.effects.map((e) => e.type)).toContain('vehicle.reserve');
    if (reserve.kind !== 'applied') return;
    // Still in reserve: no second effect.
    const again = applyEvent(
      reserve.snapshot,
      envelope('vehicle.updated', 13, { vehicle: vehicle({ autonomy: RESERVE }) }),
    );
    expect(again.kind === 'applied' && again.effects.map((e) => e.type)).not.toContain('vehicle.reserve');
  });
});

function renderSection(v: VehicleDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.sync(CAREER_ID), snapshot({ vehicles: [v] }));
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>
        <VehicleAutonomySection vehicle={v} />
      </CareerProvider>
    </QueryClientProvider>,
  );
}

describe('vehicle inspector: autonomy section', () => {
  beforeEach(() => {
    resetCoachSeen(CAREER_ID);
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => vi.clearAllMocks());

  it('is hidden below the unlock levels', () => {
    renderSection(vehicle({ autonomy: LOCKED }));
    expect(screen.queryByTestId('vehicle-autonomy')).toBeNull();
    renderSection(vehicle({ autonomy: undefined }));
    expect(screen.queryByTestId('vehicle-autonomy')).toBeNull();
  });

  it('shows the missions line, the two gauges and the item detail on demand', () => {
    renderSection(vehicle({ autonomy: autonomy() }));
    expect(screen.getByTestId('missions-left')).toHaveTextContent('Autonomia: circa 5 missioni');
    expect(screen.getByTestId('fuel-value')).toHaveTextContent('108 km su 120');
    expect(screen.getByTestId('stock-gauge')).toHaveTextContent('3 materiali');
    expect(screen.queryByTestId('stock-items')).toBeNull();
    fireEvent.click(screen.getByTestId('stock-toggle'));
    expect(screen.getAllByTestId('stock-item')).toHaveLength(3);
    expect(screen.getByText('43 su 45')).toBeInTheDocument();
  });

  it('marks the reserve and the items to reload', () => {
    renderSection(
      vehicle({
        autonomy: autonomy({
          ...RESERVE,
          items: [{ itemCode: 'FOAM', quantity: 10, capacity: 45, low: true }],
        }),
      }),
    );
    expect(screen.getByTestId('missions-left')).toHaveTextContent('Da rifornire');
    expect(screen.getByTestId('fuel-gauge')).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByTestId('fuel-gauge')).toHaveTextContent('Riserva');
    expect(screen.getByTestId('stock-gauge')).toHaveTextContent('1 da ricaricare');
  });

  it('explains each half once (stock first, then fuel), dismissible', () => {
    renderSection(vehicle({ autonomy: autonomy() }));
    expect(screen.getByTestId('autonomy-explain')).toHaveAttribute('data-kind', 'stock');
    fireEvent.click(screen.getByTestId('autonomy-explain-dismiss'));
    expect(screen.getByTestId('autonomy-explain')).toHaveAttribute('data-kind', 'fuel');
    fireEvent.click(screen.getByTestId('autonomy-explain-dismiss'));
    expect(screen.queryByTestId('autonomy-explain')).toBeNull();
  });

  it('"Rientra a rifornire" calls the command and says what happens; RESTOCKING shows its countdown', async () => {
    vi.mocked(gameApi.resupplyVehicle).mockResolvedValue({
      mode: 'RESTOCKING',
      vehicle: vehicle({ status: 'RESTOCKING', autonomy: autonomy() }),
      until: '2030-01-01T00:00:00.000Z',
    });
    renderSection(vehicle({ autonomy: autonomy() }));
    fireEvent.click(screen.getByTestId('return-to-resupply'));
    await waitFor(() => expect(gameApi.resupplyVehicle).toHaveBeenCalledWith(CAREER_ID, vehicle().id));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('APS 1: rifornimento avviato'),
    );
  });

  it('shows the resupply in progress and a pending request instead of the button', () => {
    renderSection(
      vehicle({ status: 'RESTOCKING', busyUntil: '2030-01-01T00:00:00.000Z', autonomy: autonomy() }),
    );
    expect(screen.getByTestId('restocking')).toHaveTextContent('Rifornimento in corso');
    expect(screen.queryByTestId('return-to-resupply')).toBeNull();
    renderSection(vehicle({ status: 'RETURNING', autonomy: autonomy({ resupplyRequested: true }) }));
    expect(screen.getByTestId('resupply-requested')).toHaveTextContent('Si rifornirà al prossimo rientro');
  });
});

describe('dispatch, fleet and ledger pieces', () => {
  const option = (patch: Record<string, unknown>) =>
    ({
      vehicleId: 'veh_1',
      etaSeconds: 120,
      distanceMeters: 900,
      dispatchable: true,
      blockedReason: null,
      warnings: [],
      contributes: [],
      recommended: false,
      ...patch,
    }) as never;

  it('renders one discreet flag per option and the reload note', () => {
    renderWithIntl(<DispatchAutonomyFlag option={option({ warnings: ['FUEL_RESERVE'] })} />);
    expect(screen.getByTestId('dispatch-autonomy-flag')).toHaveTextContent('Riserva');
    renderWithIntl(<DispatchAutonomyFlag option={option({ warnings: ['LAST_MISSION_BEFORE_RESUPPLY'] })} />);
    expect(screen.getByText('Ultima missione prima del rifornimento')).toBeInTheDocument();
    renderWithIntl(
      <DispatchReloadNote
        option={option({
          warnings: ['RESUPPLY_BEFORE_DEPARTURE'],
          autonomy: {
            fuelNeededKm: 20,
            fuelKm: 20,
            enoughFuel: true,
            resupplyBeforeDepartureSeconds: 35,
            lastMissionBeforeResupply: false,
          },
        })}
      />,
    );
    expect(screen.getByTestId('dispatch-reload-note')).toHaveTextContent(
      'Rifornisce prima di partire: +0:35, già nel tempo d’arrivo',
    );
  });

  it('shows the fuel stop of a redirect in reserve with its premium', () => {
    renderWithIntl(<ChainFuelStop fuelStop={{ extraSeconds: 60, premium: '12' }} />);
    expect(screen.getByTestId('chain-fuel-stop')).toHaveTextContent(
      'Sosta al distributore: +1:00 · 12 crediti',
    );
  });

  it('compact fleet chip and the FUEL ledger row', () => {
    renderWithIntl(<AutonomyChip autonomy={autonomy()} />);
    expect(screen.getByTestId('autonomy-chip')).toHaveTextContent('~5 missioni');
    renderWithIntl(<AutonomyChip autonomy={RESERVE} />);
    expect(screen.getAllByTestId('autonomy-chip')[1]).toHaveAttribute('data-tone', 'danger');
    renderWithIntl(
      <LedgerDescription
        entry={{
          id: 'led_1',
          amount: '-5',
          balanceAfter: '395',
          entryType: 'FUEL',
          description: { key: 'ledger.FUEL', params: { refilledKm: 42, callSign: 'APS 1' } },
          createdAt: '2026-01-01T10:00:00.000Z',
        }}
      />,
    );
    expect(screen.getByTestId('ledger-description')).toHaveTextContent(
      'Carburante al distributore · APS 1 · 42 km riforniti',
    );
  });
});

describe('autonomy coaching lines', () => {
  const messages = loadMessagesSync('it');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
      {children}
    </NextIntlClientProvider>
  );
  beforeEach(() => {
    resetCoachSeen(CAREER_ID);
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState({ tutorialHints: true });
  });

  it('fires each line once per career, only for the right transition', () => {
    const { result } = renderHook(() => useAutonomyCoaching(CAREER_ID), { wrapper });
    act(() => result.current.onReturned(vehicle({ status: 'RESTOCKING', autonomy: autonomy() })));
    expect(useToastStore.getState().toasts).toHaveLength(0);
    act(() => result.current.onReturned(vehicle({ status: 'AVAILABLE', autonomy: autonomy() })));
    act(() => result.current.onReturned(vehicle({ status: 'AVAILABLE', autonomy: autonomy() })));
    const titles = () => useToastStore.getState().toasts.map((t) => t.title);
    expect(titles()).toEqual(['Aveva ancora autonomia: è subito pronto']);
    act(() => result.current.onReserve(vehicle({ autonomy: RESERVE })));
    act(() => result.current.onReserve(vehicle({ autonomy: RESERVE })));
    expect(titles()).toEqual([
      'Aveva ancora autonomia: è subito pronto',
      'In riserva: finita la missione andrà a rifornirsi da solo',
    ]);
    expect(localStorage.getItem(`rc-coach-seen:${CAREER_ID}`)).toContain(AUTONOMY_COACH_KEYS.noStop);
  });

  it('stays silent when the hints are off', () => {
    useSettingsStore.setState({ tutorialHints: false });
    const { result } = renderHook(() => useAutonomyCoaching(CAREER_ID), { wrapper });
    act(() => result.current.onReturned(vehicle({ status: 'AVAILABLE', autonomy: autonomy() })));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('level-up: the fleet autonomy is re-read', () => {
  it('merges only the autonomy block of every vehicle into the snapshot', async () => {
    const { refreshFleetAutonomy } = await import('./refresh');
    const qc = new QueryClient();
    qc.setQueryData(
      qk.sync(CAREER_ID),
      snapshot({ vehicles: [vehicle({ status: 'EN_ROUTE', autonomy: LOCKED })] }),
    );
    const api = gameApi as unknown as { vehicles: ReturnType<typeof vi.fn> };
    api.vehicles = vi.fn().mockResolvedValue([vehicle({ status: 'AVAILABLE', autonomy: autonomy() })]);
    await refreshFleetAutonomy(qc, CAREER_ID);
    const [v] = qc.getQueryData<ReturnType<typeof snapshot>>(qk.sync(CAREER_ID))!.vehicles;
    expect(v!.status).toBe('EN_ROUTE');
    expect(v!.autonomy).toEqual(autonomy());
    api.vehicles = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(refreshFleetAutonomy(qc, CAREER_ID)).resolves.toBeUndefined();
  });
});

describe('flight endurance (phase 3, additive `fuel.unit`)', () => {
  it('shows minutes of flight for an aircraft instead of km', async () => {
    const { FuelGauge } = await import('./gauge');
    renderWithIntl(
      <FuelGauge
        fuel={{ km: 24, rangeKm: 30, ratio: 0.8, reserve: false, low: false, unit: 'MIN' } as never}
      />,
    );
    expect(screen.getByTestId('fuel-gauge')).toHaveAttribute('data-unit', 'MIN');
    expect(screen.getByTestId('fuel-gauge')).toHaveTextContent('Autonomia di volo');
    expect(screen.getByTestId('fuel-value')).toHaveTextContent('24 min su 30');
  });
});

describe('flight endurance in the vehicle inspector and the coaching', () => {
  const FLIGHT = autonomy({
    unlocked: { stock: false, fuel: true },
    fuel: { km: 24, rangeKm: 30, ratio: 0.8, reserve: false, low: false, unit: 'MIN' } as never,
    items: [],
  });
  beforeEach(() => {
    resetCoachSeen(CAREER_ID);
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState({ tutorialHints: true });
    useMajorStore.setState({ flightResume: {} });
  });

  it('explains once that an aircraft counts minutes of flight, not km', () => {
    renderSection(vehicle({ typeCode: 'FIRE_HELI', autonomy: FLIGHT }));
    expect(screen.getByTestId('autonomy-explain')).toHaveAttribute('data-kind', 'flight');
    fireEvent.click(screen.getByTestId('autonomy-explain-dismiss'));
    expect(screen.queryByTestId('autonomy-explain')).toBeNull();
  });

  it('an aircraft turned back at bingo says it will fly back to its call once refuelled', () => {
    const call = incident();
    useMajorStore.getState().rememberResume(vehicle().id, call.id);
    const heli = vehicle({ typeCode: 'FIRE_HELI', status: 'RETURNING', autonomy: FLIGHT });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.sync(CAREER_ID), snapshot({ vehicles: [heli], incidents: [call] }));
    renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value={CAREER_ID}>
          <VehicleAutonomySection vehicle={heli} />
        </CareerProvider>
      </QueryClientProvider>,
    );
    const note = screen.getByTestId('flight-resume');
    expect(note).toHaveTextContent('Dopo il pieno tornerà su');
    fireEvent.click(note);
    expect(useUiStore.getState().selection).toEqual({ kind: 'incident', id: call.id });
  });

  it('the first bingo of the career explains the rotation, once', () => {
    const messages = loadMessagesSync('it');
    const { result } = renderHook(() => useAutonomyCoaching(CAREER_ID), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          {children}
        </NextIntlClientProvider>
      ),
    });
    act(() => result.current.onBingo(vehicle({ callSign: 'Drago 1' })));
    act(() => result.current.onBingo(vehicle({ callSign: 'Drago 1' })));
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((t) => t.title)).toEqual(['Elicotteri e aerei hanno un’autonomia in minuti di volo']);
    expect(toasts[0]!.description).toContain('Drago 1');
  });
});
