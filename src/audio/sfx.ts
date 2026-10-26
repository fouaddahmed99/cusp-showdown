/**
 * Sound, generated in the browser with the Web Audio API.
 *
 * Every cue is synthesised from oscillators here, so the repo ships no audio
 * files and nothing is borrowed from another production. The palette is a
 * rising fifth for correct, a falling tritone for wrong, a square-wave rasp for
 * the buzzer, and a short arpeggio for a win.
 */
export type SoundName =
  | "tile-open"
  | "buzz"
  | "correct"
  | "incorrect"
  | "timeout"
  | "victory"
  | "tick";

interface AudioPrefs {
  muted: boolean;
  musicOn: boolean;
  volume: number;
}

const PREFS_KEY = "cusp-showdown:audio:v1";

function readPrefs(): AudioPrefs {
  const fallback: AudioPrefs = { muted: false, musicOn: false, volume: 0.7 };
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      muted: typeof parsed.muted === "boolean" ? parsed.muted : fallback.muted,
      musicOn: typeof parsed.musicOn === "boolean" ? parsed.musicOn : fallback.musicOn,
      volume:
        typeof parsed.volume === "number" && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : fallback.volume,
    };
  } catch {
    return fallback;
  }
}

function writePrefs(prefs: AudioPrefs): void {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Sound preferences are a convenience; a blocked store is not an error.
  }
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicNodes: OscillatorNode[] = [];
  private prefs: AudioPrefs = readPrefs();
  private listeners = new Set<(prefs: AudioPrefs) => void>();

  get state(): AudioPrefs {
    return this.prefs;
  }

  subscribe(fn: (prefs: AudioPrefs) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    writePrefs(this.prefs);
    for (const fn of this.listeners) fn(this.prefs);
  }

  /** Browsers only allow audio after a gesture, so this runs on first click. */
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!this.ctx) {
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.prefs.muted ? 0 : this.prefs.volume;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setMuted(muted: boolean): void {
    this.prefs = { ...this.prefs, muted };
    if (this.master) this.master.gain.value = muted ? 0 : this.prefs.volume;
    if (muted) this.stopMusic();
    else if (this.prefs.musicOn) this.startMusic();
    this.emit();
  }

  toggleMuted(): void {
    this.setMuted(!this.prefs.muted);
  }

  setVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume));
    this.prefs = { ...this.prefs, volume: clamped };
    if (this.master && !this.prefs.muted) this.master.gain.value = clamped;
    this.emit();
  }

  setMusic(on: boolean): void {
    this.prefs = { ...this.prefs, musicOn: on };
    if (on && !this.prefs.muted) this.startMusic();
    else this.stopMusic();
    this.emit();
  }

  private tone(
    freq: number,
    start: number,
    duration: number,
    type: OscillatorType,
    peak: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  play(name: SoundName): void {
    if (this.prefs.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;

    switch (name) {
      case "tile-open":
        this.tone(320, t, 0.13, "triangle", 0.26);
        this.tone(640, t + 0.045, 0.16, "sine", 0.18);
        break;
      case "buzz":
        // A short, hard rasp: two detuned squares, no tail.
        this.tone(138, t, 0.3, "square", 0.3);
        this.tone(146, t, 0.3, "square", 0.22);
        break;
      case "correct":
        this.tone(523.25, t, 0.16, "sine", 0.3);
        this.tone(783.99, t + 0.1, 0.26, "sine", 0.28);
        break;
      case "incorrect":
        this.tone(311.13, t, 0.18, "sawtooth", 0.22);
        this.tone(220, t + 0.12, 0.3, "sawtooth", 0.2);
        break;
      case "timeout":
        this.tone(392, t, 0.12, "triangle", 0.2);
        this.tone(261.63, t + 0.11, 0.34, "triangle", 0.22);
        break;
      case "victory":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          this.tone(f, t + i * 0.11, 0.36, "sine", 0.26);
        });
        break;
      case "tick":
        this.tone(1760, t, 0.035, "square", 0.08);
        break;
    }
  }

  /** A slow two-note pad. Deliberately dull: it must not fight the room. */
  private startMusic(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.musicNodes.length) return;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.045;
    this.musicGain.connect(this.master);

    for (const freq of [73.42, 110, 146.83]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.06;
      lfoGain.gain.value = 1.6;
      lfo.connect(lfoGain).connect(osc.frequency);
      osc.connect(this.musicGain);
      osc.start();
      lfo.start();
      this.musicNodes.push(osc, lfo);
    }
  }

  private stopMusic(): void {
    for (const node of this.musicNodes) {
      try {
        node.stop();
      } catch {
        // Already stopped.
      }
    }
    this.musicNodes = [];
    this.musicGain?.disconnect();
    this.musicGain = null;
  }

  /** Call from any click handler so the context is unlocked before it is needed. */
  unlock(): void {
    this.ensure();
    if (this.prefs.musicOn && !this.prefs.muted) this.startMusic();
  }
}

export const sfx = new SoundEngine();
