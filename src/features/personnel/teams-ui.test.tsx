import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FacilityDto, PersonnelDto, TeamDto, TeamProposalDto, VehicleDto } from '@/contracts';
import type { z } from 'zod';
import { CatalogTextsOverride } from '@/i18n/catalog-texts';
import { renderWithIntl } from '@/test/render';
import { snapshot, vehicle } from '@/test/fixtures';
import { useToastStore } from '@/stores/toast';

type Team = z.infer<typeof TeamDto>;
type Proposal = z.infer<typeof TeamProposalDto>;

const T0 = '2026-03-01T09:00:00.000Z';
const state = vi.hoisted(() => ({
  snapshot: null as unknown,
  people: [] as unknown[],
  teams: [] as unknown[],
  proposal: null as unknown,
  patch: vi.fn(),
  formTeam: vi.fn(),
  disbandTeam: vi.fn(),
  transferTeam: vi.fn(),
  transferVehicle: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/game/hooks', () => ({
  useSnapshot: () => state.snapshot,
  useCareerId: () => 'car_TEST',
  usePatchSnapshot: () => state.patch,
  useCatalog: () => ({ features: [{ feature: 'TEAMS', requiredLevel: 4, unlocked: true }], roles: [] }),
  useVehicleTypeLookup: () => () => ({
    compatibleFacilityTypes: ['FIRE_LOCAL_STATION'],
    domain: 'GROUND',
    capacityPoints: 2,
  }),
}));
vi.mock('@/lib/api/depth', () => ({
  personnelApi: {
    list: () => Promise.resolve(state.people),
    teams: () => Promise.resolve(state.teams),
    teamProposal: () => Promise.resolve(state.proposal),
    formTeam: state.formTeam,
    disbandTeam: state.disbandTeam,
    transferTeam: state.transferTeam,
    setTeamVehicle: vi.fn(),
    setTeamMembers: vi.fn(),
    updateTeam: vi.fn(),
  },
  facilitiesApi: { transferVehicle: state.transferVehicle },
}));

import {
  DisbandTeamDialog,
  FormTeamDialog,
  TransferTeamDialog,
  canTravel,
  teamTargets,
} from './team-actions';
import { TeamsTab, useTeamWarning } from './teams-tab';
import { VehicleCrewSection } from './slots';
import { TransferVehicleButton } from '@/features/facilities/transfer-vehicle';

const HQ = 'fac_01J8Z0000000000000000000AA';
const NORTH = 'fac_01J8Z0000000000000000000BB';
const facility = (id: string, patch: Partial<FacilityDto> = {}): FacilityDto => ({
  id,
  typeCode: 'FIRE_LOCAL_STATION',
  family: 'FIRE',
  name: id === HQ ? 'Comando Pindaro' : 'Caserma Nord',
  position: [14.21, 42.46],
  status: 'OPERATIONAL',
  capacities: [
    { domain: 'GROUND', total: 6, used: 2 },
    { domain: 'PERSONNEL', total: 12, used: 6 },
  ],
  upgrades: [],
  ...patch,
});
const person = (n: number, patch: Partial<PersonnelDto> = {}): PersonnelDto => ({
  id: `per_01J8Z000000000000000000P0${n}`,
  firstName: ['Giulia', 'Marco', 'Sara', 'Luca', 'Elena', 'Paolo'][n]!,
  lastName: 'Rossi',
  roleCode: n === 0 ? 'TEAM_LEADER' : 'FIREFIGHTER',
  family: 'FIRE',
  facilityId: HQ,
  teamId: null,
  status: 'AVAILABLE',
  competence: 50,
  fatigue: { value: 0, ratePerSecond: 0, anchorAt: T0, band: 'RESTED' },
  qualifications: [],
  missions: 0,
  hiredAt: T0,
  busyUntil: null,
  busyReason: null,
  costPerPeriod: '4',
  ...patch,
});
const TEAM_ID = 'tem_01J8Z0000000000000000000T1';
const team = (patch: Partial<Team> = {}): Team => ({
  id: TEAM_ID,
  name: 'Prima partenza',
  facilityId: HQ,
  departmentId: null,
  vehicleId: vehicle().id,
  leaderId: person(0).id,
  memberIds: [0, 1, 2].map((n) => person(n).id),
  status: 'READY',
  readiness: 1,
  warnings: [],
  transferUntil: null,
  ...patch,
});
const proposal = (patch: Partial<Proposal> = {}): Proposal => ({
  vehicleId: vehicle().id,
  facilityId: HQ,
  memberIds: [0, 1, 2].map((n) => person(n).id),
  leaderId: person(0).id,
  min: 3,
  optimal: 5,
  available: 3,
  remainingFree: 0,
  missingRoles: [],
  missingQualifications: [],
  efficiency: 0.8,
  teamId: null,
  ...patch,
});

function setWorld(
  o: {
    facilities?: FacilityDto[];
    vehicles?: VehicleDto[];
    people?: PersonnelDto[];
    teams?: Team[];
    proposal?: Proposal;
  } = {},
) {
  state.snapshot = snapshot({
    career: { ...snapshot().career, level: 5 },
    facilities: o.facilities ?? [facility(HQ), facility(NORTH)],
    vehicles: o.vehicles ?? [vehicle({ facilityId: HQ })],
  });
  state.people = o.people ?? [0, 1, 2, 3, 4, 5].map((n) => person(n));
  state.teams = o.teams ?? [];
  state.proposal = o.proposal ?? proposal();
}
const ui = (node: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <CatalogTextsOverride
        value={{
          'role.FIREFIGHTER.name': 'Vigile del fuoco',
          'role.TEAM_LEADER.name': 'Caposquadra VF',
          'vehicle.FIRE_APS.name': 'Autopompa',
          'qualification.HEAVY_VEHICLE_LICENSE.name': 'Patente mezzi pesanti',
          'fatigueBand.RESTED.name': 'Riposato',
        }}
      >
        {node}
      </CatalogTextsOverride>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] } as never);
  setWorld();
});

describe('teamTargets', () => {
  const type = { compatibleFacilityTypes: ['FIRE_LOCAL_STATION'], domain: 'GROUND', capacityPoints: 2 };
  it('says why a facility cannot take the team: the vehicle first, then the beds of the operators', () => {
    const facilities = [
      facility(HQ),
      facility('fac_OK', { name: 'Libera' }),
      facility('fac_FULLGARAGE', {
        capacities: [
          { domain: 'GROUND', total: 6, used: 6 },
          { domain: 'PERSONNEL', total: 12, used: 0 },
        ],
      }),
      facility('fac_NOBEDS', {
        capacities: [
          { domain: 'GROUND', total: 6, used: 0 },
          { domain: 'PERSONNEL', total: 12, used: 10 },
        ],
      }),
      facility('fac_BUILDING', { status: 'UNDER_CONSTRUCTION' }),
      facility('fac_EMS', { typeCode: 'EMS_POST' }),
    ];
    const rows = teamTargets({ facilityId: HQ }, vehicle({ facilityId: HQ }), type, facilities, 5);
    const stateOf = (id: string) => rows.find((r) => r.facility.id === id)!.state;
    expect(stateOf(HQ)).toBe('CURRENT');
    expect(stateOf('fac_OK')).toBe('OK');
    expect(stateOf('fac_FULLGARAGE')).toBe('FULL');
    expect(stateOf('fac_NOBEDS')).toBe('NO_BEDS');
    expect(stateOf('fac_BUILDING')).toBe('NOT_OPERATIONAL');
    expect(stateOf('fac_EMS')).toBe('INCOMPATIBLE');
    expect(rows[0]!.state).toBe('OK'); // valid ones first
    expect(rows.find((r) => r.facility.id === 'fac_NOBEDS')!.free).toBe(2);
  });
  it('a team without a vehicle only needs operational facilities with beds', () => {
    const rows = teamTargets({ facilityId: HQ }, undefined, undefined, [facility(HQ), facility(NORTH)], 3);
    expect(rows.map((r) => r.state)).toEqual(['OK', 'CURRENT']);
  });
  it('only operators that are idle can travel', () => {
    expect(['AVAILABLE', 'ASSIGNED'].every((status) => canTravel({ status } as never))).toBe(true);
    expect(
      ['RESTING', 'TRAINING', 'INJURED', 'ON_MISSION', 'ONBOARDING'].some((status) =>
        canTravel({ status } as never),
      ),
    ).toBe(false);
  });
});

describe('FormTeamDialog', () => {
  it('shows the crew the game proposes and forms the team with one tap, named after the vehicle', async () => {
    state.formTeam.mockResolvedValue(team({ name: 'Squadra APS 1' }));
    const onClose = vi.fn();
    ui(<FormTeamDialog vehicle={vehicle({ facilityId: HQ })} onClose={onClose} />);
    expect(await screen.findByText('Squadra consigliata: 3 operatori su 5 (minimo 3)')).toBeInTheDocument();
    const list = screen.getByTestId('proposal-members');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText(/Giulia Rossi/)).toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveValue('Squadra APS 1');
    fireEvent.click(screen.getByTestId('confirm-form-team'));
    await waitFor(() => expect(state.formTeam).toHaveBeenCalledTimes(1));
    expect(state.formTeam).toHaveBeenCalledWith('car_TEST', {
      vehicleId: vehicle().id,
      name: 'Squadra APS 1',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('tells what is missing without blocking: under the minimum, a REQUIRED qualification, and what the other vehicles will need', async () => {
    setWorld({
      vehicles: [
        vehicle({ facilityId: HQ }),
        vehicle({ id: 'veh_01J8Z0000000000000000000BB', callSign: 'APS 2', facilityId: HQ }),
      ],
      proposal: proposal({
        memberIds: [person(0).id, person(1).id],
        min: 3,
        available: 4,
        remainingFree: 2,
        missingQualifications: ['HEAVY_VEHICLE_LICENSE'],
        efficiency: 0,
      }),
    });
    ui(<FormTeamDialog vehicle={vehicle({ facilityId: HQ })} onClose={vi.fn()} />);
    expect(await screen.findByText('Squadra consigliata: 2 operatori su 5 (minimo 3)')).toBeInTheDocument();
    expect(screen.getByText(/Sono meno del minimo \(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/Nessuno ha la qualifica «Patente mezzi pesanti»/)).toBeInTheDocument();
    // APS 2 needs 3 to leave and only 2 free operators are left at Comando Pindaro.
    expect(screen.getByTestId('proposal-others')).toHaveTextContent('restano 2 operatori liberi');
    expect(screen.getByTestId('proposal-others')).toHaveTextContent('APS 2 ne richiede almeno 3');
    expect(screen.getByTestId('confirm-form-team')).toBeEnabled();
  });

  it('with nobody free it explains why and sends to the hiring, instead of forming an empty team', async () => {
    setWorld({ proposal: proposal({ memberIds: [], leaderId: null, available: 0, efficiency: 0 }) });
    ui(<FormTeamDialog vehicle={vehicle({ facilityId: HQ })} onClose={vi.fn()} />);
    expect(await screen.findByTestId('no-free-operators')).toHaveTextContent(
      'Nessun operatore libero adatto',
    );
    expect(screen.getByRole('link', { name: 'Vai alle assunzioni' })).toHaveAttribute(
      'href',
      '/game/personnel?tab=recruitment',
    );
    expect(screen.getByTestId('confirm-form-team')).toBeDisabled();
  });

  it('is closed while no vehicle is given', () => {
    ui(<FormTeamDialog vehicle={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId('form-team-dialog')).toBeNull();
  });
});

describe('DisbandTeamDialog', () => {
  it('says what happens to the operators and the vehicle, then dissolves', async () => {
    state.disbandTeam.mockResolvedValue(undefined);
    setWorld({ people: [person(0), person(1, { status: 'ON_MISSION' }), person(2)] });
    const onClose = vi.fn();
    ui(<DisbandTeamDialog team={team()} onClose={onClose} />);
    const dialog = await screen.findByTestId('disband-dialog');
    expect(within(dialog).getByText('Sciogliere «Prima partenza»?')).toBeInTheDocument();
    expect(within(dialog).getByText('3 operatori restano in organico e tornano liberi.')).toBeInTheDocument();
    expect(
      within(dialog).getByText('APS 1 resta dov’è e torna a equipaggio automatico.'),
    ).toBeInTheDocument();
    // The roster loads on its own: the mission line appears once it is there.
    expect(
      await within(dialog).findByText('1 operatore è in missione: finisce l’intervento e poi torna libero.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-disband'));
    await waitFor(() => expect(state.disbandTeam).toHaveBeenCalledWith('car_TEST', TEAM_ID));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('TransferTeamDialog', () => {
  it('names who stays behind, lists the destinations with their state and sends the team to the chosen one', async () => {
    setWorld({
      people: [person(0), person(1, { status: 'RESTING' }), person(2)],
      facilities: [
        facility(HQ),
        facility(NORTH),
        facility('fac_01J8Z0000000000000000000CC', {
          name: 'Piccola',
          capacities: [
            { domain: 'GROUND', total: 6, used: 0 },
            { domain: 'PERSONNEL', total: 12, used: 11 },
          ],
        }),
      ],
    });
    const moved = {
      team: team({ facilityId: NORTH, transferUntil: T0 }),
      vehicle: vehicle({ facilityId: NORTH, status: 'IN_DELIVERY' }),
      facilities: [facility(HQ), facility(NORTH)],
    };
    state.transferTeam.mockResolvedValue(moved);
    const onClose = vi.fn();
    ui(<TransferTeamDialog team={team()} onClose={onClose} />);
    const dialog = await screen.findByTestId('transfer-team-dialog');
    expect(
      within(dialog).getByText(
        'Parte insieme a APS 1: viaggiano e arrivano insieme, nel frattempo non sono disponibili.',
      ),
    ).toBeInTheDocument();
    expect(await within(dialog).findByTestId('team-staying')).toHaveTextContent(
      '1 operatore non può partire adesso e resta qui, fuori dalla squadra: Marco Rossi.',
    );
    const targets = within(dialog).getAllByTestId('team-transfer-target');
    expect(targets.map((t) => t.getAttribute('data-state'))).toEqual(['OK', 'CURRENT', 'NO_BEDS']);
    expect(targets[2]).toHaveTextContent('Alloggi insufficienti: 1 liberi, ne servono 2');
    expect(targets[2]).toBeDisabled();
    fireEvent.click(targets[0]!);
    await waitFor(() => expect(state.transferTeam).toHaveBeenCalledWith('car_TEST', TEAM_ID, NORTH));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The answer already carries the vehicle and both facilities: the snapshot is patched without waiting for the realtime event.
    expect(state.patch).toHaveBeenCalled();
    const toast = useToastStore.getState().toasts[0];
    expect(toast?.title).toBe('Squadra «Prima partenza» in viaggio verso Caserma Nord');
  });

  it('says the refusal in plain words (the backend reason), not a generic error', async () => {
    const { ApiClientError } = await import('@/lib/api/errors');
    state.transferTeam.mockRejectedValue(
      new ApiClientError({
        code: 'CONFLICT',
        message: 'x',
        status: 409,
        details: { reason: 'TEAM_NOT_READY' },
      }),
    );
    ui(<TransferTeamDialog team={team()} onClose={vi.fn()} />);
    const targets = await screen.findAllByTestId('team-transfer-target');
    fireEvent.click(targets[0]!);
    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0));
    expect(useToastStore.getState().toasts[0]?.title).toMatch(
      /Nessun operatore della squadra può partire adesso/,
    );
  });
});

describe('TeamsTab', () => {
  it('starts from the vehicles: with no team it says that is fine and offers "Forma squadra" on each vehicle', async () => {
    ui(<TeamsTab onSelect={vi.fn()} />);
    expect(await screen.findByText('Nessuna squadra: va bene così')).toBeInTheDocument();
    expect(screen.getByTestId('teams-intro')).toHaveTextContent(
      'Una squadra è l’equipaggio fisso di un mezzo',
    );
    const rows = screen.getAllByTestId('team-less-vehicle');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('APS 1');
    expect(rows[0]).toHaveTextContent('Equipaggio automatico');
    fireEvent.click(within(rows[0]!).getByTestId('form-team'));
    expect(await screen.findByTestId('form-team-dialog')).toBeInTheDocument();
    // No "department" anywhere: that concept is retired.
    expect(screen.queryByText(/reparto/i)).toBeNull();
  });

  it('a team shows its vehicle, its members, the automatic leader and the three things to do with it', async () => {
    setWorld({
      teams: [team()],
      people: [0, 1, 2].map((n) => person(n, { teamId: TEAM_ID, status: 'ASSIGNED' })),
    });
    ui(<TeamsTab onSelect={vi.fn()} />);
    const card = await screen.findByTestId('team-card');
    expect(card).toHaveAttribute('data-team-status', 'READY');
    expect(within(card).getByText('Prima partenza')).toBeInTheDocument();
    expect(within(card).getByLabelText('Caposquadra')).toBeInTheDocument();
    expect(within(card).getByTestId('edit-members')).toBeInTheDocument();
    expect(within(card).getByTestId('team-transfer')).toHaveTextContent('Trasferisci con il mezzo');
    expect(within(card).getByTestId('team-disband')).toHaveTextContent('Scioglila');
    // The vehicle already has its team: it is not offered again.
    expect(screen.queryByTestId('team-less-vehicles')).toBeNull();
    fireEvent.click(within(card).getByTestId('team-disband'));
    expect(await screen.findByTestId('disband-dialog')).toBeInTheDocument();
  });

  it('a team on the road is frozen and shows when it arrives', async () => {
    const until = new Date(Date.now() + 600_000).toISOString();
    setWorld({
      teams: [team({ transferUntil: until, status: 'UNAVAILABLE', warnings: ['MEMBER_UNAVAILABLE'] })],
      people: [0, 1, 2].map((n) => person(n, { teamId: TEAM_ID, status: 'TRANSFERRING' })),
    });
    ui(<TeamsTab onSelect={vi.fn()} />);
    const card = await screen.findByTestId('team-card');
    expect(within(card).getByTestId('team-travelling')).toHaveTextContent('In viaggio verso la nuova sede');
    expect(within(card).getByTestId('team-transfer')).toBeDisabled();
    expect(within(card).getByTestId('edit-members')).toBeDisabled();
    // The backend's warning code reads as a sentence, not as a raw code.
    expect(within(card).getByTestId('team-warnings')).toHaveTextContent('Alcuni membri non sono disponibili');
  });
});

describe('useTeamWarning', () => {
  it('turns the warning codes of the backend into sentences, with the qualification named', () => {
    function Probe() {
      const text = useTeamWarning();
      return (
        <ul>
          {[
            'NO_MEMBERS',
            'NO_VEHICLE',
            'BELOW_MIN_CREW',
            'BELOW_OPTIMAL_CREW',
            'MEMBER_FATIGUED',
            'MEMBER_UNAVAILABLE',
            'MISSING_QUALIFICATION:HEAVY_VEHICLE_LICENSE',
          ].map((w) => (
            <li key={w}>{text(w)}</li>
          ))}
        </ul>
      );
    }
    ui(<Probe />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items.every((t) => t && !/^[A-Z_]+(:|$)/.test(t))).toBe(true);
    expect(items[6]).toBe('Manca la qualifica richiesta dal mezzo: Patente mezzi pesanti.');
  });
});

describe('VehicleCrewSection (the vehicle sheet)', () => {
  it('offers "Forma squadra" while the vehicle has no team', async () => {
    ui(<VehicleCrewSection vehicle={vehicle({ facilityId: HQ })} />);
    expect(await screen.findByText(/Nessuna squadra: l’equipaggio si compone da solo/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('vehicle-form-team'));
    expect(await screen.findByTestId('form-team-dialog')).toBeInTheDocument();
  });

  it('with a team it links to its management and dissolves it from the sheet', async () => {
    setWorld({ teams: [team()], people: [0, 1, 2].map((n) => person(n, { teamId: TEAM_ID })) });
    ui(<VehicleCrewSection vehicle={vehicle({ facilityId: HQ })} />);
    const manage = await screen.findByTestId('vehicle-team-manage');
    expect(manage).toHaveAttribute('href', `/game/personnel?tab=teams&team=${TEAM_ID}`);
    expect(screen.queryByTestId('vehicle-form-team')).toBeNull();
    fireEvent.click(screen.getByTestId('vehicle-team-disband'));
    expect(await screen.findByTestId('disband-dialog')).toBeInTheDocument();
  });
});

describe('TransferVehicleButton with a team', () => {
  it('moves vehicle and team together by default, and leaves the team behind when asked', async () => {
    setWorld({
      teams: [team()],
      people: [0, 1, 2].map((n) => person(n, { teamId: TEAM_ID, status: 'ASSIGNED' })),
    });
    state.transferVehicle.mockResolvedValue({
      vehicle: vehicle({ facilityId: NORTH, status: 'IN_DELIVERY' }),
      facilities: [facility(HQ), facility(NORTH)],
    });
    ui(<TransferVehicleButton vehicle={vehicle({ facilityId: HQ })} />);
    const trigger = await screen.findByTestId('transfer-vehicle');
    await waitFor(() => expect(trigger).toHaveTextContent('Trasferisci mezzo e squadra'));
    fireEvent.click(trigger);
    const option = await screen.findByTestId('transfer-team-option');
    expect(option).toHaveTextContent('Il mezzo e 3 operatori viaggiano insieme e arrivano insieme.');
    fireEvent.click(within(screen.getByTestId('transfer-dialog')).getAllByTestId('transfer-target')[0]!);
    await waitFor(() =>
      expect(state.transferVehicle).toHaveBeenCalledWith('car_TEST', vehicle().id, NORTH, true),
    );

    // The dialog closed after the trip; open it again and leave the team behind this time.
    state.transferVehicle.mockClear();
    await waitFor(() => expect(screen.queryByTestId('transfer-dialog')).toBeNull());
    fireEvent.click(trigger);
    const again = await screen.findByTestId('transfer-team-option');
    fireEvent.click(within(again).getByRole('checkbox'));
    expect(again).toHaveTextContent('La squadra resta qui, libera e senza mezzo');
    fireEvent.click(within(screen.getByTestId('transfer-dialog')).getAllByTestId('transfer-target')[0]!);
    await waitFor(() =>
      expect(state.transferVehicle).toHaveBeenCalledWith('car_TEST', vehicle().id, NORTH, false),
    );
  });

  it('a vehicle without a team transfers as always (no team option, no team flag)', async () => {
    state.transferVehicle.mockResolvedValue({
      vehicle: vehicle({ facilityId: NORTH }),
      facilities: [facility(HQ), facility(NORTH)],
    });
    ui(<TransferVehicleButton vehicle={vehicle({ facilityId: HQ })} />);
    fireEvent.click(await screen.findByTestId('transfer-vehicle'));
    expect(screen.queryByTestId('transfer-team-option')).toBeNull();
    fireEvent.click(
      within(await screen.findByTestId('transfer-dialog')).getAllByTestId('transfer-target')[0]!,
    );
    await waitFor(() =>
      expect(state.transferVehicle).toHaveBeenCalledWith('car_TEST', vehicle().id, NORTH, undefined),
    );
  });
});
