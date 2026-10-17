import "server-only";
import { cleanUser } from "../live/bridge";
import { PRIVACY, postSettings, problemWith, type Creator, type Privacy, type TikTokChoices } from "../shorts/tiktok";
import { markExpired, tokensOf, updateTokens, type Tokens } from "./channels-store";
import { configured, env } from "./env";

/**
 * TikTok: connecting an account, then either posting for the creator
 * with the choices they made for that Short (when direct posting is on)
 * or sending the video to their TikTok drafts, where they finish it in
 * the app. TikTok has no way to schedule a post, so posting happens at
 * the chosen time.
 */

const AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com/v2";

export class TikTokError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
  }
  get retry(): boolean {
    return this.status >= 500 || this.status === 429 || this.code === "rate_limit_exceeded";
  }
  /**
   * A daily cap is full, TikTok's on creators for an app under review or
   * the account's own on posts: worth trying again tomorrow, not giving up on
   */
  get tomorrow(): boolean {
    return this.code === "reached_active_user_cap" || this.code === "spam_risk_too_many_posts";
  }
}

function creds() {
  const e = env();
  if (!e.TIKTOK_CLIENT_KEY || !e.TIKTOK_CLIENT_SECRET) throw new Error("TikTok isn't set up.");
  return { key: e.TIKTOK_CLIENT_KEY, secret: e.TIKTOK_CLIENT_SECRET };
}

/**
 * What we ask TikTok for: who they are, their videos' views, and
 * uploading; their username (so a LIVE the game hears can be checked as
 * theirs) only once the TikTok app has that scope, since TikTok refuses
 * the whole sign-in over a scope the app doesn't have; posting only when
 * direct posting is on.
 */
export function tiktokScopes(): string[] {
  const c = configured();
  return ["user.info.basic", ...(c.tiktokProfile ? ["user.info.profile"] : []), "video.list", "video.upload", ...(c.tiktokDirect ? ["video.publish"] : [])];
}

export function tiktokAuthUrl(state: string, redirectUri: string): string {
  const q = new URLSearchParams({ client_key: creds().key, scope: tiktokScopes().join(","), response_type: "code", redirect_uri: redirectUri, state });
  return `${AUTH}?${q}`;
}

type TokenReply = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; open_id?: string; error?: string; error_description?: string };

function toTokens(j: TokenReply): Tokens {
  return { access: j.access_token, refresh: j.refresh_token ?? null, expiresAt: new Date(Date.now() + (j.expires_in - 60) * 1000), scopes: j.scope ?? null };
}

async function token(body: Record<string, string>): Promise<TokenReply> {
  const { key, secret } = creds();
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: key, client_secret: secret, ...body }),
  });
  const j = (await res.json().catch(() => ({}))) as TokenReply;
  if (!res.ok || j.error || !j.access_token) throw new TikTokError(`TikTok sign-in: ${j.error_description ?? j.error ?? res.status}`, res.status || 400, j.error ?? null);
  return j;
}

export async function tiktokExchange(code: string, redirectUri: string): Promise<Tokens & { openId: string | null }> {
  const j = await token({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
  return { ...toTokens(j), openId: j.open_id ?? null };
}

async function call<T>(path: string, access: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json; charset=UTF-8" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
  if (!res.ok || (j.error?.code && j.error.code !== "ok")) throw new TikTokError(`TikTok: ${j.error?.message || res.status}`, res.status, j.error?.code ?? null);
  return j.data as T;
}

/**
 * Who they are on TikTok. The username needs user.info.profile; someone
 * who connected before Hookline asked for it (TIKTOK_PROFILE), or who said
 * no to it, has no username here until they connect again.
 */
export async function tiktokUser(access: string, scopes: string | null): Promise<{ externalId: string; title: string | null; handle: string | null; avatarUrl: string | null }> {
  const profile = (scopes ?? "").split(/[,\s]+/).includes("user.info.profile");
  const d = await call<{ user: { open_id: string; display_name?: string; avatar_url?: string; username?: string } }>(
    `/user/info/?fields=open_id,display_name,avatar_url${profile ? ",username" : ""}`,
    access,
    { method: "GET" },
  );
  return { externalId: d.user.open_id, title: d.user.display_name ?? null, handle: cleanUser(d.user.username), avatarUrl: d.user.avatar_url ?? null };
}

export async function tiktokAccess(channelId: string): Promise<string> {
  const t = await tokensOf(channelId);
  if (!t) throw new TikTokError("No tokens for this account", 401, "no_tokens");
  if (t.expiresAt && t.expiresAt.getTime() > Date.now()) return t.access;
  if (!t.refresh) {
    await markExpired(channelId);
    throw new TikTokError("The account needs connecting again", 401, "no_refresh");
  }
  try {
    const fresh = toTokens(await token({ grant_type: "refresh_token", refresh_token: t.refresh }));
    await updateTokens(channelId, { access: fresh.access, expiresAt: fresh.expiresAt, refresh: fresh.refresh });
    return fresh.access;
  } catch (err) {
    await markExpired(channelId);
    throw err;
  }
}

async function put(uploadUrl: string, bytes: Buffer) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "video/mp4", "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}` },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new TikTokError(`TikTok upload: ${res.status}`, res.status, null);
}

const source = (bytes: Buffer) => ({ source: "FILE_UPLOAD", video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 });

/** Into the creator's TikTok drafts: they get a notification and post it from the app. */
export async function tiktokToDrafts(channelId: string, bytes: Buffer): Promise<string> {
  const access = await tiktokAccess(channelId);
  const d = await call<{ publish_id: string; upload_url: string }>("/post/publish/inbox/video/init/", access, { body: { source_info: source(bytes) } });
  await put(d.upload_url, bytes);
  return d.publish_id;
}

type CreatorReply = {
  creator_nickname?: string;
  creator_username?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

async function creatorWith(access: string): Promise<Creator> {
  const d = await call<CreatorReply>("/post/publish/creator_info/query/", access);
  return {
    nickname: d.creator_nickname || d.creator_username || "your TikTok",
    privacy: (d.privacy_level_options ?? []).filter((p): p is Privacy => (PRIVACY as readonly string[]).includes(p)),
    commentOff: !!d.comment_disabled,
    duetOff: !!d.duet_disabled,
    stitchOff: !!d.stitch_disabled,
    maxSeconds: d.max_video_post_duration_sec || 60,
  };
}

/** Who the creator is on TikTok right now and what they can post, for the choices shown before each Short. */
export async function tiktokCreator(channelId: string): Promise<Creator> {
  return creatorWith(await tiktokAccess(channelId));
}

/**
 * Posted straight to their profile with the choices they made for it,
 * checked again against what TikTok allows the account right now.
 */
export async function tiktokPost(channelId: string, bytes: Buffer, caption: string, choices: TikTokChoices, seconds: number): Promise<string> {
  if (!configured().tiktokDirect) throw new TikTokError("Direct posting isn't on", 403, "not_on");
  const access = await tiktokAccess(channelId);
  const creator = await creatorWith(access);
  const problem = problemWith(choices, creator, seconds);
  if (problem) throw new TikTokError(problem, 400, "choices");
  const d = await call<{ publish_id: string; upload_url: string }>("/post/publish/video/init/", access, {
    body: {
      post_info: { title: caption.slice(0, 2200), ...postSettings(choices, creator), video_cover_timestamp_ms: 1000 },
      source_info: source(bytes),
    },
  });
  await put(d.upload_url, bytes);
  return d.publish_id;
}
