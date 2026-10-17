import "server-only";
import { WEEKS } from "../app/cohorts";
import { admin } from "./db";

/**
 * The typical account, for /admin: each week's sign-ups and how far they
 * got, with the middle account's figures rather than the best one's. It's
 * built only from Hookline's own records of accounts, channels and Shorts,
 * never from anything YouTube reported about a channel, since YouTube's
 * API rules don't allow combining different people's channels. Read as the
 * server; only /admin shows it.
 */

/** One week's sign-ups, or every week's together. */
export type CohortRow = {
  /** the Monday (UTC) of the week they signed up, or null for all the weeks together */
  week: string | null;
  accounts: number;
  /** how many are at least 28 days old: the first-4-weeks figures count only these */
  complete: number;
  /** with a YouTube channel connected now */
  connected: number;
  /** that have said yes to a Short */
  kept: number;
  /** of the 28-day-old ones, those with a Short YouTube confirmed in their first 4 weeks */
  postedAny: number;
  /** their Shorts YouTube confirmed in their first 4 weeks: the middle account's count and the middle half's; null with none 28 days old */
  posted: { low: number; median: number; high: number } | null;
  /** of the 28-day-old ones, those that sent a Short to TikTok in their first 4 weeks */
  tiktok: number;
  /** of the 28-day-old ones, those still saying yes to Shorts in their fourth week */
  week4: number;
};

/**
 * The `weeks` whole weeks (Monday to Sunday, UTC) before the one `now` is
 * in, newest first, after all of them together. Posted counts only Shorts
 * YouTube confirmed, which only the server can mark, and TikTok only what
 * was sent there, not drafts. Each middle figure is one an account really
 * had. One statement, since /admin reads it every half minute.
 */
export async function cohorts(now = new Date(), weeks = WEEKS): Promise<CohortRow[]> {
  const rows = await admin((tx) => tx<{
    week: string | null; accounts: number; complete: number; connected: number; kept: number; posted_any: number; posted_q: number[] | null; tiktok: number; week4: number;
  }[]>`
    with bounds as (
      select date_trunc('week', ${now}::timestamptz at time zone 'UTC') at time zone 'UTC' as monday
    ), people as (
      select u.id, u.created_at, date_trunc('week', u.created_at at time zone 'UTC')::date as week,
        u.created_at <= ${now}::timestamptz - interval '28 days' as complete
      from auth.users u, bounds b
      where u.created_at >= b.monday - make_interval(weeks => ${weeks}) and u.created_at < b.monday
    ), per as (
      select p.week, p.complete, k.kept, k.posted, k.tiktok, k.week4,
        exists (select 1 from public.channels c where c.user_id = p.id and c.platform = 'youtube' and c.status = 'connected') as connected
      from people p
      cross join lateral (
        select count(*) filter (where v.decided_at is not null and v.status not in ('review', 'rejected')) > 0 as kept,
          -- on YouTube with YouTube's word for it, in their first 4 weeks
          count(*) filter (where v.status = 'posted' and v.youtube_verified and v.posted_at < p.created_at + interval '28 days')::int as posted,
          -- only a direct post sets this; sending a Short to TikTok's drafts doesn't
          count(*) filter (where v.tiktok_posted_at < p.created_at + interval '28 days') > 0 as tiktok,
          count(*) filter (where v.status not in ('review', 'rejected')
            and v.decided_at >= p.created_at + interval '21 days' and v.decided_at < p.created_at + interval '28 days') > 0 as week4
        from public.videos v where v.user_id = p.id
      ) k
    )
    select week::text as week, count(*)::int as accounts, count(*) filter (where complete)::int as complete,
      count(*) filter (where connected)::int as connected, count(*) filter (where kept)::int as kept,
      count(*) filter (where complete and posted > 0)::int as posted_any,
      percentile_disc(array[0.25, 0.5, 0.75]) within group (order by posted) filter (where complete) as posted_q,
      count(*) filter (where complete and tiktok)::int as tiktok, count(*) filter (where complete and week4)::int as week4
    from per group by rollup (week) order by week desc nulls first`);
  return rows.map((r) => ({
    week: r.week,
    accounts: r.accounts,
    complete: r.complete,
    connected: r.connected,
    kept: r.kept,
    postedAny: r.posted_any,
    posted: r.posted_q ? { low: r.posted_q[0], median: r.posted_q[1], high: r.posted_q[2] } : null,
    tiktok: r.tiktok,
    week4: r.week4,
  }));
}
