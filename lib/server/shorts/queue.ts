import "server-only";
import type { Plan } from "../../billing/plans";
import type { HeldBack } from "../../shorts/history";
import { isWhenLine, planSlots, validTimezone, whenLine } from "../../shorts/times";
import type { TikTokChoices } from "../../shorts/tiktok";
import type { FormatId, Spec } from "../../shorts/types";
import { brokenOf, commentsOn, YT_PRIVACY, type VideoState, type YouTubePrivacy } from "../../shorts/youtube";
import { billingFor } from "../billing";
import { admin, asUser, type Tx } from "../db";
import { configured } from "../env";
import { YouTubeError, youtubeAccess, youtubeIdFrom, youtubeVideoStates } from "../youtube";
import { hourResults } from "./hours";

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
  /** what's holding it back from going up, and when it's tried again, while that's still to come */
  heldBack: HeldBack | null;
  hasFile: boolean;
  /** a copy without the free plan's tag exists, for TikTok, or one is being made */
  tiktokFile: boolean;
  cleaning: boolean;
  /** who it's for, as approved, and whether YouTube has marked it made for kids itself */
  madeForKids: boolean | null;
  youtubeKids: boolean | null;
  /** whether people can comment on it */
  comments: boolean;
};

export type Posted = {
  id: string;
  title: string;
  format: FormatId;
  postedAt: Date | null;
  youtubeId: string | null;
  /** the link was checked to be on their own channel (or Hookline uploaded it); only these count */
  verified: boolean;
  /** who can see it on YouTube, as YouTube said */
  privacy: YouTubePrivacy | null;
  youtubeKids: boolean | null;
  views: Partial<Record<"1h" | "24h" | "72h", number>>;
};

const privacyOf = (p: string | null): YouTubePrivacy | null => ((YT_PRIVACY as readonly string[]).includes(p ?? "") ? (p as YouTubePrivacy) : null);

export async function queueOf(userId: string): Promise<{ waiting: Waiting[]; coming: Coming[]; posted: Posted[] }> {
  return asUser(userId, async (tx) => {
    const waiting = await tx<{ id: string; format: FormatId; params: Spec["params"]; key: string; title: string; description: string; why: string[]; suggested_for: Date | null; origin: string }[]>`
      select id, format, params, key, title, description, why, suggested_for, origin from public.videos
      where status = 'review' order by suggested_for nulls last, created_at`;
    const coming = await tx<{
      id: string; format: FormatId; params: Spec["params"]; title: string; description: string; status: Coming["status"]; scheduled_for: Date | null; progress: number | null; job: string | null;
      error: string | null; youtube_id: string | null; tiktok_publish_id: string | null; tiktok_chosen: boolean; tiktok_at: Date | null; tiktok_error: string | null; file_path: string | null;
      tiktok_file: boolean; cleaning: boolean; made_for_kids: boolean | null; youtube_kids: boolean | null; channel_kids: boolean | null;
      waiting_on: HeldBack["on"] | null; waiting_until: Date | null;
    }[]>`
      select v.id, v.format, v.params, v.title, v.description, v.status, v.scheduled_for, v.error, v.youtube_id, v.tiktok_publish_id, v.file_path,
        v.tiktok_post is not null as tiktok_chosen, v.tiktok_at, v.tiktok_error, v.clean_path is not null as tiktok_file,
        exists (select 1 from public.render_jobs c where c.video_id = v.id and c.clean and c.status in ('queued', 'running')) as cleaning,
        v.made_for_kids, v.youtube_kids,
        -- YouTube's verdict on the channel it goes to (the one it went to, or the one posting picks)
        case when v.channel_id is not null then (select youtube_kids from public.channels where id = v.channel_id)
          else (select youtube_kids from public.channels where platform = 'youtube' and status = 'connected' order by connected_at limit 1) end as channel_kids,
        v.waiting_until, case when v.status = 'ready' and v.waiting_until > now() then v.waiting_on end as waiting_on,
        j.progress, j.status as job
      from public.videos v
      left join lateral (select progress, status from public.render_jobs where video_id = v.id and not clean order by id desc limit 1) j on true
      where v.status in ('approved', 'rendering', 'ready', 'scheduled', 'failed') and v.decided_at > now() - interval '30 days'
      order by v.scheduled_for nulls last, v.decided_at`;
    const posted = await tx<{
      id: string; title: string; format: FormatId; posted_at: Date | null; youtube_id: string | null; youtube_verified: boolean; youtube_privacy: string | null; youtube_kids: boolean | null;
      stats: { checkpoint: "1h" | "24h" | "72h"; views: string }[] | null;
    }[]>`
      select v.id, v.title, v.format, v.posted_at, v.youtube_id, v.youtube_verified, v.youtube_privacy, v.youtube_kids,
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
        heldBack: r.waiting_on ? { on: r.waiting_on, until: r.waiting_until } : null,
        hasFile: !!r.file_path,
        tiktokFile: r.tiktok_file,
        cleaning: r.cleaning,
        madeForKids: r.made_for_kids,
        youtubeKids: r.youtube_kids,
        comments: commentsOn({ madeForKids: r.made_for_kids, youtubeKids: r.youtube_kids, channelKids: r.channel_kids }),
      })),
      posted: posted.map((r) => ({
        id: r.id,
        title: r.title,
        format: r.format,
        postedAt: r.posted_at,
        youtubeId: r.youtube_id,
        verified: r.youtube_verified,
        privacy: privacyOf(r.youtube_privacy),
        youtubeKids: r.youtube_kids,
        views: Object.fromEntries((r.stats ?? []).map((s) => [s.checkpoint, Number(s.views)])),
      })),
    };
  });
}

/**
 * A yes: it goes in the render queue, ahead of free accounts on the paid
 * plans. On a plan that posts for you, it keeps its suggested time (or
 * the next free one at the channel's usual hours if that's passed, and
 * its "why" says the new time), and goes to TikTok then too if the
 * creator made their TikTok choices for it.
 *
 * Who it's for is the YouTube channel's answer, unless the creator chose
 * differently for this Short (`kids`). One made for kids, or going to a
 * channel YouTube has set as made for kids, gets an ending that doesn't
 * ask for comments, since YouTube turns them off.
 */
export async function approve(userId: string, id: string, plan: Plan, now = new Date(), tiktok: TikTokChoices | null = null, kids: boolean | null = null): Promise<boolean> {
  const done = await asUser(userId, async (tx) => {
    const [v] = await tx<{ suggested_for: Date | null; timezone: string; why: string[] }[]>`
      select v.suggested_for, p.timezone, v.why from public.videos v join public.profiles p on p.id = v.user_id where v.id = ${id} and v.status = 'review'`;
    if (!v) return false;
    let at: Date | null = null;
    let why = v.why;
    if (plan.scheduling) {
      at = v.suggested_for && v.suggested_for.getTime() > now.getTime() + 15 * 60_000 ? v.suggested_for : null;
      if (!at) {
        const tz = validTimezone(v.timezone);
        const taken = await tx<{ t: Date }[]>`select coalesce(scheduled_for, suggested_for) as t from public.videos where status in ('approved', 'rendering', 'ready', 'scheduled') and coalesce(scheduled_for, suggested_for) is not null`;
        const slot = planSlots(1, now, tz, await hourResults(tx, tz), taken.map((r) => r.t), Math.random, 0)[0];
        at = slot?.at ?? null;
        why = [...v.why.filter((w) => !isWhenLine(w)), ...(slot ? [whenLine(slot, tz, true)] : [])];
      }
    }
    const [ch] = await tx<{ made_for_kids: boolean | null; youtube_kids: boolean | null }[]>`
      select made_for_kids, youtube_kids from public.channels where user_id = ${userId} and platform = 'youtube' and status = 'connected' order by connected_at limit 1`;
    const audience = kids ?? ch?.made_for_kids ?? null;
    const comments = commentsOn({ madeForKids: audience, channelKids: ch?.youtube_kids });
    const post = plan.scheduling && tiktok ? tiktok : null;
    await tx`
      update public.videos set status = 'approved', decided_at = now(), scheduled_for = ${at}, why = ${tx.json(why)}, error = null,
        tiktok_post = ${post ? tx.json(post) : null}, tiktok_at = ${post ? at : null}, tiktok_error = null,
        made_for_kids = ${audience},
        params = case when ${!comments} then params || '{"allowComments": false}'::jsonb else params - 'allowComments' end
      where id = ${id}`;
    return true;
  });
  if (done) await admin((tx) => tx`insert into public.render_jobs (video_id, priority) values (${id}, ${plan.priority}) on conflict do nothing`);
  return done;
}

/**
 * Shorts kept but not yet on YouTube, brought in line with who the channel
 * is for once that's known (the creator's answer, or YouTube's verdict on
 * the whole channel when it's connected). One kept before there was an
 * answer takes it, and one that will be made for kids is made again if
 * its ending asks for comments YouTube will turn off. One being made right
 * now is made again when it finishes (finishJob checks). Returns how many
 * are made again.
 */
export async function fitAudience(userId: string): Promise<number> {
  const [c] = await admin((tx) => tx<{ made_for_kids: boolean | null; youtube_kids: boolean | null }[]>`
    select made_for_kids, youtube_kids from public.channels
    where user_id = ${userId} and platform = 'youtube' and status = 'connected' order by connected_at limit 1`);
  if (!c) return 0;
  const priority = (await billingFor(userId)).plan.priority;
  return admin(async (tx) => {
    const waiting = tx`user_id = ${userId} and youtube_id is null and status in ('approved', 'rendering', 'ready')`;
    // the database logs each Short taking the channel's answer, like any other choice
    if (c.made_for_kids !== null) await tx`update public.videos set made_for_kids = ${c.made_for_kids} where ${waiting} and made_for_kids is null`;
    const again = await tx<{ id: string }[]>`
      update public.videos set params = params || '{"allowComments": false}'::jsonb,
        status = case when status = 'ready' then 'approved' else status end,
        file_path = case when status = 'ready' then null else file_path end,
        clean_path = case when status = 'ready' then null else clean_path end
      where ${waiting} and (made_for_kids is true or ${c.youtube_kids === true})
        and params -> 'allowComments' is distinct from 'false'::jsonb
      returning id`;
    for (const v of again) await tx`insert into public.render_jobs (video_id, priority) values (${v.id}, ${priority}) on conflict do nothing`;
    return again.length;
  });
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

/**
 * What YouTube says about a pasted link: the video, or null when YouTube
 * doesn't show one; "unchecked" when there's no way to ask (no API key and
 * no channel to ask with); "error" when asking failed.
 */
export type Lookup = (userId: string, youtubeId: string) => Promise<{ state: VideoState | null } | "unchecked" | "error">;

/** Asked as the creator's own channels first, which see their private videos too, then with the API key. */
const lookUp: Lookup = async (userId, youtubeId) => {
  const channels = await admin((tx) => tx<{ id: string }[]>`
    select id from public.channels where user_id = ${userId} and platform = 'youtube' and status = 'connected' order by connected_at`);
  let asked = false;
  for (const c of channels) {
    try {
      const found = (await youtubeVideoStates([youtubeId], await youtubeAccess(c.id))).get(youtubeId);
      asked = true;
      if (found) return { state: found };
    } catch {
      // that channel needs reconnecting, or YouTube didn't answer: try another way
    }
  }
  if (configured().youtubeTrends) {
    try {
      return { state: (await youtubeVideoStates([youtubeId])).get(youtubeId) ?? null };
    } catch (err) {
      if (!(err instanceof YouTubeError)) throw err;
      return asked ? { state: null } : "error";
    }
  }
  return asked ? { state: null } : "unchecked";
};

export type PostedResult = { ok: true; checked: boolean } | { ok: false; message: string };

/**
 * For a Short someone posted themselves, optionally with the YouTube link
 * so its views are tracked. A link only counts once YouTube says the video
 * is on one of their own channels. When there's no way to ask YouTube, the
 * link is kept but left out of views and learning.
 */
export async function markPosted(userId: string, id: string, link: string | null, look: Lookup = lookUp): Promise<PostedResult> {
  const [v] = await asUser(userId, (tx) => tx<{ id: string }[]>`
    select id from public.videos where id = ${id} and file_path is not null
      and status in ('ready', 'scheduled', 'failed') and (status <> 'scheduled' or youtube_id is null)`);
  if (!v) return { ok: false, message: "That Short can't be marked as posted." };
  const text = (link ?? "").trim();
  // posted by them, so anything left from an upload of Hookline's that didn't go public no longer applies
  const forget = (tx: Tx) => tx`youtube_status = null, youtube_privacy = null, youtube_kids = null, youtube_checked_at = null,
    youtube_wanted = null, youtube_publish_at = null`;
  if (!text) {
    await admin((tx) => tx`
      update public.videos set status = 'posted', posted_at = now(), error = null, youtube_id = null, youtube_verified = false, ${forget(tx)}
      where id = ${id} and user_id = ${userId}`);
    return { ok: true, checked: false };
  }
  const youtubeId = youtubeIdFrom(text);
  if (!youtubeId) return { ok: false, message: "That doesn't look like a link to a YouTube video. Paste the Short's link, or leave it empty." };
  // an unchecked link someone else pasted can't keep the real owner from linking their own video
  const [taken] = await admin((tx) => tx`
    select 1 from public.videos where youtube_id = ${youtubeId} and id <> ${id} and (user_id = ${userId} or youtube_verified) limit 1`);
  if (taken) return { ok: false, message: "That video is already linked to another Short." };

  const found = await look(userId, youtubeId);
  if (found === "error") return { ok: false, message: "YouTube didn't answer, so the link couldn't be checked. Try again in a few minutes." };
  if (found === "unchecked") {
    await admin((tx) => tx`
      update public.videos set status = 'posted', posted_at = now(), error = null, youtube_id = ${youtubeId}, youtube_verified = false, ${forget(tx)}
      where id = ${id} and user_id = ${userId}`);
    return { ok: true, checked: false };
  }
  const s = found.state;
  if (!s) return { ok: false, message: "YouTube doesn't show a video at that link. Check the link, and if the video is private, make it public or unlisted first." };
  // one YouTube rejected, couldn't process or deleted isn't posted, whoever uploaded it
  const broken = brokenOf(s);
  if (broken) return { ok: false, message: broken };
  const channels = await admin((tx) => tx<{ id: string; external_id: string }[]>`
    select id, external_id from public.channels where user_id = ${userId} and platform = 'youtube' order by connected_at`);
  const mine = channels.find((c) => c.external_id === s.channelId);
  if (!mine) {
    return {
      ok: false,
      message: channels.length
        ? "That video is on a channel you haven't connected to Hookline. Paste the link to the one on your channel."
        : "Connect your YouTube channel in Settings first, so Hookline can check the video is yours.",
    };
  }
  await admin((tx) => tx`
    update public.videos set status = 'posted', posted_at = now(), error = null, channel_id = ${mine.id},
      youtube_id = ${youtubeId}, youtube_verified = true, youtube_status = ${s.uploadStatus}, youtube_privacy = ${s.privacy},
      youtube_kids = ${s.madeForKids}, youtube_checked_at = now(), youtube_wanted = null, youtube_publish_at = null
    where id = ${id} and user_id = ${userId}`);
  return { ok: true, checked: true };
}

/**
 * Try a failed one again: made again if it never rendered; checked with
 * YouTube again if it's up there but wasn't public (the creator may have
 * fixed that in YouTube Studio); otherwise uploaded again.
 */
export async function retry(userId: string, id: string, plan: Plan): Promise<void> {
  const [v] = await admin((tx) => tx<{ file_path: string | null }[]>`
    update public.videos set
      status = case when file_path is null then 'approved' when youtube_id is not null and youtube_status in ('processed', 'uploaded') then 'scheduled' else 'ready' end,
      youtube_id = case when youtube_status in ('processed', 'uploaded') then youtube_id end,
      youtube_verified = youtube_verified and coalesce(youtube_status in ('processed', 'uploaded'), false),
      youtube_status = case when youtube_status in ('processed', 'uploaded') then youtube_status end,
      youtube_wanted = case when youtube_status in ('processed', 'uploaded') then youtube_wanted end,
      youtube_publish_at = case when youtube_status in ('processed', 'uploaded') then youtube_publish_at end,
      youtube_checked_at = null, error = null
    where id = ${id} and user_id = ${userId} and status = 'failed' returning file_path`);
  if (v && !v.file_path) await admin((tx) => tx`insert into public.render_jobs (video_id, priority) values (${id}, ${plan.priority}) on conflict do nothing`);
}

/** The video file's key in storage, if it's theirs and rendered. */
export async function fileOf(userId: string, id: string): Promise<{ key: string; title: string } | null> {
  const [v] = await asUser(userId, (tx) => tx<{ file_path: string | null; title: string }[]>`select file_path, title from public.videos where id = ${id}`);
  return v?.file_path ? { key: v.file_path, title: v.title } : null;
}
