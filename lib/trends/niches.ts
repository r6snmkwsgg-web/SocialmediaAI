import type { FormatId } from "../shorts/types";

/**
 * The niches Trends watches on YouTube Shorts, the search that finds each
 * one's videos, and which of Hookline's formats it's like (so "make one
 * like this" can). Niches with no matching format are there to watch.
 */

export type Niche = { id: string; name: string; query: string; format: FormatId | null };

export const NICHES: Niche[] = [
  { id: "ball-battles", name: "Ball battles", query: "ball battle", format: "battle" },
  { id: "quizzes", name: "Quizzes", query: "quiz trivia", format: "quiz" },
  { id: "would-you-rather", name: "Would you rather", query: "would you rather", format: "wyr" },
  { id: "text-stories", name: "Text stories", query: "text story", format: "texts" },
  { id: "rankings", name: "Rankings", query: "ranking top 10 countries", format: "ranking" },
  { id: "bar-chart-races", name: "Bar chart races", query: "bar chart race", format: "race" },
  { id: "satisfying", name: "Satisfying", query: "satisfying", format: null },
  { id: "facts", name: "Facts", query: "facts you didn't know", format: null },
  { id: "gaming", name: "Gaming", query: "gaming", format: null },
  { id: "football", name: "Football", query: "football skills", format: null },
];

export const nicheOf = (id: string) => NICHES.find((n) => n.id === id);

/** "PT1M5S" to seconds: YouTube's way of writing a length. */
export function isoSeconds(d: string): number {
  const m = d.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return Infinity;
  const [, days, h, min, sec] = m.map((x) => Number(x ?? 0));
  return days * 86400 + h * 3600 + min * 60 + sec;
}

/** Views per hour since it went up: how fast it's growing, which is what "rising" means. */
export function perHour(views: number, publishedAt: Date, now: Date): number {
  const hours = Math.max(1, (now.getTime() - publishedAt.getTime()) / 3600_000);
  return views / hours;
}

/** The middle value, for "a typical rising Short in this format". */
export function middle(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * When the channel's own Shorts did best: the average result at 24 hours
 * for each day of the week and three-hour block they were posted in.
 */
export function heatmap(posts: { weekday: number; hour: number; lift: number }[]): { cells: (number | null)[][]; counts: number[][] } {
  const sum = Array.from({ length: 7 }, () => Array<number>(8).fill(0));
  const counts = Array.from({ length: 7 }, () => Array<number>(8).fill(0));
  for (const p of posts) {
    const b = Math.floor(p.hour / 3);
    sum[p.weekday][b] += Math.log(p.lift);
    counts[p.weekday][b]++;
  }
  return { cells: sum.map((row, d) => row.map((s, b) => (counts[d][b] ? Math.exp(s / counts[d][b]) : null))), counts };
}

/** How a niche's last try went: rising Shorts found, none found, waited for YouTube's quota, or YouTube didn't answer. */
export type TrendOutcome = "found" | "none" | "quota" | "failed";

/** When a niche was last checked (null until a check has worked), how its last try went, and when it's checked next. */
export type TrendCheck = { niche: string; checkedAt: Date | null; triedAt: Date; outcome: TrendOutcome | null; nextAt: Date };

/**
 * The niches whose check is due: never tried, or their next time has
 * come. Ones never checked go first, then the longest since checked, so
 * when Trends' share of the quota runs short, the niches take turns.
 */
export function dueNiches(niches: Niche[], checks: TrendCheck[], now: Date): Niche[] {
  const by = new Map(checks.map((c) => [c.niche, c]));
  const due = niches.filter((n) => (by.get(n.id)?.nextAt.getTime() ?? 0) <= now.getTime());
  // never checked sorts as the longest since; the list's own order breaks ties
  const since = (n: Niche) => by.get(n.id)?.checkedAt?.getTime() ?? -Infinity;
  return due.map((n, i) => ({ n, i, at: since(n) })).sort((a, b) => (a.at === b.at ? a.i - b.i : a.at < b.at ? -1 : 1)).map((x) => x.n);
}

/** A niche is out of date once it hasn't been checked for this long: its day, and some hours' grace for a check that's late or tried again. */
export const STALE_AFTER = 30 * 3600_000;

/** A niche shown that's out of date, with how its last try went. */
export type Stale = { id: string; name: string; checkedAt: Date | null; outcome: TrendOutcome | null };

/** The niches shown that have never been checked, or not in over 30 hours, each with how its last try went. */
export function staleOf(checks: TrendCheck[], shown: string[], now: Date): Stale[] {
  const by = new Map(checks.map((c) => [c.niche, c]));
  return shown.flatMap((id) => {
    const n = nicheOf(id);
    const c = by.get(id);
    if (!n || (c?.checkedAt && now.getTime() - c.checkedAt.getTime() <= STALE_AFTER)) return [];
    return [{ id, name: n.name, checkedAt: c?.checkedAt ?? null, outcome: c?.outcome ?? null }];
  });
}

/** The niches named: those checked before apart from those never checked, so neither is said wrongly of the other. */
function named(xs: Stale[]): string {
  const before = xs.filter((s) => s.checkedAt).map((s) => s.name);
  const never = xs.filter((s) => !s.checkedAt).map((s) => s.name);
  const parts: string[] = [];
  if (before.length) parts.push(`Not checked in over a day: ${before.join(", ")}.`);
  if (never.length) parts.push(`Not checked yet: ${never.join(", ")}.`);
  return parts.join(" ");
}

/**
 * What the Trends page says about stale niches: a line for each reason.
 * Trends' share of YouTube's allowance is used up, YouTube didn't answer,
 * or nothing has checked them, since the worker isn't running.
 */
export function staleLines(stale: Stale[]): string[] {
  const quota = stale.filter((s) => s.outcome === "quota");
  const failed = stale.filter((s) => s.outcome === "failed");
  const idle = stale.filter((s) => s.outcome !== "quota" && s.outcome !== "failed");
  const waited = idle.filter((s) => s.checkedAt);
  const fresh = idle.filter((s) => !s.checkedAt);
  const out: string[] = [];
  if (quota.length) {
    const when = quota.length === 1 ? "it's checked after the reset" : "they're checked after it resets";
    out.push(`${named(quota)} Hookline's YouTube allowance for Trends is used up for today, so ${when}.`);
  }
  if (failed.length) out.push(`${named(failed)} YouTube didn't answer, so Hookline tries again within the hour.`);
  if (waited.length) out.push(`${named(waited)} Niches are checked while the worker is running.`);
  if (fresh.length) out.push(`${named(fresh)} Niches are checked within half an hour of the worker starting.`);
  return out;
}

/** A niche's made-for-kids share for the page: "9 of 48" and 19 (percent), or "Not measured yet" with nothing YouTube said either way. */
export function kidsOf(kids: number, of: number): { text: string; pct: number | null } {
  if (of <= 0) return { text: "Not measured yet", pct: null };
  return { text: `${kids} of ${of}`, pct: Math.round((kids / of) * 100) };
}
