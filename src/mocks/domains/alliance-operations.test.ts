import { describe, expect, it } from 'vitest';
// The domains index first: `alliance.ts` imports it back, and the aid domain reads alliance constants at module level.
import './index';
import type { MockError } from '../engine';
import { allianceOperationsOf, OPERATION_CFG } from './alliance-operations';
import { progressWorld } from './alliance-progress.test';
import { allianceSocialOf } from './alliance-social';
import { majorOf } from './major';

const error = (fn: () => unknown): MockError => {
  try {
    fn();
  } catch (e) {
    return e as MockError;
  }
  throw new Error('expected a MockError');
};

function world() {
  const w = progressWorld();
  (w.qa.addVehicles as (t: string, n: number) => unknown)('FIRE_APS', 6);
  return {
    ...w,
    ops: allianceOperationsOf(w.engine),
    social: allianceSocialOf(w.engine),
    majors: majorOf(w.engine),
  };
}

describe('mock alliance operations', () => {
  it('alert → joins and refusals → active with real and synthetic fronts → channel → end with outcome and rewards', () => {
    const w = world();
    const marta = w.ally('Marta');
    const luca = w.ally('Luca', { level: 3 });
    const started = w.ops.start(w.allianceId, 'AOP_VALLEY_FLOOD', { alertSeconds: 300 });
    expect(started).toMatchObject({ status: 'ALERT', joinedCount: 0 });
    expect(started.participants).toHaveLength(3);
    expect(error(() => w.ops.start(w.allianceId, 'AOP_WILDFIRE', {})).details).toMatchObject({
      reason: 'OPERATION_RUNNING',
    });
    expect(w.ops.current(w.career)!.me).toMatchObject({ status: 'INVITED', canJoin: true });
    expect(w.alliances.home(w.career).alliance!.operationId).toBe(started.id);

    // Level 3 cannot join (07 §3.1), may say "not now"; the founder and Marta join.
    expect(error(() => w.ops.join(w.careerOf(luca))).details).toMatchObject({ reason: 'LEVEL_TOO_LOW' });
    expect(
      w.ops.decline(w.careerOf(luca)).participants.find((p) => p.participant.careerId === luca)!.status,
    ).toBe('DECLINED');
    expect(w.ops.join(w.career).me).toMatchObject({
      status: 'JOINED',
      canJoin: false,
      blockedReason: 'ALREADY_JOINED',
    });
    expect(w.ops.join(w.careerOf(marta)).joinedCount).toBe(2);
    expect(
      w.alliances.sync(w.career, 0).events.filter((e) => e.type === 'alliance.operation.updated').length,
    ).toBeGreaterThanOrEqual(3);

    // The alert ends: ACTIVE, my front is a real major of my world, Marta's is simulated, the OPERATION channel opens.
    w.advance(300_000 + 1000);
    const active = w.ops.current(w.career)!;
    expect(active.status).toBe('ACTIVE');
    expect(active.phase).not.toBeNull();
    expect(active.endsAt).not.toBeNull();
    expect(active.me.majorId).not.toBeNull();
    const major = w.majors.current(w.career)!;
    expect(major.id).toBe(active.me.majorId);
    expect(major.allianceOperationId).toBe(started.id);
    const martaRow = active.participants.find((p) => p.participant.careerId === marta)!;
    expect(martaRow.front).toMatchObject({ progress: 0, ended: false });
    expect(active.channelId).not.toBeNull();
    expect(
      w.social.listChannels(w.career).some((c) => c.id === active.channelId && c.kind === 'OPERATION'),
    ).toBe(true);

    // Time: the simulated front advances on its own; QA can push it to the end.
    w.advance(OPERATION_CFG.tickSeconds * 1000 + 1000);
    expect(
      w.ops.current(w.career)!.participants.find((p) => p.participant.careerId === marta)!.front!.progress,
    ).toBeGreaterThan(0);
    (w.qa.advanceOperation as (p: number) => unknown)(1);
    expect(
      w.ops.current(w.career)!.participants.find((p) => p.participant.careerId === marta)!.front!.ended,
    ).toBe(true);

    // The clock runs out: outcome, alliance XP, rewards for those who contributed, channel archived, history.
    const xp = w.alliances.alliance(w.allianceId)!.xp;
    const ended = (w.qa.endOperation as () => ReturnType<typeof w.ops.current>)()!;
    expect(ended.status).toBe('ENDED');
    expect(['GOLD', 'SILVER', 'BRONZE', 'FAILED']).toContain(ended.outcome);
    expect(ended.reward.allianceXp).toBe(OPERATION_CFG.allianceXp[ended.outcome!]);
    expect(w.alliances.alliance(w.allianceId)!.xp - xp).toBe(ended.reward.allianceXp);
    const martaEnd = ended.participants.find((p) => p.participant.careerId === marta)!;
    expect(martaEnd.reward).toMatchObject({
      eligible: true,
      multiplier: OPERATION_CFG.multiplier[ended.outcome!],
    });
    expect(w.social.listChannels(w.career).find((c) => c.id === active.channelId)!.archived).toBe(true);
    expect(w.ops.history(w.career, {}).data).toHaveLength(1);
    expect(w.ops.current(w.career)!.id).toBe(started.id); // recent: the outcome summary stays reachable
    expect(w.alliances.home(w.career).alliance!.operationId).toBeNull();
    expect(w.alliances.log(w.career).data.map((e) => e.action)).toEqual(
      expect.arrayContaining(['OPERATION_STARTED', 'OPERATION_ENDED']),
    );
  });

  it('fewer than two joined at the end of the alert: cancelled without consequences; a new alert may follow', () => {
    const w = world();
    w.ally('Marta');
    const started = w.ops.start(w.allianceId, 'AOP_STORM_WAVE', { alertSeconds: 120 });
    w.ops.join(w.career);
    w.advance(120_000 + 1000);
    expect(w.ops.current(w.career)).toMatchObject({ id: started.id, status: 'CANCELLED', joinedCount: 1 });
    expect(w.majors.current(w.career)).toBeNull();
    expect(w.ops.start(w.allianceId, 'AOP_SNOWFALL', { alertSeconds: 60 }).status).toBe('ALERT');
  });
});
