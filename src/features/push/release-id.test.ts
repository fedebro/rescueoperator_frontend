import { describe, expect, it } from 'vitest';
import { buildStamp, resolveReleaseId } from './release-id';

describe('release id (D-98: the permission sheet is asked once per release)', () => {
  const at = new Date('2026-09-28T16:36:39.512Z');

  it('defaults to the build instant — a new build is a new release, nothing to set at deploy time', () => {
    expect(buildStamp(at)).toBe('20260928T163639Z');
    expect(resolveReleaseId({}, at)).toBe('20260928T163639Z');
    expect(resolveReleaseId({ RELEASE_ID: '  ' }, at)).toBe('20260928T163639Z');
    // Two builds a second apart are two releases.
    expect(resolveReleaseId({}, new Date(at.getTime() + 1000))).not.toBe(resolveReleaseId({}, at));
  });

  it('RELEASE_ID pins it (then an explicit NEXT_PUBLIC_RELEASE_ID)', () => {
    expect(resolveReleaseId({ RELEASE_ID: 'v1.4.0' }, at)).toBe('v1.4.0');
    expect(resolveReleaseId({ NEXT_PUBLIC_RELEASE_ID: 'ci-812' }, at)).toBe('ci-812');
    expect(resolveReleaseId({ RELEASE_ID: 'v1.4.0', NEXT_PUBLIC_RELEASE_ID: 'ci-812' }, at)).toBe('v1.4.0');
  });
});
