import "server-only";
import postgres from "postgres";
import { env } from "./env";

/**
 * The database. Most of the app talks to it as the signed-in user, inside
 * a transaction that takes on Supabase's `authenticated` role with their
 * id, so row-level security decides what they can see and change, exactly
 * as it would through Supabase's own API. The server's own jobs (the
 * Stripe webhook, crons, the render worker) use `admin`, which isn't
 * limited by it.
 */

let client: postgres.Sql | null = null;

export function sql(): postgres.Sql {
  if (!client) {
    const url = env().DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL isn't set.");
    // prepare: false so it works through Supabase's transaction pooler
    client = postgres(url, { prepare: false, max: 5, idle_timeout: 20, onnotice: () => {} });
  }
  return client;
}

export type Tx = postgres.TransactionSql;

/** Run queries as a signed-in user: row-level security applies. */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  }) as Promise<T>;
}

/** Run queries as the server itself, for webhooks, jobs and the worker. */
export async function admin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql().begin(fn) as Promise<T>;
}

/**
 * Runs `fn` while holding a lock named after a user, so two requests
 * can't both do something that should happen once (like making today's
 * Shorts). The second waits for the first.
 */
export async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const conn = await sql().reserve();
  try {
    await conn`select pg_advisory_lock(hashtext(${`user:${userId}`}))`;
    return await fn();
  } finally {
    await conn`select pg_advisory_unlock(hashtext(${`user:${userId}`}))`.catch(() => {});
    conn.release();
  }
}
