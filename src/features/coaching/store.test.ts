import { describe, expect, it, beforeEach, vi } from 'vitest';
import { hasCoachSeen, markCoachSeen, resetCoachSeen } from './store';

// A fresh career id per test: the module keeps an in-memory fallback cache keyed by career id that outlives
// `localStorage.clear()`, so reusing one id across tests would leak state between them.
let counter = 0;
const freshCareerId = () => `car_test_${counter++}`;

describe('coaching seen-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports unseen for a key that was never marked', () => {
    const careerId = freshCareerId();
    expect(hasCoachSeen(careerId, 'primer:personnel')).toBe(false);
  });

  it('marks a key as seen and persists it to localStorage', () => {
    const careerId = freshCareerId();
    markCoachSeen(careerId, 'primer:personnel');
    expect(hasCoachSeen(careerId, 'primer:personnel')).toBe(true);
    const raw = localStorage.getItem(`rc-coach-seen:${careerId}`);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(['primer:personnel']);
  });

  it('marking a key twice is idempotent (no duplicate entries)', () => {
    const careerId = freshCareerId();
    markCoachSeen(careerId, 'mark:crewInsufficient');
    markCoachSeen(careerId, 'mark:crewInsufficient');
    const raw = localStorage.getItem(`rc-coach-seen:${careerId}`);
    expect(JSON.parse(raw!)).toEqual(['mark:crewInsufficient']);
  });

  it('marking a key does not affect an unrelated key for the same career (skip semantics)', () => {
    const careerId = freshCareerId();
    markCoachSeen(careerId, 'primer:personnel');
    expect(hasCoachSeen(careerId, 'primer:shop:EMS')).toBe(false);
    expect(hasCoachSeen(careerId, 'primer:personnel')).toBe(true);
  });

  it('accumulates multiple distinct keys for the same career', () => {
    const careerId = freshCareerId();
    markCoachSeen(careerId, 'primer:personnel');
    markCoachSeen(careerId, 'mark:lowStock');
    const raw = localStorage.getItem(`rc-coach-seen:${careerId}`);
    expect(JSON.parse(raw!).sort()).toEqual(['mark:lowStock', 'primer:personnel']);
  });

  it('isolates "seen" state per career', () => {
    const careerA = freshCareerId();
    const careerB = freshCareerId();
    markCoachSeen(careerA, 'primer:personnel');
    expect(hasCoachSeen(careerA, 'primer:personnel')).toBe(true);
    expect(hasCoachSeen(careerB, 'primer:personnel')).toBe(false);
  });

  it('resetCoachSeen wipes only the given career', () => {
    const careerA = freshCareerId();
    const careerB = freshCareerId();
    markCoachSeen(careerA, 'primer:personnel');
    markCoachSeen(careerB, 'primer:personnel');
    resetCoachSeen(careerA);
    expect(hasCoachSeen(careerA, 'primer:personnel')).toBe(false);
    expect(hasCoachSeen(careerB, 'primer:personnel')).toBe(true);
  });

  it('degrades gracefully when localStorage.getItem throws (private mode / blocked storage)', () => {
    const careerId = freshCareerId();
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });
    expect(() => hasCoachSeen(careerId, 'primer:personnel')).not.toThrow();
    expect(hasCoachSeen(careerId, 'primer:personnel')).toBe(false);
    spy.mockRestore();
  });

  it('degrades gracefully when localStorage.setItem throws, keeping the in-memory copy for this session', () => {
    const careerId = freshCareerId();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded');
    });
    expect(() => markCoachSeen(careerId, 'primer:personnel')).not.toThrow();
    // In-memory fallback still reports it as seen for the rest of this session, even though nothing was persisted.
    expect(hasCoachSeen(careerId, 'primer:personnel')).toBe(true);
    spy.mockRestore();
    expect(localStorage.getItem(`rc-coach-seen:${careerId}`)).toBeNull();
  });

  it('recovers from corrupted JSON in storage instead of throwing', () => {
    const careerId = freshCareerId();
    localStorage.setItem(`rc-coach-seen:${careerId}`, '{not json');
    expect(hasCoachSeen(careerId, 'primer:personnel')).toBe(false);
    expect(() => markCoachSeen(careerId, 'primer:personnel')).not.toThrow();
    expect(hasCoachSeen(careerId, 'primer:personnel')).toBe(true);
  });

  it('ignores a non-array JSON value in storage', () => {
    const careerId = freshCareerId();
    localStorage.setItem(`rc-coach-seen:${careerId}`, '{"not":"an array"}');
    expect(hasCoachSeen(careerId, 'primer:personnel')).toBe(false);
  });
});
