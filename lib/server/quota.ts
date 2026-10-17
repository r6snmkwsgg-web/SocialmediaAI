import "server-only";
import {
  BUCKETS, capOf, fits, heldOf, KIND_NAMES, KINDS, lastWeek, LINK_CHECKS_A_DAY, METHODS, quotaDay, quotaResetsAt, SHARES, USES,
  type Bucket, type Kind, type Method, type QuotaWeekDay,
} from "../shorts/quota";
import { admin, type Tx } from "./db";
import { youtubeQuota } from "./env";

/**
 * Hookline's count of YouTube's daily quota (the rules and shares are in
 * lib/shorts/quota.ts). Every call is counted here before it's made, by
 * its quota day, the allowance it comes out of and what it's for, one at
 * a time for each allowance, so the allowance is never overrun and
 * Trends, views, link checks and YouTube Live can't use what posting
 * needs. A call with no room left isn't made: it throws QuotaWait, and
 * whatever asked waits for the reset. When YouTube says an allowance is
 * used up anyway, it's closed until the reset, whatever the count says.
 * Each account's uploads and link checks are counted here too, by the
 * server alone.
 */

/** A call there's no room for today: whatever asked waits for `until`. `google` when YouTube itself said it's used up. */
export class QuotaWait extends Error {
  constructor(readonly bucket: Bucket, readonly kind: Kind, readonly until: Date, readonly google: boolean) {
    super(google
      ? `YouTube said Hookline's ${bucket} are used up for today: waiting until ${until.toISOString()}`
      : `No ${bucket} left today for ${KIND_NAMES[kind].toLowerCase()}: waiting until ${until.toISOString()}`);
    this.name = "QuotaWait";
  }
}

/** One count at a time for each allowance and quota day, held until the transaction ends. */
async function lockAllowance(tx: Tx, day: string, bucket: Bucket): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtext(${`youtube-quota:${day}:${bucket}`}))`;
}

/**
 * Counts a call before it's made, or throws QuotaWait when there's no
 * room for it: the allowance is used up (by Hookline's count or YouTube's
 * word), or its kind has used its share. `times` calls are counted
 * together, so a batch never stops halfway. A call that finds no room is
 * written down too, for /admin. Never call it inside another transaction:
 * it takes a connection of its own, and the pool is small.
 */
export async function spend(kind: Kind, method: Method, o: { times?: number; now?: Date } = {}): Promise<void> {
  const times = o.times ?? 1;
  if (times <= 0) return;
  const now = o.now ?? new Date();
  const { bucket, cost } = METHODS[method];
  const units = cost * times;
  const day = quotaDay(now);
  const limit = youtubeQuota()[bucket];
  const cap = capOf(bucket, kind, limit);
  const wait = await admin(async (tx) => {
    await lockAllowance(tx, day, bucket);
    const [u] = await tx<{ used: number; kind_used: number; full: boolean }[]>`
      select coalesce(sum(units), 0)::int as used, coalesce(sum(units) filter (where kind = ${kind}), 0)::int as kind_used,
        coalesce(bool_or(full_at is not null), false) as full
      from public.youtube_quota where day = ${day} and bucket = ${bucket}`;
    if (fits({ limit, cap, used: u.used, kindUsed: u.kind_used, full: u.full }, units)) {
      await tx`
        insert into public.youtube_quota (day, bucket, kind, units, calls) values (${day}, ${bucket}, ${kind}, ${units}, ${times})
        on conflict (day, bucket, kind) do update set units = youtube_quota.units + excluded.units, calls = youtube_quota.calls + excluded.calls`;
      return null;
    }
    await tx`
      insert into public.youtube_quota (day, bucket, kind, ran_out_at) values (${day}, ${bucket}, ${kind}, ${now})
      on conflict (day, bucket, kind) do update set ran_out_at = coalesce(youtube_quota.ran_out_at, excluded.ran_out_at)`;
    return new QuotaWait(bucket, kind, quotaResetsAt(now), u.full);
  });
  if (wait) throw wait;
}

/** YouTube said a method's allowance is used up: it's closed for every kind until the reset, whatever Hookline counted. */
export async function closeForToday(method: Method, kind: Kind, now = new Date()): Promise<void> {
  const { bucket } = METHODS[method];
  const day = quotaDay(now);
  await admin(async (tx) => {
    await lockAllowance(tx, day, bucket);
    await tx`
      insert into public.youtube_quota (day, bucket, kind, full_at) values (${day}, ${bucket}, ${kind}, ${now})
      on conflict (day, bucket, kind) do update set full_at = coalesce(youtube_quota.full_at, excluded.full_at)`;
  });
}

/** Each account's counts are kept a week, and older ones tidied away as new ones are counted. */
async function forgetOldDays(tx: Tx, day: string): Promise<void> {
  await tx`delete from public.youtube_account_days where day < ${day}::date - 7`;
}

/**
 * One more Short Hookline uploaded for an account this quota day, counted
 * in the transaction that records the upload, so the two never disagree.
 * The plan's uploads a day are measured against this, never against the
 * account's own videos rows, which people can edit.
 */
export async function countUpload(tx: Tx, userId: string, now = new Date()): Promise<void> {
  const day = quotaDay(now);
  await tx`
    insert into public.youtube_account_days (day, user_id, uploads) values (${day}, ${userId}, 1)
    on conflict (day, user_id) do update set uploads = youtube_account_days.uploads + 1`;
  await forgetOldDays(tx, day);
}

/** Takes one of an account's link checks for this quota day, or says no once it's had LINK_CHECKS_A_DAY, so one account can't use everyone's. */
export async function takeLinkCheck(userId: string, now = new Date()): Promise<boolean> {
  const day = quotaDay(now);
  return admin(async (tx) => {
    const took = await tx`
      insert into public.youtube_account_days (day, user_id, link_checks) values (${day}, ${userId}, 1)
      on conflict (day, user_id) do update set link_checks = youtube_account_days.link_checks + 1
        where youtube_account_days.link_checks < ${LINK_CHECKS_A_DAY}
      returning link_checks`;
    await forgetOldDays(tx, day);
    return took.length > 0;
  });
}

/** The most a kind may use, or null where only the allowance itself limits it (posting, or an allowance with no limit). */
const capFor = (bucket: Bucket, kind: Kind, limit: number | null) => (SHARES[bucket][kind] === undefined ? null : capOf(bucket, kind, limit));

/** One allowance today, as Hookline counted it. */
export type Usage = {
  day: string;
  limit: number | null;
  used: number;
  /** nothing more comes out of it today: YouTube said it's used up, or the count reached the limit */
  full: boolean;
  kinds: Record<Kind, { used: number; cap: number | null }>;
};

export async function usageToday(bucket: Bucket, now = new Date()): Promise<Usage> {
  const day = quotaDay(now);
  const limit = youtubeQuota()[bucket];
  const rows = await admin((tx) => tx<{ kind: Kind; units: number; full: boolean }[]>`
    select kind, units, full_at is not null as full from public.youtube_quota where day = ${day} and bucket = ${bucket}`);
  const used = rows.reduce((n, r) => n + r.units, 0);
  const kinds = Object.fromEntries(KINDS.map((k) => [k, { used: rows.find((r) => r.kind === k)?.units ?? 0, cap: capFor(bucket, k, limit) }]));
  return { day, limit, used, full: rows.some((r) => r.full) || (limit !== null && used >= limit), kinds: kinds as Usage["kinds"] };
}

/** What /admin shows: today's allowances by kind, what's held for posting, the Shorts waiting, and the last 7 days. */
export type QuotaToday = {
  day: string;
  resetsAt: Date;
  limits: Record<Bucket, number | null>;
  buckets: {
    bucket: Bucket;
    limit: number | null;
    used: number;
    /** always left for posting; null with no limit */
    held: number | null;
    /** when YouTube said it was used up */
    fullAt: Date | null;
    /** the first time a call found no room, whichever kind it was for */
    ranOutAt: Date | null;
    kinds: { kind: Kind; units: number; calls: number; cap: number | null; ranOutAt: Date | null }[];
  }[];
  /** ready Shorts waiting now, by what for; the half-hour pause after a failed upload isn't a wait */
  waiting: { youtube_quota: number; plan_cap: number };
  week: QuotaWeekDay[];
  /** when counting began: the ledger's first row, and the quota day it was on, which /admin shows as only part of a day */
  firstAt: Date | null;
  firstDay: string | null;
};

const earliest = (ds: (Date | null)[]): Date | null => ds.reduce<Date | null>((a, d) => (d && (!a || d < a) ? d : a), null);

export async function quotaToday(now = new Date()): Promise<QuotaToday> {
  const day = quotaDay(now);
  const limits = youtubeQuota();
  return admin(async (tx) => {
    const rows = await tx<{ day: string; bucket: Bucket; kind: Kind; units: number; calls: number; ran_out_at: Date | null; full_at: Date | null }[]>`
      select day::text as day, bucket, kind, units, calls, ran_out_at, full_at from public.youtube_quota
      where day > ${day}::date - 7 and day <= ${day}::date`;
    const [first] = await tx<{ day: string | null; at: Date | null }[]>`select min(day)::text as day, min(created_at) as at from public.youtube_quota`;
    const waits = await tx<{ waiting_on: string; n: number }[]>`
      select waiting_on, count(*)::int as n from public.videos
      where status = 'ready' and waiting_on is not null and waiting_until > ${now} group by waiting_on`;

    const today = rows.filter((r) => r.day === day);
    const buckets = BUCKETS.map((bucket) => {
      const mine = today.filter((r) => r.bucket === bucket);
      const limit = limits[bucket];
      const listed = [...USES[bucket], ...KINDS.filter((k) => !USES[bucket].includes(k) && mine.some((r) => r.kind === k))];
      const kinds = listed.map((kind) => {
        const r = mine.find((x) => x.kind === kind);
        return { kind, units: r?.units ?? 0, calls: r?.calls ?? 0, cap: capFor(bucket, kind, limit), ranOutAt: r?.ran_out_at ?? null };
      });
      return {
        bucket, limit, used: mine.reduce((n, r) => n + r.units, 0), held: heldOf(bucket, limit),
        fullAt: earliest(mine.map((r) => r.full_at)), ranOutAt: earliest(mine.map((r) => r.ran_out_at)), kinds,
      };
    });

    // each day's allowances, used up when YouTube said so or the count reached the limit
    const days = new Map<string, { day: string; bucket: Bucket; units: number; full: boolean }>();
    for (const r of rows) {
      const d = days.get(`${r.day} ${r.bucket}`) ?? { day: r.day, bucket: r.bucket, units: 0, full: false };
      d.units += r.units;
      d.full ||= r.full_at !== null;
      days.set(`${r.day} ${r.bucket}`, d);
    }
    for (const d of days.values()) if (limits[d.bucket] !== null && d.units >= limits[d.bucket]!) d.full = true;

    const waiting = { youtube_quota: 0, plan_cap: 0 };
    for (const w of waits) if (w.waiting_on === "youtube_quota" || w.waiting_on === "plan_cap") waiting[w.waiting_on] = w.n;
    const firstDay = first?.day ?? null;
    return { day, resetsAt: quotaResetsAt(now), limits, buckets, waiting, week: lastWeek([...days.values()], day, firstDay), firstAt: first?.at ?? null, firstDay };
  });
}
