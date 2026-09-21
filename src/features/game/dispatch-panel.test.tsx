import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { qk } from '@/lib/api/query-keys';
import { ApiClientError } from '@/lib/api/errors';
import { renderWithIntl } from '@/test/render';
import { CareerProvider } from '@/features/game/hooks';
import { gameApi } from '@/lib/api/endpoints';
import { DispatchPanel } from './dispatch-panel';

// The real endpoints hit the network; the panel only needs `dispatch` and `dispatchOptions` mocked so the test can
// control exactly what the "check" (options) and the "use" (dispatch) each report, the way the real bug requires.
vi.mock('@/lib/api/endpoints', () => ({
  gameApi: {
    sync: vi.fn(),
    catalog: vi.fn(),
    dispatchOptions: vi.fn(),
    dispatch: vi.fn(),
    tutorialAdvance: vi.fn(),
  },
}));

const CAREER_ID = 'car_1';

const vehicle = {
  id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  callSign: 'VF-1',
  status: 'AVAILABLE',
  typeCode: 'FIRE_APS',
  family: 'FIRE',
  facilityId: 'fac_1',
};
const facility = { id: 'fac_1', name: 'Centrale' };
const incident = {
  id: 'inc_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  requirements: [],
  assignedVehicleIds: [],
  isTutorial: false,
};

const dispatchableOption = {
  vehicleId: vehicle.id,
  etaSeconds: 120,
  distanceMeters: 900,
  dispatchable: true,
  blockedReason: null,
  warnings: [],
  contributes: [],
  recommended: false,
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.sync(CAREER_ID), { vehicles: [vehicle], facilities: [facility] });
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>
        <DispatchPanel incident={incident as never} />
      </CareerProvider>
    </QueryClientProvider>,
  );
}

/**
 * Reproduces the reported bug: `dispatch-options` marked the vehicle `dispatchable: true` (checkbox enabled), but the
 * `dispatch` command still rejects it — here because two vehicles picked for the same dispatch would have to share
 * one crew slot that `dispatch-options` checked independently for each of them (see `crewPreviews` in
 * dispatch.service.ts). The fix under test is the mutation's `onError`: it must not leave the stale, still-enabled
 * checkbox on screen — it clears the pick and refetches so the option list catches up with the real server state.
 */
describe('DispatchPanel — dispatch command rejects an option the list marked dispatchable', () => {
  beforeEach(() => {
    vi.mocked(gameApi.catalog).mockResolvedValue({ vehicleTypes: [] } as never);
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [dispatchableOption],
      recommendedVehicleIds: [],
      recommendationCoversRequired: true,
    } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it.each([
    ['CREW_INSUFFICIENT'],
    ['CREW_UNQUALIFIED'],
    ['CREW_EXHAUSTED'],
    ['INVENTORY_INSUFFICIENT'],
    ['VEHICLE_NOT_AVAILABLE'],
    ['INCIDENT_NOT_DISPATCHABLE'],
  ] as const)('clears the pick and refetches options on a %s rejection', async (code) => {
    renderPanel();
    const checkbox = await screen.findByRole('checkbox', { name: /VF-1/ });
    expect(checkbox).not.toBeDisabled();
    fireEvent.click(checkbox);
    const send = await screen.findByTestId('send-selected');

    vi.mocked(gameApi.dispatch).mockRejectedValueOnce(
      new ApiClientError({ code, message: 'rejected', status: 409 }),
    );
    fireEvent.click(send);

    // The mismatch is only actually fixed once the panel re-syncs with the server instead of trusting its stale pick.
    await waitFor(() => expect(gameApi.dispatchOptions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('send-selected')).not.toBeInTheDocument());
  });

  it('leaves the selection alone for a rejection unrelated to the option list going stale', async () => {
    renderPanel();
    const checkbox = await screen.findByRole('checkbox', { name: /VF-1/ });
    fireEvent.click(checkbox);
    await screen.findByTestId('send-selected');

    vi.mocked(gameApi.dispatch).mockRejectedValueOnce(
      new ApiClientError({ code: 'VALIDATION_ERROR', message: 'rejected', status: 400 }),
    );
    fireEvent.click(screen.getByTestId('send-selected'));

    await waitFor(() => expect(gameApi.dispatch).toHaveBeenCalledTimes(1));
    expect(gameApi.dispatchOptions).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('send-selected')).toBeInTheDocument();
  });
});

/**
 * The boat that could be sent to a city flood, and the helicopter that could be sent to a bin fire: the server now
 * refuses both outright, and the row has to say why. There is nothing the player can buy or rest to unblock these,
 * so the reason stands on its own with no "fix it" link — unlike a crew block.
 *
 * Each case needs a second, sendable vehicle: with nothing dispatchable the panel replaces the whole option list
 * with the "no vehicles available" empty state, and no row would be rendered at all.
 */
describe('DispatchPanel — a vehicle that is ineligible by nature', () => {
  const peer = { ...vehicle, id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZZ2', callSign: 'VF-2' };
  const peerOption = { ...dispatchableOption, vehicleId: peer.id };

  const renderWithBlocked = (blockedReason: string) => {
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [{ ...dispatchableOption, dispatchable: false, blockedReason }, peerOption],
      recommendedVehicleIds: [],
      recommendationCoversRequired: false,
    } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.sync(CAREER_ID), { vehicles: [vehicle, peer], facilities: [facility] });
    return renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value={CAREER_ID}>
          <DispatchPanel incident={incident as never} />
        </CareerProvider>
      </QueryClientProvider>,
    );
  };

  beforeEach(() => {
    vi.mocked(gameApi.catalog).mockResolvedValue({ vehicleTypes: [] } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it.each([
    ['VEHICLE_DOMAIN_MISMATCH', /terra e acqua richiedono mezzi diversi/i],
    ['AIR_SUPPORT_NOT_NEEDED', /non richiede supporto aereo/i],
  ] as const)('disables the vehicle and explains %s', async (code, text) => {
    renderWithBlocked(code);

    expect(await screen.findByRole('checkbox', { name: /VF-1/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /VF-2/ })).not.toBeDisabled();
    const reason = await screen.findByTestId('dispatch-ineligible');
    expect(reason).toHaveAttribute('data-blocked', code);
    expect(reason.textContent).toMatch(text);
    // The crew block's "how to fix it" link must not appear: there is nothing to fix here.
    expect(screen.queryByTestId('crew-fix-link')).not.toBeInTheDocument();
  });

  it('says nothing extra for a vehicle that is simply busy', async () => {
    renderWithBlocked('VEHICLE_NOT_AVAILABLE');

    expect(await screen.findByRole('checkbox', { name: /VF-1/ })).toBeDisabled();
    expect(screen.queryByTestId('dispatch-ineligible')).not.toBeInTheDocument();
  });
});

/**
 * Owner-reported gap: the option list showed nothing indicating a vehicle was already out on patrol, even though the
 * vehicle inspector got this right (`movement.purpose === 'PATROLLING'`). The option row joins the same snapshot
 * `vehicles` array the inspector reads (`vehicles.find((v) => v.id === o.vehicleId)`), so the fix is a badge keyed
 * off that same field — this locks the join in place.
 */
describe('DispatchPanel — patrol status indicator', () => {
  const patrolling = {
    ...vehicle,
    movement: {
      path: [
        [14.2, 42.46],
        [14.21, 42.47],
      ],
      departAt: '2026-01-01T00:00:00.000Z',
      arriveAt: '2026-01-01T00:05:00.000Z',
      distanceMeters: 500,
      purpose: 'PATROLLING',
    },
  };

  beforeEach(() => {
    vi.mocked(gameApi.catalog).mockResolvedValue({ vehicleTypes: [] } as never);
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [dispatchableOption],
      recommendedVehicleIds: [],
      recommendationCoversRequired: true,
    } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it('shows an on-patrol badge for an option whose vehicle is currently patrolling', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.sync(CAREER_ID), { vehicles: [patrolling], facilities: [facility] });
    renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value={CAREER_ID}>
          <DispatchPanel incident={incident as never} />
        </CareerProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole('checkbox', { name: /VF-1/ });
    expect(await screen.findByTestId('dispatch-option-patrolling')).toBeInTheDocument();
  });

  it('shows no on-patrol badge for a vehicle that is not currently patrolling', async () => {
    renderPanel();
    await screen.findByRole('checkbox', { name: /VF-1/ });
    expect(screen.queryByTestId('dispatch-option-patrolling')).not.toBeInTheDocument();
  });
});
