import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { MilestoneDto, SyncSnapshot } from '@/contracts';
import { CatalogTextsOverride } from '@/i18n/catalog-texts';
import { renderWithIntl } from '@/test/render';
import { useUiStore } from '@/stores/ui';
import {
  DEFAULT_RINGS,
  UNREACHABLE_BIN,
  binOf,
  cellSeconds,
  coverageFeatures,
  hatchImage,
  legendBins,
  type CoverageDto,
} from './coverage-geo';
import { LayersPanel } from './layers-panel';
import { MilestonesCard, ReputationCard, groupByPhase, reputationBand } from './progression-extras';
import { StipendCard } from './stipend-card';
import { durationParts } from './use-world';
import { WorldDetails, travelDelay } from './world-widget';

const future = (s: number) => new Date(Date.now() + s * 1000).toISOString();

const world: SyncSnapshot['world'] = {
  localTime: '2026-09-20T10:00:00.000Z',
  timezone: 'Europe/Rome',
  dayPhase: 'DAY',
  weather: { code: 'HEAVY_RAIN', temperatureC: 14, windKmh: 32, degraded: true },
  trafficLevel: 'HEAVY',
  closures: [
    {
      id: 'rst_1',
      polygon: [
        [14.21, 42.46],
        [14.211, 42.46],
        [14.211, 42.461],
        [14.21, 42.46],
      ],
      reason: { key: 'world.closure.ROADWORKS', params: { street: 'Via Nicola Fabrizi' } },
      endsAt: future(600),
      kind: 'FULL',
      multiplier: 1.6,
    },
  ],
  hourBand: 'MORNING',
  season: 'AUTUMN',
  weekdayType: 'SUNDAY',
  trafficMultiplier: 1.34,
  weatherSource: 'simulated',
};

const coverage: CoverageDto = {
  computedAt: '2026-09-20T10:00:00.000Z',
  targetSeconds: 720,
  overallPct: 61.5,
  byFamily: [
    { family: 'FIRE', pct: 82, thresholdSeconds: 720, weight: 1, populationCovered: 97_000, active: true },
    { family: 'EMS', pct: 41, thresholdSeconds: 600, weight: 1, populationCovered: 48_000, active: false },
  ],
  cells: [
    { h3: '881e8d0a01fffff', population: 900, bestSeconds: 240, secondsByFamily: { FIRE: 240, EMS: 700 } },
    { h3: '881e8d0a03fffff', population: 500, bestSeconds: 1000, secondsByFamily: { FIRE: 1000 } },
    { h3: '881e8d0a05fffff', population: 100, bestSeconds: null, secondsByFamily: {} },
    { h3: '881e8d0a07fffff', population: 100, bestSeconds: 100, inArea: false },
  ],
  method: 'STRAIGHT_LINE',
  isochroneSeconds: DEFAULT_RINGS,
  stale: true,
};

const stipend = {
  periodSeconds: 14_400,
  nextPayoutAt: future(3600),
  accruedPeriods: 1,
  maxAccruedPeriods: 3,
  estimate: {
    base: '270',
    coverageMultiplier: 0.8,
    reputationMultiplier: 1.04,
    personnelCost: '35',
    net: '190',
  },
  lastPayout: { at: '2026-09-20T06:00:00.000Z', net: '181' },
  accrualStopsAt: '2026-09-20T22:00:00.000Z',
  coveragePct: 61.5,
  bonusMultiplier: 1.05,
  history: [
    {
      periodKey: 'p2',
      status: 'PAID' as const,
      net: '181',
      base: '270',
      coveragePct: 61.5,
      coverageMultiplier: 0.8,
      reputationMultiplier: 1.04,
      personnelCost: '35',
      at: '2026-09-20T06:00:00.000Z',
    },
    {
      periodKey: 'p1',
      status: 'SKIPPED_INACTIVE' as const,
      net: '0',
      base: '270',
      coveragePct: 61.5,
      coverageMultiplier: 0.8,
      reputationMultiplier: 1.04,
      personnelCost: '35',
      at: '2026-09-20T02:00:00.000Z',
    },
  ],
};

const milestone = (patch: Partial<MilestoneDto> & { code: string }): MilestoneDto => ({
  phase: 'FIRST_HOURS',
  order: 1,
  title: { key: `milestone.${patch.code}.title` },
  description: { key: `milestone.${patch.code}.description` },
  rewardCredits: '100',
  rewardXp: '20',
  progress: { current: 0, target: 1 },
  achieved: false,
  achievedAt: null,
  ...patch,
});
const milestones: MilestoneDto[] = [
  milestone({ code: 'TEN_INCIDENTS', order: 9, progress: { current: 3, target: 10 } }),
  milestone({
    code: 'TUTORIAL_COMPLETED',
    order: 1,
    achieved: true,
    achievedAt: '2026-09-19T10:00:00.000Z',
    progress: { current: 1, target: 1 },
  }),
  milestone({
    code: 'COVERAGE_70',
    phase: 'EARLY',
    order: 16,
    progress: { current: 0.615, target: 0.7 },
    rewardCredits: '400',
  }),
];

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/game/economy' }));
vi.mock('@/features/game/hooks', () => ({
  useCareerId: () => 'car_TEST',
  useCareerIdOptional: () => 'car_TEST',
  useSnapshot: () => ({
    world,
    career: {
      level: 3,
      reputation: 62.4,
      coveragePct: 61.5,
      timezone: 'Europe/Rome',
      unlockedFamilies: ['FIRE', 'EMS'],
      xp: '300',
    },
  }),
}));
vi.mock('./use-world', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('./use-world')),
  useWorld: () => world,
  useCoverage: () => ({ data: coverage, isLoading: false }),
  useStipend: () => ({ data: stipend, isLoading: false, refetch: vi.fn() }),
  useMilestones: () => ({ data: milestones, isLoading: false }),
}));
vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@tanstack/react-query')),
  useQuery: () => ({
    data: { rank: { code: 'TRAINEE_DIRECTOR', name: { key: 'rank.TRAINEE_DIRECTOR.name' } } },
  }),
}));

const bundle = {
  'family.FIRE.name': 'Vigili del Fuoco',
  'family.FIRE.short': 'VVF',
  'family.EMS.name': 'Emergenza Sanitaria',
  'family.EMS.short': '118',
  'season.AUTUMN.name': 'Autunno',
  'hourBand.MORNING.name': 'Mattina',
  'weekdayType.SUNDAY.name': 'Domenica',
  'rank.TRAINEE_DIRECTOR.name': 'Direttore in prova',
  'milestone.TEN_INCIDENTS.title': 'Dieci emergenze risolte',
  'milestone.TUTORIAL_COMPLETED.title': 'Addestramento completato',
  'milestone.COVERAGE_70.title': 'Copertura al 70%',
};
const ui = (node: React.ReactElement) =>
  renderWithIntl(<CatalogTextsOverride value={bundle}>{node}</CatalogTextsOverride>);

beforeEach(() => {
  push.mockClear();
  useUiStore.setState({
    mapLayers: { hospitals: false, closures: true, coverage: false, sites: false },
    coverageFamily: null,
  });
});

describe('coverage geometry', () => {
  it('bins response times against the isochrone rings', () => {
    expect(binOf(null, DEFAULT_RINGS)).toBe(UNREACHABLE_BIN);
    expect(binOf(300, DEFAULT_RINGS)).toBe(0);
    expect(binOf(301, DEFAULT_RINGS)).toBe(1);
    expect(binOf(5000, DEFAULT_RINGS)).toBe(DEFAULT_RINGS.length);
    expect(cellSeconds(coverage.cells[0]!, 'EMS')).toBe(700);
    expect(cellSeconds(coverage.cells[1]!, 'EMS')).toBeNull();
    expect(cellSeconds(coverage.cells[1]!, null)).toBe(1000);
  });

  it('builds a numeric legend with an open last bin and an unreachable entry', () => {
    const bins = legendBins(DEFAULT_RINGS);
    expect(bins).toHaveLength(DEFAULT_RINGS.length + 2);
    expect(bins[0]).toMatchObject({ from: 0, to: 5 });
    expect(bins[1]).toMatchObject({ from: 5, to: 10 });
    expect(bins.at(-2)).toMatchObject({ from: 30, to: null });
    expect(bins.at(-1)).toMatchObject({ bin: UNREACHABLE_BIN, from: null });
    expect(new Set(bins.map((b) => b.color)).size).toBe(bins.length);
  });

  it('turns cells into labelled polygons for the selected family and skips broken cells', () => {
    const ring = [
      [14.2, 42.4],
      [14.21, 42.4],
      [14.21, 42.41],
      [14.2, 42.4],
    ] as [number, number][];
    const boundary = (h3: string) => {
      if (h3 === '881e8d0a03fffff') throw new Error('invalid cell');
      return ring;
    };
    const all = coverageFeatures(coverage, null, () => ring);
    expect(all.features).toHaveLength(3); // the cell outside the career area is not drawn
    expect(all.features[0]!.properties).toMatchObject({ bin: 0, label: '4′' });
    expect(all.features[2]!.properties).toMatchObject({ bin: UNREACHABLE_BIN, label: '' });
    const ems = coverageFeatures(coverage, 'EMS', boundary);
    expect(ems.features).toHaveLength(2);
    expect(ems.features[0]!.properties).toMatchObject({ bin: 2, label: '12′' });
  });

  it('draws the hatch texture as RGBA pixels', () => {
    const img = hatchImage([255, 0, 0, 255], 8, 2);
    expect(img.data).toHaveLength(8 * 8 * 4);
    const opaque = img.data.filter((_, i) => i % 4 === 3 && img.data[i] === 255).length;
    expect(opaque).toBe(8 * 4); // two diagonals of 2px over an 8px tile = half of the rows' pixels / 2
  });
});

describe('WorldDetails', () => {
  it('shows weather, degraded hint, time context, traffic effect and closures', () => {
    ui(<WorldDetails world={world} time="12:00" />);
    expect(screen.getByText(/Pioggia intensa/)).toBeInTheDocument();
    expect(screen.getByText(/14 °C/)).toBeInTheDocument();
    expect(screen.getByText(/Vento a 32 km\/h/)).toBeInTheDocument();
    expect(screen.getByTestId('weather-degraded')).toHaveTextContent('Dati meteo stimati');
    expect(screen.getByText(/Giorno/)).toBeInTheDocument();
    expect(screen.getByText('Mattina · Domenica · Autunno')).toBeInTheDocument();
    expect(screen.getByText('Intenso')).toBeInTheDocument();
    expect(screen.getByTestId('world-travel-effect')).toHaveTextContent('34%');
    expect(screen.getByText('1 strada chiusa')).toBeInTheDocument();
    expect(travelDelay({ ...world, trafficMultiplier: undefined })).toBe(0);
  });

  it('opens the closures on the map from anywhere in the game', () => {
    const onNavigate = vi.fn();
    useUiStore.getState().setMapLayer('closures', false);
    ui(<WorldDetails world={world} time="12:00" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mostra sulla mappa' }));
    expect(useUiStore.getState().mapLayers.closures).toBe(true);
    expect(onNavigate).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/game');
  });
});

describe('LayersPanel', () => {
  it('toggles layers, picks the coverage family and lists closures with their effect', () => {
    ui(<LayersPanel />);
    expect(screen.getByRole('switch', { name: /Strade chiuse/ })).toBeChecked();
    expect(screen.queryByTestId('coverage-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: /Copertura/ }));
    expect(useUiStore.getState().mapLayers.coverage).toBe(true);

    const section = screen.getByTestId('coverage-section');
    expect(within(section).getByTestId('coverage-pct')).toHaveTextContent('62%');
    expect(within(section).getByTestId('coverage-stale')).toBeInTheDocument();
    expect(within(section).getByText('fino a 5 min')).toBeInTheDocument();
    expect(within(section).getByText('oltre 30 min')).toBeInTheDocument();
    expect(within(section).getByText('Non raggiungibile')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: /118/ }));
    expect(useUiStore.getState().coverageFamily).toBe('EMS');
    expect(within(section).getByTestId('coverage-pct')).toHaveTextContent('41%');
    expect(within(section).getByText(/Soglia di servizio: 10 min/)).toBeInTheDocument();

    const row = screen.getByTestId('closure-row');
    expect(row).toHaveTextContent('Lavori in corso in Via Nicola Fabrizi');
    expect(row).toHaveTextContent('Chiusa');
    expect(row).toHaveTextContent('+60%');
    fireEvent.click(within(row).getByRole('button', { name: /Centra sulla mappa/ }));
    expect(useUiStore.getState().focusRequest?.zoom).toBe(15);
  });
});

describe('StipendCard', () => {
  it('explains the estimate: base × coverage × reputation × bonus − personnel = net', () => {
    ui(<StipendCard />);
    const card = screen.getByTestId('stipend-card');
    expect(within(card).getByTestId('stipend-row-base')).toHaveTextContent('270');
    expect(within(card).getByTestId('stipend-row-coverage')).toHaveTextContent('× 0,80');
    expect(within(card).getByTestId('stipend-row-reputation')).toHaveTextContent('× 1,04');
    expect(within(card).getByTestId('stipend-row-bonus')).toHaveTextContent('× 1,05');
    expect(within(card).getByTestId('stipend-row-personnel')).toHaveTextContent('35');
    expect(within(card).getByTestId('stipend-net')).toHaveTextContent('190');
    expect(within(card).getByText('1 di 3 periodi')).toBeInTheDocument();
    expect(within(card).getByTestId('stipend-accrual-stop')).toHaveTextContent(/smette di maturare/);
    expect(within(card).getAllByTestId('countdown').length).toBeGreaterThan(0);
    expect(within(card).getByTestId('stipend-last')).toHaveTextContent('181');
    expect(within(card).getByText('Non maturato (assenza)')).toBeInTheDocument();
    const families = within(card).getAllByTestId('stipend-family');
    expect(families.map((f) => f.getAttribute('data-family'))).toEqual(['FIRE', 'EMS']);
    expect(families[1]).toHaveTextContent('entro 10 min');
    expect(families[1]).toHaveTextContent('Nessun mezzo operativo');
  });

  it('links to the coverage layer on the map', () => {
    ui(<StipendCard />);
    fireEvent.click(screen.getByTestId('stipend-open-coverage'));
    expect(useUiStore.getState().mapLayers.coverage).toBe(true);
    expect(push).toHaveBeenCalledWith('/game');
  });
});

describe('progression extras', () => {
  it('groups milestones by phase in catalog order and opens the phase in progress', () => {
    expect(groupByPhase(milestones).map(([phase, list]) => [phase, list.map((m) => m.code)])).toEqual([
      ['FIRST_HOURS', ['TUTORIAL_COMPLETED', 'TEN_INCIDENTS']],
      ['EARLY', ['COVERAGE_70']],
    ]);
    ui(<MilestonesCard />);
    expect(screen.getByTestId('milestones-summary')).toHaveTextContent('1 di 3 raggiunti');
    const rows = screen.getAllByTestId('milestone');
    expect(rows).toHaveLength(2); // only the current phase is expanded
    expect(rows[0]).toHaveAttribute('data-achieved', 'true');
    expect(rows[0]).toHaveTextContent(/Raggiunto il/);
    expect(rows[1]).toHaveTextContent('3 di 10');
    expect(within(rows[1]!).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
    fireEvent.click(screen.getByRole('button', { name: /Inizio carriera/ }));
    expect(screen.getByText('Copertura al 70%').closest('li')).toHaveTextContent('62% su 70%');
  });

  it('shows the reputation band, the gauge and the stipend multiplier', () => {
    expect(reputationBand(0).code).toBe('CRITICAL');
    expect(reputationBand(49.4).code).toBe('LOW');
    expect(reputationBand(84.6).code).toBe('EXCELLENT');
    ui(<ReputationCard />);
    expect(screen.getByTestId('reputation-value')).toHaveTextContent('62');
    expect(screen.getByTestId('reputation-band')).toHaveTextContent('Discreta');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '62');
    expect(screen.getByTestId('reputation-multiplier')).toHaveTextContent('× 1,04');
    expect(screen.getByTestId('career-rank')).toHaveTextContent('Grado: Direttore in prova');
  });
});

describe('durationParts', () => {
  it('splits seconds into hours and minutes', () => {
    expect(durationParts(14_400)).toEqual({ h: 4, m: 0 });
    expect(durationParts(1200)).toEqual({ h: 0, m: 20 });
    expect(durationParts(5400)).toEqual({ h: 1, m: 30 });
    expect(durationParts(10)).toEqual({ h: 0, m: 1 });
  });
});
