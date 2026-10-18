import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { qk } from '@/lib/api/query-keys';
import { ApiClientError } from '@/lib/api/errors';
import { useToastStore } from '@/stores/toast';
import { renderWithIntl } from '@/test/render';
import { CareerProvider } from '@/features/game/hooks';
import { gameApi } from '@/lib/api/endpoints';
import { medicalApi } from '@/lib/api/depth';
import { DispatchPanel } from './dispatch-panel';

// The real endpoints hit the network; the panel only needs `dispatch` and `dispatchOptions` mocked so the test can
// control exactly what the "check" (options) and the "use" (dispatch) each report, the way the real bug requires.
vi.mock('@/lib/api/endpoints', () => ({
  gameApi: {
    sync: vi.fn(),
    catalog: vi.fn(),
    dispatchOptions: vi.fn(),
    dispatch: vi.fn(),
    chainVehicle: vi.fn(),
    cancelChain: vi.fn(),
    tutorialAdvance: vi.fn(),
  },
}));

vi.mock('@/lib/api/depth', () => ({
  medicalApi: { patients: vi.fn(), hospitals: vi.fn(), hospitalOptions: vi.fn(), transport: vi.fn() },
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

/**
 * Vehicle autonomy (D-22) in the option list: ONE discreet flag per option instead of a warning badge per code, the
 * reload before departure as a note (its seconds are already in the ETA), and — for a vehicle on its way back — the
 * fuel-station stop of a redirect in reserve and the new chain reasons.
 */
describe('DispatchPanel — vehicle autonomy', () => {
  const returning = {
    ...vehicle,
    id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZZ3',
    callSign: 'VF-3',
    status: 'RETURNING',
  };
  const restocking = {
    ...vehicle,
    id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZZ4',
    callSign: 'VF-4',
    status: 'RESTOCKING',
  };
  const chain = (patch: Record<string, unknown>) => ({
    vehicleStatus: 'RETURNING',
    queuedIncidentId: null,
    redirectEligible: false,
    blockedReason: null,
    queueable: true,
    availableAt: '2099-01-01T00:00:00.000Z',
    crew: null,
    fuelStop: null,
    ...patch,
  });

  beforeEach(() => {
    vi.mocked(gameApi.catalog).mockResolvedValue({ vehicleTypes: [] } as never);
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [
        {
          ...dispatchableOption,
          warnings: ['RESUPPLY_BEFORE_DEPARTURE', 'LAST_MISSION_BEFORE_RESUPPLY', 'STOCK_LOW:FOAM'],
          autonomy: {
            fuelNeededKm: 22,
            fuelKm: 30,
            enoughFuel: true,
            resupplyBeforeDepartureSeconds: 35,
            lastMissionBeforeResupply: true,
          },
        },
        {
          ...dispatchableOption,
          vehicleId: returning.id,
          dispatchable: false,
          blockedReason: 'VEHICLE_NOT_AVAILABLE',
          chain: chain({ redirectEligible: true, fuelStop: { extraSeconds: 60, premium: '12' } }),
        },
        {
          ...dispatchableOption,
          vehicleId: restocking.id,
          dispatchable: false,
          blockedReason: 'VEHICLE_NOT_AVAILABLE',
          chain: chain({ vehicleStatus: 'RESTOCKING', blockedReason: 'VEHICLE_RESTOCKING' }),
        },
      ],
      recommendedVehicleIds: [vehicle.id],
      recommendationCoversRequired: true,
    } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it('flags, notes and chain previews', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.sync(CAREER_ID), {
      vehicles: [vehicle, returning, restocking],
      incidents: [],
      facilities: [facility],
    });
    renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value={CAREER_ID}>
          <DispatchPanel incident={incident as never} />
        </CareerProvider>
      </QueryClientProvider>,
    );
    const flag = await screen.findByTestId('dispatch-autonomy-flag');
    expect(flag).toHaveAttribute('data-flag', 'LAST_MISSION_BEFORE_RESUPPLY');
    expect(screen.getByTestId('dispatch-reload-note')).toHaveTextContent('+0:35');
    // The autonomy codes are not repeated as raw warning badges; a stock warning still is.
    expect(screen.queryByText('RESUPPLY_BEFORE_DEPARTURE')).not.toBeInTheDocument();
    expect(screen.getByText(/Scorta quasi esaurita/)).toBeInTheDocument();
    // A redirect in reserve goes through a pump first.
    expect(screen.getByTestId('chain-redirect')).toBeInTheDocument();
    expect(screen.getByTestId('chain-fuel-stop')).toHaveTextContent('+1:00 · 12 crediti');
    // A vehicle resupplying at base: queue only, with the reason AND when it is free.
    expect(screen.getByTestId('chain-reason')).toHaveTextContent('Sta facendo rifornimento in sede');
    expect(screen.getByTestId('chain-available-in')).toHaveTextContent('Libero tra');
  });
});

/**
 * Water incidents (D-68): a land unit that brings nothing needed at the meeting point says why in water words, a boat
 * returning from a mission can only be queued (it must go back to its Base nautica first), and each row says where the
 * vehicle goes (the scene on the water, the meeting point on the shore).
 */
describe('DispatchPanel — water incidents', () => {
  const tanker = {
    ...vehicle,
    id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZZ5',
    callSign: 'ABP 1',
    typeCode: 'FIRE_ABP',
  };
  const boat = {
    ...vehicle,
    id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZZ6',
    callSign: 'Gommone 1',
    typeCode: 'FIRE_BOAT',
    status: 'RETURNING',
  };
  const waterIncident = {
    ...incident,
    domain: 'WATER',
    waterBody: { type: 'SEA', id: 'sea:adriatic', name: 'Mare Adriatico' },
    scenePosition: [14.22, 42.48],
    meetingPoint: [14.21, 42.47],
  };

  beforeEach(() => {
    vi.mocked(gameApi.catalog).mockResolvedValue({
      vehicleTypes: [
        { code: 'FIRE_APS', domain: 'GROUND', name: { key: 'vehicle.FIRE_APS.name' } },
        { code: 'FIRE_ABP', domain: 'GROUND', name: { key: 'vehicle.FIRE_ABP.name' } },
        { code: 'FIRE_BOAT', domain: 'WATER', name: { key: 'vehicle.FIRE_BOAT.name' } },
      ],
    } as never);
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [
        { ...dispatchableOption, destination: 'MEETING_POINT' },
        {
          ...dispatchableOption,
          vehicleId: tanker.id,
          dispatchable: false,
          blockedReason: 'VEHICLE_DOMAIN_MISMATCH',
          destination: 'MEETING_POINT',
        },
        {
          ...dispatchableOption,
          vehicleId: boat.id,
          dispatchable: false,
          blockedReason: 'VEHICLE_NOT_AVAILABLE',
          destination: 'SCENE',
          chain: {
            vehicleStatus: 'RETURNING',
            queuedIncidentId: null,
            redirectEligible: false,
            blockedReason: 'BOAT_NEEDS_BASE',
            queueable: true,
            availableAt: null,
            crew: null,
          },
        },
      ],
      recommendedVehicleIds: [vehicle.id],
      recommendationCoversRequired: true,
    } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it('explains the gate in water words, queues a returning boat and shows each destination', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.sync(CAREER_ID), {
      vehicles: [vehicle, tanker, boat],
      incidents: [],
      facilities: [facility],
    });
    renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value={CAREER_ID}>
          <DispatchPanel incident={waterIncident as never} />
        </CareerProvider>
      </QueryClientProvider>,
    );
    const block = await screen.findByTestId('dispatch-ineligible');
    await waitFor(() => expect(block).toHaveTextContent('Al punto di raccolta non porta nulla che serva'));
    expect(screen.getByTestId('chain-reason')).toHaveAttribute('data-reason', 'BOAT_NEEDS_BASE');
    expect(screen.getByTestId('chain-reason')).toHaveTextContent('Deve prima rientrare alla Base nautica');
    expect(screen.getByTestId('chain-queue')).toBeInTheDocument();
    const destinations = screen
      .getAllByTestId('dispatch-water-route')
      .map((e) => e.getAttribute('data-destination'));
    // List order (2026-10-18): the free unit, then the boat that can queue, then the land unit that cannot go at all.
    expect(destinations).toEqual(['MEETING_POINT', 'SCENE', 'MEETING_POINT']);
  });

  /** Water rescue (2026-10-18): people in the water and a send with no unit on the water, none there nor coming. */
  const inWater = {
    id: 'pat_01HZZZZZZZZZZZZZZZZZZZZZZ1',
    incidentId: incident.id,
    label: 'Paziente 1',
    profileCode: null,
    triage: null,
    status: 'UNASSESSED',
    stability: null,
    needs: [],
    transportRequired: null,
    assignedVehicleId: null,
    hospitalId: null,
    busyUntil: null,
    location: 'WATER',
    recovery: { by: null, vehicleId: null, etaAt: null, recoveredAt: null },
  };
  const renderWater = (vehicles: unknown[]) => {
    vi.mocked(medicalApi.patients).mockResolvedValue([inWater] as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.sync(CAREER_ID), { vehicles, incidents: [], facilities: [facility] });
    renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value={CAREER_ID}>
          <DispatchPanel incident={{ ...waterIncident, patientCount: 1 } as never} />
        </CareerProvider>
      </QueryClientProvider>,
    );
  };

  it('warns that the patients stay in the sea when the send has no unit on the water', async () => {
    renderWater([vehicle, tanker, boat]);
    const warning = await screen.findByTestId('dispatch-no-water-unit');
    expect(warning).toHaveTextContent('Nessun mezzo in acqua: i pazienti restano in mare');
  });

  it('says nothing when a unit on the water is already on its way', async () => {
    renderWater([vehicle, tanker, { ...boat, status: 'EN_ROUTE', incidentId: incident.id }]);
    await screen.findByTestId('dispatch-actions');
    await waitFor(() => expect(medicalApi.patients).toHaveBeenCalled());
    expect(screen.queryByTestId('dispatch-no-water-unit')).toBeNull();
  });
});

/**
 * Major incidents (D-69) and flight endurance / mass-casualty care in the option list: one command sends at most
 * `maxVehiclesPerDispatch` (12; 24 on a major's incidents), an aircraft says the minutes it needs and how long it can stay
 * over the scene (or why it cannot go at all), a maxi ambulance and a field post say what they are for.
 */
describe('DispatchPanel — major incidents, aircraft, mass-casualty vehicles', () => {
  const fleet = Array.from({ length: 13 }, (_, i) => ({
    ...vehicle,
    id: `veh_01HZZZZZZZZZZZZZZZZZZZZZ${String(i).padStart(2, '0')}`,
    callSign: `APS ${i + 1}`,
  }));
  const renderWith = (opts: {
    incident: Record<string, unknown>;
    options: unknown[];
    cap?: number;
    vehicles: unknown[];
  }) => {
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: opts.options,
      recommendedVehicleIds: [],
      recommendationCoversRequired: false,
      ...(opts.cap ? { maxVehiclesPerDispatch: opts.cap } : {}),
    } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.sync(CAREER_ID), { vehicles: opts.vehicles, facilities: [facility] });
    return renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value={CAREER_ID}>
          <DispatchPanel incident={opts.incident as never} />
        </CareerProvider>
      </QueryClientProvider>,
    );
  };
  const fleetOptions = fleet.map((v) => ({ ...dispatchableOption, vehicleId: v.id }));

  beforeEach(() => {
    vi.mocked(gameApi.catalog).mockResolvedValue({
      vehicleTypes: [
        { code: 'FIRE_APS', domain: 'GROUND', tags: [], name: { key: 'vehicle.FIRE_APS.name' } },
        { code: 'FIRE_HELI', domain: 'AIR', tags: ['WINCH'], name: { key: 'vehicle.FIRE_HELI.name' } },
        {
          code: 'EMS_MAXI',
          domain: 'GROUND',
          tags: ['MULTI_PATIENT'],
          name: { key: 'vehicle.EMS_MAXI.name' },
        },
        { code: 'EMS_PMA', domain: 'GROUND', tags: ['NO_TRANSPORT'], name: { key: 'vehicle.EMS_PMA.name' } },
      ],
    } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it('an ordinary call: after 12 ticks no other vehicle can be added, and the panel says why', async () => {
    renderWith({ incident, options: fleetOptions, cap: 12, vehicles: fleet });
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(13);
    for (const box of boxes.slice(0, 12)) fireEvent.click(box);
    const cap = await screen.findByTestId('dispatch-cap');
    expect(cap).toHaveAttribute('data-reached', 'true');
    expect(cap).toHaveTextContent('Massimo 12 mezzi per invio');
    expect(boxes[12]).toBeDisabled();
    fireEvent.click(boxes[12]!);
    expect(screen.getByTestId('send-selected')).toHaveTextContent('Invia i 12 mezzi selezionati');
  });

  it('a major’s incident: up to 24 in one command, said upfront', async () => {
    const member = { ...incident, major: { role: 'MAIN', id: 'mjr_1', sector: 0 } };
    renderWith({ incident: member, options: fleetOptions, cap: 24, vehicles: fleet });
    const boxes = await screen.findAllByRole('checkbox');
    expect(screen.getByTestId('dispatch-cap')).toHaveTextContent(
      'Maxi-emergenza: fino a 24 mezzi per invio (0 selezionati)',
    );
    for (const box of boxes) fireEvent.click(box);
    expect(screen.getByTestId('dispatch-cap')).toHaveAttribute('data-reached', 'false');
    expect(screen.getByTestId('send-selected')).toHaveTextContent('Invia i 13 mezzi selezionati');
  });

  it('an aircraft: the minutes it needs and on board, how long it can stay; beyond its endurance, why not', async () => {
    const heli = {
      ...vehicle,
      id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZH1',
      callSign: 'Drago 1',
      typeCode: 'FIRE_HELI',
    };
    const far = { ...heli, id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZH2', callSign: 'Drago 2' };
    const air = (patch: Record<string, unknown>) => ({
      fuelNeededKm: 14,
      fuelKm: 30,
      enoughFuel: true,
      resupplyBeforeDepartureSeconds: 0,
      lastMissionBeforeResupply: false,
      fuelUnit: 'MIN',
      onSceneMinutes: 12.6,
      ...patch,
    });
    renderWith({
      incident,
      vehicles: [heli, far],
      options: [
        { ...dispatchableOption, vehicleId: heli.id, autonomy: air({}) },
        {
          ...dispatchableOption,
          vehicleId: far.id,
          dispatchable: false,
          blockedReason: 'ENDURANCE_INSUFFICIENT',
          warnings: ['FUEL_RANGE_INSUFFICIENT'],
          autonomy: air({ fuelNeededKm: 44.2, enoughFuel: false, onSceneMinutes: null }),
        },
      ],
    });
    const notes = await screen.findAllByTestId('dispatch-flight-note');
    expect(notes[0]).toHaveTextContent('Servono 14 min di volo · a bordo 30');
    expect(screen.getByTestId('dispatch-on-scene-minutes')).toHaveTextContent(
      'Può restare sul posto circa 12 minuti',
    );
    expect(notes[1]).toHaveTextContent('Servono 45 min di volo · a bordo 30');
    const blocked = screen.getByTestId('dispatch-ineligible');
    expect(blocked).toHaveAttribute('data-blocked', 'ENDURANCE_INSUFFICIENT');
    expect(blocked).toHaveTextContent('Autonomia di volo insufficiente');
    expect(screen.getByRole('checkbox', { name: /Drago 2/ })).toBeDisabled();
    // Its flag speaks of flight, not of a fuel tank.
    expect(screen.getByTestId('dispatch-autonomy-flag')).toHaveAttribute(
      'title',
      expect.stringContaining('ritorno'),
    );
  });

  it('an aircraft the call does not ask for: the reason only, no minutes of flight', async () => {
    const heli = {
      ...vehicle,
      id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZH3',
      callSign: 'Drago 3',
      typeCode: 'FIRE_HELI',
    };
    renderWith({
      incident,
      vehicles: [vehicle, heli],
      options: [
        dispatchableOption,
        {
          ...dispatchableOption,
          vehicleId: heli.id,
          dispatchable: false,
          blockedReason: 'AIR_SUPPORT_NOT_NEEDED',
          autonomy: {
            fuelNeededKm: 8,
            fuelKm: 30,
            enoughFuel: true,
            resupplyBeforeDepartureSeconds: 0,
            lastMissionBeforeResupply: false,
            fuelUnit: 'MIN',
            onSceneMinutes: 40,
          },
        },
      ],
    });
    const blocked = await screen.findByTestId('dispatch-ineligible');
    expect(blocked).toHaveAttribute('data-blocked', 'AIR_SUPPORT_NOT_NEEDED');
    expect(blocked).toHaveTextContent('questa emergenza non richiede supporto aereo');
    expect(screen.queryByTestId('dispatch-flight-note')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Drago 3/ })).toBeDisabled();
  });

  it('the maxi ambulance carries 4 per trip, the field post treats on scene', async () => {
    const maxi = {
      ...vehicle,
      id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZM1',
      callSign: 'Maxi 1',
      typeCode: 'EMS_MAXI',
      family: 'EMS',
    };
    const pma = {
      ...vehicle,
      id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZM2',
      callSign: 'PMA 1',
      typeCode: 'EMS_PMA',
      family: 'EMS',
    };
    renderWith({
      incident,
      vehicles: [maxi, pma],
      options: [
        { ...dispatchableOption, vehicleId: maxi.id },
        { ...dispatchableOption, vehicleId: pma.id },
      ],
    });
    expect(await screen.findByTestId('dispatch-multi-patient')).toHaveTextContent(
      'Trasporta fino a 4 pazienti per viaggio',
    );
    expect(screen.getByTestId('dispatch-field-post')).toHaveTextContent('non trasporta');
  });
});

/**
 * Sending a vehicle that is not free (owner, 2026-10-12): the row names the vehicle in full and says which mission it is on
 * (never a name cut to "…" next to an action), the queue is confirmed with the mission and the estimate, a vehicle called back
 * from this emergency can be sent back to it, and a redirect that cannot happen says why.
 */
describe('DispatchPanel — vehicles on a mission', () => {
  const LONG_NAME = 'Autopompa serbatoio Centrale Nord 12';
  const other = {
    id: 'inc_01HZZZZZZZZZZZZZZZZZZZZZY9',
    title: { key: 'incident.test.title', params: { fallback: 'Incendio cassonetto' } },
    address: 'Via Roma 12, Pescara',
    placeText: null,
    status: 'ON_SCENE',
  };
  const busyVehicle = {
    ...vehicle,
    id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZB1',
    callSign: LONG_NAME,
    status: 'ON_SCENE',
  };
  const FREE_AT = '2099-01-01T10:00:00.000Z';
  const ARRIVE_AT = '2099-01-01T10:05:00.000Z';
  const chain = (patch: Record<string, unknown> = {}) => ({
    vehicleStatus: 'ON_SCENE',
    redirectEligible: false,
    blockedReason: 'VEHICLE_NOT_RETURNING',
    queueable: true,
    availableAt: null,
    crew: null,
    fuelStop: null,
    queuedIncidentId: null,
    currentIncidentId: other.id,
    stockLow: [],
    estimate: {
      freeAt: FREE_AT,
      arriveAt: ARRIVE_AT,
      basis: 'WORK_END',
      approximate: true,
      incidentExpiresAt: null,
      afterExpiry: false,
    },
    ...patch,
  });
  const busyOption = (patch: Record<string, unknown> = {}, chainPatch: Record<string, unknown> = {}) => ({
    ...dispatchableOption,
    vehicleId: busyVehicle.id,
    dispatchable: false,
    blockedReason: 'VEHICLE_NOT_AVAILABLE',
    etaSeconds: 185,
    distanceMeters: 2400,
    chain: chain(chainPatch),
    ...patch,
  });

  function renderBusy(opts: { options: unknown[]; vehicles?: unknown[]; incidents?: unknown[] }) {
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [dispatchableOption, ...opts.options],
      recommendedVehicleIds: [],
      recommendationCoversRequired: true,
    } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.sync(CAREER_ID), {
      vehicles: opts.vehicles ?? [vehicle, busyVehicle],
      incidents: opts.incidents ?? [other],
      facilities: [facility],
      career: { timezone: 'Europe/Rome' },
    });
    return renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value={CAREER_ID}>
          <DispatchPanel incident={incident as never} />
        </CareerProvider>
      </QueryClientProvider>,
    );
  }
  const row = async (callSign: string) =>
    (await screen.findAllByTestId('dispatch-option')).find((li) => li.textContent?.includes(callSign))!;

  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.mocked(gameApi.catalog).mockResolvedValue({ vehicleTypes: [] } as never);
    vi.mocked(gameApi.chainVehicle).mockResolvedValue({
      mode: 'REDIRECTED',
      vehicle: { callSign: LONG_NAME },
    } as never);
    vi.mocked(gameApi.cancelChain).mockResolvedValue({ callSign: LONG_NAME } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it('names the vehicle in full, says which mission it is on and what state it is in — no checkbox, no greyed-out text', async () => {
    renderBusy({ options: [busyOption()] });
    const li = await row(LONG_NAME);
    expect(li).toHaveAttribute('data-busy', 'true');
    // the full name, not a truncated one, and not dimmed
    expect(within(li).getByTestId('dispatch-option-name')).toHaveTextContent(LONG_NAME);
    expect(li.className).not.toMatch(/opacity|truncate/);
    expect(within(li).getByTestId('dispatch-option-name').className).not.toContain('truncate');
    expect(within(li).getByTestId('dispatch-option-busy')).toHaveTextContent('Impegnato');
    const mission = within(li).getByTestId('chain-mission');
    expect(mission).toHaveTextContent('Impegnato su:');
    expect(mission).toHaveTextContent('Incendio cassonetto');
    expect(mission).toHaveTextContent('Via Roma 12, Pescara');
    expect(mission).toHaveTextContent('Sul posto');
    // a busy vehicle is not a checkbox (the dispatchable one still is)
    expect(within(li).queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /VF-1/ })).toBeInTheDocument();
    // the reason and the way to the queue, full width below
    expect(within(li).getByTestId('chain-reason')).toHaveAttribute('data-reason', 'VEHICLE_NOT_RETURNING');
    expect(within(li).getByTestId('chain-queue')).toHaveTextContent('Metti in coda');
  });

  it('a vehicle on its way home from a call that is over still says where it comes from', async () => {
    renderBusy({
      options: [
        busyOption(
          {},
          { vehicleStatus: 'RETURNING', blockedReason: 'CREW_EXHAUSTED', currentIncidentId: 'inc_gone' },
        ),
      ],
      incidents: [],
    });
    const li = await row(LONG_NAME);
    expect(within(li).getByTestId('chain-mission')).toHaveTextContent('Rientra da un intervento concluso');
    expect(within(li).getByTestId('chain-mission')).toHaveTextContent('In rientro');
    // the reason says what to do: rest, and queue it
    expect(within(li).getByTestId('chain-reason')).toHaveTextContent('Equipaggio troppo affaticato');
    expect(within(li).getByTestId('chain-hint')).toHaveTextContent('Rientra e riposa');
  });

  it('a unit resupplying at base: no mission, a countdown to the end of its stop', async () => {
    renderBusy({
      options: [
        busyOption(
          {},
          { vehicleStatus: 'RESTOCKING', blockedReason: 'VEHICLE_RESTOCKING', currentIncidentId: null },
        ),
      ],
      vehicles: [vehicle, { ...busyVehicle, status: 'RESTOCKING', busyUntil: '2099-01-01T09:59:00.000Z' }],
    });
    const li = await row(LONG_NAME);
    expect(within(li).getByTestId('chain-mission')).toHaveTextContent('Sta rifornendo in sede');
    expect(within(li).getByTestId('chain-reason')).toHaveTextContent('Sta facendo rifornimento in sede');
  });

  it('the queue is confirmed: the vehicle, its mission, when it is free and would arrive — nothing is sent before', async () => {
    renderBusy({ options: [busyOption()] });
    fireEvent.click(within(await row(LONG_NAME)).getByTestId('chain-queue'));

    const dialog = await screen.findByTestId('chain-confirm');
    expect(dialog).toHaveTextContent(`Mettere in coda ${LONG_NAME}?`);
    expect(within(dialog).getByTestId('chain-confirm-vehicle')).toHaveTextContent(LONG_NAME);
    expect(within(dialog).getByTestId('chain-confirm-mission')).toHaveTextContent('Incendio cassonetto');
    expect(within(dialog).getByTestId('chain-confirm-mission')).toHaveTextContent('Via Roma 12, Pescara');
    expect(within(dialog).getByTestId('chain-confirm-mission')).toHaveTextContent('Sul posto');
    expect(within(dialog).getByTestId('chain-confirm-free-at')).toHaveTextContent('Libero verso le 11:00');
    expect(within(dialog).getByTestId('chain-confirm-arrive-at')).toHaveTextContent(
      'Arriverebbe qui verso le 11:05',
    );
    expect(within(dialog).getByTestId('chain-confirm-countdown')).toHaveTextContent(/^tra /);
    // a projection says so, and on what it rests
    expect(within(dialog).getByTestId('chain-confirm-approximate')).toHaveTextContent('stima');
    expect(within(dialog).getByTestId('chain-confirm-basis')).toHaveAttribute('data-basis', 'WORK_END');
    expect(within(dialog).getByTestId('chain-confirm-basis')).toHaveTextContent(
      'fine del lavoro sul posto più il rientro in sede',
    );
    expect(within(dialog).queryByTestId('chain-confirm-expiry')).toBeNull();
    expect(gameApi.chainVehicle).not.toHaveBeenCalled();

    vi.mocked(gameApi.chainVehicle).mockResolvedValueOnce({
      mode: 'QUEUED',
      vehicle: { callSign: LONG_NAME },
      queue: { incidentId: incident.id, queuedAt: FREE_AT },
    } as never);
    fireEvent.click(within(dialog).getByTestId('chain-confirm-submit'));
    await waitFor(() =>
      expect(gameApi.chainVehicle).toHaveBeenCalledWith(CAREER_ID, busyVehicle.id, incident.id, {
        queueOnly: false,
      }),
    );
    // the toast repeats the estimate
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((x) => x.title)).toContain(
        `${LONG_NAME} in coda: arriverebbe verso le 11:05`,
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('chain-confirm')).toBeNull());
  });

  it('cancelling the confirmation sends nothing', async () => {
    renderBusy({ options: [busyOption()] });
    fireEvent.click(within(await row(LONG_NAME)).getByTestId('chain-queue'));
    fireEvent.click(await screen.findByTestId('chain-confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('chain-confirm')).toBeNull());
    expect(gameApi.chainVehicle).not.toHaveBeenCalled();
  });

  it('warns, loudly, when it would arrive after the call expires', async () => {
    renderBusy({
      options: [
        busyOption(
          {},
          {
            estimate: {
              freeAt: FREE_AT,
              arriveAt: ARRIVE_AT,
              basis: 'RETURNING',
              approximate: false,
              incidentExpiresAt: '2099-01-01T10:02:00.000Z',
              afterExpiry: true,
            },
          },
        ),
      ],
    });
    fireEvent.click(within(await row(LONG_NAME)).getByTestId('chain-queue'));
    const warning = await screen.findByTestId('chain-confirm-expiry');
    expect(warning).toHaveAttribute('role', 'alert');
    expect(warning).toHaveTextContent(
      'Arriverebbe dopo la scadenza della chiamata (11:02): la coda verrebbe annullata.',
    );
    // an exact estimate carries no "stima" label
    expect(screen.queryByTestId('chain-confirm-approximate')).toBeNull();
  });

  it('a vehicle already queued here shows its estimate and can be taken off the queue', async () => {
    renderBusy({ options: [busyOption({}, { queuedIncidentId: incident.id })] });
    const li = await row(LONG_NAME);
    expect(within(li).getByTestId('chain-queued')).toHaveTextContent('In coda per questa emergenza');
    expect(within(li).getByTestId('chain-arrival')).toHaveTextContent('Arriverebbe verso le 11:05 (stima)');
    fireEvent.click(within(li).getByTestId('chain-cancel'));
    await waitFor(() => expect(gameApi.cancelChain).toHaveBeenCalledWith(CAREER_ID, busyVehicle.id));
  });

  it('a redirect is one tap: the row already says when it arrives, the toast confirms', async () => {
    renderBusy({
      options: [busyOption({}, { vehicleStatus: 'RETURNING', redirectEligible: true, blockedReason: null })],
    });
    const li = await row(LONG_NAME);
    expect(within(li).getByTestId('chain-eta')).toHaveTextContent('Arriva in 3:05');
    expect(within(li).getByTestId('chain-eta')).toHaveTextContent('2,4 km');
    fireEvent.click(within(li).getByTestId('chain-redirect'));
    await waitFor(() =>
      expect(gameApi.chainVehicle).toHaveBeenCalledWith(CAREER_ID, busyVehicle.id, incident.id, {
        queueOnly: false,
      }),
    );
    expect(screen.queryByTestId('chain-confirm')).toBeNull();
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((x) => x.title)).toContain(`${LONG_NAME} reindirizzato qui`),
    );
  });

  it('short supplies never block a redirect: they are said, and the queue after the resupply is the other way', async () => {
    renderBusy({
      options: [
        busyOption(
          {},
          {
            vehicleStatus: 'RETURNING',
            redirectEligible: true,
            blockedReason: null,
            stockLow: ['FOAM', 'ABSORBENT'],
          },
        ),
      ],
    });
    const li = await row(LONG_NAME);
    expect(within(li).getByTestId('chain-redirect')).toBeEnabled();
    expect(within(li).getByTestId('chain-stock-low')).toHaveTextContent('Scorte basse: Foam, Absorbent');
    fireEvent.click(within(li).getByTestId('chain-queue-after-restock'));
    const dialog = await screen.findByTestId('chain-confirm');
    expect(within(dialog).getByTestId('chain-confirm-after-restock')).toHaveTextContent(
      'parte dopo il rifornimento',
    );
    expect(gameApi.chainVehicle).not.toHaveBeenCalled();
    vi.mocked(gameApi.chainVehicle).mockResolvedValueOnce({
      mode: 'QUEUED',
      vehicle: { callSign: LONG_NAME },
      queue: { incidentId: incident.id, queuedAt: FREE_AT },
    } as never);
    fireEvent.click(within(dialog).getByTestId('chain-confirm-submit'));
    await waitFor(() =>
      expect(gameApi.chainVehicle).toHaveBeenCalledWith(CAREER_ID, busyVehicle.id, incident.id, {
        queueOnly: true,
      }),
    );
  });

  it('a vehicle called back from THIS emergency can be sent back to it', async () => {
    renderBusy({
      options: [
        busyOption(
          {},
          {
            vehicleStatus: 'RETURNING',
            redirectEligible: true,
            blockedReason: null,
            currentIncidentId: incident.id,
          },
        ),
      ],
    });
    const li = await row(LONG_NAME);
    expect(within(li).getByTestId('chain-mission')).toHaveAttribute('data-here', 'true');
    expect(within(li).getByTestId('chain-recalled-here')).toHaveTextContent('Richiamato da questa emergenza');
    expect(within(li).queryByTestId('chain-redirect')).toBeNull();
    fireEvent.click(within(li).getByTestId('chain-resend'));
    await waitFor(() =>
      expect(gameApi.chainVehicle).toHaveBeenCalledWith(CAREER_ID, busyVehicle.id, incident.id, {
        queueOnly: false,
      }),
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((x) => x.title)).toContain(`${LONG_NAME} rimandato qui`),
    );
  });

  it('a redirect the server turned into a queue says why in the toast', async () => {
    renderBusy({
      options: [busyOption({}, { vehicleStatus: 'RETURNING', redirectEligible: true, blockedReason: null })],
    });
    const li = await row(LONG_NAME);
    vi.mocked(gameApi.chainVehicle).mockResolvedValueOnce({
      mode: 'QUEUED',
      vehicle: { callSign: LONG_NAME },
      queue: { incidentId: incident.id, queuedAt: FREE_AT },
    } as never);
    // by the time of the answer the crew has become too tired: the options of NOW say so
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [
        dispatchableOption,
        busyOption({}, { vehicleStatus: 'RETURNING', blockedReason: 'CREW_EXHAUSTED' }),
      ],
      recommendedVehicleIds: [],
      recommendationCoversRequired: true,
    } as never);
    fireEvent.click(within(li).getByTestId('chain-redirect'));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((x) => x.title)).toContain(
        `${LONG_NAME} in coda: Equipaggio troppo affaticato`,
      ),
    );
  });

  it('every reason the server can give is explained, in words, with the way to fix it where there is one', async () => {
    const reasons = [
      'VEHICLE_NOT_RETURNING',
      'VEHICLE_RESTOCKING',
      'VEHICLE_INOPERABLE',
      'MAINTENANCE_DUE',
      'GROUNDED_BY_CONDITIONS',
      'FUEL_RESERVE',
      'CREW_INSUFFICIENT',
      'CREW_UNQUALIFIED',
      'CREW_EXHAUSTED',
      'BOAT_NEEDS_BASE',
    ];
    const vehicles = reasons.map((_, i) => ({
      ...busyVehicle,
      id: `veh_01HZZZZZZZZZZZZZZZZZZZZZR${i}`,
      callSign: `R-${i}`,
    }));
    renderBusy({
      vehicles: [vehicle, ...vehicles],
      options: reasons.map((reason, i) => ({
        ...busyOption({ vehicleId: vehicles[i]!.id }, { blockedReason: reason }),
      })),
    });
    const items = await screen.findAllByTestId('chain-reason');
    expect(items.map((e) => e.getAttribute('data-reason'))).toEqual(reasons);
    for (const item of items) expect(item.textContent!.length).toBeGreaterThan(8);
    const fixes = screen.getAllByTestId('chain-fix-link').map((a) => [a.textContent, a.getAttribute('href')]);
    expect(fixes).toEqual([
      ['Vai in Logistica', '/game/logistics'],
      ['Vai in Logistica', '/game/logistics'],
      ['Vai in Personale', '/game/personnel?tab=recruitment'],
      ['Vai in Personale', '/game/personnel?tab=recruitment'],
    ]);
  });

  it('a unit that is wrong for the call by nature has no action: only the reason', async () => {
    renderBusy({
      options: [busyOption({ blockedReason: 'VEHICLE_DOMAIN_MISMATCH' })],
    });
    const li = await row(LONG_NAME);
    expect(within(li).getByTestId('dispatch-ineligible')).toHaveAttribute(
      'data-blocked',
      'VEHICLE_DOMAIN_MISMATCH',
    );
    expect(within(li).queryByTestId('chain-queue')).toBeNull();
    expect(within(li).queryByTestId('chain-redirect')).toBeNull();
  });
});
