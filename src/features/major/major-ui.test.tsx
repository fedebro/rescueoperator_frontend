import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import type * as SoundModule from '@/lib/sound';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IncidentDto, MajorIncidentDto } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { playCue } from '@/lib/sound';
import { CatalogTextsOverride, type CatalogMessages } from '@/i18n/catalog-texts';
import { useToastStore } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { CAREER_ID, snapshot } from '@/test/fixtures';
import { MAJOR_ID, linkedIncident, mainScene, majorDto, majorRef } from '@/test/major-fixtures';
import { renderWithIntl } from '@/test/render';
import { CareerProvider } from '@/features/game/hooks';
import { majorApi } from './api';
import { MajorInspector } from './coordination-view';
import { MajorAlertHost } from './major-alert';
import { acknowledgeMajor, acknowledgedMajors } from './major';
import { MajorMemberBanner, MajorQueueHeader } from './queue';
import { useMajorStore } from './store';
import { MajorTrophiesCard } from './trophies';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/game/fleet',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./api', () => ({
  majorApi: {
    current: vi.fn(),
    list: vi.fn(),
    detail: vi.fn(),
    quote: vi.fn(),
    requestReinforcements: vi.fn(),
    trophies: vi.fn(),
  },
}));
vi.mock('@/lib/sound', async (importOriginal) => ({
  ...(await importOriginal<typeof SoundModule>()),
  playCue: vi.fn(() => true),
}));

/** The real Italian catalog bundle (the mock's, generated from the backend YAML): the texts the player reads. */
const catalog = (
  JSON.parse(readFileSync(join(process.cwd(), 'src/mocks/data/generated/i18n/it.json'), 'utf8')) as {
    messages: CatalogMessages;
  }
).messages;

function renderMajor(
  ui: React.ReactElement,
  opts: { incidents?: IncidentDto[]; major?: MajorIncidentDto; activeMajorIncidentId?: string | null } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    qk.sync(CAREER_ID),
    snapshot({
      incidents: opts.incidents ?? [mainScene(), linkedIncident()],
      activeMajorIncidentId: opts.activeMajorIncidentId,
    }),
  );
  const major = opts.major ?? majorDto();
  qc.setQueryData(qk.major(CAREER_ID, major.id), major);
  vi.mocked(majorApi.detail).mockResolvedValue(major);
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>
        <CatalogTextsOverride value={catalog}>{ui}</CatalogTextsOverride>
      </CareerProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useMajorStore.setState({ alertId: null, flightResume: {} });
  useUiStore.getState().clearSelection();
  useToastStore.setState({ toasts: [] });
});
afterEach(() => vi.clearAllMocks());

describe('the full-screen alert', () => {
  it('announces the major with its siren, and is acknowledged once closed', async () => {
    useMajorStore.getState().showAlert(MAJOR_ID);
    renderMajor(<MajorAlertHost />);
    const alert = await screen.findByTestId('major-alert');
    expect(screen.getByTestId('major-alert-title')).toHaveTextContent(
      'MAXI-EMERGENZA — Incendio in un complesso residenziale, Via Roma',
    );
    expect(alert).toHaveTextContent('Dimensionata sulla tua flotta: circa 18 mezzi');
    expect(alert).toHaveTextContent('Coordina i soccorsi');
    expect(playCue).toHaveBeenCalledWith('major');
    fireEvent.click(screen.getByTestId('major-alert-close'));
    await waitFor(() => expect(screen.queryByTestId('major-alert')).not.toBeInTheDocument());
    expect(acknowledgedMajors(CAREER_ID).has(MAJOR_ID)).toBe(true);
  });

  it('"Coordina i soccorsi" opens the coordination view on the map', async () => {
    useMajorStore.getState().showAlert(MAJOR_ID);
    renderMajor(<MajorAlertHost />);
    fireEvent.click(await screen.findByTestId('major-alert-open'));
    expect(useUiStore.getState().selection).toEqual({ kind: 'major', id: MAJOR_ID });
    expect(acknowledgedMajors(CAREER_ID).has(MAJOR_ID)).toBe(true);
  });

  it('raises itself for a running major this device never acknowledged (a reload, another device)', async () => {
    renderMajor(<MajorAlertHost />, { activeMajorIncidentId: MAJOR_ID });
    expect(await screen.findByTestId('major-alert')).toBeInTheDocument();
  });

  it('stays down for an acknowledged major', () => {
    acknowledgeMajor(CAREER_ID, MAJOR_ID);
    renderMajor(<MajorAlertHost />, { activeMajorIncidentId: MAJOR_ID });
    expect(screen.queryByTestId('major-alert')).not.toBeInTheDocument();
  });

  it('never shows an ended major', () => {
    useMajorStore.getState().showAlert(MAJOR_ID);
    renderMajor(<MajorAlertHost />, { major: majorDto({ status: 'ENDED', outcome: 'SUCCESS' }) });
    expect(screen.queryByTestId('major-alert')).not.toBeInTheDocument();
  });
});

describe('the coordination view', () => {
  it('shows the phase, the needs grouped by service, the sectors and the bonus estimate', () => {
    renderMajor(<MajorInspector majorId={MAJOR_ID} />);
    const view = screen.getByTestId('major-inspector');
    expect(view).toHaveAttribute('data-phase', 'ALARM');
    expect(within(view).getByTestId('major-title')).toHaveTextContent(
      'Incendio in un complesso residenziale',
    );
    expect(screen.getByTestId('major-phases').querySelector('[aria-current="step"]')).toHaveAttribute(
      'data-phase',
      'ALARM',
    );
    const groups = screen.getAllByTestId('major-group');
    expect(groups.map((g) => g.getAttribute('data-family'))).toEqual(['FIRE', 'EMS', 'POLICE']);
    // FIRE_SUPPRESSION 100 / 250, WATER_SUPPLY 100 / 100 → 70 %, one need of two covered, 50 more on the way.
    expect(groups[0]).toHaveTextContent('70% coperto');
    expect(groups[0]).toHaveTextContent('1 su 2 necessità coperte');
    expect(groups[0]).toHaveTextContent('+14% in arrivo');
    expect(groups[1]).toHaveTextContent('0% coperto');
    // Nothing indispensable for the police: its level, never a "100 %" over an empty bar.
    expect(groups[2]).toHaveTextContent('Consigliato');
    expect(groups[2]).not.toHaveTextContent('100%');
    const sectors = screen.getAllByTestId('major-sector');
    expect(sectors.map((s) => s.getAttribute('data-role'))).toEqual(['MAIN', 'SUB']);
    expect(sectors[0]).toHaveTextContent('Settore principale');
    expect(sectors[1]).toHaveTextContent('Settore 1');
    expect(screen.getByTestId('major-reward-estimate')).toHaveTextContent(/350.*840/);
  });

  it('opens a sector’s own inspector', () => {
    renderMajor(<MajorInspector majorId={MAJOR_ID} />);
    const [main] = screen.getAllByTestId('major-sector');
    fireEvent.click(within(main!).getByRole('button', { name: /^Apri / }));
    expect(useUiStore.getState().selection).toEqual({ kind: 'incident', id: mainScene().id });
  });

  it('asks for reinforcements: what they cover and cost, then the column on its way', async () => {
    const column = {
      id: 'rnf_01J8Z0000000000000000000AA',
      status: 'EN_ROUTE' as const,
      requestedAt: '2026-01-01T10:00:00.000Z',
      arriveAt: '2099-01-01T10:05:00.000Z',
      coverageShare: 0.4,
      families: ['FIRE' as const],
      capabilities: [{ capability: 'FIRE_SUPPRESSION', value: 120 }],
      source: { key: 'major.reinforcements.source' },
    };
    const base = majorDto();
    vi.mocked(majorApi.requestReinforcements).mockResolvedValue(
      majorDto({
        reinforcements: {
          quote: { ...base.reinforcements.quote, available: false, blockedReason: 'ALREADY_EN_ROUTE' },
          requests: [column],
          reinforcedShare: 0.4,
        },
      }),
    );
    renderMajor(<MajorInspector majorId={MAJOR_ID} />);
    const section = screen.getByTestId('major-reinforcements');
    expect(section).toHaveAttribute('data-available', 'true');
    expect(screen.getByTestId('major-quote-cost')).toHaveTextContent('−32%');
    expect(within(section).getByTestId('major-quote')).toHaveTextContent('40%');
    fireEvent.click(screen.getByTestId('major-request-reinforcements'));
    expect(await screen.findByTestId('major-column')).toHaveAttribute('data-status', 'EN_ROUTE');
    expect(majorApi.requestReinforcements).toHaveBeenCalledWith(CAREER_ID, MAJOR_ID);
    expect(screen.getByTestId('major-reinforcements')).toHaveAttribute('data-blocked', 'ALREADY_EN_ROUTE');
    expect(screen.getByTestId('major-reinforced-share')).toHaveTextContent('40%');
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Rinforzi richiesti');
  });

  it('says why reinforcements cannot be asked yet', () => {
    const base = majorDto();
    renderMajor(<MajorInspector majorId={MAJOR_ID} />, {
      major: majorDto({
        reinforcements: {
          ...base.reinforcements,
          quote: { ...base.reinforcements.quote, available: false, blockedReason: 'NO_OWN_UNIT' },
        },
      }),
    });
    expect(screen.getByTestId('major-request-reinforcements')).toBeDisabled();
    expect(screen.getByTestId('major-reinforcements-blocked')).toHaveTextContent('Invia almeno un tuo mezzo');
  });

  it('sums up an ended major: outcome, medal, bonus, quality', () => {
    renderMajor(<MajorInspector majorId={MAJOR_ID} />, {
      incidents: [],
      major: majorDto({
        status: 'ENDED',
        outcome: 'SUCCESS',
        phase: 'ENDED',
        reward: {
          estimated: { min: '350', max: '840' },
          credits: '784',
          xp: '147',
          reputationDelta: 2,
          medal: 'GOLD',
          quality: 1.12,
          notes: [],
        },
      }),
    });
    expect(screen.getByTestId('major-inspector')).toHaveAttribute('data-status', 'ENDED');
    expect(screen.getByTestId('major-outcome')).toHaveTextContent('Maxi-emergenza risolta');
    expect(screen.getByTestId('major-medal')).toHaveTextContent("Medaglia d'oro");
    expect(screen.getByTestId('major-reward')).toHaveTextContent('Qualità 112%');
    expect(screen.queryByTestId('major-reinforcements')).not.toBeInTheDocument();
    expect(screen.queryByTestId('major-groups')).not.toBeInTheDocument();
  });
});

describe('the queue and the member incidents', () => {
  it('pins the major’s head with its phase and what waits, one tap from the coordination view', () => {
    renderMajor(
      <MajorQueueHeader majorRef={majorRef()} members={[mainScene(), linkedIncident()]} selected={false} />,
    );
    const header = screen.getByTestId('major-queue-header');
    expect(header).toHaveTextContent('Maxi-emergenza');
    expect(header).toHaveTextContent('Allarme · 2 settori · 2 in attesa');
    fireEvent.click(header);
    expect(useUiStore.getState().selection).toEqual({ kind: 'major', id: MAJOR_ID });
  });

  it('leads a member’s inspector back to the coordination view', () => {
    renderMajor(<MajorMemberBanner incident={linkedIncident()} />);
    const banner = screen.getByTestId('major-member-banner');
    expect(banner).toHaveTextContent('Emergenza collegata · Allarme');
    fireEvent.click(banner);
    expect(useUiStore.getState().selection).toEqual({ kind: 'major', id: MAJOR_ID });
  });
});

describe('the trophies on the career page', () => {
  it('teases the majors before their level', async () => {
    vi.mocked(majorApi.trophies).mockResolvedValue({
      minLevel: 5,
      unlocked: false,
      handled: 0,
      trophies: [],
    });
    renderMajor(<MajorTrophiesCard />);
    expect(await screen.findByTestId('major-trophies-locked')).toHaveTextContent('dal livello 5');
    expect(majorApi.list).not.toHaveBeenCalled();
  });

  it('shows a medal per scenario and the last majors', async () => {
    vi.mocked(majorApi.trophies).mockResolvedValue({
      minLevel: 5,
      unlocked: true,
      handled: 1,
      trophies: [
        {
          scenarioCode: 'MAJ_RESIDENTIAL_FIRE',
          title: { key: 'major.scenario.MAJ_RESIDENTIAL_FIRE.title' },
          icon: 'major-residential-fire',
          medal: 'GOLD',
          handled: 1,
          attempts: 1,
          bestQuality: 1.05,
          firstAt: '2026-01-01T10:00:00.000Z',
          lastAt: '2026-01-01T10:00:00.000Z',
        },
        {
          scenarioCode: 'MAJ_GAS_EXPLOSION',
          title: { key: 'major.scenario.MAJ_GAS_EXPLOSION.title' },
          icon: 'major-gas-explosion',
          medal: null,
          handled: 0,
          attempts: 0,
          bestQuality: null,
          firstAt: null,
          lastAt: null,
        },
      ],
    });
    vi.mocked(majorApi.list).mockResolvedValue([
      majorDto({
        status: 'ENDED',
        outcome: 'SUCCESS',
        reward: { ...majorDto().reward, credits: '784' },
      }),
    ]);
    renderMajor(<MajorTrophiesCard />);
    const won = await screen.findAllByTestId('major-trophy');
    expect(won[0]).toHaveAttribute('data-medal', 'GOLD');
    expect(won[0]).toHaveTextContent('1 gestita su 1 · migliore 105%');
    expect(won[1]).toHaveTextContent('Non ancora');
    expect(await screen.findByTestId('major-history-row')).toHaveAttribute('data-status', 'ENDED');
    expect(screen.getByTestId('major-trophies-handled')).toHaveTextContent('1 gestita');
  });
});
