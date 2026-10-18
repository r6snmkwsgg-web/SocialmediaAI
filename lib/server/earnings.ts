import "server-only";
import Stripe from "stripe";
import { addUp, lastDays, fill, fillReported, fillSince, fromMinor, fromTotals, goalProgress, lastReported, sum, type Point } from "../earnings/series";
import { channelNames } from "../shorts/channels";
import { localParts, validTimezone } from "../shorts/times";
import { open, seal } from "./crypto";
import { admin, asUser } from "./db";
import { tiktokAccess } from "./tiktok";
import { byColumn } from "../shorts/proof";
import { analyticsReport, type Report } from "./youtube-analytics";
import { YouTubeError } from "./youtube";
import { youtubeAccess } from "./youtube";
import { dayAfter, localDay, readBetween, superChatsRead, type SuperChat } from "../earnings/superchats";
import { configured } from "./env";
import { QuotaWait } from "./quota";
import { youtubeSuperChats } from "./youtube";

/**
 * Earnings: real numbers only, from where they really are. YouTube
 * Analytics for views, subscribers and (for monetized channels) YouTube's
 * estimated revenue; TikTok's view counts; the gift coins the LIVE game
 * saw on the streamer's own TikTok LIVEs (what viewers sent, not what
 * TikTok pays them); and, for people who sell things, their Stripe sales
 * through a read-only key. Synced every few hours; nothing here is made
 * up or projected. YouTube runs 2 to 3 days behind, so its latest days
 * are "not reported yet", never zero, and Stripe's days from before it
 * was first read back to are unknown too. YouTube's and TikTok's figures
 * are each channel's own, and all of them together are added up honestly:
 * a day shows once every channel being read then has reported it.
 */

/** how far back Stripe is read, at each sync */
const STRIPE_DAYS = 35;

export type Series = {
  id: string;
  source: "youtube" | "tiktok" | "live" | "stripe";
  label: string;
  unit: "count" | "money" | "coins";
  currency?: string;
  points: Point[];
  total: number;
  note?: string;
  /** the last day the source has reported, for one that reports days late */
  through?: string;
  /** the first day the source has been read back to, for one that can't be read further */
  from?: string;
  /** for engaged views across channels: the ones YouTube gives views for but hasn't given engaged views for, which the total can't count, by name */
  leftOut?: string[];
};

export type Goal = { id: string; source: string; metric: string; target: number; period: "month" | "all"; label: string; progress: number; unit: Series["unit"]; currency?: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** what the LIVE figure is called everywhere: coins viewers sent that the game saw, never earnings or money */
export const LIVE_COINS = "Gift coins seen on your LIVEs";

/** LIVEs the game played that aren't verified as the streamer's own, so their coins aren't counted. */
export type Unverified = { lives: number; coins: number };

/**
 * A channel with figures: what to call it, whether it needs reconnecting
 * (its figures stop at its last report), and the first and last days it's
 * reported, for the notes beside the totals and for picking one channel.
 */
export type EarningsChannel = { id: string; platform: "youtube" | "tiktok"; name: string; expired: boolean; from: string | null; through: string | null };

/** One channel's figures for a measure, by day (null for the account's own, when it had no channel). */
type Part = { channel: string | null; values: Map<string, number> };

/**
 * Everything the Earnings page shows, for the last `days` days: all their
 * channels added up, or with `channelId` that channel's own, each named
 * for it (and then nothing that's the account's as a whole: LIVE coins,
 * Stripe). Goals always add up every channel.
 */
export async function earningsOf(userId: string, days: number, channelId?: string): Promise<{ series: Series[]; goals: Goal[]; unverified: Unverified; channels: EarningsChannel[] }> {
  // Stripe is read back 35 days from when it was connected; the first whole day after that is where its figures start
  const [key] = await admin((tx) => tx<{ connected_at: Date }[]>`select connected_at from public.stripe_keys where user_id = ${userId}`);
  const stripeSince = key ? iso(new Date(key.connected_at.getTime() - (STRIPE_DAYS - 1) * 86400_000)) : null;
  return asUser(userId, async (tx) => {
    const [p] = await tx<{ timezone: string }[]>`select timezone from public.profiles where id = ${userId}`;
    const tz = validTimezone(p?.timezone);
    const t = localParts(new Date(), tz);
    const today = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
    const range = lastDays(today, days);
    // goals count the whole month (or all time), so read back far enough for both
    const rows = await tx<{ source: string; metric: string; channel_id: string | null; day: Date; value: string }[]>`
      select source, metric, channel_id, day, value from public.metrics where day > now() - interval '400 days'`;
    // a disconnected channel's figures are gone; anything left of one doesn't count
    const channels = await tx<{ id: string; platform: "youtube" | "tiktok"; title: string | null; handle: string | null; status: string }[]>`
      select id, platform, title, handle, status from public.channels where status <> 'revoked' order by added_at, id`;
    // only LIVEs heard on their own TikTok count; the rest are shown apart, plainly. Gift coins are TikTok's: a YouTube LIVE has none
    const sessions = await tx<{ day: string; verified: boolean; lives: number; coins: number }[]>`
      select to_char(started_at at time zone ${tz}, 'YYYY-MM-DD') as day, verified, count(*)::int as lives, sum(coins)::int as coins
      from public.live_sessions where platform = 'tiktok' group by 1, 2`;

    // each measure's figures, by channel and day
    const by = new Map<string, Map<string | null, Map<string, number>>>();
    for (const r of rows) {
      const k = `${r.source}:${r.metric}`;
      if (!by.has(k)) by.set(k, new Map());
      const m = by.get(k)!;
      if (!m.has(r.channel_id)) m.set(r.channel_id, new Map());
      m.get(r.channel_id)!.set(iso(r.day), Number(r.value));
    }
    const known = new Map(channels.map((c) => [c.id, c]));
    // what to call each channel, YouTube's and TikTok's apart
    const names = new Map([...channelNames(channels.filter((c) => c.platform === "youtube")), ...channelNames(channels.filter((c) => c.platform === "tiktok"))]);
    const partsOf = (k: string): Part[] =>
      [...(by.get(k) ?? new Map<string | null, Map<string, number>>())].filter(([id]) => id === null || known.has(id)).map(([channel, values]) => ({ channel, values }));
    const picked = (parts: Part[]) => (channelId === undefined ? parts : parts.filter((x) => x.channel === channelId));
    const expired = (id: string | null) => id !== null && known.get(id)?.status === "expired";
    const first = (values: Map<string, number>) => [...values.keys()].sort()[0] ?? null;
    // every channel's days added up: each counts from its first report, and one that needs reconnecting only up to its
    // last, so it doesn't hold the others back. With nothing reported at all, every day is unknown
    const together = (parts: Part[], days: string[], each: (days: string[], values: Map<string, number>) => Point[]): Point[] =>
      parts.length
        ? addUp(parts.map((x) => ({ points: each(days, x.values), from: first(x.values), until: expired(x.channel) ? lastReported(x.values) : null })))
        : days.map((day) => ({ day, value: null }));
    // reported as far as every channel still being read has reported, or when none is, the last any did
    const through = (parts: Part[]) => {
      const lasts = (gone: boolean) => parts.filter((x) => expired(x.channel) === gone).map((x) => lastReported(x.values)).filter((d): d is string => !!d).sort();
      return lasts(false)[0] ?? lasts(true).at(-1);
    };

    const live = new Map(sessions.filter((x) => x.verified).map((x) => [x.day, x.coins]));
    const unverified = sessions.filter((x) => !x.verified && range.includes(x.day)).reduce((a, x) => ({ lives: a.lives + x.lives, coins: a.coins + x.coins }), { lives: 0, coins: 0 });
    const allDays = [...new Set([...rows.map((r) => iso(r.day)), ...live.keys(), today])].sort();
    const out: Series[] = [];
    const add = (id: string, source: Series["source"], label: string, unit: Series["unit"], all: Point[], extra: Partial<Series> = {}) => {
      const points = all.filter((x) => range.includes(x.day));
      out.push({ id, source, label, unit, points, total: sum(points), ...extra });
    };

    // YouTube reports days late: what it hasn't reported yet is unknown, not zero
    const youtube = (metric: string): [Point[], Partial<Series>] => {
      const parts = picked(partsOf(`youtube:${metric}`));
      return [together(parts, range, fillReported), { through: through(parts) }];
    };
    // one channel's own figures say whose they are
    const on = channelId === undefined ? undefined : names.get(channelId);
    if (picked(partsOf("youtube:views")).length) {
      add("youtube:views", "youtube", on ? `Views on ${on}` : "Views on YouTube", "count", ...youtube("views"));
      // the views YouTube counts for the Partner Program, wherever it has reported them. A channel YouTube gives views for
      // but hasn't given these for can't be in their total, so the total says which, in the order the channels were added
      const engaged = picked(partsOf("youtube:engaged_views"));
      if (engaged.length) {
        const [points, extra] = youtube("engaged_views");
        const viewed = new Set(picked(partsOf("youtube:views")).map((x) => x.channel));
        const leftOut = channels.filter((c) => viewed.has(c.id) && !engaged.some((x) => x.channel === c.id)).map((c) => names.get(c.id)!);
        add("youtube:engaged_views", "youtube", on ? `Engaged views on ${on}` : "Engaged views on YouTube", "count", points, {
          ...extra, note: "What YouTube counts for the Partner Program. A Shorts view counts every play. These leave out the ones swiped past",
          ...(leftOut.length ? { leftOut } : {}),
        });
      }
      add("youtube:subscribers", "youtube", on ? `New subscribers on ${on}` : "New subscribers", "count", ...youtube("subscribers"));
    }
    if (picked(partsOf("youtube:revenue")).length) {
      const [points, extra] = youtube("revenue");
      add("youtube:revenue", "youtube", on ? `${on}'s YouTube revenue` : "YouTube revenue", "money", points, { ...extra, currency: "USD", note: "YouTube's own estimate" });
    }
    const tiktok = picked(partsOf("tiktok:views_total"));
    if (tiktok.length) add("tiktok:views", "tiktok", "Views on TikTok", "count", together(tiktok, range, fromTotals), { note: "From your videos' view counts, read every few hours" });
    if (channelId === undefined) {
      if (live.size) add("live:coins", "live", LIVE_COINS, "coins", fill(range, live, 0), { note: "What viewers sent on your own LIVEs, as the game counted it. Not what TikTok pays you" });
      for (const [k, m] of by) {
        if (!k.startsWith("stripe:revenue:")) continue;
        const cur = k.split(":")[2].toUpperCase();
        add(k, "stripe", `Sales through Stripe (${cur})`, "money", fillSince(range, m.get(null) ?? new Map(), stripeSince), { currency: cur, note: "Charges less refunds, before Stripe's fees", from: stripeSince ?? undefined });
      }
    }

    // Super Chats and Super Stickers, by currency, each channel's own: known for the days Hookline has read of them in full,
    // so a day read with none is none and one not read is unknown. Several channels add up like YouTube's other figures
    type Read = { id: string; status: string; superchats_from: Date; superchats_through: Date };
    const superRead: Read[] = await tx<Read[]>`
      select id, status, superchats_from, superchats_through from public.channels
      where platform = 'youtube' and status <> 'revoked' and superchats_from is not null and superchats_through is not null`;
    const superShown = superRead.filter((c) => channelId === undefined || c.id === channelId);
    const superChats = (k: string, days: string[], read: Read[]): Point[] =>
      read.length
        ? addUp(read.map((c) => {
            const from = iso(c.superchats_from), through = iso(c.superchats_through);
            return { points: readBetween(days, by.get(k)?.get(c.id) ?? new Map(), from, through), from, until: c.status === "expired" ? through : null };
          }))
        : days.map((day) => ({ day, value: null }));
    for (const k of [...by.keys()].filter((x) => x.startsWith("youtube:superchat:")).sort()) {
      if (!picked(partsOf(k)).length) continue;
      const cur = k.split(":")[2].toUpperCase();
      add(k, "youtube", on ? `Super Chats and Super Stickers on ${on} (${cur})` : `Super Chats and Super Stickers (${cur})`, "money", superChats(k, range, superShown), {
        currency: cur,
        note: `What viewers paid on your ${superShown.length > 1 ? "channels" : "channel"}, before YouTube's share`,
        from: superShown.map((c) => iso(c.superchats_from)).sort()[0],
      });
    }

    const goals = await tx<{ id: string; source: string; metric: string; target: string; period: "month" | "all"; label: string }[]>`
      select id, source, metric, target, period, label from public.goals order by created_at`;
    const everything = (source: string, metric: string): Point[] => {
      if (source === "live") return fill(allDays, live, 0);
      if (source === "tiktok") return together(partsOf("tiktok:views_total"), allDays, fromTotals);
      if (source === "youtube" && metric.startsWith("superchat:")) return superChats(`youtube:${metric}`, allDays, superRead);
      if (source === "youtube") return together(partsOf(`${source}:${metric}`), allDays, fillReported);
      return fillSince(allDays, by.get(`${source}:${metric}`)?.get(null) ?? new Map(), stripeSince);
    };
    return {
      series: out,
      goals: goals.map((g) => {
        // Super Chats are money in their own currency, like Stripe's sales
        const ownCurrency = g.metric.startsWith("revenue:") || g.metric.startsWith("superchat:");
        const unit: Series["unit"] = g.source === "live" ? "coins" : g.metric.startsWith("revenue") || ownCurrency ? "money" : "count";
        const currency = ownCurrency ? g.metric.split(":")[1].toUpperCase() : g.metric === "revenue" ? "USD" : undefined;
        return { id: g.id, source: g.source, metric: g.metric, target: Number(g.target), period: g.period, label: g.label, progress: goalProgress(everything(g.source, g.metric), g.period, today), unit, currency };
      }),
      unverified,
      channels: channels.flatMap((c) => {
        const values = by.get(c.platform === "youtube" ? "youtube:views" : "tiktok:views_total")?.get(c.id);
        return values ? [{ id: c.id, platform: c.platform, name: names.get(c.id)!, expired: c.status === "expired", from: first(values), through: lastReported(values) }] : [];
      }),
    };
  });
}

/**
 * One day's figure. YouTube's and TikTok's are their channel's own, kept
 * only while it isn't disconnected: a sync still under way when it's
 * disconnected keeps nothing, since the figures were read with access the
 * creator took back. Stripe's are the account's (no channel).
 */
async function put(userId: string, channelId: string | null, source: string, metric: string, day: string, value: number) {
  await admin((tx) => tx`
    insert into public.metrics (user_id, channel_id, source, metric, day, value)
    select ${userId}::uuid, ${channelId}::uuid, ${source}, ${metric}, ${day}::date, ${value}
    where ${channelId}::uuid is null or exists (select 1 from public.channels where id = ${channelId} and status <> 'revoked' for share)
    on conflict (user_id, source, metric, channel_id, day) do update set value = excluded.value`);
}

/** What Earnings reads from YouTube Analytics for each day, and what each is kept as. */
const DAILY = [["views", "views"], ["engagedViews", "engaged_views"], ["subscribersGained", "subscribers"], ["estimatedRevenue", "revenue"]] as const;

/** What each of YouTube's refusals is about: revenue, which channels outside the Partner Program can't read, and engaged views, YouTube's newer measure. */
const REFUSED: Record<number, string> = { 403: "estimatedRevenue", 400: "engagedViews" };

/**
 * YouTube Analytics, by day, for one channel: views, engaged views and
 * subscribers, and revenue if the channel is monetized. Each report is
 * counted, and its columns are read by name. A refusal drops only what
 * it's about, in whichever order YouTube refuses them, so views and
 * subscribers always sync.
 */
async function syncYouTube(userId: string, channelId: string, now: Date): Promise<string> {
  const access = await youtubeAccess(channelId);
  let metrics: string[] = DAILY.map(([m]) => m);
  let report: Report | null = null;
  while (!report) {
    try {
      report = await analyticsReport(access, { startDate: iso(new Date(now.getTime() - 35 * 86400_000)), endDate: iso(now), metrics, dimensions: ["day"], sort: "day" }, now);
    } catch (e) {
      const drop = e instanceof YouTubeError && !e.quota ? REFUSED[e.status] : undefined;
      if (!drop || !metrics.includes(drop)) throw e;
      metrics = metrics.filter((m) => m !== drop);
    }
  }
  const days = byColumn(report).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.day)));
  for (const r of days) {
    for (const [metric, kept] of DAILY) {
      const value = r[metric] === undefined ? NaN : Number(r[metric]);
      if (Number.isFinite(value)) await put(userId, channelId, "youtube", kept, String(r.day), value);
    }
  }
  return `youtube ${days.length} days`;
}

/** TikTok gives each video's total views, not daily ones: today's grand total is kept for that TikTok account, and the days are the differences. */
async function syncTikTok(userId: string, channelId: string, today: string): Promise<string> {
  const access = await tiktokAccess(channelId);
  let total = 0, cursor: number | undefined, pages = 0;
  for (;;) {
    const res = await fetch("https://open.tiktokapis.com/v2/video/list/?fields=id,view_count", {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }),
    });
    const j = (await res.json()) as { data?: { videos?: { view_count?: number }[]; cursor?: number; has_more?: boolean }; error?: { code?: string } };
    if (!res.ok || (j.error?.code && j.error.code !== "ok")) throw new Error(`TikTok video list: ${j.error?.code ?? res.status}`);
    total += (j.data?.videos ?? []).reduce((a, v) => a + (v.view_count ?? 0), 0);
    if (!j.data?.has_more || ++pages >= 25) break;
    cursor = j.data.cursor;
  }
  await put(userId, channelId, "tiktok", "views_total", today, total);
  return `tiktok ${total} views in all`;
}

/** Stripe sales by day and currency, from the seller's read-only key. */
async function syncStripe(userId: string, sealedKey: string, now: Date): Promise<string> {
  const s = new Stripe(open(sealedKey));
  const since = Math.floor((now.getTime() - STRIPE_DAYS * 86400_000) / 1000);
  const days = new Map<string, number>();
  for await (const t of s.balanceTransactions.list({ created: { gte: since }, limit: 100 })) {
    if (!["charge", "payment", "refund", "payment_refund"].includes(t.type)) continue;
    const k = `${iso(new Date(t.created * 1000))}|${t.currency}`;
    days.set(k, (days.get(k) ?? 0) + fromMinor(t.amount, t.currency));
  }
  for (const [k, v] of days) {
    const [day, cur] = k.split("|");
    await put(userId, null, "stripe", `revenue:${cur}`, day, Math.round(v * 100) / 100);
  }
  return `stripe ${days.size} days`;
}

/** the most pages of a channel's Super Chats read at each sync, 50 to a page */
const SUPER_CHAT_PAGES = 40;

/**
 * One YouTube channel's Super Chats and Super Stickers, from YouTube's own
 * list of them: what viewers paid on each local day, in each currency,
 * before YouTube's share. YouTube lists 30 days back, 50 at a time, and at
 * most 40 pages are read. Only the days the read covered in full are
 * written again, all at once, so a read that stops short or fails never
 * lowers a day that was whole when it was written.
 */
async function syncSuperChats(userId: string, channelId: string, tz: string, now: Date): Promise<string> {
  const access = await youtubeAccess(channelId);
  const since = new Date(now.getTime() - 30 * 86400_000);
  const items: SuperChat[] = [];
  let token: string | null = null;
  let whole = false;
  for (let pages = 0; pages < SUPER_CHAT_PAGES && !whole; pages++) {
    const page = await youtubeSuperChats(access, token, now);
    items.push(...page.items);
    // newest first: once one is from before 30 days ago, or the list ends, everything since has been read
    whole = !page.next || page.items.some((x) => x.createdAt < since);
    token = page.next;
  }
  const today = localDay(now, tz);
  const { first, days } = superChatsRead(items, { tz, now, whole });
  if (first > today) return `super chats ${channelId}: more today than one read covers, so nothing was kept`;
  const kept = await keepSuperChats(userId, channelId, { first, today }, days);
  return kept ? `super chats ${channelId}: ${items.length} read, days from ${first}` : `super chats ${channelId}: disconnected meanwhile`;
}

/**
 * A channel's Super Chat figures from one read, in one transaction: the
 * days it covered in full are replaced, and the days Hookline has read of
 * that channel run on to today, and back to this read's first if it went
 * further. A read that doesn't join on to the last one starts afresh,
 * since the days in between were never read and mustn't show as none.
 * Like put(), nothing is kept for a channel disconnected meanwhile, and a
 * disconnect waits for this to finish.
 */
async function keepSuperChats(userId: string, channelId: string, read: { first: string; today: string }, days: Map<string, Map<string, number>>): Promise<boolean> {
  return admin(async (tx) => {
    const [c] = await tx<{ superchats_from: Date | null; superchats_through: Date | null }[]>`
      select superchats_from, superchats_through from public.channels where id = ${channelId} and user_id = ${userId} and status <> 'revoked' for share`;
    if (!c) return false;
    const fresh = !c.superchats_from || !c.superchats_through || dayAfter(iso(c.superchats_through)) < read.first;
    // afresh, nothing of the last reads stays; otherwise the days before this one's first stay as they were written
    const replaced = fresh ? null : read.first;
    await tx`
      delete from public.metrics where user_id = ${userId} and channel_id = ${channelId} and source = 'youtube' and metric like 'superchat:%'
        and (${replaced}::date is null or day >= ${replaced}::date)`;
    const rows = [...days].flatMap(([cur, byDay]) => [...byDay].map(([day, value]) => ({ user_id: userId, channel_id: channelId, source: "youtube", metric: `superchat:${cur}`, day, value })));
    if (rows.length) await tx`insert into public.metrics ${tx(rows)}`;
    const from = fresh || read.first < iso(c.superchats_from!) ? read.first : iso(c.superchats_from!);
    await tx`update public.channels set superchats_from = ${from}::date, superchats_through = ${read.today}::date where id = ${channelId}`;
    return true;
  });
}

/**
 * Super Chats for Earnings, while YouTube Live is on: only the connected
 * YouTube channels of people who said they have Super Chat, so the many
 * channels that can't get any cost nothing. Each channel is read on its
 * own, and one that can't be read is left as it was. Once YouTube Live's
 * share of the day's quota is used, the rest wait for the next sync.
 */
async function syncAllSuperChats(now: Date): Promise<string[]> {
  const channels = await admin((tx) => tx<{ id: string; user_id: string; timezone: string }[]>`
    select c.id, c.user_id, p.timezone from public.channels c join public.profiles p on p.id = c.user_id
    where c.platform = 'youtube' and c.status = 'connected' and p.yt_live_check ->> 'superChat' = 'true'
    order by c.superchats_through nulls first, c.added_at, c.id`);
  const log: string[] = [];
  for (const c of channels) {
    try {
      log.push(await syncSuperChats(c.user_id, c.id, validTimezone(c.timezone), now));
    } catch (e) {
      if (e instanceof QuotaWait) {
        log.push(`super chats wait for YouTube's quota until ${e.until.toISOString()}`);
        break;
      }
      log.push(`super chats ${c.id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return log;
}

/** Every connected channel's numbers, each written as its own, and Stripe's: for the worker every few hours. */
export async function syncEarnings(now = new Date()): Promise<string[]> {
  const log: string[] = [];
  const channels = await admin((tx) => tx<{ id: string; user_id: string; platform: "youtube" | "tiktok"; timezone: string }[]>`
    select c.id, c.user_id, c.platform, p.timezone from public.channels c join public.profiles p on p.id = c.user_id where c.status = 'connected'`);
  for (const c of channels) {
    try {
      const t = localParts(now, validTimezone(c.timezone));
      const today = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
      log.push(c.platform === "youtube" ? await syncYouTube(c.user_id, c.id, now) : await syncTikTok(c.user_id, c.id, today));
    } catch (e) {
      log.push(`${c.platform} ${c.id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  const keys = await admin((tx) => tx<{ user_id: string; key: string }[]>`select user_id, key from public.stripe_keys`);
  for (const k of keys) {
    try {
      log.push(await syncStripe(k.user_id, k.key, now));
    } catch (e) {
      log.push(`stripe ${k.user_id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (configured().youtubeLive) log.push(...(await syncAllSuperChats(now)));
  return log;
}

/** A seller's restricted key: checked by reading with it, then kept encrypted. */
export async function connectStripe(userId: string, key: string): Promise<{ ok: true } | { ok: false; reason: "format" | "rejected" }> {
  if (!/^rk_(live|test)_[A-Za-z0-9]+$/.test(key)) return { ok: false, reason: "format" };
  try {
    await new Stripe(key).balanceTransactions.list({ limit: 1 });
  } catch {
    return { ok: false, reason: "rejected" };
  }
  await admin((tx) => tx`
    insert into public.stripe_keys (user_id, key, connected_at) values (${userId}, ${seal(key)}, now())
    on conflict (user_id) do update set key = excluded.key, connected_at = now()`);
  try {
    await syncStripe(userId, seal(key), new Date());
  } catch {
    // the next sync picks it up
  }
  return { ok: true };
}

export async function disconnectStripe(userId: string): Promise<void> {
  await admin(async (tx) => {
    await tx`delete from public.stripe_keys where user_id = ${userId}`;
    await tx`delete from public.metrics where user_id = ${userId} and source = 'stripe'`;
  });
}

export async function hasStripe(userId: string): Promise<boolean> {
  const rows = await admin((tx) => tx`select 1 from public.stripe_keys where user_id = ${userId}`);
  return rows.length > 0;
}
