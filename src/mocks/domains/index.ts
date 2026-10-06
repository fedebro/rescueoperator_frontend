import type { MockEngine } from '../engine';
import { installFamilies } from './families';
import { installFacilities } from './facilities';
import { installWater } from './water';
import { installPersonnel } from './personnel';
import { installMedical } from './medical';
import { installLogistics } from './logistics';
import { installAutonomy } from './autonomy';
import { installMajor } from './major';
import { installWorld } from './world';
import { installMonetization } from './monetization';
import { installPlatform } from './platform';
import { installPush } from './push';
import { installAdmin } from './admin';
import { installCommunity } from './community';
import { installAlliance } from './alliance';
import { installAllianceSocial } from './alliance-social';
import { installAllianceAid } from './alliance-aid';
import { installAllianceProgress } from './alliance-progress';
import { installAllianceOperations } from './alliance-operations';
import { installQa } from '../qa';

const installed = new WeakSet<MockEngine>();

/**
 * Wires every domain module into the engine exactly once. Domains never import each other's internals:
 * they communicate through `engine.hooks`, scheduled actions and the state stored under `career.ext.<domain>`.
 */
export function installDomains(engine: MockEngine): void {
  if (installed.has(engine)) return;
  installed.add(engine);
  // QA helpers first: domains extend `engine.qa` (and may override entries such as `staffAll`) while installing.
  installQa(engine);
  installFamilies(engine);
  installFacilities(engine);
  // Water scene (D-68): places water incidents, gates and routes boats — before the domains that react to spawns.
  installWater(engine);
  installPersonnel(engine);
  installMedical(engine);
  installLogistics(engine);
  // Vehicle autonomy (D-22) reads the warehouses of the logistics domain: installed right after it.
  installAutonomy(engine);
  // Major incidents (D-24 / D-69): their members are normal incidents of the core, so every other domain applies to them.
  installMajor(engine);
  installWorld(engine);
  installMonetization(engine);
  installPlatform(engine);
  installPush(engine);
  installAdmin(engine);
  // Alliances (D-102…D-123): blocks / rules / account first (the alliance module reads them), then the alliance itself.
  installCommunity(engine);
  installAlliance(engine);
  installAllianceSocial(engine);
  installAllianceProgress(engine);
  installAllianceAid(engine);
  installAllianceOperations(engine);
}

/** Typed accessor for a domain's per-career state (created on first use — old saves stay loadable). */
export function domainState<T>(career: { ext: Record<string, unknown> }, key: string, init: () => T): T {
  return (career.ext[key] ??= init()) as T;
}
