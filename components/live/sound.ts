import type { BattleEvent } from "@/lib/battle/sim";
import { MELODIES } from "@/lib/battle/sound";
import type { Cue } from "@/lib/live/round";

/**
 * The live show's sound, made as it happens with the browser's synth: the
 * same plucks and thumps as the videos, the hits playing Ode to Joy note by
 * note, plus a countdown, a horn for the fight, a chime for gifts and a
 * fanfare for the winner. Nothing to download, and all of it ours to use.
 */

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class LiveSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private note = 0;
  private lastNote = 0;
  private noise: AudioBuffer | null = null;
  volume = 0.7;

  /** Browsers only allow sound after a click or a key, so this is called from one. */
  start(): boolean {
    if (typeof window === "undefined") return false;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.out = this.ctx.createGain();
      this.out.gain.value = this.volume;
      this.out.connect(comp).connect(this.ctx.destination);
      const n = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
    return true;
  }

  get on(): boolean {
    return this.ctx?.state === "running";
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.out) this.out.gain.value = v;
  }

  private tone(freq: number, at: number, len: number, vol: number, type: OscillatorType = "triangle", slide?: number) {
    const c = this.ctx, out = this.out;
    if (!c || !out) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + len + 0.02);
  }

  private pluck(freq: number, vol: number, at = 0) {
    const t = (this.ctx?.currentTime ?? 0) + at;
    this.tone(freq, t, 0.45, vol, "triangle");
    this.tone(freq * 2, t, 0.25, vol * 0.3, "sine");
  }

  private thump(vol: number, noise = 0) {
    const c = this.ctx, out = this.out;
    if (!c || !out) return;
    const t = c.currentTime;
    this.tone(160, t, 0.5, vol, "sine", 40);
    if (noise > 0 && this.noise) {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      const g = c.createGain();
      g.gain.setValueAtTime(noise * vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      s.connect(g).connect(out);
      s.start(t);
      s.stop(t + 0.3);
    }
  }

  /** The fight's own sounds, for the events since last time. */
  battle(events: BattleEvent[]) {
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    const tune = MELODIES.ode;
    for (const e of events) {
      if (e.type === "hit" || e.type === "cut") {
        if (now - this.lastNote < 0.07) continue;
        this.lastNote = now;
        this.pluck(midi(tune[this.note++ % tune.length]), e.type === "cut" ? 0.28 : 0.34);
        if (e.dmg >= 3) this.thump(0.25);
      } else if (e.type === "boom") this.thump(0.55, 0.6);
      else if (e.type === "ko") this.thump(e.last ? 0.7 : 0.4, 0.3);
      else if (e.type === "spawn") this.tone(700, now, 0.16, 0.16, "sine", 3300);
      // a viewer's ball dropping in gets a rising chord; growing, a higher one
      else if (e.type === "summon") [0, 4, 7].forEach((n, i) => this.pluck(midi((e.grew ? 72 : 67) + n), 0.24, i * 0.05));
    }
  }

  /** The show's moments: countdown, fight, knockout, winner, gifts. */
  cue(c: Cue) {
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    switch (c.kind) {
      case "count":
        this.tone(660, now, 0.18, 0.3, "square");
        break;
      case "fight":
        this.tone(988, now, 0.5, 0.3, "square");
        this.tone(494, now, 0.5, 0.25, "sawtooth");
        break;
      case "ko":
        this.thump(0.8, 0.5);
        break;
      case "win":
        [60, 64, 67, 72, 76].forEach((n, i) => this.pluck(midi(n + 12), 0.3, i * 0.1));
        break;
      case "gift": {
        // a little sparkle, bigger for bigger gifts
        const notes = (c.n ?? 1) >= 99 ? [84, 88, 91, 96] : (c.n ?? 1) >= 5 ? [84, 88] : [88];
        notes.forEach((n, i) => this.tone(midi(n), now + i * 0.06, 0.25, 0.1, "sine"));
        break;
      }
      case "join":
        this.tone(midi(79), now, 0.08, 0.06, "sine");
        break;
    }
  }
}
