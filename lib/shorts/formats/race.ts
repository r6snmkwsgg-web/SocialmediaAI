import { COUNTRIES, DATA, inRegion, latestYear, REGIONS } from "../data";
import { RACE } from "../timing";
import { FPS } from "../timing";
import type { Candidate, Context, Metric, RaceParams, Region } from "../types";
import { METRICS, where } from "./ranking";

/**
 * Bar-chart races: the biggest countries by a real figure, year by year,
 * bars overtaking each other as it happens. The stretch of years is the
 * one with the most overtakes, so there's always something to watch.
 */

const ranked = (values: [string, number | null][]) =>
  values.filter((x): x is [string, number] => x[1] !== null).sort((a, b) => b[1] - a[1]).map(([iso]) => iso);

export function raceParams(metric: Metric, region: Region, from: number, to: number, top: number): RaceParams & { overtakes: number; leaders: number } {
  const d = DATA[metric];
  const i0 = d.years.indexOf(from), i1 = d.years.indexOf(to);
  const isos = Object.keys(d.values).filter((iso) => inRegion(iso, region));
  const years = d.years.slice(i0, i1 + 1);
  const tops = years.map((_, k) => ranked(isos.map((iso) => [iso, d.values[iso][i0 + k]])).slice(0, top));
  const ever = [...new Set(tops.flat())];
  let overtakes = 0, leaders = 0;
  for (let k = 1; k < tops.length; k++) {
    const prev = tops[k - 1], now = tops[k];
    if (now[0] !== prev[0]) leaders++;
    for (let a = 0; a < now.length; a++)
      for (let b = a + 1; b < now.length; b++) {
        const pa = prev.indexOf(now[a]), pb = prev.indexOf(now[b]);
        if (pa >= 0 && pb >= 0 && pa > pb) overtakes++;
      }
  }
  return {
    metric,
    region,
    years,
    series: ever.map((iso) => ({ iso, name: COUNTRIES[iso].name, values: d.values[iso].slice(i0, i1 + 1) })),
    top,
    source: `Source: ${d.source}`,
    overtakes,
    leaders,
  };
}

export function raceTitle(metric: Metric, region: Region, top: number, from: number, to: number): string {
  return metric === "population"
    ? `The ${top} most populated countries ${where(region)}, ${from} to ${to}`
    : `The ${top} biggest economies ${where(region)}, ${from} to ${to}`;
}

/** Overtakes are what people watch for; a new #1 most of all. A race should run 20 to 40 seconds. */
export function raceScore(r: { overtakes: number; leaders: number; years: number[] }): number {
  const secs = (RACE.intro + (r.years.length - 1) * RACE.year + RACE.outro) / FPS;
  const fit = secs >= 20 && secs <= 40 ? 1 : 0;
  return r.overtakes + 6 * Math.min(r.leaders, 3) + 8 * fit;
}

export function proposeRace(ctx: Context): Candidate | null {
  let best: { r: ReturnType<typeof raceParams>; score: number; key: string } | null = null;
  let tried = 0;
  for (const metric of METRICS) {
    const last = latestYear(metric);
    // GDP before 1990 is missing for too many countries to race fairly
    const first = metric === "gdp" ? 1990 : DATA[metric].years[0];
    for (const region of REGIONS) {
      const key = `race:${metric}:${region}`;
      if (ctx.used.has(key)) continue;
      const count = Object.keys(COUNTRIES).filter((iso) => inRegion(iso, region)).length;
      const top = Math.min(10, Math.floor(count * 0.6));
      if (top < 5) continue;
      for (let len = 30; len <= 60; len += 5) {
        for (let to = last; to - len >= first; to -= 5) {
          const r = raceParams(metric, region, to - len, to, top);
          tried++;
          const score = raceScore(r) + ctx.rand() * 2;
          if (!best || score > best.score) best = { r, score, key };
        }
      }
    }
  }
  if (!best) return null;
  const { r, key } = best;
  const from = r.years[0], to = r.years[r.years.length - 1];
  const { overtakes, leaders, ...params } = r;
  return {
    format: "race",
    params,
    key,
    score: best.score,
    why: [
      `${overtakes} overtakes${leaders ? ` and ${leaders === 1 ? "a new #1" : `${leaders} changes at #1`}` : ""}: the liveliest stretch of years, picked from ${tried}`,
      `Real figures: ${DATA[r.metric].source}`,
      "Not on your channel before",
    ],
    facts: [
      `A bar-chart race Short: ${raceTitle(r.metric, r.region, r.top, from, to).toLowerCase()}, year by year, with World Bank figures and the source on screen.`,
      `Countries in it: ${r.series.map((s) => s.name).join(", ")}.`,
      `${overtakes} overtakes${leaders ? ` and ${leaders} change${leaders === 1 ? "" : "s"} at #1` : ""}. Don't give away who ends up #1.`,
    ],
    title: raceTitle(r.metric, r.region, r.top, from, to),
  };
}
