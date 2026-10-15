import { COUNTRIES, DATA, inRegion, latestYear, REGIONS, say, sourceLine } from "../data";
import type { Candidate, Context, Metric, RankingParams, Region } from "../types";

/**
 * Rankings: a countdown from #10 to #1 of the biggest countries by a real
 * figure, with where the numbers come from on screen the whole time.
 */

export const METRICS: Metric[] = ["population", "gdp"];

export function where(region: Region): string {
  return region === "World" ? "in the world" : `in ${region}`;
}

export function rankingTitle(metric: Metric, region: Region, n: number, year: number): string {
  return metric === "population" ? `The ${n} most populated countries ${where(region)} (${year})` : `The ${n} biggest economies ${where(region)} (${year})`;
}

export function ranking(metric: Metric, region: Region, top = 10, year = latestYear(metric)): RankingParams {
  const d = DATA[metric];
  const i = d.years.indexOf(year);
  const items = Object.entries(d.values)
    .filter(([iso, v]) => inRegion(iso, region) && v[i] !== null)
    .map(([iso, v]) => ({ iso, name: COUNTRIES[iso].name, value: v[i]! }))
    .sort((a, b) => b.value - a.value)
    .slice(0, top);
  return { metric, region, year, items, source: sourceLine(metric, year) };
}

/** How close it is at the top, and how many neighbours are near each other: closer is more to argue about. */
export function rankingScore(p: RankingParams): { score: number; gap: number; close: number } {
  const [a, b] = p.items;
  const gap = b ? (a.value - b.value) / a.value : 1;
  let close = 0;
  for (let i = 1; i < p.items.length; i++) if (p.items[i].value / p.items[i - 1].value > 0.9) close++;
  return { score: 2 * (1 - gap) + 0.3 * close, gap, close };
}

export function proposeRanking(ctx: Context): Candidate | null {
  const options: { p: RankingParams; s: ReturnType<typeof rankingScore>; key: string }[] = [];
  for (const metric of METRICS) {
    for (const region of REGIONS) {
      const key = `ranking:${metric}:${region}`;
      if (ctx.used.has(key)) continue;
      const count = Object.keys(COUNTRIES).filter((iso) => inRegion(iso, region)).length;
      const p = ranking(metric, region, Math.min(10, Math.floor(count * 0.6)));
      if (p.items.length < 5) continue;
      options.push({ p, s: rankingScore(p), key });
    }
  }
  if (!options.length) return null;
  const best = options.map((o) => ({ ...o, pick: o.s.score + ctx.rand() * 0.6 })).sort((x, y) => y.pick - x.pick)[0];
  const { p, s, key } = best;
  const n = p.items.length;
  const why = [
    s.gap < 0.15 ? `Close at the top: #1 and #2 are ${Math.max(1, Math.round(s.gap * 100))}% apart` : `${s.close} near neighbours in the top ${n}, so the order isn't obvious`,
    `Real figures: ${DATA[p.metric].source}, ${p.year}`,
    "Not on your channel before",
  ];
  return {
    format: "ranking",
    params: p,
    key,
    score: s.score,
    why,
    facts: [
      `A countdown Short from #${n} to #1: ${rankingTitle(p.metric, p.region, n, p.year).toLowerCase()}, using World Bank figures shown on screen with the source.`,
      `In order from #1: ${p.items.map((x, i) => `${i + 1}. ${x.name} (${say(p.metric, x.value)})`).join(", ")}.`,
      "#1 is revealed last: don't name it in the title.",
    ],
    title: rankingTitle(p.metric, p.region, n, p.year),
  };
}
