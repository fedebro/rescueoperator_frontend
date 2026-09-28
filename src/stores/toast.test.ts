import { describe, expect, it } from 'vitest';
import { MAX_TOASTS, withToast, type ToastItem } from './toast';

const item = (id: number, withAction = false): ToastItem => ({
  id,
  tone: 'info',
  title: `toast ${id}`,
  durationMs: 5000,
  ...(withAction ? { action: { label: 'Apri', onClick: () => undefined } } : {}),
});

describe('toast stack cap', () => {
  it('keeps at most MAX_TOASTS cards, dropping the oldest plain one first', () => {
    let list: ToastItem[] = [];
    for (let id = 1; id <= MAX_TOASTS + 2; id += 1) list = withToast(list, item(id));
    expect(list.map((t) => t.id)).toEqual([3, 4, 5, 6]);
  });

  it('keeps an actionable card through a burst of plain notices', () => {
    let list = withToast([], item(1, true)); // e.g. "Maxi-emergenza risolta · Riepilogo"
    for (let id = 2; id <= 9; id += 1) list = withToast(list, item(id)); // eight "intervento concluso"
    expect(list).toHaveLength(MAX_TOASTS);
    expect(list[0]!.id).toBe(1);
    expect(list.map((t) => t.id)).toEqual([1, 7, 8, 9]);
  });

  it('drops the oldest actionable card only when every older card has an action, and always keeps the new one', () => {
    let list: ToastItem[] = [];
    for (let id = 1; id <= MAX_TOASTS; id += 1) list = withToast(list, item(id, true));
    list = withToast(list, item(99));
    expect(list.map((t) => t.id)).toEqual([2, 3, 4, 99]);
  });
});
