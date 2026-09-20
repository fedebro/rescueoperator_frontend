/**
 * Synthesised sound set (WebAudio) — no audio files, nothing to download.
 * Rules: silent until a user gesture has unlocked audio (autoplay policy), off by default on touch devices,
 * master volume + two categories (alerts / feedback) from the settings store, and a throttle so that a burst of
 * realtime events never stacks the same cue.
 */
import { soundEnabled, useSettingsStore, type SoundCategory } from '@/stores/settings';

export type SoundName =
  | 'incident'
  | 'incident.high'
  | 'incident.critical'
  | 'escalation'
  | 'arrived'
  | 'dispatch'
  | 'success'
  | 'failure'
  | 'levelUp'
  | 'unlock'
  | 'notification'
  | 'notification.important'
  | 'notification.critical'
  | 'credits'
  | 'error'
  | 'confirm';

interface Note {
  freq: number;
  /** Optional glide target (Hz) reached at the end of the note. */
  to?: number;
  at: number;
  dur: number;
  type: OscillatorType;
  /** Relative loudness 0…1 (default 1). */
  level?: number;
}

export interface SoundCue {
  category: SoundCategory;
  /** The same cue is not replayed within this window (ms). */
  throttleMs: number;
  notes: Note[];
}

/** Every cue is short (< 0.9 s) and recognisable by contour, not only by pitch. */
export const SOUND_CUES: Record<SoundName, SoundCue> = {
  incident: {
    category: 'alerts',
    throttleMs: 1500,
    notes: [
      { freq: 740, at: 0, dur: 0.12, type: 'square', level: 0.7 },
      { freq: 587, at: 0.15, dur: 0.16, type: 'square', level: 0.7 },
    ],
  },
  'incident.high': {
    category: 'alerts',
    throttleMs: 1500,
    notes: [
      { freq: 880, at: 0, dur: 0.14, type: 'square' },
      { freq: 660, at: 0.17, dur: 0.14, type: 'square' },
      { freq: 880, at: 0.34, dur: 0.2, type: 'square' },
    ],
  },
  'incident.critical': {
    category: 'alerts',
    throttleMs: 2000,
    notes: [
      { freq: 988, at: 0, dur: 0.11, type: 'sawtooth' },
      { freq: 740, at: 0.13, dur: 0.11, type: 'sawtooth' },
      { freq: 988, at: 0.26, dur: 0.11, type: 'sawtooth' },
      { freq: 740, at: 0.39, dur: 0.11, type: 'sawtooth' },
      { freq: 988, at: 0.52, dur: 0.24, type: 'sawtooth' },
    ],
  },
  escalation: {
    category: 'alerts',
    throttleMs: 2000,
    notes: [
      { freq: 440, to: 660, at: 0, dur: 0.18, type: 'sawtooth', level: 0.8 },
      { freq: 660, to: 990, at: 0.2, dur: 0.22, type: 'sawtooth', level: 0.8 },
    ],
  },
  arrived: {
    category: 'feedback',
    throttleMs: 1200,
    notes: [
      { freq: 660, at: 0, dur: 0.07, type: 'sine' },
      { freq: 660, at: 0.11, dur: 0.1, type: 'sine' },
    ],
  },
  dispatch: {
    category: 'feedback',
    throttleMs: 300,
    notes: [
      { freq: 520, at: 0, dur: 0.08, type: 'sine' },
      { freq: 780, at: 0.09, dur: 0.14, type: 'sine' },
    ],
  },
  success: {
    category: 'feedback',
    throttleMs: 1200,
    notes: [
      { freq: 523, at: 0, dur: 0.12, type: 'triangle' },
      { freq: 659, at: 0.12, dur: 0.12, type: 'triangle' },
      { freq: 784, at: 0.24, dur: 0.22, type: 'triangle' },
    ],
  },
  failure: {
    category: 'alerts',
    throttleMs: 1500,
    notes: [
      { freq: 392, at: 0, dur: 0.16, type: 'triangle' },
      { freq: 311, at: 0.18, dur: 0.16, type: 'triangle' },
      { freq: 233, to: 196, at: 0.36, dur: 0.32, type: 'triangle' },
    ],
  },
  levelUp: {
    category: 'feedback',
    throttleMs: 3000,
    notes: [
      { freq: 523, at: 0, dur: 0.1, type: 'triangle' },
      { freq: 659, at: 0.1, dur: 0.1, type: 'triangle' },
      { freq: 784, at: 0.2, dur: 0.1, type: 'triangle' },
      { freq: 1047, at: 0.3, dur: 0.34, type: 'triangle' },
      { freq: 1568, at: 0.3, dur: 0.34, type: 'sine', level: 0.4 },
    ],
  },
  unlock: {
    category: 'feedback',
    throttleMs: 2000,
    notes: [
      { freq: 880, at: 0, dur: 0.08, type: 'sine' },
      { freq: 1175, at: 0.09, dur: 0.08, type: 'sine' },
      { freq: 1760, at: 0.18, dur: 0.22, type: 'sine', level: 0.7 },
    ],
  },
  notification: {
    category: 'feedback',
    throttleMs: 2500,
    notes: [{ freq: 988, at: 0, dur: 0.12, type: 'sine', level: 0.6 }],
  },
  'notification.important': {
    category: 'alerts',
    throttleMs: 2500,
    notes: [
      { freq: 784, at: 0, dur: 0.1, type: 'sine' },
      { freq: 988, at: 0.12, dur: 0.16, type: 'sine' },
    ],
  },
  'notification.critical': {
    category: 'alerts',
    throttleMs: 2500,
    notes: [
      { freq: 932, at: 0, dur: 0.09, type: 'square', level: 0.8 },
      { freq: 932, at: 0.13, dur: 0.09, type: 'square', level: 0.8 },
      { freq: 932, at: 0.26, dur: 0.18, type: 'square', level: 0.8 },
    ],
  },
  credits: {
    category: 'feedback',
    throttleMs: 800,
    notes: [
      { freq: 1319, at: 0, dur: 0.06, type: 'sine' },
      { freq: 1976, at: 0.07, dur: 0.18, type: 'sine', level: 0.8 },
    ],
  },
  error: {
    category: 'feedback',
    throttleMs: 800,
    notes: [
      { freq: 196, at: 0, dur: 0.12, type: 'square', level: 0.7 },
      { freq: 185, at: 0.14, dur: 0.18, type: 'square', level: 0.7 },
    ],
  },
  confirm: {
    category: 'feedback',
    throttleMs: 150,
    notes: [{ freq: 1200, at: 0, dur: 0.05, type: 'sine', level: 0.5 }],
  },
};

/** Severity 1–10 → which "new incident" cue plays. */
export function incidentCue(severity: number): SoundName {
  if (severity >= 8) return 'incident.critical';
  if (severity >= 5) return 'incident.high';
  return 'incident';
}

export function notificationCue(priority: 'CRITICAL' | 'IMPORTANT' | 'INFO'): SoundName {
  if (priority === 'CRITICAL') return 'notification.critical';
  if (priority === 'IMPORTANT') return 'notification.important';
  return 'notification';
}

/** Peak gain of a full-level note at master volume 1 — deliberately quiet: cues sit under the player's own audio. */
const PEAK_GAIN = 0.09;

let ctx: AudioContext | null = null;
let unlocked = false;
let unlockInstalled = false;
const lastPlayedAt = new Map<SoundName, number>();
/** Two different cues never overlap: a burst of realtime events plays the first one only. */
export const MIN_GAP_MS = 400;
let lastAny: { at: number; category: SoundCategory } = { at: Number.NEGATIVE_INFINITY, category: 'feedback' };

/** Test hook: forget the throttle history, the context and the gesture state. */
export function resetSoundForTests(): void {
  ctx = null;
  unlocked = false;
  unlockInstalled = false;
  lastPlayedAt.clear();
  lastAny = { at: Number.NEGATIVE_INFINITY, category: 'feedback' };
}

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/**
 * The AudioContext is only ever created/resumed from a real user gesture. Call once at start-up;
 * until the first pointer/key event every cue is dropped (never queued: a late alarm is worse than none).
 */
export function installSoundUnlock(): () => void {
  if (typeof window === 'undefined' || unlockInstalled) return () => undefined;
  unlockInstalled = true;
  const unlock = () => {
    unlocked = true;
    const audio = audioContext();
    if (audio?.state === 'suspended') void audio.resume().catch(() => undefined);
    remove();
  };
  const remove = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchend', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchend', unlock, { passive: true });
  return () => {
    remove();
    unlockInstalled = false;
  };
}

export interface SoundPreferences {
  enabled: boolean;
  volume: number;
  alerts: boolean;
  feedback: boolean;
}

export function currentSoundPreferences(): SoundPreferences {
  const s = useSettingsStore.getState();
  return {
    enabled: soundEnabled(s.sound),
    volume: s.soundVolume,
    alerts: s.soundAlerts,
    feedback: s.soundFeedback,
  };
}

/** Pure gate (exported for tests): should this cue be audible now, given the preferences and the throttle history? */
export function shouldPlay(
  name: SoundName,
  prefs: SoundPreferences,
  nowMs: number,
  history: ReadonlyMap<SoundName, number> = lastPlayedAt,
  previous: { at: number; category: SoundCategory } = lastAny,
): boolean {
  const cue = SOUND_CUES[name];
  if (!prefs.enabled || prefs.volume <= 0) return false;
  if (cue.category === 'alerts' ? !prefs.alerts : !prefs.feedback) return false;
  // An alert may cut into a feedback cue (a new incident matters more than an arrival beep), never the reverse.
  const alertOverFeedback = cue.category === 'alerts' && previous.category === 'feedback';
  if (nowMs - previous.at < MIN_GAP_MS && !alertOverFeedback) return false;
  const last = history.get(name);
  return last === undefined || nowMs - last >= cue.throttleMs;
}

/** Plays a cue according to the player's sound settings. Returns whether it was actually scheduled. */
export function playCue(name: SoundName, prefs: SoundPreferences = currentSoundPreferences()): boolean {
  if (typeof window === 'undefined') return false;
  const now = Date.now();
  if (!shouldPlay(name, prefs, now)) return false;
  try {
    // `playCue` called from a click handler counts as a gesture even if the global listener has not run yet.
    const gesture = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (!unlocked && gesture?.hasBeenActive !== true) return false;
    const audio = audioContext();
    if (!audio) return false;
    if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
    if (audio.state !== 'running') return false; // not unlocked yet (autoplay policy) → stay silent
    lastPlayedAt.set(name, now);
    lastAny = { at: now, category: SOUND_CUES[name].category };
    const t0 = audio.currentTime;
    for (const n of SOUND_CUES[name].notes) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const peak = Math.max(0.0002, PEAK_GAIN * prefs.volume * (n.level ?? 1));
      osc.type = n.type;
      osc.frequency.setValueAtTime(n.freq, t0 + n.at);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.at + n.dur);
      gain.gain.setValueAtTime(0.0001, t0 + n.at);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.02);
    }
    return true;
  } catch {
    return false; // audio is strictly optional
  }
}

/**
 * Backwards-compatible entry point used by feature code: `enabled` is the master switch the caller already resolved;
 * volume, categories and throttling still come from the settings store.
 */
export function playSound(name: SoundName, enabled: boolean): void {
  if (!enabled) return;
  playCue(name, { ...currentSoundPreferences(), enabled: true });
}
