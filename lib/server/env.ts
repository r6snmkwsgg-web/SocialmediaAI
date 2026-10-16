import "server-only";
import { z } from "zod";
import { testChannels, type ApiAccess } from "../shorts/youtube";

/**
 * Every setting the server reads, checked once. Each outside service is
 * optional: when its keys aren't set, the part of the app that needs it
 * says so plainly instead of breaking, so the app runs with only a
 * database while the rest gets set up.
 */

const optional = z.string().trim().min(1).optional().catch(undefined);

const schema = z.object({
  DATABASE_URL: optional,
  NEXT_PUBLIC_SITE_URL: optional,
  /** 32 random bytes, base64: encrypts OAuth tokens and Stripe keys at rest */
  TOKEN_KEY: optional,
  /** a secret for the scheduled jobs (Vercel Cron sends it as a bearer token) */
  CRON_SECRET: optional,
  /** local development only: sign in without email */
  HOOKLINE_DEV_LOGIN: optional,
  /** who can open /admin: email addresses, comma-separated */
  ADMIN_EMAILS: optional,

  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,

  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_PRICE_PRO_MONTH: optional,
  STRIPE_PRICE_PRO_YEAR: optional,
  STRIPE_PRICE_CREATOR_MONTH: optional,
  STRIPE_PRICE_CREATOR_YEAR: optional,

  ANTHROPIC_API_KEY: optional,
  /** the Claude model that writes titles (see README) */
  ANTHROPIC_MODEL: optional,

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  /** a YouTube Data API key for the trends job, which reads public videos */
  YOUTUBE_API_KEY: optional,
  /** "1" once YouTube's API audit has passed: until then everything uploaded stays private, so Hookline only uploads to the test channels */
  YOUTUBE_AUDITED: optional,
  /** YouTube channel ids (UC…), comma-separated: your own channels, which get uploads before the audit */
  YOUTUBE_TEST_CHANNELS: optional,

  TIKTOK_CLIENT_KEY: optional,
  TIKTOK_CLIENT_SECRET: optional,
  /** "1" posts straight to creators' TikTok; until TikTok's audit passes, only to private accounts, as private posts */
  TIKTOK_DIRECT_POST: optional,
  /** "1" asks TikTok for each account's username (user.info.profile), which is how a LIVE counts as the creator's own; only once the TikTok app has that scope */
  TIKTOK_PROFILE: optional,

  /** "1" switches every Hookline Bridge off: each one stops and tells its game to use TikFinity */
  BRIDGE_OFF: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** Which outside services are set up, for the screens that depend on them. */
export function configured() {
  const e = env();
  return {
    db: !!e.DATABASE_URL,
    supabase: !!(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    storage: !!(e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY),
    stripe: !!(e.STRIPE_SECRET_KEY && e.STRIPE_PRICE_PRO_MONTH),
    claude: !!(e.ANTHROPIC_API_KEY && e.ANTHROPIC_MODEL),
    youtube: !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    youtubeTrends: !!e.YOUTUBE_API_KEY,
    youtubeAudited: e.YOUTUBE_AUDITED === "1",
    tiktok: !!(e.TIKTOK_CLIENT_KEY && e.TIKTOK_CLIENT_SECRET),
    tiktokDirect: e.TIKTOK_DIRECT_POST === "1",
    tiktokProfile: e.TIKTOK_PROFILE === "1",
    tokens: !!e.TOKEN_KEY,
    bridgeOff: e.BRIDGE_OFF === "1",
  };
}

/** Which YouTube channels Hookline uploads to itself: all of them after the audit, only the test ones before. */
export function youtubeApi(): ApiAccess {
  const e = env();
  return { audited: e.YOUTUBE_AUDITED === "1", test: testChannels(e.YOUTUBE_TEST_CHANNELS) };
}

/** Signing in without email: only on a developer's own machine, never in a deploy. */
export function devLoginOn(): boolean {
  return process.env.NODE_ENV !== "production" && env().HOOKLINE_DEV_LOGIN === "1";
}

/** The site's own address, for links in emails and OAuth redirects. */
export function siteUrl(fallback?: string): string {
  return (env().NEXT_PUBLIC_SITE_URL ?? fallback ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Whether this signed-in email runs Hookline, and can see /admin. */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (env().ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}
