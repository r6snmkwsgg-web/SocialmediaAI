import "server-only";
import { markExpired, tokensOf, updateTokens, type Tokens } from "./channels-store";
import { env } from "./env";

/**
 * YouTube: connecting a channel with Google, uploading the Shorts someone
 * approved (as private, set to go public at its time, which YouTube then
 * does by itself), and reading view counts for the learning loop.
 */

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
];

/** A failure from Google, with whether it's worth trying again later. */
export class YouTubeError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string | null) {
    super(message);
  }
  /** quota and Google's own hiccups pass; a bad request won't */
  get retry(): boolean {
    return this.status >= 500 || this.status === 429 || this.reason === "quotaExceeded" || this.reason === "rateLimitExceeded" || this.status === 0;
  }
}

async function fail(res: Response, what: string): Promise<never> {
  let reason: string | null = null;
  let message = `${what}: ${res.status}`;
  try {
    const j = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } | string; error_description?: string };
    if (typeof j.error === "object") {
      reason = j.error.errors?.[0]?.reason ?? null;
      message = `${what}: ${j.error.message ?? res.status}`;
    } else if (j.error) {
      reason = j.error;
      message = `${what}: ${j.error_description ?? j.error}`;
    }
  } catch {
    // not JSON
  }
  throw new YouTubeError(message, res.status, reason);
}

function creds() {
  const e = env();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) throw new Error("Google isn't set up.");
  return { id: e.GOOGLE_CLIENT_ID, secret: e.GOOGLE_CLIENT_SECRET };
}

export function youtubeAuthUrl(state: string, redirectUri: string): string {
  const q = new URLSearchParams({
    client_id: creds().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${AUTH}?${q}`;
}

function toTokens(j: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }): Tokens {
  return {
    access: j.access_token,
    refresh: j.refresh_token ?? null,
    expiresAt: j.expires_in ? new Date(Date.now() + (j.expires_in - 60) * 1000) : null,
    scopes: j.scope ?? null,
  };
}

export async function youtubeExchange(code: string, redirectUri: string): Promise<Tokens> {
  const { id, secret } = creds();
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!res.ok) await fail(res, "Google sign-in");
  return toTokens(await res.json());
}

export async function youtubeChannel(access: string): Promise<{ externalId: string; title: string | null; handle: string | null; avatarUrl: string | null }> {
  const res = await fetch(`${API}/channels?part=snippet&mine=true`, { headers: { authorization: `Bearer ${access}` } });
  if (!res.ok) await fail(res, "Reading the channel");
  const j = (await res.json()) as { items?: { id: string; snippet: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } }[] };
  const c = j.items?.[0];
  if (!c) throw new YouTubeError("That Google account doesn't have a YouTube channel yet.", 404, "noChannel");
  return { externalId: c.id, title: c.snippet.title ?? null, handle: c.snippet.customUrl ?? null, avatarUrl: c.snippet.thumbnails?.default?.url ?? null };
}

/** A working access token for a channel, refreshed when it's run out. */
export async function youtubeAccess(channelId: string): Promise<string> {
  const t = await tokensOf(channelId);
  if (!t) throw new YouTubeError("No tokens for this channel", 401, "noTokens");
  if (t.expiresAt && t.expiresAt.getTime() > Date.now()) return t.access;
  if (!t.refresh) {
    await markExpired(channelId);
    throw new YouTubeError("The channel needs connecting again", 401, "noRefresh");
  }
  const { id, secret } = creds();
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: t.refresh, grant_type: "refresh_token" }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) await markExpired(channelId);
    await fail(res, "Refreshing access");
  }
  const fresh = toTokens(await res.json());
  await updateTokens(channelId, { access: fresh.access, expiresAt: fresh.expiresAt, refresh: fresh.refresh });
  return fresh.access;
}

/**
 * Uploads a Short. With a time, it goes up private and YouTube makes it
 * public at that time; without one, it's public straight away.
 */
export async function youtubeUpload(channelId: string, bytes: Buffer, meta: { title: string; description: string; publishAt: Date | null; categoryId?: string }): Promise<string> {
  const access = await youtubeAccess(channelId);
  const init = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": "video/mp4",
      "x-upload-content-length": String(bytes.length),
    },
    body: JSON.stringify({
      snippet: { title: meta.title.slice(0, 100), description: meta.description.slice(0, 4900), categoryId: meta.categoryId ?? "24" },
      status: meta.publishAt
        ? { privacyStatus: "private", publishAt: meta.publishAt.toISOString(), selfDeclaredMadeForKids: false }
        : { privacyStatus: "public", selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) await fail(init, "Starting the upload");
  const where = init.headers.get("location");
  if (!where) throw new YouTubeError("YouTube didn't say where to upload", 500, null);
  const put = await fetch(where, { method: "PUT", headers: { "content-type": "video/mp4" }, body: new Uint8Array(bytes) });
  if (!put.ok) await fail(put, "Uploading");
  const j = (await put.json()) as { id?: string };
  if (!j.id) throw new YouTubeError("YouTube didn't return the video", 500, null);
  return j.id;
}

/** Public view counts, 50 at a time: with the API key if there is one, or a channel's own access. */
export async function youtubeViews(ids: string[], access?: string): Promise<Map<string, { views: number; likes: number | null; comments: number | null }>> {
  const out = new Map<string, { views: number; likes: number | null; comments: number | null }>();
  const key = env().YOUTUBE_API_KEY;
  for (let i = 0; i < ids.length; i += 50) {
    const q = new URLSearchParams({ part: "statistics", id: ids.slice(i, i + 50).join(",") });
    if (!access && key) q.set("key", key);
    const res = await fetch(`${API}/videos?${q}`, access ? { headers: { authorization: `Bearer ${access}` } } : undefined);
    if (!res.ok) await fail(res, "Reading views");
    const j = (await res.json()) as { items?: { id: string; statistics: { viewCount?: string; likeCount?: string; commentCount?: string } }[] };
    for (const it of j.items ?? []) {
      out.set(it.id, {
        views: Number(it.statistics.viewCount ?? 0),
        likes: it.statistics.likeCount === undefined ? null : Number(it.statistics.likeCount),
        comments: it.statistics.commentCount === undefined ? null : Number(it.statistics.commentCount),
      });
    }
  }
  return out;
}

/** The video's id from a link someone pastes: youtube.com/shorts/ID, watch?v=ID, youtu.be/ID. */
export function youtubeIdFrom(link: string): string | null {
  const m = link.trim().match(/(?:youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(link.trim()) ? link.trim() : null;
}
