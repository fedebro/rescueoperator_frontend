import { describe, expect, it } from 'vitest';
import { ADMIN_PERMISSIONS, canAdmin, type AdminAction } from '@/lib/api/admin';
import { searchTarget } from './admin-layout';
import { previewAdjustment } from './credit-adjustment';
import { queueHealth } from './dashboard';
import { resolveEnvironment } from './environment';
import { diffJson, parseJsonDocument } from './json-diff';
import { addVertex, canClose, formatCoordinates, parseCoordinates } from './polygon-draw';
import { isOverdue, isRetryable } from './scheduled-actions';

describe('permission matrix', () => {
  const actions = Object.keys(ADMIN_PERMISSIONS) as AdminAction[];
  it('players can do nothing, SUPER_ADMIN everything', () => {
    for (const action of actions) {
      expect(canAdmin(['USER'], action)).toBe(false);
      expect(canAdmin(undefined, action)).toBe(false);
      expect(canAdmin(['USER', 'SUPER_ADMIN'], action)).toBe(true);
    }
  });
  it('SUPPORT: sessions, suspension, notes, refund triage, the moderation queue — never money, config, world or roles', () => {
    const allowed = actions.filter((a) => canAdmin(['USER', 'SUPPORT'], a)).sort();
    expect(allowed).toEqual(
      [
        'alliances.read',
        'moderation.decide',
        'moderation.read',
        'moderation.sanction',
        'purchases.refundReview',
        'users.notes',
        'users.revokeSessions',
        'users.suspend',
      ].sort(),
    );
  });
  it('GAME_ADMIN adds the game-master tools but not publishing, large adjustments, roles or geodata', () => {
    const denied = actions.filter((a) => !canAdmin(['USER', 'GAME_ADMIN'], a)).sort();
    expect(denied).toEqual(
      [
        'careers.creditAdjustmentLarge',
        'config.publish',
        'config.rollback',
        'geodata.publish',
        'users.roles',
      ].sort(),
    );
  });
});

describe('credit adjustment preview (BigInt)', () => {
  it('computes the resulting balance and blocks what the server would refuse', () => {
    expect(previewAdjustment('1000', '-250', null)).toEqual({ ok: true, next: 750n });
    expect(previewAdjustment('9007199254740993', '7', null)).toEqual({ ok: true, next: 9007199254741000n });
    expect(previewAdjustment('1000', '-1001', null)).toEqual({ ok: false, reason: 'NEGATIVE_BALANCE' });
    expect(previewAdjustment('1000', '10001', '10000')).toEqual({ ok: false, reason: 'OVER_LIMIT' });
    expect(previewAdjustment('1000', '-10000', '10000')).toEqual({ ok: false, reason: 'NEGATIVE_BALANCE' });
    for (const bad of ['', '0', '1.5', '01', 'abc', '--3']) {
      expect(previewAdjustment('1000', bad, null)).toEqual({ ok: false, reason: 'INVALID' });
    }
  });
});

describe('config diff and JSON parsing', () => {
  it('reports added / removed / changed key paths with old → new', () => {
    const before = { economy: { reward: 1, stipend: 120 }, spawn: { max: 6 }, tags: ['a'] };
    const after = { economy: { reward: 1.25, stipend: 120 }, world: { weather: true }, tags: ['a', 'b'] };
    expect(diffJson(before, after)).toEqual([
      { path: 'economy.reward', kind: 'changed', before: 1, after: 1.25 },
      { path: 'spawn', kind: 'removed', before: { max: 6 } },
      { path: 'tags', kind: 'changed', before: ['a'], after: ['a', 'b'] },
      { path: 'world', kind: 'added', after: { weather: true } },
    ]);
    expect(diffJson(before, JSON.parse(JSON.stringify(before)))).toEqual([]);
  });
  it('locates a syntax error and refuses non-object roots', () => {
    expect(parseJsonDocument('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
    const broken = parseJsonDocument('{\n  "a": 1,\n  "b": oops\n}');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.line).toBe(3);
    expect(parseJsonDocument('[1, 2]').ok).toBe(false);
  });
});

describe('polygon drawing helpers', () => {
  it('ignores the duplicate vertex produced by a double click', () => {
    let v = addVertex([], [14.2, 42.4]);
    v = addVertex(v, [14.2, 42.4]);
    v = addVertex(v, [14.3, 42.4]);
    expect(v).toEqual([
      [14.2, 42.4],
      [14.3, 42.4],
    ]);
    expect(canClose(v)).toBe(false);
  });
  it('parses the keyboard alternative: "lat, lng" lines or a GeoJSON ring', () => {
    const text = '42.46, 14.21\n42.47, 14.21\n42.47 14.22\n';
    const parsed = parseCoordinates(text)!;
    expect(parsed).toEqual([
      [14.21, 42.46],
      [14.21, 42.47],
      [14.22, 42.47],
    ]);
    expect(parseCoordinates(formatCoordinates(parsed))).toEqual(parsed);
    expect(parseCoordinates('[[14.21,42.46],[14.21,42.47],[14.22,42.47],[14.21,42.46]]')).toEqual(parsed);
    expect(parseCoordinates('42.46, 14.21\n42.47, 14.21')).toBeNull();
    expect(parseCoordinates('95, 14\n42, 14\n42, 15')).toBeNull();
    expect(parseCoordinates('hello')).toBeNull();
  });
});

describe('shell helpers', () => {
  it('routes a pasted id to its inspector', () => {
    expect(searchTarget(' usr_01HZX ')).toBe('/admin/users/usr_01HZX');
    expect(searchTarget('car_01HZX')).toBe('/admin/careers/car_01HZX');
    expect(searchTarget('inc_01HZX')).toBe('/admin/incidents/inc_01HZX');
    expect(searchTarget('veh_01HZX')).toBeNull();
    expect(searchTarget('../etc')).toBeNull();
  });
  it('resolves the environment: API answer, then env var, then origin — unknown origins count as production', () => {
    const real = { apiMock: false, apiUrl: 'https://api.rescue-control.example' };
    expect(resolveEnvironment(null, { apiMock: true, apiUrl: real.apiUrl })).toBe('MOCK');
    expect(resolveEnvironment('staging', real)).toBe('STAGING');
    expect(resolveEnvironment(null, { ...real, appEnv: 'development' })).toBe('LOCAL');
    expect(resolveEnvironment(null, { apiMock: false, apiUrl: 'http://localhost:4000' })).toBe('LOCAL');
    expect(resolveEnvironment(null, { apiMock: false, apiUrl: 'https://api-staging.example.com' })).toBe(
      'STAGING',
    );
    expect(resolveEnvironment(null, real)).toBe('PRODUCTION');
    expect(resolveEnvironment('whatever', real)).toBe('PRODUCTION');
  });
  it('queue health and retryable actions', () => {
    const q = { name: 'q', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
    expect(queueHealth(q)).toBe('HEALTHY');
    expect(queueHealth({ ...q, waiting: 500 })).toBe('BUSY');
    expect(queueHealth({ ...q, waiting: 500, failed: 1 })).toBe('FAILING');
    const now = Date.parse('2026-09-20T10:00:00Z');
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(isOverdue({ status: 'PENDING', dueAt: at(-60_000) }, now)).toBe(true);
    expect(isOverdue({ status: 'PENDING', dueAt: at(60_000) }, now)).toBe(false);
    expect(isOverdue({ status: 'COMPLETED', dueAt: at(-60_000) }, now)).toBe(false);
    expect(isRetryable({ status: 'FAILED', dueAt: at(60_000) }, now)).toBe(true);
    expect(isRetryable({ status: 'PENDING', dueAt: at(60_000) }, now)).toBe(false);
  });
});
