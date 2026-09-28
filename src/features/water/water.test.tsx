import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { FacilityDto, IncidentDto, MovementDto, SiteDto, VehicleDto } from '@/contracts';
import { ApiClientError } from '@/lib/api/errors';
import { facilitiesApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { movementPoint, remainingPieces } from '@/lib/geo';
import { CAREER_ID, incident as incidentFixture, snapshot, vehicle as vehicleFixture } from '@/test/fixtures';
import { loadMessagesSync } from '@/test/messages';
import { renderWithIntl } from '@/test/render';
import { CareerProvider } from '@/features/game/hooks';
import { RequirementBars, coverageForecast } from '@/features/game/dispatch-panel';
import { VehicleOffer } from '@/features/game/shop-screen';
import { useFixIt } from '@/features/facilities/error-fix';
import { imageSvg } from '@/features/map/images';
import { incidentFeatures, vehicleFeatures, waterFeatures } from '@/features/map/game-layers';
import { PICTOGRAMS } from '@/design/icons/pictograms';
import { DispatchWaterRoute, IncidentWaterNotice, WaterBodyBadge } from './incident-water';
import { BoatHomeCard, FreeBoatTransfer, NauticalConditions } from './nautical';
import {
  NAUTICAL_SITES_HREF,
  grandfatheredBoats,
  incidentScene,
  meetingPointOf,
  nauticalBases,
  requirementsBySide,
  transferTargetForBoat,
} from './water';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/game',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api/depth', () => ({ facilitiesApi: { transferVehicle: vi.fn() } }));

const SCENE: [number, number] = [14.2228, 42.4757];
const MEETING: [number, number] = [14.2166, 42.4703];
const BERTH: [number, number] = [14.23165, 42.466976];

/** A swimmer offshore Pescara: the Coast Guard covers the water part (no boat), the ambulance works on the shore. */
const waterIncident = (patch: Partial<IncidentDto> = {}): IncidentDto =>
  incidentFixture({
    templateCode: 'MED_SWIMMER_DISTRESS',
    category: 'WATER',
    address: 'Lungomare Giacomo Matteotti, Pescara',
    position: MEETING,
    domain: 'WATER',
    waterBody: { type: 'SEA', id: 'sea:adriatic', name: 'Mare Adriatico' },
    scenePosition: SCENE,
    meetingPoint: MEETING,
    placeText: { key: 'water.place.SEA', params: { place: 'Lungomare Giacomo Matteotti, Pescara' } },
    waterSupport: {
      provider: 'COAST_GUARD',
      name: { key: 'water.coastGuard.name' },
      capabilities: ['WATER_RESCUE'],
      rewardShare: 0.6,
    },
    requirements: [
      {
        capability: 'WATER_RESCUE',
        level: 'REQUIRED',
        required: 75,
        onScene: 0,
        enRoute: 0,
        family: 'FIRE',
        external: true,
        externalSource: 'COAST_GUARD',
        side: 'WATER',
      },
      {
        capability: 'MEDICAL_BASIC',
        level: 'REQUIRED',
        required: 60,
        onScene: 0,
        enRoute: 0,
        family: 'EMS',
        external: false,
        externalSource: null,
        side: 'SHORE',
      },
    ],
    ...patch,
  });

const station: FacilityDto = {
  id: 'fac_01J8Z0000000000000000000AA',
  typeCode: 'FIRE_LOCAL_STATION',
  family: 'FIRE',
  name: 'Caserma Pescara Centro',
  position: [14.2102, 42.4629],
  status: 'OPERATIONAL',
  capacities: [
    { domain: 'GROUND', total: 6, used: 1 },
    { domain: 'WATER', total: 1, used: 1 },
  ],
  upgrades: [],
};
const base = (patch: Partial<FacilityDto> = {}): FacilityDto => ({
  id: 'fac_01J8Z0000000000000000000BB',
  typeCode: 'NAUTICAL_BASE',
  family: 'SHARED',
  name: 'Base nautica Marina di Pescara',
  position: [14.231798, 42.467164],
  status: 'OPERATIONAL',
  capacities: [
    { domain: 'GROUND', total: 0, used: 0 },
    { domain: 'WATER', total: 2, used: 0 },
  ],
  upgrades: [],
  nautical: { waterBody: 'SEA', waterBodyId: 'sea:adriatic', waterBodyName: 'Mare Adriatico', berth: BERTH },
  ...patch,
});
const boat = (patch: Partial<VehicleDto> = {}): VehicleDto =>
  vehicleFixture({
    id: 'veh_01J8Z0000000000000000000BT',
    typeCode: 'FIRE_BOAT',
    callSign: 'Gommone 1',
    facilityId: station.id,
    ...patch,
  });

const catalog = {
  vehicleTypes: [
    { code: 'FIRE_APS', domain: 'GROUND', capacityPoints: 1, name: { key: 'vehicle.FIRE_APS.name' } },
    { code: 'FIRE_BOAT', domain: 'WATER', capacityPoints: 1, name: { key: 'vehicle.FIRE_BOAT.name' } },
  ],
  capabilities: [
    {
      code: 'WATER_RESCUE',
      name: { key: 'capability.WATER_RESCUE.name', params: { fallback: 'Soccorso acquatico' } },
    },
    {
      code: 'MEDICAL_BASIC',
      name: { key: 'capability.MEDICAL_BASIC.name', params: { fallback: 'Sanitario di base' } },
    },
  ],
  facilityTypes: [
    {
      code: 'NAUTICAL_BASE',
      price: '7000',
      requiredLevel: 6,
      baseCapacity: { WATER: 2 },
      upgradeCaps: { PIER: 2 },
      unlocked: true,
    },
  ],
  facilityUpgrades: [{ code: 'PIER', effect: { domain: 'WATER', delta: 1 } }],
};

function renderGame(
  ui: React.ReactElement,
  state: { facilities?: FacilityDto[]; vehicles?: VehicleDto[] } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    qk.sync(CAREER_ID),
    snapshot({ facilities: state.facilities ?? [station], vehicles: state.vehicles ?? [vehicleFixture()] }),
  );
  qc.setQueryData(qk.catalog(CAREER_ID), catalog);
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>{ui}</CareerProvider>
    </QueryClientProvider>,
  );
}

describe('water helpers', () => {
  it('knows the scene, the meeting point, the sides and the boats left at a station', () => {
    const inc = waterIncident();
    expect(incidentScene(inc)).toEqual(SCENE);
    expect(meetingPointOf(inc)).toEqual(MEETING);
    const land = incidentFixture();
    expect(incidentScene(land)).toEqual(land.position);
    expect(meetingPointOf(land)).toBeNull();
    const sides = requirementsBySide(inc.requirements)!;
    expect(sides.water.map((r) => r.capability)).toEqual(['WATER_RESCUE']);
    expect(sides.shore.map((r) => r.capability)).toEqual(['MEDICAL_BASIC']);
    expect(requirementsBySide(land.requirements)).toBeNull();
    const isBoat = (code: string) => code === 'FIRE_BOAT';
    expect(
      grandfatheredBoats([boat(), vehicleFixture()], [station, base()], isBoat).map((v) => v.id),
    ).toEqual([boat().id]);
    expect(grandfatheredBoats([boat({ facilityId: base().id })], [station, base()], isBoat)).toEqual([]);
    // the first base with a free berth, never a full or unfinished one
    expect(transferTargetForBoat([station, base()], 1)?.id).toBe(base().id);
    expect(
      transferTargetForBoat([base({ capacities: [{ domain: 'WATER', total: 2, used: 2 }] })], 1),
    ).toBeNull();
    expect(transferTargetForBoat([base({ status: 'UNDER_CONSTRUCTION' })], 1)).toBeNull();
    expect(nauticalBases([station, base()]).map((f) => f.id)).toEqual([base().id]);
  });

  it('interpolates a boat inside its current segment and lists what is left of its leg', () => {
    const t0 = Date.parse('2026-07-01T10:00:00.000Z');
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    const movement: MovementDto = {
      path: [
        [14.2, 42.46],
        [14.21, 42.46],
        [14.21, 42.47],
        [14.22, 42.48],
      ],
      departAt: at(0),
      arriveAt: at(100),
      distanceMeters: 3000,
      purpose: 'TO_INCIDENT',
      segments: [
        {
          mode: 'ROAD',
          path: [
            [14.2, 42.46],
            [14.21, 42.46],
          ],
          departAt: at(0),
          arriveAt: at(40),
          distanceMeters: 800,
        },
        { mode: 'LAUNCH', path: [[14.21, 42.47]], departAt: at(40), arriveAt: at(60), distanceMeters: 0 },
        {
          mode: 'WATER',
          path: [
            [14.21, 42.47],
            [14.22, 42.48],
          ],
          departAt: at(60),
          arriveAt: at(100),
          distanceMeters: 1400,
        },
      ],
    };
    // half of the road part (a quarter of the whole leg would be elsewhere along the joined path)
    const road = movementPoint(movement, t0 + 20_000);
    expect(road.mode).toBe('ROAD');
    expect(road.position[0]).toBeCloseTo(14.205, 4);
    expect(road.position[1]).toBeCloseTo(42.46, 6);
    // the launch is a pause at the launch point
    expect(movementPoint(movement, t0 + 50_000)).toMatchObject({ mode: 'LAUNCH', position: [14.21, 42.47] });
    expect(movementPoint(movement, t0 + 80_000).mode).toBe('WATER');
    expect(remainingPieces(movement, t0 + 20_000).map((p) => p.mode)).toEqual(['ROAD', 'LAUNCH', 'WATER']);
    expect(remainingPieces(movement, t0 + 70_000).map((p) => p.mode)).toEqual(['WATER']);
    expect(remainingPieces({ ...movement, segments: undefined }, t0).map((p) => p.mode)).toEqual([null]);
  });
});

describe('map: water incidents and boat legs', () => {
  it('puts the marker on the water with the anchor badge, and links the meeting point', () => {
    const [marker] = incidentFeatures([waterIncident()]).features;
    expect(marker!.geometry.coordinates).toEqual(SCENE);
    expect(marker!.properties).toMatchObject({ water: 1 });
    expect(String(marker!.properties!.image)).toMatch(/:W$/);
    const [land] = incidentFeatures([incidentFixture()]).features;
    expect(String(land!.properties!.image)).not.toMatch(/:W$/);
    // an older water incident (scene on the meeting point) has nothing to link
    const legacy = waterIncident({ id: 'inc_01J8Z0000000000000000000LG', scenePosition: MEETING });
    const features = waterFeatures([waterIncident(), incidentFixture(), legacy]).features;
    expect(features).toHaveLength(2);
    expect(features[0]!.geometry).toEqual({ type: 'LineString', coordinates: [SCENE, MEETING] });
    expect(features[1]).toMatchObject({
      geometry: { type: 'Point', coordinates: MEETING },
      properties: { kind: 'incident', image: 'meet', meeting: 1 },
    });
  });

  it('draws a boat leg piece by piece (solid road, dashed water, launch point) and an ordinary leg as before', () => {
    const now = Date.parse('2026-07-01T10:00:10.000Z');
    const t = (s: number) => new Date(Date.parse('2026-07-01T10:00:00.000Z') + s * 1000).toISOString();
    const boatMoving = boat({
      status: 'EN_ROUTE',
      movement: {
        path: [
          [14.2, 42.46],
          [14.21, 42.47],
          [14.22, 42.48],
        ],
        departAt: t(0),
        arriveAt: t(60),
        distanceMeters: 2000,
        purpose: 'TO_INCIDENT',
        segments: [
          {
            mode: 'ROAD',
            path: [
              [14.2, 42.46],
              [14.21, 42.47],
            ],
            departAt: t(0),
            arriveAt: t(30),
            distanceMeters: 900,
          },
          { mode: 'LAUNCH', path: [[14.21, 42.47]], departAt: t(30), arriveAt: t(40), distanceMeters: 0 },
          {
            mode: 'WATER',
            path: [
              [14.21, 42.47],
              [14.22, 42.48],
            ],
            departAt: t(40),
            arriveAt: t(60),
            distanceMeters: 1100,
          },
        ],
      },
    });
    const truck = vehicleFixture({
      id: 'veh_01J8Z0000000000000000000TR',
      status: 'EN_ROUTE',
      movement: {
        path: [
          [14.2, 42.46],
          [14.21, 42.46],
        ],
        departAt: t(0),
        arriveAt: t(60),
        distanceMeters: 800,
        purpose: 'TO_INCIDENT',
      },
    });
    const { routes } = vehicleFeatures([boatMoving, truck], () => 'boat', now);
    const pieces = routes.features.map((f) => [
      f.properties!.id,
      f.geometry.type,
      f.properties!.mode ?? null,
    ]);
    expect(pieces).toEqual([
      [boatMoving.id, 'LineString', 'ROAD'],
      [boatMoving.id, 'Point', 'LAUNCH'],
      [boatMoving.id, 'LineString', 'WATER'],
      [truck.id, 'LineString', null],
    ]);
    expect(routes.features[1]!.properties!.image).toBe('launch');
  });

  it('generates the water badge, the meeting point, the launch point and the nautical site pin', () => {
    const water = imageSvg('inc:WATER|incident-med-swimmer-distress:3:W')!.svg;
    const plain = imageSvg('inc:WATER|incident-med-swimmer-distress:3')!.svg;
    expect(water.length).toBeGreaterThan(plain.length);
    expect(water).toContain('#5AA2E6');
    expect(plain).not.toContain('#5AA2E6');
    for (const name of ['meet', 'launch', 'site:0:N', 'site:1:N']) {
      const spec = imageSvg(name)!;
      expect(spec.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(spec.svg).not.toMatch(/undefined|NaN/);
    }
    expect(imageSvg('site:0:N')!.svg).toContain(PICTOGRAMS.facility_nautical_base);
    expect(imageSvg('site:0')!.svg).toContain(PICTOGRAMS.facility_fire);
  });
});

describe('incident panel: Coast Guard, sides, destinations', () => {
  it('says the Coast Guard steps in without a boat, with the reduced reward and a link to a Base nautica', () => {
    renderGame(<IncidentWaterNotice incident={waterIncident()} />);
    const notice = screen.getByTestId('water-notice');
    expect(notice).toHaveAttribute('data-state', 'COAST_GUARD');
    expect(screen.getByTestId('coast-guard-notice')).toHaveTextContent(
      'Serve un mezzo acquatico — interviene la Guardia Costiera',
    );
    expect(screen.getByTestId('coast-guard-covers')).toHaveTextContent('Soccorso acquatico');
    expect(screen.getByTestId('coast-guard-reward')).toHaveTextContent('Ricompensa ridotta al 60%');
    expect(screen.getByTestId('water-buy-base')).toHaveAttribute('href', NAUTICAL_SITES_HREF);
  });

  it('asks for a boat on a river (no Coast Guard there), and for a boat — not a base — once a base exists', () => {
    const river = waterIncident({
      waterBody: { type: 'RIVER', id: 'river:pescara', name: 'Fiume Pescara' },
      waterSupport: null,
    });
    const { unmount } = renderGame(<IncidentWaterNotice incident={river} />);
    expect(screen.getByTestId('water-notice')).toHaveAttribute('data-state', 'NEEDS_BOAT');
    expect(screen.getByTestId('coast-guard-notice')).toHaveTextContent('Serve un mezzo acquatico');
    unmount();
    renderGame(<IncidentWaterNotice incident={river} />, { facilities: [station, base()] });
    expect(screen.getByTestId('water-buy-boat')).toHaveAttribute('href', '/game/shop?domain=WATER');
  });

  it('with its own boats: just who goes where', () => {
    renderGame(<IncidentWaterNotice incident={waterIncident({ waterSupport: null })} />, {
      vehicles: [boat({ facilityId: base().id })],
      facilities: [station, base()],
    });
    expect(screen.getByTestId('water-notice')).toHaveAttribute('data-state', 'OWN_BOATS');
    expect(screen.getByTestId('water-roles')).toHaveTextContent('punto di raccolta');
    expect(screen.queryByTestId('coast-guard-notice')).not.toBeInTheDocument();
  });

  it('shows the water badge by kind of water', () => {
    renderWithIntl(<WaterBodyBadge incident={waterIncident()} />);
    expect(screen.getByTestId('water-badge')).toHaveTextContent('In mare');
    const { container } = renderWithIntl(<WaterBodyBadge incident={incidentFixture()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('splits the requirements in the water / on the shore, the Coast Guard need without a bar', () => {
    renderGame(<RequirementBars incident={waterIncident()} />);
    const sides = screen.getAllByTestId('requirement-side');
    expect(sides.map((s) => s.getAttribute('data-side'))).toEqual(['WATER', 'SHORE']);
    expect(sides[0]).toHaveTextContent('In acqua');
    expect(sides[1]).toHaveTextContent('A terra');
    expect(screen.getByTestId('requirement-coast-guard')).toHaveTextContent('Guardia Costiera');
    expect(screen.getAllByTestId('capability-bar')).toHaveLength(1);
  });

  it('forecasts coverage on the player’s own needs only (the Coast Guard covers the rest)', () => {
    const inc = waterIncident();
    expect(coverageForecast(inc, new Map([['MEDICAL_BASIC', 60]]))).toEqual({ percent: 100, missing: [] });
    expect(coverageForecast(inc, new Map())).toEqual({ percent: 0, missing: ['MEDICAL_BASIC'] });
  });

  it('says where each vehicle goes and how a boat gets there', () => {
    const option = {
      vehicleId: 'veh_1',
      etaSeconds: 90,
      distanceMeters: 2100,
      dispatchable: true,
      blockedReason: null,
      warnings: [],
      contributes: [],
      recommended: true,
    };
    const { rerender } = renderWithIntl(
      <DispatchWaterRoute
        option={{
          ...option,
          destination: 'SCENE',
          boatRoute: {
            kind: 'DIRECT',
            roadMeters: 0,
            waterMeters: 2100,
            launchSeconds: 0,
            launchPoint: null,
          },
        }}
      />,
    );
    const line = () => screen.getByTestId('dispatch-water-route');
    expect(line()).toHaveAttribute('data-boat-route', 'DIRECT');
    expect(line()).toHaveTextContent('In acqua · parte dall’ormeggio');
    rerender(
      <DispatchWaterRoute
        option={{
          ...option,
          destination: 'SCENE',
          boatRoute: {
            kind: 'TRAILER',
            roadMeters: 3200,
            waterMeters: 900,
            launchSeconds: 40,
            launchPoint: { name: 'Marina di Pescara', position: [14.23, 42.46] },
          },
        }}
      />,
    );
    expect(line()).toHaveTextContent('su carrello, varo a Marina di Pescara');
    expect(line()).toHaveTextContent('3,2 km su strada, 900 m in acqua');
    rerender(
      <DispatchWaterRoute
        option={{
          ...option,
          destination: 'SCENE',
          boatRoute: {
            kind: 'BANK',
            roadMeters: 1500,
            waterMeters: 200,
            launchSeconds: 40,
            launchPoint: null,
          },
        }}
      />,
    );
    expect(line()).toHaveTextContent('varo dalla riva');
    rerender(<DispatchWaterRoute option={{ ...option, destination: 'MEETING_POINT' }} />);
    expect(line()).toHaveTextContent('Al punto di raccolta');
    rerender(<DispatchWaterRoute option={option} />);
    expect(screen.queryByTestId('dispatch-water-route')).not.toBeInTheDocument();
  });
});

describe('refusals mapped to a clear sentence and a fix-it link', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NextIntlClientProvider locale="it" messages={loadMessagesSync('it')} timeZone="Europe/Rome">
      {children}
    </NextIntlClientProvider>
  );
  const refusal = (code: string, details?: unknown) =>
    new ApiClientError({ code: code as never, message: code, status: 409, details });

  it('covers NEEDS_NAUTICAL_BASE, NAUTICAL_SITE_REQUIRED and every CAPACITY_EXCEEDED reason', () => {
    const { result } = renderHook(() => useFixIt(), { wrapper });
    const fix = result.current;
    expect(fix(refusal('NEEDS_NAUTICAL_BASE', { reason: 'NEEDS_NAUTICAL_BASE' }))).toMatchObject({
      message: expect.stringContaining('solo in una Base nautica'),
      fix: { label: 'Acquista una Base nautica', href: NAUTICAL_SITES_HREF },
    });
    expect(fix(refusal('NAUTICAL_SITE_REQUIRED'))).toMatchObject({
      fix: { label: 'Mostra i siti nautici', href: NAUTICAL_SITES_HREF },
    });
    expect(
      fix(
        refusal('CAPACITY_EXCEEDED', {
          reason: 'NO_ROOM',
          domain: 'WATER',
          upgrade: 'PIER',
          used: 2,
          total: 2,
        }),
        {
          facilityId: 'fac_9',
        },
      ),
    ).toMatchObject({
      reason: 'NO_ROOM',
      message: 'Ormeggi pieni in questa Base nautica (2 su 2): amplia il Pontile.',
      fix: { label: 'Amplia il Pontile', href: '/game/facilities?id=fac_9' },
    });
    expect(
      fix(
        refusal('CAPACITY_EXCEEDED', {
          reason: 'NO_ROOM',
          domain: 'GROUND',
          upgrade: 'GARAGE',
          used: 6,
          total: 6,
        }),
        {
          facilityId: 'fac_9',
        },
      ),
    ).toMatchObject({
      message: 'Nessun posto libero in questa sede (6 su 6): amplia l’autorimessa.',
      fix: { label: 'Amplia l’autorimessa' },
    });
    expect(
      fix(refusal('CAPACITY_EXCEEDED', { reason: 'INCOMPATIBLE_FACILITY' }), { family: 'EMS' }),
    ).toMatchObject({
      fix: { href: '/game/facilities?new=EMS' },
    });
    expect(
      fix(refusal('CAPACITY_EXCEEDED', { reason: 'FACILITY_NOT_OPERATIONAL' }), { facilityId: 'fac_9' }),
    ).toMatchObject({
      message: expect.stringContaining('ancora in costruzione'),
      fix: { label: 'Apri la sede' },
    });
    // anything else: the usual sentence, no link
    expect(fix(refusal('CAPACITY_EXCEEDED'))).toMatchObject({ fix: null });
    expect(fix(refusal('INSUFFICIENT_CREDITS'))).toMatchObject({
      message: 'Crediti insufficienti.',
      fix: null,
    });
  });
});

describe('shop and Base nautica', () => {
  const boatType = {
    code: 'FIRE_BOAT',
    family: 'FIRE',
    domain: 'WATER',
    name: { key: 'vehicle.FIRE_BOAT.name', params: { fallback: 'Gommone da soccorso' } },
    description: { key: 'vehicle.FIRE_BOAT.description', params: { fallback: 'Gommone' } },
    price: '4100',
    requiredLevel: 8,
    capacityPoints: 1,
    crewMin: 2,
    crewOptimal: 4,
    speedFactor: 0.8,
    deliverySeconds: 180,
    capabilities: [],
    compatibleFacilityTypes: ['NAUTICAL_BASE'],
    icon: 'vehicle-fire-boat',
    unlocked: true,
    lockedReason: null,
    movement: 'ROAD_TRAILER',
  };

  it('a boat without a Base nautica: "Serve una Base nautica" with the link to the nautical sites', () => {
    renderGame(
      <ul>
        <VehicleOffer
          type={boatType as never}
          onBuy={() => undefined}
          busy={false}
          host={{ kind: 'NO_FACILITY' }}
          familyLevel={1}
        />
      </ul>,
    );
    expect(screen.getByTestId('blocked-reason')).toHaveTextContent('Serve una Base nautica');
    expect(screen.getByTestId('blocked-fix')).toHaveAttribute('href', NAUTICAL_SITES_HREF);
  });

  it('a full Base nautica: the pier, on the base page; a server refusal shows in the card with its fix', () => {
    renderGame(
      <ul>
        <VehicleOffer
          type={boatType as never}
          onBuy={() => undefined}
          busy={false}
          host={{ kind: 'NO_CAPACITY' }}
          familyLevel={1}
          rejection={{
            code: 'CAPACITY_EXCEEDED',
            reason: 'NO_ROOM',
            message: 'Ormeggi pieni in questa Base nautica (2 su 2): amplia il Pontile.',
            fix: { label: 'Amplia il Pontile', href: `/game/facilities?id=${base().id}` },
          }}
        />
      </ul>,
      { facilities: [station, base({ capacities: [{ domain: 'WATER', total: 2, used: 2 }] })] },
    );
    expect(screen.getByTestId('blocked-reason')).toHaveTextContent('Ormeggi pieni');
    expect(screen.getByTestId('blocked-fix')).toHaveAttribute('href', `/game/facilities?id=${base().id}`);
    expect(screen.getByTestId('buy-rejection')).toHaveAttribute('data-reason', 'NO_ROOM');
    expect(screen.getByTestId('buy-rejection-fix')).toHaveTextContent('Amplia il Pontile');
  });

  it('the water tab explains where boats live, which bases qualify, and the boats still at a station', () => {
    const { unmount } = renderGame(<BoatHomeCard />);
    expect(screen.getByTestId('boat-home')).toHaveAttribute('data-bases', '0');
    expect(screen.getByTestId('boat-home-none')).toHaveTextContent('Non hai ancora una Base nautica');
    expect(screen.getByTestId('boat-home-buy-base')).toHaveAttribute('href', NAUTICAL_SITES_HREF);
    unmount();
    renderGame(<BoatHomeCard />, { facilities: [station, base()], vehicles: [boat()] });
    expect(screen.getByTestId('boat-home-base')).toHaveAttribute('data-free', '2');
    expect(screen.getByTestId('boat-home-base')).toHaveTextContent('2 ormeggi liberi su 2');
    expect(screen.getByTestId('boat-home-legacy')).toHaveTextContent('spostala gratis');
  });

  it('spells out the conditions of a Base nautica on a nautical site', () => {
    const site = {
      id: 'sit_01J8Z0000000000000000000AA',
      name: 'Base nautica Marina di Pescara',
      nautical: {
        waterBody: 'SEA',
        waterBodyId: 'sea:adriatic',
        waterBodyName: 'Mare Adriatico',
        berth: BERTH,
      },
    } as unknown as SiteDto;
    renderGame(<NauticalConditions site={site} />);
    const box = screen.getByTestId('nautical-conditions');
    expect(box).toHaveTextContent(/7\.?000/); // jsdom's ICU groups 4-digit Italian numbers, Chromium does not
    expect(box).toHaveTextContent('Dal livello 6');
    expect(box).toHaveTextContent('2 posti barca, fino a 4 con il Pontile');
    expect(box).toHaveTextContent('Mare Adriatico');
  });
});

describe('a boat left at a fire station', () => {
  beforeEach(() => vi.mocked(facilitiesApi.transferVehicle).mockReset());

  it('moves to the Base nautica for free in one tap', async () => {
    const target = base();
    vi.mocked(facilitiesApi.transferVehicle).mockResolvedValue({
      vehicle: boat({ facilityId: target.id, status: 'IN_DELIVERY' }),
      facilities: [station, target],
    } as never);
    renderGame(<FreeBoatTransfer vehicle={boat()} />, { facilities: [station, target], vehicles: [boat()] });
    const box = screen.getByTestId('free-boat-transfer');
    expect(box).toHaveAttribute('data-state', 'READY');
    expect(box).toHaveTextContent('spostala gratis in Base nautica Marina di Pescara');
    fireEvent.click(screen.getByTestId('free-boat-transfer-button'));
    await waitFor(() =>
      expect(facilitiesApi.transferVehicle).toHaveBeenCalledWith(CAREER_ID, boat().id, target.id),
    );
  });

  it('without a base: it keeps working, the way to move it is a Base nautica', () => {
    renderGame(<FreeBoatTransfer vehicle={boat()} />, { vehicles: [boat()] });
    expect(screen.getByTestId('free-boat-transfer')).toHaveAttribute('data-state', 'NO_BASE');
    expect(screen.getByRole('link', { name: /Acquista una Base nautica/ })).toHaveAttribute(
      'href',
      NAUTICAL_SITES_HREF,
    );
  });

  it('says nothing for a boat already at its Base nautica, nor for a land vehicle', () => {
    const { container } = renderGame(<FreeBoatTransfer vehicle={boat({ facilityId: base().id })} />, {
      facilities: [station, base()],
    });
    expect(container).toBeEmptyDOMElement();
  });
});
