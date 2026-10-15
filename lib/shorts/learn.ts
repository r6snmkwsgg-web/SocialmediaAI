import { FORMAT_IDS, type FormatId } from "./types";

/**
 * The learning loop. Each posted Short's views at 24 hours are compared
 * with the channel's typical Short at 24 hours; formats (and matchups,
 * quiz kinds, story tones) that beat it get picked more, ones that don't
 * get picked less. Every format keeps a fair chance, so the channel never
 * stops trying things and one lucky video can't take over.
 */

export type Weight = { kind: "format" | "key"; name: string; score: number; samples: number };

/** How a video did against the channel's typical one: 2 is twice the usual views. */
export function lift(views: number, typical: number): number {
  return (views + 10) / (typical + 10);
}

/** The middle of the channel's recent results: what "typical" means. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A weight after one more result: an average in log space, so 2× and ½× cancel out, that keeps moving after 20 results. */
export function updated(w: Pick<Weight, "score" | "samples">, l: number): { score: number; samples: number } {
  const n = Math.min(w.samples, 19);
  const log = (Math.log(w.score) * n + Math.log(Math.max(0.05, Math.min(20, l)))) / (n + 1);
  return { score: Math.exp(log), samples: w.samples + 1 };
}

/**
 * How likely each format is to be picked today. A format starts at 1;
 * better results raise it, worse lower it, and none drops below a fifth
 * of the best, so the channel keeps learning.
 */
export function odds(weights: Weight[], allowed: readonly FormatId[] = FORMAT_IDS): Record<FormatId, number> {
  const raw = Object.fromEntries(allowed.map((f) => {
    const w = weights.find((x) => x.kind === "format" && x.name === f);
    // a format with few results is closer to even, whatever it scored
    const trust = w ? Math.min(1, w.samples / 5) : 0;
    return [f, Math.exp(Math.log(w?.score ?? 1) * trust * 1.5)];
  })) as Record<FormatId, number>;
  const best = Math.max(...Object.values(raw));
  for (const f of allowed) raw[f] = Math.max(raw[f], best / 5);
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  for (const f of allowed) raw[f] /= sum;
  return raw;
}

/** Today's formats: drawn by the odds, never more than two of one kind. */
export function chooseFormats(n: number, o: Record<FormatId, number>, rand: () => number): FormatId[] {
  const out: FormatId[] = [];
  const left = { ...o };
  while (out.length < n && Object.values(left).some((p) => p > 0)) {
    const sum = Object.values(left).reduce((a, b) => a + b, 0);
    let r = rand() * sum;
    let pick = Object.keys(left)[0] as FormatId;
    for (const [f, p] of Object.entries(left) as [FormatId, number][]) {
      if (p <= 0) continue;
      pick = f;
      r -= p;
      if (r <= 0) break;
    }
    out.push(pick);
    if (out.filter((f) => f === pick).length >= 2) left[pick] = 0;
  }
  return out;
}

/**
 * The kinds of thing within a format that can do better or worse: the
 * powers in a battle, a quiz's subject, a story's tone, a chart's figure.
 * Each video adds a result to its format and to these.
 */
export function keyGroups(key: string): string[] {
  const [format, a, b] = key.split(":");
  if (format === "battle" && a && b) return [`battle:${a}`, `battle:${b}`];
  if ((format === "quiz" || format === "texts") && a) return [`${format}:${a}`];
  if ((format === "ranking" || format === "race") && a) return [`${format}:${a}`];
  return [];
}

/** How a candidate's kind has done, trusted only once it has a few results: 1 is the channel's usual. */
export function kindScore(key: string, weights: Weight[]): number {
  const gs = keyGroups(key);
  if (!gs.length) return 1;
  let log = 0;
  for (const g of gs) {
    const w = weights.find((x) => x.kind === "key" && x.name === g);
    log += w ? Math.log(w.score) * Math.min(1, w.samples / 5) : 0;
  }
  return Math.exp(log / gs.length);
}

/** In plain words, why a format is being picked, for the queue. */
export function formatReason(name: string, w: Weight | undefined): string {
  if (!w || w.samples < 3) return `Still learning what works on your channel: ${w?.samples ? `${w.samples} ${name} so far` : `trying ${name}`}`;
  const x = w.score;
  if (x >= 1.15) return `${name[0].toUpperCase()}${name.slice(1)} get ${x.toFixed(1)}× your usual views at 24 hours (${w.samples} posted)`;
  if (x <= 0.87) return `${name[0].toUpperCase()}${name.slice(1)} get ${x.toFixed(1)}× your usual views, so fewer of them, but still some to keep checking`;
  return `${name[0].toUpperCase()}${name.slice(1)} do about as well as your usual Short (${w.samples} posted)`;
}
