import "server-only";
import type { Spec } from "../../shorts/types";
import type { PlanId } from "../../billing/plans";
import { PLANS } from "../../billing/plans";
import { admin } from "../db";

/**
 * The render queue as the worker sees it: take the next job (paid plans
 * first, then oldest), report progress, and finish or fail it. A job
 * whose worker died is picked up again after a while; three tries and it
 * gives up and says why.
 */

export type Job = { id: number; videoId: string; userId: string; spec: Spec; tag: boolean; attempts: number };

export async function claimJob(): Promise<Job | null> {
  return admin(async (tx) => {
    const [j] = await tx<{ id: number; video_id: string; attempts: number }[]>`
      update public.render_jobs set status = 'running', locked_at = now(), attempts = attempts + 1, progress = 0
      where id = (
        select id from public.render_jobs
        where (status = 'queued') or (status = 'running' and locked_at < now() - interval '15 minutes')
        order by priority desc, created_at
        for update skip locked
        limit 1
      )
      returning id, video_id, attempts`;
    if (!j) return null;
    const [v] = await tx<{ user_id: string; format: Spec["format"]; params: Spec["params"]; plan: PlanId | null }[]>`
      select v.user_id, v.format, v.params, s.plan from public.videos v left join public.subscriptions s on s.user_id = v.user_id where v.id = ${j.video_id}`;
    await tx`update public.videos set status = 'rendering' where id = ${j.video_id} and status = 'approved'`;
    return { id: j.id, videoId: j.video_id, userId: v.user_id, spec: { format: v.format, params: v.params } as Spec, tag: PLANS[v.plan ?? "free"].tag, attempts: j.attempts };
  });
}

export async function jobProgress(id: number, progress: number): Promise<void> {
  await admin((tx) => tx`update public.render_jobs set progress = ${progress}, locked_at = now() where id = ${id}`);
}

export async function finishJob(job: Job, filePath: string): Promise<void> {
  await admin(async (tx) => {
    await tx`update public.render_jobs set status = 'done', progress = 1, finished_at = now() where id = ${job.id}`;
    await tx`update public.videos set status = 'ready', file_path = ${filePath}, error = null where id = ${job.videoId}`;
  });
}

export async function failJob(job: Job, message: string): Promise<void> {
  const final = job.attempts >= 3;
  await admin(async (tx) => {
    await tx`update public.render_jobs set status = ${final ? "failed" : "queued"}, error = ${message}, finished_at = ${final ? new Date() : null} where id = ${job.id}`;
    if (final) await tx`update public.videos set status = 'failed', error = ${`Rendering failed: ${message}`} where id = ${job.videoId}`;
  });
}
