import { describe, expect, it } from 'vitest';
import { IncidentDto, type RealtimeEnvelope } from '@/contracts';
import { MockEngine, memoryStorage, type MockCareer } from '../engine';
import { resolvedFamilyLevel } from '../data/catalog';
import { catalogDto } from '../catalog-dto';
import { installDomains } from './index';
import { pickMixedTemplate, type MixedSpawn } from './families';

async function world() {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 11;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  installDomains(engine);
  await Promise.resolve(); // QA helpers of the domains attach right after `installQa`
  engine.qa.createReadyCareer({
    email: 'fam@example.com',
    directorName: 'Director Fam',
    level: 2,
    credits: 50_000,
  });
  const career = engine.qa.career() as MockCareer;
  const advance = (seconds: number, step = 1) => {
    for (let t = 0; t < seconds; t += step) {
      now += step * 1000;
      engine.process();
    }
  };
  const qa = engine.qa as unknown as {
    unlockFamily: (family: string) => number;
    spawnMixed: () => MixedSpawn;
    staffAll: () => void;
  };
  return { engine, events, career, advance, qa };
}

describe('family unlocks', () => {
  it('resolves WILDFIRE / ALPINE per territory and exposes lock state in the catalog', async () => {
    const w = await world();
    expect(resolvedFamilyLevel('EMS')).toBe(3);
    expect(resolvedFamilyLevel('POLICE')).toBe(6);
    expect(resolvedFamilyLevel('WILDFIRE')).toBeLessThan(resolvedFamilyLevel('ALPINE'));
    const families = catalogDto(w.engine, w.career).families;
    expect(families.filter((f) => f.playerManaged).map((f) => f.code)).toEqual([
      'FIRE',
      'EMS',
      'POLICE',
      'WILDFIRE',
      'ALPINE',
    ]);
    expect(families.find((f) => f.code === 'EMS')).toMatchObject({ unlocked: false, requiredLevel: 3 });
    expect(families.find((f) => f.code === 'FIRE')!.unlocked).toBe(true);
  });

  it('unlocking the second family emits unlock.granted and updates the career', async () => {
    const w = await world();
    expect(w.career.summary.unlockedFamilies).toEqual(['FIRE']);
    expect(w.qa.unlockFamily('EMS')).toBe(3);
    expect(w.career.summary.unlockedFamilies).toEqual(['FIRE', 'EMS']);
    const unlock = w.events.find(
      (e) => e.type === 'unlock.granted' && (e.payload.unlocks as string[]).includes('EMS'),
    );
    expect(unlock).toBeDefined();
    const xp = w.events.filter((e) => e.type === 'xp.awarded').at(-1)!;
    expect((xp.payload.career as { unlockedFamilies: string[] }).unlockedFamilies).toContain('EMS');
    const ambulance = catalogDto(w.engine, w.career).vehicleTypes.find((v) => v.code === 'EMS_MSB')!;
    expect(ambulance).toMatchObject({ unlocked: true, lockedReason: null });
  });
});

describe('mixed incidents with a locked family', () => {
  it('picks a template with a locked family and a guaranteed system unit', async () => {
    const w = await world();
    w.qa.unlockFamily('EMS');
    const pick = pickMixedTemplate(w.career)!;
    expect(pick).not.toBeNull();
    const spawned = w.qa.spawnMixed();
    expect(spawned.templateCode).toBe(pick.code);
    expect(spawned.externalFamilies).toContain('POLICE');
    expect(spawned.externalFamilies).not.toContain('EMS');
  });

  it('marks external requirements, ignores them in coverage and runs the external-support phase', async () => {
    const w = await world();
    w.qa.unlockFamily('EMS');
    w.qa.staffAll();
    const { incidentId } = w.qa.spawnMixed();
    const incident = w.career.incidents.find((i) => i.id === incidentId)!;
    expect(IncidentDto.safeParse(incident).success).toBe(true);
    const external = incident.requirements.filter((r) => r.external);
    expect(external.length).toBeGreaterThan(0);
    expect(external.every((r) => r.family === 'POLICE')).toBe(true);
    expect(incident.requirements.filter((r) => !r.external).every((r) => r.family !== 'POLICE')).toBe(true);

    // The recommendation only uses the player's own services and is dispatchable.
    const options = w.engine.dispatchOptions(w.career, incidentId);
    expect(options.recommendedVehicleIds.length).toBeGreaterThan(0);
    w.engine.dispatch(w.career, incidentId, options.recommendedVehicleIds);
    let resolving: IncidentDto | undefined;
    for (let i = 0; i < 1200 && !resolving; i++) {
      w.advance(1);
      const current = w.career.incidents.find((x) => x.id === incidentId);
      if (current?.status === 'RESOLVING') resolving = current;
      if (!current) break;
    }
    expect(resolving, 'the incident reaches RESOLVING with system units').toBeDefined();
    expect(resolving!.rewardedAt).not.toBeNull();
    expect(resolving!.externalSupport!.length).toBeGreaterThan(0);
    expect(resolving!.externalSupport!.every((u) => u.status === 'REQUESTED')).toBe(true);
    expect(w.career.pendingOutcomes.some((o) => o.incidentId === incidentId)).toBe(true);
    // The reward was paid once; RESOLVING incidents accept no more vehicles.
    const rewards = w.career.ledger.filter((l) => l.entryType === 'MISSION_REWARD').length;
    expect(() => w.engine.dispatch(w.career, incidentId, [w.career.vehicles[0]!.id])).toThrowError();

    const statuses = new Set<string>();
    for (let i = 0; i < 3000 && w.career.incidents.some((x) => x.id === incidentId); i++) {
      w.advance(1);
      for (const u of w.career.incidents.find((x) => x.id === incidentId)?.externalSupport ?? [])
        statuses.add(u.status);
    }
    expect(w.career.incidents.some((x) => x.id === incidentId)).toBe(false);
    expect(statuses.has('WORKING')).toBe(true);
    expect(w.career.ledger.filter((l) => l.entryType === 'MISSION_REWARD').length).toBe(rewards);
  });
});
