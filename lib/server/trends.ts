import "server-only";
import { heatmap, isoSeconds, middle, NICHES, nicheOf, perHour } from "../trends/niches";
import { lift, median } from "../shorts/learn";
import { localParts, validTimezone } from "../shorts/times";
import type { FormatId } from "../shorts/types";
import { admin, asUser } from "./db";
import { configured, env } from "./env";

/**
 * Trends: Shorts that are growing fast right now in each niche, from the
 * YouTube Data API (the only official source; TikTok doesn't offer one to
 * apps like this). Each search costs 100 of the project's 10,000 daily
 * quota units, so niches are checked every four hours, not constantly.
 */

const API = "https://www.googleapis.com/youtube/v3";

export type TrendVideo = {
  id: string;
  niche: string;
  title: string;
  channel: string | null;
  url: string;
  thumbnail: string | null;
  publishedAt: Date;
  views: number;
  perHour: number;
  format: string;
};

async function get<T>(path: string, q: Record<string, string>): Promise<T> {
  const key = env().YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY isn't set.");
  const res = await fetch(`${API}/${path}?${new URLSearchParams({ ...q, key })}`);
  if (!res.ok) throw new Error(`YouTube ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/** One niche's fastest-growing Shorts from the last two days, measured and saved. */
export async function refreshNiche(nicheId: string, now = new Date()): Promise<number> {
  const n = nicheOf(nicheId);
  if (!n) return 0;
  const found = await get<{ items?: { id: { videoId?: string } }[] }>("search", {
    part: "snippet",
    type: "video",
    videoDuration: "short",
    order: "viewCount",
    publishedAfter: new Date(now.getTime() - 48 * 3600_000).toISOString(),
    q: `${n.query} #shorts`,
    maxResults: "50",
    relevanceLanguage: "en",
  });
  const ids = (found.items ?? []).map((i) => i.id.videoId).filter((x): x is string => !!x);
  if (!ids.length) return 0;
  const details = await get<{ items?: { id: string; snippet: { title: string; channelTitle?: string; publishedAt: string; thumbnails?: { medium?: { url?: string } } }; statistics: { viewCount?: string }; contentDetails: { duration: string } }[] }>("videos", {
    part: "snippet,statistics,contentDetails",
    id: ids.join(","),
  });
  // Shorts run up to three minutes
  const rows = (details.items ?? [])
    .filter((v) => isoSeconds(v.contentDetails.duration) <= 180)
    .map((v) => {
      const published = new Date(v.snippet.publishedAt);
      const views = Number(v.statistics.viewCount ?? 0);
      return { v, published, views, rate: perHour(views, published, now) };
    })
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 25);
  await admin(async (tx) => {
    for (const { v, published, views, rate } of rows) {
      await tx`
        insert into public.trend_videos (platform, external_id, niche, title, channel_title, url, thumbnail, published_at, views, views_per_hour, format, fetched_at)
        values ('youtube', ${v.id}, ${n.id}, ${v.snippet.title}, ${v.snippet.channelTitle ?? null}, ${`https://www.youtube.com/shorts/${v.id}`},
          ${v.snippet.thumbnails?.medium?.url ?? null}, ${published}, ${views}, ${rate}, ${n.format ?? "other"}, ${now})
        on conflict (platform, external_id) do update set views = excluded.views, views_per_hour = excluded.views_per_hour,
          title = excluded.title, fetched_at = excluded.fetched_at`;
    }
  });
  return rows.length;
}

/** Every niche, if it's been four hours; old videos cleared out. For the worker or a scheduler. */
export async function refreshTrends(now = new Date()): Promise<string[]> {
  if (!configured().youtubeTrends) return [];
  const [last] = await admin((tx) => tx<{ at: Date | null }[]>`select max(fetched_at) as at from public.trend_videos`);
  if (last?.at && now.getTime() - last.at.getTime() < 4 * 3600_000) return [];
  const log: string[] = [];
  for (const n of NICHES) {
    try {
      log.push(`${n.id}: ${await refreshNiche(n.id, now)}`);
    } catch (e) {
      log.push(`${n.id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  await admin((tx) => tx`delete from public.trend_videos where published_at < ${new Date(now.getTime() - 7 * 86400_000)}`);
  return log;
}

export async function followedNiches(userId: string): Promise<string[]> {
  const rows = await asUser(userId, (tx) => tx<{ niche: string }[]>`select niche from public.niches`);
  return rows.map((r) => r.niche);
}

export async function setNiches(userId: string, ids: string[]): Promise<void> {
  const keep = ids.filter((id) => nicheOf(id));
  await asUser(userId, async (tx) => {
    await tx`delete from public.niches`;
    for (const id of keep) await tx`insert into public.niches (user_id, niche) values (${userId}, ${id})`;
  });
}

/** Rising now: the fastest-growing Shorts of the last three days in the niches they follow (all, if none). */
export async function rising(userId: string, niches: string[], limit = 24): Promise<TrendVideo[]> {
  const rows = await asUser(userId, (tx) => tx<{ external_id: string; niche: string; title: string; channel_title: string | null; url: string; thumbnail: string | null; published_at: Date; views: string; views_per_hour: number; format: string }[]>`
    select external_id, niche, title, channel_title, url, thumbnail, published_at, views, views_per_hour, format from public.trend_videos
    where published_at > now() - interval '72 hours' ${niches.length ? tx`and niche in ${tx(niches)}` : tx``}
    order by views_per_hour desc limit ${limit}`);
  return rows.map((r) => ({ id: r.external_id, niche: r.niche, title: r.title, channel: r.channel_title, url: r.url, thumbnail: r.thumbnail, publishedAt: r.published_at, views: Number(r.views), perHour: r.views_per_hour, format: r.format }));
}

export type Leader = { format: string; typical: number | null; videos: number; mine: { score: number; samples: number } | null };

/** Each format: how a typical rising Short in it is growing on YouTube now, and how it does on their channel. */
export async function leaderboard(userId: string): Promise<{ rows: Leader[]; updated: Date | null }> {
  return asUser(userId, async (tx) => {
    const t = await tx<{ format: string; views_per_hour: number }[]>`select format, views_per_hour from public.trend_videos where published_at > now() - interval '72 hours'`;
    const w = await tx<{ name: string; score: number; samples: number }[]>`select name, score, samples from public.weights where kind = 'format'`;
    const [u] = await tx<{ at: Date | null }[]>`select max(fetched_at) as at from public.trend_videos`;
    const by = new Map<string, number[]>();
    for (const r of t) by.set(r.format, [...(by.get(r.format) ?? []), r.views_per_hour]);
    const formats: string[] = ["battle", "quiz", "wyr", "texts", "ranking", "race"];
    const rows = formats.map((f) => {
      const mine = w.find((x) => x.name === f);
      return { format: f, typical: middle(by.get(f) ?? []), videos: by.get(f)?.length ?? 0, mine: mine ? { score: mine.score, samples: mine.samples } : null };
    });
    rows.sort((a, b) => (b.typical ?? -1) - (a.typical ?? -1));
    return { rows, updated: u?.at ?? null };
  });
}

/**
 * Their own posting times, for the heatmap. Each Short is measured
 * against the usual Short on its own channel, so a small channel's
 * Shorts aren't made to look bad by a big one's, or a big one's good.
 */
export async function postingTimes(userId: string): Promise<{ map: ReturnType<typeof heatmap>; posts: number }> {
  return asUser(userId, async (tx) => {
    const [p] = await tx<{ timezone: string }[]>`select timezone from public.profiles where id = ${userId}`;
    const tz = validTimezone(p?.timezone);
    const rows = await tx<{ posted_at: Date; channel_id: string | null; views: string }[]>`
      select v.posted_at, v.channel_id, s.views from public.videos v join public.video_stats s on s.video_id = v.id and s.checkpoint = '24h'
      where v.posted_at is not null order by v.posted_at desc limit 200`;
    // each channel's usual, and the usual of the Shorts made before the account had a channel
    const by = new Map<string | null, number[]>();
    for (const r of rows) by.set(r.channel_id, [...(by.get(r.channel_id) ?? []), Number(r.views)]);
    const typical = new Map([...by].map(([id, views]) => [id, median(views) ?? 0]));
    const posts = rows.map((r) => {
      const l = localParts(r.posted_at, tz);
      return { weekday: l.weekday, hour: l.hour, lift: lift(Number(r.views), typical.get(r.channel_id) ?? 0) };
    });
    return { map: heatmap(posts), posts: rows.length };
  });
}

export const formatOfNiche = (id: string): FormatId | null => nicheOf(id)?.format ?? null;
