import type { MockEngine } from '../engine';
import { installFamilies } from './families';
import { installFacilities } from './facilities';
import { installPersonnel } from './personnel';
import { installMedical } from './medical';
import { installLogistics } from './logistics';
import { installWorld } from './world';
import { installMonetization } from './monetization';
import { installPlatform } from './platform';
import { installAdmin } from './admin';
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
  installPersonnel(engine);
  installMedical(engine);
  installLogistics(engine);
  installWorld(engine);
  installMonetization(engine);
  installPlatform(engine);
  installAdmin(engine);
}

/** Typed accessor for a domain's per-career state (created on first use — old saves stay loadable). */
export function domainState<T>(career: { ext: Record<string, unknown> }, key: string, init: () => T): T {
  return (career.ext[key] ??= init()) as T;
}
