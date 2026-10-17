import { localParts } from "./times";

/**
 * YouTube Analytics, made sense of without the database so it can be
 * tested: the day YouTube has reported up to, its reports read by column
 * name, each Short's totals, who's watching, Shorts against long videos,
 * what a refusal means, and what a channel's card says about where its
 * reading stands. YouTube reports whole Pacific days a few days late, so
 * every reading carries the day it runs up to.
 */

/** YouTube Analytics' days are Pacific ones. */
export const PACIFIC = "America/Los_Angeles";

/** The Pacific date of a moment, like "2026-10-13". */
export function pacificDay(at: Date): string {
  const p = localParts(at, PACIFIC);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The date `n` days after a date (before it, for a negative `n`). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** One YouTube Analytics report: its column names, in the order YouTube gave them, and its rows. */
export type Report = { columns: string[]; rows: (string | number)[][] };

/** A report's rows, each read by column name, never by position. */
export function byColumn(r: Report): Record<string, string | number | undefined>[] {
  return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
}

/** A figure as a number, or null when YouTube didn't give one. */
function num(v: string | number | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The last day a daily report has, which is as far as YouTube has reported. Null with no rows. */
export function lastDay(r: Report): string | null {
  const days = byColumn(r).map((row) => String(row.day ?? "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return days.sort().at(-1) ?? null;
}

/** A report with no dimensions: its one row of totals, a metric's null where it has none. */
export function totalOf(r: Report, metric: string): number | null {
  return num(byColumn(r)[0]?.[metric]);
}

/** One Short's totals, as YouTube Analytics gave them. */
export type VideoReading = { youtubeId: string; views: number; engaged: number; avgSeconds: number | null; avgPercent: number | null; revenue: number | null };

/** Each Short's totals from a report by video. A row without plays and engaged views says nothing, so it's left out. */
export function videoReadings(r: Report): VideoReading[] {
  return byColumn(r).flatMap((row) => {
    const views = num(row.views), engaged = num(row.engagedViews);
    if (typeof row.video !== "string" || !row.video || views === null || engaged === null) return [];
    return [{ youtubeId: row.video, views, engaged, avgSeconds: num(row.averageViewDuration), avgPercent: num(row.averageViewPercentage), revenue: num(row.estimatedRevenue) }];
  });
}

/** The most days past the day a Short went up that a reading can run to and still give it its share: as long as learning waits for one. */
const SHARE_DAYS = 6;

/**
 * Whether a reading can give a Short its engaged share: once YouTube has
 * reported the day it went up and the day after, in Pacific time, so the
 * share covers its first day whatever hour it went up, and only while the
 * reading runs no more than 6 days past the day it went up. A Short first
 * read later, as every Short already up was when Hookline started reading
 * them, gets none: a share over the rest of its life isn't a first day's.
 */
export function shareDue(postedAt: Date, through: string): boolean {
  const day = pacificDay(postedAt);
  return through >= addDays(day, 1) && through <= addDays(day, SHARE_DAYS);
}

/** YouTube's age groups, youngest first, and what to call each. */
export const AGE_GROUPS = ["age13-17", "age18-24", "age25-34", "age35-44", "age45-54", "age55-64", "age65-"] as const;
export const AGE_LABEL: Record<(typeof AGE_GROUPS)[number], string> = {
  "age13-17": "13 to 17",
  "age18-24": "18 to 24",
  "age25-34": "25 to 34",
  "age35-44": "35 to 44",
  "age45-54": "45 to 54",
  "age55-64": "55 to 64",
  "age65-": "65 and over",
};

export const GENDERS = ["female", "male", "user_specified"] as const;
export const GENDER_LABEL: Record<(typeof GENDERS)[number], string> = { female: "Female", male: "Male", user_specified: "User-specified" };

/** One of YouTube's percentages of signed-in viewers 13 and over, as it's kept. */
export type ViewerRow = { age: string; gender: string; percent: number };

/** The rows of YouTube's report on viewers by age group and gender. */
export function viewerRows(r: Report): ViewerRow[] {
  return byColumn(r).flatMap((row) => {
    const percent = num(row.viewerPercentage);
    return typeof row.ageGroup === "string" && typeof row.gender === "string" && percent !== null ? [{ age: row.ageGroup, gender: row.gender, percent }] : [];
  });
}

/** A group of viewers and its share of them, in percent. */
export type Group = { id: string; label: string; percent: number };
export type Audience = { ages: Group[]; genders: Group[]; largest: Group };

const isAge = (a: string): a is (typeof AGE_GROUPS)[number] => (AGE_GROUPS as readonly string[]).includes(a);

/**
 * Who's watching: each age group summed across genders, in YouTube's
 * order, each gender summed across ages, and the biggest age group. Only
 * groups YouTube reported. Null when YouTube shared nothing, as it does
 * for channels without enough signed-in viewers.
 */
export function audienceOf(rows: ViewerRow[] | null | undefined): Audience | null {
  const known = (rows ?? []).filter((r) => isAge(r.age) && Number.isFinite(r.percent));
  if (!known.length) return null;
  const total = (match: (r: ViewerRow) => boolean) => known.filter(match).reduce((a, r) => a + r.percent, 0);
  const ages = AGE_GROUPS.filter((a) => known.some((r) => r.age === a)).map((a) => ({ id: a, label: AGE_LABEL[a], percent: total((r) => r.age === a) }));
  const genders = GENDERS.filter((g) => known.some((r) => r.gender === g)).map((g) => ({ id: g, label: GENDER_LABEL[g], percent: total((r) => r.gender === g) }));
  return { ages, genders, largest: ages.reduce((a, b) => (b.percent > a.percent ? b : a)) };
}

/**
 * Shorts against long videos in a report by content type: the SHORTS row
 * and the VIDEO_ON_DEMAND row, leaving lives and stories out. Null when
 * the report doesn't split them at all.
 */
export function contentSplit(r: Report, metric: string): { shorts: number; long: number } | null {
  if (!r.columns.includes("creatorContentType") || !r.columns.includes(metric)) return null;
  const rows = byColumn(r);
  const of = (type: string) => rows.filter((row) => String(row.creatorContentType).toUpperCase() === type).reduce((a, row) => a + (num(row[metric]) ?? 0), 0);
  return { shorts: of("SHORTS"), long: of("VIDEO_ON_DEMAND") };
}

/** Why a channel's last try didn't read it: no permission, access lost, a limit, or anything else. */
export type Problem = "scope" | "access" | "quota" | "error";

/** What was being done when it failed: getting access, the first query (the last reported day), revenue, the Shorts and long videos split, or the rest. */
export type Step = "access" | "first" | "revenue" | "split" | "other";

/** Google's reasons for a limit, the whole app's: a reading that meets one waits, rather than trying channel after channel. */
const LIMITS = ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"];

/**
 * What a failure means for a channel's reading. A limit (a 429, or a
 * reason naming one) is the whole app's. Getting access fails for good
 * with a revoked token (Google's 400 invalid_grant), no tokens, no refresh
 * token or a 401, unless Google says to try again later. A 401 on any query
 * means access is lost. A 403 on the first query means YouTube Analytics
 * wasn't allowed. A 403 on revenue only means revenue can't be read, and
 * a 400 on the split only that YouTube didn't split it: those are skipped.
 * Anything else, a network failure included, is an error.
 */
export function problemOf(e: { status: number; reason: string | null }, step: Step): Problem | "skip" {
  if (e.status === 429 || LIMITS.includes(e.reason ?? "") || /quota/i.test(e.reason ?? "")) return "quota";
  if (step === "access") return e.status === 0 || e.status >= 500 ? "error" : "access";
  if (e.status === 401) return "access";
  if (step === "first" && e.status === 403) return "scope";
  if (step === "revenue" && e.status === 403) return "skip";
  if (step === "split" && e.status === 400) return "skip";
  return "error";
}

/** How long people watched, like "0:17 · 64%". The percentage passes 100 when people watch a Short more than once. */
export function watched(seconds: number | null, percent: number | null): string | null {
  const parts: string[] = [];
  if (seconds !== null && Number.isFinite(seconds)) {
    const s = Math.round(seconds);
    parts.push(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
  }
  if (percent !== null && Number.isFinite(percent)) parts.push(`${Math.round(percent)}%`);
  return parts.length ? parts.join(" · ") : null;
}

/** The day YouTube has reported up to, as the screens say it: "Oct 13". */
export function reportedDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** One of YouTube's percentages of viewers, as shown: whole numbers, and a group under half a percent says so rather than 0%. */
export function percentOf(p: number): string {
  return p > 0 && p < 0.5 ? "Under 1%" : `${Math.round(p)}%`;
}

/**
 * Where a channel's YouTube Analytics stand, for its card: read in full,
 * or kept from its last full read while the last try failed (`stale`),
 * the only two with numbers to show; not read yet, or tried with nothing
 * kept (`failing`); not allowed (`scope`); or access lost, which a channel
 * that needs reconnecting has too.
 */
export type ReadState = "read" | "stale" | "unread" | "failing" | "scope" | "access";

export function readState(c: { status: string; problem: Problem | null; syncedAt: Date | null }): ReadState {
  if (c.status !== "connected" || c.problem === "access") return "access";
  if (c.problem === "scope") return "scope";
  if (c.problem) return c.syncedAt ? "stale" : "failing";
  return c.syncedAt ? "read" : "unread";
}

/** What a channel's card says about where its YouTube Analytics stand, with the day its numbers run up to; nothing once they're read. */
export function readLine(state: ReadState, through: string | null): string | null {
  if (state === "unread") return "Not read yet. Hookline reads YouTube Analytics once a day.";
  if (state === "scope") return "Hookline isn't allowed to read this channel's YouTube Analytics. Connect it again and leave YouTube Analytics ticked on Google's screen.";
  if (state === "access") return "Hookline lost access to this channel. Connect it again to see its numbers.";
  if (state === "failing") return "Hookline couldn't read this channel's YouTube Analytics yet. It tries again soon.";
  if (state === "stale") return `${through ? `Showing what YouTube said up to ${reportedDay(through)}. ` : ""}Hookline couldn't read it today and tries again soon.`;
  return null;
}

/** Google's screen again for one of their YouTube channels, then back to Earnings: it updates the same channel, which is read again at the next run. */
export function connectAgain(channelId: string): string {
  return `/api/connect/youtube?channel=${encodeURIComponent(channelId)}&next=${encodeURIComponent("/app/earnings")}`;
}

/**
 * The channel picked to see on its own on Earnings, from its address:
 * `channel`, except on the way back from Google's or TikTok's screen, as
 * after Connect again, where it names the channel that came back, for
 * Settings' note, and nobody picked it.
 */
export function pickedChannel(q: Record<string, string | string[] | undefined>): string | null {
  return typeof q.connected === "string" || typeof q.channel !== "string" ? null : q.channel;
}

/** How YouTube Analytics reads are going across Hookline, as counts only: YouTube channels, how many were read in the last day, and how many can't be and why. */
export type Health = { channels: number; read: number; scope: number; access: number; failing: number };

/**
 * /admin's line on YouTube Analytics: channels read in the last day out of
 * all of them, and those that can't be read, by why. Never anyone's numbers.
 */
export function healthLine(h: Health): string {
  if (h.channels === 0) return "YouTube Analytics: no YouTube channels to read yet.";
  const why = ([[h.scope, "not allowed"], [h.access, "access lost"], [h.failing, "failing"]] as const)
    .filter(([k]) => k > 0)
    .map(([k, what]) => `${k.toLocaleString("en-US")} (${what})`);
  const all = why.length < 2 ? why.join("") : `${why.slice(0, -1).join(", ")} and ${why.at(-1)}`;
  return `YouTube Analytics: read for ${h.read.toLocaleString("en-US")} of ${h.channels.toLocaleString("en-US")} channel${h.channels === 1 ? "" : "s"} in the last day.${all ? ` Can't read ${all}.` : ""}`;
}
