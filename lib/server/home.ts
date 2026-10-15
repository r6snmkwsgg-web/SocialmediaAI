import "server-only";
import { asUser } from "./db";

/**
 * Everything Home shows, in one trip to the database, all as the signed-in
 * account: where they are in setting up, and what happened this week.
 */

export type HomeData = {
  youtube: boolean;
  swiped: boolean;
  posted: boolean;
  liveSetUp: boolean;
  wentLive: boolean;
  goal: boolean;
  inReview: number;
  week: { posted: number; views: number | null; lives: number; rounds: number; coins: number };
  next: { title: string; at: Date } | null;
};

export async function homeData(userId: string): Promise<HomeData> {
  return asUser(userId, async (tx) => {
    const [r] = await tx<{
      youtube: boolean; swiped: boolean; posted: boolean; live_set_up: boolean; went_live: boolean; goal: boolean;
      in_review: number; posted_week: number; views_week: string | null; lives_week: number; rounds_week: number; coins_week: number;
    }[]>`
      select
        exists (select 1 from public.channels where platform = 'youtube' and status = 'connected') as youtube,
        exists (select 1 from public.videos where decided_at is not null) as swiped,
        exists (select 1 from public.videos where status = 'posted') as posted,
        (exists (select 1 from public.live_settings) or exists (select 1 from public.overlay_keys)) as live_set_up,
        exists (select 1 from public.live_sessions) as went_live,
        exists (select 1 from public.goals) as goal,
        (select count(*) from public.videos where status = 'review')::int as in_review,
        (select count(*) from public.videos where status = 'posted' and posted_at > now() - interval '7 days')::int as posted_week,
        (select sum(s.views) from public.videos v
           join lateral (select views from public.video_stats where video_id = v.id order by fetched_at desc limit 1) s on true
           where v.status = 'posted' and v.posted_at > now() - interval '7 days') as views_week,
        (select count(*) from public.live_sessions where started_at > now() - interval '7 days')::int as lives_week,
        (select coalesce(sum(rounds), 0) from public.live_sessions where started_at > now() - interval '7 days')::int as rounds_week,
        (select coalesce(sum(coins), 0) from public.live_sessions where started_at > now() - interval '7 days')::int as coins_week`;
    const next = await tx<{ title: string; scheduled_for: Date }[]>`
      select title, scheduled_for from public.videos where status = 'scheduled' and scheduled_for > now() order by scheduled_for limit 1`;
    return {
      youtube: r.youtube,
      swiped: r.swiped,
      posted: r.posted,
      liveSetUp: r.live_set_up,
      wentLive: r.went_live,
      goal: r.goal,
      inReview: r.in_review,
      week: { posted: r.posted_week, views: r.views_week === null ? null : Number(r.views_week), lives: r.lives_week, rounds: r.rounds_week, coins: r.coins_week },
      next: next[0] ? { title: next[0].title, at: next[0].scheduled_for } : null,
    };
  });
}
