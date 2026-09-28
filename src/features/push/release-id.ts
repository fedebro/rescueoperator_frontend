/**
 * How a build gets its release id (D-98) — used by `next.config.ts` at build time, so it must stay dependency-free.
 * `RELEASE_ID` (or an explicit `NEXT_PUBLIC_RELEASE_ID`) pins it; otherwise it is the build instant, `20260928T163639Z`:
 * every build is a new release, with nothing to set at deploy time.
 */
export function buildStamp(now: Date = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

export function resolveReleaseId(env: Record<string, string | undefined>, now: Date = new Date()): string {
  return env.RELEASE_ID?.trim() || env.NEXT_PUBLIC_RELEASE_ID?.trim() || buildStamp(now);
}
