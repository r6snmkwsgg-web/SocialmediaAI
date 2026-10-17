import "server-only";
import { tiktokCaption, tiktokChoices, tiktokReason } from "../../shorts/tiktok";
import { seconds } from "../../shorts/timing";
import type { FormatId, ShortFormat, Spec } from "../../shorts/types";
import { verdictOf, YT_PRIVACY, type AskedAs, type VideoState, type YouTubePrivacy } from "../../shorts/youtube";
import { admin } from "../db";
import { notify } from "../notify";
import { getVideo } from "../storage";
import { TikTokError, tiktokPost } from "../tiktok";
import { quotaResetsAt, YouTubeError, youtubeAccess, youtubeUpload, youtubeVideoStates } from "../youtube";
import { countUpload, QuotaWait } from "../quota";
import { PLANS, uploadCap, type PlanId } from "../../billing/plans";
import { quotaDay } from "../../shorts/quota";
import type { Tx } from "../db";
import { configured, youtubeApi } from "../env";
import { cleanCopy } from "./render";

/**
 * Posting what's ready, on plans that post for you. YouTube gets each
 * Short once it's rendered (public ones up to a day before their time,
 * set to go public then; the rest at their time), on the channel it was
 * made for and no other, but only where Hookline may upload: every
 * channel once YouTube's audit has passed, the test channels before it.
 * Everyone else posts their own and Hookline checks the link. A Short
 * with no channel never uploads. A Short only counts as posted once
 * YouTube says so. TikTok gets it at its time on the account's one
 * TikTok, since TikTok can't schedule, with the choices the creator made
 * for it and without the free plan's tag. A lock on each video means two
 * posters running at once never post the same one twice. Each plan
 * uploads so many a day, so no account takes everyone's, and when
 * YouTube's daily uploads for Hookline run out, the Shorts in line say
 * what they're waiting for and are tried again once it resets, not every
 * minute.
 */

/** YouTube's category for each format */
const CATEGORY: Record<ShortFormat, string> = { battle: "24", quiz: "27", wyr: "24", texts: "24", ranking: "27", race: "27", clip: "24" };

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
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
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
      -- every 4 minutes for its first half hour, then every half hour (checkAgain in lib/shorts/youtube.ts)
      and (v.youtube_checked_at is null
        or v.youtube_checked_at < ${minutesAgo(4)} and greatest(v.scheduled_for, coalesce(v.uploaded_at, v.scheduled_for)) > ${minutesAgo(30)}
        or v.youtube_checked_at < ${minutesAgo(30)})
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
      // counted as posting's: the units the other kinds can't take are kept for these
      if (by !== "key") states = await youtubeVideoStates(ids, { access: await youtubeAccess(by), kind: "uploads", now });
      else if (configured().youtubeTrends) states = await youtubeVideoStates(ids, { kind: "uploads", now });
    } catch (err) {
      // every group is asked out of the same quota, so once there's none left the rest wait for the reset too
      if (err instanceof QuotaWait) {
        log.push(`checks wait for YouTube quota until ${err.until.toISOString()}`);
        break;
      }
      // asked all the same: they wait like ones still processing, so a check that keeps failing isn't made every minute
      await admin((tx) => tx`update public.videos set youtube_checked_at = ${now} where id in ${tx(videos.map((v) => v.id))}`);
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
  const resets = quotaResetsAt(now);
  const day = quotaDay(now);

  // what can go up: each to the channel it was made for, while that's connected, only where Hookline may upload, and only once
  // the creator has said who the channel is for. Its owner's own channel: the key on videos keeps it so, and so does this join.
  // A public one goes up private until its time, but no more than a day ahead, so each day's uploads go to the Shorts due
  // soonest. YouTube can only schedule public ones, so unlisted and private ones go up at their time
  const uploadable = (tx: Tx) => tx`
    from public.videos v
    join public.subscriptions s on s.user_id = v.user_id and s.plan in ('pro', 'creator')
    join public.channels c on c.id = v.channel_id and c.user_id = v.user_id and c.platform = 'youtube' and c.status = 'connected'
    where v.status = 'ready' and v.youtube_id is null and v.file_path is not null and v.scheduled_for is not null
      and c.made_for_kids is not null
      and (${audited} or c.external_id = any(string_to_array(${test.join(",")}, ',')))
      and (c.privacy = 'public' and v.scheduled_for <= ${new Date(now.getTime() + 86400_000)} or v.scheduled_for <= ${new Date(now.getTime() + 15 * 60_000)})`;

  // each account with something to go up, and its room: its plan's uploads a day for the YouTube channels it has connected,
  // less what Hookline uploaded for it this quota day, as the server counted it
  const accounts = await admin((tx) => tx<{ user_id: string; plan: PlanId; channels: number; today: number }[]>`
    select v.user_id, s.plan,
      (select count(*)::int from public.channels y where y.user_id = v.user_id and y.platform = 'youtube' and y.status = 'connected') as channels,
      coalesce((select a.uploads from public.youtube_account_days a where a.day = ${day} and a.user_id = v.user_id), 0) as today
    ${uploadable(tx)}
    group by v.user_id, s.plan`);
  const room = new Map(accounts.map((a) => [a.user_id, uploadCap(PLANS[a.plan], a.channels) - a.today]));
  const full = accounts.filter((a) => room.get(a.user_id)! <= 0).map((a) => a.user_id);
  const open = accounts.filter((a) => room.get(a.user_id)! > 0).map((a) => a.user_id);
  // an account whose plan's uploads for today are done: its Shorts say so until the reset (one already waiting keeps what it
  // says). One with room again (a bigger plan, or another channel on Creator) stops waiting, and goes up in this run
  if (full.length) {
    const capped = await admin((tx) => tx`
      update public.videos set waiting_on = 'plan_cap', waiting_until = ${resets}, error = null
      where id in (select v.id ${uploadable(tx)} and v.user_id = any(${full}::uuid[]) and (v.waiting_until is null or v.waiting_until <= ${now}))
      returning id`);
    if (capped.length) log.push(`${capped.length} waiting for their plan's next uploads until ${resets.toISOString()}`);
  }
  if (open.length) {
    await admin((tx) => tx`
      update public.videos set waiting_on = null, waiting_until = null
      where user_id = any(${open}::uuid[]) and status = 'ready' and waiting_on = 'plan_cap'`);
  }

  // due before the reset first, then the accounts with the fewest uploads today, then the soonest. Only accounts with room
  // are in it, so one with hundreds ready can't keep anyone else's from going up
  const youtube = open.length ? await admin((tx) => tx<{
    id: string; user_id: string; title: string; description: string; format: FormatId; file_path: string; scheduled_for: Date;
    channel_id: string; privacy: string; kids: boolean;
  }[]>`
    select v.id, v.user_id, v.title, v.description, v.format, v.file_path, v.scheduled_for, c.id as channel_id, c.privacy,
      coalesce(v.made_for_kids, c.made_for_kids) as kids,
      coalesce((select a.uploads from public.youtube_account_days a where a.day = ${day} and a.user_id = v.user_id), 0) as today
    ${uploadable(tx)}
      and v.user_id = any(${open}::uuid[]) and (v.waiting_until is null or v.waiting_until <= ${now})
    order by v.scheduled_for <= ${resets} desc, today, v.scheduled_for, v.id
    limit ${limit}`) : [];
  // what each account has had go up in this run, against its room
  const done = new Map<string, number>();
  // uploads in a row YouTube didn't answer, or answered with a failure of its own
  let down = 0;
  for (const [i, v] of youtube.entries()) {
    if ((done.get(v.user_id) ?? 0) >= room.get(v.user_id)!) {
      // that's the account's uploads for today: this one says so until the reset
      await admin((tx) => tx`
        update public.videos set waiting_on = 'plan_cap', waiting_until = ${resets}, error = null where id = ${v.id} and status = 'ready' and youtube_id is null`);
      log.push(`${v.id} waits for its plan's next uploads until ${resets.toISOString()}`);
      continue;
    }
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
      }, now);
      // up, not posted: it counts once YouTube says it's processed and can be seen. Counted against the account's uploads
      // today in the same go, so the two never disagree
      await admin(async (tx) => {
        await tx`
          update public.videos set youtube_id = ${ytId}, youtube_verified = true, status = 'scheduled',
            youtube_status = 'uploaded', youtube_privacy = null, youtube_kids = null, youtube_checked_at = null,
            youtube_wanted = ${privacy}, youtube_publish_at = ${publishAt},
            posted_at = null, uploaded_at = ${now}, error = null, posting_at = null,
            waiting_on = null, waiting_until = null
          where id = ${v.id}`;
        await countUpload(tx, v.user_id, now);
      });
      done.set(v.user_id, (done.get(v.user_id) ?? 0) + 1);
      down = 0;
      log.push(`${v.id} → YouTube ${ytId}${publishAt ? `, public at ${publishAt.toISOString()}` : ""}`);
    } catch (err) {
      const e = err instanceof YouTubeError ? err : null;
      const wait = err instanceof QuotaWait ? err : null;
      const msg = err instanceof Error ? err.message : String(err);
      if (wait || e?.quota) {
        // the quota is the whole app's, so the rest of this run would fail too: they all wait for the reset, and say so.
        // Hookline's own count reaching YouTube's uploads for the day is the same wait as YouTube refusing one
        const until = wait?.until ?? quotaResetsAt(now);
        const rest = youtube.slice(i).map((x) => x.id);
        await admin((tx) => tx`
          update public.videos set waiting_on = 'youtube_quota', waiting_until = ${until}, error = null,
            posting_at = case when id = ${v.id} then null else posting_at end
          where id in ${tx(rest)} and status = 'ready' and youtube_id is null`);
        log.push(`YouTube upload quota used up: ${rest.length} waiting until ${until.toISOString()}`);
        break;
      }
      // outages pass: it stays ready and is tried again in half an hour, not every minute, since every try counts against
      // the day's uploads; anything else needs a person. Either way it's no longer the quota it's waiting for, so it stops
      // saying so. The half hour isn't a wait it shows (only waiting_on makes one), and TikTok still gets it at its time
      const failed = !!e && !e.retry && e.status !== 401;
      const again = failed ? null : new Date(now.getTime() + 30 * 60_000);
      await admin((tx) => tx`
        update public.videos set error = ${msg}, status = ${failed ? "failed" : "ready"}, posting_at = null, waiting_on = null, waiting_until = ${again}
        where id = ${v.id}`);
      if (failed) await notify(v.user_id, { kind: "failed", title: "YouTube didn't take a Short", body: `${v.title}: ${msg}`, href: `/app/shorts/${v.id}`, key: `youtube-failed:${v.id}:${now.getTime()}` });
      log.push(`${v.id} failed: ${msg}`);
      // YouTube down, or not reached at all. Once can be that Short's own, so a Short YouTube keeps failing can't hold up the
      // rest; twice in a row, every upload in line would fail the same way and each try would still count, so the rest of
      // the line waits the same half hour, and an outage can't use up the day's uploads on tries YouTube never took
      down = e && (e.status >= 500 || e.status === 0) ? down + 1 : 0;
      if (again && down >= 2) {
        const paused = await admin((tx) => tx`
          update public.videos set waiting_on = null, waiting_until = ${again}
          where id in (select v.id ${uploadable(tx)} and (v.waiting_until is null or v.waiting_until <= ${now}))
          returning id`);
        log.push(`YouTube down or out of reach: ${paused.length} more waiting until ${again.toISOString()}`);
        break;
      }
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
