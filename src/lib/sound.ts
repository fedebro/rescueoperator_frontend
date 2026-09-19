/** Tiny synthesised sound effects (WebAudio) — no audio files, nothing to download, silent until a user gesture unlocks audio. */
export type SoundName = 'incident' | 'dispatch' | 'success';

let ctx: AudioContext | null = null;

const PATTERNS: Record<SoundName, { freq: number; at: number; dur: number; type: OscillatorType }[]> = {
  incident: [
    { freq: 880, at: 0, dur: 0.14, type: 'square' },
    { freq: 660, at: 0.17, dur: 0.14, type: 'square' },
    { freq: 880, at: 0.34, dur: 0.2, type: 'square' },
  ],
  dispatch: [
    { freq: 520, at: 0, dur: 0.08, type: 'sine' },
    { freq: 780, at: 0.09, dur: 0.14, type: 'sine' },
  ],
  success: [
    { freq: 523, at: 0, dur: 0.12, type: 'triangle' },
    { freq: 659, at: 0.12, dur: 0.12, type: 'triangle' },
    { freq: 784, at: 0.24, dur: 0.22, type: 'triangle' },
  ],
};

export function playSound(name: SoundName, enabled: boolean): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    if (ctx.state !== 'running') return; // not unlocked yet (autoplay policy) → stay silent
    const t0 = ctx.currentTime;
    for (const n of PATTERNS[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type;
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0.0001, t0 + n.at);
      gain.gain.exponentialRampToValueAtTime(0.06, t0 + n.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.02);
    }
  } catch {
    /* audio is strictly optional */
  }
}
