import "server-only";
import { postsPerDay, type Plan } from "../../billing/plans";
import { channelNames, isActive } from "../../shorts/channels";
import type { HeldBack } from "../../shorts/history";
import { isWhenLine, planSlots, validTimezone, whenLine } from "../../shorts/times";
import { tiktokTime, type TikTokChoices } from "../../shorts/tiktok";
import type { ShortFormat, Spec } from "../../shorts/types";
import { brokenOf, commentsOn, postsThroughApi, YT_PRIVACY, type VideoState, type YouTubePrivacy } from "../../shorts/youtube";
import { billingFor } from "../billing";
import { admin, asUser, type Tx } from "../db";
import { forgetNames } from "../clips";
import { canTryAgain } from "../../live/clip-rules";
import { configured, youtubeApi } from "../env";
import { YouTubeError, youtubeAccess, youtubeIdFrom, youtubeVideoStates } from "../youtube";
import { QuotaWait, takeLinkCheck } from "../quota";
import { LINK_CHECKS_A_DAY, quotaResetsAt, tryAgainIn } from "../../shorts/quota";
import { hourResults } from "./hours";
import type { BattleParams } from "../../shorts/types";

/**
 * The Shorts queue as one account sees it: what's waiting for a yes or
 * no, what's on its way (rendering, ready, scheduled), and what's posted
 * with its views so far. Each Short says which YouTube channel it's for
 * (`channelId`, null for one made while the account had none).
 */

export type Waiting = { id: string; channelId: string | null; spec: Spec; key: string; title: string; description: string; why: string[]; suggestedFor: Date | null; origin: string };

export type Coming = {
  id: string;
  channelId: string | null;
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
  channelId: string | null;
  title: string;
  format: ShortFormat;
  postedAt: Date | null;
  youtubeId: string | null;
  /** the link was checked to be on their own channel (or Hookline uploaded it); only these count */
  verified: boolean;
  /** who can see it on YouTube, as YouTube said */
  privacy: YouTubePrivacy | null;
  youtubeKids: boolean | null;
  views: Partial<Record<"1h" | "24h" | "72h", number>>;
  /** all the list needs of its parameters: a Ball League match's card, so it's named for the league */
  params: Pick<BattleParams, "league">;
};

const privacyOf = (p: string | null): YouTubePrivacy | null => ((YT_PRIVACY as readonly string[]).includes(p ?? "") ? (p as YouTubePrivacy) : null);

/** The queue, or with `channelId` only that channel's Shorts. */
export async function queueOf(userId: string, channelId?: string): Promise<{ waiting: Waiting[]; coming: Coming[]; posted: Posted[] }> {
  return asUser(userId, async (tx) => {
    const only = channelId ? tx`and v.channel_id = ${channelId}` : tx``;
    const waiting = await tx<{ id: string; channel_id: string | null; format: ShortFormat; params: Spec["params"]; key: string; title: string; description: string; why: string[]; suggested_for: Date | null; origin: string }[]>`
      select v.id, v.channel_id, v.format, v.params, v.key, v.title, v.description, v.why, v.suggested_for, v.origin from public.videos v
      where v.status = 'review' ${only} order by v.suggested_for nulls last, v.created_at`;
    const coming = await tx<{
      id: string; channel_id: string | null; format: ShortFormat; params: Spec["params"]; title: string; description: string; status: Coming["status"]; scheduled_for: Date | null; progress: number | null; job: string | null;
      error: string | null; youtube_id: string | null; tiktok_publish_id: string | null; tiktok_chosen: boolean; tiktok_at: Date | null; tiktok_error: string | null; file_path: string | null;
      tiktok_file: boolean; cleaning: boolean; made_for_kids: boolean | null; youtube_kids: boolean | null; channel_kids: boolean | null;
      waiting_on: HeldBack["on"] | null; waiting_until: Date | null;
    }[]>`
      select v.id, v.channel_id, v.format, v.params, v.title, v.description, v.status, v.scheduled_for, v.error, v.youtube_id, v.tiktok_publish_id, v.file_path,
        v.tiktok_post is not null as tiktok_chosen, v.tiktok_at, v.tiktok_error, v.clean_path is not null as tiktok_file,
        exists (select 1 from public.render_jobs c where c.video_id = v.id and c.clean and c.status in ('queued', 'running')) as cleaning,
        v.made_for_kids, v.youtube_kids,
        -- YouTube's verdict on the channel it's for, the only one it goes to
        (select youtube_kids from public.channels where id = v.channel_id) as channel_kids,
        v.waiting_until, case when v.status = 'ready' and v.waiting_until > now() then v.waiting_on end as waiting_on,
        j.progress, j.status as job
      from public.videos v
      left join lateral (select progress, status from public.render_jobs where video_id = v.id and not clean order by id desc limit 1) j on true
      where v.status in ('approved', 'rendering', 'ready', 'scheduled', 'failed') and v.decided_at > now() - interval '30 days' ${only}
      order by v.scheduled_for nulls last, v.decided_at`;
    const posted = await tx<{
      id: string; channel_id: string | null; title: string; format: ShortFormat; posted_at: Date | null; youtube_id: string | null; youtube_verified: boolean; youtube_privacy: string | null;
      youtube_kids: boolean | null; stats: { checkpoint: "1h" | "24h" | "72h"; views: string }[] | null; params: Pick<BattleParams, "league">;
    }[]>`
      select v.id, v.channel_id, v.title, v.format, v.posted_at, v.youtube_id, v.youtube_verified, v.youtube_privacy, v.youtube_kids,
        (select json_agg(json_build_object('checkpoint', s.checkpoint, 'views', s.views)) from public.video_stats s where s.video_id = v.id) as stats,
        case when v.params ? 'league' then jsonb_build_object('league', v.params -> 'league') else '{}'::jsonb end as params
      from public.videos v where v.status = 'posted' ${only} order by v.posted_at desc nulls last limit 30`;
    return {
      waiting: waiting.map((r) => ({
        id: r.id, channelId: r.channel_id, spec: { format: r.format, params: r.params } as Spec, key: r.key, title: r.title, description: r.description, why: r.why, suggestedFor: r.suggested_for,
        origin: r.origin,
      })),
      coming: coming.map((r) => ({
        id: r.id,
        channelId: r.channel_id,
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
        channelId: r.channel_id,
        title: r.title,
        format: r.format,
        postedAt: r.posted_at,
        youtubeId: r.youtube_id,
        verified: r.youtube_verified,
        privacy: privacyOf(r.youtube_privacy),
        youtubeKids: r.youtube_kids,
        views: Object.fromEntries((r.stats ?? []).map((s) => [s.checkpoint, Number(s.views)])),
        params: r.params,
      })),
    };
  });
}

/**
 * The posting times a channel's kept Shorts have (or the Shorts with no
 * channel, for an account without one): a new time keeps two hours from
 * these, and another channel's times are its own. `review` counts the
 * times suggested to the ones still waiting for a yes too, and `except`
 * leaves out the Shorts being given a time. Run as the user, so it only
 * sees their own.
 */
async function takenOn(tx: Tx, channelId: string | null, opts: { review?: boolean; except?: string[] } = {}): Promise<Date[]> {
  const statuses = ["approved", "rendering", "ready", "scheduled", ...(opts.review ? ["review"] : [])];
  const except = opts.except ?? [];
  const rows = await tx<{ t: Date }[]>`
    select coalesce(scheduled_for, suggested_for) as t from public.videos
    where status in ${tx(statuses)} and coalesce(scheduled_for, suggested_for) is not null
      and ${channelId ? tx`channel_id = ${channelId}` : tx`channel_id is null`} ${except.length ? tx`and id not in ${tx(except)}` : tx``}`;
  return rows.map((r) => r.t);
}

/**
 * Posting times are booked one at a time for each account, so two
 * bookings at once (two tabs, or a channel coming back while a Short is
 * kept) each see the other's: every channel's Shorts share the account's
 * one TikTok. Held until the transaction ends, and taken before anything
 * else in it, so it never waits on a Short another booking holds.
 */
export async function lockTimes(tx: Tx, userId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtext(${`times:${userId}`}))`;
}

/**
 * The account's TikTok posts around now and after: each with a TikTok
 * time that hasn't been sent or turned down, and each sent in the last
 * two hours. Every channel's Shorts go to the account's one TikTok, so a
 * new TikTok time keeps two hours from all of these. `except` leaves out
 * the Shorts being given a time. Read under `lockTimes`.
 */
async function bookedTikTok(tx: Tx, userId: string, now: Date, except: string[] = []): Promise<Date[]> {
  const since = new Date(now.getTime() - 2 * 3600_000);
  const rows = await tx<{ t: Date }[]>`
    select coalesce(tiktok_posted_at, tiktok_at) as t from public.videos
    where user_id = ${userId} and tiktok_post is not null ${except.length ? tx`and id not in ${tx(except)}` : tx``}
      and ((tiktok_publish_id is null and tiktok_error is null and tiktok_at > ${since}) or tiktok_posted_at > ${since})`;
  return rows.map((r) => r.t);
}

/**
 * For a Ball League match, when its league's earlier matches that are
 * still to post go out: the latest of their times, and of their TikTok
 * times not sent yet. Earlier is before it in its season, or in a season
 * before, since a new season's first matches say how the last one ended.
 * Null for any other Short, or when none is left.
 */
async function earlierMatches(tx: Tx, id: string): Promise<{ at: Date | null; tiktok: Date | null } | null> {
  const [r] = await tx<{ at: Date | null; tiktok: Date | null }[]>`
    select max(coalesce(v.scheduled_for, v.suggested_for)) as at,
      max(v.tiktok_at) filter (where v.tiktok_post is not null and v.tiktok_publish_id is null and v.tiktok_error is null) as tiktok
    from public.league_matches me
    join public.league_seasons ms on ms.id = me.season_id
    join public.league_seasons s on s.league_id = ms.league_id
    join public.league_matches m on m.season_id = s.id and (s.number < ms.number or (s.id = ms.id and m.number < me.number))
    join public.videos v on v.id = m.video_id
    where me.video_id = ${id} and v.status in ('approved', 'rendering', 'ready', 'scheduled')`;
  return r?.at || r?.tiktok ? r : null;
}

/**
 * A yes: it goes in the render queue, ahead of free accounts on the paid
 * plans. On a plan that posts for you, it keeps its suggested time (or
 * the next free one at its channel's usual hours if that's passed, two
 * hours from that channel's others, and its "why" says the new time), and
 * goes to TikTok then too if the creator made their TikTok choices for
 * it (a little later if another of the account's TikTok posts is within
 * two hours of then). A Ball League match never goes out before an
 * earlier match of its league that's still to post: it takes the next
 * free time at least an hour after it, on YouTube and on TikTok.
 *
 * Who it's for is its YouTube channel's answer, unless the creator chose
 * differently for this Short (`kids`). One made for kids, or going to a
 * channel YouTube has set as made for kids, gets an ending that doesn't
 * ask for comments, since YouTube turns them off.
 *
 * A round from the creator's LIVE shows the names of the people who sent
 * gifts only when they chose to (`names`). Otherwise it lets go of them
 * before it's made, so they're never in its video.
 */
export async function approve(
  userId: string, id: string, plan: Plan, now = new Date(), tiktok: TikTokChoices | null = null, kids: boolean | null = null, names = false,
): Promise<boolean> {
  const done = await asUser(userId, async (tx) => {
    // a plan that posts books its time, and maybe TikTok's
    if (plan.scheduling) await lockTimes(tx, userId);
    const [v] = await tx<{ suggested_for: Date | null; timezone: string; why: string[]; channel_id: string | null }[]>`
      select v.suggested_for, p.timezone, v.why, v.channel_id from public.videos v join public.profiles p on p.id = v.user_id where v.id = ${id} and v.status = 'review'`;
    if (!v) return false;
    const tz = validTimezone(v.timezone);
    let at: Date | null = null;
    let why = v.why;
    if (plan.scheduling) {
      at = v.suggested_for && v.suggested_for.getTime() > now.getTime() + 15 * 60_000 ? v.suggested_for : null;
      if (!at) {
        const slot = planSlots(1, now, tz, await hourResults(tx, tz, v.channel_id), await takenOn(tx, v.channel_id), Math.random, 0, [], postsPerDay(plan))[0];
        at = slot?.at ?? null;
        why = [...v.why.filter((w) => !isWhenLine(w)), ...(slot ? [whenLine(slot, tz, true)] : [])];
      }
    }
    // a league match due before an earlier one of its league: the next free time from that one's, so the matches go out in order
    const earlier = plan.scheduling ? await earlierMatches(tx, id) : null;
    if (at && earlier?.at && at.getTime() < earlier.at.getTime() + 3600_000) {
      const from = new Date(Math.max(now.getTime(), earlier.at.getTime()));
      const slot = planSlots(1, from, tz, await hourResults(tx, tz, v.channel_id), await takenOn(tx, v.channel_id), Math.random, 0, [], postsPerDay(plan))[0];
      at = slot?.at ?? null;
      why = [...v.why.filter((w) => !isWhenLine(w)), ...(slot ? [whenLine(slot, tz, true)] : [])];
    }
    // the channel it's for: its answer, and YouTube's verdict on it
    const [ch] = v.channel_id
      ? await tx<{ made_for_kids: boolean | null; youtube_kids: boolean | null }[]>`select made_for_kids, youtube_kids from public.channels where id = ${v.channel_id}`
      : [];
    const audience = kids ?? ch?.made_for_kids ?? null;
    const comments = commentsOn({ madeForKids: audience, channelKids: ch?.youtube_kids });
    const post = plan.scheduling && tiktok ? tiktok : null;
    // a league match goes to TikTok an hour after its league's earlier one there at the soonest
    const tiktokFrom = at && earlier?.tiktok ? new Date(Math.max(at.getTime(), earlier.tiktok.getTime() + 3600_000)) : at;
    const tiktokAt = post && tiktokFrom ? tiktokTime(tiktokFrom, await bookedTikTok(tx, userId, now, [id]), tz) : null;
    await tx`
      update public.videos set status = 'approved', decided_at = now(), scheduled_for = ${at}, why = ${tx.json(why)}, error = null,
        tiktok_post = ${post ? tx.json(post) : null}, tiktok_at = ${tiktokAt}, tiktok_error = null,
        made_for_kids = ${audience},
        params = ((case when ${!comments} then params || '{"allowComments": false}'::jsonb else params - 'allowComments' end) - 'names')
          || (case when ${names} and format = 'clip' then '{"names": true}'::jsonb else '{}'::jsonb end)
      where id = ${id}`;
    return true;
  });
  if (done && !names) await forgetNames(userId, id);
  if (done) await admin((tx) => tx`insert into public.render_jobs (video_id, priority) values (${id}, ${plan.priority}) on conflict do nothing`);
  return done;
}

/**
 * A channel's Shorts kept but not yet on YouTube, brought in line with who
 * the channel is for once that's known (the creator's answer, or YouTube's
 * verdict on the whole channel when it's connected). One kept before there
 * was an answer takes it, and one that will be made for kids is made again
 * if its ending asks for comments YouTube will turn off. One being made
 * right now is made again when it finishes (finishJob checks). Other
 * channels' Shorts go by their own answers. Returns how many are made again.
 */
export async function fitAudience(userId: string, channelId: string): Promise<number> {
  const [c] = await admin((tx) => tx<{ made_for_kids: boolean | null; youtube_kids: boolean | null }[]>`
    select made_for_kids, youtube_kids from public.channels where id = ${channelId} and user_id = ${userId} and platform = 'youtube'`);
  if (!c) return 0;
  const priority = (await billingFor(userId)).plan.priority;
  return admin(async (tx) => {
    const waiting = tx`user_id = ${userId} and channel_id = ${channelId} and youtube_id is null and status in ('approved', 'rendering', 'ready')`;
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
 * that's passed, and later if that's within two hours of another of the
 * account's TikTok posts.
 */
export async function chooseTikTok(userId: string, id: string, choices: TikTokChoices, now = new Date()): Promise<boolean> {
  return asUser(userId, async (tx) => {
    await lockTimes(tx, userId);
    const [v] = await tx<{ scheduled_for: Date | null; timezone: string }[]>`
      select v.scheduled_for, p.timezone from public.videos v join public.profiles p on p.id = v.user_id
      where v.id = ${id} and v.status in ('approved', 'rendering', 'ready', 'scheduled', 'posted') and v.tiktok_publish_id is null`;
    if (!v) return false;
    const due = v.scheduled_for && v.scheduled_for.getTime() > now.getTime() ? v.scheduled_for : now;
    const at = tiktokTime(due, await bookedTikTok(tx, userId, now, [id]), validTimezone(v.timezone));
    const rows = await tx`
      update public.videos set tiktok_post = ${tx.json(choices)}, tiktok_error = null, tiktok_at = ${at}
      where id = ${id} and tiktok_publish_id is null returning id`;
    return rows.length > 0;
  });
}

/**
 * A channel back after being away (connected again, or connected for the
 * first time and taking over the account's Shorts), or one that has just
 * said who it's for: its kept Shorts that aren't on YouTube yet and whose
 * time has passed, or is under 15 minutes off, get the channel's next free
 * times at its own hours, two hours apart and from everything else booked
 * on it (the times suggested to today's Shorts too), instead of all going
 * up at once. Only where Hookline uploads them itself: anywhere else
 * nothing goes up by itself, so their times stay as the creator saw them.
 * Each one's "why" says its new time, and a TikTok time not used yet moves
 * with it, two hours from the account's other TikTok posts. One being
 * posted right now is left alone. A Ball League's matches keep their
 * order: a later match of a league with one that's late moves too, and
 * they take their new times in match order, on TikTok an hour apart at the
 * least. `within` is a transaction already under way, and the plan it's
 * for. Returns how many moved.
 */
export async function retimeLate(userId: string, channelId: string, now = new Date(), within?: { tx: Tx; plan: Plan }): Promise<number> {
  const plan = within?.plan ?? (await billingFor(userId)).plan;
  // nothing goes up by itself on a plan that doesn't post
  if (!plan.scheduling) return 0;
  const run = async (tx: Tx) => {
    await lockTimes(tx, userId);
    // nor anywhere Hookline doesn't upload: a channel that isn't connected, or one the creator posts to themselves
    const [c] = await tx<{ external_id: string; status: string }[]>`
      select external_id, status from public.channels where id = ${channelId} and user_id = ${userId} and platform = 'youtube'`;
    if (c?.status !== "connected" || !postsThroughApi(c.external_id, youtubeApi())) return 0;
    const soon = new Date(now.getTime() + 15 * 60_000);
    const late = inMatchOrder(await tx<{ id: string; why: string[]; tiktok_at: Date | null; tiktok_publish_id: string | null; tiktok_error: string | null; league: string | null; season: number | null; number: number | null }[]>`
      select v.id, v.why, v.tiktok_at, v.tiktok_publish_id, v.tiktok_error, s.league_id as league, s.number as season, m.number
      from public.videos v left join public.league_matches m on m.video_id = v.id left join public.league_seasons s on s.id = m.season_id
      where v.user_id = ${userId} and v.channel_id = ${channelId} and v.status in ('approved', 'rendering', 'ready')
        and v.youtube_id is null and v.scheduled_for is not null and (v.posting_at is null or v.posting_at < now() - interval '30 minutes')
        and (v.scheduled_for < ${soon}
        -- a later match of a league with an earlier match that's late (in its season, or a season before), so the league goes out in order
        or exists (select 1 from public.league_matches e join public.league_seasons es on es.id = e.season_id join public.videos w on w.id = e.video_id
          where es.league_id = s.league_id and (es.number < s.number or (es.id = s.id and e.number < m.number))
            and w.user_id = ${userId} and w.channel_id = ${channelId}
            and w.status in ('approved', 'rendering', 'ready') and w.youtube_id is null and w.scheduled_for < ${soon}
            and (w.posting_at is null or w.posting_at < now() - interval '30 minutes')))
      order by v.scheduled_for, v.id`);
    if (!late.length) return 0;
    const [p] = await tx<{ timezone: string }[]>`select timezone from public.profiles where id = ${userId}`;
    const tz = validTimezone(p?.timezone);
    const ids = late.map((v) => v.id);
    const taken = await takenOn(tx, channelId, { review: true, except: ids });
    const slots = planSlots(late.length, now, tz, await hourResults(tx, tz, channelId), taken, Math.random, 0, [], postsPerDay(plan));
    const booked = await bookedTikTok(tx, userId, now, ids);
    // each league's last TikTok time given here, so its next match goes there an hour after it at the soonest
    const lastTikTok = new Map<string, number>();
    let moved = 0;
    for (const [i, v] of late.entries()) {
      const slot = slots[i];
      if (!slot) continue;
      const why = [...v.why.filter((w) => !isWhenLine(w)), whenLine(slot, tz, plan.scheduling)];
      // still to go to TikTok (not sent, and not turned down): it goes with its new time
      const before = v.league ? lastTikTok.get(v.league) : undefined;
      const from = before === undefined ? slot.at : new Date(Math.max(slot.at.getTime(), before + 3600_000));
      const tiktok = v.tiktok_at && !v.tiktok_publish_id && !v.tiktok_error ? tiktokTime(from, booked, tz) : null;
      if (tiktok) booked.push(tiktok);
      if (tiktok && v.league) lastTikTok.set(v.league, tiktok.getTime());
      await tx`update public.videos set scheduled_for = ${slot.at}, why = ${tx.json(why)}, tiktok_at = ${tiktok ?? v.tiktok_at} where id = ${v.id}`;
      moved++;
    }
    return moved;
  };
  return within ? run(within.tx) : asUser(userId, run);
}

/** Shorts in time order, with each Ball League's matches put in match order (season by season) in the places its matches have. */
function inMatchOrder<T extends { league: string | null; season: number | null; number: number | null }>(xs: T[]): T[] {
  const out = [...xs];
  for (const league of new Set(xs.flatMap((x) => (x.league ? [x.league] : [])))) {
    const at = xs.flatMap((x, i) => (x.league === league ? [i] : []));
    const matches = at.map((i) => xs[i]).sort((p, q) => p.season! - q.season! || p.number! - q.number!);
    at.forEach((i, k) => (out[i] = matches[k]));
  }
  return out;
}

/** A no. A round from the creator's LIVE swiped away lets go of its gifters' names. */
export async function reject(userId: string, id: string): Promise<boolean> {
  const rows = await asUser(userId, (tx) => tx`update public.videos set status = 'rejected', decided_at = now() where id = ${id} and status = 'review' returning id`);
  if (rows.length) await forgetNames(userId, id);
  return rows.length > 0;
}

export async function retitle(userId: string, id: string, title: string, description: string): Promise<void> {
  await asUser(userId, (tx) => tx`update public.videos set title = ${title}, description = ${description} where id = ${id} and status in ('review', 'approved', 'rendering', 'ready')`);
}

/**
 * What YouTube says about a pasted link: the video, or null when YouTube
 * doesn't show one; "unchecked" when there's no way to ask (no API key and
 * no channel to ask with); "error" when asking failed; `wait` when there's
 * no quota left today to ask with. `first` is the channel the Short was
 * made for, asked before the rest.
 */
export type Lookup = (userId: string, youtubeId: string, first?: string | null, now?: Date) => Promise<{ state: VideoState | null } | { wait: QuotaWait } | "unchecked" | "error">;

/**
 * Asked as the creator's own connected channels, which see their private
 * videos too (the Short's own channel first, where it's most likely to
 * be), then with the API key. Each ask is counted as a link check, and
 * they all come out of the same quota, so once none is left, nothing
 * more is asked.
 */
const lookUp: Lookup = async (userId, youtubeId, first = null, now = new Date()) => {
  const connected = await admin((tx) => tx<{ id: string }[]>`
    select id from public.channels where user_id = ${userId} and platform = 'youtube' and status = 'connected' order by added_at, id`);
  const channels = [...connected.filter((c) => c.id === first), ...connected.filter((c) => c.id !== first)];
  let asked = false;
  for (const c of channels) {
    try {
      const found = (await youtubeVideoStates([youtubeId], { access: await youtubeAccess(c.id), kind: "checks", now })).get(youtubeId);
      asked = true;
      if (found) return { state: found };
    } catch (err) {
      if (err instanceof QuotaWait) return { wait: err };
      // that channel needs reconnecting, or YouTube didn't answer: try another way
    }
  }
  if (configured().youtubeTrends) {
    try {
      return { state: (await youtubeVideoStates([youtubeId], { kind: "checks", now })).get(youtubeId) ?? null };
    } catch (err) {
      if (err instanceof QuotaWait) return { wait: err };
      if (!(err instanceof YouTubeError)) throw err;
      return asked ? { state: null } : "error";
    }
  }
  return asked ? { state: null } : "unchecked";
};

/** Why a link can't be checked yet: there's no quota left today to ask YouTube with, by Hookline's count or YouTube's word. */
function checkWait(wait: QuotaWait, now: Date): string {
  const when = tryAgainIn(wait.until, now);
  return wait.google
    ? `YouTube's quota for Hookline is used up for today, so the link can't be checked yet. Try again ${when}, or leave the link out.`
    : `Hookline has used today's YouTube link checks, so this one can't be checked yet. Try again ${when}, or leave the link out.`;
}

/** `moved` names the channel a Short went to when its link was on another of the creator's channels than the one it was made for. */
export type PostedResult = { ok: true; checked: boolean; moved?: string } | { ok: false; message: string };

/**
 * For a Short someone posted themselves, optionally with the YouTube link
 * so its views are tracked. A link only counts once YouTube says the video
 * is on one of their own channels that isn't disconnected. On another of
 * theirs than the one it was made for, the Short moves to that one, so its
 * views count where it really is. When there's no way to ask YouTube, the
 * link is kept but left out of views and learning. When there's no quota
 * left to ask with today, or the account has had its link checks for the
 * day, nothing is marked: it says when to try again.
 */
export async function markPosted(userId: string, id: string, link: string | null, look: Lookup = lookUp, now = new Date()): Promise<PostedResult> {
  const [v] = await asUser(userId, (tx) => tx<{ id: string; channel_id: string | null }[]>`
    select id, channel_id from public.videos where id = ${id} and file_path is not null
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
  // so one account can't use everyone's checks: a day's are more than any plan makes, and a link takes one however many channels are asked
  if (!(await takeLinkCheck(userId, now))) {
    return { ok: false, message: `That's ${LINK_CHECKS_A_DAY} links checked today, the most for one day. Try again ${tryAgainIn(quotaResetsAt(now), now)}, or leave the link out.` };
  }

  const found = await look(userId, youtubeId, v.channel_id, now);
  if (found === "error") return { ok: false, message: "YouTube didn't answer, so the link couldn't be checked. Try again in a few minutes." };
  if (found === "unchecked") {
    await admin((tx) => tx`
      update public.videos set status = 'posted', posted_at = now(), error = null, youtube_id = ${youtubeId}, youtube_verified = false, ${forget(tx)}
      where id = ${id} and user_id = ${userId}`);
    return { ok: true, checked: false };
  }
  if ("wait" in found) return { ok: false, message: checkWait(found.wait, now) };
  const s = found.state;
  if (!s) return { ok: false, message: "YouTube doesn't show a video at that link. Check the link, and if the video is private, make it public or unlisted first." };
  // one YouTube rejected, couldn't process or deleted isn't posted, whoever uploaded it
  const broken = brokenOf(s);
  if (broken) return { ok: false, message: broken };
  const channels = await admin((tx) => tx<{ id: string; external_id: string; status: string; title: string | null; handle: string | null }[]>`
    select id, external_id, status, title, handle from public.channels where user_id = ${userId} and platform = 'youtube' order by added_at, id`);
  const names = channelNames(channels);
  const mine = channels.find((c) => c.external_id === s.channelId);
  // one they disconnected doesn't count as theirs any more: Hookline can't ask it, and it may not be theirs now
  if (mine && !isActive(mine)) {
    return { ok: false, message: `That video is on ${names.get(mine.id)}, which is disconnected. Connect it again so Hookline can check it, or leave the link empty.` };
  }
  if (!mine) {
    return {
      ok: false,
      message: channels.some(isActive)
        ? "That video is on a channel you haven't connected to Hookline. Paste the link to the one on your channel."
        : "Connect your YouTube channel in Settings first, so Hookline can check the video is yours.",
    };
  }
  // it's on the channel YouTube says it's on, which may be another of theirs than the one it was made for
  await admin((tx) => tx`
    update public.videos set status = 'posted', posted_at = now(), error = null, channel_id = ${mine.id},
      youtube_id = ${youtubeId}, youtube_verified = true, youtube_status = ${s.uploadStatus}, youtube_privacy = ${s.privacy},
      youtube_kids = ${s.madeForKids}, youtube_checked_at = now(), youtube_wanted = null, youtube_publish_at = null
    where id = ${id} and user_id = ${userId}`);
  return v.channel_id && v.channel_id !== mine.id ? { ok: true, checked: true, moved: names.get(mine.id)! } : { ok: true, checked: true };
}

/**
 * Try a failed one again: made again if it never rendered; checked with
 * YouTube again if it's up there but wasn't public (the creator may have
 * fixed that in YouTube Studio); otherwise uploaded again. A round from a
 * LIVE that can never be made stays as it is, saying why.
 */
export async function retry(userId: string, id: string, plan: Plan): Promise<void> {
  const [f] = await asUser(userId, (tx) => tx<{ format: ShortFormat; params: Spec["params"] | null; file_path: string | null }[]>`
    select format, case when format = 'clip' then params end as params, file_path from public.videos where id = ${id} and status = 'failed'`);
  if (!f || !canTryAgain({ format: f.format, params: f.params } as Spec, !!f.file_path)) return;
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
