import { ABILITIES } from "../battle/abilities";
import type { AbilityId } from "../battle/abilities";
import { FORMATS } from "./formats";
import { alone, odds, type Weight } from "./learn";
import { FORMAT_IDS, type FormatId } from "./types";

/**
 * What the learning loop has found, in words: each format against the
 * channel's usual Short (1× is usual), how much of tomorrow's queue it
 * gets because of that, and the kinds of Short (a battle's power, a
 * quiz's subject, a story's tone) that stand out.
 */

export type FormatInsight = { format: FormatId; name: string; plural: string; score: number; samples: number; share: number };
export type KindInsight = { group: string; name: string; score: number; samples: number };
export type Insights = { formats: FormatInsight[]; kinds: KindInsight[]; measured: number };

const QUIZ: Record<string, string> = { capitals: "Capital city quizzes", science: "Science quizzes", mixed: "Mixed quizzes" };
const TONE: Record<string, string> = { funny: "Funny stories", sweet: "Sweet stories", twist: "Stories with a twist" };
const METRIC: Record<string, string> = { population: "population", gdp: "GDP" };

/** A kind of Short as people would say it: "Spike battles", "Science quizzes". */
export function kindName(group: string): string | null {
  const [format, a] = group.split(":");
  if (!a) return null;
  if (format === "battle") return a in ABILITIES ? `${ABILITIES[a as AbilityId].name} battles` : null;
  if (format === "quiz") return QUIZ[a] ?? null;
  if (format === "texts") return TONE[a] ?? null;
  if (format === "ranking" && METRIC[a]) return `${METRIC[a][0].toUpperCase()}${METRIC[a].slice(1)} rankings`;
  if (format === "race" && METRIC[a]) return `${METRIC[a][0].toUpperCase()}${METRIC[a].slice(1)} races`;
  return null;
}

/**
 * A kind only stands out after a few results, and when its steady score is clearly above or below usual: by its own
 * results, since those are what's shown, never by what a channel's other channels found.
 */
const STANDS_OUT = 1.15;

export function insights(weights: Weight[]): Insights {
  const share = odds(weights);
  const formats = FORMAT_IDS.map((f) => {
    const w = weights.find((x) => x.kind === "format" && x.name === f);
    return { format: f, name: FORMATS[f].name, plural: FORMATS[f].plural, score: w?.score ?? 1, samples: w?.samples ?? 0, share: share[f] };
  }).sort((a, b) => Number(b.samples > 0) - Number(a.samples > 0) || b.score - a.score);
  const kinds = weights
    .filter((w) => w.kind === "key" && w.samples >= 3 && (alone(w) >= STANDS_OUT || alone(w) <= 1 / STANDS_OUT))
    .map((w) => ({ group: w.name, name: kindName(w.name), score: w.score, samples: w.samples }))
    .filter((k): k is KindInsight => k.name !== null)
    .sort((a, b) => b.score - a.score);
  return { formats, kinds, measured: formats.reduce((s, f) => s + f.samples, 0) };
}

/** "2.1×", "0.6×": how a result compares with usual. */
export function times(x: number): string {
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)}×`;
}

/**
 * How long after posting a reading was taken, in whole hours or days
 * rounded down so it's always true: "After 1 day" for one on time, and
 * "After 30 hours" for one that came late because the worker was down.
 */
export function readAfter(hours: number): string {
  const h = Math.max(1, Math.floor(hours));
  const d = Math.floor(h / 24);
  if (d >= 1 && h - d * 24 < 2) return `After ${d} day${d === 1 ? "" : "s"}`;
  if (h < 72) return `After ${h} hour${h === 1 ? "" : "s"}`;
  return `After ${d} days`;
}
