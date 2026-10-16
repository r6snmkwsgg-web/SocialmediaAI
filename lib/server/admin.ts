import "server-only";
import { monthlyRevenue, type Interval, type PlanId } from "../billing/plans";
import { admin } from "./db";
import { workerStatus, type WorkerStatus } from "./worker";

/**
 * The view from the top, for whoever runs Hookline: accounts, plans and
 * what they bring in, the last day's activity, the render queue and its
 * workers, and what's going wrong. Read as the server; only /admin shows it.
 */

export type Overview = {
  accounts: number;
  newWeek: number;
  onboarded: number;
  paying: { pro: number; creator: number };
  revenue: number;
  connected: { youtube: number; tiktok: number; lost: number };
  /** LIVE coins are gift coins seen on streamers' own verified LIVEs; `unverified` are the rest, apart */
  day: { made: number; approved: number; posted: number; lives: number; verifiedLives: number; coins: number; unverified: number };
  queue: { queued: number; running: number; failedDay: number; oldest: Date | null };
  workers: WorkerStatus;
  signups: Map<string, number>;
  newest: { email: string; at: Date; goal: string | null; onboarded: boolean; plan: PlanId }[];
  problems: { id: string; email: string; title: string; error: string; at: Date }[];
};

export async function overview(): Promise<Overview> {
  const workers = await workerStatus();
  return admin(async (tx) => {
    const [a] = await tx<{
      accounts: number; new_week: number; onboarded: number; youtube: number; tiktok: number; lost: number;
      made: number; approved: number; posted: number; lives: number; verified_lives: number; coins: string; unverified: string; queued: number; running: number; failed: number; oldest: Date | null;
    }[]>`
      select
        (select count(*) from auth.users)::int as accounts,
        (select count(*) from auth.users where created_at > now() - interval '7 days')::int as new_week,
        (select count(*) from public.profiles where onboarded_at is not null)::int as onboarded,
        (select count(*) from public.channels where platform = 'youtube' and status = 'connected')::int as youtube,
        (select count(*) from public.channels where platform = 'tiktok' and status = 'connected')::int as tiktok,
        (select count(*) from public.channels where status <> 'connected')::int as lost,
        (select count(*) from public.videos where created_at > now() - interval '24 hours')::int as made,
        (select count(*) from public.videos where decided_at > now() - interval '24 hours' and status not in ('review', 'rejected'))::int as approved,
        (select count(*) from public.videos where posted_at > now() - interval '24 hours')::int as posted,
        (select count(*) from public.live_sessions where started_at > now() - interval '24 hours')::int as lives,
        (select count(*) from public.live_sessions where started_at > now() - interval '24 hours' and verified)::int as verified_lives,
        (select coalesce(sum(coins), 0) from public.live_sessions where started_at > now() - interval '24 hours' and verified) as coins,
        (select coalesce(sum(coins), 0) from public.live_sessions where started_at > now() - interval '24 hours' and not verified) as unverified,
        (select count(*) from public.render_jobs where status = 'queued')::int as queued,
        (select count(*) from public.render_jobs where status = 'running')::int as running,
        (select count(*) from public.render_jobs where status = 'failed' and finished_at > now() - interval '24 hours')::int as failed,
        (select min(created_at) from public.render_jobs where status = 'queued') as oldest`;
    const subs = await tx<{ plan: PlanId; interval: Interval | null; status: string }[]>`select plan, "interval", status from public.subscriptions where plan <> 'free'`;
    const signups = await tx<{ day: string; n: number }[]>`
      select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as n
      from auth.users where created_at > now() - interval '30 days' group by 1`;
    const newest = await tx<{ email: string; created_at: Date; goal: string | null; onboarded_at: Date | null; plan: PlanId | null }[]>`
      select u.email, u.created_at, p.goal, p.onboarded_at, s.plan
      from auth.users u left join public.profiles p on p.id = u.id left join public.subscriptions s on s.user_id = u.id
      order by u.created_at desc limit 10`;
    const problems = await tx<{ id: string; email: string; title: string; error: string; at: Date }[]>`
      select v.id, u.email, v.title, coalesce(v.tiktok_error, v.error) as error, coalesce(v.decided_at, v.created_at) as at
      from public.videos v join auth.users u on u.id = v.user_id
      where v.error is not null or v.tiktok_error is not null
      order by coalesce(v.decided_at, v.created_at) desc limit 10`;
    const live = subs.filter((s) => s.status === "active" || s.status === "past_due");
    return {
      accounts: a.accounts,
      newWeek: a.new_week,
      onboarded: a.onboarded,
      paying: { pro: live.filter((s) => s.plan === "pro").length, creator: live.filter((s) => s.plan === "creator").length },
      revenue: monthlyRevenue(subs),
      connected: { youtube: a.youtube, tiktok: a.tiktok, lost: a.lost },
      day: { made: a.made, approved: a.approved, posted: a.posted, lives: a.lives, verifiedLives: a.verified_lives, coins: Number(a.coins), unverified: Number(a.unverified) },
      queue: { queued: a.queued, running: a.running, failedDay: a.failed, oldest: a.oldest },
      workers,
      signups: new Map(signups.map((r) => [r.day, r.n])),
      newest: newest.map((r) => ({ email: r.email, at: r.created_at, goal: r.goal, onboarded: r.onboarded_at !== null, plan: r.plan ?? "free" })),
      problems,
    };
  });
}
