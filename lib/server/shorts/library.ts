import "server-only";
import { insights, type Insights } from "../../shorts/insights";
import { lift, median, type Weight } from "../../shorts/learn";
import type { FormatId, Spec } from "../../shorts/types";
import { asUser, type Tx } from "../db";

/**
 * Every Short someone has said yes to, for the library, the calendar and
 * each Short's own page, with how it did against their usual Short.
 */

export const SHOWN = ["approved", "rendering", "ready", "scheduled", "posted", "failed"] as const;
export type ShortStatus = (typeof SHOWN)[number];

export const FILTERS = { all: SHOWN, posted: ["posted"], coming: ["approved", "rendering", "ready", "scheduled"], failed: ["failed"] } as const;
export type Filter = keyof typeof FILTERS;

export type LibraryItem = {
  id: string;
  title: string;
  format: FormatId;
  status: ShortStatus;
  /** when it posted, or posts, or was approved */
  at: Date;
  youtubeId: string | null;
  onTikTok: boolean;
  views: number | null;
  /** its first day against the channel's usual one, once there's a usual */
  vsUsual: number | null;
};

/** The channel's usual Short: the middle of its last 30 results at 24 hours, once there are 3. */
async function typicalOf(tx: Tx, userId: string, except?: string): Promise<number | null> {
  const rows = await tx<{ views: string }[]>`
    select s.views from public.video_stats s join public.videos v on v.id = s.video_id
    where v.user_id = ${userId} and s.checkpoint = '24h' ${except ? tx`and v.id <> ${except}` : tx``}
    order by s.fetched_at desc limit 30`;
  return rows.length >= 3 ? median(rows.map((r) => Number(r.views))) : null;
}

type Row = { id: string; title: string; format: FormatId; status: ShortStatus; at: Date; youtube_id: string | null; tiktok_publish_id: string | null; views: string | null; day: string | null };

function toItem(r: Row, typical: number | null): LibraryItem {
  const day = r.day === null ? null : Number(r.day);
  return {
    id: r.id,
    title: r.title,
    format: r.format,
    status: r.status,
    at: r.at,
    youtubeId: r.youtube_id,
    onTikTok: r.tiktok_publish_id !== null,
    views: r.views === null ? null : Number(r.views),
    vsUsual: day !== null && typical !== null ? lift(day, typical) : null,
  };
}

const PAGE = 24;

export async function libraryOf(userId: string, opts: { filter?: Filter; format?: FormatId | null; q?: string; page?: number } = {}): Promise<{ items: LibraryItem[]; total: number; page: number; pages: number }> {
  const statuses = FILTERS[opts.filter ?? "all"];
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim().slice(0, 80) ?? "";
  return asUser(userId, async (tx) => {
    const where = tx`
      v.user_id = ${userId} and v.status in ${tx(statuses as readonly string[])}
      ${opts.format ? tx`and v.format = ${opts.format}` : tx``}
      ${q ? tx`and v.title ilike ${`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}` : tx``}`;
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.videos v where ${where}`;
    const rows = await tx<Row[]>`
      select v.id, v.title, v.format, v.status, coalesce(v.posted_at, v.scheduled_for, v.decided_at, v.created_at) as at,
        v.youtube_id, v.tiktok_publish_id,
        (select s.views from public.video_stats s where s.video_id = v.id order by array_position(array['72h', '24h', '1h'], s.checkpoint) limit 1) as views,
        (select s.views from public.video_stats s where s.video_id = v.id and s.checkpoint = '24h') as day
      from public.videos v where ${where}
      order by coalesce(v.posted_at, v.scheduled_for, v.decided_at, v.created_at) desc
      limit ${PAGE} offset ${(page - 1) * PAGE}`;
    const typical = await typicalOf(tx, userId);
    return { items: rows.map((r) => toItem(r, typical)), total: n, page, pages: Math.max(1, Math.ceil(n / PAGE)) };
  });
}

export type CalendarItem = { id: string; title: string; format: FormatId; status: ShortStatus; at: Date; youtubeId: string | null; tiktok: boolean };

/** Shorts posting or posted between two moments: the calendar's month. */
export async function calendarOf(userId: string, from: Date, to: Date): Promise<CalendarItem[]> {
  const rows = await asUser(userId, (tx) => tx<{ id: string; title: string; format: FormatId; status: ShortStatus; at: Date; youtube_id: string | null; tiktok: boolean }[]>`
    select id, title, format, status, coalesce(posted_at, scheduled_for) as at, youtube_id,
      (tiktok_publish_id is not null or (tiktok_post is not null and tiktok_error is null)) as tiktok
    from public.videos
    where user_id = ${userId} and status in ${tx(SHOWN as readonly string[])}
      and coalesce(posted_at, scheduled_for) >= ${from} and coalesce(posted_at, scheduled_for) < ${to}
    order by 5`);
  return rows.map((r) => ({ id: r.id, title: r.title, format: r.format, status: r.status, at: r.at, youtubeId: r.youtube_id, tiktok: r.tiktok }));
}

export type ShortDetail = {
  id: string;
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
  youtubeId: string | null;
  tiktokPublishId: string | null;
  tiktokPostedAt: Date | null;
  tiktok: { at: Date | null; error: string | null } | null;
  error: string | null;
  hasFile: boolean;
  render: { status: string; progress: number; finishedAt: Date | null; error: string | null } | null;
  views: Partial<Record<"1h" | "24h" | "72h", number>>;
  typical: number | null;
};

/** One Short, with everything that's happened to it; null when it isn't theirs. */
export async function shortOf(userId: string, id: string): Promise<ShortDetail | null> {
  return asUser(userId, async (tx) => {
    const [v] = await tx<{
      id: string; format: FormatId; params: Spec["params"]; title: string; description: string; why: string[]; status: ShortDetail["status"]; origin: ShortDetail["origin"];
      created_at: Date; decided_at: Date | null; scheduled_for: Date | null; posted_at: Date | null; uploaded_at: Date | null; youtube_id: string | null;
      tiktok_publish_id: string | null; tiktok_posted_at: Date | null; tiktok_post: unknown; tiktok_at: Date | null; tiktok_error: string | null; error: string | null; file_path: string | null;
    }[]>`
      select id, format, params, title, description, why, status, origin, created_at, decided_at, scheduled_for, posted_at, uploaded_at, youtube_id,
        tiktok_publish_id, tiktok_posted_at, tiktok_post, tiktok_at, tiktok_error, error, file_path
      from public.videos where id = ${id} and user_id = ${userId}`;
    if (!v) return null;
    const [job] = await tx<{ status: string; progress: number; finished_at: Date | null; error: string | null }[]>`
      select status, progress, finished_at, error from public.render_jobs where video_id = ${id} order by id desc limit 1`;
    const stats = await tx<{ checkpoint: "1h" | "24h" | "72h"; views: string }[]>`select checkpoint, views from public.video_stats where video_id = ${id}`;
    return {
      id: v.id,
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
      youtubeId: v.youtube_id,
      tiktokPublishId: v.tiktok_publish_id,
      tiktokPostedAt: v.tiktok_posted_at,
      tiktok: v.tiktok_post ? { at: v.tiktok_at, error: v.tiktok_error } : null,
      error: v.error,
      hasFile: v.file_path !== null,
      render: job ? { status: job.status, progress: job.progress, finishedAt: job.finished_at, error: job.error } : null,
      views: Object.fromEntries(stats.map((s) => [s.checkpoint, Number(s.views)])),
      typical: await typicalOf(tx, userId, id),
    };
  });
}

/** What's working on their channel so far, from the learning loop's weights. */
export async function insightsFor(userId: string): Promise<Insights & { typical: number | null }> {
  return asUser(userId, async (tx) => {
    const weights = await tx<Weight[]>`select kind, name, score, samples from public.weights where user_id = ${userId}`;
    return { ...insights(weights), typical: await typicalOf(tx, userId) };
  });
}
