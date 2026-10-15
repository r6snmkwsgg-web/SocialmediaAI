import countriesFile from "../../data/countries.json";
import gdpFile from "../../data/gdp.json";
import populationFile from "../../data/population.json";
import type { Metric, Region } from "./types";

/**
 * The public data rankings and bar-chart races are made from: the World
 * Bank's population and GDP for every country, with names and continents.
 * scripts/fetch-data.mts refreshes it.
 */

export type Series = { title: string; unit: string; source: string; license: string; fetched: string; years: number[]; values: Record<string, (number | null)[]> };

export const COUNTRIES = countriesFile.countries as Record<string, { name: string; continent: string; capital: string }>;

export const DATA: Record<Metric, Series> = { population: populationFile as Series, gdp: gdpFile as Series };

export const REGIONS: Region[] = ["World", "Africa", "Asia", "Europe", "North America", "South America", "Oceania"];

export function inRegion(iso: string, region: Region): boolean {
  const c = COUNTRIES[iso];
  return !!c && (region === "World" || c.continent === region);
}

/** The latest year most countries have a figure for: a year just added often has only a few. */
export function latestYear(metric: Metric): number {
  const d = DATA[metric];
  const isos = Object.keys(d.values);
  for (let i = d.years.length - 1; i >= 0; i--) {
    const have = isos.filter((k) => d.values[k][i] !== null).length;
    if (have >= isos.length * 0.9) return d.years[i];
  }
  return d.years[0];
}

/** A value said the way people say it: 1.45 billion, $27.4 trillion. */
export function say(metric: Metric, v: number): string {
  const units: [number, string][] = [
    [1e12, "trillion"],
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ];
  const [div, word] = units.find(([d]) => v >= d) ?? [1, ""];
  const n = v / div;
  const num = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  const text = `${num.replace(/\.0+$|(\.\d*?)0+$/, "$1")}${word ? ` ${word}` : ""}`;
  return metric === "gdp" ? `$${text}` : text;
}

export const sourceLine = (metric: Metric, year: number | string) => `Source: ${DATA[metric].source}, ${year}`;
