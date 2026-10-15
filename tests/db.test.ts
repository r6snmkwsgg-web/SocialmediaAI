import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Row-level security, checked against a real Postgres: every signed-in
 * account sees only its own rows, and nobody signed in can read a secret.
 * Runs when TEST_DATABASE_URL points at a database whose name ends in
 * _test (it wipes it first); skipped otherwise.
 */

const url = process.env.TEST_DATABASE_URL;
const safe = !!url && /\/[\w-]+_test(\?.*)?$/.test(url);

type Db = typeof import("@/lib/server/db");
type Live = typeof import("@/lib/server/live");
type Gen = typeof import("@/lib/server/shorts/generate");
type Queue = typeof import("@/lib/server/shorts/queue");
type Render = typeof import("@/lib/server/shorts/render");
type Post = typeof import("@/lib/server/shorts/post");
type Stats = typeof import("@/lib/server/shorts/stats");
type Earn = typeof import("@/lib/server/earnings");
type Trends = typeof import("@/lib/server/trends");

describe.skipIf(!safe)("the database", () => {
  let db: Db;
  let live: Live;
  let gen: Gen;
  let queue: Queue;
  let render: Render;
  let post: Post;
  let stats: Stats;
  let earn: Earn;
  let trends: Trends;
  let A = "";
  let B = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = await import("@/lib/server/db");
    live = await import("@/lib/server/live");
    gen = await import("@/lib/server/shorts/generate");
    queue = await import("@/lib/server/shorts/queue");
    render = await import("@/lib/server/shorts/render");
    post = await import("@/lib/server/shorts/post");
    stats = await import("@/lib/server/shorts/stats");
    earn = await import("@/lib/server/earnings");
    trends = await import("@/lib/server/trends");
    await db.admin(async (tx) => {
      await tx.unsafe("drop schema if exists public cascade; drop schema if exists hookline cascade; drop schema if exists auth cascade; create schema public; grant usage on schema public to public;");
      await tx.unsafe(readFileSync("supabase/local.sql", "utf8"));
      for (const f of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
        await tx.unsafe(readFileSync(join("supabase/migrations", f), "utf8"));
      }
    });
    [A, B] = await db.admin(async (tx) => {
      const rows = await tx<{ id: string }[]>`insert into auth.users (email) values ('a@test.local'), ('b@test.local') returning id`;
      return rows.map((r) => r.id);
    });
    await db.admin(async (tx) => {
      for (const u of [A, B]) {
        const [ch] = await tx<{ id: string }[]>`insert into public.channels (user_id, platform, external_id, title) values (${u}, 'youtube', ${"UC" + u.slice(0, 8)}, 'Channel') returning id`;
        await tx`insert into public.channel_tokens (channel_id, access_token, refresh_token) values (${ch.id}, 'sealed', 'sealed')`;
        await tx`insert into public.videos (user_id, format, params, key, title) values (${u}, 'battle', '{}', 'battle:spike:sword', 'Spike vs Sword')`;
        await tx`insert into public.live_sessions (id, user_id, game, started_at) values (gen_random_uuid(), ${u}, 'battle', now())`;
        await tx`insert into public.stripe_keys (user_id, key) values (${u}, 'sealed')`;
      }
      await tx`insert into public.subscriptions (user_id, plan, status) values (${A}, 'pro', 'active')`;
      await tx`insert into public.stripe_events (id, type) values ('evt_1', 'customer.subscription.updated')`;
      await tx`insert into public.trend_videos (external_id, niche, title, url, published_at, views, views_per_hour, format) values ('v1', 'gaming', 'A video', 'https://youtube.com/shorts/v1', now(), 1000, 50, 'battle')`;
    });
  });

  afterAll(async () => {
    await db?.sql().end();
  });

  it("a new account gets a profile", async () => {
    const rows = await db.asUser(A, (tx) => tx`select id, email from public.profiles`);
    expect(rows).toEqual([{ id: A, email: "a@test.local" }]);
  });

  it("each account sees only its own rows", async () => {
    const owner: Record<string, string> = { profiles: "id", channels: "user_id", videos: "user_id", live_sessions: "user_id" };
    for (const [table, col] of Object.entries(owner)) {
      const mine = await db.asUser(A, (tx) => tx.unsafe(`select ${col} as owner from public.${table}`));
      expect(mine.map((r) => r.owner), table).toEqual([A]);
    }
  });

  it("can't change or delete someone else's rows", async () => {
    const changed = await db.asUser(A, (tx) => tx`update public.videos set title = 'mine now' where user_id = ${B} returning id`);
    expect(changed).toHaveLength(0);
    const gone = await db.asUser(A, (tx) => tx`delete from public.live_sessions where user_id = ${B} returning id`);
    expect(gone).toHaveLength(0);
    await expect(db.asUser(A, (tx) => tx`insert into public.videos (user_id, format, params, key, title) values (${B}, 'battle', '{}', 'k', 't')`)).rejects.toThrow(/row-level security/);
  });

  it("nobody signed in can read tokens, Stripe keys or Stripe's events", async () => {
    for (const table of ["channel_tokens", "stripe_keys", "stripe_events"]) {
      const rows = await db.asUser(A, (tx) => tx.unsafe(`select * from public.${table}`));
      expect(rows, table).toHaveLength(0);
    }
  });

  it("plans are read-only: only the webhook (the server) changes them", async () => {
    const mine = await db.asUser(A, (tx) => tx`select plan from public.subscriptions`);
    expect(mine).toEqual([{ plan: "pro" }]);
    expect(await db.asUser(B, (tx) => tx`select plan from public.subscriptions`)).toHaveLength(0);
    const upgraded = await db.asUser(A, (tx) => tx`update public.subscriptions set plan = 'creator' returning plan`);
    expect(upgraded).toHaveLength(0);
    await expect(db.asUser(B, (tx) => tx`insert into public.subscriptions (user_id, plan) values (${B}, 'creator')`)).rejects.toThrow(/row-level security/);
  });

  it("trends are shared by everyone signed in", async () => {
    expect(await db.asUser(B, (tx) => tx`select external_id from public.trend_videos`)).toEqual([{ external_id: "v1" }]);
  });

  it("disconnecting a channel takes its tokens with it", async () => {
    await db.asUser(B, (tx) => tx`delete from public.channels`);
    const left = await db.admin((tx) => tx<{ n: number }[]>`select count(*)::int as n from public.channel_tokens t join public.channels c on c.id = t.channel_id where c.user_id = ${B}`);
    expect(left[0].n).toBe(0);
    const all = await db.admin((tx) => tx<{ n: number }[]>`select count(*)::int as n from public.channel_tokens`);
    expect(all[0].n).toBe(1);
  });

  it("a LIVE game reads its streamer's settings through their key, as their plan allows", async () => {
    const key = await live.overlayKeyOf(A);
    expect(await live.overlayKeyOf(A)).toBe(key);
    await live.saveLiveSettings(A, { ...(await live.liveSettingsOf(A)).settings, game: "race", vote: false });
    const o = await live.overlayFor(key);
    // A is on Pro: every game, but not their own gifts
    expect(o?.settings).toMatchObject({ game: "race", vote: false, gifts: null });
    expect(o?.plan.tag).toBe(false);
    expect(await live.overlayFor("x".repeat(32))).toBeNull();
    // B can't see A's key or settings
    expect(await db.asUser(B, (tx) => tx`select key from public.overlay_keys`)).toHaveLength(0);
    expect(await db.asUser(B, (tx) => tx`select settings from public.live_settings`)).toHaveLength(0);
  });

  it("saves a session's numbers, which only ever go up", async () => {
    const key = await live.overlayKeyOf(A);
    const id = "0b6e3f8e-5c1a-4d2b-9f3e-7a6b5c4d3e2f";
    const now = Date.now();
    const p = { key, id, game: "battle" as const, startedAt: now - 600_000, lastAt: now - 1000, rounds: 4, coins: 120, peakPlayers: 6, topGifters: [{ id: "u1", name: "kayla", coins: 100 }] };
    expect(await live.recordSession(p)).toBe(true);
    // an older send arriving late changes nothing
    expect(await live.recordSession({ ...p, rounds: 2, coins: 50, lastAt: now - 300_000, topGifters: [] })).toBe(true);
    const s = (await live.sessionsOf(A)).find((x) => x.id === id);
    expect(s).toMatchObject({ id, rounds: 4, coins: 120, peakPlayers: 6, topGifters: [{ name: "kayla", coins: 100 }] });
    expect(await live.recordSession({ ...p, key: "y".repeat(32) })).toBe(false);
    expect(await live.sessionsOf(B)).toHaveLength(1);
  });

  it("makes a day's Shorts as the plan allows, and never twice at once", async () => {
    const [{ id: C }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('c@test.local') returning id`);
    await db.admin((tx) => tx`update public.profiles set timezone = 'America/New_York', onboarded_at = now(), goal = 'shorts' where id = ${C}`);
    const made = await Promise.all([gen.makeShorts(C, { origin: "daily" }), gen.makeShorts(C, { origin: "daily" })]);
    expect(made.sort()).toEqual([0, 3]);
    const q = await queue.queueOf(C);
    expect(q.waiting).toHaveLength(3);
    expect(new Set(q.waiting.map((w) => w.spec.format)).size).toBeGreaterThan(1);
    expect(q.waiting.every((w) => w.why.length >= 2 && w.suggestedFor)).toBe(true);
    // a swipe left makes one in its place
    expect(await queue.reject(C, q.waiting[0].id)).toBe(true);
    expect(await gen.makeShorts(C, { origin: "replacement" })).toBe(1);
    expect((await queue.queueOf(C)).waiting).toHaveLength(3);
    // B can't see or decide C's
    const theirs = new Set(q.waiting.map((w) => w.id));
    expect((await queue.queueOf(B)).waiting.some((w) => theirs.has(w.id))).toBe(false);
    expect(await queue.reject(B, q.waiting[1].id)).toBe(false);
  });

  it("renders paid plans first, and a finished render is ready to post", async () => {
    const [{ id: C }] = await db.admin((tx) => tx<{ id: string }[]>`select id from auth.users where email = 'c@test.local'`);
    const free = (await queue.queueOf(C)).waiting[0];
    await gen.makeShorts(A, { origin: "daily", count: 1 });
    const pro = (await queue.queueOf(A)).waiting[0];
    const { PLANS } = await import("@/lib/billing/plans");
    expect(await queue.approve(C, free.id, PLANS.free)).toBe(true);
    expect(await queue.approve(A, pro.id, PLANS.pro)).toBe(true);
    const first = await render.claimJob();
    expect(first?.videoId).toBe(pro.id);
    expect(first?.tag).toBe(false);
    const second = await render.claimJob();
    expect(second?.videoId).toBe(free.id);
    expect(second?.tag).toBe(true);
    await render.finishJob(first!, `${A}/${pro.id}.mp4`);
    const coming = (await queue.queueOf(A)).coming.find((c) => c.id === pro.id)!;
    expect(coming).toMatchObject({ status: "ready", hasFile: true });
    // Pro posts for you: it kept a time
    expect(coming.scheduledFor).not.toBeNull();
    // three failed tries and it gives up, saying why
    for (let i = 0; i < 3; i++) {
      const j = i === 0 ? second! : (await render.claimJob())!;
      await render.failJob(j, "chrome went away");
    }
    const failed = (await queue.queueOf(C)).coming.find((c) => c.id === free.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/chrome went away/);
  });

  it("puts scheduled Shorts live when their time comes", async () => {
    const [v] = await db.admin((tx) => tx<{ id: string }[]>`
      insert into public.videos (user_id, format, params, key, title, status, scheduled_for, youtube_id)
      values (${A}, 'quiz', '{"questions":[]}', 'quiz:mixed', 'Due', 'scheduled', now() - interval '1 minute', 'abcdefghijk') returning id`);
    const log = await post.postDue();
    expect(log.join(" ")).toMatch(/went public/);
    const [row] = await db.admin((tx) => tx<{ status: string; posted_at: Date }[]>`select status, posted_at from public.videos where id = ${v.id}`);
    expect(row.status).toBe("posted");
    expect(row.posted_at).not.toBeNull();
  });

  it("learns from views once there's a baseline", async () => {
    const vids = await db.admin((tx) => tx<{ id: string }[]>`
      insert into public.videos (user_id, format, params, key, title, status, posted_at, youtube_id)
      select ${A}, 'quiz', '{"questions":[]}', 'quiz:capitals', 'Q' || g, 'posted', now() - interval '2 days', 'yt' || g
      from generate_series(1, 4) g returning id`);
    for (const [i, v] of vids.slice(0, 3).entries()) {
      await db.admin((tx) => tx`insert into public.video_stats (video_id, checkpoint, views) values (${v.id}, '24h', ${100 + i})`);
    }
    await stats.learn(A, vids[3].id, "quiz", "quiz:capitals", 400);
    const w = await db.admin((tx) => tx<{ kind: string; name: string; score: number; samples: number }[]>`select kind, name, score, samples from public.weights where user_id = ${A} order by kind`);
    expect(w.map((x) => `${x.kind}:${x.name}`)).toEqual(["format:quiz", "key:quiz:capitals"]);
    expect(w[0].score).toBeGreaterThan(3);
    expect(w[0].samples).toBe(1);
    // and people can read their own weights, never someone else's
    expect(await db.asUser(B, (tx) => tx`select * from public.weights`)).toHaveLength(0);
  });

  it("shows each account its own earnings, day by day, and its goals' progress", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await db.admin(async (tx) => {
      await tx`insert into public.metrics (user_id, source, metric, day, value) values (${A}, 'youtube', 'views', ${today}, 1200), (${A}, 'youtube', 'subscribers', ${today}, 7)`;
      await tx`insert into public.metrics (user_id, source, metric, day, value) values (${B}, 'youtube', 'views', ${today}, 999999)`;
      await tx`delete from public.live_sessions where user_id = ${A}`;
      await tx`insert into public.live_sessions (id, user_id, game, started_at, coins) values (gen_random_uuid(), ${A}, 'battle', now(), 350)`;
    });
    await db.asUser(A, (tx) => tx`insert into public.goals (user_id, source, metric, target, period, label) values (${A}, 'youtube', 'views', 10000, 'month', 'views')`);
    const e = await earn.earningsOf(A, 30);
    const views = e.series.find((s) => s.id === "youtube:views")!;
    expect(views.points).toHaveLength(30);
    expect(views.total).toBe(1200);
    expect(e.series.find((s) => s.id === "live:coins")!.total).toBe(350);
    expect(e.series.find((s) => s.id === "youtube:revenue")).toBeUndefined();
    expect(e.goals[0]).toMatchObject({ target: 10000, progress: 1200, unit: "count" });
    // metrics are written by the sync only
    await expect(db.asUser(A, (tx) => tx`insert into public.metrics (user_id, source, metric, day, value) values (${A}, 'youtube', 'views', ${today}, 5)`)).rejects.toThrow();
  });

  it("keeps a seller's Stripe key to keys that can only read", async () => {
    const [{ id: C }] = await db.admin((tx) => tx<{ id: string }[]>`select id from auth.users where email = 'c@test.local'`);
    expect(await earn.connectStripe(C, "sk_live_abc")).toEqual({ ok: false, reason: "format" });
    expect(await earn.hasStripe(C)).toBe(false);
  });

  it("follows niches, and shows rising Shorts in them, newest measures only", async () => {
    await trends.setNiches(A, ["quizzes", "not-a-niche"]);
    expect(await trends.followedNiches(A)).toEqual(["quizzes"]);
    await db.admin((tx) => tx`
      insert into public.trend_videos (external_id, niche, title, url, published_at, views, views_per_hour, format)
      values ('q1', 'quizzes', 'A quiz', 'https://youtube.com/shorts/q1', now() - interval '5 hours', 5000, 1000, 'quiz'),
             ('old', 'quizzes', 'Old', 'https://youtube.com/shorts/old', now() - interval '6 days', 9000, 60, 'quiz')`);
    const r = await trends.rising(A, ["quizzes"]);
    expect(r.map((v) => v.id)).toEqual(["q1"]);
    const board = await trends.leaderboard(A);
    expect(board.rows[0]).toMatchObject({ format: "quiz", videos: 1, typical: 1000 });
  });

  it("deleting an account deletes everything that was theirs", async () => {
    await db.admin((tx) => tx`delete from auth.users where id = ${B}`);
    const left = await db.admin((tx) => tx<{ n: number }[]>`
      select (select count(*) from public.profiles where id = ${B}) + (select count(*) from public.videos where user_id = ${B})
        + (select count(*) from public.live_sessions where user_id = ${B}) + (select count(*) from public.stripe_keys where user_id = ${B}) as n`);
    expect(Number(left[0].n)).toBe(0);
  });
});
