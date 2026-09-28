import { afterEach, describe, expect, it, vi } from 'vitest';
import { haversineMeters } from '@/lib/geo';
import { CAREER_ID, INCIDENT_ID, incident, vehicle } from '@/test/fixtures';
import {
  CENTER,
  MAJOR_ID,
  SUB_ID,
  linkedIncident,
  mainScene,
  majorDto,
  majorRef,
} from '@/test/major-fixtures';
import {
  acknowledgeMajor,
  acknowledgedMajors,
  activeMajorIdOf,
  assignedVehicles,
  circleRing,
  columnEtaSeconds,
  groupNeeds,
  groupShares,
  isMajorNotification,
  isMajorStartNotification,
  liveGroups,
  liveProgress,
  majorLedgerDetail,
  majorMapFeatures,
  memberSignature,
  percent,
  phaseIndex,
  rewardLine,
  splitQueue,
  vehiclesByFamily,
} from './major';

const other = (id: string, severity: number) =>
  incident({ id: `inc_01J8Z00000000000000000000${id}`, severity, major: undefined });

describe('the queue: majors pinned on top', () => {
  it('puts every running major first, its main scene then its linked incidents in sector order', () => {
    const bySeverity = (a: { severity: number }, b: { severity: number }) => b.severity - a.severity;
    const { majors, others } = splitQueue(
      [other('C1', 2), linkedIncident(), other('C2', 7), mainScene()],
      bySeverity,
    );
    expect(majors).toHaveLength(1);
    expect(majors[0]!.majorId).toBe(MAJOR_ID);
    expect(majors[0]!.members.map((m) => m.id)).toEqual([INCIDENT_ID, SUB_ID]);
    expect(majors[0]!.ref.role).toBe('MAIN');
    expect(others.map((o) => o.severity)).toEqual([7, 2]);
  });

  it('knows the running major from the snapshot, else from a member', () => {
    expect(activeMajorIdOf({ activeMajorIncidentId: 'mjr_x', incidents: [] })).toBe('mjr_x');
    expect(activeMajorIdOf({ incidents: [other('C1', 2), linkedIncident()] })).toBe(MAJOR_ID);
    expect(activeMajorIdOf({ activeMajorIncidentId: null, incidents: [other('C1', 2)] })).toBeNull();
  });
});

describe('progress and the requirement bars grouped by service', () => {
  it('follows the main scene live from its anchored work model', () => {
    const anchorAt = '2026-01-01T10:00:00.000Z';
    const main = mainScene({
      status: 'ON_SCENE',
      work: {
        total: 100,
        remaining: 80,
        ratePerSecond: 1,
        anchorAt,
        estimatedEndAt: '2026-01-01T10:01:20.000Z',
      },
    });
    const t0 = Date.parse(anchorAt);
    expect(liveProgress(main, 0, t0)).toBeCloseTo(0.2);
    expect(liveProgress(main, 0, t0 + 40_000)).toBeCloseTo(0.6);
    expect(liveProgress(main, 0, t0 + 999_000)).toBe(1);
    expect(liveProgress(mainScene({ status: 'RESOLVING' }), 0.3, t0)).toBe(1);
    expect(liveProgress(undefined, 0.3, t0)).toBe(0.3);
  });

  it('sums the open members per service, FIRE first, with the columns’ part from the server', () => {
    const groups = liveGroups(
      [
        mainScene(),
        linkedIncident(),
        linkedIncident({ id: 'inc_01J8Z0000000000000000000CC', status: 'RESOLVED' }),
      ],
      [
        {
          family: 'FIRE',
          required: 0,
          onScene: 0,
          enRoute: 0,
          reinforced: 60,
          coverage: 1,
          capabilities: [
            {
              capability: 'FIRE_SUPPRESSION',
              level: 'REQUIRED',
              required: 0,
              onScene: 0,
              enRoute: 0,
              reinforced: 60,
              external: false,
            },
          ],
        },
      ],
    );
    expect(groups.map((g) => g.family)).toEqual(['FIRE', 'EMS', 'POLICE']);
    const fire = groups[0]!;
    // main 200 + linked 50 (the resolved member is out)
    expect(fire.capabilities.find((c) => c.capability === 'FIRE_SUPPRESSION')).toMatchObject({
      required: 250,
      onScene: 100,
      enRoute: 50,
      reinforced: 60,
    });
    // FIRE_SUPPRESSION 100/250 and WATER_SUPPLY 100/100 → (0.4 + 1) / 2
    expect(fire.coverage).toBeCloseTo(0.7);
    expect(groups[1]!.coverage).toBe(0);
  });

  it('counts a need fully taken by a reinforcement column as covered', () => {
    const [ems] = liveGroups([
      mainScene({
        requirements: [
          {
            capability: 'MEDICAL_BASIC',
            level: 'REQUIRED',
            required: 80,
            onScene: 0,
            enRoute: 0,
            family: 'EMS',
            external: true,
            externalSource: 'REINFORCEMENTS',
          },
        ],
      }),
    ]);
    expect(ems!.coverage).toBe(1);
    expect(ems!.capabilities[0]!.external).toBe(true);
    expect(ems!.required).toBe(0);
  });

  it('never lets a surplus on one need hide a shortage on another', () => {
    const shares = groupShares({
      capabilities: [
        {
          capability: 'A',
          level: 'REQUIRED',
          required: 100,
          onScene: 300,
          enRoute: 0,
          reinforced: 0,
          external: false,
        },
        {
          capability: 'B',
          level: 'REQUIRED',
          required: 100,
          onScene: 0,
          enRoute: 50,
          reinforced: 0,
          external: false,
        },
        {
          capability: 'C',
          level: 'REQUIRED',
          required: 0,
          onScene: 0,
          enRoute: 0,
          reinforced: 40,
          external: true,
        },
      ],
    });
    expect(shares).toEqual({ onScene: 0.5, enRoute: 0.25 });
    expect(groupShares({ capabilities: [] })).toEqual({ onScene: 1, enRoute: 0 });
  });

  it('says how many needs are covered, and when a service holds nothing indispensable', () => {
    const [, , police] = liveGroups([mainScene()]);
    // Only a RECOMMENDED need: its server coverage is 1 by definition, the view shows the level instead.
    expect(groupNeeds(police!)).toEqual({ total: 1, covered: 0, measured: false, topLevel: 'RECOMMENDED' });
    const [fire] = liveGroups([mainScene()]);
    expect(groupNeeds(fire!)).toEqual({ total: 2, covered: 1, measured: true, topLevel: 'REQUIRED' });
  });
});

describe('sectors, vehicles, numbers', () => {
  it('lists the vehicles of a sector by service, the fleet order', () => {
    const fire = vehicle({ id: 'veh_01J8Z0000000000000000000B1', incidentId: INCIDENT_ID });
    const ems = vehicle({ id: 'veh_01J8Z0000000000000000000B2', family: 'EMS', incidentId: INCIDENT_ID });
    const listed = vehicle({ id: 'veh_01J8Z0000000000000000000B3', family: 'POLICE' });
    const elsewhere = vehicle({ id: 'veh_01J8Z0000000000000000000B4', incidentId: SUB_ID });
    const assigned = assignedVehicles(mainScene({ assignedVehicleIds: [listed.id] }), [
      ems,
      listed,
      fire,
      elsewhere,
    ]);
    expect(assigned.map((v) => v.id).sort()).toEqual([fire.id, ems.id, listed.id].sort());
    expect(vehiclesByFamily(assigned).map((g) => [g.family, g.vehicles.length])).toEqual([
      ['FIRE', 1],
      ['EMS', 1],
      ['POLICE', 1],
    ]);
  });

  it('rounds shares to whole percents and phases to their step', () => {
    expect(percent(0.456)).toBe(46);
    expect(percent(-0.2)).toBe(0);
    expect(percent(1.12)).toBe(112);
    expect(phaseIndex('ALARM')).toBe(0);
    expect(phaseIndex('SECURING')).toBe(3);
    expect(phaseIndex('ENDED')).toBe(4);
  });

  it('counts a column down to its arrival, and shows the estimate until the final bonus is known', () => {
    expect(columnEtaSeconds('2026-01-01T10:05:00.000Z', Date.parse('2026-01-01T10:04:00.000Z'))).toBe(60);
    expect(columnEtaSeconds('2026-01-01T10:05:00.000Z', Date.parse('2026-01-01T10:06:00.000Z'))).toBe(0);
    expect(rewardLine(majorDto())).toEqual({ kind: 'estimate', min: '350', max: '840' });
    expect(
      rewardLine(majorDto({ status: 'ENDED', reward: { ...majorDto().reward, credits: '784' } })),
    ).toEqual({ kind: 'final', min: '784', max: '784' });
  });

  it('changes its member signature on a dispatch or a status change only', () => {
    const base = memberSignature([mainScene(), linkedIncident()]);
    expect(memberSignature([mainScene({ severity: 7 }), linkedIncident()])).toBe(base);
    expect(
      memberSignature([
        mainScene({ assignedVehicleIds: ['veh_01J8Z0000000000000000000AA'] }),
        linkedIncident(),
      ]),
    ).not.toBe(base);
    expect(memberSignature([mainScene({ status: 'RESPONDING' }), linkedIncident()])).not.toBe(base);
  });
});

describe('the map: event area, links, label', () => {
  it('draws a closed circle of the given radius', () => {
    const ring = circleRing(CENTER, 350, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    for (const point of ring) expect(haversineMeters(CENTER, point)).toBeCloseTo(350, -1);
  });

  it('builds one area per major, a link per linked incident, and the label point apart', () => {
    const { areas, centres } = majorMapFeatures(
      [mainScene(), linkedIncident(), other('C1', 3)],
      () => 'MAXI-EMERGENZA',
    );
    expect(areas.features.filter((f) => f.geometry.type === 'Polygon')).toHaveLength(1);
    const links = areas.features.filter((f) => f.geometry.type === 'LineString');
    expect(links).toHaveLength(1);
    expect(links[0]!.properties).toMatchObject({ incidentId: SUB_ID, link: 1 });
    expect(links[0]!.geometry.coordinates).toEqual([CENTER, [14.225, 42.468]]);
    expect(centres.features).toHaveLength(1);
    expect(centres.features[0]!.properties).toMatchObject({
      kind: 'major',
      id: MAJOR_ID,
      label: 'MAXI-EMERGENZA',
    });
    expect(majorMapFeatures([other('C1', 3)], () => '').areas.features).toHaveLength(0);
  });
});

describe('the alert is shown once per major and device', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('remembers the acknowledged majors of a career, the last 20', () => {
    expect(acknowledgedMajors(CAREER_ID).size).toBe(0);
    acknowledgeMajor(CAREER_ID, MAJOR_ID);
    expect(acknowledgedMajors(CAREER_ID).has(MAJOR_ID)).toBe(true);
    expect(acknowledgedMajors('car_other').size).toBe(0);
    for (let i = 0; i < 25; i++) acknowledgeMajor(CAREER_ID, `mjr_${i}`);
    expect(acknowledgedMajors(CAREER_ID).size).toBe(20);
    expect(acknowledgedMajors(CAREER_ID).has('mjr_24')).toBe(true);
  });

  it('survives a blocked or corrupted storage', () => {
    localStorage.setItem(`rc-major-ack:${CAREER_ID}`, '{not json');
    expect(acknowledgedMajors(CAREER_ID).size).toBe(0);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => acknowledgeMajor(CAREER_ID, MAJOR_ID)).not.toThrow();
  });
});

describe('notifications and the ledger', () => {
  it('recognises the major notifications and the start one', () => {
    expect(isMajorNotification({ title: { key: 'major.notification.GROWTH.title' } })).toBe(true);
    expect(isMajorStartNotification({ title: { key: 'major.notification.STARTED.title' } })).toBe(true);
    expect(isMajorStartNotification({ title: { key: 'major.notification.GROWTH.title' } })).toBe(false);
    expect(isMajorNotification({ title: { key: 'notification.LEVEL_UP.title' } })).toBe(false);
  });

  it('reads which major a MAJOR_INCIDENT ledger line pays, and how it ended', () => {
    expect(
      majorLedgerDetail({
        entryType: 'MAJOR_INCIDENT',
        description: {
          key: 'ledger.MAJOR_INCIDENT',
          params: { scenario: 'MAJ_GAS_EXPLOSION', outcome: 'PARTIAL' },
        },
      }),
    ).toEqual({ scenarioCode: 'MAJ_GAS_EXPLOSION', outcome: 'PARTIAL' });
    expect(majorLedgerDetail({ entryType: 'MAJOR_INCIDENT', description: { key: 'x' } })).toEqual({
      scenarioCode: null,
      outcome: null,
    });
    expect(majorLedgerDetail({ entryType: 'FUEL', description: { key: 'x' } })).toBeNull();
  });

  it('keeps the member reference of the fixtures consistent', () => {
    expect(majorRef({ role: 'SUB', sector: 2 })).toMatchObject({ id: MAJOR_ID, role: 'SUB', sector: 2 });
  });
});
