import type { ServiceFamily } from '@/contracts';
import { INCIDENT_TEMPLATES, bandFor, resolvedFamilyLevel, xpThreshold } from '../data/catalog';
import { MockError, type MockCareer, type MockEngine } from '../engine';

/**
 * Families area. The core loop already owns the rules (family unlock by level in `awardXp`, `externalFamilies` /
 * `requirement.external` at spawn, UNG units while RESOLVING): this module only adds the QA shortcuts that make those
 * states reachable on demand — they go through the same engine functions, so every invariant holds.
 */
export interface MixedSpawn {
  incidentId: string;
  templateCode: string;
  externalFamilies: ServiceFamily[];
}

/** First mixed template this career can receive that involves a still-locked family AND always calls a system unit. */
export function pickMixedTemplate(career: MockCareer): { code: string; severity: number } | null {
  const { level, unlockedFamilies } = career.summary;
  for (const t of INCIDENT_TEMPLATES) {
    // A land incident: a water one would need a boat or the Coast Guard (another story, see domains/water.ts).
    if (t.tutorial || t.water || t.minLevel > level || !unlockedFamilies.includes(t.primaryFamily)) continue;
    if (!t.families.some((f) => f !== 'UNG' && !unlockedFamilies.includes(f))) continue;
    for (let severity = t.severity[0]; severity <= t.severity[1]; severity++) {
      const band = bandFor(t, severity);
      const lockedNeed = band.requirements.some((r) => !unlockedFamilies.includes(r.family));
      if (band.minLevel <= level && lockedNeed && band.ung.some((u) => u.probability >= 1))
        return { code: t.code, severity };
    }
  }
  return null;
}

export function installFamilies(engine: MockEngine): void {
  const current = (): MockCareer => engine.qa.career();
  const helpers = {
    /** Levels the career up to the unlock level of `family` (same path as organic XP: events, bonus, notification). */
    unlockFamily: (family: ServiceFamily): number => {
      const career = current();
      const level = resolvedFamilyLevel(family);
      const missing = xpThreshold(level) - Number(career.summary.xp);
      if (missing > 0) engine.awardXp(career, missing);
      engine.save();
      return level;
    },
    /** Spawns a multi-service incident with a locked family and a guaranteed external-support (UNG) phase. */
    spawnMixed: (): MixedSpawn => {
      const career = current();
      const pick = pickMixedTemplate(career);
      if (!pick) throw new MockError(409, 'CONFLICT', 'No mixed template with a locked family at this level');
      const incident = engine.spawnIncident(career, pick.code, false, { severity: pick.severity });
      engine.save();
      return {
        incidentId: incident.id,
        templateCode: pick.code,
        externalFamilies: incident.externalFamilies ?? [],
      };
    },
  };
  // `installQa` runs after the domains and replaces `engine.qa`: attach once it exists (works with either order).
  const attach = () => Object.assign(engine.qa, helpers);
  if (engine.qa) attach();
  else queueMicrotask(attach);
}
