import { atLocal, localParts } from "./times";

/**
 * YouTube's daily quota, as Hookline shares it out. It belongs to
 * Hookline's one Google Cloud project, so every account shares it. Since
 * June 2026 a project gets three allowances a day: 100 uploads, 100
 * searches, and 10,000 units for every other call, all reset at midnight
 * Pacific time. YouTube Analytics is a different API, counted on its own.
 * Each part of Hookline may use only its share of the units, so what the
 * others can't touch is always there for posting. Hookline's quota day
 * starts five minutes after Google's reset, so a call or a refusal in
 * those minutes belongs to the day before and can never close a new day.
 */

/** the allowances: units for most calls, uploads, searches, and YouTube Analytics reports */
export const BUCKETS = ["units", "uploads", "searches", "analytics"] as const;
export type Bucket = (typeof BUCKETS)[number];

/**
 * What a call is for: Trends; posting (uploads, and the checks that they
 * went up); pasted-link checks; views for the learning loop; connecting a
 * channel; YouTube Live; and Earnings' YouTube Analytics.
 */
export const KINDS = ["trends", "uploads", "checks", "stats", "other", "live", "analytics"] as const;
export type Kind = (typeof KINDS)[number];

/** Each method Hookline calls: the allowance it comes out of, and what one call costs there. */
export const METHODS = {
  "videos.insert": { bucket: "uploads", cost: 1 },
  "search.list": { bucket: "searches", cost: 1 },
  /** up to 50 videos a call */
  "videos.list": { bucket: "units", cost: 1 },
  "channels.list": { bucket: "units", cost: 1 },
  /** Google's pages disagree on this one: 5 until Matt checks the project's Quotas page */
  "liveBroadcasts.list": { bucket: "units", cost: 5 },
  "liveChatMessages.list": { bucket: "units", cost: 5 },
  "superChatEvents.list": { bucket: "units", cost: 1 },
  /** one YouTube Analytics report */
  "reports.query": { bucket: "analytics", cost: 1 },
} as const satisfies Record<string, { bucket: Bucket; cost: number }>;
export type Method = keyof typeof METHODS;

/** Google's defaults a day; YOUTUBE_DAILY_* replace them once it grants more. Analytics has no limit (null) until one is set. */
export const DEFAULT_LIMITS: Record<Bucket, number | null> = { units: 10_000, uploads: 100, searches: 100, analytics: null };

/**
 * The most each kind may use of an allowance in a day. A kind with no
 * share can use all of it. Posting has none, so the fifth of the units the
 * others can't take is always there for its checks.
 */
export const SHARES: Record<Bucket, Partial<Record<Kind, number>>> = {
  units: { trends: 0.05, stats: 0.15, checks: 0.3, other: 0.05, live: 0.25 },
  searches: { trends: 1 },
  uploads: {},
  analytics: {},
};

/** Which kinds draw on each allowance, in the order /admin lists them. */
export const USES: Record<Bucket, readonly Kind[]> = {
  units: ["uploads", "checks", "stats", "trends", "other", "live"],
  uploads: ["uploads"],
  searches: ["trends"],
  analytics: ["analytics"],
};

export const KIND_NAMES: Record<Kind, string> = {
  trends: "Trends",
  uploads: "Posting",
  checks: "Link checks",
  stats: "Views",
  other: "Connecting channels",
  live: "YouTube Live",
  analytics: "YouTube Analytics",
};

/** Links one account can have checked in a day: above any plan's Shorts, so it only stops abuse. */
export const LINK_CHECKS_A_DAY = 50;

/** YouTube Live's units one account can use in a day: about 50 minutes of busy chat, so one streamer can't use everyone's. */
export const ACCOUNT_LIVE_UNITS = 1500;

/** The most one account's LIVE games may use of a day's units: ACCOUNT_LIVE_UNITS, or all of YouTube Live's share when that's less. */
export function accountLiveUnits(limit: number | null): number {
  const share = capOf("units", "live", limit);
  return share === null ? ACCOUNT_LIVE_UNITS : Math.min(ACCOUNT_LIVE_UNITS, share);
}

/** What connecting a channel says when there's no quota left today to read it with, in Settings and on the welcome page. */
export const CONNECT_WAIT = "Hookline has used today's YouTube allowance for connecting channels. Try again after midnight Pacific time.";

/** Google resets the quota at midnight Pacific. Hookline's day starts 5 minutes later, so the first try is never early. */
export const AFTER_RESET_MS = 5 * 60_000;

const PACIFIC = "America/Los_Angeles";

/** The Pacific date of five minutes before a moment: the date its quota day started on. */
function dayOf(now: Date) {
  return localParts(new Date(now.getTime() - AFTER_RESET_MS), PACIFIC);
}

/** 00:05 Pacific on a date, where the day may run past the month's end. */
function startOn(y: number, m: number, d: number): Date {
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Date(atLocal(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 0, PACIFIC).getTime() + AFTER_RESET_MS);
}

/** The quota day a moment counts against, like "2026-10-16". */
export function quotaDay(now: Date): string {
  const p = dayOf(now);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** When that quota day began: 00:05 Pacific on its date. */
export function quotaDayStart(now: Date): Date {
  const p = dayOf(now);
  return startOn(p.y, p.m, p.d);
}

/**
 * When the quota comes back: 00:05 Pacific on the next day. Between
 * midnight and 00:05 that's the same morning, since those minutes still
 * belong to the day before. Clock changes make some days 23 or 25 hours.
 */
export function quotaResetsAt(now: Date): Date {
  const p = dayOf(now);
  return startOn(p.y, p.m, p.d + 1);
}

/**
 * Each allowance's limit from the YOUTUBE_DAILY_* settings: a whole
 * number of 1 or more, or Google's default for anything else (0, a
 * negative, a decimal, a word, nothing), so a typo can never stop a kind
 * of call while the app says it comes back at the reset.
 */
export function limitsFrom(raw: Partial<Record<Bucket, string | undefined>>): Record<Bucket, number | null> {
  const out = { ...DEFAULT_LIMITS };
  for (const b of BUCKETS) {
    const v = raw[b]?.trim() ?? "";
    if (/^\d+$/.test(v) && Number(v) >= 1 && Number.isSafeInteger(Number(v))) out[b] = Number(v);
  }
  return out;
}

const capped = (limit: number, share: number) => Math.floor(limit * share);

/** The most a kind may use of an allowance in a day: its share of the limit, rounded down, or all of it with no share. Null with no limit. */
export function capOf(bucket: Bucket, kind: Kind, limit: number | null): number | null {
  if (limit === null) return null;
  const share = SHARES[bucket][kind];
  return share === undefined ? limit : capped(limit, share);
}

/** What's always left for posting: the limit less every capped kind's cap. Null with no limit. */
export function heldOf(bucket: Bucket, limit: number | null): number | null {
  if (limit === null) return null;
  let left = limit;
  for (const k of KINDS) {
    const share = SHARES[bucket][k];
    if (share !== undefined) left -= capped(limit, share);
  }
  return left;
}

/**
 * Whether `units` more fit: under the allowance and under the kind's
 * share, and only while YouTube hasn't said the allowance is used up.
 * Landing exactly on a limit fits.
 */
export function fits(a: { limit: number | null; cap: number | null; used: number; kindUsed: number; full: boolean }, units: number): boolean {
  return !a.full && (a.limit === null || a.used + units <= a.limit) && (a.cap === null || a.kindUsed + units <= a.cap);
}

/** When to try again, for a message: "in under an hour", "in about 1 hour", "in about 5 hours". */
export function tryAgainIn(until: Date, now: Date): string {
  const ms = until.getTime() - now.getTime();
  if (ms < 3600_000) return "in under an hour";
  const hours = Math.round(ms / 3600_000);
  return hours === 1 ? "in about 1 hour" : `in about ${hours} hours`;
}

/** A quota day on /admin: what each allowance used (null before counting began), and which were used up. */
export type QuotaWeekDay = { day: string; used: Record<Bucket, number> | null; full: Bucket[] };

/**
 * The last 7 quota days up to `today`, oldest first, from the ledger's
 * rows. `first` is the ledger's first day: a day before it is null, never
 * 0, since nothing was counted then. A day after it with no calls is 0.
 */
export function lastWeek(rows: { day: string; bucket: Bucket; units: number; full: boolean }[], today: string, first: string | null): QuotaWeekDay[] {
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d - 6 + i)).toISOString().slice(0, 10);
    if (!first || day < first) return { day, used: null, full: [] };
    const used = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
    const full = new Set<Bucket>();
    for (const r of rows) {
      if (r.day !== day) continue;
      used[r.bucket] += r.units;
      if (r.full) full.add(r.bucket);
    }
    return { day, used, full: BUCKETS.filter((b) => full.has(b)) };
  });
}
