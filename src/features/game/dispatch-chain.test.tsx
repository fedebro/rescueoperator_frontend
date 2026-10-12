import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { qk } from '@/lib/api/query-keys';
import { renderWithIntl } from '@/test/render';
import { gameApi } from '@/lib/api/endpoints';
import { useToastStore } from '@/stores/toast';
import { CareerProvider } from './hooks';
import { ResendHere } from './dispatch-chain';

vi.mock('@/lib/api/endpoints', () => ({
  gameApi: {
    sync: vi.fn(),
    catalog: vi.fn(),
    dispatchOptions: vi.fn(),
    chainVehicle: vi.fn(),
    cancelChain: vi.fn(),
  },
}));

const CAREER_ID = 'car_1';
const CALL = {
  id: 'inc_01HZZZZZZZZZZZZZZZZZZZZZC1',
  title: { key: 'incident.test.title', params: { fallback: 'Incendio cassonetto' } },
  address: 'Via Roma 12, Pescara',
  placeText: null,
  status: 'PENDING_RESPONSE',
  requirements: [],
  assignedVehicleIds: [],
};
const returning = {
  id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZV1',
  callSign: 'APS 7',
  status: 'RETURNING',
  typeCode: 'FIRE_APS',
  family: 'FIRE',
  facilityId: 'fac_1',
  incidentId: null,
  // the server says where it comes from while it is RETURNING
  returningFromIncidentId: CALL.id,
};
const chain = (patch: Record<string, unknown> = {}) => ({
  vehicleStatus: 'RETURNING',
  redirectEligible: true,
  blockedReason: null,
  queueable: true,
  availableAt: null,
  crew: null,
  fuelStop: null,
  queuedIncidentId: null,
  currentIncidentId: CALL.id,
  stockLow: [],
  estimate: {
    freeAt: '2099-01-01T10:00:00.000Z',
    arriveAt: '2099-01-01T10:05:00.000Z',
    basis: 'RETURNING',
    approximate: false,
    incidentExpiresAt: null,
    afterExpiry: false,
  },
  ...patch,
});
const option = (chainPatch: Record<string, unknown> = {}) => ({
  vehicleId: returning.id,
  etaSeconds: 95,
  distanceMeters: 1800,
  dispatchable: false,
  blockedReason: 'VEHICLE_NOT_AVAILABLE',
  warnings: [],
  contributes: [],
  recommended: false,
  chain: chain(chainPatch),
});

function renderResend(opts: { vehicle?: Record<string, unknown>; incidents?: unknown[] } = {}) {
  const vehicle = { ...returning, ...opts.vehicle };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.sync(CAREER_ID), {
    vehicles: [vehicle],
    incidents: opts.incidents ?? [CALL],
    facilities: [{ id: 'fac_1', name: 'Centrale' }],
    career: { timezone: 'Europe/Rome' },
  });
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>
        <ResendHere vehicle={vehicle as never} />
      </CareerProvider>
    </QueryClientProvider>,
  );
}

describe('ResendHere — the vehicle sheet of a vehicle called back by mistake', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.mocked(gameApi.catalog).mockResolvedValue({ vehicleTypes: [] } as never);
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [option()],
      recommendedVehicleIds: [],
      recommendationCoversRequired: true,
    } as never);
    vi.mocked(gameApi.chainVehicle).mockResolvedValue({
      mode: 'REDIRECTED',
      vehicle: { callSign: returning.callSign },
    } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it('offers "Rimanda alla stessa emergenza" while the call is open, one tap, with the arrival time', async () => {
    renderResend();
    const box = await screen.findByTestId('resend-here');
    expect(box).toHaveTextContent('Richiamato da: Incendio cassonetto');
    expect(within(box).getByTestId('resend-eta')).toHaveTextContent('Arriva in 1:35');
    fireEvent.click(within(box).getByTestId('resend-vehicle'));
    expect(within(box).getByTestId('resend-vehicle')).toHaveTextContent('Rimanda alla stessa emergenza');
    await waitFor(() =>
      expect(gameApi.chainVehicle).toHaveBeenCalledWith(CAREER_ID, returning.id, CALL.id, {
        queueOnly: false,
      }),
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((x) => x.title)).toContain('APS 7 rimandato qui'),
    );
  });

  it('when it cannot turn now: the reason, and the queue through its confirmation', async () => {
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [option({ redirectEligible: false, blockedReason: 'CREW_EXHAUSTED' })],
      recommendedVehicleIds: [],
      recommendationCoversRequired: true,
    } as never);
    renderResend();
    const box = await screen.findByTestId('resend-here');
    expect(within(box).getByTestId('chain-reason')).toHaveAttribute('data-reason', 'CREW_EXHAUSTED');
    expect(within(box).getByTestId('resend-vehicle')).toHaveTextContent('Metti in coda');
    fireEvent.click(within(box).getByTestId('resend-vehicle'));
    expect(await screen.findByTestId('chain-confirm')).toHaveTextContent('Mettere in coda APS 7?');
    expect(gameApi.chainVehicle).not.toHaveBeenCalled();
  });

  it('shows nothing once the call is over, for a vehicle that is not coming back, or when its origin is not known', async () => {
    const { unmount } = renderResend({ incidents: [] });
    await act(async () => undefined);
    expect(screen.queryByTestId('resend-here')).toBeNull();
    unmount();

    const second = renderResend({ vehicle: { status: 'AVAILABLE' } });
    await act(async () => undefined);
    expect(screen.queryByTestId('resend-here')).toBeNull();
    second.unmount();

    renderResend({ vehicle: { returningFromIncidentId: null } });
    await act(async () => undefined);
    expect(screen.queryByTestId('resend-here')).toBeNull();
    expect(gameApi.dispatchOptions).not.toHaveBeenCalled();
  });
});
