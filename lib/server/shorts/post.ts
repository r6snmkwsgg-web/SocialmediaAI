import "server-only";
import { tiktokCaption, tiktokChoices, tiktokReason } from "../../shorts/tiktok";
import { seconds } from "../../shorts/timing";
import type { FormatId, Spec } from "../../shorts/types";
import { verdictOf, YT_PRIVACY, type AskedAs, type VideoState, type YouTubePrivacy } from "../../shorts/youtube";
import { admin } from "../db";
import { notify } from "../notify";
import { getVideo } from "../storage";
import { TikTokError, tiktokPost } from "../tiktok";
import { quotaResetsAt, YouTubeError, youtubeAccess, youtubeUpload, youtubeVideoStates } from "../youtube";
import { configured, youtubeApi } from "../env";
import { cleanCopy } from "./render";

/**
 * Posting what's ready, on plans that post for you. YouTube gets each
 * Short as soon as it's rendered (public ones set to go public at their
 * time, the rest at their time), on the channel it was made for and no
 * other, but only where Hookline may upload: every channel once YouTube's
 * audit has passed, the test channels before it. Everyone else posts
 * their own and Hookline checks the link. A Short with no channel never
 * uploads. A Short only counts as posted once YouTube says so. TikTok
 * gets it at its time on the account's one TikTok, since TikTok can't
 * schedule, with the choices the creator made for it and without the
 * free plan's tag. A lock on each video means two posters running at
 * once never post the same one twice. When YouTube's daily upload quota
 * runs out, the Shorts in line say they're waiting for it and are tried
 * again once it resets, not every minute.
 */

/** YouTube's category for each format */
const CATEGORY: Record<FormatId, string> = { battle: "24", quiz: "27", wyr: "24", texts: "24", ranking: "27", race: "27" };

const privacyOf = (p: string): YouTubePrivacy => ((YT_PRIVACY as readonly string[]).includes(p) ? (p as YouTubePrivacy) : "public");

async function claim(id: string): Promise<boolean> {
  const rows = await admin((tx) => tx`
    update public.videos set posting_at = now() where id = ${id} and (posting_at is null or posting_at < now() - interval '30 minutes') returning id`);
  return rows.length > 0;
}

const UP: Record<YouTubePrivacy, string> = { public: "Live on YouTube", unlisted: "Up on YouTube, unlisted", private: "Up on YouTube, private" };

/**
 * Asks YouTube how each uploaded Short is doing once its time has come
 * (1 quota unit for up to 50), and only then calls it posted. One YouTube
 * rejected, couldn't process or kept private is marked failed with what
 * YouTube said, and never counted. Each is asked as the channel it went
 * to, which sees its private videos too. When that channel isn't
 * connected any more, the API key asks (it sees public and unlisted ones),
 * and one it can't find is marked failed as unchecked, with how to fix it,
 * rather than called deleted or left checking forever.
 */
export async function confirmYouTube(now = new Date()): Promise<string[]> {
  const { audited } = youtubeApi();
  type Due = {
    id: string; user_id: string; title: string; youtube_id: string; scheduled_for: Date; uploaded_at: Date | null;
    uploader: string | null; fallback: string | null; lost: boolean; privacy: string;
  };
  const due = await admin((tx) => tx<Due[]>`
    select v.id, v.user_id, v.title, v.youtube_id, v.scheduled_for, v.uploaded_at,
      case when c.status = 'connected' then c.id end as uploader, f.id as fallback, c.id is not null and c.status <> 'connected' as lost,
      coalesce(v.youtube_wanted, c.privacy, f.privacy, 'public') as privacy
    from public.videos v
    left join public.channels c on c.id = v.channel_id
    -- which channel it went to isn't known: their first connected one, which posting used
    left join lateral (
      select id, privacy from public.channels
      where v.channel_id is null and user_id = v.user_id and platform = 'youtube' and status = 'connected'
      order by connected_at limit 1
    ) f on true
    where v.status = 'scheduled' and v.youtube_id is not null and v.scheduled_for <= ${now}
      and (v.youtube_checked_at is null or v.youtube_checked_at < ${new Date(now.getTime() - 4 * 60_000)})
    order by v.scheduled_for limit 200`);
  const log: string[] = [];
  // asked together: each channel's own, and the rest with the API key
  const groups = new Map<string, Due[]>();
  for (const v of due) {
    const by = v.uploader ?? v.fallback ?? "key";
    groups.set(by, [...(groups.get(by) ?? []), v]);
  }
  for (const [by, videos] of groups) {
    let states = new Map<string, VideoState>();
    try {
      const ids = videos.map((v) => v.youtube_id);
      if (by !== "key") states = await youtubeVideoStates(ids, await youtubeAccess(by));
      else if (configured().youtubeTrends) states = await youtubeVideoStates(ids);
    } catch (err) {
      log.push(`checking ${videos.length} as ${by} failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const v of videos) {
      const s = states.get(v.youtube_id) ?? null;
      const asked: AskedAs = v.uploader ? "uploader" : v.lost || !v.fallback ? "lost" : "elsewhere";
      const verdict = verdictOf(s, { wanted: privacyOf(v.privacy), due: v.scheduled_for, uploadedAt: v.uploaded_at ?? v.scheduled_for, now, audited, asked });
      const seen = { status: s?.uploadStatus ?? "missing", privacy: s?.privacy ?? null, kids: s?.madeForKids ?? null };
      const href = `/app/shorts/${v.id}`;
      if (verdict.kind === "wait") {
        await admin((tx) => tx`
          update public.videos set youtube_checked_at = ${now}, youtube_status = ${s ? seen.status : tx`youtube_status`},
            youtube_privacy = ${s ? seen.privacy : tx`youtube_privacy`}, youtube_kids = ${s ? seen.kids : tx`youtube_kids`}
          where id = ${v.id}`);
        continue;
      }
      if (verdict.kind === "posted") {
        // public from its publish time when it went up private until then, and from its upload otherwise
        const [up] = await admin((tx) => tx`
          update public.videos set status = 'posted', posted_at = least(${now}::timestamptz, coalesce(youtube_publish_at, uploaded_at, scheduled_for)),
            youtube_checked_at = ${now}, youtube_status = ${seen.status}, youtube_privacy = ${verdict.privacy}, youtube_kids = ${seen.kids}, error = null
          where id = ${v.id} and status = 'scheduled' returning id`);
        if (!up) continue;
        const kids = seen.kids ? " YouTube marked it Made for Kids: comments are off." : "";
        await notify(v.user_id, { kind: "posted", title: UP[verdict.privacy], body: `${v.title}.${kids}`, href, key: `youtube:${v.id}` });
        log.push(`${v.id} is ${verdict.privacy} on YouTube`);
        continue;
      }
      if (verdict.kind === "unchecked") {
        // nothing is known about it, so what YouTube last said stays, and trying again checks again
        const [down] = await admin((tx) => tx`
          update public.videos set status = 'failed', error = ${verdict.message}, youtube_checked_at = ${now},
            youtube_status = coalesce(youtube_status, 'uploaded')
          where id = ${v.id} and status = 'scheduled' returning id`);
        if (!down) continue;
        await notify(v.user_id, { kind: "failed", title: "Couldn't check a Short on YouTube", body: `${v.title}: ${verdict.message}`, href, key: `youtube-unchecked:${v.id}` });
        log.push(`${v.id} couldn't be checked on YouTube`);
        continue;
      }
      const [down] = await admin((tx) => tx`
        update public.videos set status = 'failed', error = ${verdict.message},
          youtube_checked_at = ${now}, youtube_status = ${seen.status}, youtube_privacy = ${seen.privacy}, youtube_kids = ${seen.kids}
        where id = ${v.id} and status = 'scheduled' returning id`);
      if (!down) continue;
      await notify(v.user_id, {
        kind: "failed",
        title: verdict.kind === "private" ? "YouTube kept a Short private" : "YouTube didn't take a Short",
        body: `${v.title}: ${verdict.message}`,
        href,
        key: `youtube-${verdict.kind}:${v.id}`,
      });
      log.push(`${v.id} ${verdict.kind} on YouTube: ${verdict.message}`);
    }
  }
  return log;
}

export async function postDue(now = new Date(), limit = 10): Promise<string[]> {
  const log: string[] = await confirmYouTube(now);
  const { audited, test } = youtubeApi();

  // each to the channel it was made for, while that's connected, only where Hookline may upload, and only once the
  // creator has said who the channel is for. Its owner's own channel: the key on videos keeps it so, and so does this join
  const youtube = await admin((tx) => tx<{
    id: string; user_id: string; title: string; description: string; format: FormatId; file_path: string; scheduled_for: Date;
    channel_id: string; privacy: string; kids: boolean;
  }[]>`
    select v.id, v.user_id, v.title, v.description, v.format, v.file_path, v.scheduled_for, c.id as channel_id, c.privacy,
      coalesce(v.made_for_kids, c.made_for_kids) as kids
    from public.videos v
    join public.subscriptions s on s.user_id = v.user_id and s.plan in ('pro', 'creator')
    join public.channels c on c.id = v.channel_id and c.user_id = v.user_id and c.platform = 'youtube' and c.status = 'connected'
    where v.status = 'ready' and v.youtube_id is null and v.file_path is not null and v.scheduled_for is not null
      and c.made_for_kids is not null
      and (${audited} or c.external_id = any(string_to_array(${test.join(",")}, ',')))
      -- YouTube can only schedule public ones, so unlisted and private ones go up at their time
      and (c.privacy = 'public' or v.scheduled_for <= ${new Date(now.getTime() + 15 * 60_000)})
      and (v.waiting_until is null or v.waiting_until <= ${now})
    order by v.scheduled_for limit ${limit}`);
  for (const [i, v] of youtube.entries()) {
    if (!(await claim(v.id))) continue;
    try {
      const bytes = await getVideo(v.file_path);
      const soon = v.scheduled_for.getTime() <= now.getTime() + 15 * 60_000;
      const privacy = privacyOf(v.privacy);
      // only public ones can be scheduled: they go up private until their time
      const publishAt = privacy === "public" && !soon ? v.scheduled_for : null;
      const ytId = await youtubeUpload(v.channel_id, bytes, {
        title: v.title,
        description: v.description,
        publishAt,
        categoryId: CATEGORY[v.format],
        privacy,
        madeForKids: v.kids,
      });
      // up, not posted: it counts once YouTube says it's processed and can be seen
      await admin((tx) => tx`
        update public.videos set youtube_id = ${ytId}, youtube_verified = true, status = 'scheduled',
          youtube_status = 'uploaded', youtube_privacy = null, youtube_kids = null, youtube_checked_at = null,
          youtube_wanted = ${privacy}, youtube_publish_at = ${publishAt},
          posted_at = null, uploaded_at = ${now}, error = null, posting_at = null,
          waiting_on = null, waiting_until = null
        where id = ${v.id}`);
      log.push(`${v.id} → YouTube ${ytId}${publishAt ? `, public at ${publishAt.toISOString()}` : ""}`);
    } catch (err) {
      const e = err instanceof YouTubeError ? err : null;
      const msg = err instanceof Error ? err.message : String(err);
      if (e?.quota) {
        // the quota is the whole app's, so the rest of this run would fail too: they all wait for the reset, and say so
        const until = quotaResetsAt(now);
        const rest = youtube.slice(i).map((x) => x.id);
        await admin((tx) => tx`
          update public.videos set waiting_on = 'youtube_quota', waiting_until = ${until}, error = null,
            posting_at = case when id = ${v.id} then null else posting_at end
          where id in ${tx(rest)} and status = 'ready' and youtube_id is null`);
        log.push(`YouTube upload quota used up: ${rest.length} waiting until ${until.toISOString()}`);
        break;
      }
      // outages pass: leave it ready and try next time; anything else needs a person. Either way it's
      // no longer the quota it's waiting for, so it stops saying so
      const failed = !!e && !e.retry && e.status !== 401;
      await admin((tx) => tx`
        update public.videos set error = ${msg}, status = ${failed ? "failed" : "ready"}, posting_at = null, waiting_on = null, waiting_until = null where id = ${v.id}`);
      if (failed) await notify(v.user_id, { kind: "failed", title: "YouTube didn't take a Short", body: `${v.title}: ${msg}`, href: `/app/shorts/${v.id}`, key: `youtube-failed:${v.id}:${now.getTime()}` });
      log.push(`${v.id} failed: ${msg}`);
    }
  }

  if (configured().tiktokDirect) {
    const tiktok = await admin((tx) => tx<{
      id: string; user_id: string; title: string; description: string; format: FormatId; params: Spec["params"]; clean_path: string | null; tiktok_post: unknown; status: string;
      channel_id: string; youtube: boolean; priority: number;
    }[]>`
      select v.id, v.user_id, v.title, v.description, v.format, v.params, v.clean_path, v.tiktok_post, v.status, c.id as channel_id,
        v.channel_id is not null as youtube,
        case s.plan when 'creator' then 2 else 1 end as priority
      from public.videos v
      join public.subscriptions s on s.user_id = v.user_id and s.plan in ('pro', 'creator')
      -- every plan posts to one TikTok account: the first connected (extras connected before then stay, but nothing posts to them)
      join lateral (select id from public.channels where user_id = v.user_id and platform = 'tiktok' and status = 'connected' order by added_at, id limit 1) c on true
      where v.status in ('ready', 'scheduled', 'posted') and v.file_path is not null
        and v.tiktok_post is not null and v.tiktok_publish_id is null and v.tiktok_error is null
        and v.tiktok_at <= ${now} and v.tiktok_at > ${new Date(now.getTime() - 86400_000)}
      order by v.tiktok_at limit ${limit}`);
    for (const v of tiktok) {
      // TikTok only ever gets the copy without the tag; one made before TikTok was connected gets its copy first
      const file = v.clean_path ?? (await cleanCopy(v.id, v.priority));
      if (!file) {
        log.push(`${v.id} waits for its TikTok copy`);
        continue;
      }
      if (!(await claim(v.id))) continue;
      try {
        const choices = tiktokChoices.safeParse(v.tiktok_post);
        if (!choices.success) throw new TikTokError("The TikTok choices for this Short need making again.", 400, "choices");
        const length = seconds({ format: v.format, params: v.params } as Spec);
        const id = await tiktokPost(v.channel_id, await getVideo(file), tiktokCaption(v.title, v.description), choices.data, length);
        // with no YouTube channel to post it to, TikTok is where it's posted. One made for a channel stays ready for it,
        // connected or not, so it still goes up there once it can, or the creator posts it there and says so
        const done = !v.youtube && v.status === "ready";
        await admin((tx) => tx`
          update public.videos set tiktok_publish_id = ${id}, tiktok_error = null, posting_at = null, tiktok_posted_at = ${now},
            status = case when ${done} then 'posted' else status end, posted_at = case when ${done} then ${now} else posted_at end
          where id = ${v.id}`);
        await notify(v.user_id, { kind: "posted", title: "Sent to TikTok", body: `${v.title}. It can take a few minutes to show on your profile.`, href: `/app/shorts/${v.id}`, key: `tiktok:${v.id}` });
        log.push(`${v.id} → TikTok ${id}`);
      } catch (err) {
        const e = err instanceof TikTokError ? err : null;
        const msg = e ? tiktokReason(e.code, e.message) : err instanceof Error ? err.message : String(err);
        if (e?.tomorrow) {
          // a daily limit is full (TikTok's for apps under review, or the account's own): it goes at the same time tomorrow
          await admin((tx) => tx`update public.videos set tiktok_at = ${new Date(now.getTime() + 86400_000)}, posting_at = null where id = ${v.id}`);
          await notify(v.user_id, { kind: "failed", title: "TikTok is full for today", body: `${v.title}: ${msg}`, href: `/app/shorts/${v.id}`, key: `tiktok-tomorrow:${v.id}:${now.toISOString().slice(0, 10)}` });
        } else if (e && !e.retry) {
          // TikTok said no: it waits for the creator. Anything passing (an outage, a limit, the
          // network) keeps its lock, so it's tried again in half an hour, for up to a day.
          await admin((tx) => tx`update public.videos set tiktok_error = ${msg}, posting_at = null where id = ${v.id}`);
          await notify(v.user_id, { kind: "failed", title: "TikTok didn't take a Short", body: `${v.title}: ${msg}`, href: `/app/shorts/${v.id}`, key: `tiktok-failed:${v.id}:${now.getTime()}` });
        }
        log.push(`${v.id} TikTok failed: ${msg}`);
      }
    }
  }
  return log;
}
