import "server-only";
import { cookies } from "next/headers";
import { sign, token, unsign } from "./crypto";

/**
 * The round trip to Google or TikTok and back: a random state in a signed,
 * short-lived cookie, checked when they send the visitor back, so nobody
 * else can finish a connection in their name.
 */

const COOKIE = "hl_oauth";

export async function startOAuth(provider: string, next: string): Promise<string> {
  const state = token(18);
  (await cookies()).set(COOKIE, sign(JSON.stringify({ provider, state, next, at: Date.now() })), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return state;
}

export async function finishOAuth(provider: string, state: string | null): Promise<{ next: string } | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  store.delete(COOKIE);
  const value = raw ? unsign(raw) : null;
  if (!value || !state) return null;
  try {
    const v = JSON.parse(value) as { provider: string; state: string; next: string; at: number };
    if (v.provider !== provider || v.state !== state || Date.now() - v.at > 600_000) return null;
    return { next: v.next };
  } catch {
    return null;
  }
}
