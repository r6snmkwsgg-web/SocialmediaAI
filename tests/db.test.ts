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
    const vids = await db.admin(async (tx) => {
      await tx`insert into public.subscriptions (user_id, plan, status) values (${Q}, 'pro', 'active')`;
      // a channel Hookline may upload to, that's said who it's for
      const [ch] = await tx<{ id: string }[]>`insert into public.channels (user_id, platform, external_id, made_for_kids) values (${Q}, 'youtube', ${TEST_CHANNEL}, false) returning id`;
      await tx`insert into public.channel_tokens (channel_id, access_token) values (${ch.id}, 'sealed')`;
      return tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, status, file_path, scheduled_for, decided_at)
        select ${Q}, ${ch.id}, 'wyr', '{"pairs":[]}', 'wyr', 'Held ' || g, 'ready', 'q/' || g || '.mp4', now() + make_interval(days => 2 + g), now()
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
      insert into public.videos (user_id, channel_id, format, params, key, title, status, file_path, scheduled_for, decided_at, waiting_on, waiting_until)
      select ${Q}, id, 'wyr', '{"pairs":[]}', 'wyr', 'Held again', 'ready', 'q/3.mp4', now() + interval '3 days', now(), 'youtube_quota', ${until}
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
        + (select count(*) from public.live_sessions where user_id = ${B}) + (select count(*) from public.stripe_keys where user_id = ${B}) as n`);
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

  // wave 2: quota

  // wave 2: clipper

  // wave 2: niches

  // wave 2: proof

  // wave 2: ytlive
});
