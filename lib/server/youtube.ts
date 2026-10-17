import "server-only";
import { atLocal, localParts } from "../shorts/times";
import { markExpired, tokensOf, updateTokens, type Tokens } from "./channels-store";
import { uploadStatus, YT_PRIVACY, type VideoState, type YouTubePrivacy } from "../shorts/youtube";
import { env } from "./env";

/**
 * YouTube: connecting a channel with Google, uploading the Shorts someone
 * approved (public ones as private, set to go public at their time, which
 * YouTube then does by itself), checking what YouTube made of them, and
 * reading view counts for the learning loop.
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
  /** the app's daily quota is used up: nothing more goes up until it resets */
  get quota(): boolean {
    return this.reason === "quotaExceeded";
  }
}

/**
 * When the daily quota comes back: Google resets it at midnight Pacific
 * time. A few minutes after, so the first try isn't early.
 */
export function quotaResetsAt(now: Date): Date {
  const tz = "America/Los_Angeles";
  const p = localParts(now, tz);
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return new Date(atLocal(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, tz).getTime() + 5 * 60_000);
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
    // Google's account chooser every time, so another channel (or a Brand Account) can be picked, and consent so a refresh token comes back
    prompt: "consent select_account",
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

export async function youtubeChannel(access: string): Promise<{ externalId: string; title: string | null; handle: string | null; avatarUrl: string | null; madeForKids: boolean | null }> {
  const res = await fetch(`${API}/channels?part=snippet,status&mine=true`, { headers: { authorization: `Bearer ${access}` } });
  if (!res.ok) await fail(res, "Reading the channel");
  const j = (await res.json()) as { items?: { id: string; snippet: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } }; status?: { madeForKids?: boolean } }[] };
  const c = j.items?.[0];
  if (!c) throw new YouTubeError("That Google account doesn't have a YouTube channel yet.", 404, "noChannel");
  return {
    externalId: c.id,
    title: c.snippet.title ?? null,
    handle: c.snippet.customUrl ?? null,
    avatarUrl: c.snippet.thumbnails?.default?.url ?? null,
    // YouTube's own verdict on the whole channel, which wins over anything said per video
    madeForKids: typeof c.status?.madeForKids === "boolean" ? c.status.madeForKids : null,
  };
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
 * Uploads a Short, as the creator chose: public ones with a time go up
 * private and YouTube makes them public then; the rest go up as they are.
 * Who it's for is always sent, never assumed.
 */
export async function youtubeUpload(
  channelId: string,
  bytes: Buffer,
  meta: { title: string; description: string; publishAt: Date | null; categoryId?: string; privacy: YouTubePrivacy; madeForKids: boolean },
): Promise<string> {
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
      status: uploadStatus(meta),
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

type VideoItem = {
  id: string;
  snippet?: { channelId?: string };
  status?: { uploadStatus?: string; privacyStatus?: string; failureReason?: string; rejectionReason?: string; madeForKids?: boolean };
};

/**
 * Where videos are and what YouTube thinks of them, 50 at a time (1 quota
 * unit each call). With a channel's own access it sees that channel's
 * private videos too; with the API key, only public and unlisted ones.
 * A video YouTube doesn't know is left out.
 */
export async function youtubeVideoStates(ids: string[], access?: string): Promise<Map<string, VideoState>> {
  const out = new Map<string, VideoState>();
  const key = env().YOUTUBE_API_KEY;
  if (!access && !key) throw new YouTubeError("Nothing to read YouTube with", 0, "noKey");
  for (let i = 0; i < ids.length; i += 50) {
    const q = new URLSearchParams({ part: "snippet,status", id: ids.slice(i, i + 50).join(",") });
    if (!access && key) q.set("key", key);
    const res = await fetch(`${API}/videos?${q}`, access ? { headers: { authorization: `Bearer ${access}` } } : undefined);
    if (!res.ok) await fail(res, "Checking the video");
    const j = (await res.json()) as { items?: VideoItem[] };
    for (const it of j.items ?? []) {
      const p = it.status?.privacyStatus;
      out.set(it.id, {
        channelId: it.snippet?.channelId ?? null,
        uploadStatus: it.status?.uploadStatus ?? null,
        privacy: (YT_PRIVACY as readonly string[]).includes(p ?? "") ? (p as YouTubePrivacy) : null,
        failureReason: it.status?.failureReason ?? null,
        rejectionReason: it.status?.rejectionReason ?? null,
        madeForKids: typeof it.status?.madeForKids === "boolean" ? it.status.madeForKids : null,
      });
    }
  }
  return out;
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
