import "server-only";
import type { ChannelNumbers } from "../../earnings/ypp";
import { channelNames } from "../../shorts/channels";
import { engagedShare } from "../../shorts/learn";
import {
  addDays, audienceOf, contentSplit, lastDay, pacificDay, problemOf, shareDue, totalOf, videoReadings, viewerRows,
  type Audience, type Health, type Problem, type Step, type ViewerRow,
} from "../../shorts/proof";
import { hasScope } from "../../shorts/youtube";
import { admin, asUser } from "../db";
import { configured, env } from "../env";
import { QuotaWait } from "../quota";
import { ANALYTICS_SCOPE, REVENUE_SCOPE, YouTubeError, youtubeAccess, youtubeSubscribers } from "../youtube";
import { analyticsReport, type ReportQuery } from "../youtube-analytics";

/**
 * The proof layer: what YouTube Analytics says about each of Hookline's
 * own Shorts, and who watches each YouTube channel and how far it is from
 * the Partner Program. Each connected channel is read once a day with its
 * own access, and only for the Shorts Hookline knows are on it, since
 * another channel's ids could be anyone's videos. Nothing is written
 * until the whole read has worked, and then it's all written at once.
 * YouTube's API rules let Hookline keep these only while it keeps reading
 * them: every Short still kept is read again within 20 days, whatever
 * isn't read for 30 days goes, and everything goes at once when the channel
 * is disconnected (a trigger on channels) or the account is deleted. It
 * doesn't learn: the learning loop reads what's kept here.
 */

/** Each channel is read once a day: it's due again 20 hours after its last try, or as soon as it's connected again since then. */
const DUE_HOURS = 20;
/** Shorts in one query, and in one channel's read */
const SHORTS_A_QUERY = 200;
const SHORTS_A_READ = 600;
/** Subscriber counts read in one call with the API key */
const CHANNELS_A_CALL = 50;

/** A channel that's due, with what Google let Hookline do on it. */
type Due = { id: string; user_id: string; external_id: string; scopes: string | null };

/** A Short's totals as they're kept: its share only from a reading that has its first two Pacific days and runs no further than its first week. */
type ShortRow = { id: string; views: number; engaged: number; seconds: number | null; percent: number | null; revenue: number | null; share: number | null };

/** What one channel's full read found. */
type Read = {
  through: string | null;
  revenue: { readable: boolean; all: number | null; ads: number | null };
  shorts: ShortRow[];
  audience: ViewerRow[] | null;
  shortsEngaged90: number | null;
  longHours365: number | null;
};

type Subscribers = { subscribers: number | null; hidden: boolean };

/** Why a channel's read stopped, as problemOf names it, and what went wrong, for the log. */
class Unread extends Error {
  constructor(readonly problem: Problem, message: string) {
    super(message);
  }
}

/** A failure, named for what it means at this step; null where the read carries on without it. */
function unread(e: unknown, step: Step): Unread | null {
  // the allowance is the whole app's, whether Hookline's count or YouTube said so
  if (e instanceof QuotaWait) return new Unread("quota", e.message);
  const problem = e instanceof YouTubeError ? problemOf(e, step) : "error";
  return problem === "skip" ? null : new Unread(problem, e instanceof Error ? e.message : String(e));
}

/** A step the read can't do without: any failure stops it. */
async function must<T>(step: Step, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw unread(e, step) ?? new Unread("error", e instanceof Error ? e.message : String(e));
  }
}

/** A step the read can do without (revenue, the split): null when YouTube refuses only it. */
async function may<T>(step: Step, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    const u = unread(e, step);
    if (u) throw u;
    return null;
  }
}

/** Takes a due channel for this run, or says another runner has it. Only one that's still connected. */
async function claim(c: Due, now: Date): Promise<boolean> {
  const rows = await admin((tx) => tx`
    insert into public.channel_analytics (channel_id, user_id, tried_at)
    select ch.id, ch.user_id, ${now} from public.channels ch where ch.id = ${c.id} and ch.status = 'connected' for share of ch
    on conflict (channel_id) do update set tried_at = excluded.tried_at
      where channel_analytics.tried_at is null or channel_analytics.tried_at < ${now}::timestamptz - make_interval(hours => ${DUE_HOURS})
        or channel_analytics.tried_at < (select connected_at from public.channels where id = ${c.id})
    returning channel_id`);
  return rows.length > 0;
}

/**
 * The Shorts to read on a channel: posted, checked to be on it, and up on
 * a day YouTube has reported. Those never read, those posted in the last
 * 90 days, and any last read 20 days ago or more, so nothing kept goes 30
 * days without a fresh read. Never-read ones first, then the ones due a
 * fresh read, then the newest.
 */
async function shortsOn(c: Due, through: string, now: Date) {
  return admin((tx) => tx<{ id: string; youtube_id: string; posted_at: Date; day: string }[]>`
    select v.id, v.youtube_id, v.posted_at, (v.posted_at at time zone 'America/Los_Angeles')::date::text as day
    from public.videos v left join public.video_analytics a on a.video_id = v.id
    where v.channel_id = ${c.id} and v.user_id = ${c.user_id} and v.status = 'posted' and v.youtube_verified
      and v.youtube_id is not null and v.posted_at is not null
      and (v.posted_at at time zone 'America/Los_Angeles')::date <= ${through}::date
      and (a.video_id is null or v.posted_at > ${now}::timestamptz - interval '90 days' or a.fetched_at <= ${now}::timestamptz - interval '20 days')
    order by (a.video_id is null) desc, (a.fetched_at <= ${now}::timestamptz - interval '20 days') desc, v.posted_at desc
    limit ${SHORTS_A_READ}`);
}

/**
 * One channel's read, in order: the last day YouTube has reported (with
 * none in 90 days, nothing else is asked), revenue unless the monetary
 * scope was turned down, each Short's totals, who's watching, and Shorts
 * against long videos.
 */
async function readChannel(c: Due, access: string, now: Date): Promise<Read> {
  const ask = (q: ReportQuery) => () => analyticsReport(access, q, now);
  const today = pacificDay(now);
  const first = await must("first", ask({ startDate: addDays(today, -89), endDate: today, metrics: ["views"], dimensions: ["day"], sort: "day" }));
  const through = lastDay(first);
  const none: Read = { through, revenue: { readable: false, all: null, ads: null }, shorts: [], audience: null, shortsEngaged90: null, longHours365: null };
  if (!through) return none;
  const from90 = addDays(through, -89);

  // a refusal means revenue can't be read, never that there was none
  let revenue = none.revenue;
  if (hasScope(c.scopes, REVENUE_SCOPE) !== false) {
    const r = await may("revenue", ask({ startDate: from90, endDate: through, metrics: ["estimatedRevenue", "estimatedAdRevenue"] }));
    if (r) revenue = { readable: true, all: totalOf(r, "estimatedRevenue"), ads: totalOf(r, "estimatedAdRevenue") };
  }

  // each Short's totals since it went up; its revenue estimate only where YouTube estimates revenue for the channel
  const metrics = ["views", "engagedViews", "averageViewDuration", "averageViewPercentage", ...((revenue.all ?? 0) > 0 ? ["estimatedRevenue"] : [])];
  const shorts: ShortRow[] = [];
  const wanted = await shortsOn(c, through, now);
  for (let i = 0; i < wanted.length; i += SHORTS_A_QUERY) {
    const batch = wanted.slice(i, i + SHORTS_A_QUERY);
    const r = await must("other", ask({
      startDate: batch.map((s) => s.day).sort()[0], endDate: through, metrics, dimensions: ["video"],
      filters: `video==${batch.map((s) => s.youtube_id).join(",")}`, sort: "-views", maxResults: SHORTS_A_QUERY,
    }));
    const read = new Map(videoReadings(r).map((x) => [x.youtubeId, x]));
    for (const s of batch) {
      const x = read.get(s.youtube_id);
      if (!x) continue;
      const share = shareDue(s.posted_at, through) ? engagedShare(x.views, x.engaged) : null;
      shorts.push({ id: s.id, views: x.views, engaged: x.engaged, seconds: x.avgSeconds, percent: x.avgPercent, revenue: x.revenue, share });
    }
  }

  const viewers = await must("other", ask({ startDate: from90, endDate: through, metrics: ["viewerPercentage"], dimensions: ["ageGroup", "gender"], sort: "gender,ageGroup" }));
  // a 400 means YouTube didn't split Shorts from long videos for this channel
  const shortsSplit = await may("split", ask({ startDate: from90, endDate: through, metrics: ["engagedViews"], dimensions: ["creatorContentType"] }));
  const longSplit = await may("split", ask({ startDate: addDays(through, -364), endDate: through, metrics: ["estimatedMinutesWatched"], dimensions: ["creatorContentType"] }));
  const minutes = longSplit ? contentSplit(longSplit, "estimatedMinutesWatched") : null;
  return {
    through,
    revenue,
    shorts,
    audience: viewerRows(viewers),
    shortsEngaged90: shortsSplit ? (contentSplit(shortsSplit, "engagedViews")?.shorts ?? null) : null,
    longHours365: minutes ? minutes.long / 60 : null,
  };
}

/**
 * Everything a channel's read found, in one transaction. Nothing is kept
 * for a channel disconnected while it was read: it was read with access
 * the creator took back. Each Short's share is set once and kept.
 */
async function keep(c: Due, read: Read, subs: Subscribers | null, now: Date): Promise<boolean> {
  return admin(async (tx) => {
    const [ch] = await tx<{ status: string }[]>`select status from public.channels where id = ${c.id} for share`;
    if (!ch || ch.status === "revoked") return false;
    if (read.shorts.length) {
      await tx`
        insert into public.video_analytics (video_id, user_id, channel_id, through, views, engaged_views, avg_view_seconds, avg_view_percent, revenue, first_share, fetched_at)
        select v.id, v.user_id, v.channel_id, ${read.through}::date, r.views, r.engaged, r.seconds, r.percent, r.revenue, r.share, ${now}
        from jsonb_to_recordset(${tx.json(read.shorts)}::jsonb) as r (id uuid, views bigint, engaged bigint, seconds real, percent real, revenue numeric, share real)
        join public.videos v on v.id = r.id and v.channel_id = ${c.id}
        on conflict (video_id) do update set channel_id = excluded.channel_id, through = excluded.through, views = excluded.views,
          engaged_views = excluded.engaged_views, avg_view_seconds = excluded.avg_view_seconds, avg_view_percent = excluded.avg_view_percent,
          revenue = excluded.revenue, first_share = coalesce(video_analytics.first_share, excluded.first_share), fetched_at = excluded.fetched_at`;
    }
    const figures = {
      through: read.through,
      problem: null,
      revenue_readable: read.through ? read.revenue.readable : null,
      revenue_90d: read.revenue.all,
      ad_revenue_90d: read.revenue.ads,
      subscribers: subs?.subscribers ?? null,
      subscribers_hidden: subs?.hidden ?? false,
      shorts_engaged_90d: read.shortsEngaged90,
      long_hours_365d: read.longHours365,
      audience: read.audience ? tx.json(read.audience) : null,
      synced_at: now,
    };
    await tx`
      insert into public.channel_analytics ${tx({ channel_id: c.id, user_id: c.user_id, tried_at: now, ...figures })}
      on conflict (channel_id) do update set ${tx(figures)}`;
    return true;
  });
}

/** A channel's read that didn't work: it keeps what it had. One stopped by a limit goes first next time. */
async function noteProblem(c: Due, problem: Problem): Promise<void> {
  await admin((tx) => (problem === "quota"
    ? tx`update public.channel_analytics set problem = 'quota', tried_at = null where channel_id = ${c.id}`
    : tx`update public.channel_analytics set problem = ${problem} where channel_id = ${c.id}`));
}

/** One channel's subscribers through its own access, without the API key: unknown when that doesn't work. */
async function ownSubscribers(c: Due, access: string, now: Date): Promise<Subscribers | null> {
  try {
    return (await youtubeSubscribers([c.external_id], access, now)).get(c.external_id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads YouTube Analytics for the channels that are due, up to `limit` of
 * them and none started after `budgetMs`, so a scheduler's call always
 * finishes. Lapsed numbers go first, even when Google isn't set up. A
 * limit stops the run, since the allowance is the whole app's. For the
 * worker every hour, and /api/cron/analytics.
 */
export async function syncAnalytics(now = new Date(), limit = 40, budgetMs = 150_000): Promise<string[]> {
  const log = await forgetLapsed(now);
  if (!configured().youtube) return log;
  const started = Date.now();
  const due = await admin((tx) => tx<Due[]>`
    select c.id, c.user_id, c.external_id, t.scopes from public.channels c
    join public.channel_tokens t on t.channel_id = c.id
    left join public.channel_analytics a on a.channel_id = c.id
    where c.platform = 'youtube' and c.status = 'connected'
      and (a.tried_at is null or a.tried_at < ${now}::timestamptz - make_interval(hours => ${DUE_HOURS}) or a.tried_at < c.connected_at)
    order by a.tried_at nulls first, c.connected_at, c.id
    limit ${limit}`);
  const withKey = !!env().YOUTUBE_API_KEY;
  let subscribers: Map<string, Subscribers> | null = null;
  for (const [i, c] of due.entries()) {
    if (Date.now() - started > budgetMs) break;
    // with the API key, 50 channels' subscribers in one call, just before they're read; unknown this run if it fails
    if (withKey && i % CHANNELS_A_CALL === 0) {
      subscribers = await youtubeSubscribers(due.slice(i, i + CHANNELS_A_CALL).map((d) => d.external_id), undefined, now).catch(() => null);
    }
    if (!(await claim(c, now))) continue;
    try {
      if (hasScope(c.scopes, ANALYTICS_SCOPE) === false) throw new Unread("scope", "YouTube Analytics wasn't allowed when it was connected");
      // a token Google has revoked marks the channel as needing reconnecting
      const access = await must("access", () => youtubeAccess(c.id));
      const read = await readChannel(c, access, now);
      const subs = withKey ? (subscribers?.get(c.external_id) ?? null) : await ownSubscribers(c, access, now);
      log.push((await keep(c, read, subs, now))
        ? `analytics ${c.id}: ${read.shorts.length} Shorts, ${read.through ? `through ${read.through}` : "no views reported in 90 days"}`
        : `analytics ${c.id}: disconnected while it was read, so nothing was kept`);
    } catch (e) {
      const u = e instanceof Unread ? e : new Unread("error", e instanceof Error ? e.message : String(e));
      await noteProblem(c, u.problem);
      if (u.problem === "quota") {
        log.push(`analytics wait for YouTube's limit: ${u.message}`);
        break;
      }
      log.push(`analytics ${c.id}: ${u.problem}${u.problem === "error" ? ` (${u.message})` : ""}`);
    }
  }
  return log;
}

/**
 * Deletes what Hookline can no longer read: each Short's numbers 30 days
 * after YouTube last gave them, and a channel's own 30 days after its last
 * full read. The channel's row and its problem stay, so the screen can
 * still say why.
 */
export async function forgetLapsed(now = new Date()): Promise<string[]> {
  return admin(async (tx) => {
    const shorts = await tx`delete from public.video_analytics where fetched_at < ${now}::timestamptz - interval '30 days' returning video_id`;
    const channels = await tx`
      update public.channel_analytics set through = null, revenue_readable = null, revenue_90d = null, ad_revenue_90d = null,
        subscribers = null, subscribers_hidden = false, shorts_engaged_90d = null, long_hours_365d = null, audience = null, synced_at = null
      where synced_at < ${now}::timestamptz - interval '30 days'
      returning channel_id`;
    const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
    return [
      ...(shorts.length ? [`analytics forgot ${n(shorts.length, "Short's", "Shorts'")} numbers, not read in 30 days`] : []),
      ...(channels.length ? [`analytics forgot ${n(channels.length, "channel's", "channels'")} numbers, not read in 30 days`] : []),
    ];
  });
}

/** One YouTube channel's YouTube Analytics, for Earnings and a Short's page. */
export type ChannelProof = {
  id: string;
  /** what to call it, telling apart channels with the same name */
  title: string;
  status: "connected" | "expired";
  /** why the last try didn't read it, if it didn't; not allowed or access lost no longer count once it's been connected again since */
  problem: Problem | null;
  /** when it was last read in full, and the last day YouTube had reported then */
  syncedAt: Date | null;
  through: string | null;
  /** whether its revenue can be read; null before it's been read */
  revenueReadable: boolean | null;
  /** YouTube estimates revenue for it in those 90 days, and ad revenue */
  earns: boolean;
  sharesAds: boolean;
  /** its figures against the Partner Program's bars; uploads are the public ones Hookline knows of in the last 90 days */
  numbers: ChannelNumbers;
  /** whether YouTube split its Shorts from its long videos */
  split: boolean;
  subscribersHidden: boolean;
  audience: Audience | null;
  /** its made-for-kids answer, YouTube's verdict when it was connected, and its posted Shorts' answers and YouTube's verdicts on them */
  kids: { answer: boolean | null; youtubeAtConnect: boolean | null; no: number; yes: number; unknown: number; youtubeMarked: number };
};

type ProofRow = {
  id: string; title: string | null; handle: string | null; status: "connected" | "expired"; made_for_kids: boolean | null; youtube_kids: boolean | null;
  problem: Problem | null; synced_at: Date | null; through: string | null; revenue_readable: boolean | null; revenue_90d: number | null; ad_revenue_90d: number | null;
  subscribers: number | null; subscribers_hidden: boolean; shorts_engaged_90d: number | null; long_hours_365d: number | null; audience: ViewerRow[] | null;
  no: number; yes: number; unknown: number; marked: number; uploads: number;
};

/** Each of their YouTube channels that isn't disconnected, read or not, as they see it. */
export async function proofOf(userId: string, now = new Date()): Promise<ChannelProof[]> {
  const rows = await asUser(userId, (tx) => tx<ProofRow[]>`
    select c.id, c.title, c.handle, c.status, c.made_for_kids, c.youtube_kids,
      case when a.problem in ('scope', 'access') and a.tried_at < c.connected_at then null else a.problem end as problem,
      a.synced_at, a.through::text as through, a.revenue_readable, a.revenue_90d::float8 as revenue_90d, a.ad_revenue_90d::float8 as ad_revenue_90d,
      a.subscribers::float8 as subscribers, coalesce(a.subscribers_hidden, false) as subscribers_hidden, a.shorts_engaged_90d::float8 as shorts_engaged_90d,
      a.long_hours_365d, a.audience, k.no, k.yes, k.unknown, k.marked, k.uploads
    from public.channels c
    left join public.channel_analytics a on a.channel_id = c.id
    cross join lateral (
      select count(*) filter (where v.made_for_kids = false)::int as no, count(*) filter (where v.made_for_kids)::int as yes,
        count(*) filter (where v.made_for_kids is null)::int as unknown, count(*) filter (where v.youtube_kids)::int as marked,
        count(*) filter (where v.youtube_verified and coalesce(v.youtube_privacy, 'public') = 'public'
          and v.posted_at > ${now}::timestamptz - interval '90 days')::int as uploads
      from public.videos v where v.channel_id = c.id and v.user_id = c.user_id and v.status = 'posted'
    ) k
    where c.user_id = ${userId} and c.platform = 'youtube' and c.status <> 'revoked'
    order by c.added_at, c.id`);
  const names = channelNames(rows);
  return rows.map((r) => ({
    id: r.id,
    title: names.get(r.id)!,
    status: r.status,
    problem: r.problem,
    syncedAt: r.synced_at,
    through: r.through,
    revenueReadable: r.revenue_readable,
    earns: (r.revenue_90d ?? 0) > 0,
    sharesAds: (r.ad_revenue_90d ?? 0) > 0,
    numbers: { subscribers: r.subscribers_hidden ? null : r.subscribers, uploads90: r.uploads, shortsViews90: r.shorts_engaged_90d, longHours365: r.long_hours_365d },
    split: r.shorts_engaged_90d !== null || r.long_hours_365d !== null,
    subscribersHidden: r.subscribers_hidden,
    audience: audienceOf(r.audience),
    kids: { answer: r.made_for_kids, youtubeAtConnect: r.youtube_kids, no: r.no, yes: r.yes, unknown: r.unknown, youtubeMarked: r.marked },
  }));
}

/**
 * For /admin, counts only: YouTube channels, how many were read in the
 * last day, and how many can't be read and why. Never anyone's numbers.
 * Not allowed or access lost no longer count once a channel's been
 * connected again since, as on Earnings.
 */
export async function analyticsHealth(now = new Date()): Promise<Health> {
  const [h] = await admin((tx) => tx<Health[]>`
    select count(*)::int as channels,
      count(*) filter (where a.synced_at > ${now}::timestamptz - interval '1 day')::int as read,
      count(*) filter (where c.status = 'connected' and a.problem = 'scope' and not coalesce(a.tried_at < c.connected_at, false))::int as scope,
      count(*) filter (where c.status = 'expired' or (a.problem = 'access' and not coalesce(a.tried_at < c.connected_at, false)))::int as access,
      count(*) filter (where c.status = 'connected' and a.problem in ('quota', 'error'))::int as failing
    from public.channels c left join public.channel_analytics a on a.channel_id = c.id
    where c.platform = 'youtube' and c.status in ('connected', 'expired')`);
  return h;
}
