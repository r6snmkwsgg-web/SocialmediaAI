import { COUNTRIES, DATA, inRegion, latestYear, REGIONS, say, sourceLine } from "../data";
import { nicheById } from "../niches";
import type { Candidate, Context, Metric, RankingParams, Region } from "../types";

/**
 * Rankings: a countdown from #10 to #1 of the biggest countries by a real
 * figure, with where the numbers come from on screen the whole time.
 */

export const METRICS: Metric[] = ["population", "gdp"];

/** The figures a channel's charts use: its niche's one, once it has a niche, and otherwise both. */
export function metricsFor(ctx: Pick<Context, "niche">): Metric[] {
  const niche = nicheById(ctx.niche);
  return niche ? (niche.charts ? [niche.charts] : []) : METRICS;
}

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

/** A channel has each figure, region and decade once, so its rankings don't all look alike. */
export const rankingDecadeId = (p: Pick<RankingParams, "metric" | "region" | "year">) => `ranking:${p.metric}:${p.region}:${Math.floor(p.year / 10) * 10}s`;

/**
 * Each countdown goes to one channel only: the figure, the region and the
 * countries in their order. Neighbouring years mostly rank the same
 * countries the same way, and those are the same video with other
 * numbers, so the order is what's claimed, not the year.
 */
export const rankingOrderId = (p: Pick<RankingParams, "metric" | "region" | "items">) => `ranking:${p.metric}:${p.region}:${p.items.map((x) => x.iso).join(",")}`;

/** How many a region's countdown has: ten, or fewer where the region hasn't many countries. */
export const topOf = (region: Region) => Math.min(10, Math.floor(Object.keys(COUNTRIES).filter((iso) => inRegion(iso, region)).length * 0.6));

/**
 * The years a ranking can be made for: most countries have a figure that
 * year, and so does every country at the top today, so nobody who'd be
 * near the top is missing from it.
 */
export function rankingYears(metric: Metric, region: Region): number[] {
  const d = DATA[metric];
  const latest = latestYear(metric);
  const leaders = ranking(metric, region, topOf(region), latest).items.map((x) => x.iso);
  const isos = Object.keys(d.values);
  return d.years.filter((y, i) => y <= latest && isos.filter((k) => d.values[k][i] !== null).length >= isos.length * 0.9 && leaders.every((iso) => d.values[iso]?.[i] != null));
}

export function proposeRanking(ctx: Context): Candidate | null {
  const options: { p: RankingParams; s: ReturnType<typeof rankingScore>; key: string }[] = [];
  for (const metric of metricsFor(ctx)) {
    const latest = latestYear(metric);
    for (const region of REGIONS) {
      const top = topOf(region);
      for (const year of rankingYears(metric, region)) {
        if (ctx.used.has(rankingDecadeId({ metric, region, year }))) continue;
        const p = ranking(metric, region, top, year);
        if (p.items.length < 5 || ctx.used.has(rankingOrderId(p))) continue;
        const s = rankingScore(p);
        // the way things stand now is what most people want to see
        options.push({ p, s: { ...s, score: s.score + (year === latest ? 0.5 : 0) }, key: `ranking:${metric}:${region}` });
      }
    }
  }
  if (!options.length) return null;
  const best = options.map((o) => ({ ...o, pick: o.s.score + ctx.rand() * 0.6 })).sort((x, y) => y.pick - x.pick)[0];
  const { p, s, key } = best;
  const n = p.items.length;
  const why = [
    s.gap < 0.15 ? `Close at the top: #1 and #2 are ${Math.max(1, Math.round(s.gap * 100))}% apart` : `${s.close} near neighbours in the top ${n}, so the order isn't obvious`,
    `Real figures: ${DATA[p.metric].source}, ${p.year}`,
    `No other channel has had these ${n} in this order, and yours hasn't had this chart for the ${Math.floor(p.year / 10) * 10}s`,
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
