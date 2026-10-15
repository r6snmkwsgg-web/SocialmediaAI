import "server-only";
import { headers } from "next/headers";
import { siteUrl } from "./env";

/**
 * This site's address as the visitor reached it. A deploy sets
 * NEXT_PUBLIC_SITE_URL, which always wins, so a forged Host header can't
 * point a sign-in link or an OAuth redirect somewhere else.
 */
export async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return siteUrl();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return siteUrl(`${proto}://${host}`);
}

/** Where to go after signing in: only somewhere inside the app, never off-site. */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  return next && /^\/app(\/[\w\-/?=&.%]*)?$/.test(next) ? next : fallback;
}
