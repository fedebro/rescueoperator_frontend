import { describe, expect, it } from 'vitest';
import { GUARD_KEY, SheetHistory, type HistoryLike, type SheetLevel } from './use-sheet-history';

/** A browser history in miniature: entries with their state and a cursor; `back()` moves it (popstate is manual). */
class FakeHistory implements HistoryLike {
  entries: unknown[] = [{ page: '/game/fleet' }, { page: '/game' }];
  index = 1;
  backs = 0;
  get state(): unknown {
    return this.entries[this.index];
  }
  pushState(data: unknown): void {
    this.entries = [...this.entries.slice(0, this.index + 1), data];
    this.index = this.entries.length - 1;
  }
  back(): void {
    this.backs++;
    this.index = Math.max(0, this.index - 1);
  }
  /** The player presses Back: returns the state the popstate carries. */
  press(): unknown {
    this.index = Math.max(0, this.index - 1);
    return this.state;
  }
}
const guards = (h: FakeHistory) =>
  h.entries.filter((e) => (e as Record<string, unknown>)[GUARD_KEY] === 1).length;

describe('SheetHistory (Back closes the inspector, then lowers the sheet, then leaves)', () => {
  it('keeps one guard entry while something is open; each Back closes the top layer', () => {
    const history = new FakeHistory();
    const sheet = new SheetHistory(history);
    let open: SheetLevel[] = ['sheet'];
    sheet.reconcile(open.length); // queue raised
    open = ['sheet', 'inspector']; // an incident opened from it
    sheet.reconcile(open.length);
    expect(guards(history)).toBe(1);

    expect(sheet.onPopState(history.press(), open)).toEqual(['inspector']);
    expect(sheet.guard).toBe(true); // the sheet is still raised: the guard went back on
    open = ['sheet'];
    sheet.reconcile(open.length);
    expect(sheet.onPopState(history.press(), open)).toEqual(['sheet']);
    open = [];
    sheet.reconcile(open.length);
    expect(sheet.guard).toBe(false);
    expect(history.state).toEqual({ page: '/game' });
    expect(history.backs).toBe(0);
  });

  it('closing by other means never traverses; a Back on the stale guard carries on to the previous page', () => {
    const history = new FakeHistory();
    const sheet = new SheetHistory(history);
    sheet.reconcile(1); // inspector opened
    sheet.reconcile(0); // closed with the X: nothing happens to the history
    expect(history.backs).toBe(0);
    expect(sheet.guard).toBe(true);
    // The player presses Back: nothing visible is left to close, so the Back continues to /game/fleet.
    expect(sheet.onPopState(history.press(), [])).toEqual([]);
    expect(history.backs).toBe(1);
    expect(history.state).toEqual({ page: '/game/fleet' });
  });

  it('reuses a stale guard instead of stacking entries', () => {
    const history = new FakeHistory();
    const sheet = new SheetHistory(history);
    sheet.reconcile(1);
    sheet.reconcile(0);
    sheet.reconcile(1); // open again: the guard is still on top
    expect(guards(history)).toBe(1);
  });

  it('re-aligns with the entry it finds after a page change or a reload', () => {
    const history = new FakeHistory();
    history.pushState({ [GUARD_KEY]: 1 });
    const sheet = new SheetHistory(history);
    sheet.syncFromEntry();
    expect(sheet.guard).toBe(true);
    // A popstate that does not leave a guard (e.g. arriving on one) closes nothing.
    history.pushState({ page: '/game' });
    const fresh = new SheetHistory(history);
    fresh.syncFromEntry();
    expect(fresh.onPopState({ [GUARD_KEY]: 1 }, ['inspector'])).toEqual([]);
    expect(fresh.guard).toBe(true);
  });
});
