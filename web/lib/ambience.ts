/**
 * Background music, synthesized with WebAudio (no audio files):
 *  - a joyful, bouncy loop (~108 BPM, C-G-Am-F): marimba-style plucks, a springy bass,
 *    a light shaker, soft claps, a gentle pad
 * Browsers block audio until a user gesture, so call start() from one.
 * (Class name kept for the existing toggle.)
 */
const MUTE_KEY = "penfight:muted";
const VOLUME = 0.55;
const BPM = 108;
const STEP = 60 / BPM / 4; // one 16th note

// I - V - vi - IV, one bar each.
const BARS = [
  { arp: [261.63, 329.63, 392.0, 523.25], bass: 65.41 }, // C
  { arp: [196.0, 246.94, 293.66, 392.0], bass: 98.0 }, // G
  { arp: [220.0, 261.63, 329.63, 440.0], bass: 110.0 }, // Am
  { arp: [174.61, 220.0, 261.63, 349.25], bass: 87.31 }, // F
];
// C major pentatonic for the little melody (one octave above the arpeggio).
const MELODY = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];
function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function reverbImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private tick: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private step = 0;
  private nextTime = 0;
  private melodyIdx = 2;
  muted: boolean;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      /* ignore */
    }
    this.muted = m;
  }

  get started(): boolean {
    return this.ctx !== null;
  }

  start(): void {
    if (this.ctx || typeof window === "undefined") return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      void ctx.resume();
      this.noise = noiseBuffer(ctx, 2);

      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      this.master = master;

      // Shared room reverb.
      const verb = ctx.createConvolver();
      verb.buffer = reverbImpulse(ctx, 2.4, 2.6);
      const verbOut = ctx.createGain();
      verbOut.gain.value = 0.45;
      verb.connect(verbOut).connect(master);

      // Music: gentle low-pass, mostly dry plus a touch of room.
      const musicLp = ctx.createBiquadFilter();
      musicLp.type = "lowpass";
      musicLp.frequency.value = 5200;
      const musicBus = ctx.createGain();
      musicBus.gain.value = 1;
      musicBus.connect(musicLp);
      const musicDry = ctx.createGain();
      musicDry.gain.value = 0.85;
      musicLp.connect(musicDry).connect(master);
      const musicSend = ctx.createGain();
      musicSend.gain.value = 0.35;
      musicLp.connect(musicSend).connect(verb);
      this.musicBus = musicBus;

      this.nextTime = ctx.currentTime + 0.15;
      this.tick = setInterval(() => this.schedule(), 250);
      this.schedule();
      master.gain.linearRampToValueAtTime(this.muted ? 0 : VOLUME, ctx.currentTime + 2.5);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(m ? 0 : VOLUME, t, 0.2);
    }
  }

  dispose(): void {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  // ------------------------------------------------------------------ music

  /** Look-ahead scheduler (long window so hidden tabs, where timers throttle, keep time). */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.stopped) return;
    while (this.nextTime < ctx.currentTime + 1.4) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  private playStep(step: number, t: number): void {
    const bar = BARS[Math.floor(step / 16) % BARS.length];
    const s = step % 16;

    // Bouncy bass on 1, the "and" of 2, and 3.
    if (s === 0 || s === 6 || s === 8 || s === 14) {
      this.pluck(bar.bass, t, 0.4, s === 0 ? 0.16 : 0.11, "sine");
      this.pluck(bar.bass * 2, t, 0.25, 0.03, "triangle");
    }
    // Soft kick on 1 and 3.
    if (s === 0 || s === 8) this.kick(t);
    // Clap on 2 and 4.
    if (s === 4 || s === 12) this.clap(t);
    // Shaker on every 16th, accented off-beat.
    this.shaker(t, s % 4 === 2 ? 0.05 : 0.022);
    // Marimba arpeggio on 8ths.
    if (s % 2 === 0) {
      const pat = [0, 1, 2, 3, 2, 1, 2, 3];
      const f = bar.arp[pat[(s / 2) % pat.length]];
      this.pluck(f, t, 0.5, 0.085, "triangle");
      this.pluck(f * 2, t, 0.25, 0.02, "sine");
    }
    // Sparse, happy melody on top.
    if ((s % 4 === 0 && Math.random() < 0.6) || (s % 2 === 1 && Math.random() < 0.18)) {
      this.melodyIdx = Math.max(0, Math.min(MELODY.length - 1, this.melodyIdx + pick([-2, -1, -1, 0, 1, 1, 2])));
      this.pluck(MELODY[this.melodyIdx], t, 0.7, 0.07, "sine", true);
    }
    // A faint pad per bar for fullness.
    if (s === 0) for (const f of bar.arp) this.pad(f / 2, t, 16 * STEP);
  }

  private pluck(freq: number, t: number, dur: number, peak: number, type: OscillatorType, bright = false) {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
    if (bright) {
      // a tiny inharmonic "wood bar" partial
      const o2 = ctx.createOscillator();
      o2.type = "sine";
      o2.frequency.value = freq * 3.9;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(peak * 0.18, t + 0.005);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o2.connect(g2).connect(this.musicBus);
      o2.start(t);
      o2.stop(t + 0.2);
    }
  }

  private kick(t: number) {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.25);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, q: number, dur: number, peak: number, bus: AudioNode) {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private clap(t: number) {
    if (!this.musicBus) return;
    this.noiseHit(t, "bandpass", 1500, 1.2, 0.09, 0.07, this.musicBus);
    this.noiseHit(t + 0.012, "bandpass", 1900, 1.4, 0.08, 0.04, this.musicBus);
  }

  private shaker(t: number, peak: number) {
    if (!this.musicBus) return;
    this.noiseHit(t, "highpass", 7000, 0.7, 0.045, peak, this.musicBus);
  }

  private pad(freq: number, t: number, dur: number) {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012, t + 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
    g.connect(this.musicBus);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.5);
  }
}
