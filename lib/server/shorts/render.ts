import "server-only";
import type { Spec } from "../../shorts/types";
import type { PlanId } from "../../billing/plans";
import { PLANS } from "../../billing/plans";
import { commentsAllowed } from "../../shorts/youtube";
import { admin, type Tx } from "../db";
import { youtubeApi } from "../env";
import { notify } from "../notify";

/**
 * The render queue as the worker sees it: take the next job (paid plans
 * first, then oldest), report progress, and finish or fail it. A job
 * whose worker died is picked up again after a while; three tries and it
 * gives up and says why.
 *
 * TikTok doesn't allow app watermarks on what's shared to it, so a Short
 * with the free plan's tag also gets a copy without it when its owner has
 * TikTok connected, and every TikTok route posts that copy. One made
 * before TikTok was connected gets its copy from a job of its own.
 */

export type Job = {
  id: number;
  videoId: string;
  userId: string;
  spec: Spec;
  tag: boolean;
  attempts: number;
  /** only the copy without the tag, for TikTok */
  clean: boolean;
  /** the tagged video, and then the copy without the tag too */
  alsoClean: boolean;
};

export async function claimJob(): Promise<Job | null> {
  return admin(async (tx) => {
    const [j] = await tx<{ id: number; video_id: string; attempts: number; clean: boolean }[]>`
      update public.render_jobs set status = 'running', locked_at = now(), attempts = attempts + 1, progress = 0
      where id = (
        select id from public.render_jobs
        where (status = 'queued') or (status = 'running' and locked_at < now() - interval '15 minutes')
        order by priority desc, created_at
        for update skip locked
        limit 1
      )
      returning id, video_id, attempts, clean`;
    if (!j) return null;
    const [v] = await tx<{ user_id: string; format: Spec["format"]; params: Spec["params"]; plan: PlanId | null; tiktok: boolean }[]>`
      select v.user_id, v.format, v.params, s.plan,
        exists (select 1 from public.channels c where c.user_id = v.user_id and c.platform = 'tiktok' and c.status = 'connected') as tiktok
      from public.videos v left join public.subscriptions s on s.user_id = v.user_id where v.id = ${j.video_id}`;
    if (!j.clean) await tx`update public.videos set status = 'rendering' where id = ${j.video_id} and status = 'approved'`;
    const tag = !j.clean && PLANS[v.plan ?? "free"].tag;
    return { id: j.id, videoId: j.video_id, userId: v.user_id, spec: { format: v.format, params: v.params } as Spec, tag, attempts: j.attempts, clean: j.clean, alsoClean: tag && v.tiktok };
  });
}

export async function jobProgress(id: number, progress: number): Promise<void> {
  await admin((tx) => tx`update public.render_jobs set progress = ${progress}, locked_at = now() where id = ${id}`);
}

/**
 * A finished render. `cleanPath` is the copy without the tag, when the
 * worker made one; a video made without the tag is its own clean copy.
 * One whose audience changed while it was being made (its ending asks
 * for comments, or doesn't, and that's no longer right) is made again.
 */
export async function finishJob(job: Job, filePath: string, cleanPath: string | null = null): Promise<void> {
  const { audited, test } = youtubeApi();
  // the ending this render has, which must still be the one the Short needs
  const ending = (tx: Tx) => tx`(params -> 'allowComments' is distinct from 'false'::jsonb) = ${commentsAllowed(job.spec)}`;
  await admin(async (tx) => {
    const [done] = await tx<{ priority: number }[]>`
      update public.render_jobs set status = 'done', progress = 1, finished_at = now() where id = ${job.id} returning priority`;
    if (job.clean) {
      await tx`update public.videos set clean_path = ${filePath} where id = ${job.videoId} and ${ending(tx)}`;
      return;
    }
    const clean = cleanPath ?? (job.tag ? null : filePath);
    const [v] = await tx<{ title: string; youtube_api: boolean; youtube_answered: boolean; youtube: boolean; tiktok: boolean }[]>`
      update public.videos set status = 'ready', file_path = ${filePath}, clean_path = ${clean}, error = null where id = ${job.videoId} and ${ending(tx)}
      returning title,
        scheduled_for is not null and exists (
          select 1 from public.channels c where c.user_id = videos.user_id and c.platform = 'youtube' and c.status = 'connected'
            and (${audited} or c.external_id = any(string_to_array(${test.join(",")}, ',')))) as youtube_api,
        exists (select 1 from public.channels c where c.user_id = videos.user_id and c.platform = 'youtube' and c.status = 'connected' and c.made_for_kids is not null) as youtube_answered,
        exists (select 1 from public.channels c where c.user_id = videos.user_id and c.platform = 'youtube' and c.status = 'connected') as youtube,
        scheduled_for is not null and tiktok_post is not null as tiktok`;
    if (!v) {
      const [again] = await tx`update public.videos set status = 'approved' where id = ${job.videoId} and status = 'rendering' returning id`;
      if (again) await tx`insert into public.render_jobs (video_id, priority) values (${job.videoId}, ${done?.priority ?? 0}) on conflict do nothing`;
      return;
    }
    const href = `/app/shorts/${job.videoId}`;
    // one that posts itself says so when it's up; one waiting on the creator says what for
    if (v.youtube_api && !v.youtube_answered) {
      await notify(job.userId, { kind: "ready", title: "One question before it posts", body: `${v.title}. Say whether your channel is made for kids, in Settings, and it posts.`, href: "/app/settings", key: `ready:${job.videoId}` }, tx);
    } else if (!v.youtube_api && v.youtube) {
      await notify(job.userId, { kind: "ready", title: "Ready for you to post", body: `${v.title}. Download it, upload it to YouTube, then tap I posted it.`, href, key: `ready:${job.videoId}` }, tx);
    } else if (!v.youtube_api && !v.tiktok) {
      await notify(job.userId, { kind: "ready", title: "Ready to download", body: v.title, href, key: `ready:${job.videoId}` }, tx);
    }
  });
}

export async function failJob(job: Job, message: string): Promise<void> {
  const final = job.attempts >= 3;
  await admin(async (tx) => {
    await tx`update public.render_jobs set status = ${final ? "failed" : "queued"}, error = ${message}, finished_at = ${final ? new Date() : null} where id = ${job.id}`;
    if (!final) return;
    if (job.clean) {
      // the Short itself is fine; only TikTok's copy couldn't be made, and asking again tries again
      const [v] = await tx<{ title: string }[]>`select title from public.videos where id = ${job.videoId}`;
      if (v) await notify(job.userId, { kind: "failed", title: "A Short couldn't be made for TikTok", body: `${v.title}. Its copy without the Hookline tag failed three times; try TikTok again from its page.`, href: `/app/shorts/${job.videoId}`, key: `render-failed:${job.id}` }, tx);
      return;
    }
    const [v] = await tx<{ title: string }[]>`update public.videos set status = 'failed', error = ${`Rendering failed: ${message}`} where id = ${job.videoId} returning title`;
    if (v) await notify(job.userId, { kind: "failed", title: "A Short couldn't be made", body: `${v.title}. It failed three times; try it again from its page.`, href: `/app/shorts/${job.videoId}`, key: `render-failed:${job.id}` }, tx);
  });
}

/**
 * The copy without the tag, for TikTok: its key when there is one, or
 * null after asking the worker to make it (once; asking again while it's
 * being made changes nothing).
 */
export async function cleanCopy(videoId: string, priority = 0): Promise<string | null> {
  return admin(async (tx) => {
    const [v] = await tx<{ clean_path: string | null; file_path: string | null }[]>`select clean_path, file_path from public.videos where id = ${videoId}`;
    if (!v) return null;
    if (v.clean_path) return v.clean_path;
    // a render already under way makes the clean copy itself, or this one waits for it
    if (v.file_path) await tx`insert into public.render_jobs (video_id, priority, clean) values (${videoId}, ${priority}, true) on conflict do nothing`;
    return null;
  });
}
