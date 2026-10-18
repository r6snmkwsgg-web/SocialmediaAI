import { FORMAT_IDS, type FormatId } from "./types";

/**
 * The learning loop. Each posted Short's views at 24 hours are compared
 * with the channel's typical Short at 24 hours; formats (and matchups,
 * quiz kinds, story tones) that beat it get picked more, ones that don't
 * get picked less. New channels' views are mostly noise, so a score is
 * pulled toward the channel's usual until it has the results to stand
 * on. Every format keeps a fair chance, so the channel never stops trying
 * things and one lucky video can't take over. A channel that's new to an
 * account with others starts from what worked on those instead of usual.
 */

/** `prior` is where a score is pulled toward until it has results of its own: 1 (usual), or what the account's other channels found. */
export type Weight = { kind: "format" | "key"; name: string; score: number; samples: number; prior?: number };

/** How many results a score needs before it counts for half; until then it's mostly the channel's usual. */
export const PRIOR = 8;

/**
 * A score as the picks use it: shrunk toward its prior (1, the channel's
 * usual, unless the account's other channels say otherwise) by how few
 * results it has. With 1 result it counts for a ninth, with 8 for half,
 * and never more than 20 / 28, since the score itself only remembers
 * about the last 20. With none it's the prior.
 */
export function steady(w: Pick<Weight, "score" | "samples" | "prior"> | undefined): number {
  if (!w) return 1;
  const prior = w.prior ?? 1;
  if (w.samples <= 0) return prior;
  const n = Math.min(w.samples, 20);
  return Math.exp((Math.log(w.score) * n + Math.log(prior) * PRIOR) / (n + PRIOR));
}

/** How a weight's own results stand, without its prior: what any words quoting those results go by. */
export const alone = (w: Weight) => steady({ score: w.score, samples: w.samples });

/**
 * A channel's weights, each with what the account's other channels found
 * as its prior: their results pooled (each counting for up to 20, as a
 * score does) and made steady the same way. So a new channel starts from
 * what worked there, and its own results take over as they come in. With
 * no other channels every prior is 1, and it learns exactly as one alone.
 */
export function withPrior(own: Weight[], others: Weight[]): Weight[] {
  const key = (w: Weight) => `${w.kind}|${w.name}`;
  const pooled = new Map<string, { log: number; n: number; samples: number }>();
  for (const w of others) {
    const n = Math.min(w.samples, 20);
    const p = pooled.get(key(w)) ?? { log: 0, n: 0, samples: 0 };
    pooled.set(key(w), { log: p.log + Math.log(w.score) * n, n: p.n + n, samples: p.samples + w.samples });
  }
  const names = new Map([...own, ...others].map((w) => [key(w), { kind: w.kind, name: w.name }]));
  return [...names.entries()].map(([k, { kind, name }]) => {
    const mine = own.find((w) => key(w) === k);
    const p = pooled.get(k);
    const prior = p && p.n > 0 ? steady({ score: Math.exp(p.log / p.n), samples: p.samples }) : 1;
    return { kind, name, score: mine?.score ?? 1, samples: mine?.samples ?? 0, prior };
  });
}

/**
 * Views as they most likely were at 24 hours, from a reading taken
 * `hours` after posting. Readings are taken at 24 hours, but can come up
 * to two days late when the worker was down. A late one is scaled back
 * by the square root of how late it is: halfway between "every view came
 * on the first day" and "they came in evenly".
 */
export function at24h(views: number, hours: number): number {
  if (!(hours > 24)) return views;
  return views * Math.sqrt(24 / hours);
}

/** Whether a reading was taken on time: within two hours of its checkpoint (the worker reads every 15 minutes). */
export function onTime(checkpoint: number, hours: number): boolean {
  return hours <= checkpoint + 2;
}

/** How a video did against the channel's typical one: 2 is twice the usual views. */
export function lift(views: number, typical: number): number {
  return (views + 10) / (typical + 10);
}

/**
 * A first day against the channel's usual one, read `hours` after
 * posting: by engaged views when the Short has its own engaged share and
 * the channel a usual one (`share` and `usual`), by plays otherwise, and
 * it says which. One read late is scaled back to 24 hours, and says it's
 * an estimate.
 */
export function againstUsual(
  views: number, hours: number, typical: number, share: number | null = null, usual: number | null = null,
): { vs: number; estimated: boolean; by: "engaged" | "plays" } {
  const late = !onTime(24, hours);
  const { lift: vs, by } = firstDayLift(late ? at24h(views, hours) : views, share, typical, usual);
  return { vs, estimated: late, by };
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
 * better results raise it, worse lower it, by its steady score, and none
 * drops below a fifth of the best, so the channel keeps learning.
 */
export function odds(weights: Weight[], allowed: readonly FormatId[] = FORMAT_IDS): Record<FormatId, number> {
  const raw = Object.fromEntries(allowed.map((f) => [f, steady(weights.find((x) => x.kind === "format" && x.name === f))])) as Record<FormatId, number>;
  const best = Math.max(...Object.values(raw));
  for (const f of allowed) raw[f] = Math.max(raw[f], best / 5);
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  for (const f of allowed) raw[f] /= sum;
  return raw;
}

/**
 * The formats a channel's Shorts are drawn from: its niche's, once it has
 * picked one, and otherwise every format. Text stories are in no niche,
 * and off until the creator turns them on: templated scrolling text is
 * what YouTube is least keen to pay for.
 */
export function formatsFor(opts: { textStories: boolean; niche?: { formats: readonly FormatId[] } | null }): FormatId[] {
  if (opts.niche) return [...opts.niche.formats];
  return FORMAT_IDS.filter((f) => f !== "texts" || opts.textStories);
}

/** Today's formats: drawn by the odds, never more than `cap` of one kind. */
export function chooseFormats(n: number, o: Record<FormatId, number>, rand: () => number, cap = 2): FormatId[] {
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
    if (out.filter((f) => f === pick).length >= cap) left[pick] = 0;
  }
  return out;
}

/**
 * How many of one format a day can have: two, and more only when there are
 * too few formats to fill the day, as in a niche with two of them.
 */
export const formatCap = (n: number, formats: number) => Math.max(2, Math.ceil(n / Math.max(1, formats)));

/**
 * The kinds of thing within a format that can do better or worse: the
 * powers in a battle, a quiz's subject, a story's tone, a chart's figure,
 * and for a round from a LIVE, its game. Each video adds a result to its
 * format and to these.
 */
export function keyGroups(key: string): string[] {
  const [format, a, b] = key.split(":");
  if (format === "battle" && a && b) return [`battle:${a}`, `battle:${b}`];
  if ((format === "quiz" || format === "texts") && a) return [`${format}:${a}`];
  if ((format === "ranking" || format === "race") && a) return [`${format}:${a}`];
  if (format === "clip" && (a === "battle" || a === "rivals")) return [`clip:${a}`];
  return [];
}

/** How a candidate's kind has done, by its steady score: 1 is the channel's usual. */
export function kindScore(key: string, weights: Weight[]): number {
  const gs = keyGroups(key);
  if (!gs.length) return 1;
  const log = gs.reduce((a, g) => a + Math.log(steady(weights.find((x) => x.kind === "key" && x.name === g))), 0);
  return Math.exp(log / gs.length);
}

/** The kind within a candidate that clearly stands out for the better, with its measured result, if one does. */
export function standout(key: string, weights: Weight[]): Weight | null {
  const ws = keyGroups(key)
    .map((g) => weights.find((x) => x.kind === "key" && x.name === g))
    .filter((w): w is Weight => !!w && w.samples >= 3 && alone(w) >= 1.15);
  return ws.sort((a, b) => alone(b) - alone(a))[0] ?? null;
}

const listed = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * In plain words, why fewer Shorts were made than the plan allows, for
 * the queue and a notification: which formats have nothing new left.
 */
export function dryNote(dry: string[], made: number, wanted: number): string {
  const what = dry.length ? `new ${listed(dry)}` : "new Shorts";
  const why = "Hookline never makes the same thing twice, for your channel or anyone else's.";
  return made > 0 ? `Only ${made} of ${wanted} could be made: there are no ${what} left for you right now. ${why}` : `There are no ${what} left to make for you right now. ${why}`;
}


/**
 * In plain words, why a format is being picked, for the queue. The
 * figure is what its Shorts really averaged; whether that counts as
 * doing well or badly goes by the steady score, so a couple of results
 * aren't called a pattern. A channel still new to an account with others
 * says what those found, with no figure, since none would be its own.
 */
export function formatReason(name: string, w: Weight | undefined): string {
  if (!w || w.samples < 3) {
    const prior = w?.prior ?? 1;
    if (prior >= 1.15) return `Your ${name} have done well on your other channels, so this one starts with more of them`;
    if (prior <= 0.87) return `Your ${name} have done less well on your other channels, so this one starts with fewer, but still some`;
    return `Still learning what works on your channel: ${w?.samples ? `${w.samples} ${name} so far` : `trying ${name}`}`;
  }
  const x = alone(w);
  const avg = `${w.score.toFixed(1)}× your usual first day`;
  if (x >= 1.15) return `Your ${name} have averaged ${avg} (${w.samples} posted)`;
  if (x <= 0.87) return `Your ${name} have averaged ${avg}, so fewer of them, but still some to keep checking`;
  if (w.score >= 1.15 || w.score <= 0.87) return `Your ${name} have averaged ${avg}, from ${w.samples}: too few to go on yet`;
  return `${name[0].toUpperCase()}${name.slice(1)} do about as well as your usual Short (${w.samples} posted)`;
}

/** The share of a Short's plays YouTube counted as engaged: 0 to 1, or null with no plays. */
export function engagedShare(plays: number, engaged: number): number | null {
  if (!(plays > 0) || !Number.isFinite(engaged)) return null;
  return Math.min(1, Math.max(0, engaged / plays));
}

/** A channel's usual engaged share: the middle of its Shorts' own, once 3 have one. */
export function usualShare(shares: (number | null)[]): number | null {
  const known = shares.filter((s): s is number => s !== null);
  return known.length >= 3 ? median(known) : null;
}

/**
 * A first day against the channel's usual one: by engaged views when the
 * Short has its own share and the channel has a usual one, by plays
 * otherwise. Nothing stands in for a missing share, so a comparison never
 * mixes the two.
 */
export function firstDayLift(plays: number, share: number | null, typical: number, usual: number | null): { lift: number; by: "engaged" | "plays" } {
  return share !== null && usual !== null ? { lift: lift(plays * share, typical * usual), by: "engaged" } : { lift: lift(plays, typical), by: "plays" };
}
