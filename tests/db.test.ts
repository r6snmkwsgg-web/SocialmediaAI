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

describe.skipIf(!safe)("row-level security", () => {
  let db: Db;
  let A = "";
  let B = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = await import("@/lib/server/db");
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

  it("deleting an account deletes everything that was theirs", async () => {
    await db.admin((tx) => tx`delete from auth.users where id = ${B}`);
    const left = await db.admin((tx) => tx<{ n: number }[]>`
      select (select count(*) from public.profiles where id = ${B}) + (select count(*) from public.videos where user_id = ${B})
        + (select count(*) from public.live_sessions where user_id = ${B}) + (select count(*) from public.stripe_keys where user_id = ${B}) as n`);
    expect(Number(left[0].n)).toBe(0);
  });
});
