/**
 * Downloads the public data the ranking and bar-chart-race Shorts are
 * made from, and keeps the parts they use in data/. Run it again to pick
 * up a new year:
 *
 *   pnpm data
 *
 * Population and GDP are the World Bank's (CC BY 4.0), country names and
 * continents from the country-codes package (ODC PDDL), all through the
 * Frictionless Data mirrors on GitHub.
 */
import { writeFileSync } from "node:fs";

const RAW = "https://raw.githubusercontent.com/datasets";

async function csv(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/** the names people know, where the standard short one reads oddly on a video */
const NAMES: Record<string, string> = {
  USA: "USA",
  GBR: "UK",
  COD: "DR Congo",
  COG: "Congo",
  CIV: "Ivory Coast",
  BIH: "Bosnia",
  MMR: "Myanmar",
  ARE: "UAE",
  CAF: "Central African Rep.",
  STP: "São Tomé",
  VCT: "St Vincent",
  KNA: "St Kitts & Nevis",
  ATG: "Antigua & Barbuda",
  TTO: "Trinidad & Tobago",
};

function continent(r: Record<string, string>): string | null {
  const region = r["Region Name"];
  if (region === "Americas") return r["Intermediate Region Name"] === "South America" ? "South America" : "North America";
  return ["Africa", "Asia", "Europe", "Oceania"].includes(region) ? region : null;
}

async function main() {
  const codes = await csv(`${RAW}/country-codes/main/data/country-codes.csv`);
  const countries: Record<string, { name: string; continent: string; capital: string }> = {};
  for (const r of codes) {
    const iso = r["ISO3166-1-Alpha-3"];
    const c = continent(r);
    if (!iso || !c || r.is_independent !== "Yes") continue;
    countries[iso] = { name: NAMES[iso] ?? r["CLDR display name"], continent: c, capital: r.Capital };
  }
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync("data/countries.json", JSON.stringify({ source: "country-codes, github.com/datasets/country-codes", license: "ODC PDDL", fetched: today, countries }, null, 0) + "\n");
  console.log(`${Object.keys(countries).length} countries`);

  const series = async (name: string, url: string, meta: { title: string; unit: string; source: string; license: string }) => {
    const rows = await csv(url);
    const years = [...new Set(rows.map((r) => Number(r.Year)))].filter(Number.isFinite).sort((a, b) => a - b);
    const values: Record<string, (number | null)[]> = {};
    for (const r of rows) {
      const iso = r["Country Code"];
      if (!countries[iso]) continue;
      values[iso] ??= years.map(() => null);
      const v = Number(r.Value);
      if (r.Value !== "" && Number.isFinite(v)) values[iso][years.indexOf(Number(r.Year))] = Math.round(v);
    }
    writeFileSync(`data/${name}.json`, JSON.stringify({ ...meta, fetched: today, years, values }) + "\n");
    console.log(`${name}: ${Object.keys(values).length} countries, ${years[0]} to ${years[years.length - 1]}`);
  };

  await series("population", `${RAW}/population/main/data/population.csv`, {
    title: "Population",
    unit: "people",
    source: "World Bank (SP.POP.TOTL)",
    license: "CC BY 4.0",
  });
  await series("gdp", `${RAW}/gdp/main/data/gdp.csv`, {
    title: "GDP",
    unit: "US dollars, at the time",
    source: "World Bank (NY.GDP.MKTP.CD)",
    license: "CC BY 4.0",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
