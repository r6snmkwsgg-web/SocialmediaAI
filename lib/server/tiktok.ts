import "server-only";
import { markExpired, tokensOf, updateTokens, type Tokens } from "./channels-store";
import { configured, env } from "./env";

/**
 * TikTok: connecting an account, then either posting for the creator
 * (once TikTok has approved the app for direct posting) or sending the
 * video to their TikTok drafts, where they finish it in the app. TikTok
 * has no way to schedule a post, so posting happens at the chosen time.
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
}

function creds() {
  const e = env();
  if (!e.TIKTOK_CLIENT_KEY || !e.TIKTOK_CLIENT_SECRET) throw new Error("TikTok isn't set up.");
  return { key: e.TIKTOK_CLIENT_KEY, secret: e.TIKTOK_CLIENT_SECRET };
}

/** what we ask TikTok for: who they are, their videos' views, and uploading; posting only once approved */
export function tiktokScopes(): string[] {
  return ["user.info.basic", "video.list", "video.upload", ...(configured().tiktokPosting ? ["video.publish"] : [])];
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

export async function tiktokUser(access: string): Promise<{ externalId: string; title: string | null; handle: string | null; avatarUrl: string | null }> {
  const d = await call<{ user: { open_id: string; display_name?: string; avatar_url?: string } }>("/user/info/?fields=open_id,display_name,avatar_url", access, { method: "GET" });
  return { externalId: d.user.open_id, title: d.user.display_name ?? null, handle: null, avatarUrl: d.user.avatar_url ?? null };
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

/** Posted straight to their profile: only once TikTok has approved the app for it. */
export async function tiktokPost(channelId: string, bytes: Buffer, caption: string): Promise<string> {
  if (!configured().tiktokPosting) throw new TikTokError("Direct posting isn't approved yet", 403, "not_approved");
  const access = await tiktokAccess(channelId);
  const info = await call<{ privacy_level_options: string[] }>("/post/publish/creator_info/query/", access);
  const privacy = info.privacy_level_options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : info.privacy_level_options[0];
  const d = await call<{ publish_id: string; upload_url: string }>("/post/publish/video/init/", access, {
    body: {
      post_info: { title: caption.slice(0, 2200), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 },
      source_info: source(bytes),
    },
  });
  await put(d.upload_url, bytes);
  return d.publish_id;
}
