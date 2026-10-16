import "server-only";
import Stripe from "stripe";
import { lastDays, fill, fillReported, fillSince, fromMinor, fromTotals, goalProgress, lastReported, sum, type Point } from "../earnings/series";
import { localParts, validTimezone } from "../shorts/times";
import { open, seal } from "./crypto";
import { admin, asUser } from "./db";
import { tiktokAccess } from "./tiktok";
import { youtubeAccess } from "./youtube";

/**
 * Earnings: real numbers only, from where they really are. YouTube
 * Analytics for views, subscribers and (for monetized channels) YouTube's
 * estimated revenue; TikTok's view counts; the gift coins the LIVE game
 * saw on the streamer's own TikTok LIVEs (what viewers sent, not what
 * TikTok pays them); and, for people who sell things, their Stripe sales
 * through a read-only key. Synced every few hours; nothing here is made
 * up or projected. YouTube runs 2 to 3 days behind, so its latest days
 * are "not reported yet", never zero, and Stripe's days from before it
 * was first read back to are unknown too.
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
};

export type Goal = { id: string; source: string; metric: string; target: number; period: "month" | "all"; label: string; progress: number; unit: Series["unit"]; currency?: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** what the LIVE figure is called everywhere: coins viewers sent that the game saw, never earnings or money */
export const LIVE_COINS = "Gift coins seen on your LIVEs";

/** LIVEs the game played that aren't verified as the streamer's own, so their coins aren't counted. */
export type Unverified = { lives: number; coins: number };

/** Everything the Earnings page shows, for the last `days` days. */
export async function earningsOf(userId: string, days: number): Promise<{ series: Series[]; goals: Goal[]; unverified: Unverified }> {
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
    const rows = await tx<{ source: string; metric: string; day: Date; value: string }[]>`
      select source, metric, day, value from public.metrics where day > now() - interval '400 days'`;
    // only LIVEs heard on their own TikTok count; the rest are shown apart, plainly
    const sessions = await tx<{ day: string; verified: boolean; lives: number; coins: number }[]>`
      select to_char(started_at at time zone ${tz}, 'YYYY-MM-DD') as day, verified, count(*)::int as lives, sum(coins)::int as coins
      from public.live_sessions group by 1, 2`;

    const by = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const k = `${r.source}:${r.metric}`;
      if (!by.has(k)) by.set(k, new Map());
      by.get(k)!.set(iso(r.day), Number(r.value));
    }
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
      const m = by.get(`youtube:${metric}`) ?? new Map<string, number>();
      return [fillReported(range, m), { through: lastReported(m) ?? undefined }];
    };
    if (by.has("youtube:views")) {
      add("youtube:views", "youtube", "Views on YouTube", "count", ...youtube("views"));
      add("youtube:subscribers", "youtube", "New subscribers", "count", ...youtube("subscribers"));
    }
    if (by.has("youtube:revenue")) {
      const [points, extra] = youtube("revenue");
      add("youtube:revenue", "youtube", "YouTube revenue", "money", points, { ...extra, currency: "USD", note: "YouTube's own estimate" });
    }
    if (by.has("tiktok:views_total")) add("tiktok:views", "tiktok", "Views on TikTok", "count", fromTotals(range, by.get("tiktok:views_total")!), { note: "From your videos' view counts, read every few hours" });
    if (live.size) add("live:coins", "live", LIVE_COINS, "coins", fill(range, live, 0), { note: "What viewers sent on your own LIVEs, as the game counted it. Not what TikTok pays you" });
    for (const [k, m] of by) {
      if (!k.startsWith("stripe:revenue:")) continue;
      const cur = k.split(":")[2].toUpperCase();
      add(k, "stripe", `Sales through Stripe (${cur})`, "money", fillSince(range, m, stripeSince), { currency: cur, note: "Charges less refunds, before Stripe's fees", from: stripeSince ?? undefined });
    }

    const goals = await tx<{ id: string; source: string; metric: string; target: string; period: "month" | "all"; label: string }[]>`
      select id, source, metric, target, period, label from public.goals order by created_at`;
    const everything = (source: string, metric: string): Point[] => {
      if (source === "live") return fill(allDays, live, 0);
      if (source === "tiktok") return fromTotals(allDays, by.get("tiktok:views_total") ?? new Map());
      if (source === "youtube") return fillReported(allDays, by.get(`${source}:${metric}`) ?? new Map());
      return fillSince(allDays, by.get(`${source}:${metric}`) ?? new Map(), stripeSince);
    };
    return {
      series: out,
      goals: goals.map((g) => {
        const unit: Series["unit"] = g.source === "live" ? "coins" : g.metric.startsWith("revenue") ? "money" : "count";
        const currency = g.metric.startsWith("revenue:") ? g.metric.split(":")[1].toUpperCase() : g.metric === "revenue" ? "USD" : undefined;
        return { id: g.id, source: g.source, metric: g.metric, target: Number(g.target), period: g.period, label: g.label, progress: goalProgress(everything(g.source, g.metric), g.period, today), unit, currency };
      }),
      unverified,
    };
  });
}

async function put(userId: string, source: string, metric: string, day: string, value: number) {
  await admin((tx) => tx`
    insert into public.metrics (user_id, source, metric, day, value) values (${userId}, ${source}, ${metric}, ${day}, ${value})
    on conflict (user_id, source, metric, day) do update set value = excluded.value`);
}

/** YouTube Analytics, by day: views and subscribers, and revenue if the channel is monetized. */
async function syncYouTube(userId: string, channelId: string, now: Date): Promise<string> {
  const access = await youtubeAccess(channelId);
  const q = (metrics: string) =>
    `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({ ids: "channel==MINE", startDate: iso(new Date(now.getTime() - 35 * 86400_000)), endDate: iso(now), metrics, dimensions: "day", sort: "day" })}`;
  let res = await fetch(q("views,subscribersGained,estimatedRevenue"), { headers: { authorization: `Bearer ${access}` } });
  let money = true;
  // channels outside the Partner Program can't read revenue: try again without it
  if (res.status === 403) {
    money = false;
    res = await fetch(q("views,subscribersGained"), { headers: { authorization: `Bearer ${access}` } });
  }
  if (!res.ok) throw new Error(`YouTube Analytics: ${res.status}`);
  const j = (await res.json()) as { rows?: (string | number)[][] };
  for (const r of j.rows ?? []) {
    const day = String(r[0]);
    await put(userId, "youtube", "views", day, Number(r[1]));
    await put(userId, "youtube", "subscribers", day, Number(r[2]));
    if (money) await put(userId, "youtube", "revenue", day, Number(r[3]));
  }
  return `youtube ${j.rows?.length ?? 0} days`;
}

/** TikTok gives each video's total views, not daily ones: today's grand total is kept, and the days are the differences. */
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
  await put(userId, "tiktok", "views_total", today, total);
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
    await put(userId, "stripe", `revenue:${cur}`, day, Math.round(v * 100) / 100);
  }
  return `stripe ${days.size} days`;
}

/** Every connected account's numbers, for the worker every few hours. */
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
