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
