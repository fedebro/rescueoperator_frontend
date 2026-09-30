import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { z } from 'zod';
import type { HospitalDto, IncidentDto, PatientDto, VehicleDto } from '@/contracts';
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
import { canLoadAndGo } from './hooks';
import { IncidentPatients } from './incident-patients';

vi.mock('@/lib/api/endpoints', () => ({
  gameApi: { sync: vi.fn(), catalog: vi.fn(), dispatchOptions: vi.fn(), dispatch: vi.fn() },
}));
vi.mock('@/lib/api/depth', () => ({
  medicalApi: { patients: vi.fn(), hospitals: vi.fn(), hospitalOptions: vi.fn(), transport: vi.fn() },
}));

/**
 * "Load and go" (D-101): a patient nobody on scene can stabilise (a need not covered — the server does not even start the
 * treatment) and who needs a hospital can be taken there at once, as they are. On scene an untreated RED patient can die
 * (D-100), in the ambulance they cannot: the card offers it instead of the old "transport as soon as possible" with no button.
 */
const AMBULANCE_ID = 'veh_01J8Z0000000000000000000MS';
const HOSPITAL_ID = 'hos_01J8Z0000000000000000000H1';
const hospital: z.infer<typeof HospitalDto> = {
  id: HOSPITAL_ID,
  name: 'Ospedale Santo Spirito',
  position: [14.2, 42.46],
  capabilities: ['GENERAL_EMERGENCY', 'TRAUMA_CENTER'],
  load: 'NORMAL',
  hasHelipad: true,
};
const patient = (patch: Partial<PatientDto> = {}): PatientDto => ({
  id: 'pat_01J8Z000000000000000000001',
  incidentId: INCIDENT_ID,
  label: 'Paziente 1',
  profileCode: 'PP_MAJOR_TRAUMA',
  triage: 'RED',
  status: 'ASSESSED',
  stability: { value: 40, ratePerSecond: -0.1, anchorAt: new Date().toISOString() },
  needs: [
    { capability: 'MEDICAL_BASIC', met: true },
    { capability: 'MEDICAL_ADVANCED', met: false },
  ],
  transportRequired: true,
  assignedVehicleId: null,
  hospitalId: null,
  busyUntil: null,
  location: 'ASHORE',
  recovery: null,
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
const landIncident = (patch: Partial<IncidentDto> = {}): IncidentDto =>
  incidentFixture({ status: 'ON_SCENE', patientCount: 1, ...patch });
const catalog = { vehicleTypes: [{ code: 'EMS_MSB', domain: 'GROUND', tags: [] }] };

function renderSection(
  incident: IncidentDto,
  patients: PatientDto[],
  vehicles: VehicleDto[] = [ambulance()],
) {
  vi.mocked(medicalApi.patients).mockResolvedValue(patients);
  vi.mocked(medicalApi.hospitals).mockResolvedValue([hospital]);
  vi.mocked(medicalApi.hospitalOptions).mockResolvedValue([
    {
      hospitalId: HOSPITAL_ID,
      etaSeconds: 420,
      compatible: true,
      load: 'NORMAL',
      expectedHandoffSeconds: 45,
      score: 0.9,
      recommended: true,
      reasons: [],
    },
  ]);
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

describe('canLoadAndGo', () => {
  it('only for an assessed patient at the scene who needs a hospital and care nobody here can give', () => {
    expect(canLoadAndGo(patient())).toBe(true);
    // an older server: no location = ashore
    expect(canLoadAndGo(patient({ location: undefined }))).toBe(true);
    // still in the water: a boat brings them ashore first
    expect(canLoadAndGo(patient({ location: 'WATER' }))).toBe(false);
    // no hospital needed, or not known yet
    expect(canLoadAndGo(patient({ transportRequired: false }))).toBe(false);
    expect(canLoadAndGo(patient({ transportRequired: null }))).toBe(false);
    // everything it needs is covered: the treatment runs
    expect(canLoadAndGo(patient({ needs: [{ capability: 'MEDICAL_BASIC', met: true }] }))).toBe(false);
    // being treated, stabilised, already waiting for (or on) the transport
    for (const status of [
      'TREATING',
      'STABILIZED',
      'AWAITING_TRANSPORT',
      'IN_TRANSPORT',
      'DECEASED',
    ] as const)
      expect(canLoadAndGo(patient({ status }))).toBe(false);
  });
});

describe('IncidentPatients: load and go', () => {
  beforeEach(() => {
    useUiStore.setState({ selection: null });
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [],
      recommendedVehicleIds: [],
      recommendationCoversRequired: true,
    } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it('offers "take to hospital now" for a RED patient the ambulance alone cannot stabilise, and sends them as they are', async () => {
    renderSection(landIncident(), [patient()]);
    const card = await screen.findByTestId('patient-card');
    // a decision is waiting: the section opens by itself
    expect(screen.getByTestId('incident-patients')).toHaveAttribute('data-expanded', 'true');
    expect(within(card).getByTestId('patient-needs')).toHaveTextContent(
      'invia un mezzo adatto oppure trasportalo subito in ospedale',
    );
    // the hospital choice opens on the tap: waiting for a suitable unit stays a choice too
    expect(within(card).queryByTestId('transport-panel')).not.toBeInTheDocument();
    fireEvent.click(within(card).getByTestId('load-and-go'));
    const panel = await within(card).findByTestId('transport-panel');
    expect(panel).toHaveAttribute('data-mode', 'load-and-go');
    expect(panel).toHaveTextContent('Trasporto immediato');
    expect(panel).toHaveTextContent('Qui non può essere stabilizzato');
    // nothing leaves by itself here (no automatic confirmation)
    expect(panel).not.toHaveTextContent('confermato automaticamente');
    expect(within(panel).getByTestId('transport-carrier')).toHaveTextContent('MSB 1');

    vi.mocked(medicalApi.transport).mockResolvedValue({
      patient: patient({ status: 'IN_TRANSPORT', assignedVehicleId: AMBULANCE_ID, hospitalId: HOSPITAL_ID }),
      vehicle: ambulance({ status: 'TRANSPORTING' }),
      boarded: [],
    } as never);
    fireEvent.click(await within(panel).findByTestId('confirm-recommended-hospital'));
    await waitFor(() =>
      expect(medicalApi.transport).toHaveBeenCalledWith(CAREER_ID, patient().id, {
        hospitalId: HOSPITAL_ID,
        vehicleId: AMBULANCE_ID,
      }),
    );
  });

  it('no ambulance on scene: the same block asks for one', async () => {
    renderSection(landIncident(), [patient()], [ambulance({ status: 'RETURNING', incidentId: null })]);
    fireEvent.click(await screen.findByTestId('load-and-go'));
    expect(await screen.findByTestId('transport-missing-vehicle')).toBeInTheDocument();
  });

  it('never for somebody the units here can treat or who needs no hospital (and no decision opens the section)', async () => {
    renderSection(landIncident({ patientCount: 2 }), [
      patient({ status: 'TREATING', needs: [{ capability: 'MEDICAL_BASIC', met: true }] }),
      patient({ id: 'pat_01J8Z000000000000000000002', label: 'Paziente 2', transportRequired: false }),
    ]);
    await waitFor(() => expect(medicalApi.patients).toHaveBeenCalled());
    expect(screen.getByTestId('incident-patients')).toHaveAttribute('data-expanded', 'false');
    fireEvent.click(screen.getByTestId('patients-toggle'));
    expect(await screen.findAllByTestId('patient-card')).toHaveLength(2);
    expect(screen.queryByTestId('load-and-go')).not.toBeInTheDocument();
  });
});
