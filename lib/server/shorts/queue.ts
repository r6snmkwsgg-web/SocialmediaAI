import "server-only";
import type { Plan } from "../../billing/plans";
import { nextSlots, STARTING_HOURS, validTimezone } from "../../shorts/times";
import type { TikTokChoices } from "../../shorts/tiktok";
import type { FormatId, Spec } from "../../shorts/types";
import { admin, asUser } from "../db";

/**
 * The Shorts queue as one account sees it: what's waiting for a yes or
 * no, what's on its way (rendering, ready, scheduled), and what's posted
 * with its views so far.
 */

export type Waiting = { id: string; spec: Spec; key: string; title: string; description: string; why: string[]; suggestedFor: Date | null; origin: string };

export type Coming = {
  id: string;
  spec: Spec;
  title: string;
  description: string;
  status: "approved" | "rendering" | "ready" | "scheduled" | "failed";
  scheduledFor: Date | null;
  progress: number | null;
  error: string | null;
  youtubeId: string | null;
  tiktokId: string | null;
  /** going to TikTok directly: when, and why it didn't if TikTok turned it down */
  tiktok: { at: Date | null; error: string | null } | null;
  hasFile: boolean;
};

export type Posted = { id: string; title: string; format: FormatId; postedAt: Date | null; youtubeId: string | null; views: Partial<Record<"1h" | "24h" | "72h", number>> };

export async function queueOf(userId: string): Promise<{ waiting: Waiting[]; coming: Coming[]; posted: Posted[] }> {
  return asUser(userId, async (tx) => {
    const waiting = await tx<{ id: string; format: FormatId; params: Spec["params"]; key: string; title: string; description: string; why: string[]; suggested_for: Date | null; origin: string }[]>`
      select id, format, params, key, title, description, why, suggested_for, origin from public.videos
      where status = 'review' order by suggested_for nulls last, created_at`;
    const coming = await tx<{ id: string; format: FormatId; params: Spec["params"]; title: string; description: string; status: Coming["status"]; scheduled_for: Date | null; progress: number | null; job: string | null; error: string | null; youtube_id: string | null; tiktok_publish_id: string | null; tiktok_chosen: boolean; tiktok_at: Date | null; tiktok_error: string | null; file_path: string | null }[]>`
      select v.id, v.format, v.params, v.title, v.description, v.status, v.scheduled_for, v.error, v.youtube_id, v.tiktok_publish_id, v.file_path,
        v.tiktok_post is not null as tiktok_chosen, v.tiktok_at, v.tiktok_error,
        j.progress, j.status as job
      from public.videos v
      left join lateral (select progress, status from public.render_jobs where video_id = v.id order by id desc limit 1) j on true
      where v.status in ('approved', 'rendering', 'ready', 'scheduled', 'failed') and v.decided_at > now() - interval '30 days'
      order by v.scheduled_for nulls last, v.decided_at`;
    const posted = await tx<{ id: string; title: string; format: FormatId; posted_at: Date | null; youtube_id: string | null; stats: { checkpoint: "1h" | "24h" | "72h"; views: string }[] | null }[]>`
      select v.id, v.title, v.format, v.posted_at, v.youtube_id,
        (select json_agg(json_build_object('checkpoint', s.checkpoint, 'views', s.views)) from public.video_stats s where s.video_id = v.id) as stats
      from public.videos v where v.status = 'posted' order by v.posted_at desc nulls last limit 30`;
    return {
      waiting: waiting.map((r) => ({ id: r.id, spec: { format: r.format, params: r.params } as Spec, key: r.key, title: r.title, description: r.description, why: r.why, suggestedFor: r.suggested_for, origin: r.origin })),
      coming: coming.map((r) => ({
        id: r.id,
        spec: { format: r.format, params: r.params } as Spec,
        title: r.title,
        description: r.description,
        status: r.status,
        scheduledFor: r.scheduled_for,
        progress: r.job === "running" || r.job === "queued" ? (r.progress ?? 0) : null,
        error: r.error,
        youtubeId: r.youtube_id,
        tiktokId: r.tiktok_publish_id,
        tiktok: r.tiktok_chosen ? { at: r.tiktok_at, error: r.tiktok_error } : null,
        hasFile: !!r.file_path,
      })),
      posted: posted.map((r) => ({
        id: r.id,
        title: r.title,
        format: r.format,
        postedAt: r.posted_at,
        youtubeId: r.youtube_id,
        views: Object.fromEntries((r.stats ?? []).map((s) => [s.checkpoint, Number(s.views)])),
      })),
    };
  });
}

/**
 * A yes: it goes in the render queue, ahead of free accounts on the paid
 * plans. On a plan that posts for you, it keeps its suggested time (or
 * the next free one if that's passed), and goes to TikTok then too if
 * the creator made their TikTok choices for it.
 */
export async function approve(userId: string, id: string, plan: Plan, now = new Date(), tiktok: TikTokChoices | null = null): Promise<boolean> {
  const done = await asUser(userId, async (tx) => {
    const [v] = await tx<{ suggested_for: Date | null; timezone: string }[]>`
      select v.suggested_for, p.timezone from public.videos v join public.profiles p on p.id = v.user_id where v.id = ${id} and v.status = 'review'`;
    if (!v) return false;
    let at: Date | null = null;
    if (plan.scheduling) {
      at = v.suggested_for && v.suggested_for.getTime() > now.getTime() + 15 * 60_000 ? v.suggested_for : null;
      if (!at) {
        const taken = await tx<{ t: Date }[]>`select coalesce(scheduled_for, suggested_for) as t from public.videos where status in ('approved', 'rendering', 'ready', 'scheduled') and coalesce(scheduled_for, suggested_for) is not null`;
        at = nextSlots(1, now, validTimezone(v.timezone), STARTING_HOURS, taken.map((r) => r.t))[0] ?? null;
      }
    }
    const post = plan.scheduling && tiktok ? tiktok : null;
    await tx`
      update public.videos set status = 'approved', decided_at = now(), scheduled_for = ${at}, error = null,
        tiktok_post = ${post ? tx.json(post) : null}, tiktok_at = ${post ? at : null}, tiktok_error = null
      where id = ${id}`;
    return true;
  });
  if (done) await admin((tx) => tx`insert into public.render_jobs (video_id, priority) values (${id}, ${plan.priority}) on conflict do nothing`);
  return done;
}

/**
 * TikTok choices made later: for a Short approved before TikTok was
 * connected, or one TikTok turned down. It goes at its time, or now if
 * that's passed.
 */
export async function chooseTikTok(userId: string, id: string, choices: TikTokChoices, now = new Date()): Promise<boolean> {
  const rows = await asUser(userId, (tx) => tx`
    update public.videos set tiktok_post = ${tx.json(choices)}, tiktok_error = null,
      tiktok_at = greatest(coalesce(scheduled_for, ${now}), ${now})
    where id = ${id} and status in ('approved', 'rendering', 'ready', 'scheduled', 'posted') and tiktok_publish_id is null
    returning id`);
  return rows.length > 0;
}

export async function reject(userId: string, id: string): Promise<boolean> {
  const rows = await asUser(userId, (tx) => tx`update public.videos set status = 'rejected', decided_at = now() where id = ${id} and status = 'review' returning id`);
  return rows.length > 0;
}

export async function retitle(userId: string, id: string, title: string, description: string): Promise<void> {
  await asUser(userId, (tx) => tx`update public.videos set title = ${title}, description = ${description} where id = ${id} and status in ('review', 'approved', 'rendering', 'ready')`);
}

/** For a Short someone posted themselves: optionally with the YouTube link, so its views are tracked. */
export async function markPosted(userId: string, id: string, youtubeId: string | null): Promise<void> {
  await asUser(userId, (tx) => tx`
    update public.videos set status = 'posted', posted_at = now(), youtube_id = coalesce(${youtubeId}, youtube_id)
    where id = ${id} and status in ('ready', 'scheduled')`);
}

/** Try a failed one again. */
export async function retry(userId: string, id: string, plan: Plan): Promise<void> {
  const [v] = await asUser(userId, (tx) => tx<{ file_path: string | null }[]>`
    update public.videos set status = case when file_path is null then 'approved' else 'ready' end, error = null
    where id = ${id} and status = 'failed' returning file_path`);
  if (v && !v.file_path) await admin((tx) => tx`insert into public.render_jobs (video_id, priority) values (${id}, ${plan.priority}) on conflict do nothing`);
}

/** The video file's key in storage, if it's theirs and rendered. */
export async function fileOf(userId: string, id: string): Promise<{ key: string; title: string } | null> {
  const [v] = await asUser(userId, (tx) => tx<{ file_path: string | null; title: string }[]>`select file_path, title from public.videos where id = ${id}`);
  return v?.file_path ? { key: v.file_path, title: v.title } : null;
}
