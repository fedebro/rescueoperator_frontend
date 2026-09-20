import { describe, expect, it } from 'vitest';
import {
  MIN_GAP_MS,
  SOUND_CUES,
  incidentCue,
  notificationCue,
  playCue,
  resetSoundForTests,
  shouldPlay,
  type SoundName,
  type SoundPreferences,
} from './sound';

const prefs: SoundPreferences = { enabled: true, volume: 0.7, alerts: true, feedback: true };
const never = { at: Number.NEGATIVE_INFINITY, category: 'feedback' as const };

describe('sound set', () => {
  it('has a distinct, short cue for every event of the game', () => {
    const names = Object.keys(SOUND_CUES) as SoundName[];
    expect(names).toEqual(
      expect.arrayContaining([
        'incident',
        'incident.high',
        'incident.critical',
        'escalation',
        'arrived',
        'success',
        'failure',
        'levelUp',
        'unlock',
        'notification',
        'notification.important',
        'notification.critical',
        'credits',
        'error',
        'confirm',
      ]),
    );
    const signatures = names.map((n) => JSON.stringify(SOUND_CUES[n].notes));
    expect(new Set(signatures).size).toBe(names.length);
    for (const n of names) {
      const end = Math.max(...SOUND_CUES[n].notes.map((x) => x.at + x.dur));
      expect(end, n).toBeLessThan(0.9);
    }
  });

  it('maps severity tiers and notification priorities to cues', () => {
    expect([1, 4, 5, 7, 8, 10].map(incidentCue)).toEqual([
      'incident',
      'incident',
      'incident.high',
      'incident.high',
      'incident.critical',
      'incident.critical',
    ]);
    expect(notificationCue('CRITICAL')).toBe('notification.critical');
    expect(notificationCue('IMPORTANT')).toBe('notification.important');
    expect(notificationCue('INFO')).toBe('notification');
  });

  it('respects the master switch, the volume and the two categories', () => {
    const at = 1_000_000;
    expect(shouldPlay('incident', prefs, at, new Map(), never)).toBe(true);
    expect(shouldPlay('incident', { ...prefs, enabled: false }, at, new Map(), never)).toBe(false);
    expect(shouldPlay('incident', { ...prefs, volume: 0 }, at, new Map(), never)).toBe(false);
    expect(shouldPlay('incident', { ...prefs, alerts: false }, at, new Map(), never)).toBe(false);
    expect(shouldPlay('arrived', { ...prefs, alerts: false }, at, new Map(), never)).toBe(true);
    expect(shouldPlay('arrived', { ...prefs, feedback: false }, at, new Map(), never)).toBe(false);
  });

  it('throttles bursts: same cue within its window, any cue within the global gap', () => {
    const at = 1_000_000;
    const history = new Map<SoundName, number>([['incident', at - 500]]);
    expect(shouldPlay('incident', prefs, at, history, never)).toBe(false);
    expect(shouldPlay('incident', prefs, at + SOUND_CUES.incident.throttleMs, history, never)).toBe(true);
    // A feedback cue right after anything is dropped…
    expect(shouldPlay('arrived', prefs, at, new Map(), { at: at - 100, category: 'alerts' })).toBe(false);
    expect(shouldPlay('arrived', prefs, at, new Map(), { at: at - MIN_GAP_MS, category: 'alerts' })).toBe(
      true,
    );
    // …but an alert may cut into a feedback cue, never into another alert.
    expect(shouldPlay('incident', prefs, at, new Map(), { at: at - 100, category: 'feedback' })).toBe(true);
    expect(shouldPlay('incident', prefs, at, new Map(), { at: at - 100, category: 'alerts' })).toBe(false);
  });

  it('stays silent before any user gesture', () => {
    resetSoundForTests();
    expect(playCue('confirm', prefs)).toBe(false);
  });
});
