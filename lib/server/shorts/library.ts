import "server-only";
import type { HeldBack } from "../../shorts/history";
import { insights, type Insights, type Measure } from "../../shorts/insights";
import { againstUsual, median, usualShare, type Weight } from "../../shorts/learn";
import { audienceOf, type Problem, type ViewerRow } from "../../shorts/proof";
import type { ShortFormat, Spec } from "../../shorts/types";
import { shownChannelNames } from "../channels";
import { asUser, type Tx } from "../db";
import { noShareComing } from "./stats";
import { weightsFor } from "./weights";

/**
 * Every Short someone has said yes to, for the library, the calendar and
 * each Short's own page, with how it did against the usual Short on its
 * own channel, the learning loop's own measure, and what YouTube Analytics
 * has said about it. The library and the calendar can show one channel's
 * Shorts on their own.
 */

export const SHOWN = ["approved", "rendering", "ready", "scheduled", "posted", "failed"] as const;
export type ShortStatus = (typeof SHOWN)[number];

export const FILTERS = { all: SHOWN, posted: ["posted"], coming: ["approved", "rendering", "ready", "scheduled"], failed: ["failed"] } as const;
export type Filter = keyof typeof FILTERS;

export type LibraryItem = {
  id: string;
  /** the YouTube channel it's for, or null for one made before the account had a channel */
  channelId: string | null;
  title: string;
  format: ShortFormat;
  status: ShortStatus;
  /** when it posted, or posts, or was approved */
  at: Date;
  youtubeId: string | null;
  onTikTok: boolean;
  /** its plays at the latest checkpoint: what YouTube now shows as views, every time it starts */
  views: number | null;
  /** YouTube Analytics' totals for it, plays and engaged views, up to the last day YouTube had reported, once it's been read */
  analytics: { plays: number; engaged: number; through: string } | null;
  /** its first day against its channel's usual one, once there's a usual */
  vsUsual: number | null;
  /** whether that went by engaged views (it has its own engaged share, and the channel a usual one) or by plays */
  vsBy: "engaged" | "plays" | null;
  /** the first day was read late and scaled back to 24 hours, so `vsUsual` is an estimate */
  vsEstimated: boolean;
};

/** A channel's usual first day: the middle of its plays, and of the shares of them YouTube counted as engaged once 3 have one. */
export type Typical = { plays: number; share: number | null };

/**
 * Each channel's usual Short: the middle of its last 30 first days that
 * were read on time, once there are 3, so it's plays a first day really
 * had, with the middle of their engaged shares once 3 of them have one.
 * Readings taken late only steer the learning loop. Shorts with no
 * channel have a usual of their own, kept under null.
 */
async function typicalsOf(tx: Tx, userId: string, except?: string): Promise<Map<string | null, Typical | null>> {
  const rows = await tx<{ channel_id: string | null; views: string; share: number | null }[]>`
    select channel_id, views, share from (
      select v.channel_id, s.views, a.first_share as share, row_number() over (partition by v.channel_id order by s.fetched_at desc) as n
      from public.video_stats s join public.videos v on v.id = s.video_id
      left join public.video_analytics a on a.video_id = v.id
      where v.user_id = ${userId} and s.checkpoint = '24h' and s.fetched_at <= v.posted_at + interval '26 hours' ${except ? tx`and v.id <> ${except}` : tx``}
    ) r where n <= 30`;
  const by = new Map<string | null, { plays: number[]; shares: (number | null)[] }>();
  for (const r of rows) {
    const b = by.get(r.channel_id) ?? { plays: [], shares: [] };
    by.set(r.channel_id, { plays: [...b.plays, Number(r.views)], shares: [...b.shares, r.share] });
  }
  return new Map([...by].map(([id, b]) => [id, b.plays.length >= 3 ? { plays: median(b.plays)!, share: usualShare(b.shares) } : null]));
}

type Row = {
  id: string; channel_id: string | null; title: string; format: ShortFormat; status: ShortStatus; at: Date; youtube_id: string | null; tiktok_publish_id: string | null;
  views: string | null; day: string | null; day_hours: number | null;
  analytics_plays: string | null; analytics_engaged: string | null; analytics_through: string | null; first_share: number | null;
};

function toItem(r: Row, typical: Typical | null): LibraryItem {
  const day = r.day === null ? null : Number(r.day);
  // by engaged views once YouTube has given it its own share and the channel has a usual one, by plays until then
  const vs = day !== null && typical ? againstUsual(day, r.day_hours ?? 24, typical.plays, r.first_share, typical.share) : null;
  return {
    id: r.id,
    channelId: r.channel_id,
    title: r.title,
    format: r.format,
    status: r.status,
    at: r.at,
    youtubeId: r.youtube_id,
    onTikTok: r.tiktok_publish_id !== null,
    views: r.views === null ? null : Number(r.views),
    analytics: r.analytics_through === null ? null : { plays: Number(r.analytics_plays), engaged: Number(r.analytics_engaged), through: r.analytics_through },
    vsUsual: vs?.vs ?? null,
    vsBy: vs?.by ?? null,
    vsEstimated: vs?.estimated ?? false,
  };
}

const PAGE = 24;

/** `channel` shows only the Shorts made for that YouTube channel. */
export async function libraryOf(
  userId: string, opts: { filter?: Filter; format?: ShortFormat | null; q?: string; page?: number; channel?: string | null } = {},
): Promise<{ items: LibraryItem[]; total: number; page: number; pages: number }> {
  const statuses = FILTERS[opts.filter ?? "all"];
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim().slice(0, 80) ?? "";
  return asUser(userId, async (tx) => {
    const where = tx`
      v.user_id = ${userId} and v.status in ${tx(statuses as readonly string[])}
      ${opts.format ? tx`and v.format = ${opts.format}` : tx``}
      ${opts.channel ? tx`and v.channel_id = ${opts.channel}` : tx``}
      ${q ? tx`and v.title ilike ${`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}` : tx``}`;
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.videos v where ${where}`;
    const rows = await tx<Row[]>`
      select v.id, v.channel_id, v.title, v.format, v.status, coalesce(v.posted_at, v.scheduled_for, v.decided_at, v.created_at) as at,
        v.youtube_id, v.tiktok_publish_id,
        (select s.views from public.video_stats s where s.video_id = v.id order by array_position(array['72h', '24h', '1h'], s.checkpoint) limit 1) as views,
        d.views as day, d.hours as day_hours,
        a.views as analytics_plays, a.engaged_views as analytics_engaged, a.through::text as analytics_through, a.first_share
      from public.videos v
      left join lateral (
        select s.views, extract(epoch from s.fetched_at - v.posted_at)::float8 / 3600 as hours from public.video_stats s where s.video_id = v.id and s.checkpoint = '24h'
      ) d on true
      left join public.video_analytics a on a.video_id = v.id
      where ${where}
      order by coalesce(v.posted_at, v.scheduled_for, v.decided_at, v.created_at) desc
      limit ${PAGE} offset ${(page - 1) * PAGE}`;
    const typicals = await typicalsOf(tx, userId);
    return { items: rows.map((r) => toItem(r, typicals.get(r.channel_id) ?? null)), total: n, page, pages: Math.max(1, Math.ceil(n / PAGE)) };
  });
}

export type CalendarItem = { id: string; channelId: string | null; title: string; format: ShortFormat; status: ShortStatus; at: Date; youtubeId: string | null; tiktok: boolean };

/** Shorts posting or posted between two moments: the calendar's month, for every channel or only `channel`. */
export async function calendarOf(userId: string, from: Date, to: Date, channel?: string | null): Promise<CalendarItem[]> {
  const rows = await asUser(userId, (tx) => tx<{ id: string; channel_id: string | null; title: string; format: ShortFormat; status: ShortStatus; at: Date; youtube_id: string | null; tiktok: boolean }[]>`
    select id, channel_id, title, format, status, coalesce(posted_at, scheduled_for) as at, youtube_id,
      (tiktok_publish_id is not null or (tiktok_post is not null and tiktok_error is null)) as tiktok
    from public.videos
    where user_id = ${userId} and status in ${tx(SHOWN as readonly string[])} ${channel ? tx`and channel_id = ${channel}` : tx``}
      and coalesce(posted_at, scheduled_for) >= ${from} and coalesce(posted_at, scheduled_for) < ${to}
    order by 6`);
  return rows.map((r) => ({ id: r.id, channelId: r.channel_id, title: r.title, format: r.format, status: r.status, at: r.at, youtubeId: r.youtube_id, tiktok: r.tiktok }));
}

export type ShortDetail = {
  id: string;
  /** the YouTube channel it's for, or null for one made before the account had a channel */
  channelId: string | null;
  spec: Spec;
  title: string;
  description: string;
  why: string[];
  status: ShortStatus | "review" | "rejected";
  origin: "daily" | "replacement";
  createdAt: Date;
  decidedAt: Date | null;
  scheduledFor: Date | null;
  postedAt: Date | null;
  uploadedAt: Date | null;
  /** when it went up private until its time: that time */
  publishAt: Date | null;
  youtubeId: string | null;
  tiktokPublishId: string | null;
  tiktokPostedAt: Date | null;
  tiktok: { at: Date | null; error: string | null } | null;
  error: string | null;
  /** what's holding it back from going up, and when it's tried again, while that's still to come */
  heldBack: HeldBack | null;
  hasFile: boolean;
  /** TikTok's copy, without the free plan's tag: made, or being made */
  tiktokFile: boolean;
  cleaning: boolean;
  /** who it's for, as approved; what YouTube says about it; and whether its link was checked to be on their channel */
  madeForKids: boolean | null;
  youtubeKids: boolean | null;
  youtubePrivacy: string | null;
  verified: boolean;
  render: { status: string; progress: number; finishedAt: Date | null; error: string | null } | null;
  /** its plays at each checkpoint: what YouTube now shows as views */
  views: Partial<Record<"1h" | "24h" | "72h", number>>;
  /** how many hours after posting each reading was really taken */
  readAt: Partial<Record<"1h" | "24h" | "72h", number>>;
  /** its channel's usual first day in plays, not counting its own */
  typical: number | null;
  /** the share of its channel's usual first day YouTube counted as engaged, once 3 Shorts there have one; not counting its own */
  usualShare: number | null;
  /** the share of its own first day's plays YouTube counted as engaged, once YouTube has reported its first two days */
  firstShare: number | null;
  /** how the learning loop compared its first day: by engaged views or by plays, or null before that or when it only started the baseline */
  learnedOn: "engaged" | "plays" | null;
  /** read at 24 hours and not learned from yet, waiting for its engaged views, which its channel can still give */
  waiting: boolean;
  /** what YouTube Analytics has said about it, up to the last day YouTube had reported */
  analytics: { through: string; plays: number; engaged: number; avgSeconds: number | null; avgPercent: number | null; revenue: number | null } | null;
  /** the channel it's on, why its YouTube Analytics can't be read if they can't, whether YouTube estimates revenue for it, and its biggest group of viewers */
  channel: { id: string; title: string; status: "connected" | "expired" | "revoked"; problem: Problem | null; earns: boolean; largest: { age: string; percent: number } | null } | null;
};

/** One Short, with everything that's happened to it; null when it isn't theirs. */
export async function shortOf(userId: string, id: string, now = new Date()): Promise<ShortDetail | null> {
  return asUser(userId, async (tx) => {
    const [v] = await tx<{
      id: string; channel_id: string | null; format: ShortFormat; params: Spec["params"]; title: string; description: string; why: string[]; status: ShortDetail["status"]; origin: ShortDetail["origin"];
      created_at: Date; decided_at: Date | null; scheduled_for: Date | null; posted_at: Date | null; uploaded_at: Date | null; youtube_publish_at: Date | null; youtube_id: string | null;
      tiktok_publish_id: string | null; tiktok_posted_at: Date | null; tiktok_post: unknown; tiktok_at: Date | null; tiktok_error: string | null; error: string | null; file_path: string | null;
      tiktok_file: boolean; made_for_kids: boolean | null; youtube_kids: boolean | null; youtube_privacy: string | null; youtube_verified: boolean;
      waiting_on: HeldBack["on"] | null; waiting_until: Date | null;
    }[]>`
      select id, channel_id, format, params, title, description, why, status, origin, created_at, decided_at, scheduled_for, posted_at, uploaded_at, youtube_publish_at, youtube_id,
        tiktok_publish_id, tiktok_posted_at, tiktok_post, tiktok_at, tiktok_error, error, file_path,
        clean_path is not null as tiktok_file, made_for_kids, youtube_kids, youtube_privacy, youtube_verified, waiting_until,
        case when status = 'ready' and waiting_until > now() then waiting_on end as waiting_on
      from public.videos where id = ${id} and user_id = ${userId}`;
    if (!v) return null;
    const [job] = await tx<{ status: string; progress: number; finished_at: Date | null; error: string | null }[]>`
      select status, progress, finished_at, error from public.render_jobs where video_id = ${id} and not clean order by id desc limit 1`;
    const [cleaning] = await tx`select 1 from public.render_jobs where video_id = ${id} and clean and status in ('queued', 'running')`;
    const stats = await tx<{ checkpoint: "1h" | "24h" | "72h"; views: string; hours: number | null }[]>`
      select s.checkpoint, s.views, extract(epoch from s.fetched_at - v.posted_at)::float8 / 3600 as hours
      from public.video_stats s join public.videos v on v.id = s.video_id where s.video_id = ${id}`;
    const typical = (await typicalsOf(tx, userId, id)).get(v.channel_id) ?? null;
    return {
      id: v.id,
      channelId: v.channel_id,
      spec: { format: v.format, params: v.params } as Spec,
      title: v.title,
      description: v.description,
      why: v.why,
      status: v.status,
      origin: v.origin,
      createdAt: v.created_at,
      decidedAt: v.decided_at,
      scheduledFor: v.scheduled_for,
      postedAt: v.posted_at,
      uploadedAt: v.uploaded_at,
      publishAt: v.youtube_publish_at,
      youtubeId: v.youtube_id,
      tiktokPublishId: v.tiktok_publish_id,
      tiktokPostedAt: v.tiktok_posted_at,
      tiktok: v.tiktok_post ? { at: v.tiktok_at, error: v.tiktok_error } : null,
      error: v.error,
      heldBack: v.waiting_on ? { on: v.waiting_on, until: v.waiting_until } : null,
      hasFile: v.file_path !== null,
      tiktokFile: v.tiktok_file,
      cleaning: !!cleaning,
      madeForKids: v.made_for_kids,
      youtubeKids: v.youtube_kids,
      youtubePrivacy: v.youtube_privacy,
      verified: v.youtube_verified,
      render: job ? { status: job.status, progress: job.progress, finishedAt: job.finished_at, error: job.error } : null,
      views: Object.fromEntries(stats.map((s) => [s.checkpoint, Number(s.views)])),
      readAt: Object.fromEntries(stats.filter((s) => s.hours !== null).map((s) => [s.checkpoint, s.hours!])),
      typical: typical?.plays ?? null,
      usualShare: typical?.share ?? null,
      ...(await analyticsOf(tx, userId, id, v.channel_id, now)),
    };
  });
}

/**
 * What a Short's page shows of YouTube Analytics and its learning: its
 * own engaged share and how its first day was learned (or that it's still
 * waiting for its engaged views), YouTube Analytics' totals for it, and
 * its channel's state there.
 */
async function analyticsOf(tx: Tx, userId: string, id: string, channelId: string | null, now: Date): Promise<Pick<ShortDetail, "firstShare" | "learnedOn" | "waiting" | "analytics" | "channel">> {
  const [a] = await tx<{ through: string; views: string; engaged_views: string; avg_view_seconds: number | null; avg_view_percent: number | null; revenue: number | null; first_share: number | null }[]>`
    select through::text as through, views, engaged_views, avg_view_seconds, avg_view_percent, revenue::float8 as revenue, first_share
    from public.video_analytics where video_id = ${id}`;
  // waiting while learnDue would still wait for it: it hasn't got its share, and one can still come
  const [day] = await tx<{ learned_on: "engaged" | "plays" | null; waiting: boolean }[]>`
    select s.learned_on, (s.learned_at is null and a.first_share is null and v.status = 'posted' and v.youtube_verified
        and coalesce(v.youtube_privacy, 'public') = 'public' and not ${noShareComing(tx, now)}) as waiting
    from public.video_stats s
    join public.videos v on v.id = s.video_id
    left join public.channels ch on ch.id = v.channel_id
    left join public.channel_analytics c on c.channel_id = v.channel_id
    left join public.video_analytics a on a.video_id = v.id
    where s.video_id = ${id} and s.checkpoint = '24h'`;
  // not allowed or access lost no longer count once the channel's been connected again since, as on Earnings
  const [ch] = channelId
    ? await tx<{ id: string; status: "connected" | "expired" | "revoked"; problem: Problem | null; revenue_90d: number | null; audience: ViewerRow[] | null }[]>`
        select c.id, c.status, case when a.problem in ('scope', 'access') and a.tried_at < c.connected_at then null else a.problem end as problem,
          a.revenue_90d::float8 as revenue_90d, a.audience
        from public.channels c left join public.channel_analytics a on a.channel_id = c.id
        where c.id = ${channelId} and c.user_id = ${userId}`
    : [];
  const largest = ch ? audienceOf(ch.audience)?.largest : undefined;
  return {
    firstShare: a?.first_share ?? null,
    learnedOn: day?.learned_on ?? null,
    waiting: day?.waiting ?? false,
    analytics: a
      ? { through: a.through, plays: Number(a.views), engaged: Number(a.engaged_views), avgSeconds: a.avg_view_seconds, avgPercent: a.avg_view_percent, revenue: a.revenue }
      : null,
    channel: ch
      ? {
          id: ch.id,
          title: (await shownChannelNames(tx, userId)).get(ch.id) ?? "Your channel",
          status: ch.status,
          problem: ch.problem,
          earns: (ch.revenue_90d ?? 0) > 0,
          largest: largest ? { age: largest.label, percent: largest.percent } : null,
        }
      : null,
  };
}

/**
 * What's working so far. For one channel (`channelId`), its own results
 * against its own usual Short, with its odds pulled toward what the
 * account's other channels found, as its picks are. Otherwise the
 * account's results across all its channels, with the usual Short only
 * while the account's Shorts are all on one channel (or none), since each
 * channel has its own. Either way, which measure those results went by.
 */
export async function insightsFor(userId: string, channelId?: string | null): Promise<Insights & { typical: number | null }> {
  return asUser(userId, async (tx) => {
    const typicals = await typicalsOf(tx, userId);
    const measure = await measureOf(tx, userId, channelId ?? null);
    if (channelId) return { ...insights(await weightsFor(tx, channelId), measure), typical: typicals.get(channelId)?.plays ?? null };
    const weights = await tx<Weight[]>`select kind, name, score, samples from public.weights where user_id = ${userId}`;
    return { ...insights(weights, measure), typical: typicals.size === 1 ? ([...typicals.values()][0]?.plays ?? null) : null };
  });
}

/**
 * How the last 30 first days the learning loop compared went: how many by
 * engaged views and how many by plays, on one channel or the whole
 * account. Ones that only started a baseline compared nothing, so they
 * aren't counted.
 */
async function measureOf(tx: Tx, userId: string, channelId: string | null): Promise<Measure> {
  const [m] = await tx<Measure[]>`
    select count(*) filter (where learned_on = 'engaged')::int as engaged, count(*) filter (where learned_on = 'plays')::int as plays
    from (
      select s.learned_on from public.video_stats s join public.videos v on v.id = s.video_id
      where v.user_id = ${userId} ${channelId ? tx`and v.channel_id = ${channelId}` : tx``}
        and s.checkpoint = '24h' and s.learned_at is not null and s.learned_on is not null
      order by s.learned_at desc limit 30
    ) r`;
  return m;
}
