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
