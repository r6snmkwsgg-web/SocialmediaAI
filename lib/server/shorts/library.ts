import "server-only";
import type { HeldBack } from "../../shorts/history";
import { insights, type Insights } from "../../shorts/insights";
import { againstUsual, median, type Weight } from "../../shorts/learn";
import type { FormatId, Spec } from "../../shorts/types";
import { asUser, type Tx } from "../db";
import { weightsFor } from "./weights";

/**
 * Every Short someone has said yes to, for the library, the calendar and
 * each Short's own page, with how it did against the usual Short on its
 * own channel, the learning loop's own measure. The library and the
 * calendar can show one channel's Shorts on their own.
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
  format: FormatId;
  status: ShortStatus;
  /** when it posted, or posts, or was approved */
  at: Date;
  youtubeId: string | null;
  onTikTok: boolean;
  views: number | null;
  /** its first day against its channel's usual one, once there's a usual */
  vsUsual: number | null;
  /** the first day was read late and scaled back to 24 hours, so `vsUsual` is an estimate */
  vsEstimated: boolean;
};

/**
 * Each channel's usual Short: the middle of its last 30 first days that
 * were read on time, once there are 3, so it's views a first day really
 * had. Readings taken late only steer the learning loop. Shorts with no
 * channel have a usual of their own, kept under null.
 */
async function typicalsOf(tx: Tx, userId: string, except?: string): Promise<Map<string | null, number | null>> {
  const rows = await tx<{ channel_id: string | null; views: string }[]>`
    select channel_id, views from (
      select v.channel_id, s.views, row_number() over (partition by v.channel_id order by s.fetched_at desc) as n
      from public.video_stats s join public.videos v on v.id = s.video_id
      where v.user_id = ${userId} and s.checkpoint = '24h' and s.fetched_at <= v.posted_at + interval '26 hours' ${except ? tx`and v.id <> ${except}` : tx``}
    ) r where n <= 30`;
  const by = new Map<string | null, number[]>();
  for (const r of rows) by.set(r.channel_id, [...(by.get(r.channel_id) ?? []), Number(r.views)]);
  return new Map([...by].map(([id, views]) => [id, views.length >= 3 ? median(views) : null]));
}

type Row = {
  id: string; channel_id: string | null; title: string; format: FormatId; status: ShortStatus; at: Date; youtube_id: string | null; tiktok_publish_id: string | null;
  views: string | null; day: string | null; day_hours: number | null;
};

function toItem(r: Row, typical: number | null): LibraryItem {
  const day = r.day === null ? null : Number(r.day);
  const vs = day !== null && typical !== null ? againstUsual(day, r.day_hours ?? 24, typical) : null;
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
    vsUsual: vs?.vs ?? null,
    vsEstimated: vs?.estimated ?? false,
  };
}

const PAGE = 24;

/** `channel` shows only the Shorts made for that YouTube channel. */
export async function libraryOf(
  userId: string, opts: { filter?: Filter; format?: FormatId | null; q?: string; page?: number; channel?: string | null } = {},
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
        d.views as day, d.hours as day_hours
      from public.videos v
      left join lateral (
        select s.views, extract(epoch from s.fetched_at - v.posted_at)::float8 / 3600 as hours from public.video_stats s where s.video_id = v.id and s.checkpoint = '24h'
      ) d on true
      where ${where}
      order by coalesce(v.posted_at, v.scheduled_for, v.decided_at, v.created_at) desc
      limit ${PAGE} offset ${(page - 1) * PAGE}`;
    const typicals = await typicalsOf(tx, userId);
    return { items: rows.map((r) => toItem(r, typicals.get(r.channel_id) ?? null)), total: n, page, pages: Math.max(1, Math.ceil(n / PAGE)) };
  });
}

export type CalendarItem = { id: string; channelId: string | null; title: string; format: FormatId; status: ShortStatus; at: Date; youtubeId: string | null; tiktok: boolean };

/** Shorts posting or posted between two moments: the calendar's month, for every channel or only `channel`. */
export async function calendarOf(userId: string, from: Date, to: Date, channel?: string | null): Promise<CalendarItem[]> {
  const rows = await asUser(userId, (tx) => tx<{ id: string; channel_id: string | null; title: string; format: FormatId; status: ShortStatus; at: Date; youtube_id: string | null; tiktok: boolean }[]>`
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
  views: Partial<Record<"1h" | "24h" | "72h", number>>;
  /** how many hours after posting each reading was really taken */
  readAt: Partial<Record<"1h" | "24h" | "72h", number>>;
  /** its channel's usual first day, not counting its own */
  typical: number | null;
};

/** One Short, with everything that's happened to it; null when it isn't theirs. */
export async function shortOf(userId: string, id: string): Promise<ShortDetail | null> {
  return asUser(userId, async (tx) => {
    const [v] = await tx<{
      id: string; channel_id: string | null; format: FormatId; params: Spec["params"]; title: string; description: string; why: string[]; status: ShortDetail["status"]; origin: ShortDetail["origin"];
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
      typical: (await typicalsOf(tx, userId, id)).get(v.channel_id) ?? null,
    };
  });
}

/**
 * What's working so far. For one channel (`channelId`), its own results
 * against its own usual Short, with its odds pulled toward what the
 * account's other channels found, as its picks are. Otherwise the
 * account's results across all its channels, with the usual Short only
 * while the account's Shorts are all on one channel (or none), since each
 * channel has its own.
 */
export async function insightsFor(userId: string, channelId?: string | null): Promise<Insights & { typical: number | null }> {
  return asUser(userId, async (tx) => {
    const typicals = await typicalsOf(tx, userId);
    if (channelId) return { ...insights(await weightsFor(tx, channelId)), typical: typicals.get(channelId) ?? null };
    const weights = await tx<Weight[]>`select kind, name, score, samples from public.weights where user_id = ${userId}`;
    return { ...insights(weights), typical: typicals.size === 1 ? [...typicals.values()][0] : null };
  });
}
