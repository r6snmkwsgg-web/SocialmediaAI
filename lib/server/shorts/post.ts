import "server-only";
import { tiktokChoices, tiktokReason } from "../../shorts/tiktok";
import { seconds } from "../../shorts/timing";
import type { FormatId, Spec } from "../../shorts/types";
import { admin } from "../db";
import { getVideo } from "../storage";
import { TikTokError, tiktokPost } from "../tiktok";
import { YouTubeError, youtubeUpload } from "../youtube";
import { configured } from "../env";

/**
 * Posting what's ready, on plans that post for you. YouTube gets each
 * Short as soon as it's rendered, set to go public at its time; TikTok
 * gets it at its time, since TikTok can't schedule, with the choices the
 * creator made for it. A lock on each video means two posters running at
 * once never post the same one twice.
 */

/** YouTube's category for each format */
const CATEGORY: Record<FormatId, string> = { battle: "24", quiz: "27", wyr: "24", texts: "24", ranking: "27", race: "27" };

async function claim(id: string): Promise<boolean> {
  const rows = await admin((tx) => tx`
    update public.videos set posting_at = now() where id = ${id} and (posting_at is null or posting_at < now() - interval '30 minutes') returning id`);
  return rows.length > 0;
}

export async function postDue(now = new Date(), limit = 10): Promise<string[]> {
  const log: string[] = [];

  // scheduled ones whose time has come are live now
  const flipped = await admin((tx) => tx`
    update public.videos set status = 'posted', posted_at = scheduled_for where status = 'scheduled' and scheduled_for <= ${now} returning id`);
  if (flipped.length) log.push(`${flipped.length} went public`);

  const youtube = await admin((tx) => tx<{ id: string; title: string; description: string; format: FormatId; file_path: string; scheduled_for: Date; channel_id: string }[]>`
    select v.id, v.title, v.description, v.format, v.file_path, v.scheduled_for, c.id as channel_id
    from public.videos v
    join public.subscriptions s on s.user_id = v.user_id and s.plan in ('pro', 'creator')
    join lateral (select id from public.channels where user_id = v.user_id and platform = 'youtube' and status = 'connected' order by connected_at limit 1) c on true
    where v.status = 'ready' and v.youtube_id is null and v.file_path is not null and v.scheduled_for is not null
    order by v.scheduled_for limit ${limit}`);
  for (const v of youtube) {
    if (!(await claim(v.id))) continue;
    try {
      const bytes = await getVideo(v.file_path);
      const soon = v.scheduled_for.getTime() <= now.getTime() + 15 * 60_000;
      const ytId = await youtubeUpload(v.channel_id, bytes, { title: v.title, description: v.description, publishAt: soon ? null : v.scheduled_for, categoryId: CATEGORY[v.format] });
      await admin((tx) => tx`
        update public.videos set youtube_id = ${ytId}, status = ${soon ? "posted" : "scheduled"}, posted_at = ${soon ? now : null}, error = null, posting_at = null
        where id = ${v.id}`);
      log.push(`${v.id} → YouTube ${ytId}${soon ? "" : `, public at ${v.scheduled_for.toISOString()}`}`);
    } catch (err) {
      const e = err instanceof YouTubeError ? err : null;
      const msg = err instanceof Error ? err.message : String(err);
      // quota and outages pass: leave it ready and try next time; anything else needs a person
      await admin((tx) => tx`
        update public.videos set error = ${msg}, status = ${e && !e.retry && e.status !== 401 ? "failed" : "ready"}, posting_at = null where id = ${v.id}`);
      log.push(`${v.id} failed: ${msg}`);
    }
  }

  if (configured().tiktokDirect) {
    const tiktok = await admin((tx) => tx<{ id: string; title: string; description: string; format: FormatId; params: Spec["params"]; file_path: string; tiktok_post: unknown; status: string; channel_id: string; youtube: boolean }[]>`
      select v.id, v.title, v.description, v.format, v.params, v.file_path, v.tiktok_post, v.status, c.id as channel_id,
        exists (select 1 from public.channels y where y.user_id = v.user_id and y.platform = 'youtube' and y.status = 'connected') as youtube
      from public.videos v
      join public.subscriptions s on s.user_id = v.user_id and s.plan in ('pro', 'creator')
      join lateral (select id from public.channels where user_id = v.user_id and platform = 'tiktok' and status = 'connected' order by connected_at limit 1) c on true
      where v.status in ('ready', 'scheduled', 'posted') and v.file_path is not null
        and v.tiktok_post is not null and v.tiktok_publish_id is null and v.tiktok_error is null
        and v.tiktok_at <= ${now} and v.tiktok_at > ${new Date(now.getTime() - 86400_000)}
      order by v.tiktok_at limit ${limit}`);
    for (const v of tiktok) {
      if (!(await claim(v.id))) continue;
      try {
        const choices = tiktokChoices.safeParse(v.tiktok_post);
        if (!choices.success) throw new TikTokError("The TikTok choices for this Short need making again.", 400, "choices");
        const length = seconds({ format: v.format, params: v.params } as Spec);
        const id = await tiktokPost(v.channel_id, await getVideo(v.file_path), `${v.title}\n\n${v.description}`, choices.data, length);
        // with no YouTube to post it to, TikTok is where it's posted
        const done = !v.youtube && v.status === "ready";
        await admin((tx) => tx`
          update public.videos set tiktok_publish_id = ${id}, tiktok_error = null, posting_at = null,
            status = case when ${done} then 'posted' else status end, posted_at = case when ${done} then ${now} else posted_at end
          where id = ${v.id}`);
        log.push(`${v.id} → TikTok ${id}`);
      } catch (err) {
        const e = err instanceof TikTokError ? err : null;
        const msg = e ? tiktokReason(e.code, e.message) : err instanceof Error ? err.message : String(err);
        // TikTok said no: it waits for the creator. Anything passing (an outage, a limit, the
        // network) keeps its lock, so it's tried again in half an hour, for up to a day.
        if (e && !e.retry) await admin((tx) => tx`update public.videos set tiktok_error = ${msg}, posting_at = null where id = ${v.id}`);
        log.push(`${v.id} TikTok failed: ${msg}`);
      }
    }
  }
  return log;
}
