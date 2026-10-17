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
    process.env.TIKTOK_PROFILE = "1";
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
    const [mine] = await db.admin((tx) => tx<{ id: string }[]>`select id from public.channels where user_id = ${B}`);
    await (await import("@/lib/server/channels")).disconnectChannel(B, mine.id);
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
    await (await import("@/lib/server/channels")).disconnectChannel(E, ch.id);
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
    expect(mine.body).toBe("17 playing at once. Your recap card is ready.");
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
    expect(await gen.shortsNoteOf({ userId: G, channelId: null })).toBeNull();
    expect(await toldOf()).toHaveLength(0);
    // when a day's Shorts couldn't all be made, the queue says why and the bell says it once, however often it's tried
    const at = new Date();
    await gen.noteDry({ userId: G, channelId: null }, null, like.note, at);
    await gen.noteDry({ userId: G, channelId: null }, at, like.note, new Date(at.getTime() + 60_000));
    expect(await gen.shortsNoteOf({ userId: G, channelId: null })).toBe(like.note);
    const told = await toldOf();
    expect(told).toHaveLength(1);
    expect(told[0].body).toBe(like.note);
    // a day's Short made in full (from the formats that have something), and then there's nothing to say
    expect(await gen.makeShorts(G, { origin: "daily", count: 1 })).toBe(1);
    expect(await gen.shortsNoteOf({ userId: G, channelId: null })).toBeNull();
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
    expect((await gen.dueForShorts(new Date(), 100)).map((u) => u.userId)).toContain(K);
    expect(await gen.runDailyShorts(new Date(), 100, -1)).toEqual([]);
    const log = await gen.runDailyShorts(new Date(), 100);
    expect(log).toContain(`${K}: 3 made`);
    expect((await gen.dueForShorts(new Date(), 100)).map((u) => u.userId)).not.toContain(K);
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
    const later = (await gen.dueForShorts(new Date(now.getTime() + 3 * 3600_000), 100)).map((u) => u.userId);
    expect(later.filter((id) => capped.includes(id) || id === N)).toEqual([]);

    // tomorrow everyone's due again, longest waiting first
    const tomorrow = new Date(now.getTime() + 86400_000);
    await db.admin((tx) => tx`update public.shorts_runs set tried_at = tried_at - interval '1 day' where user_id = ${capped[31]}`);
    const due = (await gen.dueForShorts(tomorrow, 100)).map((u) => u.userId);
    expect(due[0]).toBe(capped[31]);
    expect(capped.every((id) => due.includes(id)) && due.includes(N)).toBe(true);

    // a try that went wrong is tried again after an hour, not every few minutes
    await db.admin((tx) => tx`delete from public.shorts_runs where user_id = ${capped[0]}`);
    unreadable.add(capped[0]);
    expect(await gen.tryDaily({ userId: capped[0], channelId: null }, now)).toMatch(/failed: Stripe is down/);
    unreadable.delete(capped[0]);
    expect((await gen.dueForShorts(new Date(now.getTime() + 30 * 60_000), 100)).map((u) => u.userId)).not.toContain(capped[0]);
    expect((await gen.dueForShorts(new Date(now.getTime() + 61 * 60_000), 100)).map((u) => u.userId)).toContain(capped[0]);

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
    const tick = async (t: Date) => ((await gen.dueForShorts(t, 100000)).some((u) => u.userId === F) ? gen.tryDaily({ userId: F, channelId: null }, t) : null);

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
    expect((await gen.dueForShorts(now, 25)).map((u) => u.userId)).toContain(L);
    // before 6am where they are, nobody's due
    expect((await gen.dueForShorts(new Date(now.getTime() - 7 * 3600_000), 25)).map((u) => u.userId)).not.toContain(L);
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
    // noon Pacific tomorrow: never in the minutes after midnight, and the reset it waits for is still to come
    const now = new Date(yt.quotaResetsAt(new Date()).getTime() + 12 * 3600_000);
    const vids = await db.admin(async (tx) => {
      await tx`insert into public.subscriptions (user_id, plan, status) values (${Q}, 'pro', 'active')`;
      // a channel Hookline may upload to, that's said who it's for
      const [ch] = await tx<{ id: string }[]>`insert into public.channels (user_id, platform, external_id, made_for_kids) values (${Q}, 'youtube', ${TEST_CHANNEL}, false) returning id`;
      await tx`insert into public.channel_tokens (channel_id, access_token) values (${ch.id}, 'sealed')`;
      return tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, file_path, scheduled_for, decided_at)
        select ${Q}, ${ch.id}, 'wyr', '{"pairs":[]}', 'wyr', 'Held ' || g, 'ready', 'q/' || g || '.mp4', ${now}::timestamptz + make_interval(hours => 18 + g), now()
        from generate_series(1, 2) g returning id`;
    });
    onTestFinished(() => void upload.mockReset());
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
      insert into public.videos (user_id, channel_id, format, params, key, title, status, file_path, scheduled_for, decided_at, waiting_on, waiting_until)
      select ${Q}, id, 'wyr', '{"pairs":[]}', 'wyr', 'Held again', 'ready', 'q/3.mp4', ${until}::timestamptz + interval '3 hours', now(), 'youtube_quota', ${until}
      from public.channels where user_id = ${Q}
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
        + (select count(*) from public.live_sessions where user_id = ${B}) + (select count(*) from public.stripe_keys where user_id = ${B}) + (select count(*) from public.notifications where user_id = ${B}) as n`);
    expect(Number(left[0].n)).toBe(0);
    // what they had stays claimed, since their videos stay up
    const kept = await db.admin((tx) => tx<{ user_id: string | null }[]>`select user_id from public.content_ledger where item = 'b-had-this'`);
    expect(kept).toEqual([{ user_id: null }]);
  });

  it("lets only Hookline's server reach the tables, not Supabase's own API with the same sign-in", async () => {
    // what someone's own token gets through Supabase's REST or GraphQL API: their id and the same role, without Hookline's mark
    const direct = <T,>(fn: (tx: Parameters<Parameters<Db["asUser"]>[1]>[0]) => Promise<T>) =>
      db.sql().begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: A, role: "authenticated" })}, true)`;
        await tx.unsafe("set local role authenticated");
        return fn(tx);
      }) as Promise<T>;
    // through the app, A sees their own Short and profile
    expect((await db.asUser(A, (tx) => tx`select id from public.videos`)).length).toBeGreaterThan(0);
    expect(await db.asUser(A, (tx) => tx`select id from public.profiles`)).toHaveLength(1);
    // directly, nothing: not to read, and not to queue an upload of someone else's file
    expect(await direct((tx) => tx`select id from public.videos`)).toHaveLength(0);
    expect(await direct((tx) => tx`update public.videos set status = 'ready', file_path = 'someone-else/video.mp4' where user_id = ${A} returning id`)).toHaveLength(0);
    await expect(
      direct((tx) => tx`insert into public.videos (user_id, format, params, key, title, status, file_path) values (${A}, 'wyr', '{}', 'wyr', 'Mine', 'ready', 'someone-else/video.mp4')`),
    ).rejects.toThrow(/row-level security/);
    expect(await direct((tx) => tx`update public.profiles set goal = 'live' where id = ${A} returning id`)).toHaveLength(0);
    // every table has the rule, including ones added later
    const open = await db.admin((tx) => tx<{ t: string }[]>`
      select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not (c.relrowsecurity and exists (
          select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
            and p.policyname = 'only through hookline' and p.permissive = 'RESTRICTIVE'))`);
    expect(open.map((r) => r.t)).toEqual([]);
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
    /** A Short as the server would have left it (so past the guard on what YouTube said), made for its owner's YouTube channel unless it says otherwise */
    const video = async (over: Partial<Video> & { user_id: string }) => {
      const [own] = await db.admin((tx) => tx<{ id: string }[]>`select id from public.channels where user_id = ${over.user_id} and platform = 'youtube' order by added_at, id limit 1`);
      const v: Video = {
        status: "ready", params: { pairs: [] }, decided_at: null, scheduled_for: null, uploaded_at: null, file_path: null, clean_path: null, channel_id: own?.id ?? null,
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
      let full: string | null = null;
      const sent: { title?: string; bytes?: string } = {};
      stubFetch((u, init) => {
        if (u.endsWith("/post/publish/creator_info/query/")) return { data: { creator_nickname: "e", privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } };
        if (u.endsWith("/post/publish/video/init/")) {
          if (full) return new Response(JSON.stringify({ error: { code: full, message: "cap" } }), { status: 403 });
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

      full = "reached_active_user_cap";
      const second = await video({ ...due, clean_path: `${E}/t-clean.mp4` });
      const before = Date.now();
      await post.postDue();
      const r = await row(second);
      expect(r).toMatchObject({ tiktok_publish_id: null, tiktok_error: null, posting_at: null });
      expect((r.tiktok_at as Date).getTime()).toBeGreaterThan(before + 23 * 3600_000);
      expect((await (await import("@/lib/server/notify")).notificationsOf(E)).items.some((n) => n.title === "TikTok is full for today")).toBe(true);
      // the account's own daily limit being full goes tomorrow too, rather than waiting for the creator
      full = "spam_risk_too_many_posts";
      const capped = await video({ ...due, clean_path: `${E}/t-clean.mp4` });
      await post.postDue();
      const c = await row(capped);
      expect(c).toMatchObject({ tiktok_publish_id: null, tiktok_error: null, posting_at: null });
      expect((c.tiktok_at as Date).getTime()).toBeGreaterThan(before + 23 * 3600_000);
      expect((await (await import("@/lib/server/notify")).notificationsOf(E)).items.find((n) => n.href === `/app/shorts/${capped}`)).toMatchObject({
        title: "TikTok is full for today", body: "Would you rather: TikTok's daily limit for this account is full. It goes at the same time tomorrow.",
      });

      // one made before TikTok was connected waits for its copy without the tag
      const third = await video(due);
      full = null;
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
      const orphan = await video({ ...up, channel_id: null, youtube_id: "orphanvide1" });
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
      const elsewhere = await video({ ...up, user_id: N.user, channel_id: null, youtube_id: "elsewhere01" });
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

  // wave 2: channels
  describe("channels: a Short for each channel", () => {
    let channels: typeof import("@/lib/server/channels");
    let store: typeof import("@/lib/server/channels-store");
    let ledger: typeof import("@/lib/server/shorts/ledger");
    let plans: typeof import("@/lib/billing/plans").PLANS;
    let seal: (s: string) => string;
    /** everyone these tests make, deleted at the end */
    const made: string[] = [];
    // every job runs at the morning run's tick: 6:05 this morning, in UTC where these accounts are
    const now = new Date();
    now.setUTCHours(6, 5, 0, 0);
    const today = now.toISOString().slice(0, 10);

    /**
     * Someone new on a plan, onboarded for Shorts in UTC, with YouTube
     * channels Hookline holds tokens for, connected a day apart in the order
     * given, each answered as not made for kids unless it says otherwise.
     * Each channel's access token is `ya29.<email>.<n>`.
     */
    type Has = { title?: string; status?: string; shortsOn?: boolean; external?: string; madeForKids?: boolean | null };
    const someone = async (plan: "free" | "pro" | "creator", youtube: Has[] = []) => {
      const email = `w2-channels-${made.length + 1}@test.local`;
      const [{ id: user }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values (${email}) returning id`);
      made.push(user);
      await db.admin(async (tx) => {
        await tx`update public.profiles set timezone = 'UTC', goal = 'shorts', onboarded_at = now() - interval '30 days' where id = ${user}`;
        if (plan !== "free") await tx`insert into public.subscriptions (user_id, plan, status) values (${user}, ${plan}, 'active')`;
      });
      const ids: string[] = [];
      const externals: string[] = [];
      for (const [i, c] of youtube.entries()) {
        const external = c.external ?? `UCw2ch${made.length}n${i}`;
        const added = new Date(Date.UTC(2026, 0, 1 + i));
        const [ch] = await db.admin((tx) => tx<{ id: string }[]>`
          insert into public.channels (user_id, platform, external_id, title, status, shorts_on, made_for_kids, connected_at, added_at)
          values (${user}, 'youtube', ${external}, ${c.title ?? `Channel ${i + 1}`}, ${c.status ?? "connected"}, ${c.shortsOn ?? true},
            ${c.madeForKids === undefined ? false : c.madeForKids}, ${added}, ${added})
          returning id`);
        await db.admin((tx) => tx`insert into public.channel_tokens (channel_id, access_token, expires_at) values (${ch.id}, ${seal(`ya29.${email}.${i}`)}, now() + interval '1 hour')`);
        ids.push(ch.id);
        externals.push(external);
      }
      return { user, email, channels: ids, externals };
    };

    /** Posted Shorts on a channel, each with its first day's views read on time. */
    const posted = async (user: string, channel: string, views: number[]) => {
      const vids = await db.admin((tx) => tx<{ id: string; posted_at: Date }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, posted_at, youtube_id, youtube_verified)
        select ${user}, ${channel}, 'quiz', '{"questions":[]}', 'quiz:capitals', 'Quiz ' || g, 'posted', now() - interval '4 days',
          now() - interval '4 days' + make_interval(mins => g), ${`yt${channel.slice(0, 8)}`} || g, true
        from generate_series(1, ${views.length}) g order by g returning id, posted_at`);
      for (const [i, v] of vids.entries()) {
        await db.admin((tx) => tx`insert into public.video_stats (video_id, checkpoint, views, fetched_at) values (${v.id}, '24h', ${views[i]}, ${new Date(v.posted_at.getTime() + 24 * 3600_000)})`);
      }
      return vids.map((v) => v.id);
    };

    const videosOf = (user: string) => db.admin((tx) => tx<{ id: string; title: string; channel_id: string | null; params: { look?: { id: number } }; suggested_for: Date | null }[]>`
      select id, title, channel_id, params, suggested_for from public.videos where user_id = ${user} order by suggested_for nulls last, created_at`);
    const videoRow = async (id: string) => (await db.admin((tx) => tx<Record<string, unknown>[]>`select * from public.videos where id = ${id}`))[0];

    /** A time today, in UTC where these accounts are. */
    const at = (hour: number, minute = 0) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
    /** TikTok's questions, answered */
    const choices = { privacy: "SELF_ONLY", comment: false, duet: false, stitch: false, disclose: false, yourBrand: false, branded: false } as const;

    /** What YouTube's upload is asked for while a test lasts: which channel, and how. */
    const uploads = () => {
      const seen: { channel: string; title: string; madeForKids: boolean; publishAt: Date | null }[] = [];
      onTestFinished(() => void upload.mockReset());
      upload.mockReset();
      upload.mockImplementation(async (...a) => {
        const [channel, , meta] = a as [string, Buffer, { title: string; madeForKids: boolean; publishAt: Date | null }];
        seen.push({ channel, title: meta.title, madeForKids: meta.madeForKids, publishAt: meta.publishAt });
        return `w2chup${seen.length}`;
      });
      return seen;
    };

    /** Until `n` of this database's sessions are waiting on a lock another one holds. */
    const waiting = async (n: number) => {
      for (let i = 0; i < 150; i++) {
        const [{ k }] = await db.admin((tx) => tx<{ k: number }[]>`
          select count(distinct l.pid)::int as k from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where not l.granted and a.datname = current_database()`);
        if (k >= n) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`fewer than ${n} waited`);
    };

    beforeAll(async () => {
      if (!safe) return;
      channels = await import("@/lib/server/channels");
      store = await import("@/lib/server/channels-store");
      ledger = await import("@/lib/server/shorts/ledger");
      plans = (await import("@/lib/billing/plans")).PLANS;
      seal = (await import("@/lib/server/crypto")).seal;
    });

    afterAll(async () => {
      if (!safe || !made.length) return;
      await db.admin((tx) => tx`delete from auth.users where id = any(${made}::uuid[])`);
    });

    it("makes each of a Creator's channels its own five in one morning run, in its own look, and no more", async () => {
      const c = await someone("creator", [{ title: "Ball Clash" }, { title: "Quiz Den" }]);
      const units = (await gen.dueForShorts(now, 100000)).filter((u) => u.userId === c.user);
      expect(units).toEqual(c.channels.map((channelId) => ({ userId: c.user, channelId })));
      const log: string[] = [];
      for (const u of units) log.push(await gen.tryDaily(u, now));
      expect(log).toEqual(c.channels.map((id) => `${c.user} ${id}: 5 made`));

      const shorts = await videosOf(c.user);
      const of = (id: string) => shorts.filter((s) => s.channel_id === id);
      for (const id of c.channels) {
        expect(of(id)).toHaveLength(5);
        // one look for each channel
        expect(new Set(of(id).map((s) => s.params.look?.id)).size).toBe(1);
        // five today, two hours apart within the channel, whatever the other channel has (both fit in one day only that way)
        const times = of(id).map((s) => s.suggested_for!.getTime());
        for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(2 * 3600_000);
        expect(times.every((t) => new Date(t).toISOString().slice(0, 10) === today)).toBe(true);
      }
      const look = of(c.channels[0])[0].params.look?.id;
      expect(look).not.toBe(of(c.channels[1])[0].params.look?.id);

      // the same look the next time, and the account's 10 are all it gets today
      expect(await gen.makeShorts(c.user, { origin: "replacement", channelId: c.channels[0], now })).toBe(1);
      expect((await videosOf(c.user)).filter((s) => s.channel_id === c.channels[0]).every((s) => s.params.look?.id === look)).toBe(true);
      for (const id of c.channels) expect(await gen.makeShorts(c.user, { origin: "daily", channelId: id, count: 1, now })).toBe(0);
      expect(await gen.makeShorts(c.user, { origin: "daily", now })).toBe(0);
      const a = await gen.allowancesOf(c.user, plans.creator, "UTC", now);
      expect(a.account).toMatchObject({ limit: 10, made: 10, left: 0, units: 2 });

      // each channel's try written down, and neither is tried again today
      const runs = await db.admin((tx) => tx<{ channel_id: string; outcome: string; made: number }[]>`select channel_id, outcome, made from public.shorts_runs where user_id = ${c.user} order by tried_at, channel_id`);
      expect(new Set(runs.map((r) => r.channel_id))).toEqual(new Set(c.channels));
      expect(runs.every((r) => r.outcome === "made" && r.made === 5)).toBe(true);
      expect((await gen.dueForShorts(new Date(now.getTime() + 3600_000), 100000)).filter((u) => u.userId === c.user)).toEqual([]);
      // one morning note for the account, which doesn't say how many came or that they're all in
      const notes = (await (await import("@/lib/server/notify")).notificationsOf(c.user)).items.filter((n) => n.kind === "ready");
      expect(notes.map((n) => [n.title, n.body])).toEqual([["New Shorts to swipe", "Each of your channels gets its own today. Swipe right on the ones you want, left for something else."]]);
    }, 120_000);

    it("finds the same channels for the morning run as the app counts, and none when every channel is switched off", async () => {
      const pro = await someone("pro", [{}, {}]);
      const gone = await someone("free", [{ status: "revoked" }]);
      const none = await someone("free");
      const mixed = await someone("creator", [{ status: "expired" }, {}, { shortsOn: false }]);
      const same = async (a: { user: string }, plan: keyof typeof plans, want: (string | null)[]) => {
        const due = (await gen.dueForShorts(now, 100000)).filter((u) => u.userId === a.user).map((u) => u.channelId);
        expect(due).toEqual(want);
        expect((await gen.allowancesOf(a.user, plans[plan], "UTC", now)).order).toEqual(want);
      };
      // Pro has room for the first; a disconnected channel gets nothing, so the account is its own again; expired ones still get Shorts
      await same(pro, "pro", [pro.channels[0]]);
      await same(gone, "free", [null]);
      await same(none, "free", [null]);
      await same(mixed, "creator", mixed.channels.slice(0, 2));
      // switched off, the next one takes its place; all off, none
      expect(await channels.setChannelSettings(pro.user, pro.channels[0], { shortsOn: false })).toBe(true);
      await same(pro, "pro", [pro.channels[1]]);
      await channels.setChannelSettings(pro.user, pro.channels[1], { shortsOn: false });
      await same(pro, "pro", []);
      expect(await gen.makeShortsSaying(pro.user, { origin: "daily", now })).toMatchObject({ made: 0, short: "stopped", channels: 0 });
      expect(await gen.tryDaily({ userId: pro.user, channelId: pro.channels[1] }, now)).toBe(`${pro.user} ${pro.channels[1]}: Shorts off`);
      // only on their own YouTube channels, and only what's given is written
      expect(await channels.setChannelSettings(none.user, pro.channels[0], { shortsOn: true })).toBe(false);
      expect(await channels.setChannelSettings(pro.user, pro.channels[0], {})).toBe(true);
      expect((await channels.channelsOf(pro.user)).map((x) => x.shortsOn)).toEqual([false, false]);
    });

    it("makes an account with no channel its own Shorts, and gives them and its look to its first channel", async () => {
      const f = await someone("free");
      const unit = { userId: f.user, channelId: null };
      expect(await gen.tryDaily(unit, now)).toBe(`${f.user}: 3 made`);
      // its try is written down again without trouble
      expect(await gen.tryDaily(unit, new Date(now.getTime() + 60_000))).toBe(`${f.user}: allowance used`);
      expect(await db.admin((tx) => tx`select channel_id, outcome from public.shorts_runs where user_id = ${f.user}`)).toEqual([{ channel_id: null, outcome: "allowance" }]);
      const look = await ledger.lookFor(f.user);
      const before = await videosOf(f.user);
      expect(before).toHaveLength(3);
      expect(before.every((v) => v.channel_id === null && v.params.look?.id === look.id)).toBe(true);
      // and one already on YouTube, from a channel it had before
      const [up] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, format, params, key, title, status, decided_at, scheduled_for, uploaded_at, file_path,
          youtube_id, youtube_verified, youtube_status, youtube_wanted, youtube_publish_at)
        values (${f.user}, 'wyr', '{"pairs":[]}', 'wyr', 'Up already', 'scheduled', now(), '2020-01-01T00:00:00Z', '2019-12-31T23:00:00Z', 'x/up.mp4',
          'w2chupalready', true, 'uploaded', 'public', '2020-01-01T00:00:00Z')
        returning id`);

      // its first channel takes over the Shorts not on YouTube, the look and the morning run
      const first = await store.saveChannel(f.user, "youtube", { externalId: "UCw2chfirstone", title: "First", handle: "@first", avatarUrl: null }, { access: "ya29.w2-first", refresh: null, expiresAt: new Date(Date.now() + 3600_000), scopes: null });
      expect(await channels.adoptOrphans(f.user, first)).toBe(3);
      const after = await videosOf(f.user);
      expect(after.filter((v) => v.channel_id === first).map((v) => v.id).sort()).toEqual(before.map((v) => v.id).sort());
      expect(after.find((v) => v.id === up.id)?.channel_id).toBeNull();
      expect((await ledger.lookFor(f.user, first)).id).toBe(look.id);
      expect(await db.admin((tx) => tx`select channel_id from public.shorts_runs where user_id = ${f.user}`)).toEqual([{ channel_id: first }]);
      // the week's 3 are still all it gets
      const a = await gen.allowancesOf(f.user, plans.free, "UTC", now);
      expect(a.order).toEqual([first]);
      expect(a.units.get(first)).toMatchObject({ made: 3, left: 0 });
      expect(await gen.makeShorts(f.user, { origin: "daily", now })).toBe(0);

      // the one already up is still checked the way it was, asked as their connected channel
      const calls = stubFetch(() => ({ items: [{ id: "w2chupalready", snippet: { channelId: "UCw2chfirstone" }, status: { uploadStatus: "processed", privacyStatus: "public" } }] }));
      await post.confirmYouTube(new Date("2020-01-01T00:40:00Z"));
      expect(calls.map((x) => new Headers(x.init?.headers).get("authorization"))).toEqual(["Bearer ya29.w2-first"]);
      expect(await db.admin((tx) => tx`select status, channel_id from public.videos where id = ${up.id}`)).toEqual([{ status: "posted", channel_id: null }]);
      // a second channel takes nothing over: which one those were for isn't known
      const second = await store.saveChannel(f.user, "youtube", { externalId: "UCw2chsecondone", title: "Second", handle: null, avatarUrl: null }, { access: "ya29.w2-second", refresh: null, expiresAt: null, scopes: null });
      await db.admin((tx) => tx`update public.videos set channel_id = null where user_id = ${f.user} and youtube_id is null`);
      expect(await channels.adoptOrphans(f.user, second)).toBe(0);
      expect(await channels.adoptOrphans(f.user, first)).toBe(0);
    });

    it("disconnects softly: the channel and its Shorts stay, its keys, username and figures go, and connecting it again carries on", async () => {
      const live = await import("@/lib/server/live");
      const d = await someone("creator", [{ title: "Main" }, { title: "Second" }]);
      const [x, y] = d.channels;
      const [tt] = await db.admin((tx) => tx<{ id: string }[]>`insert into public.channels (user_id, platform, external_id, title) values (${d.user}, 'tiktok', ${`w2ch-tt-${d.user}`}, 'D') returning id`);
      await db.admin((tx) => tx`insert into public.channel_tokens (channel_id, access_token) values (${tt.id}, ${seal("act.w2ch")})`);
      await live.rememberTikTok(d.user, tt.id, "w2ch.d");
      // figures read with each channel's access, and the account's own Stripe sales
      await db.admin((tx) => tx`
        insert into public.metrics (user_id, channel_id, source, metric, day, value)
        values (${d.user}, ${x}, 'youtube', 'views', ${today}, 10), (${d.user}, ${y}, 'youtube', 'views', ${today}, 20),
          (${d.user}, ${tt.id}, 'tiktok', 'views_total', ${today}, 30), (${d.user}, null, 'stripe', 'revenue:usd', ${today}, 5)`);
      expect(await gen.makeShorts(d.user, { origin: "daily", channelId: x, count: 1, now })).toBe(1);
      const look = await ledger.lookFor(d.user, x);
      // TikTok choices for a Short that hasn't gone yet, and one that has
      const choices = db.sql().json({ privacy: "SELF_ONLY", comment: false, duet: false, stitch: false, disclose: false, yourBrand: false, branded: false });
      const [waiting, sent] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, tiktok_post, tiktok_at, tiktok_publish_id)
        values (${d.user}, ${y}, 'wyr', '{}', 'wyr', 'Waits for TikTok', 'ready', ${choices}, now() + interval '2 hours', null),
          (${d.user}, ${y}, 'wyr', '{}', 'wyr', 'Went to TikTok', 'posted', ${choices}, now() - interval '2 hours', 'pub-w2ch')
        returning id`);

      // nobody signed in deletes a channel, even their own, and nobody else disconnects it
      await expect(db.asUser(d.user, (tx) => tx`delete from public.channels where id = ${y}`)).rejects.toThrow(/permission denied/);
      expect(await channels.disconnectChannel(A, x)).toBeNull();

      expect(await channels.disconnectChannel(d.user, x)).toEqual({ platform: "youtube", cleared: 0 });
      const statusOf = async (id: string) => (await db.admin((tx) => tx<{ status: string; added_at: Date }[]>`select status, added_at from public.channels where id = ${id}`))[0];
      expect((await statusOf(x)).status).toBe("revoked");
      const tokens = await db.admin((tx) => tx<{ channel_id: string }[]>`select channel_id from public.channel_tokens where channel_id in ${tx([x, y, tt.id])}`);
      expect(tokens.map((t) => t.channel_id).sort()).toEqual([y, tt.id].sort());
      const figures = async () => (await db.admin((tx) => tx<{ source: string; channel_id: string | null }[]>`select source, channel_id from public.metrics where user_id = ${d.user} order by source, channel_id`));
      expect(await figures()).toEqual([{ source: "stripe", channel_id: null }, { source: "tiktok", channel_id: tt.id }, { source: "youtube", channel_id: y }]);
      // and Earnings shows only the rest: Second's views, with no subscriber figures yet, so those days are unknown
      const shown = (await earn.earningsOf(d.user, 30)).series;
      expect(shown.find((s) => s.id === "youtube:views")).toMatchObject({ total: 20 });
      expect(shown.find((s) => s.id === "youtube:subscribers")?.points.map((p) => p.value)).toEqual(Array(30).fill(null));
      // its Shorts keep their channel; tomorrow's run passes it by, and Settings still lists it while it has Shorts
      expect((await videosOf(d.user)).filter((v) => v.channel_id === x)).toHaveLength(1);
      expect((await gen.dueForShorts(new Date(now.getTime() + 86400_000), 100000)).filter((u) => u.userId === d.user)).toEqual([{ userId: d.user, channelId: y }]);
      expect((await channels.channelsOf(d.user)).map((c) => c.id)).toEqual([y, tt.id]);
      expect((await channels.channelsOf(d.user, { disconnected: true })).map((c) => c.id)).toEqual([x, y, tt.id]);
      expect((await channels.shortsChannelsOf(d.user)).map((c) => [c.id, c.name, c.status])).toEqual([[x, "Main", "revoked"], [y, "Second", "connected"]]);
      // a token refresh failing afterwards doesn't bring it back as expired
      await store.markExpired(x);
      expect((await statusOf(x)).status).toBe("revoked");
      expect((await (await import("@/lib/server/notify")).notificationsOf(d.user)).items.some((n) => n.title === "Reconnect YouTube")).toBe(false);

      // connecting it again: the same channel, with its look, at the end of the line for the plan's room
      const tokensAgain = { access: "ya29.w2-again", refresh: null, expiresAt: new Date(Date.now() + 3600_000), scopes: null };
      expect(await store.saveChannel(d.user, "youtube", { externalId: d.externals[0], title: "Main", handle: null, avatarUrl: null }, tokensAgain)).toBe(x);
      const back = await statusOf(x);
      expect(back.status).toBe("connected");
      expect(back.added_at.getTime()).toBeGreaterThan((await statusOf(y)).added_at.getTime());
      expect((await ledger.lookFor(d.user, x)).id).toBe(look.id);
      // one that only expired keeps its place
      const kept = (await statusOf(y)).added_at;
      await store.markExpired(y);
      expect((await statusOf(y)).status).toBe("expired");
      await store.saveChannel(d.user, "youtube", { externalId: d.externals[1], title: "Second", handle: null, avatarUrl: null }, tokensAgain);
      expect(await statusOf(y)).toEqual({ status: "connected", added_at: kept });

      // TikTok: its username goes, so it can't verify LIVEs, and so do the choices made for posts that haven't gone to it
      expect(await live.tiktokUsernamesOf(d.user)).toEqual(["w2ch.d"]);
      expect(await channels.disconnectChannel(d.user, tt.id)).toEqual({ platform: "tiktok", cleared: 1 });
      expect(await live.tiktokUsernamesOf(d.user)).toEqual([]);
      const tiktok = await db.admin((tx) => tx<{ id: string; tiktok_post: unknown; tiktok_at: Date | null; tiktok_publish_id: string | null }[]>`
        select id, tiktok_post, tiktok_at, tiktok_publish_id from public.videos where id in ${tx([waiting.id, sent.id])}`);
      expect(tiktok.find((v) => v.id === waiting.id)).toMatchObject({ tiktok_post: null, tiktok_at: null });
      expect(tiktok.find((v) => v.id === sent.id)).toMatchObject({ tiktok_publish_id: "pub-w2ch", tiktok_post: expect.objectContaining({ privacy: "SELF_ONLY" }) });
      expect((await figures()).map((r) => r.source)).toEqual(["stripe", "youtube"]);
    });

    it("keeps each Short on one of its owner's own channels, and only the server moves it", async () => {
      const m = await someone("pro", [{}, { shortsOn: false }]);
      const o = await someone("pro", [{}]);
      const insert = (tx: Parameters<Parameters<Db["admin"]>[0]>[0], channel: string) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title) values (${m.user}, ${channel}, 'wyr', '{}', 'wyr', 'Mine') returning id`;
      // not on someone else's channel, whoever writes it
      await expect(db.asUser(m.user, (tx) => insert(tx, o.channels[0]))).rejects.toThrow(/videos_channel_owner/);
      await expect(db.admin((tx) => insert(tx, o.channels[0]))).rejects.toThrow(/videos_channel_owner/);
      const [v] = await db.asUser(m.user, (tx) => insert(tx, m.channels[0]));
      // moved to another of theirs only by the server; wave 1's rule on what YouTube said still holds
      await expect(db.asUser(m.user, (tx) => tx`update public.videos set channel_id = ${m.channels[1]} where id = ${v.id}`)).rejects.toThrow(/only the server moves a Short/);
      await expect(db.asUser(m.user, (tx) => tx`update public.videos set channel_id = null where id = ${v.id}`)).rejects.toThrow(/only the server moves a Short/);
      await expect(db.asUser(m.user, (tx) => tx`update public.videos set youtube_id = 'w2chnotmine' where id = ${v.id}`)).rejects.toThrow(/only the server records what YouTube said/);
      expect(await db.asUser(m.user, (tx) => tx`update public.videos set title = 'Still mine to change' where id = ${v.id} returning id`)).toHaveLength(1);
      expect(await db.admin((tx) => tx`update public.videos set channel_id = ${m.channels[1]} where id = ${v.id} returning id`)).toHaveLength(1);
      // a channel's Shorts switch is theirs to change, and the rest of the row isn't
      expect(await db.asUser(m.user, (tx) => tx`update public.channels set shorts_on = true where id = ${m.channels[1]} returning id`)).toHaveLength(1);
      await expect(db.asUser(m.user, (tx) => tx`update public.channels set added_at = now() where id = ${m.channels[1]}`)).rejects.toThrow(/permission denied/);
      // what each channel has learned is the server's to write, and only its owner's to read
      await expect(db.asUser(m.user, (tx) => tx`insert into public.channel_weights (channel_id, user_id, kind, name) values (${m.channels[0]}, ${m.user}, 'format', 'quiz')`)).rejects.toThrow(/permission denied/);
      await db.admin((tx) => tx`insert into public.channel_weights (channel_id, user_id, kind, name, score, samples) values (${m.channels[0]}, ${m.user}, 'format', 'quiz', 2, 3)`);
      await expect(db.admin((tx) => tx`insert into public.channel_weights (channel_id, user_id, kind, name) values (${m.channels[0]}, ${o.user}, 'format', 'wyr')`)).rejects.toThrow(/foreign key/);
      expect(await db.asUser(m.user, (tx) => tx`select name from public.channel_weights`)).toEqual([{ name: "quiz" }]);
      expect(await db.asUser(o.user, (tx) => tx`select name from public.channel_weights`)).toEqual([]);
    });

    it("measures each channel against its own usual, learns for it and the account, and starts a new channel from the others", async () => {
      const l = await someone("creator", [{ title: "Big" }, { title: "Small" }, { title: "New" }]);
      const [big, small, fresh] = l.channels;
      await posted(l.user, big, [400, 500, 600]);
      const [, , , next] = await posted(l.user, small, [10, 11, 12, 30]);
      // 30 views against Small's usual of 11, not Big's 500
      await stats.learn(l.user, next, "quiz", "quiz:capitals", 30, 24, small);
      const lift = (30 + 10) / (11 + 10);
      const account = await db.admin((tx) => tx<{ kind: string; name: string; score: number; samples: number }[]>`select kind, name, score, samples from public.weights where user_id = ${l.user} order by kind, name`);
      expect(account.map((w) => [w.kind, w.name, w.samples])).toEqual([["format", "quiz", 1], ["key", "quiz:capitals", 1]]);
      expect(account[0].score).toBeCloseTo(lift, 4);
      const own = await db.admin((tx) => tx<{ channel_id: string; name: string; score: number }[]>`select channel_id, name, score from public.channel_weights where user_id = ${l.user} order by name`);
      expect(own.map((w) => [w.channel_id, w.name])).toEqual([[small, "quiz"], [small, "quiz:capitals"]]);
      expect(own[0].score).toBeCloseTo(lift, 4);
      // the note says whose usual it beat
      const [note] = (await (await import("@/lib/server/notify")).notificationsOf(l.user)).items.filter((n) => n.kind === "results");
      expect(note).toMatchObject({ title: "1.9× your usual views", body: "Quiz 4 beat Small's usual Short in its first day. Hookline will make more like it there." });

      // a channel with no results of its own starts from the others'; Small goes by its own
      const { weightsFor } = await import("@/lib/server/shorts/weights");
      const { steady } = await import("@/lib/shorts/learn");
      const [freshQuiz] = (await db.asUser(l.user, (tx) => weightsFor(tx, fresh))).filter((w) => w.name === "quiz");
      expect(freshQuiz).toMatchObject({ kind: "format", score: 1, samples: 0 });
      expect(freshQuiz.prior).toBeCloseTo(steady({ score: lift, samples: 1 }), 4);
      const [smallQuiz] = (await db.asUser(l.user, (tx) => weightsFor(tx, small))).filter((w) => w.name === "quiz");
      expect(smallQuiz).toMatchObject({ samples: 1, prior: 1 });
      expect((await db.asUser(l.user, (tx) => weightsFor(tx, null))).map((w) => w.name).sort()).toEqual(["quiz", "quiz:capitals"]);
      // and nobody else sees what it learned
      expect(await db.asUser(A, (tx) => weightsFor(tx, fresh))).toEqual([]);
    });

    it("shows each Short with its channel, against its own channel's usual", async () => {
      const lib = await import("@/lib/server/shorts/library");
      const g = await someone("creator", [{ title: "Big" }, { title: "Small" }]);
      const [big, small] = g.channels;
      const bigs = await posted(g.user, big, [400, 500, 600, 2000]);
      const smalls = await posted(g.user, small, [10, 11, 12, 30]);
      const items = (await lib.libraryOf(g.user)).items;
      const item = (id: string) => items.find((x) => x.id === id)!;
      expect(item(smalls[3])).toMatchObject({ channelId: small });
      expect(item(smalls[3]).vsUsual).toBeCloseTo((30 + 10) / (11.5 + 10), 6);
      expect(item(bigs[3]).vsUsual).toBeCloseTo((2000 + 10) / (550 + 10), 6);
      // a Short's own page leaves it out of its usual
      expect(await lib.shortOf(g.user, smalls[3])).toMatchObject({ channelId: small, typical: 11 });
      const month = await lib.calendarOf(g.user, new Date(Date.now() - 30 * 86400_000), new Date(Date.now() + 86400_000));
      expect(month.find((x) => x.id === bigs[0])?.channelId).toBe(big);
      // with two channels there's no one usual for the account
      expect((await lib.insightsFor(g.user)).typical).toBeNull();
    });

    it("replaces a swiped-away Short on its own channel, and not for one that's disconnected", async () => {
      const r = await someone("creator", [{}, {}]);
      const [x, y] = r.channels;
      const newest = async () => (await db.admin((tx) => tx<{ channel_id: string }[]>`select channel_id from public.videos where user_id = ${r.user} order by created_at desc limit 1`))[0];
      expect(await gen.makeShorts(r.user, { origin: "replacement", channelId: y, now })).toBe(1);
      expect((await newest()).channel_id).toBe(y);
      await channels.disconnectChannel(r.user, y);
      expect(await gen.makeShortsSaying(r.user, { origin: "replacement", channelId: y, now })).toMatchObject({ made: 0, short: "allowance" });
      // left to it, one goes to the channel with the most room
      expect(await gen.makeShorts(r.user, { origin: "replacement", now })).toBe(1);
      expect((await newest()).channel_id).toBe(x);
    });

    it("has room for as many channels as the plan, one TikTok account, and always for one they have", async () => {
      const five = await someone("creator", [{}, {}, {}, {}, {}]);
      expect(await channels.hasRoomFor(five.user, "youtube", "UCw2chsixth", plans.creator)).toBe(false);
      expect(await channels.hasRoomFor(five.user, "youtube", five.externals[2], plans.creator)).toBe(true);
      await channels.disconnectChannel(five.user, five.channels[4]);
      expect(await channels.hasRoomFor(five.user, "youtube", "UCw2chsixth", plans.creator)).toBe(true);
      // coming back after a disconnect takes a place like a new one
      expect(await channels.hasRoomFor(five.user, "youtube", five.externals[4], plans.creator)).toBe(true);
      const pro = await someone("pro", [{ status: "expired" }]);
      expect(await channels.hasRoomFor(pro.user, "youtube", "UCw2chanother", plans.pro)).toBe(false);
      expect(await channels.hasRoomFor(pro.user, "youtube", pro.externals[0], plans.pro)).toBe(true);
      await db.admin((tx) => tx`insert into public.channels (user_id, platform, external_id) values (${five.user}, 'tiktok', 'w2ch-tt-five')`);
      expect(await channels.hasRoomFor(five.user, "tiktok", "w2ch-tt-other", plans.creator)).toBe(false);
      expect(await channels.hasRoomFor(five.user, "tiktok", "w2ch-tt-five", plans.creator)).toBe(true);
      expect(await channels.hasRoomFor(pro.user, "tiktok", "w2ch-tt-pro", plans.pro)).toBe(true);
    });

    it("keeps each channel's figures apart in Earnings, and adds them up only as far as every one has reported", async () => {
      const e = await someone("creator", [{ title: "Pop" }, { title: "Quiet" }]);
      const [pop, quiet] = e.channels;
      const ago = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
      // YouTube Analytics for each channel, read with its own access: Quiet hasn't reported the latest day yet
      const reports: Record<string, (string | number)[][]> = {
        [`ya29.${e.email}.0`]: [[ago(6), 100, 2], [ago(5), 200, 3], [ago(4), 300, 4]],
        [`ya29.${e.email}.1`]: [[ago(6), 10, 1], [ago(5), 20, 0]],
      };
      stubFetch((u, init) => {
        const rows = reports[(new Headers(init?.headers).get("authorization") ?? "").replace("Bearer ", "")];
        // anyone else's channels aren't these tests' to read; and neither of these is in the Partner Program
        if (!u.startsWith("https://youtubeanalytics.googleapis.com/") || !rows) return new Response("{}", { status: 500 });
        return new URL(u).searchParams.get("metrics")!.includes("estimatedRevenue") ? new Response("{}", { status: 403 }) : { rows };
      });
      await earn.syncEarnings(now);
      const kept = await db.admin((tx) => tx<{ channel_id: string; n: number }[]>`select channel_id, count(*)::int as n from public.metrics where user_id = ${e.user} group by channel_id`);
      expect(new Map(kept.map((k) => [k.channel_id, k.n]))).toEqual(new Map([[pop, 6], [quiet, 4]]));

      const views = async (channelId?: string) => (await earn.earningsOf(e.user, 30, channelId)).series.find((s) => s.id === "youtube:views")!;
      const on = (s: Awaited<ReturnType<typeof views>>, n: number) => s.points.find((p) => p.day === ago(n))?.value;
      const all = await views();
      expect([6, 5, 4].map((n) => on(all, n))).toEqual([110, 220, null]);
      expect(all).toMatchObject({ total: 330, through: ago(5) });
      // one channel picked: only its own
      const one = await views(pop);
      expect([6, 5, 4].map((n) => on(one, n))).toEqual([100, 200, 300]);
      expect(one).toMatchObject({ total: 600, through: ago(4) });
      const everything = await earn.earningsOf(e.user, 30);
      expect(everything.channels).toEqual([
        { id: pop, platform: "youtube", name: "Pop", expired: false, from: ago(6), through: ago(4) },
        { id: quiet, platform: "youtube", name: "Quiet", expired: false, from: ago(6), through: ago(5) },
      ]);
      // goals count every channel
      await db.asUser(e.user, (tx) => tx`insert into public.goals (user_id, source, metric, target, period, label) values (${e.user}, 'youtube', 'views', 1000, 'all', 'views')`);
      expect((await earn.earningsOf(e.user, 30, pop)).goals[0]).toMatchObject({ progress: 330 });

      // one that needs reconnecting counts up to its last report, and doesn't hold the rest back
      await store.markExpired(quiet);
      const lost = await views();
      expect([6, 5, 4].map((n) => on(lost, n))).toEqual([110, 220, 300]);
      expect(lost).toMatchObject({ total: 630, through: ago(4) });
      // a disconnected one's figures are gone
      await channels.disconnectChannel(e.user, pop);
      const left = await views();
      expect([6, 5, 4].map((n) => on(left, n))).toEqual([10, 20, null]);
      expect(left).toMatchObject({ total: 30, through: ago(5) });
      expect((await earn.earningsOf(e.user, 30)).channels.map((c) => [c.id, c.expired])).toEqual([[quiet, true]]);
    });

    it("gives each account's earlier Shorts, look, learning, runs and figures to its first channel when the migration's last part runs again", async () => {
      const { unitsOf } = await import("@/lib/shorts/channels");
      const one = await someone("pro", [{}]);
      const two = await someone("creator", [{}, {}]);
      // Pro, with an older channel that needs reconnecting and a newer one the old connect check let in, where posting went
      const lost = await someone("pro", [{ status: "expired" }, {}]);
      // one channel, after another that said who it's for was disconnected, which used to delete it and leave its Shorts with none
      const after = await someone("pro", [{}]);
      for (const [i, a] of [one, two, lost, after].entries()) {
        await db.admin(async (tx) => {
          await tx`
            insert into public.videos (user_id, format, params, key, title, status, youtube_id, youtube_verified, uploaded_at)
            values (${a.user}, 'wyr', '{}', 'wyr', 'Not up yet', 'review', null, false, null),
              (${a.user}, 'wyr', '{}', 'wyr', 'Up already', 'posted', ${`w2chup${i}`}, true, now())`;
          await tx`insert into public.content_ledger (item, kind, user_id) values (${`look:${990000 + i}`}, 'look', ${a.user})`;
          await tx`insert into public.weights (user_id, kind, name, score, samples) values (${a.user}, 'format', 'quiz', 2, 5)`;
          await tx`insert into public.shorts_runs (user_id, tried_at, outcome, made, next_try_at) values (${a.user}, now(), 'made', 3, now())`;
          await tx`insert into public.metrics (user_id, source, metric, day, value) values (${a.user}, 'youtube', 'views', ${today}, 100), (${a.user}, 'stripe', 'revenue:usd', ${today}, 5)`;
        });
      }
      // what may be another channel's: one uploaded before this one was connected, a link pasted by hand, YouTube figures
      // from before its own 35 days back, and a TikTok's totals from the day it was connected and before
      const [tt] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.channels (user_id, platform, external_id, title, connected_at, added_at)
        values (${one.user}, 'tiktok', ${`w2ch-tt-${one.user}`}, 'TT', '2026-01-10T12:00:00Z', '2026-01-10T12:00:00Z') returning id`);
      await db.admin(async (tx) => {
        await tx`
          insert into public.videos (user_id, format, params, key, title, status, youtube_id, youtube_verified, uploaded_at, posted_at)
          values (${one.user}, 'wyr', '{}', 'wyr', 'Up before it was connected', 'posted', 'w2chupold', true, '2025-12-01T12:00:00Z', '2025-12-01T12:00:00Z'),
            (${one.user}, 'wyr', '{}', 'wyr', 'Pasted by hand', 'posted', 'w2chuphand', false, null, now())`;
        await tx`
          insert into public.metrics (user_id, source, metric, day, value)
          values (${one.user}, 'youtube', 'views', '2025-11-01', 40), (${one.user}, 'tiktok', 'views_total', '2026-01-10', 500),
            (${one.user}, 'tiktok', 'views_total', ${today}, 900)`;
        await tx`insert into public.audience_log (user_id, channel_id, source, made_for_kids, privacy) values (${after.user}, null, 'channel', false, 'public')`;
      });
      const ids = [one.user, two.user, lost.user, after.user];
      type Seen = { user_id: string; channel_id: string | null; title?: string; source?: string; day?: string };
      type Order = { id: string; user_id: string; platform: "youtube" | "tiktok"; status: "connected" | "expired" | "revoked"; shorts_on: boolean; added_at: Date };
      // inside a transaction that's then undone, so nobody else's rows change
      class Undone extends Error {
        constructor(readonly seen: Record<string, Seen[]>, readonly order: Order[]) {
          super("undone");
        }
      }
      const migration = readFileSync("supabase/migrations/20261018010000_channels.sql", "utf8");
      // the order the migration puts channels in, then its last part
      const order = migration.slice(migration.indexOf("update public.channels c set added_at"), migration.indexOf("alter table public.channels alter column added_at"));
      const { seen, order: channelOrder } = await db.admin(async (tx) => {
        await tx.unsafe(order);
        await tx.unsafe(migration.slice(migration.indexOf("drop table if exists pg_temp.first_youtube")));
        const read = (table: string, more = "") => tx.unsafe(`select user_id, channel_id${more} from public.${table} where user_id = any($1::uuid[]) order by 1, 2`, [ids]);
        throw new Undone({
          videos: (await read("videos", ", title")) as never,
          looks: (await read("content_ledger")) as never,
          weights: (await read("channel_weights")) as never,
          runs: (await read("shorts_runs")) as never,
          metrics: (await read("metrics", ", source, to_char(day, 'YYYY-MM-DD') as day")) as never,
        }, (await tx.unsafe(`select id, user_id, platform, status, shorts_on, added_at from public.channels where user_id = any($1::uuid[]) order by added_at, id`, [ids])) as never);
      }).catch((err) => {
        if (err instanceof Undone) return { seen: err.seen, order: err.order };
        throw err;
      });
      const of = (table: string, a: { user: string }) => seen[table].filter((r) => r.user_id === a.user);
      // one channel: everything was its, and what Hookline uploaded to it is on it; what may be on another channel stays
      // unknown, and only the figures it read itself are kept
      expect(of("videos", one).map((v) => [v.title, v.channel_id]).sort()).toEqual([
        ["Not up yet", one.channels[0]], ["Pasted by hand", null], ["Up already", one.channels[0]], ["Up before it was connected", null],
      ]);
      for (const t of ["looks", "weights", "runs"]) expect(of(t, one).map((r) => r.channel_id)).toEqual([one.channels[0]]);
      expect(of("metrics", one).map((m) => [m.source, m.channel_id, m.day]).sort()).toEqual([
        ["stripe", null, today], ["tiktok", tt.id, today], ["youtube", one.channels[0], today],
      ]);
      // two channels: what isn't on YouTube goes where posting would have sent it, the rest stays unknown, and YouTube's
      // figures (which overwrote each other) go to be read again
      expect(of("videos", two).map((v) => [v.title, v.channel_id]).sort()).toEqual([["Not up yet", two.channels[0]], ["Up already", null]]);
      for (const t of ["looks", "weights", "runs"]) expect(of(t, two).map((r) => r.channel_id)).toEqual([two.channels[0]]);
      expect(of("metrics", two).map((m) => [m.source, m.channel_id])).toEqual([["stripe", null]]);
      // posting went to the connected one, so it comes first, and the app gives Pro's one place to the channel that has the
      // account's Shorts, look, learning and run
      expect(channelOrder.filter((c) => c.user_id === lost.user).map((c) => c.id)).toEqual([lost.channels[1], lost.channels[0]]);
      const rows = channelOrder.filter((c) => c.user_id === lost.user).map((c) => ({ id: c.id, platform: c.platform, status: c.status, shortsOn: c.shorts_on, addedAt: c.added_at }));
      expect(unitsOf(rows, plans.pro.channels)).toEqual([lost.channels[1]]);
      expect(of("videos", lost).find((v) => v.title === "Not up yet")?.channel_id).toBe(lost.channels[1]);
      for (const t of ["looks", "weights", "runs"]) expect(of(t, lost).map((r) => r.channel_id)).toEqual([lost.channels[1]]);
      // a channel that answered and is gone may have been where it went
      expect(of("videos", after).map((v) => [v.title, v.channel_id]).sort()).toEqual([["Not up yet", after.channels[0]], ["Up already", null]]);
      // and it was all undone
      expect((await videosOf(one.user)).every((v) => v.channel_id === null)).toBe(true);
      expect((await channels.channelsOf(lost.user)).map((c) => c.id)).toEqual(lost.channels);
    });

    it("uploads each Short only to the channel it was made for, with that channel's answer, and never to anyone else's", async () => {
      const c = await someone("creator", [{ title: "Test one", external: TEST_CHANNEL, madeForKids: true }, { title: "Not a test one" }]);
      const [test, other] = c.channels;
      const soon = new Date(now.getTime() + 3 * 3600_000);
      const ready = async (user: string, channel: string | null, title: string) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path)
        values (${user}, ${channel}, 'wyr', '{"pairs":[]}', 'wyr', ${title}, 'ready', ${now}, ${soon}, ${`${user}/${title}.mp4`}) returning id`))[0].id;
      const mine = await ready(c.user, test, "For the test channel");
      const byHand = await ready(c.user, other, "For the other channel");
      const nowhere = await ready(c.user, null, "For no channel");
      // someone else's Short pointed at that test channel, as if the key that stops it were gone: the upload's own join still refuses it
      const x = await someone("pro");
      const [rogue] = await db.admin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        return tx<{ id: string }[]>`
          insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path)
          values (${x.user}, ${test}, 'wyr', '{"pairs":[]}', 'wyr', 'Not theirs', 'ready', ${now}, ${soon}, 'w2ch/rogue.mp4') returning id`;
      });
      const seen = uploads();
      // what's on YouTube already isn't these tests' to say
      stubFetch(() => new Response("{}", { status: 500 }));
      await post.postDue(now, 100);
      expect(seen.filter((u) => [test, other].includes(u.channel) || u.title === "Not theirs")).toEqual([
        { channel: test, title: "For the test channel", madeForKids: true, publishAt: soon },
      ]);
      expect(await videoRow(mine)).toMatchObject({ status: "scheduled", channel_id: test, youtube_id: expect.stringMatching(/^w2chup/) });
      // before YouTube's audit, the other channel's is the creator's to post; one with no channel never uploads
      for (const id of [byHand, nowhere, rogue.id]) expect(await videoRow(id)).toMatchObject({ status: "ready", youtube_id: null });
      await db.admin((tx) => tx`delete from public.videos where id = ${rogue.id}`);
    });

    it("posts nothing to a disconnected channel, and once it's connected again its late Shorts get new times two hours apart and go up", async () => {
      const c = await someone("creator", [{ title: "Comes back", external: TEST_CHANNEL }]);
      const [ch] = c.channels;
      const why = ["Would you rathers do about as well as your usual Short (4 posted)", "Posts at 4pm, a starting guess until your own numbers come in"];
      const kept = async (title: string, status: string, when: Date, tiktok = false) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path, why, tiktok_post, tiktok_at)
        values (${c.user}, ${ch}, 'wyr', '{"pairs":[]}', 'wyr', ${title}, ${status}, ${now}, ${when}, ${status === "ready" ? `${c.user}/${title}.mp4` : null},
          ${tx.json(why)}, ${tiktok ? tx.json(choices) : null}, ${tiktok ? when : null})
        returning id`))[0].id;
      // two whose times passed while it was away (one going to TikTok too), one being made that's due in five minutes, one at
      // noon, and one of today's still waiting for a yes, suggested for 4pm
      const early = await kept("Early", "ready", at(3, 5), true);
      const later = await kept("Later", "ready", at(5, 5));
      const making = await kept("Making", "approved", at(6, 10));
      const noon = await kept("Noon", "ready", at(12));
      await db.admin((tx) => tx`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, suggested_for) values (${c.user}, ${ch}, 'wyr', '{"pairs":[]}', 'wyr', 'Today', 'review', ${at(16)})`);
      expect(await channels.disconnectChannel(c.user, ch)).toEqual({ platform: "youtube", cleared: 0 });
      const seen = uploads();
      stubFetch(() => new Response("{}", { status: 500 }));
      await post.postDue(now, 100);
      expect(seen.filter((u) => u.channel === ch)).toEqual([]);

      // connected again, the late ones get the channel's next free times (Creator's 10am, 7pm and 9pm, since noon and 4pm
      // are booked) instead of all going up at once, and its TikTok time goes with the one that had one
      const back = await channels.connectChannel(c.user, "youtube", { externalId: TEST_CHANNEL, title: "Comes back", handle: null, avatarUrl: null },
        { access: "ya29.w2-back", refresh: null, expiresAt: new Date(Date.now() + 3600_000), scopes: null }, plans.creator, now);
      expect(back).toEqual({ id: ch, already: false, moved: 3 });
      const rows = await db.admin((tx) => tx<{ id: string; scheduled_for: Date; why: string[]; tiktok_at: Date | null }[]>`
        select id, scheduled_for, why, tiktok_at from public.videos where user_id = ${c.user} and scheduled_for is not null order by scheduled_for`);
      expect(rows.map((r) => [r.id, r.scheduled_for])).toEqual([[early, at(10)], [noon, at(12)], [later, at(19)], [making, at(21)]]);
      expect(rows[0]).toMatchObject({ why: [why[0], "Posts at 10am, a starting guess until your own numbers come in"], tiktok_at: at(10) });
      // nobody else can move them
      expect(await queue.retimeLate(A, ch, now)).toBe(0);

      // and up they go, each public at its new time
      await post.postDue(now, 100);
      expect(seen.filter((u) => u.channel === ch).map((u) => [u.title, u.publishAt])).toEqual([["Early", at(10)], ["Noon", at(12)], ["Later", at(19)]]);
    });

    it("saves a channel that's back and gives its late Shorts new times together, so none can go up before they have them", async () => {
      const c = await someone("creator", [{ title: "All at once", external: TEST_CHANNEL }]);
      const [ch] = c.channels;
      const late = async (title: string, when: Date) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path)
        values (${c.user}, ${ch}, 'wyr', '{"pairs":[]}', 'wyr', ${title}, 'ready', ${now}, ${when}, ${`${c.user}/${title}.mp4`}) returning id`))[0].id;
      const first = await late("First", at(3));
      const second = await late("Second", at(4));
      // and one being sent to TikTok right now, which is left as it is
      const sending = await late("Being sent", at(5));
      await db.admin((tx) => tx`update public.videos set posting_at = now() where id = ${sending}`);
      await channels.disconnectChannel(c.user, ch);
      // one of them held, so connecting stops partway through giving them new times
      let connecting: ReturnType<typeof channels.connectChannel> | undefined;
      await db.admin(async (tx) => {
        await tx`select id from public.videos where id = ${second} for update`;
        connecting = channels.connectChannel(c.user, "youtube", { externalId: TEST_CHANNEL, title: "All at once", handle: null, avatarUrl: null },
          { access: "ya29.w2-once", refresh: null, expiresAt: new Date(Date.now() + 3600_000), scopes: null }, plans.creator, now);
        await waiting(1);
        // until they all have them, it isn't connected, so nothing can go up to it
        expect((await db.admin((t) => t<{ status: string }[]>`select status from public.channels where id = ${ch}`))[0].status).toBe("revoked");
      });
      expect(await connecting).toEqual({ id: ch, already: false, moved: 2 });
      const rows = await db.admin((tx) => tx<{ id: string; scheduled_for: Date }[]>`
        select id, scheduled_for from public.videos where id in ${tx([first, second, sending])} order by scheduled_for`);
      expect(rows.map((r) => [r.id, r.scheduled_for])).toEqual([[sending, at(5)], [first, at(10)], [second, at(12)]]);
    });

    it("gives a channel's late Shorts new times once it first says who it's for, instead of all going up then", async () => {
      const c = await someone("creator", [{ title: "Unanswered", external: TEST_CHANNEL, madeForKids: null }]);
      const [ch] = c.channels;
      const clock = new Date();
      // kept while it hadn't said, so nothing went up to it, and their times passed
      const ids: string[] = [];
      for (const hours of [3, 2]) {
        ids.push((await db.admin((tx) => tx<{ id: string }[]>`
          insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path)
          values (${c.user}, ${ch}, 'wyr', '{"pairs":[]}', 'wyr', ${`Waited ${hours}`}, 'ready', ${clock}, ${new Date(clock.getTime() - hours * 3600_000)},
            ${`${c.user}/waited-${hours}.mp4`}) returning id`))[0].id);
      }
      const seen = uploads();
      stubFetch(() => new Response("{}", { status: 500 }));
      await post.postDue(clock, 100);
      expect(seen.filter((u) => u.channel === ch)).toEqual([]);

      expect(await channels.setAudience(c.user, ch, false, "public")).toBe(true);
      const times = (await db.admin((tx) => tx<{ scheduled_for: Date }[]>`
        select scheduled_for from public.videos where id in ${tx(ids)} order by scheduled_for`)).map((r) => r.scheduled_for.getTime());
      expect(times[0]).toBeGreaterThanOrEqual(clock.getTime() + 3600_000);
      expect(times[1] - times[0]).toBeGreaterThanOrEqual(2 * 3600_000);
      // so they go up to go public at those times, not all at once now
      await post.postDue(new Date(), 100);
      expect(seen.filter((u) => u.channel === ch).map((u) => u.publishAt?.getTime())).toEqual(times);
    });

    it("leaves the times alone on a channel the creator posts to themselves, whenever it takes over Shorts or comes back", async () => {
      const c = await someone("pro");
      // kept with no channel, for the creator to post, their times passed, one going to TikTok too
      const kept = async (title: string, when: Date, tiktok = false) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, format, params, key, title, status, decided_at, scheduled_for, file_path, why, tiktok_post, tiktok_at)
        values (${c.user}, 'wyr', '{"pairs":[]}', 'wyr', ${title}, 'ready', ${now}, ${when}, ${`${c.user}/${title}.mp4`},
          ${tx.json(["Best posted around 4pm, a starting guess until your own numbers come in"])}, ${tiktok ? tx.json(choices) : null}, ${tiktok ? at(16) : null})
        returning id`))[0].id;
      const ids = [await kept("Two days back", new Date(now.getTime() - 2 * 86400_000), true), await kept("This morning", at(5))];
      const before = await db.admin((tx) => tx<{ id: string; scheduled_for: Date; why: string[]; tiktok_at: Date | null }[]>`
        select id, scheduled_for, why, tiktok_at from public.videos where id in ${tx(ids)} order by id`);
      const info = { externalId: "UCw2chbyhand", title: "By hand", handle: null, avatarUrl: null };
      const tokens = { access: "ya29.w2-hand", refresh: null, expiresAt: new Date(Date.now() + 3600_000), scopes: null };
      const first = await channels.connectChannel(c.user, "youtube", info, tokens, plans.pro, now);
      expect(first).toMatchObject({ already: false, moved: 0 });
      // it takes them over, at the times the creator saw
      const after = async () => db.admin((tx) => tx<{ id: string; scheduled_for: Date; why: string[]; tiktok_at: Date | null; channel_id: string }[]>`
        select id, scheduled_for, why, tiktok_at, channel_id from public.videos where id in ${tx(ids)} order by id`);
      expect(await after()).toEqual(before.map((v) => ({ ...v, channel_id: first!.id })));
      // and the same when it's connected again
      await channels.disconnectChannel(c.user, first!.id);
      expect(await channels.connectChannel(c.user, "youtube", info, tokens, plans.pro, now)).toEqual({ id: first!.id, already: false, moved: 0 });
      expect(await after()).toEqual(before.map((v) => ({ ...v, channel_id: first!.id })));
    });

    it("keeps each channel's own times and answer on a yes, and the account's TikTok posts two hours apart", async () => {
      const c = await someone("creator", [{ title: "Grown-ups" }, { title: "Kids", madeForKids: true }]);
      const [grown, kids] = c.channels;
      const review = async (channel: string, suggested: Date) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, suggested_for, why)
        values (${c.user}, ${channel}, 'wyr', '{"pairs":[]}', 'wyr', 'Would you rather', 'review', ${suggested},
          ${tx.json(["Posts at noon, a starting guess until your own numbers come in"])})
        returning id`))[0].id;

      // Grown-ups has 10am, going to TikTok too, and noon
      const ten = await review(grown, at(10));
      const twelve = await review(grown, at(12));
      expect(await queue.approve(c.user, ten, plans.creator, now, choices)).toBe(true);
      expect(await queue.approve(c.user, twelve, plans.creator, now)).toBe(true);
      expect(await videoRow(ten)).toMatchObject({ scheduled_for: at(10), tiktok_at: at(10), made_for_kids: false });
      expect(await queue.approve(A, twelve, plans.creator, now)).toBe(false);

      // a yes after its time on Kids takes Kids' own first free time, 10am, whatever Grown-ups has then, with Kids' answer;
      // the account's one TikTok gets it two hours after Grown-ups' post there
      const late = await review(kids, new Date(now.getTime() - 3600_000));
      expect(await queue.approve(c.user, late, plans.creator, now, choices)).toBe(true);
      expect(await videoRow(late)).toMatchObject({
        scheduled_for: at(10), tiktok_at: at(12), made_for_kids: true, params: { pairs: [], allowComments: false },
        why: ["Posts at 10am, a starting guess until your own numbers come in"],
      });

      // TikTok chosen later for one at 11am: two hours from both
      const eleven = await review(kids, at(11));
      expect(await queue.approve(c.user, eleven, plans.creator, now)).toBe(true);
      expect(await queue.chooseTikTok(c.user, eleven, choices, now)).toBe(true);
      expect(await videoRow(eleven)).toMatchObject({ scheduled_for: at(11), tiktok_at: at(14) });
      expect(await queue.chooseTikTok(A, eleven, choices, now)).toBe(false);
      // and one whose time has passed goes now, unless a post went to TikTok in the last two hours
      await db.admin((tx) => tx`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, tiktok_post, tiktok_at, tiktok_publish_id, tiktok_posted_at)
        values (${c.user}, ${grown}, 'wyr', '{"pairs":[]}', 'wyr', 'Sent', 'posted', ${now}, ${tx.json(choices)}, ${at(5, 5)}, 'w2ch-sent', ${at(5, 5)})`);
      const [passed] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path)
        values (${c.user}, ${kids}, 'wyr', '{"pairs":[]}', 'wyr', 'Passed', 'ready', ${now}, ${at(5, 35)}, 'w2ch/passed.mp4') returning id`);
      expect(await queue.chooseTikTok(c.user, passed.id, choices, now)).toBe(true);
      expect((await videoRow(passed.id)).tiktok_at).toEqual(at(8));
    });

    it("books the account's posting times one at a time, so two kept at once still go to TikTok two hours apart", async () => {
      const c = await someone("creator", [{ title: "One tab" }, { title: "Other tab" }]);
      const review = async (channel: string) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, suggested_for, why)
        values (${c.user}, ${channel}, 'wyr', '{"pairs":[]}', 'wyr', 'Would you rather', 'review', ${at(16)},
          ${tx.json(["Posts at 4pm, a starting guess until your own numbers come in"])})
        returning id`))[0].id;
      const [a, b] = [await review(c.channels[0]), await review(c.channels[1])];
      // both kept for 4pm with TikTok, at the same moment, while another booking for the account is under way
      const book = async (start: () => Promise<boolean>[], n: number) => {
        let booked: Promise<boolean[]> | undefined;
        await db.admin(async (tx) => {
          await queue.lockTimes(tx, c.user);
          booked = Promise.all(start());
          await waiting(n);
        });
        return booked;
      };
      expect(await book(() => [queue.approve(c.user, a, plans.creator, now, choices), queue.approve(c.user, b, plans.creator, now, choices)], 2)).toEqual([true, true]);
      expect((await Promise.all([a, b].map(videoRow))).map((v) => v.scheduled_for)).toEqual([at(16), at(16)]);
      const tiktok = async (ids: string[]) => (await Promise.all(ids.map(videoRow))).map((v) => (v.tiktok_at as Date).getTime()).sort((x, y) => x - y);
      expect(await tiktok([a, b])).toEqual([at(16).getTime(), at(18).getTime()]);
      // and TikTok chosen later waits its turn too
      const [later] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for)
        values (${c.user}, ${c.channels[0]}, 'wyr', '{"pairs":[]}', 'wyr', 'Later', 'approved', ${now}, ${at(17)}) returning id`);
      expect(await book(() => [queue.chooseTikTok(c.user, later.id, choices, now)], 1)).toEqual([true]);
      expect(await tiktok([a, b, later.id])).toEqual([at(16).getTime(), at(18).getTime(), at(20).getTime()]);
    });

    it("gives each channel's waiting Shorts that channel's answer, and no other channel's", async () => {
      const c = await someone("creator", [{ title: "Kids", madeForKids: null }, { title: "Grown-ups", madeForKids: null }]);
      const [kids, grown] = c.channels;
      const waiting = async (channel: string) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at)
        values (${c.user}, ${channel}, 'wyr', '{"pairs":[]}', 'wyr', 'Waiting', 'approved', ${now}) returning id`))[0].id;
      const k = await waiting(kids);
      const g = await waiting(grown);
      expect(await channels.setAudience(c.user, kids, true, "public")).toBe(true);
      expect(await videoRow(k)).toMatchObject({ made_for_kids: true, params: { pairs: [], allowComments: false } });
      expect(await videoRow(g)).toMatchObject({ made_for_kids: null, params: { pairs: [] } });
      expect(await channels.setAudience(c.user, grown, false, "public")).toBe(true);
      expect(await videoRow(g)).toMatchObject({ made_for_kids: false, params: { pairs: [] } });
      expect(await videoRow(k)).toMatchObject({ made_for_kids: true });
      // and nobody else's answers reach them
      expect(await queue.fitAudience(A, kids)).toBe(0);
    });

    it("leaves a Short made for a YouTube channel ready for it once TikTok has it, even while that channel needs reconnecting", async () => {
      const c = await someone("pro", [{ title: "Away", status: "expired" }]);
      const [tt] = await db.admin((tx) => tx<{ id: string }[]>`insert into public.channels (user_id, platform, external_id, title) values (${c.user}, 'tiktok', ${`w2ch-tt-${c.user}`}, 'TT') returning id`);
      await db.admin((tx) => tx`insert into public.channel_tokens (channel_id, access_token, expires_at) values (${tt.id}, ${seal("act.w2ch.away")}, now() + interval '1 hour')`);
      const due = async (channel: string | null, title: string) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path, clean_path, tiktok_post, tiktok_at)
        values (${c.user}, ${channel}, 'wyr', '{"pairs":[]}', 'wyr', ${title}, 'ready', ${now}, ${at(6)}, 'w2ch/away.mp4', 'w2ch/away.mp4', ${tx.json(choices)}, ${at(6)})
        returning id`))[0].id;
      const forYouTube = await due(c.channels[0], "Kept for YouTube");
      const tiktokOnly = await due(null, "TikTok only");
      stubFetch((u) => {
        if (u.endsWith("/post/publish/creator_info/query/")) return { data: { creator_nickname: "w2", privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } };
        if (u.endsWith("/post/publish/video/init/")) return { data: { publish_id: "w2ch-pub", upload_url: "https://tiktok.test/w2ch" }, error: { code: "ok" } };
        if (u === "https://tiktok.test/w2ch") return {};
        return new Response("{}", { status: 500 });
      });
      await post.postDue(now, 100);
      // it can still go up to YouTube once that channel is back, or the creator posts it there and says so
      expect(await videoRow(forYouTube)).toMatchObject({ status: "ready", tiktok_publish_id: "w2ch-pub", posted_at: null });
      // with no YouTube channel to go to, TikTok is where it's posted
      expect(await videoRow(tiktokOnly)).toMatchObject({ status: "posted", tiktok_publish_id: "w2ch-pub" });
    });

    it("keeps the TikTok choices made for the TikTok posts go to when an extra one from before is disconnected", async () => {
      const c = await someone("pro");
      // the first connected gets the posts; one connected after it, from before there was one a plan, gets none
      const tiktok = async (n: number) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.channels (user_id, platform, external_id, title, connected_at, added_at)
        values (${c.user}, 'tiktok', ${`w2ch-tt${n}-${c.user}`}, ${`TT ${n}`}, ${new Date(Date.UTC(2026, 0, n))}, ${new Date(Date.UTC(2026, 0, n))}) returning id`))[0].id;
      const posting = await tiktok(1);
      const extra = await tiktok(2);
      const [pending] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, format, params, key, title, status, decided_at, scheduled_for, file_path, tiktok_post, tiktok_at)
        values (${c.user}, 'wyr', '{"pairs":[]}', 'wyr', 'For TikTok', 'ready', ${now}, ${at(16)}, 'w2ch/tt.mp4', ${tx.json(choices)}, ${at(16)}) returning id`);
      expect(await channels.disconnectChannel(c.user, extra)).toEqual({ platform: "tiktok", cleared: 0 });
      expect(await videoRow(pending.id)).toMatchObject({ tiktok_post: choices, tiktok_at: at(16) });
      // the one posts go to takes them with it
      expect(await channels.disconnectChannel(c.user, posting)).toEqual({ platform: "tiktok", cleared: 1 });
      expect(await videoRow(pending.id)).toMatchObject({ tiktok_post: null, tiktok_at: null });
    });

    it("moves a Short whose link is on another of the creator's channels, asking its own channel first, and refuses one on a disconnected channel", async () => {
      const c = await someone("creator", [{ title: "Made for" }, { title: "Really on" }, { title: "Gone" }]);
      const [madeFor, reallyOn, gone] = c.channels;
      await channels.disconnectChannel(c.user, gone);
      const ready = async (channel: string) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, file_path)
        values (${c.user}, ${channel}, 'wyr', '{"pairs":[]}', 'wyr', 'Posted by hand', 'ready', ${now}, 'w2ch/hand.mp4') returning id`))[0].id;
      const on = (channelId: string) => async () => ({ state: { channelId, uploadStatus: "processed", privacy: "public", failureReason: null, rejectionReason: null, madeForKids: false } as VideoState });

      const v = await ready(madeFor);
      expect(await queue.markPosted(c.user, v, "https://youtube.com/shorts/w2chmoved01", on(c.externals[1]))).toEqual({ ok: true, checked: true, moved: "Really on" });
      expect(await videoRow(v)).toMatchObject({ status: "posted", channel_id: reallyOn, youtube_id: "w2chmoved01", youtube_verified: true });
      // on a channel they disconnected: not theirs to count any more, and said how to fix it
      const w = await ready(madeFor);
      expect(await queue.markPosted(c.user, w, "https://youtube.com/shorts/w2chgone001", on(c.externals[2]))).toEqual({
        ok: false, message: "That video is on Gone, which is disconnected. Connect it again so Hookline can check it, or leave the link empty.",
      });
      expect(await videoRow(w)).toMatchObject({ status: "ready", channel_id: madeFor, youtube_id: null });

      // asked as the channel it was made for first, which sees its own private videos
      const x = await ready(reallyOn);
      const calls = stubFetch((u, init) => {
        const id = new URL(u).searchParams.get("id");
        const mine = new Headers(init?.headers).get("authorization") === `Bearer ya29.${c.email}.1`;
        return { items: mine ? [{ id, snippet: { channelId: c.externals[1] }, status: { uploadStatus: "processed", privacyStatus: "private" } }] : [] };
      });
      expect(await queue.markPosted(c.user, x, "https://youtu.be/w2chfirst01")).toEqual({ ok: true, checked: true });
      expect(calls.map((k) => new Headers(k.init?.headers).get("authorization"))).toEqual([`Bearer ya29.${c.email}.1`]);
      expect(await queue.markPosted(A, w, "")).toMatchObject({ ok: false });
    });

    it("connects only as many channels as the plan has room for, even when two come back at once, and one TikTok account", async () => {
      const tokens = { access: "ya29.w2-race", refresh: null, expiresAt: new Date(Date.now() + 3600_000), scopes: null };
      const connect = (user: string, plan: keyof typeof plans, externalId: string, platform: "youtube" | "tiktok" = "youtube") =>
        channels.connectChannel(user, platform, { externalId, title: externalId, handle: null, avatarUrl: null }, tokens, plans[plan], now);
      // Pro has room for one: two at once, and only one gets it
      const p = await someone("pro");
      const two = await Promise.all([connect(p.user, "pro", "UCw2chraceone"), connect(p.user, "pro", "UCw2chracetwo")]);
      expect(two.filter((x) => x === null)).toHaveLength(1);
      const got = two.find((x) => x !== null)!;
      expect(got).toMatchObject({ already: false, moved: 0 });
      const theirs = await channels.channelsOf(p.user);
      expect(theirs.map((x) => x.id)).toEqual([got.id]);
      // the one they have connects again, and says it was connected already
      expect(await connect(p.user, "pro", theirs[0].externalId)).toEqual({ id: got.id, already: true, moved: 0 });

      // Creator's fifth place: two at once, and one gets it
      const cr = await someone("creator", [{}, {}, {}, {}]);
      const fifth = await Promise.all([connect(cr.user, "creator", "UCw2chfiftha"), connect(cr.user, "creator", "UCw2chfifthb")]);
      expect(fifth.filter((x) => x === null)).toHaveLength(1);
      expect((await channels.channelsOf(cr.user)).filter((x) => x.platform === "youtube")).toHaveLength(5);
      // one TikTok account on every plan
      expect(await connect(cr.user, "creator", "w2ch-tt-first", "tiktok")).toMatchObject({ already: false, moved: 0 });
      expect(await connect(cr.user, "creator", "w2ch-tt-second", "tiktok")).toBeNull();
      expect((await channels.channelsOf(cr.user)).filter((x) => x.platform === "tiktok").map((x) => x.externalId)).toEqual(["w2ch-tt-first"]);
    });

    it("says what each finished Short is waiting for, on the channel it was made for", async () => {
      const notes = await import("@/lib/server/notify");
      const c = await someone("creator", [{ title: "Quiz Den", external: TEST_CHANNEL, madeForKids: null }, { title: "Ball Clash" }]);
      const [api, own] = c.channels;
      const finish = async (channel: string | null, title: string) => {
        const [v] = await db.admin((tx) => tx<{ id: string }[]>`
          insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for)
          values (${c.user}, ${channel}, 'wyr', '{"pairs":[]}', 'wyr', ${title}, 'rendering', ${now}, ${at(12)}) returning id`);
        const [j] = await db.admin((tx) => tx<{ id: number }[]>`insert into public.render_jobs (video_id, priority, status) values (${v.id}, 2, 'running') returning id`);
        const spec = { format: "wyr", params: { pairs: [] } } as Parameters<Render["finishJob"]>[0]["spec"];
        await render.finishJob({ id: j.id, videoId: v.id, userId: c.user, spec, tag: false, attempts: 1, clean: false, alsoClean: false }, `${c.user}/${v.id}.mp4`);
        const n = (await notes.notificationsOf(c.user)).items.find((x) => x.kind === "ready" && x.body?.startsWith(title));
        return n ? { title: n.title, body: n.body, href: n.href === `/app/shorts/${v.id}` ? "its page" : n.href } : null;
      };
      // Hookline uploads to Quiz Den, once it's said whether it's made for kids
      expect(await finish(api, "Asks first")).toEqual({
        title: "One question before it posts", body: "Asks first. Say whether Quiz Den is made for kids, in Settings, and it posts.", href: `/app/settings#audience-${api}`,
      });
      expect(await finish(own, "By hand")).toEqual({ title: "Ready for you to post", body: "By hand. Download it, upload it to YouTube, then tap I posted it.", href: "its page" });
      expect(await finish(null, "Nowhere")).toEqual({ title: "Ready to download", body: "Nowhere", href: "its page" });
      // answered, it posts itself, and says so once it's up
      expect(await channels.setAudience(c.user, api, false, "public")).toBe(true);
      expect(await finish(api, "Posts itself")).toBeNull();
      // Google stopped letting Hookline in: it waits for Quiz Den to be reconnected (and a question keeps its question mark)
      await store.markExpired(api);
      expect(await finish(api, "Fly or be invisible?")).toEqual({
        title: "Ready once Quiz Den is back", body: "Fly or be invisible? Reconnect Quiz Den in Settings so it can post.", href: `/app/settings#audience-${api}`,
      });
      // disconnected, it's the creator's to post
      await channels.disconnectChannel(c.user, api);
      expect(await finish(api, "Gone")).toMatchObject({ title: "Ready for you to post", href: "its page" });
    });

    it("shows one channel's queue when it's picked, each Short saying which channel it's for", async () => {
      const q = await someone("creator", [{ title: "Left" }, { title: "Right" }]);
      const [left, right] = q.channels;
      for (const id of q.channels) expect(await gen.makeShorts(q.user, { origin: "daily", channelId: id, count: 2, now })).toBe(2);
      const [up] = await posted(q.user, right, [50]);
      const all = await queue.queueOf(q.user);
      expect(all.waiting.map((w) => w.channelId).sort()).toEqual([left, left, right, right].sort());
      expect(all.posted.map((p) => [p.id, p.channelId])).toEqual([[up, right]]);
      const one = await queue.queueOf(q.user, left);
      expect(one.waiting.map((w) => w.channelId)).toEqual([left, left]);
      expect(one.posted).toEqual([]);
      expect((await queue.queueOf(q.user, right)).posted.map((p) => p.id)).toEqual([up]);
      // another account's channel shows nothing
      expect(await queue.queueOf(A, left)).toEqual({ waiting: [], coming: [], posted: [] });
    });

    it("shows one channel's Shorts in the library and the calendar, and what's working on it against its own usual", async () => {
      const lib = await import("@/lib/server/shorts/library");
      const g = await someone("creator", [{ title: "Big" }, { title: "Small" }]);
      const [big, small] = g.channels;
      const bigs = await posted(g.user, big, [400, 500, 600]);
      const smalls = await posted(g.user, small, [10, 11, 12, 30]);
      const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

      // one channel picked: only its Shorts, along with whatever else is asked for
      expect(ids((await lib.libraryOf(g.user, { channel: small })).items)).toEqual([...smalls].sort());
      expect((await lib.libraryOf(g.user, { channel: big, q: "Quiz 1" })).items.map((x) => x.id)).toEqual([bigs[0]]);
      expect((await lib.libraryOf(g.user)).total).toBe(7);
      const from = new Date(now.getTime() - 30 * 86400_000);
      const to = new Date(now.getTime() + 86400_000);
      expect(ids(await lib.calendarOf(g.user, from, to, big))).toEqual([...bigs].sort());
      expect(await lib.calendarOf(g.user, from, to)).toHaveLength(7);
      // another account's channel shows nothing
      expect((await lib.libraryOf(A, { channel: small })).total).toBe(0);
      expect(await lib.calendarOf(A, from, to, small)).toEqual([]);

      // what each channel learned, and what the account learned across both
      await db.admin(async (tx) => {
        await tx`
          insert into public.channel_weights (channel_id, user_id, kind, name, score, samples) values
            (${big}, ${g.user}, 'format', 'battle', 2, 20), (${big}, ${g.user}, 'key', 'battle:spike', 1.6, 10),
            (${small}, ${g.user}, 'format', 'quiz', 1.5, 4), (${small}, ${g.user}, 'key', 'battle:spike', 1, 3)`;
        await tx`
          insert into public.weights (user_id, kind, name, score, samples) values
            (${g.user}, 'format', 'battle', 2, 20), (${g.user}, 'format', 'quiz', 1.5, 4), (${g.user}, 'key', 'battle:spike', 1.4, 13)`;
      });
      const mine = await lib.insightsFor(g.user, small);
      const format = (x: typeof mine, f: string) => x.formats.find((y) => y.format === f)!;
      // its own results, against its own usual (the middle of 10, 11, 12 and 30)
      expect(mine).toMatchObject({ typical: 11.5, measured: 4 });
      expect(format(mine, "quiz")).toMatchObject({ score: 1.5, samples: 4 });
      expect(format(mine, "battle")).toMatchObject({ score: 1, samples: 0 });
      // its odds start from what the other channel found: more battles than a format nobody has tried
      expect(format(mine, "battle").share).toBeGreaterThan(format(mine, "wyr").share);
      // a kind stands out by its own results: Spike did as usual here, whatever it did on the other channel
      expect(mine.kinds).toEqual([]);
      expect((await lib.insightsFor(g.user, big)).kinds).toEqual([expect.objectContaining({ group: "battle:spike", name: "Spike battles", samples: 10 })]);
      // across both: the account's own results, with no one usual, since each channel has its own
      const across = await lib.insightsFor(g.user);
      expect(across).toMatchObject({ typical: null, measured: 24 });
      expect(format(across, "battle")).toMatchObject({ score: 2, samples: 20 });
      // and nobody else's channel tells them anything
      expect(await lib.insightsFor(A, small)).toMatchObject({ measured: 0, typical: null, kinds: [] });
    });

    it("measures when each Short went out against its own channel's usual, for Trends' best times", async () => {
      const t = await someone("creator", [{ title: "Loud" }, { title: "Quiet" }]);
      const [loud, quiet] = t.channels;
      const louds = await posted(t.user, loud, [900, 1000, 1100]);
      const quiets = await posted(t.user, quiet, [9, 10, 11]);
      // the loud channel's went out at 10am four days ago, the quiet one's at 4pm
      const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 4);
      const sent = (ids: string[], hour: number) => db.admin((tx) => tx`update public.videos set posted_at = ${new Date(day + hour * 3600_000)} where id = any(${ids}::uuid[])`);
      await sent(louds, 10);
      await sent(quiets, 16);
      const { map, posts } = await trends.postingTimes(t.user);
      expect(posts).toBe(6);
      // each about as good as its own channel's usual, so the quiet channel's aren't a hundredth of the loud one's
      const weekday = new Date(day).getUTCDay();
      const around = (lifts: number[]) => Math.exp(lifts.reduce((s, l) => s + Math.log(l), 0) / lifts.length);
      expect(map.cells[weekday][3]).toBeCloseTo(around([910 / 1010, 1, 1110 / 1010]), 6);
      expect(map.cells[weekday][5]).toBeCloseTo(around([19 / 20, 1, 21 / 20]), 6);
      expect([map.counts[weekday][3], map.counts[weekday][5]]).toEqual([3, 3]);
    });

    it("names one channel's Earnings figures for it, and keeps the account's own figures for all of them", async () => {
      const e = await someone("creator", [{ title: "Pop" }, { title: "Quiet" }]);
      const [pop, quiet] = e.channels;
      const day = new Date(now.getTime() - 5 * 86400_000).toISOString().slice(0, 10);
      await db.admin(async (tx) => {
        for (const [channel, views] of [[pop, 100], [quiet, 10]] as const) {
          await tx`
            insert into public.metrics (user_id, channel_id, source, metric, day, value) values
              (${e.user}, ${channel}, 'youtube', 'views', ${day}, ${views}), (${e.user}, ${channel}, 'youtube', 'subscribers', ${day}, 1),
              (${e.user}, ${channel}, 'youtube', 'revenue', ${day}, 2)`;
        }
        await tx`insert into public.metrics (user_id, source, metric, day, value) values (${e.user}, 'stripe', 'revenue:usd', ${day}, 40)`;
      });
      const labels = async (channelId?: string) => (await earn.earningsOf(e.user, 30, channelId)).series.map((s) => s.label);
      expect(await labels(quiet)).toEqual(["Views on Quiet", "New subscribers on Quiet", "Quiet's YouTube revenue"]);
      expect(await labels()).toEqual(["Views on YouTube", "New subscribers", "YouTube revenue", "Sales through Stripe (USD)"]);
    });
  });

  // wave 2: leaderboard
  describe("leaderboard: welcome backs, hidden names and each LIVE's own page", () => {
    /** the one moment every job here runs at */
    const now = new Date();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    let K = "";
    let N = "";
    /** a streamer whose LIVE today was reloaded twice */
    let R = "";
    let key = "";
    /** K's LIVEs: an older one verified as theirs, one nobody played in, the one going now, and a newer one that wasn't theirs */
    const ids = { verified: "", empty: "", going: "", theirs: "" };
    const top = [
      { id: "7001", name: "Kayla Smith", coins: 1500 },
      { id: "7002", name: "Drew Quill", coins: 900 },
      { id: "7003", name: "Mia Zephyr", coins: 400 },
      { id: "7004", name: "Zed Ocho", coins: 200 },
    ];
    /** A LIVE as the game's saves would have left it, started and last heard from so long ago; K's unless it says */
    const session = async (o: { user?: string; start: number; last: number; rounds?: number; coins?: number; top?: object[]; heard?: string[]; verified?: boolean }) => {
      const [r] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.live_sessions (id, user_id, game, started_at, last_event_at, rounds, coins, peak_players, top_gifters, heard, verified)
        values (gen_random_uuid(), ${o.user ?? K}, 'battle', ${ago(o.start)}, ${ago(o.last)}, ${o.rounds ?? 0}, ${o.coins ?? 0}, 4, ${tx.json((o.top ?? []) as never)},
          ${o.heard ?? []}::text[], ${o.verified ?? false})
        returning id`);
      return r.id;
    };

    beforeAll(async () => {
      if (!safe) return;
      [{ id: K }, { id: N }, { id: R }] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into auth.users (email) values ('w2-leaderboard-1@test.local'), ('w2-leaderboard-2@test.local'), ('w2-leaderboard-3@test.local') returning id`);
    });

    afterAll(async () => {
      if (!safe) return;
      await db.admin((tx) => tx`delete from auth.users where email in ('w2-leaderboard-1@test.local', 'w2-leaderboard-2@test.local', 'w2-leaderboard-3@test.local')`);
    });

    it("sends the game the ids of the last LIVE's top gifters, never their names, and only when that LIVE was theirs", async () => {
      key = await live.overlayKeyOf(K);
      // before any LIVE is over, there's nobody to welcome back
      expect((await live.overlayFor(key, now))?.supporters).toEqual([]);
      expect(await live.lastLiveOf(K, now)).toBeNull();
      ids.verified = await session({ start: 3 * 3600_000, last: 2 * 3600_000, rounds: 12, coins: 3000, top, heard: ["k.streams"], verified: true });
      // newer ones that don't count as the last LIVE: one nobody played in, and the one going now (quiet for only 2 minutes)
      ids.empty = await session({ start: 60 * 60_000, last: 59 * 60_000 });
      ids.going = await session({ start: 30 * 60_000, last: 2 * 60_000, rounds: 3, coins: 50, top: [{ id: "9001", name: "Newt Vale", coins: 50 }], heard: ["k.streams"], verified: true });
      const o = await live.overlayFor(key, now);
      expect(o?.supporters).toEqual(["7001", "7002", "7003"]);
      const json = JSON.stringify(o);
      for (const name of [...top.map((g) => g.name), "Newt Vale"]) expect(json).not.toContain(name);
      expect(await live.lastLiveOf(K, now)).toEqual({ verified: true });
      // a newer LIVE that's over but wasn't verified as theirs: its gifters could be anyone's supporters, so nobody
      ids.theirs = await session({ start: 100 * 60_000, last: 90 * 60_000, rounds: 2, coins: 10, top: [{ id: "8001", name: "Famous Fan", coins: 10 }], heard: ["famous.one"] });
      expect((await live.overlayFor(key, now))?.supporters).toEqual([]);
      expect(await live.lastLiveOf(K, now)).toEqual({ verified: false });
      // nobody else sees K's
      expect(await live.lastLiveOf(N, now)).toBeNull();
    });

    it("hides viewers' names with one tap, and saving the other settings never undoes it", async () => {
      const { DEFAULT_SETTINGS } = await import("@/lib/live/settings");
      await live.saveLiveSettings(K, { ...DEFAULT_SETTINGS, vote: false, roundSeconds: 120 });
      await live.setHideNames(K, true);
      expect((await live.overlayFor(key, now))?.settings).toMatchObject({ hideNames: true, vote: false, roundSeconds: 120 });
      // the settings form sends back what it loaded with, so its hideNames can be out of date: the tap stands
      await live.saveLiveSettings(K, { ...DEFAULT_SETTINGS, vote: true, hideNames: false });
      expect((await live.liveSettingsOf(K)).settings).toMatchObject({ hideNames: true, vote: true });
      await live.setHideNames(K, false);
      expect((await live.overlayFor(key, now))?.settings).toMatchObject({ hideNames: false, vote: true });
      // a new account's tap keeps the defaults for everything else, and isn't setting up the game
      await live.setHideNames(N, true);
      expect(await live.liveSettingsOf(N)).toEqual({ settings: { ...DEFAULT_SETTINGS, hideNames: true }, saved: true });
      const home = await import("@/lib/server/home");
      expect((await home.homeData(N)).liveSetUp).toBe(false);
      await live.saveLiveSettings(N, (await live.liveSettingsOf(N)).settings);
      expect((await home.homeData(N)).liveSetUp).toBe(true);
    });

    it("links each LIVE's recap to its own page, and names no viewer in it", async () => {
      const notes = await import("@/lib/server/notify");
      const done = await live.recapLives(now);
      expect(done).toContain(`recap for ${ids.verified}`);
      const recaps = (await notes.notificationsOf(K)).items.filter((n) => n.kind === "live");
      // the one going now and the one nobody played in get none yet
      expect(recaps.map((n) => n.href).sort()).toEqual([`/app/live/${ids.verified}`, `/app/live/${ids.theirs}`].sort());
      expect(recaps.find((n) => n.href === `/app/live/${ids.verified}`)).toMatchObject({
        title: "LIVE recap: 12 rounds, 3,000 gift coins seen",
        body: "4 playing at once. Your recap card is ready.",
      });
      for (const n of recaps) for (const name of [...top.map((g) => g.name), "Famous Fan"]) expect(`${n.title} ${n.body}`).not.toContain(name.split(" ")[0]);
    });

    it("shows a streamer one of their LIVEs on its own, and nobody else", async () => {
      const s = await live.sessionOf(K, ids.verified);
      expect(s).toMatchObject({ id: ids.verified, rounds: 12, coins: 3000, peakPlayers: 4, heard: ["k.streams"], unknown: false, verified: true, topGifters: top });
      expect(s?.lastAt).toEqual(ago(2 * 3600_000));
      expect((await live.sessionsOf(K)).find((x) => x.id === ids.verified)).toEqual(s);
      expect(await live.sessionOf(N, ids.verified)).toBeNull();
      expect(await live.sessionOf(K, "00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("counts a LIVE that reloads split into sessions as one, so nobody is welcomed back to the LIVE they're giving in", async () => {
      const rKey = await live.overlayKeyOf(R);
      const fan = (id: string, coins: number) => [{ id, name: `Fan ${id}`, coins }];
      await session({ user: R, start: 26 * 3600_000, last: 25 * 3600_000, rounds: 10, coins: 2000, top: top.slice(0, 3), heard: ["r.streams"], verified: true });
      // today's LIVE, reloaded twice: each part begins a minute after the one before last heard anything, and the newest is going
      await session({ user: R, start: 70 * 60_000, last: 50 * 60_000, rounds: 8, coins: 900, top: fan("9101", 900), heard: ["r.streams"], verified: true });
      await session({ user: R, start: 49 * 60_000, last: 25 * 60_000, rounds: 5, coins: 300, top: fan("9102", 300), heard: ["r.streams"], verified: true });
      await session({ user: R, start: 24 * 60_000, last: 2 * 60_000, rounds: 3, coins: 40, top: fan("9103", 40), heard: ["r.streams"], verified: true });
      // its first two parts are over, but they're the LIVE now going, not the last one: that's still yesterday's
      expect((await live.overlayFor(rKey, now))?.supporters).toEqual(["7001", "7002", "7003"]);
      // one more reload just before the end, with nothing played after it: once it's all over, its last part with rounds is the last LIVE
      await session({ user: R, start: 60_000, last: 30_000 });
      const later = new Date(now.getTime() + 3600_000);
      expect((await live.overlayFor(rKey, later))?.supporters).toEqual(["9103"]);
      expect(await live.lastLiveOf(R, later)).toEqual({ verified: true });
    });
  });

  // wave 2: quota
  describe("quota: every YouTube call counted", () => {
    let quota: typeof import("@/lib/server/quota");
    let yt: typeof import("@/lib/server/youtube");
    let seal: (s: string) => string;
    /** everyone the test running now made, deleted once it's done, so nothing it leaves is due when the next one posts */
    const made: string[] = [];
    let count = 0;
    /**
     * A moment in Pacific time, on quota days of these tests' own, years from any other test's: 2031 for counting, and early
     * 2019 for posting and Trends, before every other test's times, so nobody else's Shorts are due then. /admin's report
     * uses January 2033, and for when counting began, a January a year before anything else was counted. All before the
     * clocks go forward, so UTC-8.
     */
    const pacific = (date: string, time: string) => new Date(`${date}T${time}:00-08:00`);
    /** YouTube's answer once an allowance is used up */
    const usedUp = () => new Response(JSON.stringify({
      error: { code: 403, message: "The request cannot be completed because you have exceeded your quota.", errors: [{ reason: "quotaExceeded" }] },
    }), { status: 403 });

    /** Someone new on Pro, with a YouTube channel Hookline holds a working token for. */
    const someone = async () => {
      const email = `w2-quota-${++count}@test.local`;
      const [{ id: user }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values (${email}) returning id`);
      made.push(user);
      const [c] = await db.admin(async (tx) => {
        await tx`insert into public.subscriptions (user_id, plan, status) values (${user}, 'pro', 'active')`;
        return tx<{ id: string }[]>`
          insert into public.channels (user_id, platform, external_id, title, made_for_kids) values (${user}, 'youtube', ${`UCw2quota${count}`}, 'Counted', false) returning id`;
      });
      await db.admin((tx) => tx`insert into public.channel_tokens (channel_id, access_token, expires_at) values (${c.id}, ${seal(`ya29.${email}`)}, now() + interval '1 hour')`);
      return { user, channel: c.id };
    };

    /** The ledger's rows for a quota day. */
    const counted = (day: string) => db.admin((tx) => tx<{ bucket: string; kind: string; units: number; calls: number; ran_out_at: Date | null; full_at: Date | null }[]>`
      select bucket, kind, units, calls, ran_out_at, full_at from public.youtube_quota where day = ${day} order by bucket, kind`);

    /** What a kind has used of an allowance on a quota day, as if those calls had been made. */
    const used = (day: string, bucket: string, kind: string, units: number) => db.admin((tx) => tx`
      insert into public.youtube_quota (day, bucket, kind, units, calls) values (${day}, ${bucket}, ${kind}, ${units}, ${units})
      on conflict (day, bucket, kind) do update set units = excluded.units, calls = excluded.calls`);

    /** Someone new on a plan, with one of the founder's test channels (Hookline uploads to those before YouTube's audit), answered as not made for kids. */
    const uploader = async (plan: "pro" | "creator" = "pro", privacy: "public" | "unlisted" = "public") => {
      const email = `w2-quota-${++count}@test.local`;
      const [{ id: user }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values (${email}) returning id`);
      made.push(user);
      const [c] = await db.admin(async (tx) => {
        await tx`insert into public.subscriptions (user_id, plan, status) values (${user}, ${plan}, 'active')`;
        return tx<{ id: string }[]>`
          insert into public.channels (user_id, platform, external_id, title, made_for_kids, privacy) values (${user}, 'youtube', ${TEST_CHANNEL}, 'Uploads', false, ${privacy}) returning id`;
      });
      await db.admin((tx) => tx`insert into public.channel_tokens (channel_id, access_token, expires_at) values (${c.id}, ${seal(`ya29.${email}`)}, now() + interval '1 hour')`);
      return { user, channel: c.id, email };
    };

    /** A Short of theirs, rendered, ready to go up for its time. */
    const ready = async (u: { user: string; channel: string }, title: string, at: Date) => (await db.admin((tx) => tx<{ id: string }[]>`
      insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path)
      values (${u.user}, ${u.channel}, 'wyr', '{"pairs":[]}', 'wyr', ${title}, 'ready', now(), ${at}, 'w2q/ready.mp4') returning id`))[0].id;

    /** Where a Short is, and what it's waiting for. */
    const state = async (id: string) => (await db.admin((tx) => tx<{ status: string; youtube_id: string | null; waiting_on: string | null; waiting_until: Date | null; error: string | null }[]>`
      select status, youtube_id, waiting_on, waiting_until, error from public.videos where id = ${id}`))[0];

    /** An account's uploads and link checks on a quota day, as the server counted them, or as if it had. */
    const accountDay = async (user: string, day: string) => (await db.admin((tx) => tx<{ uploads: number; link_checks: number }[]>`
      select uploads, link_checks from public.youtube_account_days where user_id = ${user} and day = ${day}`))[0];
    const hadToday = (user: string, day: string, uploads: number, linkChecks = 0) => db.admin((tx) => tx`
      insert into public.youtube_account_days (day, user_id, uploads, link_checks) values (${day}, ${user}, ${uploads}, ${linkChecks})`);

    /** What YouTube's upload is asked for while a test lasts, without the real upload. */
    const uploading = () => {
      const seen: { title: string; publishAt: Date | null }[] = [];
      onTestFinished(() => void upload.mockReset());
      upload.mockReset();
      upload.mockImplementation(async (...a) => {
        const meta = a[2] as { title: string; publishAt: Date | null };
        seen.push({ title: meta.title, publishAt: meta.publishAt });
        return `w2qup${seen.length}`;
      });
      return seen;
    };

    /** YouTube's side of the real upload, counted like any other: the titles of the Shorts it was asked to take. */
    const youtubeUploads = () => {
      upload.mockReset();
      const titles: string[] = [];
      stubFetch((u, init) => {
        if (u.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
          titles.push((JSON.parse(String(init?.body)) as { snippet: { title: string } }).snippet.title);
          return new Response("{}", { status: 200, headers: { location: `https://upload.test/w2q${titles.length}` } });
        }
        if (u.startsWith("https://upload.test/w2q")) return { id: `w2qreal${u.slice("https://upload.test/w2q".length)}` };
        return { items: [] };
      });
      return titles;
    };

    beforeAll(async () => {
      if (!safe) return;
      quota = await import("@/lib/server/quota");
      yt = await import("@/lib/server/youtube");
      seal = (await import("@/lib/server/crypto")).seal;
    });

    afterEach(async () => {
      if (!safe || !made.length) return;
      const gone = made.splice(0);
      await db.admin((tx) => tx`delete from auth.users where id = any(${gone}::uuid[])`);
    });

    afterAll(async () => {
      if (!safe) return;
      await db.admin((tx) => tx`delete from public.youtube_quota where day between '2031-01-01' and '2031-12-31' or day between '2019-01-01' and '2019-12-31'`);
    });

    it("counts every YouTube call before it's made, by quota day, allowance and kind, with its calls and units", async () => {
      const { user, channel } = await someone();
      const now = pacific("2031-03-03", "11:00");
      const ids = (n: number) => Array.from({ length: n }, (_, i) => `w2q${String(i).padStart(8, "0")}`);
      const calls = stubFetch((u) => {
        if (u.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) return new Response("{}", { status: 200, headers: { location: "https://upload.test/w2q" } });
        if (u === "https://upload.test/w2q") return { id: "w2qupload01" };
        if (new URL(u).pathname.endsWith("/channels")) return { items: [{ id: "UCw2qchannel", snippet: { title: "Counted" }, status: { madeForKids: false } }] };
        return { items: [] };
      });
      // a check of 120 videos is three calls of 50, counted together before the first
      await yt.youtubeVideoStates(ids(120), { kind: "checks", now });
      // posting's own check after an upload, asked as the channel
      await yt.youtubeVideoStates(ids(3), { access: "ya29.w2q", kind: "uploads", now });
      await yt.youtubeViews(ids(51), { now });
      expect((await yt.youtubeChannel("ya29.w2q", now)).externalId).toBe("UCw2qchannel");
      await yt.youtubeGet("trends", "search.list", "search", { part: "snippet", q: "w2q" }, { now, what: "Searching YouTube" });
      expect(await yt.youtubeUpload(channel, Buffer.from("video"), { title: "Counted", description: "", publishAt: null, privacy: "public", madeForKids: false }, now)).toBe("w2qupload01");
      expect(calls).toHaveLength(3 + 1 + 2 + 1 + 1 + 2);
      const open = { ran_out_at: null, full_at: null };
      expect(await counted("2031-03-03")).toEqual([
        { bucket: "searches", kind: "trends", units: 1, calls: 1, ...open },
        { bucket: "units", kind: "checks", units: 3, calls: 3, ...open },
        { bucket: "units", kind: "other", units: 1, calls: 1, ...open },
        { bucket: "units", kind: "stats", units: 2, calls: 2, ...open },
        { bucket: "units", kind: "uploads", units: 1, calls: 1, ...open },
        { bucket: "uploads", kind: "uploads", units: 1, calls: 1, ...open },
      ]);

      // what each kind used today and the most it may: posting has no share of its own, so whatever's left is its
      const units = await quota.usageToday("units", now);
      expect(units).toMatchObject({ day: "2031-03-03", limit: 10_000, used: 7, full: false });
      expect(units.kinds.checks).toEqual({ used: 3, cap: 3000 });
      expect(units.kinds.live).toEqual({ used: 0, cap: 2500 });
      expect(units.kinds.uploads).toEqual({ used: 1, cap: null });
      // and what /admin reads
      const today = await quota.quotaToday(now);
      expect(today).toMatchObject({ day: "2031-03-03", resetsAt: pacific("2031-03-04", "00:05") });
      const all = today.buckets.find((b) => b.bucket === "units")!;
      expect(all).toMatchObject({ limit: 10_000, used: 7, held: 2000, fullAt: null, ranOutAt: null });
      expect(all.kinds.map((k) => [k.kind, k.units, k.cap])).toEqual([
        ["uploads", 1, null], ["checks", 3, 3000], ["stats", 2, 1500], ["trends", 0, 500], ["other", 1, 500], ["live", 0, 2500],
      ]);
      expect(today.buckets.find((b) => b.bucket === "analytics")).toMatchObject({ limit: null, used: 0, held: null });
      expect(today.week.at(-1)).toEqual({ day: "2031-03-03", used: { units: 7, uploads: 1, searches: 1, analytics: 0 }, full: [] });

      // each account's uploads and link checks, counted by the server alone, and kept for a week
      await db.admin((tx) => tx`insert into public.youtube_account_days (day, user_id, uploads) values ('2031-02-23', ${user}, 4), ('2031-02-24', ${user}, 2)`);
      await db.admin((tx) => quota.countUpload(tx, user, now));
      await db.admin((tx) => quota.countUpload(tx, user, now));
      expect(await quota.takeLinkCheck(user, now)).toBe(true);
      expect(await db.admin((tx) => tx`select day::text as day, uploads, link_checks from public.youtube_account_days where user_id = ${user} order by day`)).toEqual([
        { day: "2031-02-24", uploads: 2, link_checks: 0 },
        { day: "2031-03-03", uploads: 2, link_checks: 1 },
      ]);
      // fifty link checks a day, then none until the reset
      for (let i = 1; i < 50; i++) expect(await quota.takeLinkCheck(user, now)).toBe(true);
      expect(await quota.takeLinkCheck(user, now)).toBe(false);
      expect(await quota.takeLinkCheck(user, pacific("2031-03-04", "00:06"))).toBe(true);
    });

    it("gives up on a counted call YouTube doesn't answer in time, which passes like an outage", async () => {
      const now = pacific("2031-03-02", "12:00");
      const calls = stubFetch(() => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      });
      const err = await yt.youtubeGet("live", "liveBroadcasts.list", "liveBroadcasts", { part: "snippet" }, { access: "ya29.w2q", now, what: "Finding the stream", timeoutMs: 8000 })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(yt.YouTubeError);
      expect(err).toMatchObject({ status: 0, reason: "timeout" });
      expect((err as InstanceType<typeof yt.YouTubeError>).retry).toBe(true);
      expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
      // counted all the same, at what a stream's call costs
      expect(await counted("2031-03-02")).toEqual([{ bucket: "units", kind: "live", units: 5, calls: 1, ran_out_at: null, full_at: null }]);
    });

    it("never lets calls at once go past a share or the allowance, and keeps posting's part whatever the others use", async () => {
      const day = "2031-03-04";
      const now = pacific(day, "09:00");
      // five units left of Trends' 500: twenty at once, and exactly five go through
      await used(day, "units", "trends", 495);
      const tries = await Promise.allSettled(Array.from({ length: 20 }, () => quota.spend("trends", "videos.list", { now })));
      expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(5);
      const refused = tries.flatMap((t) => (t.status === "rejected" ? [t.reason as unknown] : []));
      expect(refused).toHaveLength(15);
      for (const e of refused) {
        expect(e).toBeInstanceOf(quota.QuotaWait);
        expect(e).toMatchObject({ bucket: "units", kind: "trends", google: false, until: pacific("2031-03-05", "00:05") });
      }
      expect((await counted(day)).find((r) => r.kind === "trends")).toMatchObject({ units: 500, calls: 500, ran_out_at: now, full_at: null });

      // views, link checks, connecting and YouTube Live at their shares too: posting's checks still go, and none of theirs do
      await used(day, "units", "stats", 1500);
      await used(day, "units", "checks", 3000);
      await used(day, "units", "other", 500);
      await used(day, "units", "live", 2500);
      const later = pacific(day, "10:00");
      await quota.spend("uploads", "videos.list", { times: 3, now: later });
      for (const kind of ["trends", "stats", "checks", "other", "live"] as const) {
        await expect(quota.spend(kind, "videos.list", { now: later })).rejects.toBeInstanceOf(quota.QuotaWait);
      }
      // Trends first ran out at nine, and that stays
      expect((await counted(day)).find((r) => r.kind === "trends")?.ran_out_at).toEqual(now);
      // the last unit goes to posting, and a batch that wouldn't fit isn't counted at all
      await used(day, "units", "uploads", 1999);
      await expect(quota.spend("uploads", "videos.list", { times: 2, now: later })).rejects.toMatchObject({ google: false });
      await quota.spend("uploads", "videos.list", { now: later });
      await expect(quota.spend("uploads", "videos.list", { now: later })).rejects.toBeInstanceOf(quota.QuotaWait);
      expect((await counted(day)).reduce((n, r) => n + r.units, 0)).toBe(10_000);
    });

    it("closes an allowance for the rest of its quota day once YouTube says it's used up, whatever Hookline counted", async () => {
      const day = "2031-03-05";
      const noon = pacific(day, "12:00");
      const calls = stubFetch(() => usedUp());
      const err = await yt.youtubeVideoStates(["w2qfull0001"], { kind: "checks", now: noon }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(yt.YouTubeError);
      expect((err as InstanceType<typeof yt.YouTubeError>).quota).toBe(true);
      expect((await counted(day)).find((r) => r.kind === "checks")).toMatchObject({ bucket: "units", units: 1, calls: 1, full_at: noon });
      // every kind of the units waits for the reset now, without asking YouTube
      const one = pacific(day, "13:00");
      const wait = await quota.spend("stats", "videos.list", { now: one }).catch((e: unknown) => e);
      expect(wait).toBeInstanceOf(quota.QuotaWait);
      expect(wait).toMatchObject({ bucket: "units", kind: "stats", google: true, until: pacific("2031-03-06", "00:05") });
      await expect(yt.youtubeViews(["w2qfull0001"], { now: one })).rejects.toBeInstanceOf(quota.QuotaWait);
      expect(calls).toHaveLength(1);
      expect((await quota.usageToday("units", one)).full).toBe(true);
      // the uploads are another allowance, still open
      await quota.spend("uploads", "videos.insert", { now: one });
      // and the next quota day starts at 00:05 Pacific with the units open again
      await quota.spend("stats", "videos.list", { now: pacific("2031-03-06", "00:06") });
      expect((await quota.usageToday("units", pacific("2031-03-06", "00:06"))).full).toBe(false);
    });

    it("counts a refusal in the five minutes after midnight Pacific against the day before, so it waits only until 00:05", async () => {
      const { channel } = await someone();
      const early = pacific("2031-03-08", "00:02");
      const calls = stubFetch((u) => (u.startsWith("https://www.googleapis.com/upload/youtube/v3/videos") ? usedUp() : new Response("{}", { status: 500 })));
      const err = await yt.youtubeUpload(channel, Buffer.from("video"), { title: "Early", description: "", publishAt: null, privacy: "public", madeForKids: false }, early)
        .catch((e: unknown) => e);
      expect((err as InstanceType<typeof yt.YouTubeError>).quota).toBe(true);
      expect(calls).toHaveLength(1);
      // the upload and YouTube's word both belong to the day before, which runs to 00:05
      expect(await counted("2031-03-07")).toEqual([{ bucket: "uploads", kind: "uploads", units: 1, calls: 1, ran_out_at: null, full_at: early }]);
      expect(await counted("2031-03-08")).toEqual([]);
      const wait = await quota.spend("uploads", "videos.insert", { now: pacific("2031-03-08", "00:03") }).catch((e: unknown) => e);
      expect(wait).toMatchObject({ bucket: "uploads", google: true, until: pacific("2031-03-08", "00:05") });
      // from 00:05 it's a new day, with nothing closed
      await quota.spend("uploads", "videos.insert", { now: pacific("2031-03-08", "00:06") });
      expect(await counted("2031-03-08")).toEqual([{ bucket: "uploads", kind: "uploads", units: 1, calls: 1, ran_out_at: null, full_at: null }]);
    });

    it("says when a pasted link can be checked once there's no quota left today to ask with, and marks nothing", async () => {
      const { user, channel } = await someone();
      const [{ id: short }] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, file_path)
        values (${user}, ${channel}, 'wyr', '{"pairs":[]}', 'wyr', 'Posted by hand', 'ready', now(), 'w2q/hand.mp4') returning id`);
      const calls = stubFetch(() => ({ items: [] }));
      // Hookline's count: the day's link checks are used up
      const now = pacific("2031-03-01", "11:00");
      await used("2031-03-01", "units", "checks", 3000);
      expect(await queue.markPosted(user, short, "https://youtube.com/shorts/w2qwaiting1", undefined, now)).toEqual({
        ok: false, message: "Hookline has used today's YouTube link checks, so this one can't be checked yet. Try again in about 13 hours, or leave the link out.",
      });
      // YouTube's word: the units are used up for everyone
      const evening = pacific("2031-02-28", "21:00");
      await quota.closeForToday("videos.list", "stats", evening);
      expect(await queue.markPosted(user, short, "https://youtube.com/shorts/w2qwaiting1", undefined, evening)).toEqual({
        ok: false, message: "YouTube's quota for Hookline is used up for today, so the link can't be checked yet. Try again in about 3 hours, or leave the link out.",
      });
      expect(calls).toHaveLength(0);
      expect((await db.admin((tx) => tx<{ status: string; youtube_id: string | null }[]>`select status, youtube_id from public.videos where id = ${short}`))[0])
        .toEqual({ status: "ready", youtube_id: null });
    });

    it("lets nobody signed in read or change the ledger or an account's counts, and everyone read how fresh Trends is", async () => {
      const { user } = await someone();
      await db.admin(async (tx) => {
        await tx`insert into public.youtube_account_days (day, user_id, uploads) values ('2031-03-03', ${user}, 1)`;
        await tx`insert into public.trend_checks (niche, tried_at, next_at) values ('w2q-niche', now(), now())`;
      });
      const refused: ((tx: import("@/lib/server/db").Tx) => Promise<unknown>)[] = [
        (tx) => tx`select * from public.youtube_quota`,
        (tx) => tx`insert into public.youtube_quota (day, bucket, kind) values ('2031-03-03', 'units', 'trends')`,
        (tx) => tx`update public.youtube_quota set units = 0`,
        (tx) => tx`delete from public.youtube_quota`,
        (tx) => tx`select * from public.youtube_account_days`,
        (tx) => tx`insert into public.youtube_account_days (day, user_id) values ('2031-03-04', ${user})`,
        (tx) => tx`update public.youtube_account_days set uploads = 0`,
        (tx) => tx`delete from public.youtube_account_days`,
        (tx) => tx`insert into public.trend_checks (niche, tried_at, next_at) values ('w2q-mine', now(), now())`,
        (tx) => tx`update public.trend_checks set next_at = now()`,
        (tx) => tx`delete from public.trend_checks`,
      ];
      for (const q of refused) await expect(db.asUser(user, q)).rejects.toThrow(/permission denied/);
      expect(await db.asUser(user, (tx) => tx`select niche from public.trend_checks where niche = 'w2q-niche'`)).toEqual([{ niche: "w2q-niche" }]);
      expect(await db.admin((tx) => tx`select uploads from public.youtube_account_days where user_id = ${user}`)).toEqual([{ uploads: 1 }]);
      await db.admin((tx) => tx`delete from public.trend_checks where niche = 'w2q-niche'`);
    });

    it("waits for the reset without asking YouTube once Hookline has counted the day's uploads, and uploads them after it", async () => {
      const u = await uploader();
      const now = pacific("2019-02-25", "15:00");
      const reset = pacific("2019-02-26", "00:05");
      const ids = [await ready(u, "First", new Date(now.getTime() + 2 * 3600_000)), await ready(u, "Second", new Date(now.getTime() + 3 * 3600_000))];
      // everyone's 100 for the day, by Hookline's own count
      await used("2019-02-25", "uploads", "uploads", 100);
      const asked = youtubeUploads();
      await post.postDue(now);
      expect(asked).toEqual([]);
      for (const id of ids) expect(await state(id)).toEqual({ status: "ready", youtube_id: null, waiting_on: "youtube_quota", waiting_until: reset, error: null });
      // the try that found no room is written down, for /admin
      expect((await counted("2019-02-25")).find((r) => r.bucket === "uploads")).toMatchObject({ units: 100, ran_out_at: now, full_at: null });
      // a minute later nothing is asked
      await post.postDue(new Date(now.getTime() + 60_000));
      expect(asked).toEqual([]);
      // from 00:05 Pacific it's a new day: they go up, stop waiting, and are the account's first two
      await post.postDue(new Date(reset.getTime() + 60_000));
      expect(asked).toEqual(["First", "Second"]);
      for (const id of ids) expect(await state(id)).toMatchObject({ status: "scheduled", youtube_id: expect.stringMatching(/^w2qreal/), waiting_on: null, waiting_until: null });
      expect(await counted("2019-02-26")).toEqual([{ bucket: "uploads", kind: "uploads", units: 2, calls: 2, ran_out_at: null, full_at: null }]);
      expect(await accountDay(u.user, "2019-02-26")).toEqual({ uploads: 2, link_checks: 0 });
    });

    it("uploads a Pro account's 6 in a quota day, says the rest wait for its plan's next uploads, and lets them go once the plan has room", async () => {
      const lib = await import("@/lib/server/shorts/library");
      const u = await uploader("pro");
      const now = pacific("2019-02-20", "09:00");
      const reset = pacific("2019-02-21", "00:05");
      const ids: string[] = [];
      for (let h = 1; h <= 7; h++) ids.push(await ready(u, `Hour ${h}`, new Date(now.getTime() + h * 3600_000)));
      const seen = uploading();
      stubFetch(() => ({ items: [] }));
      await post.postDue(now, 100);
      expect(seen.map((x) => x.title)).toEqual(["Hour 1", "Hour 2", "Hour 3", "Hour 4", "Hour 5", "Hour 6"]);
      expect(await accountDay(u.user, "2019-02-20")).toEqual({ uploads: 6, link_checks: 0 });
      // the seventh says why, until the reset
      expect(await state(ids[6])).toEqual({ status: "ready", youtube_id: null, waiting_on: "plan_cap", waiting_until: reset, error: null });
      await post.postDue(new Date(now.getTime() + 60_000), 100);
      expect(seen).toHaveLength(6);
      // with its reset still to come (this one's was long ago), the queue and the Short's page say so
      const until = new Date(Date.now() + 3600_000);
      await db.admin((tx) => tx`update public.videos set waiting_until = ${until} where id = ${ids[6]}`);
      expect((await queue.queueOf(u.user)).coming.find((c) => c.id === ids[6])?.heldBack).toEqual({ on: "plan_cap", until });
      expect((await lib.shortOf(u.user, ids[6]))?.heldBack).toEqual({ on: "plan_cap", until });

      // on Creator there's room again: the wait ends and it goes up in the same run
      await db.admin((tx) => tx`update public.subscriptions set plan = 'creator' where user_id = ${u.user}`);
      await post.postDue(new Date(now.getTime() + 2 * 60_000), 100);
      expect(seen.map((x) => x.title).at(-1)).toBe("Hour 7");
      expect(await state(ids[6])).toMatchObject({ status: "scheduled", waiting_on: null, waiting_until: null });
      expect(await accountDay(u.user, "2019-02-20")).toEqual({ uploads: 7, link_checks: 0 });
    });

    it("counts each account's uploads on the server, so changing or deleting its own Shorts frees no room", async () => {
      const u = await uploader("pro");
      const now = pacific("2019-02-17", "09:00");
      for (let h = 1; h <= 6; h++) await ready(u, `Hour ${h}`, new Date(now.getTime() + h * 3600_000));
      const seen = uploading();
      stubFetch(() => ({ items: [] }));
      await post.postDue(now, 100);
      expect(seen).toHaveLength(6);
      // as the account itself: half look as if they never went up, and the rest are gone
      const up = (await db.admin((tx) => tx<{ id: string }[]>`select id from public.videos where user_id = ${u.user} and youtube_id is not null order by scheduled_for`)).map((v) => v.id);
      expect(await db.asUser(u.user, (tx) => tx`update public.videos set uploaded_at = null where id in ${tx(up.slice(0, 3))} returning id`)).toHaveLength(3);
      expect(await db.asUser(u.user, (tx) => tx`delete from public.videos where id in ${tx(up.slice(3))} returning id`)).toHaveLength(3);
      const more = await ready(u, "Hour 8", new Date(now.getTime() + 8 * 3600_000));
      await post.postDue(new Date(now.getTime() + 60_000), 100);
      expect(seen).toHaveLength(6);
      expect(await state(more)).toMatchObject({ status: "ready", waiting_on: "plan_cap" });
    });

    it("gives the day's last upload to the account with the fewest today, even when another's Short is due sooner", async () => {
      const day = "2019-02-14";
      const now = pacific(day, "20:00");
      const busy = await uploader();
      const fresh = await uploader();
      await hadToday(busy.user, day, 3);
      const sooner = await ready(busy, "Busy's", pacific(day, "21:00"));
      await ready(fresh, "Fresh's", pacific(day, "22:00"));
      // one left of everyone's 100
      await used(day, "uploads", "uploads", 99);
      const asked = youtubeUploads();
      await post.postDue(now);
      expect(asked).toEqual(["Fresh's"]);
      expect(await state(sooner)).toMatchObject({ status: "ready", waiting_on: "youtube_quota", waiting_until: pacific("2019-02-15", "00:05") });
    });

    it("gives the day's last upload to a Short due before the reset over one due after it, whoever has had more today", async () => {
      const day = "2019-02-11";
      const now = pacific(day, "20:00");
      const busy = await uploader();
      const fresh = await uploader();
      await hadToday(busy.user, day, 3);
      await ready(busy, "Tonight", pacific(day, "23:00"));
      const morning = await ready(fresh, "Tomorrow morning", pacific("2019-02-12", "06:00"));
      await used(day, "uploads", "uploads", 99);
      const asked = youtubeUploads();
      await post.postDue(now);
      expect(asked).toEqual(["Tonight"]);
      expect(await state(morning)).toMatchObject({ status: "ready", waiting_on: "youtube_quota" });
    });

    it("leaves an account at its plan's uploads out of the line, however many it has ready", async () => {
      const day = "2019-02-08";
      const now = pacific(day, "10:00");
      const full = await uploader();
      const other = await uploader();
      await hadToday(full.user, day, 6);
      await db.admin((tx) => tx`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path)
        select ${full.user}, ${full.channel}, 'wyr', '{"pairs":[]}', 'wyr', 'One of many', 'ready', now(), ${now}::timestamptz + make_interval(mins => g), 'w2q/many.mp4'
        from generate_series(1, 200) g`);
      await ready(other, "Theirs", new Date(now.getTime() + 5 * 3600_000));
      const seen = uploading();
      stubFetch(() => ({ items: [] }));
      await post.postDue(now);
      expect(seen.map((x) => x.title)).toEqual(["Theirs"]);
      // and every one of the 200 says it's waiting for the plan's next uploads
      expect(await db.admin((tx) => tx`select waiting_on, count(*)::int as n from public.videos where user_id = ${full.user} group by waiting_on`)).toEqual([{ waiting_on: "plan_cap", n: 200 }]);
    });

    it("uploads a public Short at most a day before its time, and an unlisted one at its time", async () => {
      const now = pacific("2019-02-01", "12:00");
      const pub = await uploader("pro", "public");
      const unl = await uploader("pro", "unlisted");
      const due = new Date(now.getTime() + 72 * 3600_000);
      await ready(pub, "In three days", due);
      await ready(unl, "Unlisted now", new Date(now.getTime() + 10 * 60_000));
      await ready(unl, "Unlisted later", new Date(now.getTime() + 5 * 3600_000));
      const seen = uploading();
      stubFetch((url) => ({
        items: (new URL(url).searchParams.get("id") ?? "").split(",").map((id) => ({ id, snippet: { channelId: TEST_CHANNEL }, status: { uploadStatus: "processed", privacyStatus: "unlisted" } })),
      }));
      await post.postDue(now);
      expect(seen).toEqual([{ title: "Unlisted now", publishAt: null }]);
      // 25 hours before its time the public one still waits, and the unlisted one goes now its time has passed
      await post.postDue(new Date(due.getTime() - 25 * 3600_000));
      expect(seen.slice(1)).toEqual([{ title: "Unlisted later", publishAt: null }]);
      // 23 hours before, it goes up private, to go public at its time
      await post.postDue(new Date(due.getTime() - 23 * 3600_000));
      expect(seen.slice(2)).toEqual([{ title: "In three days", publishAt: due }]);
    });

    it("tries an upload that failed again in half an hour, not every minute, saying what went wrong and not that it's waiting, while TikTok still gets it", async () => {
      const now = pacific("2019-01-28", "12:00");
      const u = await uploader();
      const [tt] = await db.admin((tx) => tx<{ id: string }[]>`insert into public.channels (user_id, platform, external_id, title) values (${u.user}, 'tiktok', ${`w2q-tt-${u.user}`}, 'TikTok') returning id`);
      await db.admin((tx) => tx`insert into public.channel_tokens (channel_id, access_token, expires_at) values (${tt.id}, ${seal("act.w2q")}, now() + interval '1 hour')`);
      const choices = { privacy: "SELF_ONLY", comment: false, duet: false, stitch: false, disclose: false, yourBrand: false, branded: false };
      const due = new Date(now.getTime() - 60_000);
      const [{ id }] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path, clean_path, tiktok_post, tiktok_at)
        values (${u.user}, ${u.channel}, 'wyr', '{"pairs":[]}', 'wyr', 'Tried again', 'ready', now(), ${due}, 'w2q/again.mp4', 'w2q/again-clean.mp4', ${tx.json(choices)}, ${due})
        returning id`);
      upload.mockReset();
      let down = true;
      const tries: string[] = [];
      stubFetch((url) => {
        if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
          tries.push(url);
          return down ? new Response("{}", { status: 500 }) : new Response("{}", { status: 200, headers: { location: "https://upload.test/w2qagain" } });
        }
        if (url === "https://upload.test/w2qagain") return { id: "w2qagain001" };
        if (url.endsWith("/post/publish/creator_info/query/")) return { data: { creator_nickname: "w2q", privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } };
        if (url.endsWith("/post/publish/video/init/")) return { data: { publish_id: "w2q-pub", upload_url: "https://tiktok.test/w2q" }, error: { code: "ok" } };
        if (url === "https://tiktok.test/w2q") return {};
        return { items: [] };
      });
      await post.postDue(now);
      expect(tries).toHaveLength(1);
      const [after] = await db.admin((tx) => tx<{ status: string; error: string | null; waiting_on: string | null; waiting_until: Date | null; tiktok_publish_id: string | null }[]>`
        select status, error, waiting_on, waiting_until, tiktok_publish_id from public.videos where id = ${id}`);
      // only waiting_on makes a wait it shows
      expect(after).toMatchObject({ status: "ready", waiting_on: null, waiting_until: new Date(now.getTime() + 30 * 60_000), tiktok_publish_id: "w2q-pub" });
      expect(after.error).toMatch(/500/);
      // every try counts against everyone's uploads, which is why it isn't tried every minute
      expect((await counted("2019-01-28")).find((r) => r.bucket === "uploads")).toMatchObject({ units: 1, calls: 1 });
      await post.postDue(new Date(now.getTime() + 60_000));
      expect(tries).toHaveLength(1);
      // half an hour on it's tried again, and goes up
      down = false;
      await post.postDue(new Date(now.getTime() + 31 * 60_000));
      expect(tries).toHaveLength(2);
      expect(await state(id)).toMatchObject({ status: "scheduled", youtube_id: "w2qagain001", error: null, waiting_until: null });
      expect((await counted("2019-01-28")).find((r) => r.bucket === "uploads")).toMatchObject({ units: 2, calls: 2 });
    });

    it("gives the whole line that half hour once YouTube fails two uploads in a row, so an outage can't use up the day's, and holds nobody up for one Short's own", async () => {
      const day = "2019-01-26";
      const now = pacific(day, "12:00");
      // ten Shorts of two accounts, due within the hour, more than a run takes
      const a = await uploader("creator");
      const b = await uploader("creator");
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) ids.push(await ready(i % 2 ? b : a, `Down ${i}`, new Date(now.getTime() + (10 + i) * 60_000)));
      upload.mockReset();
      let youtube: "down" | "unreachable" | "back" = "down";
      // once it's back: one Short's upload fails on its own, and YouTube asks the next to slow down
      const hiccups = [503, 429];
      const tries: string[] = [];
      stubFetch((url) => {
        if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
          tries.push(url);
          if (youtube === "down") return new Response("{}", { status: 503 });
          if (youtube === "unreachable") throw new TypeError("fetch failed");
          const hiccup = hiccups.shift();
          if (hiccup === 503) return new Response("{}", { status: 503 });
          if (hiccup === 429) return new Response(JSON.stringify({ error: { code: 429, message: "Too many requests", errors: [{ reason: "rateLimitExceeded" }] } }), { status: 429 });
          return new Response("{}", { status: 200, headers: { location: `https://upload.test/w2qdown${tries.length}` } });
        }
        if (url.startsWith("https://upload.test/w2qdown")) return { id: url.slice("https://upload.test/".length) };
        return { items: [] };
      });
      const uploads = async () => (await counted(day)).find((r) => r.bucket === "uploads")?.units;
      const pausedTill = async (until: Date) => (await Promise.all(ids.map(state))).every((s) => s.status === "ready" && s.waiting_on === null && s.waiting_until?.getTime() === until.getTime());

      // YouTube answers 503 twice in a row: those two tries count, and every Short in line waits the same half hour, the ones never tried too
      await post.postDue(now, 4);
      expect(tries).toHaveLength(2);
      expect(await uploads()).toBe(2);
      expect(await pausedTill(new Date(now.getTime() + 30 * 60_000))).toBe(true);
      // only the two tried say what went wrong, and none says it's waiting for anything
      expect((await Promise.all(ids.map(state))).map((s) => s.error)).toEqual([expect.stringMatching(/503/), expect.stringMatching(/503/), ...Array(8).fill(null)]);
      // a minute later nothing is tried, though the run before took only four
      await post.postDue(new Date(now.getTime() + 60_000), 4);
      expect(tries).toHaveLength(2);

      // half an hour on, YouTube can't be reached at all: the same, with two more tries
      youtube = "unreachable";
      const later = new Date(now.getTime() + 31 * 60_000);
      await post.postDue(later, 4);
      expect(tries).toHaveLength(4);
      expect(await pausedTill(new Date(later.getTime() + 30 * 60_000))).toBe(true);
      expect(await state(ids[0])).toMatchObject({ error: "Starting the upload: YouTube couldn't be reached" });

      // once it's back, one that fails on its own and one YouTube asks to slow down each wait their own half hour, and the rest go up
      youtube = "back";
      const back = new Date(later.getTime() + 31 * 60_000);
      await post.postDue(back, 100);
      expect(tries).toHaveLength(14);
      for (const id of ids.slice(0, 2)) expect(await state(id)).toMatchObject({ status: "ready", youtube_id: null, waiting_on: null, waiting_until: new Date(back.getTime() + 30 * 60_000) });
      for (const id of ids.slice(2)) expect(await state(id)).toMatchObject({ status: "scheduled", youtube_id: expect.stringMatching(/^w2qdown/), error: null });
      // every try counted against everyone's uploads, and only the ones that went up against each account's
      expect(await uploads()).toBe(14);
      expect(await accountDay(a.user, day)).toEqual({ uploads: 4, link_checks: 0 });
      expect(await accountDay(b.user, day)).toEqual({ uploads: 4, link_checks: 0 });
    });

    it("asks YouTube about an upload every 4 minutes for its first half hour, then every half hour, ones whose check failed too", async () => {
      const now = pacific("2019-01-24", "12:00");
      const ago = (m: number) => new Date(now.getTime() - m * 60_000);
      const u = await uploader();
      const other = await uploader();
      const up = (who: { user: string; channel: string }, id: string, due: Date, checked: Date | null) => db.admin((tx) => tx`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, uploaded_at, file_path,
          youtube_id, youtube_verified, youtube_status, youtube_wanted, youtube_publish_at, youtube_checked_at)
        values (${who.user}, ${who.channel}, 'wyr', '{"pairs":[]}', 'wyr', ${id}, 'scheduled', now(), ${due}, ${ago(180)}, 'w2q/up.mp4',
          ${id}, true, 'uploaded', 'public', ${due}, ${checked})`);
      // two hours past their time, and ten minutes
      await up(u, "w2qlate10m", ago(120), ago(10));
      await up(u, "w2qlate31m", ago(120), ago(31));
      await up(u, "w2qsoon05m", ago(10), ago(5));
      await up(u, "w2qsoon03m", ago(10), ago(3));
      // and one on a channel YouTube won't answer for
      await up(other, "w2qrefused", ago(60), null);
      const calls = stubFetch((url, init) => {
        if (new Headers(init?.headers).get("authorization") === `Bearer ya29.${other.email}`) {
          return new Response(JSON.stringify({ error: { code: 403, message: "Forbidden", errors: [{ reason: "forbidden" }] } }), { status: 403 });
        }
        // still processing
        return { items: (new URL(url).searchParams.get("id") ?? "").split(",").map((id) => ({ id, snippet: { channelId: TEST_CHANNEL }, status: { uploadStatus: "uploaded", privacyStatus: "private" } })) };
      });
      const asked = () => calls.map((c) => new URL(c.url).searchParams.get("id")!.split(",").sort().join(",")).sort();
      await post.confirmYouTube(now);
      expect(asked()).toEqual(["w2qlate31m,w2qsoon05m", "w2qrefused"]);
      // the refused one was asked all the same, so it waits its turn like one still processing
      expect(await db.admin((tx) => tx`select youtube_checked_at from public.videos where youtube_id = 'w2qrefused'`)).toEqual([{ youtube_checked_at: now }]);
      // posting's own checks, out of what's kept for posting
      expect(await counted("2019-01-24")).toEqual([{ bucket: "units", kind: "uploads", units: 2, calls: 2, ran_out_at: null, full_at: null }]);
      calls.length = 0;
      await post.confirmYouTube(new Date(now.getTime() + 60_000));
      expect(calls).toEqual([]);
      // half an hour on, it's asked again rather than given up on
      await post.confirmYouTube(new Date(now.getTime() + 31 * 60_000));
      expect(asked().join(",").split(",")).toContain("w2qrefused");
    });

    it("checks 50 pasted links a day for each account, and says when the next can be checked", async () => {
      const day = "2019-01-20";
      const now = pacific(day, "19:00");
      const u = await uploader();
      const byHand = async (title: string) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, file_path)
        values (${u.user}, ${u.channel}, 'wyr', '{"pairs":[]}', 'wyr', ${title}, 'ready', now(), 'w2q/hand.mp4') returning id`))[0].id;
      const [fiftieth, refused, nextDay] = [await byHand("Fiftieth"), await byHand("Refused"), await byHand("Next day")];
      await hadToday(u.user, day, 0, 49);
      const look = vi.fn(async () => ({ state: { channelId: TEST_CHANNEL, uploadStatus: "processed", privacy: "public", failureReason: null, rejectionReason: null, madeForKids: false } as VideoState }));
      expect(await queue.markPosted(u.user, fiftieth, "https://youtube.com/shorts/w2qlinks050", look, now)).toEqual({ ok: true, checked: true });
      expect(await accountDay(u.user, day)).toEqual({ uploads: 0, link_checks: 50 });
      // the next isn't asked about, and says when it can be
      expect(await queue.markPosted(u.user, refused, "https://youtube.com/shorts/w2qlinks051", look, now)).toEqual({
        ok: false, message: "That's 50 links checked today, the most for one day. Try again in about 5 hours, or leave the link out.",
      });
      expect(look).toHaveBeenCalledTimes(1);
      expect(await state(refused)).toMatchObject({ status: "ready", youtube_id: null });
      // leaving the link out still works
      expect(await queue.markPosted(u.user, refused, "", look, now)).toEqual({ ok: true, checked: false });
      // and from 00:05 Pacific there are 50 more
      expect(await queue.markPosted(u.user, nextDay, "https://youtube.com/shorts/w2qlinks052", look, pacific("2019-01-21", "00:06"))).toEqual({ ok: true, checked: true });
    });

    it("doesn't ask YouTube about a channel being connected once connecting's share of the day is used up", async () => {
      const now = pacific("2019-01-16", "10:00");
      await used("2019-01-16", "units", "other", 500);
      const calls = stubFetch(() => ({ items: [] }));
      const err = await yt.youtubeChannel("ya29.w2q", now).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(quota.QuotaWait);
      expect(err).toMatchObject({ bucket: "units", kind: "other", google: false, until: pacific("2019-01-17", "00:05") });
      expect(calls).toEqual([]);
    });

    /**
     * YouTube's side of Trends: each search finds Shorts of its own niche, put up two hours before `at`. YouTube marked the
     * first of each made for kids and says nothing about the second, and ball battles' third isn't made for kids.
     */
    const trendsAnswer = (at: Date, niches: { id: string; query: string }[]) => (u: string) => {
      const url = new URL(u);
      if (url.pathname.endsWith("/search")) {
        const n = niches.find((x) => `${x.query} #shorts` === url.searchParams.get("q"))!;
        return { items: Array.from({ length: n.id === "ball-battles" ? 3 : 2 }, (_, i) => ({ id: { videoId: `w2qt-${n.id}-${i + 1}` } })) };
      }
      return {
        items: (url.searchParams.get("id") ?? "").split(",").map((id) => ({
          id,
          snippet: { title: `Rising ${id}`, channelTitle: "Someone else", publishedAt: new Date(at.getTime() - 2 * 3600_000).toISOString() },
          statistics: { viewCount: "5000" },
          contentDetails: { duration: "PT40S" },
          status: id.endsWith("-1") ? { madeForKids: true } : id.endsWith("-3") ? { madeForKids: false } : {},
        })),
      };
    };
    /** What these tests' Trends checks wrote, cleared away so no later run starts from it. */
    const forgetTrends = () => db.admin(async (tx) => {
      await tx`delete from public.trend_checks where tried_at < '2020-01-01'`;
      await tx`delete from public.trend_videos where external_id like 'w2qt-%'`;
    });
    /** Each niche's check as trend_checks has it. */
    const trendChecked = async () => new Map((await db.admin((tx) => tx<{ niche: string; checked_at: Date | null; outcome: string | null; next_at: Date }[]>`
      select niche, checked_at, outcome, next_at from public.trend_checks`)).map((r) => [r.niche, r]));

    it("checks each niche once a day with one search, keeps YouTube's made-for-kids verdict, and never searches a niche twice at once", async () => {
      const { NICHES } = await import("@/lib/trends/niches");
      onTestFinished(forgetTrends);
      const now = pacific("2019-03-02", "09:00");
      const calls = stubFetch(trendsAnswer(now, NICHES));
      const searched = () => calls.filter((c) => new URL(c.url).pathname.endsWith("/search")).map((c) => new URL(c.url).searchParams.get("q"));
      const every = NICHES.map((n) => `${n.query} #shorts`);
      await trends.refreshTrends(now);
      expect(searched()).toEqual(every);
      // the look at what each found asks for YouTube's verdict too, in the same call
      const looks = calls.filter((c) => new URL(c.url).pathname.endsWith("/videos"));
      expect(looks).toHaveLength(NICHES.length);
      for (const c of looks) expect(new URL(c.url).searchParams.get("part")).toBe("snippet,statistics,contentDetails,status");
      const checked = await trendChecked();
      for (const n of NICHES) expect(checked.get(n.id)).toEqual({ niche: n.id, checked_at: now, outcome: "found", next_at: new Date(now.getTime() + 86400_000) });
      // counted as Trends': a search and a unit for each niche
      expect((await counted("2019-03-02")).map((r) => [r.bucket, r.kind, r.units])).toEqual([["searches", "trends", NICHES.length], ["units", "trends", NICHES.length]]);
      // YouTube's own word on who each is for, kept as it said it
      expect(await db.admin((tx) => tx`select external_id, made_for_kids from public.trend_videos where external_id like 'w2qt-ball-battles-%' order by external_id`)).toEqual([
        { external_id: "w2qt-ball-battles-1", made_for_kids: true },
        { external_id: "w2qt-ball-battles-2", made_for_kids: null },
        { external_id: "w2qt-ball-battles-3", made_for_kids: false },
      ]);
      // anyone signed in sees how fresh each niche is, and each niche's made-for-kids share out of the Shorts YouTube said either way about
      const { user } = await someone();
      const fresh = new Map((await trends.trendChecks(user)).map((c) => [c.niche, c.checkedAt]));
      for (const n of NICHES) expect(fresh.get(n.id)).toEqual(now);
      expect(Object.fromEntries(await trends.kidsShare(user, ["ball-battles", "quizzes"], now))).toEqual({ "ball-battles": { kids: 1, of: 2 }, quizzes: { kids: 1, of: 1 } });

      // an hour later nothing is due, so nothing is asked
      calls.length = 0;
      await trends.refreshTrends(new Date(now.getTime() + 3600_000));
      expect(calls).toEqual([]);
      // a day later every niche is searched again, once
      await trends.refreshTrends(new Date(now.getTime() + 86400_000));
      expect(searched()).toEqual(every);
      // and two checkers at once share the niches out between them, so each is still searched once
      calls.length = 0;
      const both = new Date(now.getTime() + 2 * 86400_000);
      await Promise.all([trends.refreshTrends(both), trends.refreshTrends(both)]);
      expect(searched().sort()).toEqual([...every].sort());
    });

    it("stops a Trends run at the first niche it can't check: the rest wait for the reset when the quota is used up, or an hour when YouTube doesn't answer", async () => {
      const { NICHES } = await import("@/lib/trends/niches");
      onTestFinished(forgetTrends);
      const day = "2019-03-05";
      const now = pacific(day, "09:00");
      const reset = pacific("2019-03-06", "00:05");
      // Trends' share of the day's units is used up: the first search goes, and the look at what it found doesn't
      await used(day, "units", "trends", 500);
      const calls = stubFetch(trendsAnswer(now, NICHES));
      await trends.refreshTrends(now);
      expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/youtube/v3/search"]);
      let checked = await trendChecked();
      for (const n of NICHES) expect(checked.get(n.id)).toMatchObject({ checked_at: null, outcome: "quota", next_at: reset });
      // nothing more is searched that day
      await trends.refreshTrends(pacific(day, "15:00"));
      expect(calls).toHaveLength(1);

      // after the reset, a key YouTube refuses: one search, and every niche waits an hour rather than using up the day's searches
      const later = pacific("2019-03-07", "09:00");
      const refused = stubFetch(() => new Response(JSON.stringify({ error: { code: 403, message: "The API key is invalid.", errors: [{ reason: "keyInvalid" }] } }), { status: 403 }));
      await trends.refreshTrends(later);
      expect(refused).toHaveLength(1);
      checked = await trendChecked();
      for (const n of NICHES) expect(checked.get(n.id)).toMatchObject({ checked_at: null, outcome: "failed", next_at: new Date(later.getTime() + 3600_000) });
      await trends.refreshTrends(new Date(later.getTime() + 30 * 60_000));
      expect(refused).toHaveLength(1);
      // an hour on it tries again, with one search
      await trends.refreshTrends(new Date(later.getTime() + 3600_000));
      expect(refused).toHaveLength(2);
    });

    it("shows /admin each allowance and part's use today, what's held for posting, the Shorts waiting and the last 7 days", async () => {
      onTestFinished(async () => {
        await db.admin((tx) => tx`delete from public.youtube_quota where day between '2033-01-01' and '2033-01-31'`);
      });
      const day = "2033-01-12";
      const now = pacific(day, "15:00");
      const reset = pacific("2033-01-13", "00:05");
      // today: posting's checks, link checks at their share since two, views and Trends; uploads and searches; and Analytics, which has no limit
      await used(day, "units", "uploads", 40);
      await used(day, "units", "checks", 3000);
      await db.admin((tx) => tx`update public.youtube_quota set ran_out_at = ${pacific(day, "14:00")} where day = ${day} and kind = 'checks'`);
      await used(day, "units", "stats", 25);
      await used(day, "units", "trends", 10);
      await used(day, "uploads", "uploads", 7);
      await used(day, "searches", "trends", 10);
      await used(day, "analytics", "analytics", 3);
      // two days before, YouTube said the uploads were used up
      await used("2033-01-10", "uploads", "uploads", 60);
      await used("2033-01-10", "units", "uploads", 120);
      await db.admin((tx) => tx`update public.youtube_quota set full_at = ${pacific("2033-01-10", "18:00")} where day = '2033-01-10' and bucket = 'uploads'`);
      // Shorts waiting: two for YouTube's uploads, one for its plan's; one paused after a failed upload and one whose wait is over aren't.
      // Every account's are counted, so these are what it adds to what was there
      const before = (await quota.quotaToday(now)).waiting;
      const u = await someone();
      const held = (title: string, on: string | null, until: Date) => db.admin((tx) => tx`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, scheduled_for, file_path, waiting_on, waiting_until)
        values (${u.user}, ${u.channel}, 'wyr', '{"pairs":[]}', 'wyr', ${title}, 'ready', now(), ${reset}, 'w2q/held.mp4', ${on}, ${until})`);
      await held("Quota one", "youtube_quota", reset);
      await held("Quota two", "youtube_quota", reset);
      await held("Plan", "plan_cap", reset);
      await held("Paused", null, new Date(now.getTime() + 30 * 60_000));
      await held("Over", "youtube_quota", new Date(now.getTime() - 60_000));

      const q = await quota.quotaToday(now);
      expect(q).toMatchObject({ day, resetsAt: reset, waiting: { youtube_quota: before.youtube_quota + 2, plan_cap: before.plan_cap + 1 } });
      const of = Object.fromEntries(q.buckets.map((b) => [b.bucket, b]));
      expect(of.units).toMatchObject({ limit: 10_000, used: 3075, held: 2000, fullAt: null, ranOutAt: pacific(day, "14:00") });
      expect(of.units.kinds.map((k) => [k.kind, k.units, k.cap, k.ranOutAt])).toEqual([
        ["uploads", 40, null, null], ["checks", 3000, 3000, pacific(day, "14:00")], ["stats", 25, 1500, null],
        ["trends", 10, 500, null], ["other", 0, 500, null], ["live", 0, 2500, null],
      ]);
      expect(of.uploads).toMatchObject({ limit: 100, used: 7, held: 100, fullAt: null, ranOutAt: null });
      expect(of.searches).toMatchObject({ limit: 100, used: 10, held: 0 });
      expect(of.analytics).toMatchObject({ limit: null, used: 3, held: null });
      // the week, oldest first: the day YouTube said the uploads were used up, a day with nothing, and today
      expect(q.week.map((d) => d.day)).toEqual(["2033-01-06", "2033-01-07", "2033-01-08", "2033-01-09", "2033-01-10", "2033-01-11", "2033-01-12"]);
      expect(q.week.slice(4)).toEqual([
        { day: "2033-01-10", used: { units: 120, uploads: 60, searches: 0, analytics: 0 }, full: ["uploads"] },
        { day: "2033-01-11", used: { units: 0, uploads: 0, searches: 0, analytics: 0 }, full: [] },
        { day, used: { units: 3075, uploads: 7, searches: 10, analytics: 3 }, full: [] },
      ]);

      // counting that began part way through a day: the days before it aren't counted, never 0, and that one says from when. It has
      // to be the ledger's first row, so it goes in a year before anything else counted, whatever other tests have counted
      const [{ year }] = await db.admin((tx) => tx<{ year: number }[]>`
        select least(2001, extract(year from min(day))::int - 1, extract(year from min(created_at))::int - 1) as year from public.youtube_quota`);
      const firstDay = `${year}-01-09`;
      onTestFinished(async () => {
        await db.admin((tx) => tx`delete from public.youtube_quota where day = ${firstDay}`);
      });
      const began = pacific(firstDay, "16:20");
      await db.admin((tx) => tx`insert into public.youtube_quota (day, bucket, kind, units, calls, created_at) values (${firstDay}, 'units', 'stats', 4, 4, ${began})`);
      const first = await quota.quotaToday(pacific(`${year}-01-11`, "10:00"));
      expect(first).toMatchObject({ day: `${year}-01-11`, firstAt: began, firstDay });
      expect(first.week.map((d) => d.used?.units ?? null)).toEqual([null, null, null, null, 4, 0, 0]);
    });
  });

  // wave 2: clipper
  describe("clipper: rounds a streamer's game sends for Shorts", () => {
    type ClipLog = import("@/lib/live/clip").ClipLog;
    /** the one moment every round and job here is at */
    const now = new Date();
    const MIN = 60_000, HOUR = 3600_000, DAY = 86400_000;
    const ago = (ms: number) => new Date(now.getTime() - ms);
    let clips: typeof import("@/lib/server/clips");
    let clip: typeof import("@/lib/live/clip");
    /** S streams and sends rounds, T is someone else, F turns rounds for Shorts off, G uses Hookline for LIVE games only */
    let S = "", T = "", F = "", G = "";
    const keys = { S: "", T: "", F: "", G: "" };
    const emails = ["w2-clipper-1@test.local", "w2-clipper-2@test.local", "w2-clipper-3@test.local", "w2-clipper-4@test.local"];
    /** S's LIVEs: two that count as theirs, and one that doesn't */
    const lives = { theirs: "", best: "", not: "" };
    /** Rivals rounds a scripted show kept: four worth a Short, best first, each scoring differently, and one with too little in it */
    let good: { log: ClipLog; score: number }[] = [];
    let dull: { log: ClipLog; score: number };

    /** A kept round as a game would send it: from one of S's LIVEs, numbered as that LIVE counts its rounds, decided a minute ago. */
    const sent = (log: ClipLog, round: number, o: { session?: string; at?: number } = {}): ClipLog =>
      ({ ...JSON.parse(JSON.stringify(log)), session: o.session ?? lives.theirs, round, at: o.at ?? now.getTime() - MIN });

    /** what's kept of one LIVE's rounds, by round */
    const stored = (session: string, user = S) => db.admin((tx) => tx<{ round: number; state: string; reason: string | null; score: number | null; log: ClipLog | null; played_at: Date; created_at: Date }[]>`
      select round, state, reason, score, log, played_at, created_at from public.live_clips where user_id = ${user} and session_id = ${session} order by round`);

    /** A clip Short of S's, as a morning would make one (only the server can), naming these gifters; one swiped was swiped as it was made, unless it says when. */
    const clipShort = async (o: { session: string; people: string[]; status?: string; names?: boolean; made?: Date; decided?: Date }) => {
      const status = o.status ?? "review";
      const [v] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, format, params, key, title, status, created_at, decided_at)
        values (${S}, 'clip', ${tx.json({ log: { session: o.session, people: o.people }, from: 0, ...(o.names ? { names: true } : {}) })}, 'clip:rivals', 'Messi vs Ronaldo: a ball battle round from my LIVE',
          ${status}, ${o.made ?? now}, ${status === "review" ? null : (o.decided ?? o.made ?? now)})
        returning id`);
      return v.id;
    };
    const peopleOf = async (id: string) => (await db.admin((tx) => tx<{ people: string[] }[]>`select params -> 'log' -> 'people' as people from public.videos where id = ${id}`))[0].people;

    /** An account's rounds lock, held until it's let go, as while one of its rounds is being played back; `inside` runs while it's held. */
    const holdRounds = (user: string, inside: (tx: import("@/lib/server/db").Tx) => Promise<unknown> = async () => {}) => {
      let release = () => {};
      const go = new Promise<void>((r) => (release = r));
      let held = () => {};
      const taken = new Promise<void>((r) => (held = r));
      const done = db.admin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${`clips:${user}`}))`;
        await inside(tx);
        held();
        await go;
      });
      return { taken, release, done };
    };
    const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    /** Whether something comes to wait for a lock someone holds, within two seconds. */
    const waitsForLock = async () => {
      for (let i = 0; i < 40; i++) {
        const [r] = await db.admin((tx) => tx<{ waiting: boolean }[]>`
          select exists (select 1 from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())) as waiting`);
        if (r.waiting) return true;
        await pause(50);
      }
      return false;
    };

    beforeAll(async () => {
      if (!safe) return;
      clips = await import("@/lib/server/clips");
      clip = await import("@/lib/live/clip");
      const { scriptedShow } = await import("@/lib/live/clip-demo");
      // rounds from made-up viewers playing the way real ones do, scored as the server scores them
      const scored: { log: ClipLog; score: number }[] = [];
      for (let seed = 1; seed <= 8 && (!scored.some((r) => r.score < clip.CLIP_MIN_SCORE) || new Set(scored.filter((r) => r.score >= clip.CLIP_MIN_SCORE).map((r) => r.score)).size < 4); seed++) {
        for (const { log } of scriptedShow("rivals", seed).kept) scored.push({ log, score: clip.clipWindow(clip.replay(log), log)!.drama.score });
      }
      dull = scored.find((r) => r.score < clip.CLIP_MIN_SCORE)!;
      good = [...new Map(scored.filter((r) => r.score >= clip.CLIP_MIN_SCORE).map((r) => [r.score, r])).values()].sort((a, b) => b.score - a.score).slice(0, 4);
      [{ id: S }, { id: T }, { id: F }, { id: G }] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into auth.users (email) values (${emails[0]}), (${emails[1]}), (${emails[2]}), (${emails[3]}) returning id`);
      await db.admin((tx) => tx`update public.profiles set goal = case when id = ${G} then 'live' else 'both' end where id in (${S}, ${T}, ${F}, ${G})`);
      [keys.S, keys.T, keys.F, keys.G] = await Promise.all([S, T, F, G].map((u) => live.overlayKeyOf(u)));
      [{ id: lives.theirs }, { id: lives.best }, { id: lives.not }] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.live_sessions (id, user_id, game, started_at, last_event_at, rounds, heard, verified)
        values (gen_random_uuid(), ${S}, 'rivals', ${ago(2 * HOUR)}, ${ago(MIN)}, 12, '{s.streams}', true),
               (gen_random_uuid(), ${S}, 'rivals', ${ago(5 * HOUR)}, ${ago(4 * HOUR)}, 30, '{s.streams}', true),
               (gen_random_uuid(), ${S}, 'rivals', ${ago(9 * HOUR)}, ${ago(8 * HOUR)}, 6, '{famous.one}', false)
        returning id`);
    });

    afterAll(async () => {
      if (!safe) return;
      await db.admin((tx) => tx`delete from auth.users where email in ${tx(emails)}`);
    });

    it("takes a LIVE round only through the streamer's key, and only once, keeping one worth a Short to play back exactly", async () => {
      expect(dull.score).toBeLessThan(clip.CLIP_MIN_SCORE);
      expect(good.map((g) => g.score)).toEqual([...good.map((g) => g.score)].sort((a, b) => b - a));
      expect(new Set(good.map((g) => g.score)).size).toBe(4);
      const first = sent(good[1].log, 1);
      expect(await clips.saveClip("z".repeat(32), first, now)).toEqual({ status: 404 });
      expect(await clips.saveClip(keys.S, first, now)).toEqual({ status: 200, kept: true });
      expect(await clips.saveClip(keys.S, sent(good[1].log, 1), now)).toEqual({ status: 409 });
      const [row] = await stored(lives.theirs);
      expect(row).toMatchObject({ round: 1, state: "ready", reason: null, score: good[1].score, played_at: new Date(first.at), created_at: now });
      // kept as the game sent it, and it still plays back exactly after jsonb
      expect(row.log).toEqual(first);
      expect(clip.replaysExactly(row.log!)).toBe(true);
    });

    it("turns away a round that breaks a rule, doesn't play back the way it went or has too little in it, keeping only why", async () => {
      // a Politics round never becomes a Short, even one that plays back exactly
      const politics = { ...sent(good[0].log, 2), rivalry: { id: "republicans-democrats", group: "politics" }, teams: [{ name: "Republicans", color: "#FF3B30" }, { name: "Democrats", color: "#0A84FF" }] } as ClipLog;
      expect(clip.replaysExactly(politics)).toBe(true);
      expect(await clips.saveClip(keys.S, politics, now)).toEqual({ status: 422, why: "Politics rounds never become Shorts." });
      // nor one from more than a day ago
      expect(await clips.saveClip(keys.S, sent(good[0].log, 3, { at: now.getTime() - 25 * HOUR }), now)).toEqual({ status: 422, why: "It wasn't played in the last day." });
      // one heal a point bigger than the game said, and the round doesn't play back the same
      const off = sent(good[0].log, 4);
      const heal = off.inputs.findIndex((x) => x[1] === "h");
      expect(heal).toBeGreaterThanOrEqual(0);
      off.inputs[heal] = [off.inputs[heal][0], "h", off.inputs[heal][2], (off.inputs[heal][3] as number) + 1];
      expect(await clips.saveClip(keys.S, off, now)).toMatchObject({ status: 422 });
      expect(await clips.saveClip(keys.S, sent(dull.log, 5), now)).toEqual({ status: 200, kept: false });
      expect((await stored(lives.theirs)).map((r) => [r.round, r.state, r.reason, r.score, r.log])).toEqual([
        [1, "ready", null, good[1].score, expect.anything()],
        [2, "refused", "rules", null, null],
        [3, "refused", "rules", null, null],
        [4, "refused", "replay", null, null],
        [5, "refused", "dull", dull.score, null],
      ]);
      // a round turned away can't be sent again, as it was or any other way
      expect(await clips.saveClip(keys.S, sent(good[0].log, 4), now)).toEqual({ status: 409 });
    });

    it("keeps only each LIVE's best three, and lets go of the rest, names and all", async () => {
      const [g0, g1, g2, g3] = good;
      for (const [round, g] of [[1, g2], [2, g3], [3, g1]] as const) expect(await clips.saveClip(keys.S, sent(g.log, round, { session: lives.best }), now)).toEqual({ status: 200, kept: true });
      // a better one: the weakest of the three goes
      expect(await clips.saveClip(keys.S, sent(g0.log, 4, { session: lives.best }), now)).toEqual({ status: 200, kept: true });
      // and one no better than the three kept isn't kept
      expect(await clips.saveClip(keys.S, sent(g3.log, 5, { session: lives.best }), now)).toEqual({ status: 200, kept: false });
      expect((await stored(lives.best)).map((r) => [r.round, r.state, r.reason, r.score, r.log === null])).toEqual([
        [1, "ready", null, g2.score, false],
        [2, "refused", "dropped", g3.score, true],
        [3, "ready", null, g1.score, false],
        [4, "ready", null, g0.score, false],
        [5, "refused", "dropped", g3.score, true],
      ]);
      // each LIVE keeps its own best three
      expect((await stored(lives.theirs)).filter((r) => r.state === "ready").map((r) => r.round)).toEqual([1]);
    });

    it("takes 120 rounds an hour from a game, then asks it to wait", async () => {
      const mine = "5f0c6a2e-8d4b-4c1e-9a7f-3b2d1e0c9f8a";
      const seed = (n: number, made: Date) => db.admin((tx) => tx`
        insert into public.live_clips (user_id, session_id, round, game, state, reason, played_at, created_at)
        select ${T}, ${mine}, r, 'rivals', 'refused', 'dull', ${made}, ${made} from generate_series(1, ${n}) r`);
      // 119 in the last hour, and plenty before it
      await db.admin((tx) => tx`insert into public.live_clips (user_id, session_id, round, game, state, reason, played_at, created_at)
        select ${T}, gen_random_uuid(), 1, 'rivals', 'refused', 'dull', ${ago(2 * HOUR)}, ${ago(2 * HOUR)} from generate_series(1, 300)`);
      await seed(119, ago(30 * MIN));
      expect(await clips.saveClip(keys.T, sent(good[0].log, 200, { session: mine }), now)).toEqual({ status: 200, kept: true });
      expect(await clips.saveClip(keys.T, sent(good[1].log, 201, { session: mine }), now)).toEqual({ status: 429 });
      // nothing is kept of a round it was asked to hold back
      expect((await stored(mine, T)).some((r) => r.round === 201)).toBe(false);
      // an hour on, it can send again
      expect(await clips.saveClip(keys.T, sent(good[1].log, 201, { session: mine }), new Date(now.getTime() + 31 * MIN))).toEqual({ status: 200, kept: true });
    });

    it("plays back one of a game's rounds at a time, and asks one sent meanwhile to wait without playing it back", async () => {
      const theirs = "3c9e1a7b-2d4f-4a6e-9b8c-7d1e0f2a3b4c";
      // one of S's rounds is being played back
      const judging = holdRounds(S);
      await judging.taken;
      const got = await Promise.race([clips.saveClip(keys.S, sent(good[2].log, 1, { session: theirs }), now), pause(3000).then(() => "waited its turn")]);
      judging.release();
      await judging.done;
      expect(got).toEqual({ status: 429 });
      expect(await stored(theirs)).toEqual([]);
      // with that one in, the next is played back and kept
      expect(await clips.saveClip(keys.S, sent(good[2].log, 1, { session: theirs }), now)).toEqual({ status: 200, kept: true });
    });

    it("lets go of a round still being played back when rounds are turned off", async () => {
      const theirs = "6d2f8b1e-9a3c-4e5d-8f7a-2b1c0d9e8f7a";
      // a round of F's is going in as F turns rounds off
      const judging = holdRounds(F, (tx) => tx`
        insert into public.live_clips (user_id, session_id, round, game, state, score, log, played_at, created_at)
        values (${F}, ${theirs}, 1, 'rivals', 'ready', 9, ${tx.json(sent(good[0].log, 1, { session: theirs }))}, ${ago(MIN)}, ${now})`);
      await judging.taken;
      const forgetting = clips.forgetClips(F);
      // turning them off waits for it, then lets it go with the rest
      expect(await waitsForLock()).toBe(true);
      judging.release();
      await judging.done;
      await forgetting;
      expect(await stored(theirs, F)).toEqual([]);
    });

    it("refuses a body over 128,000 bytes and anything that isn't a round, through the game's own route", async () => {
      const { POST } = await import("@/app/api/live/clips/route");
      const post = (body: string, headers: Record<string, string> = {}) => POST(new Request("http://localhost/api/live/clips", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }));
      const theirs = "8e1d2c3b-4a5f-4e6d-8c7b-9a0f1e2d3c4b";
      const round = sent(good[2].log, 1, { session: theirs, at: Date.now() - MIN });
      expect((await post("x".repeat(128_001))).status).toBe(413);
      expect((await post("{}", { "content-length": "128001" })).status).toBe(413);
      expect((await post("not a round")).status).toBe(400);
      expect((await post(JSON.stringify({ key: keys.S, clip: { ...round, inputs: "lots" } }))).status).toBe(400);
      // a round can't claim to end past its own time limit, so playing it back always stops by then
      expect((await post(JSON.stringify({ key: keys.S, clip: { ...round, end: clip.lastStep(round.fightMax) + 1 } }))).status).toBe(400);
      // nor be played at a time no date holds; the latest one a date can be is turned away by the rules, and kept as turned away
      expect((await post(JSON.stringify({ key: keys.S, clip: { ...round, at: 9e15 } }))).status).toBe(400);
      const far = await post(JSON.stringify({ key: keys.S, clip: { ...round, round: 2, at: 253_402_300_799_999 } }));
      expect([far.status, await far.text()]).toEqual([422, "It wasn't played in the last day."]);
      expect((await stored(theirs)).map((r) => [r.round, r.reason, r.played_at])).toEqual([[2, "rules", new Date(253_402_300_799_999)]]);
      // a ball can't be someone the round doesn't name
      expect(round.inputs.some((x) => x[1] === "s")).toBe(true);
      expect((await post(JSON.stringify({ key: keys.S, clip: { ...round, people: [], inputs: round.inputs.map((x) => (x[1] === "s" ? [...x.slice(0, 6), 0] : x)) } }))).status).toBe(400);
      expect((await post(JSON.stringify({ key: "y".repeat(32), clip: round }))).status).toBe(404);
      const ok = await post(JSON.stringify({ key: keys.S, clip: round }));
      expect([ok.status, await ok.json()]).toEqual([200, { kept: true }]);
      expect((await post(JSON.stringify({ key: keys.S, clip: round }))).status).toBe(409);
    });

    it("keeps rounds the server's to write, and each streamer reads only their own", async () => {
      const mine = await db.asUser(S, (tx) => tx<{ user_id: string }[]>`select user_id from public.live_clips`);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((r) => r.user_id === S)).toBe(true);
      expect((await db.asUser(T, (tx) => tx<{ user_id: string }[]>`select user_id from public.live_clips`)).every((r) => r.user_id === T)).toBe(true);
      await expect(db.asUser(S, (tx) => tx`insert into public.live_clips (user_id, session_id, round, game, state, score, log, played_at)
        values (${S}, gen_random_uuid(), 1, 'battle', 'ready', 99, '{}', now())`)).rejects.toThrow(/permission denied/);
      await expect(db.asUser(S, (tx) => tx`update public.live_clips set score = 99`)).rejects.toThrow(/permission denied/);
      await expect(db.asUser(S, (tx) => tx`delete from public.live_clips`)).rejects.toThrow(/permission denied/);
    });

    it("keeps no rounds with them turned off or Shorts off for LIVE games only, and turning them off lets go of those waiting", async () => {
      const { DEFAULT_SETTINGS } = await import("@/lib/live/settings");
      // what decides it: the streamer's choice, Hookline asking TikTok for usernames, and Shorts not being off
      expect(clips.clipsAllowed({ clips: true }, "both", true)).toBe(true);
      expect(clips.clipsAllowed({ clips: true }, null, true)).toBe(true);
      expect(clips.clipsAllowed({ clips: true }, "shorts", true)).toBe(true);
      expect(clips.clipsAllowed({ clips: false }, "both", true)).toBe(false);
      expect(clips.clipsAllowed({ clips: true }, "both", false)).toBe(false);
      expect(clips.clipsAllowed({ clips: true }, "live", true)).toBe(false);
      expect((await live.overlayFor(keys.S, now))?.settings.clips).toBe(true);
      // LIVE games only: the game keeps none, and none is taken
      expect((await live.overlayFor(keys.G, now))?.settings.clips).toBe(false);
      expect(await clips.saveClip(keys.G, sent(good[0].log, 1), now)).toEqual({ status: 403 });
      // F keeps a round, then turns rounds off, as saving the settings form does
      const theirs = "2b7e9a1c-6d5f-4b3a-8e2d-1c0f9e8d7c6b";
      expect(await clips.saveClip(keys.F, sent(good[0].log, 1, { session: theirs }), now)).toEqual({ status: 200, kept: true });
      await live.saveLiveSettings(F, { ...DEFAULT_SETTINGS, clips: false });
      await clips.forgetClips(F);
      expect(await stored(theirs, F)).toEqual([]);
      expect((await live.liveSettingsOf(F)).settings.clips).toBe(false);
      expect((await live.overlayFor(keys.F, now))?.settings.clips).toBe(false);
      // an open game still sending until it's reloaded is turned away
      expect(await clips.saveClip(keys.F, sent(good[1].log, 2, { session: theirs }), now)).toEqual({ status: 403 });
      // nobody else's rounds went with them
      expect((await stored(lives.best)).length).toBe(5);
    });

    it("shows each LIVE's waiting rounds, only on LIVEs that count as theirs, and the Short made from one", async () => {
      // a round from the LIVE that wasn't theirs is kept, but can't become a Short, so it isn't shown as waiting
      expect(await clips.saveClip(keys.S, sent(good[0].log, 1, { session: lives.not }), now)).toEqual({ status: 200, kept: true });
      // and one that's waited three days no longer counts
      await db.admin((tx) => tx`insert into public.live_clips (user_id, session_id, round, game, state, score, log, played_at, created_at)
        values (${S}, ${lives.best}, 99, 'rivals', 'ready', 50, '{}', ${ago(3 * DAY + 2 * MIN)}, ${ago(3 * DAY + MIN)})`);
      const none = "0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a";
      let got = await clips.clipsOf(S, [lives.theirs, lives.best, lives.not, none], now);
      expect(Object.fromEntries(got)).toEqual({
        [lives.theirs]: { waiting: 1, shortId: null },
        [lives.best]: { waiting: 3, shortId: null },
        [lives.not]: { waiting: 0, shortId: null },
        [none]: { waiting: 0, shortId: null },
      });
      // a Short is made from a round after its LIVE began, so one made before is never read as from it
      await clipShort({ session: lives.theirs, people: [], made: ago(DAY) });
      expect((await clips.clipsOf(S, [lives.theirs], now)).get(lives.theirs)).toEqual({ waiting: 1, shortId: null });
      // the newest Short made from one of a LIVE's rounds
      await clipShort({ session: lives.theirs, people: [], made: ago(HOUR) });
      const newest = await clipShort({ session: lives.theirs, people: [] });
      got = await clips.clipsOf(S, [lives.theirs], now);
      expect(got.get(lives.theirs)).toEqual({ waiting: 1, shortId: newest });
      // nobody else sees any of it
      expect(await clips.clipsOf(T, [lives.theirs], now)).toEqual(new Map([[lives.theirs, { waiting: 0, shortId: null }]]));
    });

    it("lets rounds go after three days, and empties gifters' names from clip Shorts once swiped, or left unswiped for three days", async () => {
      await db.admin((tx) => tx`insert into public.live_clips (user_id, session_id, round, game, state, reason, played_at, created_at)
        values (${S}, ${lives.best}, 98, 'rivals', 'refused', 'dull', ${ago(2 * DAY)}, ${ago(2 * DAY)})`);
      const shorts = {
        waited: await clipShort({ session: lives.best, people: ["Kai", "mia.plays"], made: ago(3 * DAY + HOUR) }),
        waiting: await clipShort({ session: lives.best, people: ["Kai"], made: ago(DAY) }),
        shown: await clipShort({ session: lives.best, people: ["Kai"], status: "approved", names: true, made: ago(4 * DAY) }),
        skipped: await clipShort({ session: lives.best, people: ["Kai"], status: "rejected", made: ago(HOUR) }),
        unnamed: await clipShort({ session: lives.best, people: ["Kai"], status: "approved", made: ago(HOUR) }),
        // a swipe lets go of names itself: these two are as if that had gone wrong more than a week ago, which an hourly
        // tidy caught then, so it doesn't read them again
        longSkipped: await clipShort({ session: lives.best, people: ["Kai"], status: "rejected", made: ago(9 * DAY), decided: ago(8 * DAY) }),
        longWaited: await clipShort({ session: lives.best, people: ["Kai"], made: ago(11 * DAY) }),
      };
      await clips.tidyClips(now);
      // the round that waited three days is gone; the rest stay
      expect((await stored(lives.best)).map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 98]);
      expect(await peopleOf(shorts.waited)).toEqual([]);
      expect(await peopleOf(shorts.waiting)).toEqual(["Kai"]);
      expect(await peopleOf(shorts.shown)).toEqual(["Kai"]);
      expect(await peopleOf(shorts.skipped)).toEqual([]);
      expect(await peopleOf(shorts.unnamed)).toEqual([]);
      expect([await peopleOf(shorts.longSkipped), await peopleOf(shorts.longWaited)]).toEqual([["Kai"], ["Kai"]]);
      // as the hourly tidy back then did
      await clips.tidyClips(ago(8 * DAY - HOUR));
      expect([await peopleOf(shorts.longSkipped), await peopleOf(shorts.longWaited)]).toEqual([[], []]);
    });

    it("lets nobody signed in make a clip Short or change the round it shows, and every YouTube and channel fact stays the server's", async () => {
      const id = await clipShort({ session: lives.theirs, people: ["Kai"] });
      const refused = /only the server records what happened on a LIVE/;
      await expect(db.asUser(S, (tx) => tx`insert into public.videos (user_id, format, params, key, title) values (${S}, 'clip', '{"from": 0}', 'clip:battle', 'Mine')`)).rejects.toThrow(refused);
      // where its video starts, the round and that it's a clip are the server's
      await expect(db.asUser(S, (tx) => tx`update public.videos set params = jsonb_set(params, '{from}', '900') where id = ${id}`)).rejects.toThrow(refused);
      await expect(db.asUser(S, (tx) => tx`update public.videos set params = jsonb_set(params, '{log,people}', '["Someone"]') where id = ${id}`)).rejects.toThrow(refused);
      await expect(db.asUser(S, (tx) => tx`update public.videos set format = 'battle' where id = ${id}`)).rejects.toThrow(refused);
      const [plain] = await db.admin((tx) => tx<{ id: string }[]>`insert into public.videos (user_id, format, params, key, title) values (${S}, 'battle', '{}', 'battle:spike:sword', 'Spike vs Sword') returning id`);
      await expect(db.asUser(S, (tx) => tx`update public.videos set format = 'clip' where id = ${plain.id}`)).rejects.toThrow(refused);
      // its title, whether names show and whether it asks for comments are still theirs to choose
      await db.asUser(S, (tx) => tx`update public.videos set title = 'Round 14 of my LIVE', params = params || '{"names": true, "allowComments": false}'::jsonb where id = ${id}`);
      const [v] = await db.admin((tx) => tx<{ title: string; params: { names?: boolean; allowComments?: boolean } }[]>`select title, params from public.videos where id = ${id}`);
      expect([v.title, v.params.names, v.params.allowComments]).toEqual(["Round 14 of my LIVE", true, false]);
      // wave 1's and channels' guarded columns are all still the server's
      const facts: Record<string, string> = {
        youtube_id: "'dQw4w9WgXcQ'", youtube_verified: "true", youtube_status: "'processed'", youtube_privacy: "'public'", youtube_kids: "true",
        youtube_checked_at: "now()", youtube_wanted: "'public'", youtube_publish_at: "now()", clean_path: "'x/clean.mp4'",
      };
      for (const [col, value] of Object.entries(facts)) {
        await expect(db.asUser(S, (tx) => tx.unsafe(`insert into public.videos (user_id, format, params, key, title, ${col}) values ('${S}', 'battle', '{}', 'k', 't', ${value})`)), col).rejects.toThrow(/only the server records what YouTube said/);
        for (const v of [id, plain.id]) await expect(db.asUser(S, (tx) => tx.unsafe(`update public.videos set ${col} = ${value} where id = '${v}'`)), col).rejects.toThrow(/only the server records what YouTube said/);
      }
      for (const v of [id, plain.id]) await expect(db.asUser(S, (tx) => tx`update public.videos set channel_id = gen_random_uuid() where id = ${v}`)).rejects.toThrow(/only the server moves a Short to another channel/);
      // the server can still record what happened
      await db.admin((tx) => tx`update public.videos set params = jsonb_set(params, '{log,people}', '[]'::jsonb) where id = ${id}`);
      expect(await peopleOf(id)).toEqual([]);
    });

    // a morning's Shorts

    /**
     * Someone new who streams and gets Shorts, on a plan, onboarded for both
     * in UTC, with YouTube channels connected a day apart, each answered as
     * not made for kids. The first is Hookline's test channel unless `test`
     * is false. Deleted at the end with everyone else here.
     */
    const streamer = async (plan: "free" | "pro" | "creator", o: { channels?: number; test?: boolean } = {}) => {
      const email = `w2-clipper-${emails.length + 1}@test.local`;
      emails.push(email);
      const [{ id: user }] = await db.admin((tx) => tx<{ id: string }[]>`insert into auth.users (email) values (${email}) returning id`);
      const channels = await db.admin(async (tx) => {
        await tx`update public.profiles set timezone = 'UTC', goal = 'both', onboarded_at = now() - interval '30 days' where id = ${user}`;
        if (plan !== "free") await tx`insert into public.subscriptions (user_id, plan, status) values (${user}, ${plan}, 'active')`;
        const ids: string[] = [];
        for (let i = 0; i < (o.channels ?? 1); i++) {
          const added = new Date(Date.UTC(2026, 0, 1 + i));
          const external = i === 0 && o.test !== false ? TEST_CHANNEL : `UCw2clip${emails.length}n${i}`;
          const [c] = await tx<{ id: string }[]>`
            insert into public.channels (user_id, platform, external_id, title, made_for_kids, connected_at, added_at)
            values (${user}, 'youtube', ${external}, ${`Channel ${i + 1}`}, false, ${added}, ${added}) returning id`;
          ids.push(c.id);
        }
        return ids;
      });
      return { user, key: await live.overlayKeyOf(user), channels };
    };

    /** One of their LIVEs: verified as theirs unless it says otherwise, of Rivals, from two hours ago until an hour ago. */
    const aLive = async (user: string, o: { verified?: boolean; game?: string; from?: number; to?: number } = {}) => (await db.admin((tx) => tx<{ id: string }[]>`
      insert into public.live_sessions (id, user_id, game, started_at, last_event_at, rounds, heard, verified)
      values (gen_random_uuid(), ${user}, ${o.game ?? "rivals"}, ${ago(o.from ?? 2 * HOUR)}, ${ago(o.to ?? HOUR)}, 20, '{w2.clipper}', ${o.verified ?? true})
      returning id`))[0].id;

    /** A round kept from one of their LIVEs, played 90 minutes ago unless it says otherwise, and sent as it was decided. */
    const keep = async (key: string, g: { log: ClipLog }, session: string, round: number, played = ago(90 * MIN)) => {
      expect(await clips.saveClip(key, sent(g.log, round, { session, at: played.getTime() }), new Date(played.getTime() + MIN))).toEqual({ status: 200, kept: true });
    };

    type Short = {
      id: string; format: string; channel_id: string | null; origin: string; status: string; key: string; title: string; why: string[]; suggested_for: Date | null;
      params: { log?: ClipLog; from?: number; look?: unknown; ending?: string };
    };
    /** Their Shorts, soonest first. */
    const shortsOf = (user: string) => db.admin((tx) => tx<Short[]>`
      select id, format, channel_id, origin, status, key, title, why, params, suggested_for from public.videos where user_id = ${user} order by suggested_for nulls last, created_at`);
    const roundsIn = async (user: string) => (await shortsOf(user)).filter((v) => v.format === "clip");
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    it("makes a waiting round one of the morning's Shorts: on Pro, the round and two made ones, the round going out first", async () => {
      const p = await streamer("pro");
      const theirs = await aLive(p.user);
      await keep(p.key, good[1], theirs, 7);
      expect(await gen.tryDaily({ userId: p.user, channelId: p.channels[0] }, now)).toBe(`${p.user} ${p.channels[0]}: 3 made`);
      const [round, ...made] = await shortsOf(p.user);
      const { log } = good[1];
      const cut = clip.clipWindow(clip.replay(log), log)!;
      expect(round).toMatchObject({ format: "clip", channel_id: p.channels[0], origin: "daily", status: "review", key: "clip:rivals" });
      expect(round.params.log).toMatchObject({ session: theirs, round: 7, inputs: log.inputs, check: log.check });
      expect(round.params.from).toBe(cut.from);
      // for the same channel as the made ones, in its look, ending the way they do
      expect(made).toHaveLength(2);
      expect(made.every((m) => m.format !== "clip" && m.channel_id === p.channels[0])).toBe(true);
      expect(round.params.look).toEqual(made[0].params.look);
      expect(["comment", "loop"]).toContain(round.params.ending);
      expect(round.suggested_for!.getTime()).toBeLessThan(made[0].suggested_for!.getTime());
      // why it's this one, and what it counts as
      expect(round.why[0]).toBe(`Round 7 of your LIVE on ${DAYS[ago(90 * MIN).getUTCDay()]}`);
      expect(round.why.slice(2)).toEqual(["It counts as one of today's Shorts", expect.stringMatching(/^Posts at /)]);
      expect(round.title).toBe(`${log.teams[0].name} vs ${log.teams[1].name}: a ball battle round from my LIVE`);
      // the round stopped waiting as its Short was made, so it can't come round again
      expect(await stored(theirs, p.user)).toEqual([]);
      // the morning's note counts it
      expect(await db.admin((tx) => tx`select title from public.notifications where user_id = ${p.user} and kind = 'ready'`)).toEqual([{ title: "3 new Shorts to swipe" }]);
      // and what a morning reads of the channel's past leaves the round's record out
      const past = await db.asUser(p.user, (tx) => gen.pastOf(tx, { userId: p.user, channelId: p.channels[0] }));
      const had = past.find((h) => h.format === "clip")!;
      expect(had.params).not.toHaveProperty("log");
      expect(had.params).toMatchObject({ from: cut.from });
    }, 60_000);

    it("takes a round only from a finished LIVE of the same game that counts as theirs, played while it was going, the last day and a half's best first", async () => {
      const q = await streamer("pro");
      const lives = {
        notTheirs: await aLive(q.user, { verified: false }),
        going: await aLive(q.user, { to: 5 * MIN }),
        otherGame: await aLive(q.user, { game: "battle" }),
        older: await aLive(q.user, { from: 50 * HOUR, to: 48 * HOUR }),
        theirs: await aLive(q.user),
      };
      // the best rounds, from LIVEs none can come from: someone else's, one still going, another game's
      for (const s of [lives.notTheirs, lives.going, lives.otherGame]) await keep(q.key, good[0], s, 1);
      // a good one played an hour before its LIVE began, and a better one from two days ago
      await keep(q.key, good[0], lives.theirs, 1, ago(3 * HOUR));
      await keep(q.key, good[1], lives.older, 1, ago(49 * HOUR));
      // and the weakest, from today's LIVE that counts as theirs
      await keep(q.key, good[3], lives.theirs, 2);
      expect(await gen.makeShorts(q.user, { origin: "daily", now })).toBe(3);
      expect((await roundsIn(q.user)).map((v) => [v.params.log?.session, v.params.log?.round])).toEqual([[lives.theirs, 2]]);
      // the rest still wait
      for (const s of [lives.notTheirs, lives.going, lives.otherGame, lives.older, lives.theirs]) expect((await stored(s, q.user)).map((r) => [r.round, r.state]), s).toEqual([[1, "ready"]]);
    }, 60_000);

    it("makes one a day at most, only on a day's own run for the first channel, as one of the plan's Shorts", async () => {
      const c = await streamer("creator", { channels: 2 });
      const theirs = await aLive(c.user);
      await keep(c.key, good[0], theirs, 1);
      await keep(c.key, good[1], theirs, 2);
      const [first, second] = c.channels;
      // another channel's morning, "make one like this" and a swiped-away one's replacement never take one
      expect(await gen.makeShorts(c.user, { origin: "daily", channelId: second, now })).toBe(5);
      expect(await gen.makeShorts(c.user, { origin: "daily", channelId: first, like: "battle", count: 1, now })).toBe(1);
      expect(await gen.makeShorts(c.user, { origin: "replacement", channelId: first, now })).toBe(1);
      expect(await roundsIn(c.user)).toEqual([]);
      // the first channel's own: the best round, as one of its two
      expect(await gen.makeShorts(c.user, { origin: "daily", channelId: first, count: 2, now })).toBe(2);
      expect((await roundsIn(c.user)).map((v) => [v.channel_id, v.params.log?.round])).toEqual([[first, 1]]);
      // a second go the same day takes none, though another round waits
      expect(await gen.makeShorts(c.user, { origin: "daily", channelId: first, now })).toBe(2);
      expect(await roundsIn(c.user)).toHaveLength(1);
      expect((await stored(theirs, c.user)).map((r) => [r.round, r.state])).toEqual([[2, "ready"]]);
      const allow = await gen.allowancesOf(c.user, (await import("@/lib/billing/plans")).PLANS.creator, "UTC", now);
      expect(allow.units.get(first)).toMatchObject({ made: 5, left: 0 });

      // on Free it's one of the week's 3
      const f = await streamer("free");
      await keep(f.key, good[2], await aLive(f.user), 1);
      expect(await gen.makeShorts(f.user, { origin: "daily", now })).toBe(3);
      const [round] = await roundsIn(f.user);
      expect(round.why[2]).toBe("It counts as one of this week's 3 Shorts");
      expect(await gen.makeShorts(f.user, { origin: "daily", now })).toBe(0);

      // and an account set to LIVE games only gets none, its Shorts being off
      const l = await streamer("pro");
      await keep(l.key, good[2], await aLive(l.user), 1);
      await db.admin((tx) => tx`update public.profiles set goal = 'live' where id = ${l.user}`);
      expect(await gen.makeShorts(l.user, { origin: "daily", now })).toBe(3);
      expect(await roundsIn(l.user)).toEqual([]);
    }, 120_000);

    it("saves the whole day or none of it, and a round that can't be taken costs the day nothing", async () => {
      const a = await streamer("pro");
      const theirs = await aLive(a.user);
      await keep(a.key, good[0], theirs, 1);
      const unit = { userId: a.user, channelId: a.channels[0] };
      // the made Shorts can't be saved, so neither is the round's: it still waits, and the morning run tries again in an hour
      const refuse = "drop trigger if exists w2_clipper_refuse on public.videos; drop function if exists public.w2_clipper_refuse();";
      onTestFinished(() => db.admin((tx) => tx.unsafe(refuse)).then(() => undefined));
      await db.admin((tx) => tx.unsafe(`
        create function public.w2_clipper_refuse() returns trigger language plpgsql as $$
        begin
          if new.user_id = '${a.user}' and new.format <> 'clip' then raise exception 'no room for it'; end if;
          return new;
        end $$;
        create trigger w2_clipper_refuse before insert on public.videos for each row execute function public.w2_clipper_refuse();`));
      expect(await gen.tryDaily(unit, now)).toBe(`${a.user} ${a.channels[0]} failed: no room for it`);
      expect(await shortsOf(a.user)).toEqual([]);
      expect((await stored(theirs, a.user)).map((r) => r.state)).toEqual(["ready"]);
      expect(await db.admin((tx) => tx`select outcome, next_try_at from public.shorts_runs where user_id = ${a.user}`)).toEqual([{ outcome: "failed", next_try_at: new Date(now.getTime() + HOUR) }]);
      await db.admin((tx) => tx.unsafe(refuse));
      // the next try makes the whole day, the round with it
      expect(await gen.tryDaily(unit, new Date(now.getTime() + HOUR + MIN))).toBe(`${a.user} ${a.channels[0]}: 3 made`);
      expect(await roundsIn(a.user)).toHaveLength(1);
      expect(await stored(theirs, a.user)).toEqual([]);

      // when taking a round goes wrong, the day is all made Shorts, as many as ever, and the round waits for another morning
      const b = await streamer("pro");
      const hers = await aLive(b.user);
      await keep(b.key, good[1], hers, 1);
      const said = vi.spyOn(console, "error").mockImplementation(() => {});
      onTestFinished(() => said.mockRestore());
      const unlock = () => db.admin((tx) => tx`grant select on public.live_clips to authenticated`).then(() => undefined);
      onTestFinished(unlock);
      await db.admin((tx) => tx`revoke select on public.live_clips from authenticated`);
      expect(await gen.makeShorts(b.user, { origin: "daily", now })).toBe(3);
      await unlock();
      expect(await roundsIn(b.user)).toEqual([]);
      expect(said).toHaveBeenCalledWith("shorts: couldn't take a LIVE round:", expect.stringMatching(/permission denied/));
      expect((await stored(hers, b.user)).map((r) => r.state)).toEqual(["ready"]);
    }, 120_000);

    it("makes the day all made Shorts, as many as ever, when the round it took stops waiting before the day is saved", async () => {
      const g = await streamer("pro");
      const theirs = await aLive(g.user);
      await keep(g.key, good[1], theirs, 1);
      // the round goes while the rest of the day is being made, as when rounds are turned off just then: the first thing the day claims takes it
      const gone = "drop trigger if exists w2_clipper_gone on public.content_ledger; drop function if exists public.w2_clipper_gone();";
      onTestFinished(() => db.admin((tx) => tx.unsafe(gone)).then(() => undefined));
      await db.admin((tx) => tx.unsafe(`
        create function public.w2_clipper_gone() returns trigger language plpgsql as $$
        begin
          delete from public.live_clips where user_id = new.user_id;
          return new;
        end $$;
        create trigger w2_clipper_gone after insert on public.content_ledger for each row
          when (new.user_id = '${g.user}') execute function public.w2_clipper_gone();`));
      expect(await gen.tryDaily({ userId: g.user, channelId: g.channels[0] }, now)).toBe(`${g.user} ${g.channels[0]}: 3 made`);
      const day = await shortsOf(g.user);
      expect(day).toHaveLength(3);
      expect(day.every((v) => v.format !== "clip" && v.origin === "daily")).toBe(true);
      expect(await db.admin((tx) => tx`select title from public.notifications where user_id = ${g.user} and kind = 'ready'`)).toEqual([{ title: "3 new Shorts to swipe" }]);
    }, 120_000);

    it("lets go of gifters' names when a round is kept without them or swiped away, and keeps them in one that shows them", async () => {
      const { PLANS } = await import("@/lib/billing/plans");
      const n = await streamer("pro");
      // rounds from their LIVE as mornings make them, each naming two gifters
      const made = async (round: number) => (await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, origin)
        values (${n.user}, ${n.channels[0]}, 'clip', ${tx.json({ log: { ...JSON.parse(JSON.stringify(good[0].log)), round, people: ["Kai", "mia.plays"] }, from: 0 })},
          'clip:rivals', ${`Round ${round}`}, 'review', 'daily')
        returning id`))[0].id;
      const [hidden, shown, skipped] = [await made(1), await made(2), await made(3)];
      const [battle] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, origin)
        values (${n.user}, ${n.channels[0]}, 'battle', '{"a": "spike", "b": "sword", "seed": 1}', 'battle:spike:sword', 'Spike vs Sword', 'review', 'daily') returning id`);
      expect(await queue.approve(n.user, hidden, PLANS.pro, now)).toBe(true);
      expect(await queue.approve(n.user, shown, PLANS.pro, now, null, null, true)).toBe(true);
      expect(await queue.reject(n.user, skipped)).toBe(true);
      // a Short of any other kind never takes names
      expect(await queue.approve(n.user, battle.id, PLANS.pro, now, null, null, true)).toBe(true);
      const names = async (id: string) => (await db.admin((tx) => tx`select params -> 'log' -> 'people' as people, params -> 'names' as names from public.videos where id = ${id}`))[0];
      expect(await names(hidden)).toEqual({ people: [], names: null });
      expect(await names(shown)).toEqual({ people: ["Kai", "mia.plays"], names: true });
      expect(await names(skipped)).toEqual({ people: [], names: null });
      expect(await names(battle.id)).toEqual({ people: null, names: null });
    });

    it("goes the usual way once kept: who it's for logged with it, into the render queue, and up only to Hookline's test channel before YouTube's audit", async () => {
      const { PLANS } = await import("@/lib/billing/plans");
      const onTest = await streamer("pro");
      const own = await streamer("pro", { test: false });
      const ids: string[] = [];
      for (const s of [onTest, own]) {
        await keep(s.key, good[2], await aLive(s.user), 1);
        expect(await gen.makeShorts(s.user, { origin: "daily", now })).toBe(3);
        const [round] = await roundsIn(s.user);
        // kept as made for kids, though the channel isn't
        expect(await queue.approve(s.user, round.id, PLANS.pro, now, null, true)).toBe(true);
        ids.push(round.id);
      }
      expect(await db.admin((tx) => tx`select video_id, made_for_kids from public.audience_log where video_id = any(${ids}::uuid[]) and source = 'short' order by id`))
        .toEqual(ids.map((video_id) => ({ video_id, made_for_kids: true })));
      // made like any Short, then ready to go up
      for (const [i, s] of [onTest, own].entries()) {
        const [job] = await db.admin((tx) => tx<{ id: number; status: string; priority: number }[]>`select id, status, priority from public.render_jobs where video_id = ${ids[i]}`);
        expect(job).toMatchObject({ status: "queued", priority: PLANS.pro.priority });
        const [v] = await db.admin((tx) => tx<{ params: import("@/lib/shorts/types").ClipParams }[]>`select params from public.videos where id = ${ids[i]}`);
        await render.finishJob({ id: job.id, videoId: ids[i], userId: s.user, spec: { format: "clip", params: v.params }, tag: false, attempts: 1, clean: false, alsoClean: false }, `${s.user}/${ids[i]}.mp4`);
      }
      const seen: { channel: string; madeForKids: boolean; categoryId?: string }[] = [];
      onTestFinished(() => void upload.mockReset());
      upload.mockImplementation(async (...a) => {
        const [channel, , meta] = a as [string, Buffer, { madeForKids: boolean; categoryId?: string }];
        seen.push({ channel, madeForKids: meta.madeForKids, categoryId: meta.categoryId });
        return `w2clipup${seen.length}`;
      });
      // what's on YouTube already isn't these tests' to say
      stubFetch(() => new Response("{}", { status: 500 }));
      await post.postDue(now, 1000);
      // as Entertainment, made for kids as it was kept, and only to the test channel
      expect(seen.filter((u) => [onTest.channels[0], own.channels[0]].includes(u.channel))).toEqual([{ channel: onTest.channels[0], madeForKids: true, categoryId: "24" }]);
      const where = async (id: string) => (await db.admin((tx) => tx`select status, youtube_id from public.videos where id = ${id}`))[0];
      expect(await where(ids[0])).toEqual({ status: "scheduled", youtube_id: expect.stringMatching(/^w2clipup/) });
      // before the audit, on a channel that isn't a test one, the creator posts it
      expect(await where(ids[1])).toEqual({ status: "ready", youtube_id: null });
    }, 60_000);

    it("says when a round from a LIVE did well without promising more like it, since only the creator's LIVEs make them", async () => {
      const r = await streamer("pro");
      const ch = r.channels[0];
      // three posted Shorts set the channel's usual first day, a hundred views each
      const usual = await db.admin((tx) => tx<{ id: string; posted_at: Date }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, posted_at, youtube_id, youtube_verified)
        select ${r.user}, ${ch}, 'quiz', '{"questions":[]}', 'quiz:capitals', 'Quiz ' || g, 'posted', now() - interval '4 days',
          now() - interval '4 days' + make_interval(mins => g), ${`w2clip${r.user.slice(0, 8)}q`} || g, true
        from generate_series(1, 3) g order by g returning id, posted_at`);
      for (const v of usual) await db.admin((tx) => tx`insert into public.video_stats (video_id, checkpoint, views, fetched_at) values (${v.id}, '24h', 100, ${new Date(v.posted_at.getTime() + DAY)})`);
      const posted = (format: string, key: string, title: string, params: unknown) => db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, decided_at, posted_at, youtube_id, youtube_verified)
        values (${r.user}, ${ch}, ${format}, ${tx.json(params as never)}, ${key}, ${title}, 'posted', now() - interval '1 day', now() - interval '1 day', ${`w2clip${r.user.slice(0, 8)}${format}`}, true)
        returning id`).then(([v]) => v.id);
      const round = await posted("clip", "clip:rivals", "Round 3 of my LIVE", { log: { session: lives.theirs, people: [] }, from: 0 });
      const quiz = await posted("quiz", "quiz:capitals", "Quiz 4", { questions: [] });
      await stats.learn(r.user, round, "clip", "clip:rivals", 400, 24, ch);
      await stats.learn(r.user, quiz, "quiz", "quiz:capitals", 400, 24, ch);
      const notes = await db.admin((tx) => tx<{ href: string; body: string }[]>`select href, body from public.notifications where user_id = ${r.user} and kind = 'results' order by created_at`);
      expect(notes).toEqual([
        { href: `/app/shorts/${round}`, body: "Round 3 of my LIVE beat your typical Short in its first day." },
        { href: `/app/shorts/${quiz}`, body: "Quiz 4 beat your typical Short in its first day. Hookline will make more like it." },
      ]);
    });

    it("fails a round the worker can't make at once, saying why, instead of trying it three times", async () => {
      const { unmakeable } = await import("@/lib/live/clip-rules");
      const w = await streamer("pro");
      // kept with names off, its gifters' names still in it, as if letting go of them had gone wrong
      const { log } = good[0];
      const params = { log: { ...JSON.parse(JSON.stringify(log)), people: ["Kai"] } as ClipLog, from: clip.clipWindow(clip.replay(log), log)!.from };
      const why = unmakeable(params)!;
      expect(why).toBe("This LIVE round breaks Hookline's rules, so it can't be made.");
      const [v] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, origin, decided_at)
        values (${w.user}, ${w.channels[0]}, 'clip', ${tx.json(params)}, 'clip:rivals', 'Round 1', 'rendering', 'daily', now()) returning id`);
      const [job] = await db.admin((tx) => tx<{ id: number }[]>`insert into public.render_jobs (video_id, status, attempts) values (${v.id}, 'running', 1) returning id`);
      await render.failJob({ id: job.id, videoId: v.id, userId: w.user, spec: { format: "clip", params }, tag: false, attempts: 1, clean: false, alsoClean: false }, why, true);
      expect(await db.admin((tx) => tx`select status, error from public.videos where id = ${v.id}`)).toEqual([{ status: "failed", error: `Rendering failed: ${why}` }]);
      expect(await db.admin((tx) => tx`select status from public.render_jobs where id = ${job.id}`)).toEqual([{ status: "failed" }]);
      expect(await db.admin((tx) => tx`select title, body from public.notifications where user_id = ${w.user} and kind = 'failed'`)).toEqual([{ title: "A Short couldn't be made", body: `Round 1. ${why}` }]);
      // trying it again would only fail again, so it stays as it is, saying why, with no new try and no new note
      const { PLANS } = await import("@/lib/billing/plans");
      await queue.retry(w.user, v.id, PLANS.pro);
      expect(await db.admin((tx) => tx`select status, error from public.videos where id = ${v.id}`)).toEqual([{ status: "failed", error: `Rendering failed: ${why}` }]);
      expect(await db.admin((tx) => tx`select id from public.render_jobs where video_id = ${v.id}`)).toEqual([{ id: job.id }]);
      // one that can still be made, which failed for some other reason, is made again
      const [ok] = await db.admin((tx) => tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, origin, decided_at, error)
        values (${w.user}, ${w.channels[0]}, 'clip', ${tx.json({ ...params, log: { ...params.log, people: [] } })}, 'clip:rivals', 'Round 2', 'failed', 'daily', now(), 'Rendering failed: Chrome went away')
        returning id`);
      await queue.retry(w.user, ok.id, PLANS.pro);
      expect(await db.admin((tx) => tx`select status, error from public.videos where id = ${ok.id}`)).toEqual([{ status: "approved", error: null }]);
      expect(await db.admin((tx) => tx`select status from public.render_jobs where video_id = ${ok.id}`)).toEqual([{ status: "queued" }]);
    });
  });

  // wave 2: niches

  // wave 2: proof

  // wave 2: ytlive
});
