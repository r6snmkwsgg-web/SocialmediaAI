import "server-only";
import { dueNiches, heatmap, isoSeconds, middle, NICHES, nicheOf, perHour, type TrendCheck, type TrendOutcome } from "../trends/niches";
import { lift, median } from "../shorts/learn";
import { quotaResetsAt } from "../shorts/quota";
import { localParts, validTimezone } from "../shorts/times";
import type { FormatId } from "../shorts/types";
import { admin, asUser, type Tx } from "./db";
import { configured } from "./env";
import { QuotaWait } from "./quota";
import { YouTubeError, youtubeGet } from "./youtube";

/**
 * Trends: Shorts that are growing fast right now in each niche, from the
 * YouTube Data API (the only official source; TikTok doesn't offer one to
 * apps like this). Each niche is checked once a day: one search, and one
 * look at what it found, which also brings YouTube's own made-for-kids
 * verdict on each. Both are counted against Trends' share of YouTube's
 * daily quota before they're made (lib/shorts/quota.ts), so Trends never
 * uses what posting needs. trend_checks keeps when each niche was last
 * checked, how its last try went and when it's checked next, and a niche
 * is claimed there before it's searched, so two checkers at once never
 * both search it.
 */

/** How often each niche is checked: one of YouTube's 100 searches a day for each, and about a unit. */
export const TRENDS_EVERY = 24 * 3600_000;

/** How long a niche being checked is held, so one cut off part way is tried again soon after. */
const CLAIM_MS = 15 * 60_000;

/** After YouTube didn't answer, when the niches are tried again: once an hour, so a bad key or an outage can't use up the day's searches. */
const RETRY_MS = 3600_000;

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
  /** when its views were read */
  fetchedAt: Date;
};

/** What videos.list says about a Short a search found: its title and channel, views, length and YouTube's made-for-kids verdict. */
type Details = {
  id: string;
  snippet: { title: string; channelTitle?: string; publishedAt: string; thumbnails?: { medium?: { url?: string } } };
  statistics: { viewCount?: string };
  contentDetails: { duration: string };
  status?: { madeForKids?: boolean };
};

/** One niche's fastest-growing Shorts from the last two days, measured and saved, with what YouTube says about who each is for. */
export async function refreshNiche(nicheId: string, now = new Date()): Promise<number> {
  const n = nicheOf(nicheId);
  if (!n) return 0;
  const found = await youtubeGet<{ items?: { id: { videoId?: string } }[] }>("trends", "search.list", "search", {
    part: "snippet",
    type: "video",
    videoDuration: "short",
    order: "viewCount",
    publishedAfter: new Date(now.getTime() - 48 * 3600_000).toISOString(),
    q: `${n.query} #shorts`,
    maxResults: "50",
    relevanceLanguage: "en",
  }, { now, what: "Searching YouTube" });
  const ids = (found.items ?? []).map((i) => i.id.videoId).filter((x): x is string => !!x);
  if (!ids.length) return 0;
  const details = await youtubeGet<{ items?: Details[] }>("trends", "videos.list", "videos", {
    part: "snippet,statistics,contentDetails,status",
    id: ids.join(","),
  }, { now, what: "Reading rising Shorts" });
  // Shorts run up to three minutes
  const rows = (details.items ?? [])
    .filter((v) => isoSeconds(v.contentDetails.duration) <= 180)
    .map((v) => {
      const published = new Date(v.snippet.publishedAt);
      const views = Number(v.statistics.viewCount ?? 0);
      // YouTube's own word on whether it's made for kids, or null when it didn't say
      const kids = typeof v.status?.madeForKids === "boolean" ? v.status.madeForKids : null;
      return { v, published, views, rate: perHour(views, published, now), kids };
    })
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 25);
  await admin(async (tx) => {
    for (const { v, published, views, rate, kids } of rows) {
      await tx`
        insert into public.trend_videos (platform, external_id, niche, title, channel_title, url, thumbnail, published_at, views, views_per_hour, format, fetched_at, made_for_kids)
        values ('youtube', ${v.id}, ${n.id}, ${v.snippet.title}, ${v.snippet.channelTitle ?? null}, ${`https://www.youtube.com/shorts/${v.id}`},
          ${v.snippet.thumbnails?.medium?.url ?? null}, ${published}, ${views}, ${rate}, ${n.format ?? "other"}, ${now}, ${kids})
        on conflict (platform, external_id) do update set views = excluded.views, views_per_hour = excluded.views_per_hour,
          title = excluded.title, fetched_at = excluded.fetched_at, made_for_kids = excluded.made_for_kids`;
    }
  });
  return rows.length;
}

type CheckRow = { niche: string; checked_at: Date | null; tried_at: Date; outcome: TrendOutcome | null; next_at: Date };

const checkOf = (r: CheckRow): TrendCheck => ({ niche: r.niche, checkedAt: r.checked_at, triedAt: r.tried_at, outcome: r.outcome, nextAt: r.next_at });

/** Takes a niche to check, unless another checker has it or it isn't due any more. */
async function claim(niche: string, now: Date): Promise<boolean> {
  const took = await admin((tx) => tx`
    insert into public.trend_checks (niche, tried_at, next_at) values (${niche}, ${now}, ${new Date(now.getTime() + CLAIM_MS)})
    on conflict (niche) do update set tried_at = excluded.tried_at, next_at = excluded.next_at
      where trend_checks.next_at <= ${now}
    returning niche`);
  return took.length > 0;
}

/**
 * A check that couldn't be made: that niche, and the rest still due in
 * the run, wait until `next` and say why. The rest weren't tried, but
 * they'd have gone the same way. One another checker has taken is left
 * to it.
 */
async function putOff(niche: string, rest: string[], outcome: "quota" | "failed", next: Date, now: Date): Promise<void> {
  await admin(async (tx) => {
    await tx`update public.trend_checks set outcome = ${outcome}, next_at = ${next} where niche = ${niche}`;
    if (!rest.length) return;
    await tx`
      insert into public.trend_checks (niche, tried_at, outcome, next_at)
      select n, ${now}, ${outcome}, ${next} from unnest(${rest}::text[]) n
      on conflict (niche) do update set tried_at = excluded.tried_at, outcome = excluded.outcome, next_at = excluded.next_at
        where trend_checks.next_at <= ${now}`;
  });
}

/**
 * The niches whose day has come, checked one at a time, each claimed
 * first so two checkers at once (the worker, the cron route, a second
 * worker) never both search one. Each is checked again a day after a
 * check that worked, at the reset when there's no quota left, and an
 * hour after YouTube didn't answer. A run stops at the first niche it
 * can't check: the rest would go the same way, and every try counts
 * against the day's searches. Old videos are cleared out. For the worker
 * or a scheduler.
 */
export async function refreshTrends(now = new Date()): Promise<string[]> {
  if (!configured().youtubeTrends) return [];
  const checks = await admin((tx) => tx<CheckRow[]>`select niche, checked_at, tried_at, outcome, next_at from public.trend_checks`);
  const due = dueNiches(NICHES, checks.map(checkOf), now);
  const log: string[] = [];
  for (const [i, n] of due.entries()) {
    if (!(await claim(n.id, now))) continue;
    try {
      const found = await refreshNiche(n.id, now);
      await admin((tx) => tx`
        update public.trend_checks set checked_at = ${now}, outcome = ${found ? "found" : "none"}, next_at = ${new Date(now.getTime() + TRENDS_EVERY)}
        where niche = ${n.id}`);
      log.push(`${n.id}: ${found}`);
    } catch (e) {
      // every niche draws on the same quota and asks with the same key, so the rest would go the same way: they wait too
      const quota = e instanceof QuotaWait || (e instanceof YouTubeError && e.quota);
      const next = e instanceof QuotaWait ? e.until : quota ? quotaResetsAt(now) : new Date(now.getTime() + RETRY_MS);
      await putOff(n.id, due.slice(i + 1).map((x) => x.id), quota ? "quota" : "failed", next, now);
      log.push(quota ? `trends wait for YouTube quota until ${next.toISOString()}` : `${n.id} failed, so the rest wait an hour: ${e instanceof Error ? e.message : e}`);
      break;
    }
  }
  await admin((tx) => tx`delete from public.trend_videos where published_at < ${new Date(now.getTime() - 7 * 86400_000)}`);
  return log;
}

/** How fresh each niche is: when it was last checked, how its last try went, and when it's checked next. */
export async function trendChecks(userId: string): Promise<TrendCheck[]> {
  const rows = await asUser(userId, (tx) => tx<CheckRow[]>`select niche, checked_at, tried_at, outcome, next_at from public.trend_checks`);
  return rows.map(checkOf);
}

/**
 * For each niche, how many of the rising Shorts of the last three days
 * YouTube itself marked made for kids, of those it said either way. A
 * Short YouTube said nothing about isn't counted.
 */
export async function kidsShare(userId: string, niches: string[], now = new Date()): Promise<Map<string, { kids: number; of: number }>> {
  const rows = await asUser(userId, (tx) => tx<{ niche: string; kids: number; measured: number }[]>`
    select niche, (count(*) filter (where made_for_kids))::int as kids, count(made_for_kids)::int as measured
    from public.trend_videos
    where published_at > ${new Date(now.getTime() - 72 * 3600_000)} ${niches.length ? tx`and niche in ${tx(niches)}` : tx``}
    group by niche`);
  return new Map(rows.map((r) => [r.niche, { kids: r.kids, of: r.measured }]));
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
  const rows = await asUser(userId, (tx) => tx<{ external_id: string; niche: string; title: string; channel_title: string | null; url: string; thumbnail: string | null; published_at: Date; views: string; views_per_hour: number; format: string; fetched_at: Date }[]>`
    select external_id, niche, title, channel_title, url, thumbnail, published_at, views, views_per_hour, format, fetched_at from public.trend_videos
    where published_at > now() - interval '72 hours' ${niches.length ? tx`and niche in ${tx(niches)}` : tx``}
    order by views_per_hour desc limit ${limit}`);
  return rows.map((r) => ({ id: r.external_id, niche: r.niche, title: r.title, channel: r.channel_title, url: r.url, thumbnail: r.thumbnail, publishedAt: r.published_at, views: Number(r.views), perHour: r.views_per_hour, format: r.format, fetchedAt: r.fetched_at }));
}

export type Leader = { format: string; typical: number | null; videos: number; mine: { score: number; samples: number } | null };

/**
 * Each of Hookline's formats on YouTube Shorts over the last three days:
 * how a typical rising Short in it is growing (views an hour) and how many
 * rising Shorts that's from. Trends' "Formats right now" shows it, and the
 * morning run leans toward the rising ones (`trendLean`). Every signed-in
 * user can read the trends, so it runs in their own transaction.
 */
export async function formatGrowth(tx: Tx): Promise<Partial<Record<FormatId, { typical: number | null; videos: number }>>> {
  const t = await tx<{ format: string; views_per_hour: number }[]>`select format, views_per_hour from public.trend_videos where published_at > now() - interval '72 hours'`;
  const by = new Map<string, number[]>();
  for (const r of t) by.set(r.format, [...(by.get(r.format) ?? []), r.views_per_hour]);
  return Object.fromEntries([...by].map(([f, v]) => [f, { typical: middle(v), videos: v.length }]));
}

/** Each format: how a typical rising Short in it is growing on YouTube now, and how it does on their channel. `updated` is the latest check of any niche. */
export async function leaderboard(userId: string): Promise<{ rows: Leader[]; updated: Date | null }> {
  return asUser(userId, async (tx) => {
    const growth = await formatGrowth(tx);
    const w = await tx<{ name: string; score: number; samples: number }[]>`select name, score, samples from public.weights where kind = 'format'`;
    const [u] = await tx<{ at: Date | null }[]>`select max(checked_at) as at from public.trend_checks`;
    const formats: FormatId[] = ["battle", "quiz", "wyr", "texts", "ranking", "race"];
    const rows = formats.map((f) => {
      const mine = w.find((x) => x.name === f);
      return { format: f, typical: growth[f]?.typical ?? null, videos: growth[f]?.videos ?? 0, mine: mine ? { score: mine.score, samples: mine.samples } : null };
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
