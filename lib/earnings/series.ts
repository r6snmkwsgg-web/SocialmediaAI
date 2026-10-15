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

/** A goal's progress: this month so far, or everything ever. */
export function goalProgress(values: Point[], period: "month" | "all", today: string): number {
  const month = today.slice(0, 7);
  return sum(period === "month" ? values.filter((p) => p.day.startsWith(month)) : values);
}

/** Stripe counts money in the smallest unit, except for currencies that don't have one. */
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
export const fromMinor = (amount: number, currency: string) => (ZERO_DECIMAL.has(currency.toLowerCase()) ? amount : amount / 100);
