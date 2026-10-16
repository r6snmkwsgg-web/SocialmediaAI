import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import type { VideoState } from "@/lib/shorts/youtube";

/**
 * Row-level security, checked against a real Postgres: every signed-in
 * account sees only its own rows, and nobody signed in can read a secret.
 * Runs when TEST_DATABASE_URL points at a database whose name ends in
 * _test (it wipes it first); skipped otherwise.
 */

const url = process.env.TEST_DATABASE_URL;
const safe = !!url && /\/[\w-]+_test(\?.*)?$/.test(url);

// uploads go through YouTube's API, which a test fakes with stubFetch, unless the test says what an upload does itself
const upload = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<string>>());
vi.mock("@/lib/server/youtube", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/youtube")>();
  return { ...real, youtubeUpload: (...a: Parameters<typeof real.youtubeUpload>) => (upload.getMockImplementation() ? upload(...a) : real.youtubeUpload(...a)) };
});
// a video that isn't on disk reads as a few bytes, for tests that only need there to be one
vi.mock("@/lib/server/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/storage")>();
  return { ...real, getVideo: (key: string) => real.getVideo(key).catch(() => Buffer.from("video")) };
});
// accounts whose plan can't be read, for a try that goes wrong
const unreadable = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/server/billing", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/billing")>();
  return { ...real, billingFor: async (id: string) => (unreadable.has(id) ? Promise.reject(new Error("Stripe is down")) : real.billingFor(id)) };
});

type Db = typeof import("@/lib/server/db");
type Live = typeof import("@/lib/server/live");
type Gen = typeof import("@/lib/server/shorts/generate");
type Queue = typeof import("@/lib/server/shorts/queue");
type Render = typeof import("@/lib/server/shorts/render");
type Post = typeof import("@/lib/server/shorts/post");
type Stats = typeof import("@/lib/server/shorts/stats");
type Earn = typeof import("@/lib/server/earnings");
type Trends = typeof import("@/lib/server/trends");

/** a channel of the founder's own, which Hookline uploads to before YouTube's audit */
const TEST_CHANNEL = "UChooklinetestchannel01";

/** folders of video files the tests made, removed at the end */
const files = new Set<string>();

/** A rendered video on disk, where storage keeps them without Supabase. */
function videoFile(key: string, content: string) {
  const path = join(".data/videos", key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  files.add(join(".data/videos", key.split("/")[0]));
}

type Call = { url: string; init?: RequestInit };

/** Answers every outside call the test makes, and keeps a list of them. */
function stubFetch(answer: (url: string, init?: RequestInit) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    calls.push({ url: u, init });
    const out = answer(u, init);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

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
    // for posting: a key to seal test tokens with, Google set up (and an API key for public videos), one test channel before
    // YouTube's audit, and TikTok's direct posting
    process.env.TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    process.env.YOUTUBE_API_KEY = "test-key";
    process.env.YOUTUBE_TEST_CHANNELS = TEST_CHANNEL;
    process.env.TIKTOK_DIRECT_POST = "1";
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
    for (const dir of files) rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    const gone = await db.asUser(A, (tx) => tx`delete from public.videos where user_id = ${B} returning id`);
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

  it("counts a LIVE as the streamer's only when the game heard their own TikTok", async () => {
    const [{ id: E }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('e@test.local') returning id`);
    const [ch] = await db.admin((tx) => tx<{ id: string }[]>`insert into public.channels (user_id, platform, external_id, title, handle) values (${E}, 'tiktok', 'open-e', 'E', 'e.streams') returning id`);
    const key = await live.overlayKeyOf(E);
    const now = Date.now();
    const session = (id: string, heard?: string[]) => ({ key, id, game: "battle" as const, startedAt: now - 600_000, lastAt: now - 1000, rounds: 2, coins: 500, peakPlayers: 4, topGifters: [], ...(heard ? { heard } : {}) });
    const ids = ["1a6e3f8e-5c1a-4d2b-9f3e-7a6b5c4d3e21", "1a6e3f8e-5c1a-4d2b-9f3e-7a6b5c4d3e22", "1a6e3f8e-5c1a-4d2b-9f3e-7a6b5c4d3e23", "1a6e3f8e-5c1a-4d2b-9f3e-7a6b5c4d3e24", "1a6e3f8e-5c1a-4d2b-9f3e-7a6b5c4d3e25"];
    const byId = async () => new Map((await live.sessionsOf(E)).map((s) => [s.id, s]));

    // before TikTok tells Hookline the username, nothing is verified, even on their own LIVE
    await live.recordSession(session(ids[0], ["e.streams"]));
    expect((await byId()).get(ids[0])).toMatchObject({ heard: ["e.streams"], verified: false });
    // connecting TikTok verifies the username, and the LIVEs already heard on it
    await live.rememberTikTok(E, ch.id, "E.Streams");
    expect(await live.tiktokUsernamesOf(E)).toEqual(["e.streams"]);
    expect((await byId()).get(ids[0])?.verified).toBe(true);

    await live.recordSession(session(ids[1], ["famous.one"]));
    await live.recordSession(session(ids[2]));
    let got = await byId();
    expect(got.get(ids[1])).toMatchObject({ heard: ["famous.one"], verified: false });
    expect(got.get(ids[2])).toMatchObject({ heard: [], verified: false });

    // a session that moves to someone else's LIVE stops counting, and a late send can't bring it back
    await live.recordSession(session(ids[3], ["e.streams"]));
    expect((await byId()).get(ids[3])?.verified).toBe(true);
    await live.recordSession({ ...session(ids[3], ["e.streams", "famous.one"]), coins: 900 });
    await live.recordSession(session(ids[3], ["e.streams"]));
    got = await byId();
    expect(got.get(ids[3])).toMatchObject({ heard: ["e.streams", "famous.one"], verified: false, coins: 900 });

    // the same goes for part of a LIVE heard through a source that doesn't say whose it is (TikFinity, say after the
    // bridge is switched off): the game says so, and later sends that only name their own LIVE can't undo it
    await live.recordSession(session(ids[4], ["e.streams"]));
    expect((await byId()).get(ids[4])).toMatchObject({ unknown: false, verified: true });
    await live.recordSession({ ...session(ids[4], ["e.streams"]), unknown: true, coins: 50_000 });
    await live.recordSession({ ...session(ids[4], ["e.streams"]), unknown: false, coins: 50_000 });
    expect((await byId()).get(ids[4])).toMatchObject({ heard: ["e.streams"], unknown: true, verified: false, coins: 50_000 });
    // and connecting TikTok again doesn't verify it either
    await live.rememberTikTok(E, ch.id, "e.streams");
    expect((await byId()).get(ids[4])?.verified).toBe(false);
    await expect(db.admin((tx) => tx`update public.live_sessions set verified = true where id = ${ids[4]}`)).rejects.toThrow(/live_sessions_unknown_not_verified/);

    // Home and the admin page count only verified coins, and show the rest apart
    const home = await import("@/lib/server/home");
    expect((await home.homeData(E)).week).toMatchObject({ lives: 5, coins: 500, unverified: 500 + 500 + 900 + 50_000 });
    const adminView = await import("@/lib/server/admin");
    const o = await adminView.overview();
    expect(o.day.unverified).toBeGreaterThanOrEqual(51_900);

    // nobody signed in can write a username, or read someone else's
    expect(await db.asUser(A, (tx) => tx`select username from public.tiktok_usernames`)).toHaveLength(0);
    expect(await db.asUser(E, (tx) => tx`select username from public.tiktok_usernames`)).toEqual([{ username: "e.streams" }]);
    await expect(db.asUser(A, (tx) => tx`insert into public.tiktok_usernames (channel_id, user_id, username) values (${ch.id}, ${A}, 'a.streams')`)).rejects.toThrow(/permission denied/);
    await expect(db.asUser(E, (tx) => tx`update public.tiktok_usernames set username = 'famous.one'`)).rejects.toThrow(/permission denied/);
    // disconnecting TikTok takes its username with it
    await db.asUser(E, (tx) => tx`delete from public.channels where id = ${ch.id}`);
    expect(await live.tiktokUsernamesOf(E)).toEqual([]);
  });

  it("keeps LIVE sessions the server's to write: people only read their own", async () => {
    expect((await db.asUser(A, (tx) => tx<{ user_id: string }[]>`select user_id from public.live_sessions`)).every((r) => r.user_id === A)).toBe(true);
    await expect(db.asUser(A, (tx) => tx`insert into public.live_sessions (id, user_id, game, started_at, coins, verified) values (gen_random_uuid(), ${A}, 'battle', now(), 1000000, true)`)).rejects.toThrow(/permission denied/);
    await expect(db.asUser(A, (tx) => tx`update public.live_sessions set coins = 1000000, verified = true`)).rejects.toThrow(/permission denied/);
    await expect(db.asUser(A, (tx) => tx`delete from public.live_sessions`)).rejects.toThrow(/permission denied/);
  });

  it("keeps someone's answers about going LIVE on their profile", async () => {
    await db.asUser(A, (tx) => tx`update public.profiles set live_check = ${tx.json({ adult: false, canGoLive: true, computer: true })} where id = ${A}`);
    const [p] = await db.asUser(A, (tx) => tx<{ live_check: unknown }[]>`select live_check from public.profiles`);
    expect(p.live_check).toEqual({ adult: false, canGoLive: true, computer: true });
    expect(await db.asUser(B, (tx) => tx`select live_check from public.profiles where id = ${A}`)).toHaveLength(0);
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
    // its owner hears about it; before YouTube's audit, A's channel isn't a test channel, so A posts it and hears it's ready
    const notes = await import("@/lib/server/notify");
    expect((await notes.notificationsOf(C)).items.map((n) => n.title)).toContain("A Short couldn't be made");
    expect((await notes.notificationsOf(A)).items.some((n) => n.title === "Ready to download" && n.href === `/app/shorts/${pro.id}`)).toBe(false);
    expect((await notes.notificationsOf(A)).items.some((n) => n.title === "Ready for you to post" && n.href === `/app/shorts/${pro.id}`)).toBe(true);
    // with no tag, the video is its own copy for TikTok
    const [row] = await db.admin((tx) => tx<{ clean_path: string | null }[]>`select clean_path from public.videos where id = ${pro.id}`);
    expect(row.clean_path).toBe(`${A}/${pro.id}.mp4`);
  });

  it("keeps the creator's TikTok choices with a Short, and lets them choose again", async () => {
    const { PLANS } = await import("@/lib/billing/plans");
    const [v] = await db.admin((tx) => tx<{ id: string }[]>`
      insert into public.videos (user_id, format, params, key, title, status, suggested_for)
      values (${A}, 'wyr', '{"pairs":[]}', 'wyr:mixed', 'Would you rather', 'review', now() + interval '3 hours') returning id`);
    const choices = { privacy: "FOLLOWER_OF_CREATOR", comment: true, duet: false, stitch: false, disclose: false, yourBrand: false, branded: false } as const;
    expect(await queue.approve(A, v.id, PLANS.pro, new Date(), choices)).toBe(true);
    const coming = async () => (await queue.queueOf(A)).coming.find((x) => x.id === v.id)!;
    const c = await coming();
    // it goes to TikTok when it goes to YouTube
    expect(c.tiktok).toEqual({ at: c.scheduledFor, error: null });
    const [row] = await db.admin((tx) => tx<{ tiktok_post: unknown }[]>`select tiktok_post from public.videos where id = ${v.id}`);
    expect(row.tiktok_post).toEqual(choices);
    // TikTok turned it down: the creator sees why, and choosing again clears it
    await db.admin((tx) => tx`update public.videos set tiktok_error = 'No' where id = ${v.id}`);
    expect((await coming()).tiktok?.error).toBe("No");
    expect(await queue.chooseTikTok(A, v.id, { ...choices, privacy: "SELF_ONLY" })).toBe(true);
    expect((await coming()).tiktok?.error).toBeNull();
    expect(await queue.chooseTikTok(B, v.id, choices)).toBe(false);
  });

  it("tells people what happened once, and only them", async () => {
    const notes = await import("@/lib/server/notify");
    await notes.notify(A, { kind: "posted", title: "Live on YouTube", body: "A Short", href: "/app/shorts", key: "test:once" });
    await notes.notify(A, { kind: "posted", title: "Live on YouTube", body: "A Short", href: "/app/shorts", key: "test:once" });
    const mine = await notes.notificationsOf(A);
    expect(mine.items.filter((n) => n.title === "Live on YouTube")).toHaveLength(1);
    expect(mine.unread).toBeGreaterThan(0);
    expect((await notes.notificationsOf(B)).items.some((n) => n.title === "Live on YouTube")).toBe(false);
    // nobody signed in can write one, even for themselves
    await expect(db.asUser(B, (tx) => tx`insert into public.notifications (user_id, kind, title, key) values (${B}, 'plan', 'Free Pro', 'mine')`)).rejects.toThrow();
    await notes.markAllRead(A);
    expect((await notes.notificationsOf(A)).unread).toBe(0);
  });

  it("recaps a LIVE once nothing has happened in it for 20 minutes, saying so when it wasn't theirs", async () => {
    const notes = await import("@/lib/server/notify");
    const [s, other] = await db.admin((tx) => tx<{ id: string }[]>`
      insert into public.live_sessions (id, user_id, game, started_at, last_event_at, rounds, coins, peak_players, top_gifters, heard, verified)
      values (gen_random_uuid(), ${B}, 'battle', now() - interval '2 hours', now() - interval '25 minutes', 9, 1234, 17, ${db.sql().json([{ id: "1", name: "mia", coins: 999 }])}, '{b.streams}', true),
             (gen_random_uuid(), ${B}, 'battle', now() - interval '3 hours', now() - interval '2 hours', 3, 50000, 40, '[]', '{famous.one}', false)
      returning id`);
    const quiet = await live.recapLives();
    expect(quiet).toContain(`recap for ${s.id}`);
    expect(await live.recapLives()).not.toContain(`recap for ${s.id}`);
    const recaps = (await notes.notificationsOf(B)).items.filter((n) => n.kind === "live");
    const mine = recaps.find((n) => n.title.startsWith("LIVE recap: 9 rounds"))!;
    expect(mine.title).toBe("LIVE recap: 9 rounds, 1,234 gift coins seen");
    expect(mine.body).toMatch(/17 playing at once\. Top gifter: mia with 999 coins/);
    expect(await live.recapLives()).not.toContain(`recap for ${other.id}`);
    const theirs = recaps.find((n) => n.title.startsWith("LIVE recap: 3 rounds"))!;
    expect(theirs.title).toBe("LIVE recap: 3 rounds, not verified");
    expect(theirs.body).toMatch(/@famous\.one.*50,000 gift coins seen don't count in Earnings/);
  });

  it("keeps a library of every Short said yes to, with how each did against usual", async () => {
    const lib = await import("@/lib/server/shorts/library");
    const [{ id: D }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('d@test.local') returning id`);
    const ids: string[] = [];
    for (const [i, views] of [[1, 100], [2, 200], [3, 300], [4, 990]] as const) {
      const [v] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, format, params, key, title, status, decided_at, posted_at, youtube_id)
        values (${D}, ${i === 4 ? "quiz" : "wyr"}, '{}', 'k', ${`Short number ${i}`}, 'posted', now() - make_interval(days => ${10 - i}), now() - make_interval(days => ${10 - i}), ${`yt${i}`})
        returning id`);
      await db.admin((tx) => tx`insert into public.video_stats (video_id, checkpoint, views, fetched_at) select ${v.id}, '24h', ${views}, posted_at + interval '24 hours 5 minutes' from public.videos where id = ${v.id}`);
      ids.push(v.id);
    }
    await db.admin((tx) => tx`insert into public.videos (user_id, format, params, key, title, status, decided_at, scheduled_for) values (${D}, 'race', '{}', 'k', 'Coming soon', 'scheduled', now(), now() + interval '2 days')`);
    await db.admin((tx) => tx`insert into public.videos (user_id, format, params, key, title, status) values (${D}, 'quiz', '{}', 'k', 'Still in review', 'review')`);

    const all = await lib.libraryOf(D);
    expect(all.total).toBe(5);
    expect(all.items[0].title).toBe("Coming soon");
    // the usual is the middle of the first days: 250, so 990 views is about 3.8×
    const best = all.items.find((x) => x.title === "Short number 4")!;
    expect(best.vsUsual).toBeCloseTo((990 + 10) / (250 + 10));
    expect((await lib.libraryOf(D, { filter: "posted" })).total).toBe(4);
    expect((await lib.libraryOf(D, { format: "quiz" })).items.map((x) => x.title)).toEqual(["Short number 4"]);
    expect((await lib.libraryOf(D, { q: "number 2" })).items).toHaveLength(1);
    expect((await lib.libraryOf(D, { q: "100%" })).total).toBe(0);

    const month = await lib.calendarOf(D, new Date(Date.now() - 30 * 86400_000), new Date(Date.now() + 30 * 86400_000));
    expect(month.map((x) => x.title)).toContain("Coming soon");
    expect(month.map((x) => x.title)).not.toContain("Still in review");

    expect((await lib.shortOf(D, ids[3]))?.views["24h"]).toBe(990);
    expect(await lib.shortOf(A, ids[3])).toBeNull();
    expect((await lib.insightsFor(D)).typical).toBe(250);

    // a first day read two days late: its card says when it was read, and its "vs usual" is an estimate
    const [late] = await db.admin((tx) => tx<{ id: string }[]>`
      insert into public.videos (user_id, format, params, key, title, status, decided_at, posted_at, youtube_id)
      values (${D}, 'wyr', '{}', 'k', 'Read late', 'posted', now() - interval '3 days', now() - interval '3 days', 'ytlate') returning id`);
    await db.admin((tx) => tx`insert into public.video_stats (video_id, checkpoint, views, fetched_at) values (${late.id}, '24h', 400, now() - interval '1 day')`);
    const short = (await lib.shortOf(D, late.id))!;
    expect(short.readAt["24h"]).toBeCloseTo(48, 3);
    const item = (await lib.libraryOf(D, { q: "Read late" })).items[0];
    expect(item.vsEstimated).toBe(true);
    expect(item.vsUsual).toBeCloseTo((400 / Math.SQRT2 + 10) / (250 + 10), 4);
    expect(best.vsEstimated).toBe(false);
    // and it isn't counted in the usual, which is first days really seen
    expect((await lib.insightsFor(D)).typical).toBe(250);
  });

  it("knows when no worker is rendering, and shows the operator the whole picture", async () => {
    const worker = await import("@/lib/server/worker");
    const adminView = await import("@/lib/server/admin");
    expect((await worker.workerStatus()).running).toBe(0);
    await worker.checkIn("test-worker", null);
    expect((await worker.workerStatus()).running).toBe(1);
    // a worker that stopped checking in two minutes ago counts as gone
    expect((await worker.workerStatus(new Date(Date.now() + 3 * 60_000))).running).toBe(0);
    await worker.checkOut("test-worker");
    expect((await worker.workerStatus()).running).toBe(0);
    // nobody signed in can see the workers
    await expect(db.asUser(A, (tx) => tx`select * from public.workers`)).rejects.toThrow(/permission denied/);

    const o = await adminView.overview();
    expect(o.accounts).toBeGreaterThanOrEqual(2);
    expect(o.paying.pro).toBeGreaterThanOrEqual(1);
    expect(o.revenue).toBeGreaterThan(0);
    expect(o.newest.length).toBeGreaterThan(0);
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

  it("keeps the content ledger to the server", async () => {
    await expect(db.asUser(A, (tx) => tx`select * from public.content_ledger`)).rejects.toThrow(/permission denied/);
    await expect(db.asUser(A, (tx) => tx`insert into public.content_ledger (item, kind, user_id) values ('mine', 'quiz', ${A})`)).rejects.toThrow(/permission denied/);
    // text stories start off
    expect(await db.asUser(A, (tx) => tx`select text_stories from public.profiles`)).toEqual([{ text_stories: false }]);
  });

  it("claims an item for one channel only, all or nothing, even when two ask at once", async () => {
    const ledger = await import("@/lib/server/shorts/ledger");
    const both = await Promise.all([
      ledger.claim(A, [{ item: "t-shared", kind: "quiz" }, { item: "t-a", kind: "quiz" }]),
      ledger.claim(B, [{ item: "t-shared", kind: "quiz" }, { item: "t-b", kind: "quiz" }]),
    ]);
    // exactly one of them lost the shared item, and then got none of its items
    expect(both.filter((lost) => lost.length === 0)).toHaveLength(1);
    expect(both.find((lost) => lost.length)).toEqual(["t-shared"]);
    const rows = await db.admin((tx) => tx<{ item: string; user_id: string }[]>`select item, user_id from public.content_ledger where item like 't-%' order by item`);
    expect(rows.map((r) => r.item).sort()).toEqual(both[0].length ? ["t-b", "t-shared"] : ["t-a", "t-shared"]);
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(1);
    expect(await ledger.takenOf(["t-shared", "t-nobody"])).toEqual(new Set(["t-shared"]));
  });

  it("never deadlocks when two accounts claim the same items in a different order", async () => {
    const ledger = await import("@/lib/server/shorts/ledger");
    for (let round = 0; round < 40; round++) {
      const items = Array.from({ length: 5 }, (_, i) => ({ item: `dl-${round}-${i}`, kind: "quiz" as const }));
      const both = await Promise.all([ledger.claim(A, items), ledger.claim(B, [...items].reverse())]);
      // one gets all five, the other none of them, and neither throws
      expect(both.filter((lost) => lost.length === 0), `round ${round}`).toHaveLength(1);
      expect(both.find((lost) => lost.length)?.sort()).toEqual(items.map((x) => x.item).sort());
    }
  });

  it("gives every channel a look of its own, and keeps it", async () => {
    const ledger = await import("@/lib/server/shorts/ledger");
    const users = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) select 'look' || g || '@test.local' from generate_series(1, 6) g returning id`);
    const looks = await Promise.all(users.map((u) => ledger.lookFor(u.id)));
    expect(new Set(looks.map((l) => l.id)).size).toBe(6);
    expect(looks.every((l) => l.id > 0)).toBe(true);
    expect((await ledger.lookFor(users[0].id)).id).toBe(looks[0].id);
  });

  it("enters everything made before the ledger, so it never goes to another channel", async () => {
    const [{ id: H }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('h@test.local') returning id`);
    const params = {
      quiz: { questions: [{ id: "bf-q1", q: "Q?", options: ["a", "b", "c"], answer: 0, topic: "t", level: 1 }] },
      wyr: { pairs: [{ id: "bf-p1", a: "A", b: "B" }] },
      texts: { story: { id: "bf-story", contact: "Mum", messages: [] } },
      ranking: { metric: "gdp", region: "Asia", year: 1999, items: [{ iso: "JPN", name: "Japan", value: 3 }, { iso: "CHN", name: "China", value: 2 }, { iso: "IND", name: "India", value: 1 }], source: "" },
      race: {
        metric: "population",
        region: "Africa",
        years: [1970, 1985, 2000],
        series: [{ iso: "NGA", name: "Nigeria", values: [1, 5, 9] }, { iso: "ETH", name: "Ethiopia", values: [2, 3, 4] }, { iso: "EGY", name: "Egypt", values: [3, 1, null] }],
        top: 2,
        source: "",
      },
      battle: { a: "spike", b: "sword", seed: 4242 },
    };
    await db.admin(async (tx) => {
      for (const [format, p] of Object.entries(params)) await tx`insert into public.videos (user_id, format, params, key, title) values (${H}, ${format}, ${tx.json(p)}, 'k', 't')`;
      // the migration's last statement, run again now there's something for it to enter
      const migration = readFileSync("supabase/migrations/20261017030000_content_ledger.sql", "utf8");
      await tx.unsafe(migration.slice(migration.indexOf("insert into public.content_ledger (item, kind, user_id, claimed_at)")));
    });
    const rows = await db.admin((tx) => tx<{ item: string; kind: string }[]>`select item, kind from public.content_ledger where user_id = ${H} order by item`);
    // exactly what the app claims for each of them now
    const { ledgerIds } = await import("@/lib/shorts/formats");
    const claimed = Object.entries(params).flatMap(([format, p]) => ledgerIds({ format, params: p } as never).map((id) => `${format} ${id}`));
    expect(rows.map((r) => `${r.kind} ${r.item}`).sort()).toEqual(claimed.sort());
    expect(claimed).toHaveLength(6);
    // the charts by how they come out: the countdown's order, and the race's top two at the start and the finish
    expect(rows.map((r) => r.item)).toContain("ranking:gdp:Asia:JPN,CHN,IND");
    expect(rows.map((r) => r.item)).toContain("race:population:Africa:EGY,ETH>NGA,ETH");
  });

  it("never makes the same thing for two channels, even at the same moment", async () => {
    const [E, F] = (await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('ledger-e@test.local'), ('ledger-f@test.local') returning id`)).map((r) => r.id);
    await db.admin((tx) => tx`update public.profiles set onboarded_at = now(), goal = 'shorts' where id in (${E}, ${F})`);
    const made = await Promise.all([E, F].map((u) => gen.makeShorts(u, { origin: "daily", count: 1, like: "wyr" })));
    expect(made).toEqual([1, 1]);
    const pairsOf = async (u: string) => {
      const [v] = await db.admin((tx) => tx<{ params: { pairs: { id: string }[]; look: { id: number }; ending: string } }[]>`select params from public.videos where user_id = ${u}`);
      return v.params;
    };
    const [e, f] = [await pairsOf(E), await pairsOf(F)];
    expect(e.pairs).toHaveLength(5);
    expect(e.pairs.some((p) => f.pairs.some((q) => q.id === p.id))).toBe(false);
    // each in its own look, and claimed as theirs
    expect(e.look.id).not.toBe(f.look.id);
    expect(["comment", "loop"]).toContain(e.ending);
    const owners = await db.admin((tx) => tx<{ user_id: string; words: string[] | null }[]>`select user_id, words from public.content_ledger where item in ${tx(e.pairs.map((p) => p.id))}`);
    expect(owners.every((o) => o.user_id === E)).toBe(true);
    // with the words that carry their meaning, so they're caught in other words too
    expect(owners.every((o) => !!o.words?.length)).toBe(true);
  });

  it("catches what another channel has in other words, not just word for word", async () => {
    const ledger = await import("@/lib/server/shorts/ledger");
    const { words } = await import("@/lib/shorts/checks");
    const w = (t: string) => [...words(t)];
    expect(await ledger.claim(A, [{ item: "ow-q1", kind: "quiz", words: w("Which planet has the shortest day?") }])).toEqual([]);
    const found = await ledger.takenInOtherWords("quiz", [
      { id: "ow-new1", words: w("Which planet's day is the shortest of all?") },
      { id: "ow-new2", words: w("Which planet has the longest day?") },
      { id: "ow-new3", words: w("Which planet has the shortest day?") },
      { id: "ow-new4", words: [] },
    ]);
    expect(found).toEqual(new Set(["ow-new1", "ow-new3"]));
    // only against the same kind of thing
    expect(await ledger.takenInOtherWords("wyr", [{ id: "ow-new3", words: w("Which planet has the shortest day?") }])).toEqual(new Set());
  });

  it("says why when there's nothing new to make, tells them once, and clears it once there is", async () => {
    const notes = await import("@/lib/server/notify");
    const { PAIRS } = await import("@/lib/shorts/formats/wyr");
    const [{ id: G }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('g@test.local') returning id`);
    await db.admin((tx) => tx`update public.profiles set onboarded_at = now(), goal = 'shorts' where id = ${G}`);
    const toldOf = async () => (await notes.notificationsOf(G)).items.filter((n) => n.title === "No new Shorts to make right now");
    // every would-you-rather Hookline has is on someone else's channel
    await db.admin((tx) => tx`insert into public.content_ledger (item, kind, user_id) select unnest(${tx.array(PAIRS.map((p) => p.id))}::text[]), 'wyr', ${B}::uuid on conflict do nothing`);
    // asked for one like a rising Short: that kind has run out, and it says so there and then
    const like = await gen.makeShortsSaying(G, { origin: "daily", count: 1, like: "wyr" });
    expect(like).toMatchObject({ made: 0, short: "dry" });
    expect(like.note).toMatch(/no new would-you-rathers left/);
    // but everything else can still be made, so the queue and the bell don't say there's nothing new at all
    expect(await gen.shortsNoteOf(G)).toBeNull();
    expect(await toldOf()).toHaveLength(0);
    // when a day's Shorts couldn't all be made, the queue says why and the bell says it once, however often it's tried
    const at = new Date();
    await gen.noteDry(G, null, like.note, at);
    await gen.noteDry(G, at, like.note, new Date(at.getTime() + 60_000));
    expect(await gen.shortsNoteOf(G)).toBe(like.note);
    const told = await toldOf();
    expect(told).toHaveLength(1);
    expect(told[0].body).toBe(like.note);
    // a day's Short made in full (from the formats that have something), and then there's nothing to say
    expect(await gen.makeShorts(G, { origin: "daily", count: 1 })).toBe(1);
    expect(await gen.shortsNoteOf(G)).toBeNull();
  });

  it("makes text stories only once the creator turns them on, even like a rising one", async () => {
    const [{ id: G }] = await db.admin((tx) => tx<{ id: string }[]>`select id from auth.users where email = 'g@test.local'`);
    expect(await gen.makeShortsSaying(G, { origin: "daily", count: 1, like: "texts" })).toMatchObject({ made: 0, short: "off", note: null });
    await db.admin((tx) => tx`update public.profiles set text_stories = true where id = ${G}`);
    expect((await gen.makeShortsSaying(G, { origin: "daily", count: 1, like: "texts" })).made).toBe(1);
  });

  it("makes the morning's Shorts for whoever's due, and starts nobody new once its time is up", async () => {
    const { localParts } = await import("@/lib/shorts/times");
    // somewhere it's past six in the morning right now
    const zone = ["UTC", "Pacific/Kiritimati", "Asia/Tokyo", "Europe/Paris", "America/New_York", "America/Los_Angeles"].find((z) => {
      const h = localParts(new Date(), z).hour;
      return h >= 6 && h < 23;
    })!;
    const [{ id: K }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('k@test.local') returning id`);
    await db.admin((tx) => tx`update public.profiles set timezone = ${zone}, onboarded_at = now(), goal = 'shorts' where id = ${K}`);
    expect(await gen.dueForShorts(new Date(), 100)).toContain(K);
    expect(await gen.runDailyShorts(new Date(), 100, -1)).toEqual([]);
    const log = await gen.runDailyShorts(new Date(), 100);
    expect(log).toContain(`${K}: 3 made`);
    expect(await gen.dueForShorts(new Date(), 100)).not.toContain(K);
  }, 30_000);

  it("shows each account its own earnings, day by day, and its goals' progress", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await db.admin(async (tx) => {
      await tx`insert into public.metrics (user_id, source, metric, day, value) values (${A}, 'youtube', 'views', ${today}, 1200), (${A}, 'youtube', 'subscribers', ${today}, 7)`;
      await tx`insert into public.metrics (user_id, source, metric, day, value) values (${B}, 'youtube', 'views', ${today}, 999999)`;
      await tx`delete from public.live_sessions where user_id = ${A}`;
      await tx`insert into public.live_sessions (id, user_id, game, started_at, coins, heard, verified) values (gen_random_uuid(), ${A}, 'battle', now(), 350, '{a.streams}', true)`;
      // someone else's LIVE, heard through A's game: shown apart, never counted
      await tx`insert into public.live_sessions (id, user_id, game, started_at, coins, heard, verified) values (gen_random_uuid(), ${A}, 'battle', now(), 99999, '{famous.one}', false)`;
    });
    await db.asUser(A, (tx) => tx`insert into public.goals (user_id, source, metric, target, period, label) values (${A}, 'youtube', 'views', 10000, 'month', 'views')`);
    const e = await earn.earningsOf(A, 30);
    const views = e.series.find((s) => s.id === "youtube:views")!;
    expect(views.points).toHaveLength(30);
    expect(views.total).toBe(1200);
    const coins = e.series.find((s) => s.id === "live:coins")!;
    expect(coins.total).toBe(350);
    expect(coins.label).toBe("Gift coins seen on your LIVEs");
    expect(e.unverified).toEqual({ lives: 1, coins: 99999 });
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

  it("keeps making everyone's morning Shorts, however many accounts can't get theirs", async () => {
    // 32 Free accounts, the earliest sign-ups, that have used their 3 Shorts for the week
    const capped = await db.admin(async (tx) => {
      const ids = (await tx<{ id: string }[]>`insert into auth.users (email) select 'capped' || g || '@test.local' from generate_series(1, 32) g returning id`).map((r) => r.id);
      await tx`update public.profiles set timezone = 'UTC', goal = 'shorts', onboarded_at = now() - interval '30 days', created_at = now() - interval '30 days' where id in ${tx(ids)}`;
      await tx`
        insert into public.videos (user_id, format, params, key, title, origin, status, created_at)
        select u, 'wyr', '{"pairs":[]}', 'wyr', 'Made earlier', 'daily', 'rejected', now() - interval '2 days' from unnest(${ids}::uuid[]) u, generate_series(1, 3)`;
      return ids;
    });
    // and one ordinary account that signed up after all of them
    const [{ id: N }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('normal@test.local') returning id`);
    await db.admin((tx) => tx`update public.profiles set timezone = 'UTC', goal = 'both', onboarded_at = now() where id = ${N}`);

    const now = new Date();
    now.setUTCHours(12, 0, 0, 0);
    // the scheduler's way: five accounts a run, every few minutes
    for (let i = 0; i < 7; i++) await gen.runDailyShorts(now, 5);
    expect((await queue.queueOf(N)).waiting).toHaveLength(3);

    // each capped account was tried once and wrote down why nothing came of it
    const runs = await db.admin((tx) => tx<{ user_id: string; outcome: string; tried_at: Date }[]>`select user_id, outcome, tried_at from public.shorts_runs where user_id = any(${[...capped, N]}::uuid[])`);
    expect(runs).toHaveLength(33);
    expect(runs.filter((r) => r.user_id !== N).every((r) => r.outcome === "allowance" && r.tried_at.getTime() === now.getTime())).toBe(true);
    expect(runs.find((r) => r.user_id === N)?.outcome).toBe("made");
    // nobody tried today comes back today
    const later = await gen.dueForShorts(new Date(now.getTime() + 3 * 3600_000), 100);
    expect(later.filter((id) => capped.includes(id) || id === N)).toEqual([]);

    // tomorrow everyone's due again, longest waiting first
    const tomorrow = new Date(now.getTime() + 86400_000);
    await db.admin((tx) => tx`update public.shorts_runs set tried_at = tried_at - interval '1 day' where user_id = ${capped[31]}`);
    const due = await gen.dueForShorts(tomorrow, 100);
    expect(due[0]).toBe(capped[31]);
    expect(capped.every((id) => due.includes(id)) && due.includes(N)).toBe(true);

    // a try that went wrong is tried again after an hour, not every few minutes
    await db.admin((tx) => tx`delete from public.shorts_runs where user_id = ${capped[0]}`);
    unreadable.add(capped[0]);
    expect(await gen.tryDaily(capped[0], now)).toMatch(/failed: Stripe is down/);
    unreadable.delete(capped[0]);
    expect(await gen.dueForShorts(new Date(now.getTime() + 30 * 60_000), 100)).not.toContain(capped[0]);
    expect(await gen.dueForShorts(new Date(now.getTime() + 61 * 60_000), 100)).toContain(capped[0]);

    // people can read their own tries, not anyone else's, and can't write them
    expect(await db.asUser(N, (tx) => tx`select user_id from public.shorts_runs`)).toEqual([{ user_id: N }]);
    await expect(db.asUser(N, (tx) => tx`update public.shorts_runs set tried_at = now() - interval '9 days' returning user_id`)).rejects.toThrow(/permission denied/);
    await db.admin((tx) => tx`delete from auth.users where id = any(${[...capped, N]}::uuid[])`);
  }, 30_000);

  it("gives a Free account its next 3 the morning its week is up, not a day later", async () => {
    const [{ id: F }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('weekly@test.local') returning id`);
    await db.admin((tx) => tx`update public.profiles set timezone = 'UTC', goal = 'shorts', onboarded_at = now() - interval '1 day' where id = ${F}`);
    // the worker's tick, at the same time every morning
    const day0 = new Date();
    day0.setUTCHours(6, 3, 0, 0);
    const at = (days: number, minutes = 0) => new Date(day0.getTime() + days * 86400_000 + minutes * 60_000);
    const tick = async (t: Date) => ((await gen.dueForShorts(t, 100000)).includes(F) ? gen.tryDaily(F, t) : null);

    expect(await tick(at(0))).toBe(`${F}: 3 made`);
    // the run's Shorts are stamped a few seconds after its tick, as they are for real
    await db.admin((tx) => tx`update public.videos set created_at = ${at(0)}::timestamptz + interval '4 seconds' where user_id = ${F}`);
    for (let d = 1; d <= 6; d++) {
      expect(await tick(at(d))).toBe(`${F}: allowance used`);
      // once a day, not every few minutes
      expect(await tick(at(d, 5))).toBeNull();
    }
    // a week on, the first tick is a few seconds early; the next one gets them
    expect(await tick(at(7))).toBe(`${F}: allowance used`);
    expect(await tick(at(7, 5))).toBe(`${F}: 3 made`);
    const [run] = await db.admin((tx) => tx<{ outcome: string; next_try_at: Date }[]>`select outcome, next_try_at from public.shorts_runs where user_id = ${F}`);
    expect(run.outcome).toBe("made");
    expect(run.next_try_at.getTime()).toBe(Date.UTC(at(8).getUTCFullYear(), at(8).getUTCMonth(), at(8).getUTCDate()));
    await db.admin((tx) => tx`delete from auth.users where id = ${F}`);
  }, 30_000);

  it("finds whose morning it is among any number of accounts", async () => {
    // 2,100 accounts that have had today's Shorts, then one that hasn't
    const now = new Date();
    now.setUTCHours(12, 0, 0, 0);
    await db.admin(async (tx) => {
      const ids = (await tx<{ id: string }[]>`insert into auth.users (email) select 'many' || g || '@test.local' from generate_series(1, 2100) g returning id`).map((r) => r.id);
      await tx`update public.profiles set timezone = 'UTC', goal = 'shorts', onboarded_at = now() - interval '9 days', created_at = now() - interval '9 days' where id in ${tx(ids)}`;
      await tx`insert into public.videos (user_id, format, params, key, title, origin, created_at) select u, 'wyr', '{}', 'wyr', 'Today', 'daily', ${now} from unnest(${ids}::uuid[]) u`;
    });
    const [{ id: L }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('last@test.local') returning id`);
    // a timezone the database doesn't know counts as UTC, as it does everywhere else
    await db.admin((tx) => tx`update public.profiles set timezone = 'Not/AZone', goal = 'shorts', onboarded_at = now() where id = ${L}`);
    expect(await gen.dueForShorts(now, 25)).toContain(L);
    // before 6am where they are, nobody's due
    expect(await gen.dueForShorts(new Date(now.getTime() - 7 * 3600_000), 25)).not.toContain(L);
    await db.admin((tx) => tx`delete from auth.users where email like 'many%@test.local' or id = ${L}`);
  });

  it("gives a Short a new time when its suggested one has passed, and says why", async () => {
    const { PLANS } = await import("@/lib/billing/plans");
    const { isWhenLine } = await import("@/lib/shorts/times");
    const [v] = await db.admin((tx) => tx<{ id: string }[]>`
      insert into public.videos (user_id, format, params, key, title, status, suggested_for, why)
      values (${A}, 'wyr', '{"pairs":[]}', 'wyr:mixed', 'Late yes', 'review', now() - interval '1 hour',
        ${db.sql().json(["Would you rathers do about as well as your usual Short (4 posted)", "Posts at noon, a starting guess until your own numbers come in"])})
      returning id`);
    expect(await queue.approve(A, v.id, PLANS.pro)).toBe(true);
    const [row] = await db.admin((tx) => tx<{ scheduled_for: Date; why: string[] }[]>`select scheduled_for, why from public.videos where id = ${v.id}`);
    expect(row.scheduled_for.getTime()).toBeGreaterThan(Date.now() + 3600_000);
    expect(row.why[0]).toMatch(/Would you rathers/);
    expect(row.why.filter(isWhenLine)).toHaveLength(1);
    const hour = row.scheduled_for.getUTCHours();
    expect(row.why.at(-1)).toBe(`Posts at ${hour === 12 ? "noon" : `${hour - 12}pm`}, a starting guess until your own numbers come in`);
  });

  it("holds Shorts for YouTube's upload quota, says so, and tries again once it resets", async () => {
    const yt = await import("@/lib/server/youtube");
    const lib = await import("@/lib/server/shorts/library");
    // Google resets the quota at midnight Pacific time
    expect(yt.quotaResetsAt(new Date("2026-10-16T12:00:00Z")).toISOString()).toBe("2026-10-17T07:05:00.000Z");
    expect(yt.quotaResetsAt(new Date("2026-11-02T12:00:00Z")).toISOString()).toBe("2026-11-03T08:05:00.000Z");

    const [{ id: Q }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('quota@test.local') returning id`);
    const vids = await db.admin(async (tx) => {
      await tx`insert into public.subscriptions (user_id, plan, status) values (${Q}, 'pro', 'active')`;
      // a channel Hookline may upload to, that's said who it's for
      const [ch] = await tx<{ id: string }[]>`insert into public.channels (user_id, platform, external_id, made_for_kids) values (${Q}, 'youtube', ${TEST_CHANNEL}, false) returning id`;
      await tx`insert into public.channel_tokens (channel_id, access_token) values (${ch.id}, 'sealed')`;
      return tx<{ id: string }[]>`
        insert into public.videos (user_id, format, params, key, title, status, file_path, scheduled_for, decided_at)
        select ${Q}, 'wyr', '{"pairs":[]}', 'wyr', 'Held ' || g, 'ready', 'q/' || g || '.mp4', now() + make_interval(days => 2 + g), now()
        from generate_series(1, 2) g returning id`;
    });
    onTestFinished(() => void upload.mockReset());
    const now = new Date();
    upload.mockReset();
    upload.mockImplementation(async () => {
      throw new yt.YouTubeError("Starting the upload: The request cannot be completed because you have exceeded your quota.", 403, "quotaExceeded");
    });
    const log = await post.postDue(now);
    expect(log.join(" ")).toMatch(/YouTube upload quota used up/);
    // the quota is the whole app's: one try, and the rest of the line waits too
    expect(upload).toHaveBeenCalledTimes(1);
    const until = yt.quotaResetsAt(now);
    const coming = (await queue.queueOf(Q)).coming.filter((c) => vids.some((v) => v.id === c.id));
    expect(coming).toHaveLength(2);
    expect(coming.every((c) => c.status === "ready" && c.error === null && c.heldBack?.on === "youtube_quota" && c.heldBack.until?.getTime() === until.getTime())).toBe(true);
    expect((await lib.shortOf(Q, vids[0].id))?.heldBack).toEqual({ on: "youtube_quota", until });

    // a minute later nothing is tried
    await post.postDue(new Date(now.getTime() + 60_000));
    expect(upload).toHaveBeenCalledTimes(1);

    // once it resets, they go up and stop waiting
    upload.mockReset();
    upload.mockImplementation(async () => `yt${upload.mock.calls.length}`);
    await post.postDue(new Date(until.getTime() + 60_000));
    const rows = await db.admin((tx) => tx<{ status: string; youtube_id: string | null; waiting_on: string | null }[]>`select status, youtube_id, waiting_on from public.videos where user_id = ${Q}`);
    expect(rows.every((r) => r.status === "scheduled" && r.youtube_id && r.waiting_on === null)).toBe(true);
    expect((await queue.queueOf(Q)).coming.every((c) => c.heldBack === null)).toBe(true);

    // held for quota, then after the reset the channel's access has gone: it shows that, not the quota
    const [again] = await db.admin((tx) => tx<{ id: string }[]>`
      insert into public.videos (user_id, format, params, key, title, status, file_path, scheduled_for, decided_at, waiting_on, waiting_until)
      values (${Q}, 'wyr', '{"pairs":[]}', 'wyr', 'Held again', 'ready', 'q/3.mp4', now() + interval '3 days', now(), 'youtube_quota', ${until})
      returning id`);
    upload.mockReset();
    upload.mockImplementation(async () => {
      throw new yt.YouTubeError("Channel access was revoked", 401, null);
    });
    await post.postDue(new Date(until.getTime() + 60_000));
    const after = (await queue.queueOf(Q)).coming.find((c) => c.id === again.id)!;
    expect(after).toMatchObject({ status: "ready", error: "Channel access was revoked", heldBack: null });
    expect((await lib.shortOf(Q, again.id))?.heldBack).toBeNull();

    // and one left waiting past the reset (the channel was disconnected while it waited) stops saying so once the reset has passed
    await db.admin((tx) => tx`update public.videos set waiting_on = 'youtube_quota', waiting_until = now() - interval '1 minute', error = null where id = ${again.id}`);
    expect((await queue.queueOf(Q)).coming.find((c) => c.id === again.id)?.heldBack).toBeNull();
    expect((await lib.shortOf(Q, again.id))?.heldBack).toBeNull();
  });

  it("scales a late reading back to 24 hours, and only celebrates first days it really saw", async () => {
    const notes = await import("@/lib/server/notify");
    const [{ id: F }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('late@test.local') returning id`);
    const vids = await db.admin((tx) => tx<{ id: string; posted_at: Date }[]>`
      insert into public.videos (user_id, format, params, key, title, status, posted_at, youtube_id)
      select ${F}, 'quiz', '{"questions":[]}', 'quiz:science', 'Q' || g, 'posted', now() - interval '5 days', 'late' || g
      from generate_series(1, 5) g returning id, posted_at`);
    // the usual Short: 100 views, each read on time
    for (const v of vids.slice(0, 3)) {
      await db.admin((tx) => tx`insert into public.video_stats (video_id, checkpoint, views, fetched_at) values (${v.id}, '24h', 100, ${new Date(v.posted_at.getTime() + 24 * 3600_000)})`);
    }
    // 400 views, but read 48 hours after posting
    await stats.learn(F, vids[3].id, "quiz", "quiz:science", 400, 48);
    const [w] = await db.admin((tx) => tx<{ score: number }[]>`select score from public.weights where user_id = ${F} and kind = 'format'`);
    expect(w.score).toBeCloseTo((400 / Math.SQRT2 + 10) / 110, 4);
    expect((await notes.notificationsOf(F)).items.filter((n) => n.kind === "results")).toHaveLength(0);
    // the same views read on time are a first day worth hearing about
    await stats.learn(F, vids[4].id, "quiz", "quiz:science", 400, 24.2);
    expect((await notes.notificationsOf(F)).items.filter((n) => n.kind === "results")).toHaveLength(1);
  });

  it("shows YouTube's latest days as not reported yet, never as zero", async () => {
    const [{ id: E }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('lag@test.local') returning id`);
    const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
    await db.admin(async (tx) => {
      for (const [n, views] of [[6, 100], [5, 200], [3, 300]]) {
        await tx`insert into public.metrics (user_id, source, metric, day, value) values (${E}, 'youtube', 'views', ${day(n)}, ${views}), (${E}, 'youtube', 'subscribers', ${day(n)}, 1)`;
      }
    });
    const e = await earn.earningsOf(E, 30);
    const views = e.series.find((s) => s.id === "youtube:views")!;
    expect(views.points.slice(-3).map((p) => p.value)).toEqual([null, null, null]);
    expect(views.points.find((p) => p.day === day(4))?.value).toBe(0);
    expect(views.points.find((p) => p.day === day(10))?.value).toBeNull();
    expect(views.through).toBe(day(3));
    expect(views.total).toBe(600);
    expect(e.series.find((s) => s.id === "youtube:subscribers")?.through).toBe(day(3));
  });

  it("shows Stripe's days from before it was first read as unknown, not $0", async () => {
    const [{ id: S }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('seller@test.local') returning id`);
    const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
    await db.admin(async (tx) => {
      // connected 10 days ago, so read back 35 days from then
      await tx`insert into public.stripe_keys (user_id, key, connected_at) values (${S}, 'sealed', now() - interval '10 days')`;
      await tx`insert into public.metrics (user_id, source, metric, day, value) values (${S}, 'stripe', 'revenue:usd', ${day(40)}, 50), (${S}, 'stripe', 'revenue:usd', ${day(2)}, 25)`;
    });
    const e = await earn.earningsOf(S, 90);
    const sales = e.series.find((s) => s.id === "stripe:revenue:usd")!;
    // (the 45th day back is only partly read, so the first whole day is the 44th)
    expect(sales.from).toBe(day(44));
    expect(sales.points.find((p) => p.day === day(60))?.value).toBeNull();
    expect(sales.points.find((p) => p.day === day(45))?.value).toBeNull();
    expect(sales.points.find((p) => p.day === day(44))?.value).toBe(0);
    expect(sales.points.find((p) => p.day === day(20))?.value).toBe(0);
    expect(sales.total).toBe(75);
    await db.admin((tx) => tx`delete from auth.users where id = ${S}`);
  });

  it("deleting an account deletes everything that was theirs", async () => {
    await db.admin((tx) => tx`insert into public.content_ledger (item, kind, user_id) values ('b-had-this', 'quiz', ${B})`);
    await db.admin((tx) => tx`delete from auth.users where id = ${B}`);
    const left = await db.admin((tx) => tx<{ n: number }[]>`
      select (select count(*) from public.profiles where id = ${B}) + (select count(*) from public.videos where user_id = ${B})
        + (select count(*) from public.live_sessions where user_id = ${B}) + (select count(*) from public.stripe_keys where user_id = ${B}) as n`);
    expect(Number(left[0].n)).toBe(0);
    // what they had stays claimed, since their videos stay up
    const kept = await db.admin((tx) => tx<{ user_id: string | null }[]>`select user_id from public.content_ledger where item = 'b-had-this'`);
    expect(kept).toEqual([{ user_id: null }]);
  });
  describe("posting only what's true", () => {
    let E = "";
    let channel = "";
    let plans: typeof import("@/lib/billing/plans").PLANS;
    type Video = {
      user_id: string; status: string; params: object; decided_at: Date | null; scheduled_for: Date | null; uploaded_at: Date | null; file_path: string | null;
      clean_path: string | null; channel_id: string | null; youtube_id: string | null; youtube_verified: boolean; tiktok_post: object | null; tiktok_at: Date | null; description: string;
      youtube_status: string | null; youtube_wanted: string | null; youtube_publish_at: Date | null; made_for_kids: boolean | null;
    };
    /** A Short as the server would have left it (so past the guard on what YouTube said) */
    const video = async (over: Partial<Video> & { user_id: string }) => {
      const v: Video = {
        status: "ready", params: { pairs: [] }, decided_at: null, scheduled_for: null, uploaded_at: null, file_path: null, clean_path: null, channel_id: null,
        youtube_id: null, youtube_verified: false, tiktok_post: null, tiktok_at: null, description: "Pick one. #shorts #wyr",
        youtube_status: null, youtube_wanted: null, youtube_publish_at: null, made_for_kids: null, ...over,
      };
      const [r] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, format, params, key, title, description, status, decided_at, scheduled_for, uploaded_at, file_path, clean_path,
          channel_id, youtube_id, youtube_verified, tiktok_post, tiktok_at, youtube_status, youtube_wanted, youtube_publish_at, made_for_kids)
        values (${v.user_id}, 'wyr', ${tx.json(v.params as never)}, 'wyr:mixed', 'Would you rather', ${v.description}, ${v.status}, ${v.decided_at}, ${v.scheduled_for},
          ${v.uploaded_at}, ${v.file_path}, ${v.clean_path}, ${v.channel_id}, ${v.youtube_id}, ${v.youtube_verified}, ${v.tiktok_post ? tx.json(v.tiktok_post as never) : null}, ${v.tiktok_at},
          ${v.youtube_status}, ${v.youtube_wanted}, ${v.youtube_publish_at}, ${v.made_for_kids})
        returning id`);
      return r.id;
    };
    const row = async (id: string) =>
      (await db.admin((tx) => tx<Record<string, unknown>[]>`select * from public.videos where id = ${id}`))[0];

    beforeAll(async () => {
      if (!safe) return;
      plans = (await import("@/lib/billing/plans")).PLANS;
      const { seal } = await import("@/lib/server/crypto");
      [{ id: E }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('truth-e@test.local') returning id`);
      await db.admin((tx) => tx`insert into public.subscriptions (user_id, plan, status) values (${E}, 'pro', 'active')`);
      [{ id: channel }] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.channels (user_id, platform, external_id, title) values (${E}, 'youtube', ${TEST_CHANNEL}, 'Test channel') returning id`);
      await db.admin((tx) => tx`
        insert into public.channel_tokens (channel_id, access_token, expires_at) values (${channel}, ${seal("ya29.youtube")}, now() + interval '1 hour')`);
    });

    it("uploads only where it may, once the channel has said who it's for, and doesn't call that posted", async () => {
      const channels = await import("@/lib/server/channels");
      const mine = await video({ user_id: E, decided_at: new Date(), scheduled_for: new Date(Date.now() + 3 * 3600_000), file_path: `${E}/up.mp4` });
      videoFile(`${E}/up.mp4`, "tagless video");
      // A's channel isn't a test channel: before the audit, A posts their own
      await db.admin((tx) => tx`update public.channels set made_for_kids = false where user_id = ${A} and platform = 'youtube'`);
      const theirs = await video({ user_id: A, decided_at: new Date(), scheduled_for: new Date(Date.now() + 3 * 3600_000), file_path: `${A}/up.mp4` });
      const uploads: Record<string, unknown>[] = [];
      stubFetch((u, init) => {
        if (u.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
          uploads.push(JSON.parse(String(init?.body)));
          return new Response("{}", { status: 200, headers: { location: "https://upload.test/put" } });
        }
        if (u === "https://upload.test/put") return { id: "newvideo001" };
        throw new Error(`unexpected call to ${u}`);
      });

      // nothing posts to a channel until the creator says whether it's made for kids
      await post.postDue();
      expect(uploads).toHaveLength(0);
      expect(await channels.setAudience(E, channel, false, "public")).toBe(true);
      expect(await channels.setAudience(B, channel, true, "public")).toBe(false);
      await post.postDue();
      expect(uploads).toHaveLength(1);
      expect(uploads[0].status).toMatchObject({ privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: false });
      expect(await row(mine)).toMatchObject({ status: "scheduled", youtube_id: "newvideo001", youtube_verified: true, posted_at: null, channel_id: channel });
      // how it went up: public, private until its time; and kept before the channel answered, it took that answer
      expect(await row(mine)).toMatchObject({ youtube_wanted: "public", youtube_publish_at: (await row(mine)).scheduled_for, made_for_kids: false });
      expect(await row(theirs)).toMatchObject({ status: "ready", youtube_id: null });
      const notes = await import("@/lib/server/notify");
      expect((await notes.notificationsOf(E)).items.some((n) => n.title === "Live on YouTube")).toBe(false);
    });

    it("calls a Short posted only once YouTube says it can be seen, and says what went wrong when it can't", async () => {
      const at = new Date(Date.now() - 40 * 60_000);
      const due = {
        user_id: E, status: "scheduled", decided_at: new Date(), scheduled_for: at, uploaded_at: new Date(Date.now() - 2 * 3600_000), channel_id: channel, file_path: `${E}/up.mp4`,
        youtube_status: "uploaded", youtube_wanted: "public", youtube_publish_at: at,
      };
      const live = await video({ ...due, youtube_id: "livevideo01", youtube_verified: true });
      const kept = await video({ ...due, youtube_id: "keptvideo01", youtube_verified: true });
      const dup = await video({ ...due, youtube_id: "dupevideo01", youtube_verified: true });
      const busy = await video({ ...due, youtube_id: "busyvideo01", youtube_verified: true });
      const said: Record<string, unknown> = {
        livevideo01: { uploadStatus: "processed", privacyStatus: "public", madeForKids: true },
        keptvideo01: { uploadStatus: "processed", privacyStatus: "private", madeForKids: false },
        dupevideo01: { uploadStatus: "rejected", rejectionReason: "duplicate", privacyStatus: "private" },
        busyvideo01: { uploadStatus: "uploaded", privacyStatus: "private" },
      };
      const calls = stubFetch((u) => {
        const ids = new URL(u).searchParams.get("id")!.split(",");
        return { items: ids.filter((id) => said[id]).map((id) => ({ id, snippet: { channelId: TEST_CHANNEL }, status: said[id] })) };
      });
      const log = await post.confirmYouTube();
      // one call for the channel, as the channel itself, which can see its private videos
      expect(calls).toHaveLength(1);
      expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer ya29.youtube");
      expect(log.join(" ")).toMatch(/public on YouTube/);

      expect(await row(live)).toMatchObject({ status: "posted", youtube_privacy: "public", youtube_kids: true, posted_at: at });
      expect(await row(kept)).toMatchObject({ status: "failed", youtube_privacy: "private", posted_at: null });
      expect((await row(kept)).error).toMatch(/kept it private.*Until YouTube finishes reviewing Hookline/);
      expect(await row(dup)).toMatchObject({ status: "failed", error: "YouTube rejected it as a copy of a video already on the channel." });
      expect(await row(busy)).toMatchObject({ status: "scheduled", youtube_status: "uploaded" });

      const notes = (await (await import("@/lib/server/notify")).notificationsOf(E)).items;
      expect(notes.find((n) => n.href === `/app/shorts/${live}`)).toMatchObject({ title: "Live on YouTube", body: expect.stringMatching(/Made for Kids: comments are off/) });
      expect(notes.find((n) => n.href === `/app/shorts/${kept}`)?.title).toBe("YouTube kept a Short private");
      expect(notes.find((n) => n.href === `/app/shorts/${dup}`)?.title).toBe("YouTube didn't take a Short");
      // the private one is checked again when tried again; the rejected one goes up again
      await queue.retry(E, kept, plans.pro);
      expect(await row(kept)).toMatchObject({ status: "scheduled", youtube_id: "keptvideo01" });
      await queue.retry(E, dup, plans.pro);
      expect(await row(dup)).toMatchObject({ status: "ready", youtube_id: null, youtube_verified: false });
      // and nobody counts a Short that isn't up as posted
      expect((await queue.queueOf(E)).posted.map((p) => p.id)).toEqual([live]);
      // out of the way of the tests after this one, which would upload it again
      await db.admin((tx) => tx`delete from public.videos where id = ${dup}`);
    });

    it("keeps a record of every audience choice, made for kids Shorts don't ask for comments, and only the server says what YouTube said", async () => {
      const channels = await import("@/lib/server/channels");
      await channels.setAudience(E, channel, true, "unlisted");
      const log = async () => db.admin((tx) => tx<{ source: string; made_for_kids: boolean; privacy: string | null; channel_id: string | null; video_id: string | null }[]>`
        select source, made_for_kids, privacy, channel_id, video_id from public.audience_log where user_id = ${E} order by id`);
      // the channel's answers, and the Short kept before the first one taking it
      expect((await log()).map((r) => [r.source, r.made_for_kids, r.privacy])).toEqual([["channel", false, "public"], ["short", false, null], ["channel", true, "unlisted"]]);
      // nobody signed in can read it, even their own
      await expect(db.asUser(E, (tx) => tx`select * from public.audience_log`)).rejects.toThrow(/permission denied/);

      // the channel's answer, then the creator's own for one Short
      const asChannel = await video({ user_id: E, status: "review" });
      const own = await video({ user_id: E, status: "review" });
      expect(await queue.approve(E, asChannel, plans.pro)).toBe(true);
      expect(await queue.approve(E, own, plans.pro, new Date(), null, false)).toBe(true);
      expect(await row(asChannel)).toMatchObject({ made_for_kids: true, params: { pairs: [], allowComments: false } });
      expect(await row(own)).toMatchObject({ made_for_kids: false, params: { pairs: [] } });
      const coming = (await queue.queueOf(E)).coming;
      expect(coming.find((c) => c.id === asChannel)).toMatchObject({ madeForKids: true, comments: false });
      expect(coming.find((c) => c.id === own)).toMatchObject({ madeForKids: false, comments: true });
      expect((await log()).filter((r) => r.source === "short").slice(1).map((r) => [r.video_id, r.made_for_kids])).toEqual([[asChannel, true], [own, false]]);
      await channels.setAudience(E, channel, false, "public");

      // what YouTube said, and the link to it, are the server's to write
      await expect(db.asUser(E, (tx) => tx`update public.videos set youtube_verified = true where id = ${own}`)).rejects.toThrow(/only the server/);
      await expect(db.asUser(E, (tx) => tx`update public.videos set youtube_id = 'someoneelse' where id = ${own}`)).rejects.toThrow(/only the server/);
      await expect(db.asUser(E, (tx) => tx`update public.videos set youtube_wanted = 'private' where id = ${own}`)).rejects.toThrow(/only the server/);
      await expect(db.asUser(E, (tx) => tx`insert into public.videos (user_id, format, params, key, title, youtube_id) values (${E}, 'wyr', '{}', 'k', 't', 'x')`)).rejects.toThrow(/only the server/);
      expect(await db.asUser(E, (tx) => tx`update public.videos set title = 'Mine to change' where id = ${own} returning id`)).toHaveLength(1);
    });

    it("only counts an \"I posted it\" link that's on the creator's own channel", async () => {
      const ready = () => video({ user_id: E, decided_at: new Date(), file_path: `${E}/up.mp4` });
      const v = await ready();
      const state = (channelId: string): VideoState => ({ channelId, uploadStatus: "processed", privacy: "public", failureReason: null, rejectionReason: null, madeForKids: false });
      const found = (channelId: string) => async () => ({ state: state(channelId) });
      expect(await queue.markPosted(E, v, "https://example.com/watch")).toMatchObject({ ok: false, message: /doesn't look like a link/ });
      expect(await queue.markPosted(E, v, "https://youtube.com/shorts/theirvideo1", found("UCsomeoneelse"))).toMatchObject({ ok: false, message: /haven't connected/ });
      expect(await queue.markPosted(E, v, "https://youtube.com/shorts/goneovideo1", async () => ({ state: null }))).toMatchObject({ ok: false, message: /doesn't show a video/ });
      expect(await queue.markPosted(E, v, "https://youtube.com/shorts/goneovideo1", async () => "error")).toMatchObject({ ok: false, message: /didn't answer/ });
      // on their own channel, but YouTube turned it down: not posted, said as YouTube said it
      const broken = (over: Partial<VideoState>) => async () => ({ state: { ...state(TEST_CHANNEL), ...over } });
      expect(await queue.markPosted(E, v, "https://youtube.com/shorts/dupedvideo1", broken({ uploadStatus: "rejected", rejectionReason: "duplicate" })))
        .toEqual({ ok: false, message: "YouTube rejected it as a copy of a video already on the channel." });
      expect(await queue.markPosted(E, v, "https://youtube.com/shorts/brokevideo1", broken({ uploadStatus: "failed", failureReason: "codec" })))
        .toEqual({ ok: false, message: "YouTube couldn't process the video. Try again." });
      expect(await queue.markPosted(E, v, "https://youtube.com/shorts/gonedvideo1", broken({ uploadStatus: "deleted" }))).toMatchObject({ ok: false, message: /isn't on YouTube any more/ });
      expect(await row(v)).toMatchObject({ status: "ready", youtube_id: null });

      // checked with YouTube as their own channel: it's theirs
      const calls = stubFetch((u) => ({ items: [{ id: new URL(u).searchParams.get("id"), snippet: { channelId: TEST_CHANNEL }, status: { uploadStatus: "processed", privacyStatus: "public", madeForKids: false } }] }));
      expect(await queue.markPosted(E, v, "https://youtu.be/minevideo01")).toEqual({ ok: true, checked: true });
      expect(calls[0].url).toMatch(/part=snippet%2Cstatus&id=minevideo01/);
      expect(await row(v)).toMatchObject({ status: "posted", youtube_id: "minevideo01", youtube_verified: true, youtube_privacy: "public", channel_id: channel });
      // the same video can't be two Shorts
      const again = await ready();
      expect(await queue.markPosted(E, again, "https://youtu.be/minevideo01")).toMatchObject({ ok: false, message: /already linked/ });
      // with no way to ask YouTube, it's kept but doesn't count
      expect(await queue.markPosted(E, again, "https://youtube.com/watch?v=unchecked01", async () => "unchecked")).toEqual({ ok: true, checked: false });
      expect(await row(again)).toMatchObject({ status: "posted", youtube_id: "unchecked01", youtube_verified: false });
      expect((await queue.queueOf(E)).posted.find((p) => p.id === again)).toMatchObject({ verified: false });
      // posted with no link at all
      const plain = await ready();
      expect(await queue.markPosted(E, plain, "")).toEqual({ ok: true, checked: false });
      expect(await queue.markPosted(B, plain, "")).toMatchObject({ ok: false });

      // views are only read for the one that's checked
      await db.admin((tx) => tx`update public.videos set posted_at = now() - interval '25 hours' where id in ${tx([v, again])}`);
      const views = stubFetch((u) => ({ items: (new URL(u).searchParams.get("id") ?? "").split(",").map((id) => ({ id, statistics: { viewCount: "321" } })) }));
      await stats.collectStats();
      expect(views.map((c) => new URL(c.url).searchParams.get("id")).join(",")).toBe("minevideo01");
      const counted = await db.admin((tx) => tx<{ video_id: string }[]>`select distinct video_id from public.video_stats where video_id in ${tx([v, again])}`);
      expect(counted.map((c) => c.video_id)).toEqual([v]);
    });

    it("gives TikTok a copy without the free plan's tag, every way it goes there", async () => {
      // nothing else in the render queue
      await db.admin((tx) => tx`update public.render_jobs set status = 'done' where status in ('queued', 'running')`);
      const [{ id: F }, { id: G }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('truth-f@test.local'), ('truth-g@test.local') returning id`);
      await db.admin((tx) => tx`insert into public.channels (user_id, platform, external_id) values (${F}, 'tiktok', 'tt-f')`);
      const withTikTok = await video({ user_id: F, status: "review" });
      const without = await video({ user_id: G, status: "review" });

      // free, with TikTok: the tagged video, and the copy without the tag
      await queue.approve(F, withTikTok, plans.free);
      const j1 = (await render.claimJob())!;
      expect(j1).toMatchObject({ videoId: withTikTok, tag: true, alsoClean: true, clean: false });
      await render.finishJob(j1, `${F}/a.mp4`, `${F}/a-clean.mp4`);
      expect(await row(withTikTok)).toMatchObject({ status: "ready", file_path: `${F}/a.mp4`, clean_path: `${F}/a-clean.mp4` });

      // free, before TikTok: only the tagged one, and TikTok's copy is made when it's asked for, once
      await queue.approve(G, without, plans.free);
      const j2 = (await render.claimJob())!;
      expect(j2).toMatchObject({ videoId: without, tag: true, alsoClean: false });
      await render.finishJob(j2, `${G}/b.mp4`);
      expect(await row(without)).toMatchObject({ file_path: `${G}/b.mp4`, clean_path: null });
      expect(await render.cleanCopy(without)).toBeNull();
      expect(await render.cleanCopy(without)).toBeNull();
      const jobs = await db.admin((tx) => tx<{ n: number }[]>`select count(*)::int as n from public.render_jobs where video_id = ${without} and clean`);
      expect(jobs[0].n).toBe(1);
      expect((await queue.queueOf(G)).coming.find((c) => c.id === without)).toMatchObject({ tiktokFile: false, cleaning: true });
      const j3 = (await render.claimJob())!;
      expect(j3).toMatchObject({ videoId: without, tag: false, clean: true });
      await render.finishJob(j3, `${G}/b-clean.mp4`);
      expect(await row(without)).toMatchObject({ status: "ready", file_path: `${G}/b.mp4`, clean_path: `${G}/b-clean.mp4` });
      expect(await render.cleanCopy(without)).toBe(`${G}/b-clean.mp4`);
    });

    it("posts the tag-free copy to TikTok without #shorts, and tries again tomorrow when TikTok is full", async () => {
      const { seal } = await import("@/lib/server/crypto");
      const [tt] = await db.admin((tx) => tx<{ id: string }[]>`insert into public.channels (user_id, platform, external_id) values (${E}, 'tiktok', 'tt-e') returning id`);
      await db.admin((tx) => tx`insert into public.channel_tokens (channel_id, access_token, expires_at) values (${tt.id}, ${seal("act.tiktok")}, now() + interval '1 hour')`);
      videoFile(`${E}/t.mp4`, "TAGGED");
      videoFile(`${E}/t-clean.mp4`, "CLEAN");
      const choices = { privacy: "SELF_ONLY", comment: false, duet: false, stitch: false, disclose: false, yourBrand: false, branded: false };
      const due = { user_id: E, decided_at: new Date(), file_path: `${E}/t.mp4`, tiktok_post: choices, tiktok_at: new Date(Date.now() - 60_000), description: "Pick one. #shorts #wyr" };
      const first = await video({ ...due, clean_path: `${E}/t-clean.mp4` });
      let full = false;
      const sent: { title?: string; bytes?: string } = {};
      stubFetch((u, init) => {
        if (u.endsWith("/post/publish/creator_info/query/")) return { data: { creator_nickname: "e", privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } };
        if (u.endsWith("/post/publish/video/init/")) {
          if (full) return new Response(JSON.stringify({ error: { code: "reached_active_user_cap", message: "cap" } }), { status: 403 });
          sent.title = (JSON.parse(String(init?.body)) as { post_info: { title: string } }).post_info.title;
          return { data: { publish_id: "pub-1", upload_url: "https://tiktok.test/up" }, error: { code: "ok" } };
        }
        if (u === "https://tiktok.test/up") {
          sent.bytes = Buffer.from(init?.body as Uint8Array).toString();
          return {};
        }
        throw new Error(`unexpected call to ${u}`);
      });
      await post.postDue();
      expect(await row(first)).toMatchObject({ tiktok_publish_id: "pub-1", tiktok_error: null });
      expect(sent.bytes).toBe("CLEAN");
      expect(sent.title).toBe("Would you rather\n\nPick one. #wyr");

      full = true;
      const second = await video({ ...due, clean_path: `${E}/t-clean.mp4` });
      const before = Date.now();
      await post.postDue();
      const r = await row(second);
      expect(r).toMatchObject({ tiktok_publish_id: null, tiktok_error: null, posting_at: null });
      expect((r.tiktok_at as Date).getTime()).toBeGreaterThan(before + 23 * 3600_000);
      expect((await (await import("@/lib/server/notify")).notificationsOf(E)).items.some((n) => n.title === "TikTok is full for today")).toBe(true);

      // one made before TikTok was connected waits for its copy without the tag
      const third = await video(due);
      full = false;
      await post.postDue();
      expect(await row(third)).toMatchObject({ tiktok_publish_id: null });
      const jobs = await db.admin((tx) => tx<{ clean: boolean }[]>`select clean from public.render_jobs where video_id = ${third}`);
      expect(jobs).toEqual([{ clean: true }]);
    });

    /** Someone new, on a plan, with a YouTube channel Hookline holds tokens for. */
    const someone = async (email: string, ch: { external_id: string; made_for_kids?: boolean | null; privacy?: string; youtube_kids?: boolean | null; status?: string }) => {
      const { seal } = await import("@/lib/server/crypto");
      const [{ id }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values (${email}) returning id`);
      await db.admin((tx) => tx`insert into public.subscriptions (user_id, plan, status) values (${id}, 'pro', 'active')`);
      const [c] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.channels (user_id, platform, external_id, title, made_for_kids, privacy, youtube_kids, status)
        values (${id}, 'youtube', ${ch.external_id}, 'Channel', ${ch.made_for_kids ?? null}, ${ch.privacy ?? "public"}, ${ch.youtube_kids ?? null}, ${ch.status ?? "connected"})
        returning id`);
      await db.admin((tx) => tx`insert into public.channel_tokens (channel_id, access_token, expires_at) values (${c.id}, ${seal(`ya29.${email}`)}, now() + interval '1 hour')`);
      return { user: id, channel: c.id };
    };

    it("only the server says which account a channel is, so nobody can pass someone else's video off as theirs", async () => {
      // what a signed-in person could try through Supabase's API: point their channel at another, or add one
      await expect(db.asUser(E, (tx) => tx`update public.channels set external_id = 'UCsomeoneelsechannel' where id = ${channel}`)).rejects.toThrow(/permission denied/);
      await expect(db.asUser(E, (tx) => tx`
        insert into public.channels (user_id, platform, external_id, status) values (${E}, 'youtube', 'UCanyotherchannel', 'connected')`)).rejects.toThrow(/permission denied/);
      await expect(db.asUser(E, (tx) => tx`update public.channels set youtube_kids = false where id = ${channel}`)).rejects.toThrow(/permission denied/);
      await expect(db.asUser(E, (tx) => tx`update public.channels set status = 'connected' where id = ${channel}`)).rejects.toThrow(/permission denied/);
      expect(await db.admin((tx) => tx`select external_id from public.channels where user_id = ${E} and platform = 'youtube'`)).toEqual([{ external_id: TEST_CHANNEL }]);
      // the answers to its questions are still theirs to give
      expect(await db.asUser(E, (tx) => tx`update public.channels set privacy = 'public', made_for_kids = false where id = ${channel} returning id`)).toHaveLength(1);

      // connecting is the server's: a new channel, then the same one again, keeping its id
      const store = await import("@/lib/server/channels-store");
      const [{ id: H }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values ('late-h@test.local') returning id`);
      const info = { externalId: "UChchannel", title: "H", handle: "@h", avatarUrl: null, madeForKids: true };
      const tokens = { access: "ya29.h", refresh: "1//h", expiresAt: new Date(Date.now() + 3600_000), scopes: null };
      const id = await store.saveChannel(H, "youtube", info, tokens);
      expect(await store.saveChannel(H, "youtube", { ...info, madeForKids: false }, { ...tokens, refresh: null })).toBe(id);
      expect(await db.asUser(H, (tx) => tx`select id, external_id, youtube_kids, made_for_kids from public.channels`)).toEqual([
        { id, external_id: "UChchannel", youtube_kids: false, made_for_kids: null },
      ]);
      expect((await store.tokensOf(id))?.refresh).toBe("1//h");
    });

    it("checks a Short on YouTube even once the channel it went to is gone, and never leaves it checking", async () => {
      const L = await someone("truth-l@test.local", { external_id: "UClchannel", made_for_kids: false, status: "expired" });
      const at = new Date(Date.now() - 40 * 60_000);
      const up = { user_id: L.user, status: "scheduled", decided_at: new Date(), scheduled_for: at, uploaded_at: new Date(Date.now() - 3 * 3600_000), file_path: `${L.user}/x.mp4`,
        youtube_verified: true, youtube_status: "uploaded", youtube_wanted: "public", youtube_publish_at: at };
      // its channel's access ran out: the API key still sees it once it's public
      const seen = await video({ ...up, channel_id: L.channel, youtube_id: "lostpublic1" });
      const unseen = await video({ ...up, channel_id: L.channel, youtube_id: "lostunseen1" });
      // its channel was disconnected, and there's no other
      const orphan = await video({ ...up, youtube_id: "orphanvide1" });
      const calls = stubFetch((u) => {
        const ids = new URL(u).searchParams.get("id")!.split(",");
        return { items: ids.filter((id) => id === "lostpublic1").map((id) => ({ id, snippet: { channelId: "UClchannel" }, status: { uploadStatus: "processed", privacyStatus: "public" } })) };
      });
      await post.confirmYouTube();
      // all three asked in one call with the API key
      const byKey = calls.filter((c) => new URL(c.url).searchParams.get("key") === "test-key");
      expect(byKey.map((c) => new URL(c.url).searchParams.get("id")!.split(",").sort())).toEqual([["lostpublic1", "lostunseen1", "orphanvide1"]]);
      expect(await row(seen)).toMatchObject({ status: "posted", youtube_privacy: "public", posted_at: at });
      for (const id of [unseen, orphan]) {
        const r = await row(id);
        expect(r).toMatchObject({ status: "failed", youtube_status: "uploaded" });
        expect(r.error).toMatch(/lost access to the YouTube channel it went to.*Reconnect/);
        expect(r.error).not.toMatch(/deleted/);
      }
      const notes = (await (await import("@/lib/server/notify")).notificationsOf(L.user)).items;
      expect(notes.find((n) => n.href === `/app/shorts/${unseen}`)?.title).toBe("Couldn't check a Short on YouTube");
      // reconnected, trying again checks it again rather than uploading it twice
      await db.admin((tx) => tx`update public.channels set status = 'connected' where id = ${L.channel}`);
      await queue.retry(L.user, unseen, plans.pro);
      expect(await row(unseen)).toMatchObject({ status: "scheduled", youtube_id: "lostunseen1" });
      stubFetch((u) => ({ items: [{ id: new URL(u).searchParams.get("id"), snippet: { channelId: "UClchannel" }, status: { uploadStatus: "processed", privacyStatus: "public" } }] }));
      await post.confirmYouTube();
      expect(await row(unseen)).toMatchObject({ status: "posted" });

      // disconnected, with another channel connected: that one can't see the first one's private videos, so missing isn't "deleted"
      const N = await someone("truth-n@test.local", { external_id: "UCnchannel", made_for_kids: false });
      const elsewhere = await video({ ...up, user_id: N.user, youtube_id: "elsewhere01" });
      const asked = stubFetch(() => ({ items: [] }));
      await post.confirmYouTube();
      const asN = asked.filter((c) => new URL(c.url).searchParams.get("id") === "elsewhere01");
      expect(asN.map((c) => new Headers(c.init?.headers).get("authorization"))).toEqual(["Bearer ya29.truth-n@test.local"]);
      expect((await row(elsewhere)).error).toMatch(/couldn't find it on your connected YouTube channel/);
    });

    it("dates an upload that went up as it is from when it went up, not as private until its time", async () => {
      // one of the founder's test channels, posting unlisted
      const M = await someone("truth-m@test.local", { external_id: TEST_CHANNEL, made_for_kids: false, privacy: "unlisted" });
      videoFile(`${M.user}/m.mp4`, "video");
      const soon = await video({ user_id: M.user, decided_at: new Date(), scheduled_for: new Date(Date.now() + 5 * 60_000), file_path: `${M.user}/m.mp4` });
      const uploads: Record<string, unknown>[] = [];
      stubFetch((u, init) => {
        if (u.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
          uploads.push(JSON.parse(String(init?.body)));
          return new Response("{}", { status: 200, headers: { location: "https://upload.test/put" } });
        }
        if (u === "https://upload.test/put") return { id: "unlistedvid" };
        // checking: unlisted and processed
        return { items: [{ id: "unlistedvid", snippet: { channelId: TEST_CHANNEL }, status: { uploadStatus: "processed", privacyStatus: "unlisted" } }] };
      });
      await post.postDue();
      expect(uploads.map((u) => u.status)).toEqual([expect.objectContaining({ privacyStatus: "unlisted" })]);
      expect(uploads[0].status).not.toHaveProperty("publishAt");
      const r = await row(soon);
      expect(r).toMatchObject({ status: "scheduled", youtube_wanted: "unlisted", youtube_publish_at: null });
      await post.confirmYouTube(new Date(Date.now() + 10 * 60_000));
      const done = await row(soon);
      expect(done).toMatchObject({ status: "posted", youtube_privacy: "unlisted" });
      expect(done.posted_at).toEqual(done.uploaded_at);
      const d = (await (await import("@/lib/server/shorts/library")).shortOf(M.user, soon))!;
      const { historyOf } = await import("@/lib/shorts/history");
      const steps = historyOf({ ...d, tiktokAt: null, tiktokError: null, youtubePrivacy: d.youtubePrivacy, verified: d.verified }).map((s) => s.title);
      expect(steps).toContain("Unlisted on YouTube");
      expect(steps).not.toContain("Up on YouTube, private until its time");
    });

    it("turns comments off when YouTube has the whole channel as made for kids, whatever the creator answered", async () => {
      const K = await someone("truth-k@test.local", { external_id: "UCkchannel", made_for_kids: false, youtube_kids: true });
      const v = await video({ user_id: K.user, status: "review" });
      expect(await queue.approve(K.user, v, plans.pro)).toBe(true);
      expect(await row(v)).toMatchObject({ made_for_kids: false, params: { pairs: [], allowComments: false } });
      expect((await queue.queueOf(K.user)).coming.find((c) => c.id === v)).toMatchObject({ madeForKids: false, comments: false });
    });

    it("makes Shorts kept before the channel answered again once it says they're made for kids", async () => {
      await db.admin((tx) => tx`update public.render_jobs set status = 'done' where status in ('queued', 'running')`);
      const channels = await import("@/lib/server/channels");
      const P = await someone("truth-p@test.local", { external_id: "UCpchannel" });
      const [made, waiting, making] = [await video({ user_id: P.user, status: "review" }), await video({ user_id: P.user, status: "review" }), await video({ user_id: P.user, status: "review" })];
      for (const id of [made, making, waiting]) expect(await queue.approve(P.user, id, plans.pro)).toBe(true);
      // one made already, one being made, one still waiting; none asks YouTube to turn comments off
      const j1 = (await render.claimJob())!;
      expect(j1.videoId).toBe(made);
      await render.finishJob(j1, `${P.user}/${made}.mp4`);
      const j2 = (await render.claimJob())!;
      expect(j2).toMatchObject({ videoId: making, spec: { params: { pairs: [] } } });
      expect(await row(made)).toMatchObject({ status: "ready", made_for_kids: null });

      expect(await channels.setAudience(P.user, P.channel, true, "public")).toBe(true);
      for (const id of [made, waiting, making]) expect(await row(id)).toMatchObject({ made_for_kids: true, params: { pairs: [], allowComments: false } });
      // the one already made is made again, without the ending that asks for comments
      expect(await row(made)).toMatchObject({ status: "approved", file_path: null });
      // the one being made is made again as soon as it finishes
      await render.finishJob(j2, `${P.user}/${making}.mp4`);
      expect(await row(making)).toMatchObject({ status: "approved", file_path: null });
      const again = [(await render.claimJob())!, (await render.claimJob())!, (await render.claimJob())!];
      expect(new Set(again.map((j) => j.videoId))).toEqual(new Set([made, waiting, making]));
      for (const j of again) {
        expect((j.spec.params as { allowComments?: boolean }).allowComments).toBe(false);
        await render.finishJob(j, `${P.user}/${j.videoId}.mp4`);
      }
      expect(await row(made)).toMatchObject({ status: "ready", file_path: `${P.user}/${made}.mp4` });
      expect((await queue.queueOf(P.user)).coming.every((c) => !c.comments)).toBe(true);
      // the database noted each one taking the channel's answer
      const log = await db.admin((tx) => tx<{ source: string; n: number }[]>`
        select source, count(*)::int as n from public.audience_log where user_id = ${P.user} group by source order by source`);
      expect(log).toEqual([{ source: "channel", n: 1 }, { source: "short", n: 3 }]);
    });
  });
});
