import { soundtrack } from "../battle/sound";
import { simulate } from "../battle/sim";
import { timeline } from "../battle/timeline";
import { FPS, frames, QUIZ, quizStep, RACE, RANKING, storyTimes, TEXTS, WYR } from "./timing";
import type { Spec } from "./types";

/**
 * Each Short's soundtrack, made from nothing but maths like the battles'
 * (so every sound is ours to use): ticks while you think, a ding for an
 * answer, a pop for a message, a chord at the end.
 */

export const RATE = 22050;

function add(buf: Float32Array, at: number, len: number, fn: (t: number) => number) {
  const s0 = Math.floor(at * RATE);
  const n = Math.floor(len * RATE);
  for (let i = 0; i < n && s0 + i < buf.length; i++) if (s0 + i >= 0) buf[s0 + i] += fn(i / RATE);
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

function tick(buf: Float32Array, at: number, vol = 0.25, hi = false) {
  add(buf, at, 0.05, (t) => vol * Math.exp(-t * 90) * Math.sin(2 * Math.PI * (hi ? 2200 : 1500) * t));
}

function tone(buf: Float32Array, at: number, note: number, vol: number, len = 0.45) {
  const f = midi(note);
  add(buf, at, len, (t) => {
    const env = Math.min(1, t / 0.005) * Math.exp(-t * 6);
    const w = 2 * Math.PI * f * t;
    return vol * env * (Math.sin(w) + 0.3 * Math.sin(2 * w));
  });
}

function ding(buf: Float32Array, at: number) {
  tone(buf, at, 79, 0.3);
  tone(buf, at + 0.09, 84, 0.3, 0.6);
}

function pop(buf: Float32Array, at: number, up: boolean) {
  add(buf, at, 0.09, (t) => 0.32 * Math.exp(-t * 45) * Math.sin(2 * Math.PI * (up ? 520 + 2200 * t : 900 - 1800 * t) * t));
}

function whoosh(buf: Float32Array, at: number, vol = 0.12) {
  let seed = 11;
  add(buf, at, 0.32, (t) => {
    seed = (seed * 16807) % 2147483647;
    const n = (seed / 2147483647) * 2 - 1;
    return vol * Math.sin(Math.PI * Math.min(1, t / 0.32)) * n;
  });
}

function thump(buf: Float32Array, at: number, vol: number) {
  add(buf, at, 0.5, (t) => vol * Math.exp(-t * 8) * Math.sin(2 * Math.PI * (110 * Math.exp(-t * 5) + 45) * t));
}

function chord(buf: Float32Array, at: number) {
  [60, 64, 67, 72].forEach((n, i) => tone(buf, at + i * 0.1, n + 12, 0.24, 0.9));
}

const sec = (f: number) => f / FPS;

export function soundFor(spec: Spec): Float32Array {
  if (spec.format === "battle") {
    const b = simulate(spec.params.a, spec.params.b, spec.params.seed);
    return soundtrack(b, timeline(b));
  }
  const buf = new Float32Array(Math.ceil(sec(frames(spec)) * RATE));
  const end = frames(spec);

  if (spec.format === "quiz") {
    spec.params.questions.forEach((_, i) => {
      const from = QUIZ.intro + i * quizStep;
      whoosh(buf, sec(from));
      for (let k = 0; k < 3; k++) tick(buf, sec(from + QUIZ.show + k * FPS), 0.22, k === 2);
      ding(buf, sec(from + QUIZ.show + QUIZ.think));
    });
    chord(buf, sec(end - QUIZ.outro));
  } else if (spec.format === "wyr") {
    spec.params.pairs.forEach((_, i) => {
      const from = WYR.intro + i * WYR.each;
      whoosh(buf, sec(from));
      for (let k = 1; k <= 4; k++) tick(buf, sec(from + k * FPS * 0.9), 0.16);
    });
    chord(buf, sec(end - WYR.outro));
  } else if (spec.format === "texts") {
    storyTimes(spec.params.story.messages).forEach((t, i) => pop(buf, sec(t.at), spec.params.story.messages[i].me));
    chord(buf, sec(end - TEXTS.outro));
  } else if (spec.format === "ranking") {
    const n = spec.params.items.length;
    for (let i = 0; i < n; i++) {
      const at = sec(RANKING.intro + i * RANKING.each);
      whoosh(buf, at, 0.09);
      thump(buf, at + 0.12, i === n - 1 ? 0.6 : 0.3);
      if (i === n - 1) ding(buf, at + 0.2);
    }
    chord(buf, sec(end - RANKING.outro));
  } else if (spec.format === "race") {
    const { years, series } = spec.params;
    let leader: string | null = null;
    years.forEach((_, k) => {
      const at = sec(RACE.intro + k * RACE.year);
      tick(buf, at, 0.08);
      const top = series.filter((s) => s.values[k] !== null).sort((a, b) => b.values[k]! - a.values[k]!)[0]?.iso ?? null;
      if (leader && top && top !== leader) ding(buf, at);
      leader = top;
    });
    chord(buf, sec(end - RACE.outro));
  }
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * 1.2);
  return buf;
}

export { wav } from "../battle/sound";
