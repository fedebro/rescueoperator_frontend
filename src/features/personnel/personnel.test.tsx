import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { PersonnelDto } from '@/contracts';
import { CatalogTextsOverride } from '@/i18n/catalog-texts';
import { qk } from '@/lib/api/query-keys';
import { observeServerTime, resetClockForTests } from '@/lib/clock';
import { renderWithIntl } from '@/test/render';
import { CareerProvider } from '@/features/game/hooks';
import { bandOf, fatigueAt } from './fatigue';
import { FatigueGauge } from './fatigue-gauge';
import { eligibleCourses } from './operator-sheet';
import type { Course } from './queries';
import { EMPTY_FILTERS, filterRoster } from './roster-tab';
import { DispatchCrewPreview, crewBlockOf } from './slots';
import { PersonnelStatusChip, TeamStatusChip } from './status';

const T0 = '2026-03-01T09:00:00.000Z';
const BUNDLE = {
  'fatigueBand.RESTED.name': 'Riposato',
  'fatigueBand.TIRED.name': 'Stanco',
  'fatigueBand.FATIGUED.name': 'Affaticato',
  'fatigueBand.REST_REQUIRED.name': 'Riposo obbligato',
  'role.DRIVER_OPERATOR.name': 'Autista',
  'qualification.HEAVY_VEHICLE_LICENSE.name': 'Patente mezzi pesanti',
};
const operator = (patch: Partial<PersonnelDto> = {}): PersonnelDto => ({
  id: 'per_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  firstName: 'Giulia',
  lastName: 'Rossi',
  roleCode: 'FIREFIGHTER',
  family: 'FIRE',
  facilityId: 'fac_1',
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

describe('fatigue helpers', () => {
  it('bands follow the 40 / 65 / 85 thresholds', () => {
    expect([39, 40, 64, 65, 84, 85].map(bandOf)).toEqual([
      'RESTED',
      'TIRED',
      'TIRED',
      'FATIGUED',
      'FATIGUED',
      'REST_REQUIRED',
    ]);
  });
  it('the anchored value is clamped to 0–100', () => {
    const anchor = { value: 90, ratePerSecond: -0.5, anchorAt: T0, band: 'REST_REQUIRED' as const };
    expect(fatigueAt(anchor, Date.parse(T0) + 20_000)).toBe(80);
    expect(fatigueAt(anchor, Date.parse(T0) + 1_000_000)).toBe(0);
    expect(fatigueAt({ ...anchor, ratePerSecond: 1 }, Date.parse(T0) + 60_000)).toBe(100);
  });
});

describe('FatigueGauge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    resetClockForTests();
    observeServerTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('animates from the anchor against the server clock and renames the band as it crosses a threshold', () => {
    renderWithIntl(
      <CatalogTextsOverride value={BUNDLE}>
        <FatigueGauge fatigue={{ value: 90, ratePerSecond: -1, anchorAt: T0, band: 'REST_REQUIRED' }} />
      </CatalogTextsOverride>,
    );
    const meter = screen.getByRole('meter', { name: 'Fatica' });
    expect(meter).toHaveAttribute('aria-valuenow', '90');
    expect(screen.getByText('Riposo obbligato')).toBeInTheDocument();
    expect(screen.getByText(/In recupero/)).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(meter).toHaveAttribute('aria-valuenow', '80');
    expect(meter).toHaveAttribute('data-band', 'FATIGUED');
    expect(screen.getByText('Affaticato')).toBeInTheDocument();
    expect(meter).toHaveAttribute('aria-valuetext', '80/100 · Affaticato');
  });
});

describe('status chips', () => {
  it('always pair an icon with a label', () => {
    renderWithIntl(
      <>
        <PersonnelStatusChip status="RESTING" />
        <TeamStatusChip status="PARTIAL" />
      </>,
    );
    expect(screen.getByText('A riposo').querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Parziale').closest('[data-status]')).toHaveAttribute('data-status', 'PARTIAL');
  });
});

describe('filterRoster', () => {
  const people = [
    operator({ id: 'per_1', facilityId: 'fac_1' }),
    operator({
      id: 'per_2',
      firstName: 'Marco',
      lastName: 'De Luca',
      roleCode: 'DRIVER_OPERATOR',
      facilityId: 'fac_2',
      status: 'RESTING',
      fatigue: { value: 70, ratePerSecond: 0, anchorAt: T0, band: 'FATIGUED' },
      qualifications: [{ code: 'HEAVY_VEHICLE_LICENSE', obtainedAt: T0, expiresAt: null }],
    }),
  ];
  const now = Date.parse(T0);
  const ids = (f: Partial<typeof EMPTY_FILTERS>) =>
    filterRoster(people, { ...EMPTY_FILTERS, ...f }, now).map((p) => p.id);
  it('combines every criterion', () => {
    expect(ids({})).toEqual(['per_1', 'per_2']);
    expect(ids({ search: 'de lu' })).toEqual(['per_2']);
    expect(ids({ facility: 'fac_1' })).toEqual(['per_1']);
    expect(ids({ role: 'DRIVER_OPERATOR', status: 'RESTING', band: 'FATIGUED' })).toEqual(['per_2']);
    expect(ids({ qualification: 'HEAVY_VEHICLE_LICENSE', family: 'FIRE' })).toEqual(['per_2']);
    expect(ids({ band: 'REST_REQUIRED' })).toEqual([]);
  });
});

describe('eligibleCourses', () => {
  const course = (patch: Partial<Course>): Course => ({
    code: 'C',
    name: { key: 'course.C.name' },
    description: { key: 'course.C.description' },
    family: 'FIRE',
    grantsQualification: 'Q',
    prerequisites: [],
    eligibleRoles: ['FIREFIGHTER'],
    cost: '60',
    durationSeconds: 90,
    requiredLevel: 1,
    unlocked: true,
    ...patch,
  });
  it('checks role, prerequisites, level lock and qualifications already held', () => {
    const courses = [
      course({ code: 'OK' }),
      course({ code: 'LOCKED', unlocked: false }),
      course({ code: 'OTHER_ROLE', eligibleRoles: ['NURSE'] }),
      course({ code: 'NEEDS', prerequisites: ['HEAVY_VEHICLE_LICENSE'] }),
      course({ code: 'HELD', grantsQualification: 'BLSD' }),
    ];
    const op = operator({ qualifications: [{ code: 'BLSD', obtainedAt: T0, expiresAt: null }] });
    expect(eligibleCourses(op, courses).map((c) => c.code)).toEqual(['OK']);
  });
});

describe('DispatchCrewPreview', () => {
  const option = {
    vehicleId: 'veh_1',
    etaSeconds: 60,
    distanceMeters: 1200,
    dispatchable: false,
    blockedReason: 'CREW_UNQUALIFIED',
    warnings: [],
    contributes: [],
    recommended: false,
    crew: {
      available: 3,
      min: 3,
      optimal: 5,
      missingQualifications: ['DRIVER_OPERATOR', 'HEAVY_VEHICLE_LICENSE'],
      maxFatigueBand: 'TIRED' as const,
      efficiency: 0.76,
    },
  };
  const renderOption = (o: typeof option) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Roles come from the catalog: a code listed there is a ROLE, anything else a qualification.
    qc.setQueryData(qk.catalog('car_1'), { roles: [{ code: 'DRIVER_OPERATOR' }] });
    return renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value="car_1">
          <CatalogTextsOverride value={BUNDLE}>
            <DispatchCrewPreview option={o as never} />
          </CatalogTextsOverride>
        </CareerProvider>
      </QueryClientProvider>,
    );
  };
  it('shows numbers, efficiency, what is missing and the way to fix the block', () => {
    renderOption(option);
    expect(screen.getByText('Equipaggio 3/5 (min 3)')).toBeInTheDocument();
    expect(screen.getByText('Efficienza 76%')).toBeInTheDocument();
    expect(screen.getByText('Manca: Autista')).toBeInTheDocument();
    expect(screen.getByText('Manca: Patente mezzi pesanti')).toBeInTheDocument();
    expect(screen.getByText('Equipaggio senza i requisiti')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assumi o forma il personale' })).toHaveAttribute(
      'href',
      '/game/personnel?tab=recruitment',
    );
  });
  it('sends an exhausted crew to the roster, and renders nothing without a crew preview', () => {
    const { unmount } = renderOption({ ...option, blockedReason: 'CREW_EXHAUSTED' });
    expect(screen.getByTestId('crew-fix-link')).toHaveAttribute('href', '/game/personnel?tab=roster');
    unmount();
    const { container } = renderOption({ ...option, crew: undefined } as never);
    expect(container).toBeEmptyDOMElement();
    expect(crewBlockOf({ ...option, blockedReason: 'VEHICLE_NOT_AVAILABLE' } as never)).toBeNull();
  });
});
