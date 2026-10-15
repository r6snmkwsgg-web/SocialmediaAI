import { FPS, type Battle } from "./sim";
import type { Timeline } from "./timeline";

/**
 * The fight's soundtrack, made from nothing but maths, so every sound is
 * ours to use. Each hit plays the next note of a tune that's long out of
 * copyright, so the fight plays the song as it goes; blasts, splits and
 * knockouts get their own sounds, and the winner gets a flourish.
 */

export const RATE = 22050;

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** Beethoven's Ode to Joy and Für Elise, as MIDI note numbers. */
export const MELODIES = {
  ode: [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62, 64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60, 62, 62, 64, 60, 62, 64, 65, 64, 60, 62, 64, 65, 64, 62, 60, 62, 55],
  elise: [76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 68, 71, 72, 64, 76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 72, 71, 69],
} as const;
export type Melody = keyof typeof MELODIES;

function add(buf: Float32Array, at: number, len: number, fn: (t: number) => number) {
  const s0 = Math.floor(at * RATE);
  const n = Math.floor(len * RATE);
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    if (s0 + i >= 0) buf[s0 + i] += fn(i / RATE);
  }
}

/** A plucked note: a few harmonics and a quick fall. */
function pluck(buf: Float32Array, at: number, freq: number, vol: number) {
  add(buf, at, 0.5, (t) => {
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 8);
    const w = 2 * Math.PI * freq * t;
    return vol * env * (Math.sin(w) + 0.35 * Math.sin(2 * w) + 0.12 * Math.sin(3 * w));
  });
}

/** A low thump with a pitch drop, for knockouts and blasts. */
function thump(buf: Float32Array, at: number, vol: number, noise = 0) {
  let seed = 7;
  add(buf, at, 0.6, (t) => {
    seed = (seed * 16807) % 2147483647;
    const n = (seed / 2147483647) * 2 - 1;
    const f = 120 * Math.exp(-t * 6) + 40;
    const env = Math.exp(-t * 7);
    return vol * env * (Math.sin(2 * Math.PI * f * t) + noise * n * Math.exp(-t * 18));
  });
}

/** A quick upward chirp, for a split or a clone. */
function chirp(buf: Float32Array, at: number, vol: number) {
  add(buf, at, 0.16, (t) => vol * Math.exp(-t * 20) * Math.sin(2 * Math.PI * (700 + 2600 * t) * t));
}

export function soundtrack(b: Battle, tl: Timeline, melody: Melody = "ode"): Float32Array {
  const buf = new Float32Array(Math.ceil((tl.duration / FPS) * RATE));
  const tune = MELODIES[melody];
  let note = 0;
  let lastNote = -1;
  let lastFrame = -1;
  for (const e of b.events) {
    const at = tl.toVideo(e.f) / FPS;
    if (e.type === "hit" || e.type === "cut") {
      // one note per clash, and never two closer than 70 ms
      if (e.f === lastFrame || at - lastNote < 0.07) continue;
      lastFrame = e.f;
      lastNote = at;
      pluck(buf, at, midi(tune[note++ % tune.length]), e.type === "cut" ? 0.32 : 0.38);
      if (e.dmg >= 3) thump(buf, at, 0.25);
    } else if (e.type === "boom") {
      thump(buf, at, 0.55, 0.6);
    } else if (e.type === "spawn") {
      chirp(buf, at, 0.18);
    } else if (e.type === "ko") {
      thump(buf, at, e.last ? 0.7 : 0.4, 0.3);
    }
  }
  // the winner's flourish: up a major chord
  const end = tl.outroFrom / FPS;
  [60, 64, 67, 72].forEach((n, i) => pluck(buf, end + i * 0.11, midi(n + 12), 0.34));
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * 1.1);
  return buf;
}

/** 16-bit mono WAV bytes. */
export function wav(samples: Float32Array, rate = RATE): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(44 + samples.length * 2));
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return out;
}
