/**
 * Earnings as daily series, worked out without the database so they can
 * be tested: filling the days a source reported nothing, turning running
 * totals into daily amounts, and adding up a goal's progress.
 */

export type Point = { day: string; value: number | null };

/** "2026-10-15" for each of the last `n` days up to `today`, oldest first. */
export function lastDays(today: string, n: number): string[] {
  const end = new Date(`${today}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86400_000).toISOString().slice(0, 10));
}

/** A value for every day: what was reported, and `missing` (0, or null for "don't know") for the rest. */
export function fill(days: string[], values: Map<string, number>, missing: 0 | null): Point[] {
  return days.map((day) => ({ day, value: values.has(day) ? values.get(day)! : missing }));
}

/** The last day a source has reported, if any. */
export function lastReported(values: Map<string, number>): string | null {
  return [...values.keys()].sort().at(-1) ?? null;
}

/**
 * A value for every day from a source that reports days late, like
 * YouTube Analytics (2 to 3 days behind): a day it skipped between ones
 * it reported had nothing, but a day after its last report, or before
 * its first, isn't reported yet and stays unknown, never zero.
 */
export function fillReported(days: string[], values: Map<string, number>): Point[] {
  const known = [...values.keys()].sort();
  const first = known[0], last = known.at(-1);
  return days.map((day) => ({ day, value: values.has(day) ? values.get(day)! : first && last && day > first && day < last ? 0 : null }));
}

/**
 * A value for every day from a source that's only been read back to a
 * day, like Stripe (from 35 days before it was connected): a day from
 * then on with nothing reported had nothing, and a day before it is
 * unknown, never zero.
 */
export function fillSince(days: string[], values: Map<string, number>, since: string | null): Point[] {
  return days.map((day) => ({ day, value: values.has(day) ? values.get(day)! : since !== null && day >= since ? 0 : null }));
}

/**
 * Daily amounts from a running total that's read now and then (TikTok
 * only gives each video's total views): each day is the rise since the
 * last reading before it. A day with no reading is unknown, not zero.
 */
export function fromTotals(days: string[], totals: Map<string, number>): Point[] {
  const known = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  return days.map((day) => {
    const now = totals.get(day);
    if (now === undefined) return { day, value: null };
    const before = known.filter(([d]) => d < day).at(-1);
    return { day, value: before ? Math.max(0, now - before[1]) : null };
  });
}

export const sum = (ps: Point[]) => ps.reduce((a, p) => a + (p.value ?? 0), 0);

/**
 * Several sources' days added up, like each channel's views for all of
 * them together. A part only counts from `from` (its first report) to
 * `until` (its last, for one that can't be read any more): before or
 * after that it adds nothing. A day is unknown while any part being read
 * then hasn't reported it, and a day no part was being read is unknown too.
 * Every part has the same days.
 */
export function addUp(parts: { points: Point[]; from: string | null; until?: string | null }[]): Point[] {
  const days = parts[0]?.points.map((p) => p.day) ?? [];
  return days.map((day, i) => {
    const read = parts.filter((p) => p.from !== null && day >= p.from && (!p.until || day <= p.until));
    if (!read.length || read.some((p) => p.points[i].value === null)) return { day, value: null };
    return { day, value: read.reduce((a, p) => a + p.points[i].value!, 0) };
  });
}

/** A goal's progress: this month so far, or everything ever. */
export function goalProgress(values: Point[], period: "month" | "all", today: string): number {
  const month = today.slice(0, 7);
  return sum(period === "month" ? values.filter((p) => p.day.startsWith(month)) : values);
}

/** Stripe counts money in the smallest unit, except for currencies that don't have one. */
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
export const fromMinor = (amount: number, currency: string) => (ZERO_DECIMAL.has(currency.toLowerCase()) ? amount : amount / 100);
