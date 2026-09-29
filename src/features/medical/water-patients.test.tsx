import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IncidentDto, PatientDto, VehicleDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { medicalApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useUiStore } from '@/stores/ui';
import {
  CAREER_ID,
  INCIDENT_ID,
  incident as incidentFixture,
  snapshot,
  vehicle as vehicleFixture,
} from '@/test/fixtures';
import { renderWithIntl } from '@/test/render';
import { CareerProvider } from '@/features/game/hooks';
import { canBeTransported, isInWater, isJustAshore } from './hooks';
import { IncidentPatients } from './incident-patients';
import { coPassengerCandidates } from './mass-casualty';

vi.mock('@/lib/api/endpoints', () => ({
  gameApi: { sync: vi.fn(), catalog: vi.fn(), dispatchOptions: vi.fn(), dispatch: vi.fn() },
}));
vi.mock('@/lib/api/depth', () => ({
  medicalApi: { patients: vi.fn(), hospitals: vi.fn(), hospitalOptions: vi.fn(), transport: vi.fn() },
}));

/**
 * Water patients (analisi/note-agenti/water-patients.md): a patient still in the water is reached only by the units on the
 * water; the card says who is bringing them ashore and when, and never offers the hospital transport before they are ashore.
 */
const SCENE: [number, number] = [14.2228, 42.4757];
const MEETING: [number, number] = [14.2166, 42.4703];
const BOAT_ID = 'veh_01J8Z0000000000000000000BT';
const AMBULANCE_ID = 'veh_01J8Z0000000000000000000MS';
const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();

const waterIncident = (patch: Partial<IncidentDto> = {}): IncidentDto =>
  incidentFixture({
    templateCode: 'MED_SWIMMER_DISTRESS',
    position: MEETING,
    domain: 'WATER',
    waterBody: { type: 'SEA', id: 'sea:adriatic', name: 'Mare Adriatico' },
    scenePosition: SCENE,
    meetingPoint: MEETING,
    waterSupport: null,
    status: 'ON_SCENE',
    patientCount: 1,
    ...patch,
  });
const coastGuard = (recoveryAt: string): IncidentDto['waterSupport'] => ({
  provider: 'COAST_GUARD',
  name: { key: 'water.coastGuard.name' },
  capabilities: ['WATER_RESCUE'],
  rewardShare: 0.6,
  recoveryAt,
});
const patient = (n: number, patch: Partial<PatientDto> = {}): PatientDto => ({
  id: `pat_01J8Z0000000000000000000${String(n).padStart(2, '0')}`,
  incidentId: INCIDENT_ID,
  label: `Paziente ${n}`,
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
  ...patch,
});
const boat = (patch: Partial<VehicleDto> = {}): VehicleDto =>
  vehicleFixture({
    id: BOAT_ID,
    typeCode: 'FIRE_BOAT',
    callSign: 'BOAT 1',
    incidentId: INCIDENT_ID,
    status: 'ON_SCENE',
    capabilities: [
      { code: 'WATER_RESCUE', value: 75 },
      { code: 'MEDICAL_BASIC', value: 45 },
    ],
    ...patch,
  });
const ambulance = (patch: Partial<VehicleDto> = {}): VehicleDto =>
  vehicleFixture({
    id: AMBULANCE_ID,
    typeCode: 'EMS_MSB',
    family: 'EMS',
    callSign: 'MSB 1',
    incidentId: INCIDENT_ID,
    status: 'ON_SCENE',
    capabilities: [
      { code: 'MEDICAL_BASIC', value: 70 },
      { code: 'PATIENT_TRANSPORT', value: 100 },
    ],
    ...patch,
  });
const catalog = {
  vehicleTypes: [
    { code: 'FIRE_BOAT', domain: 'WATER', tags: [] },
    { code: 'EMS_MSB', domain: 'GROUND', tags: [] },
    { code: 'EMS_HELI', domain: 'AIR', tags: ['WINCH'] },
  ],
};

function renderSection(incident: IncidentDto, patients: PatientDto[], vehicles: VehicleDto[] = []) {
  vi.mocked(medicalApi.patients).mockResolvedValue(patients);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.sync(CAREER_ID), snapshot({ vehicles, incidents: [incident] }));
  qc.setQueryData(qk.catalog(CAREER_ID), catalog);
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>
        <IncidentPatients incident={incident} />
      </CareerProvider>
    </QueryClientProvider>,
  );
}

describe('water patients: who is in the water, who can leave for hospital', () => {
  it('reads the location (absent = ashore) and offers the transport only at the meeting point', () => {
    expect(isInWater(patient(1))).toBe(true);
    expect(isInWater(patient(1, { location: undefined }))).toBe(false);
    // taken by the external rescuers: no longer at the scene
    expect(isInWater(patient(1, { status: 'IN_TRANSPORT' }))).toBe(false);
    expect(canBeTransported(patient(1, { status: 'AWAITING_TRANSPORT' }))).toBe(false);
    expect(canBeTransported(patient(1, { status: 'AWAITING_TRANSPORT', location: 'ASHORE' }))).toBe(true);
    expect(canBeTransported(patient(1, { status: 'AWAITING_TRANSPORT', location: undefined }))).toBe(true);
    // brought ashore: shown as such while still cared for at the meeting point
    const landed = { by: 'COAST_GUARD' as const, vehicleId: null, etaAt: null, recoveredAt: inSeconds(-10) };
    expect(isJustAshore(patient(1, { location: 'ASHORE', status: 'ASSESSED', recovery: landed }))).toBe(true);
    expect(isJustAshore(patient(1, { location: 'ASHORE', status: 'IN_TRANSPORT', recovery: landed }))).toBe(
      false,
    );
    expect(isJustAshore(patient(1, { location: 'ASHORE', status: 'ASSESSED', recovery: null }))).toBe(false);
    // a multi-patient ambulance never boards somebody still in the water
    const list = [
      patient(1, { status: 'AWAITING_TRANSPORT', location: 'ASHORE' }),
      patient(2, { status: 'AWAITING_TRANSPORT' }),
      patient(3, { status: 'AWAITING_TRANSPORT', location: 'ASHORE' }),
    ];
    expect(coPassengerCandidates(list[0]!, list, 4).candidates.map((p) => p.id)).toEqual([list[2]!.id]);
  });
});

describe('IncidentPatients: water patients', () => {
  beforeEach(() => {
    useUiStore.setState({ selection: null });
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [],
      recommendedVehicleIds: [],
      recommendationCoversRequired: true,
    } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it('waiting in the water: the banner and who can help; the section opens by itself with "1 in acqua"', async () => {
    renderSection(waterIncident(), [patient(1)], [ambulance()]);
    const card = await screen.findByTestId('patient-card');
    expect(card).toHaveAttribute('data-patient-location', 'WATER');
    const banner = within(card).getByTestId('patient-water');
    expect(banner).toHaveAttribute('data-recovery', 'WAITING');
    expect(banner).toHaveTextContent('In acqua — in attesa del recupero');
    expect(banner).toHaveTextContent(
      'Serve un mezzo acquatico: una barca (o un elicottero con verricello) lo raggiunge',
    );
    expect(screen.getByTestId('incident-patients')).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByTestId('patients-in-water')).toHaveTextContent('1 in acqua');
    // "Triage in corso" becomes the water note: nobody on the water or on the way, no Coast Guard
    const note = screen.getByTestId('patients-unassessed');
    expect(note).toHaveAttribute('data-in-water', 'true');
    expect(note).toHaveTextContent('Pazienti in acqua');
    expect(within(note).getByTestId('patients-water-none')).toHaveTextContent(
      'Nessun mezzo acquatico sul posto o in arrivo: invia una barca.',
    );
    // not RESOLVING: the dispatch panel is still there, no quick dispatch here
    expect(screen.queryByTestId('send-water-unit')).not.toBeInTheDocument();
  });

  it('aboard a boat: its call sign (a tap selects it), the time left before the meeting point, the first aid in the water', async () => {
    renderSection(
      waterIncident(),
      [
        patient(1, {
          status: 'ASSESSED',
          triage: 'RED',
          needs: [{ capability: 'MEDICAL_BASIC', met: false }],
          recovery: { by: 'VEHICLE', vehicleId: BOAT_ID, etaAt: inSeconds(90), recoveredAt: null },
        }),
      ],
      [boat(), ambulance()],
    );
    const banner = await screen.findByTestId('patient-water');
    expect(banner).toHaveAttribute('data-recovery', 'ABOARD');
    expect(banner).toHaveTextContent('In acqua — BOAT 1 lo sta portando a riva');
    expect(within(banner).getByTestId('patient-water-eta')).toHaveTextContent(/^A riva tra 1:(29|30)$/);
    fireEvent.click(within(banner).getByRole('button', { name: 'BOAT 1' }));
    expect(useUiStore.getState().selection).toEqual({ kind: 'vehicle', id: BOAT_ID });
    expect(screen.getByTestId('patient-needs')).toHaveTextContent('Primo soccorso in acqua');
    expect(screen.getByTestId('patient-needs')).toHaveTextContent('le cure complete arrivano a riva');
  });

  it('awaiting transport in the water: no transport panel, the transport leaves the meeting point once ashore', async () => {
    renderSection(
      waterIncident(),
      [
        patient(1, {
          status: 'AWAITING_TRANSPORT',
          triage: 'RED',
          transportRequired: true,
          recovery: { by: 'VEHICLE', vehicleId: BOAT_ID, etaAt: inSeconds(60), recoveredAt: null },
        }),
      ],
      [boat(), ambulance()],
    );
    const card = await screen.findByTestId('patient-card');
    expect(within(card).getByTestId('patient-transport-after-recovery')).toHaveTextContent(
      'Il trasporto in ospedale parte dal punto di raccolta, appena il paziente è a riva.',
    );
    expect(screen.queryByTestId('transport-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transport-missing-vehicle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confirm-recommended-hospital')).not.toBeInTheDocument();
    expect(medicalApi.hospitalOptions).not.toHaveBeenCalled();
    // no transport decision is pending: in the water, the section is open for the water, not for the hospital
    expect(screen.getByTestId('patients-in-water')).toHaveTextContent('1 in acqua');
  });

  it('the Coast Guard brings them ashore: the cards and the section say when', async () => {
    const eta = inSeconds(125);
    const recovery = { by: 'COAST_GUARD' as const, vehicleId: null, etaAt: eta, recoveredAt: null };
    renderSection(
      waterIncident({ waterSupport: coastGuard(eta), patientCount: 2 }),
      [patient(1, { recovery }), patient(2, { recovery })],
      [ambulance()],
    );
    const banners = await screen.findAllByTestId('patient-water');
    expect(banners).toHaveLength(2);
    for (const banner of banners) {
      expect(banner).toHaveAttribute('data-recovery', 'COAST_GUARD');
      expect(banner).toHaveTextContent('In acqua — la Guardia Costiera lo porta a riva');
      expect(banner).toHaveTextContent(/A riva tra 2:0[45]/);
    }
    expect(screen.getByTestId('patients-in-water')).toHaveTextContent('2 in acqua');
    expect(screen.getByTestId('patients-water-coast-guard')).toHaveTextContent(
      /^La Guardia Costiera li porta a riva tra 2:0[45]$/,
    );
    expect(screen.queryByTestId('patients-water-none')).not.toBeInTheDocument();
  });

  it('a boat on its way: it assesses them and brings them ashore, the land units after', async () => {
    renderSection(waterIncident(), [patient(1)], [boat({ status: 'EN_ROUTE' }), ambulance()]);
    expect(await screen.findByTestId('patients-water-unit')).toHaveTextContent(
      'Li valuta e li porta a riva un mezzo acquatico: i mezzi di terra al punto di raccolta intervengono dopo.',
    );
    expect(screen.queryByTestId('patients-water-none')).not.toBeInTheDocument();
  });

  it('RESOLVING with nobody on the water: the career’s boats one tap away (never an ambulance)', async () => {
    const other = ambulance({ id: 'veh_01J8Z0000000000000000000M2', callSign: 'MSB 2', status: 'AVAILABLE' });
    const option = (vehicleId: string) => ({
      vehicleId,
      etaSeconds: 95,
      distanceMeters: 2100,
      dispatchable: true,
      blockedReason: null,
      warnings: [],
      contributes: [],
      recommended: false,
    });
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [option(other.id), option(BOAT_ID)],
      recommendedVehicleIds: [],
      recommendationCoversRequired: true,
    } as never);
    vi.mocked(gameApi.dispatch).mockResolvedValue({} as never);
    renderSection(
      waterIncident({ status: 'RESOLVING' }),
      [patient(1)],
      [boat({ status: 'AVAILABLE', incidentId: null }), ambulance(), { ...other, incidentId: null }],
    );
    const send = await screen.findByTestId('send-water-unit');
    expect(screen.getAllByTestId('send-water-unit')).toHaveLength(1);
    expect(send).toHaveTextContent('Invia BOAT 1');
    fireEvent.click(send);
    await waitFor(() => expect(gameApi.dispatch).toHaveBeenCalledWith(CAREER_ID, INCIDENT_ID, [BOAT_ID]));
  });

  it('brought ashore: where, by whom — and the hospital transport is back', async () => {
    const past = inSeconds(-30);
    renderSection(
      waterIncident({ patientCount: 2 }),
      [
        patient(1, {
          location: 'ASHORE',
          status: 'AWAITING_TRANSPORT',
          triage: 'RED',
          transportRequired: true,
          recovery: { by: 'VEHICLE', vehicleId: BOAT_ID, etaAt: null, recoveredAt: past },
        }),
        patient(2, {
          location: 'ASHORE',
          status: 'ASSESSED',
          triage: 'BLUE',
          recovery: { by: 'COAST_GUARD', vehicleId: null, etaAt: null, recoveredAt: past },
        }),
      ],
      [boat({ status: 'RETURNING', incidentId: null })],
    );
    const cards = await screen.findAllByTestId('patient-card');
    expect(cards[0]).toHaveAttribute('data-patient-location', 'ASHORE');
    const first = within(cards[0]!).getByTestId('patient-ashore');
    expect(first).toHaveAttribute('data-recovered-by', 'VEHICLE');
    expect(first).toHaveTextContent('A riva al punto di raccolta · portato da BOAT 1');
    expect(within(cards[1]!).getByTestId('patient-ashore')).toHaveTextContent(
      'A riva al punto di raccolta · portato dalla Guardia Costiera',
    );
    expect(screen.queryByTestId('patient-water')).not.toBeInTheDocument();
    expect(screen.queryByTestId('patients-in-water')).not.toBeInTheDocument();
    expect(screen.queryByTestId('patient-transport-after-recovery')).not.toBeInTheDocument();
    // no ambulance on scene in this state: the transport block asks for one
    expect(within(cards[0]!).getByTestId('transport-missing-vehicle')).toBeInTheDocument();
  });

  it('just brought ashore and cared for at the meeting point: the section stays open (the landing does not fold it)', async () => {
    renderSection(
      waterIncident(),
      [
        patient(1, {
          location: 'ASHORE',
          status: 'ASSESSED',
          triage: 'BLUE',
          recovery: { by: 'VEHICLE', vehicleId: BOAT_ID, etaAt: null, recoveredAt: inSeconds(-5) },
        }),
      ],
      [boat(), ambulance()],
    );
    expect(await screen.findByTestId('patient-ashore')).toHaveTextContent('portato da BOAT 1');
    expect(screen.getByTestId('incident-patients')).toHaveAttribute('data-expanded', 'true');
  });

  it('a land incident is unchanged: collapsed by default, no water line', async () => {
    renderSection(
      incidentFixture({ patientCount: 1, status: 'ON_SCENE' }),
      [patient(1, { location: 'ASHORE', recovery: null })],
      [ambulance()],
    );
    await waitFor(() => expect(medicalApi.patients).toHaveBeenCalled());
    expect(screen.getByTestId('incident-patients')).toHaveAttribute('data-expanded', 'false');
    fireEvent.click(screen.getByTestId('patients-toggle'));
    const card = await screen.findByTestId('patient-card');
    expect(card).toHaveAttribute('data-patient-location', 'ASHORE');
    expect(screen.getByTestId('patients-unassessed')).not.toHaveAttribute('data-in-water');
    expect(screen.getByTestId('patients-unassessed')).toHaveTextContent('Triage in corso');
    expect(screen.queryByTestId('patient-water')).not.toBeInTheDocument();
    expect(screen.queryByTestId('patient-ashore')).not.toBeInTheDocument();
    expect(screen.queryByTestId('patients-in-water')).not.toBeInTheDocument();
  });
});
