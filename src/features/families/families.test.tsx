import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { IncidentDto } from '@/contracts';
import { CatalogTextsOverride } from '@/i18n/catalog-texts';
import { renderWithIntl } from '@/test/render';
import { IncidentExternalSupport } from './external-support';
import { IncidentFamilies } from './family-chips';
import { RequirementAttribution } from './requirement-attribution';
import { newlyUnlocked } from './family-unlock-celebration';

vi.mock('@/features/game/hooks', () => ({
  useSnapshot: () => ({ career: { timezone: 'Europe/Rome', unlockedFamilies: ['FIRE', 'EMS'], level: 3 } }),
  useCatalog: () => ({
    ungUnitTypes: [
      { code: 'UNG_TOW', name: { key: 'ung.UNG_TOW.name' }, icon: 'ung-tow', keepsRoadClosed: true },
    ],
  }),
  useCareerId: () => 'car_TEST',
}));

const bundle = {
  'family.FIRE.name': 'Vigili del Fuoco',
  'family.EMS.name': 'Emergenza Sanitaria',
  'family.POLICE.name': 'Polizia',
  'ung.UNG_TOW.name': 'Carro attrezzi',
  'capability.EXTRICATION.name': 'Estricazione',
  'capability.TRAFFIC_CONTROL.name': 'Viabilità',
};
const future = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const incident = (patch: Partial<IncidentDto>): IncidentDto =>
  ({
    id: 'inc_1',
    templateCode: 'ROAD_ACCIDENT_TRAPPED',
    category: 'TRAFFIC_ACCIDENT',
    families: ['FIRE', 'EMS', 'POLICE'],
    status: 'ON_SCENE',
    requirements: [
      { capability: 'EXTRICATION', level: 'REQUIRED', required: 60, onScene: 70, enRoute: 0, family: 'FIRE' },
      {
        capability: 'TRAFFIC_CONTROL',
        level: 'RECOMMENDED',
        required: 40,
        onScene: 0,
        enRoute: 0,
        family: 'POLICE',
        external: true,
      },
    ],
    externalFamilies: ['POLICE'],
    externalSupport: [],
    rewardedAt: null,
    ...patch,
  }) as IncidentDto;
const ui = (node: React.ReactElement) =>
  renderWithIntl(<CatalogTextsOverride value={bundle}>{node}</CatalogTextsOverride>);

describe('IncidentExternalSupport', () => {
  it('renders nothing for a single-family incident that is still being worked', () => {
    const { container } = ui(<IncidentExternalSupport incident={incident({ externalFamilies: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains which locked family is covered by external support', () => {
    ui(<IncidentExternalSupport incident={incident({})} />);
    const notice = screen.getByTestId('external-families-notice');
    expect(notice).toHaveTextContent('Polizia non è ancora un tuo servizio');
    expect(screen.getByTestId('external-support')).toHaveAttribute('data-phase', 'NOTICE');
  });

  it('shows the RESOLVING phase: units with status label, countdown, road flag and the paid reward', () => {
    ui(
      <IncidentExternalSupport
        incident={incident({
          status: 'RESOLVING',
          rewardedAt: '2026-03-01T09:30:00.000Z',
          externalSupport: [
            {
              id: 'ung_1',
              unitTypeCode: 'UNG_TOW',
              name: { key: 'ung.UNG_TOW.name' },
              status: 'REQUESTED',
              arriveAt: future(90),
              completeAt: future(300),
              keepsRoadClosed: true,
            },
            {
              id: 'ung_2',
              unitTypeCode: 'UNG_ROAD',
              name: { key: 'ung.UNG_ROAD.name', params: { fallback: 'Gestore strada' } },
              status: 'DONE',
              arriveAt: future(-300),
              completeAt: future(-10),
              keepsRoadClosed: true,
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('external-support')).toHaveAttribute('data-phase', 'RESOLVING');
    expect(screen.getByTestId('reward-paid')).toHaveTextContent('Ricompensa già accreditata alle 10:30');
    const [requested, done] = screen.getAllByTestId('external-unit');
    expect(within(requested!).getByText('Carro attrezzi')).toBeInTheDocument();
    expect(within(requested!).getByText('Richiesta')).toBeInTheDocument();
    expect(within(requested!).getByText('Arrivo tra')).toBeInTheDocument();
    expect(within(requested!).getByTestId('road-closed')).toHaveTextContent('Strada chiusa');
    expect(within(done!).getByText('Gestore strada')).toBeInTheDocument();
    expect(within(done!).getByText('Completato')).toBeInTheDocument();
    // a finished unit no longer keeps the road closed and has no countdown
    expect(within(done!).queryByTestId('road-closed')).toBeNull();
    expect(within(done!).queryByTestId('countdown')).toBeNull();
  });
});

describe('family attribution', () => {
  it('names external families on the badges (never colour alone)', () => {
    ui(<IncidentFamilies incident={incident({})} />);
    expect(screen.getByRole('img', { name: 'Vigili del Fuoco' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Polizia — coperto dal supporto esterno' })).toBeInTheDocument();
  });

  it('groups requirements by responsible family and marks the external ones', () => {
    ui(<RequirementAttribution incident={incident({})} />);
    const groups = screen.getByTestId('requirement-attribution').querySelectorAll(':scope > li');
    expect(groups).toHaveLength(2);
    const police = [...groups].find((g) => g.getAttribute('data-family') === 'POLICE')!;
    expect(police).toHaveAttribute('data-external', 'true');
    expect(within(police as HTMLElement).getByTestId('external-badge')).toHaveTextContent('Supporto esterno');
    expect(within(police as HTMLElement).getByText('Viabilità')).toBeInTheDocument();
    const fire = [...groups].find((g) => g.getAttribute('data-family') === 'FIRE')!;
    expect(within(fire as HTMLElement).getByText('Tuo servizio')).toBeInTheDocument();
  });
});

describe('newlyUnlocked', () => {
  it('celebrates nothing on the first visit and only new families afterwards', () => {
    expect(newlyUnlocked(null, ['FIRE', 'EMS'])).toEqual([]);
    expect(newlyUnlocked(['FIRE'], ['FIRE'])).toEqual([]);
    expect(newlyUnlocked(['FIRE'], ['FIRE', 'EMS'])).toEqual(['EMS']);
    expect(newlyUnlocked(['FIRE'], ['FIRE', 'EMS', 'POLICE', 'UNG'])).toEqual(['EMS', 'POLICE']);
  });
});
