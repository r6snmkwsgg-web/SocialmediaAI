import "server-only";
import { markExpired, tokensOf, updateTokens, type Tokens } from "./channels-store";
import { uploadStatus, YT_PRIVACY, type VideoState, type YouTubePrivacy } from "../shorts/youtube";
import type { Kind, Method } from "../shorts/quota";
import { env } from "./env";
import { closeForToday, spend } from "./quota";

/**
 * YouTube: connecting a channel with Google, uploading the Shorts someone
 * approved (public ones as private, set to go public at their time, which
 * YouTube then does by itself), checking what YouTube made of them, and
 * reading view counts for the learning loop. Every Data API call is made
 * from here, and each is counted in Hookline's quota ledger before it's
 * made (lib/server/quota.ts), with what it's for.
 */

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";

/** What Hookline asks a channel for: uploading, reading the channel and its videos, and its Analytics, revenue included. */
export const UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
export const REVENUE_SCOPE = "https://www.googleapis.com/auth/yt-analytics-monetary.readonly";

export const YOUTUBE_SCOPES = [UPLOAD_SCOPE, READONLY_SCOPE, ANALYTICS_SCOPE, REVENUE_SCOPE];

/** When the daily quota comes back: 00:05 Pacific, five minutes after Google resets it. */
export { quotaResetsAt } from "../shorts/quota";

/** A failure from Google, with whether it's worth trying again later. */
export class YouTubeError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string | null) {
    super(message);
  }
  /** quota and Google's own hiccups pass; a bad request won't */
  get retry(): boolean {
    return this.status >= 500 || this.status === 429 || this.quota || this.reason === "rateLimitExceeded" || this.status === 0;
  }
  /**
   * One of the app's daily allowances is used up: nothing more of that
   * kind goes until it resets. YouTube doesn't document its reason for the
   * allowances it added in June 2026, so any reason naming quota counts,
   * and so does the older dailyLimitExceeded.
   */
  get quota(): boolean {
    return /quota/i.test(this.reason ?? "") || this.reason === "dailyLimitExceeded";
  }
}

/** Google's refusal, as a YouTubeError with its reason when it gave one. */
export async function fail(res: Response, what: string): Promise<never> {
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

/** fail(), for a call the ledger counted: when YouTube says its allowance is used up, that's closed until the reset, whatever Hookline counted. */
export async function failCounted(res: Response, what: string, kind: Kind, method: Method, now: Date): Promise<never> {
  const err = await fail(res, what).catch((e: unknown) => e);
  if (err instanceof YouTubeError && err.quota) await closeForToday(method, kind, now);
  throw err;
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

/** The API key, for a read without a channel's own access. Checked before counting, so a call that can't be made never is. */
function keyFor(access: string | undefined): string | null {
  if (access) return null;
  const key = env().YOUTUBE_API_KEY;
  if (!key) throw new YouTubeError("Nothing to read YouTube with", 0, "noKey");
  return key;
}

/**
 * A Data API read that's already been counted: as a channel, with its
 * access, or with the API key, which sees only public and unlisted
 * videos. With `timeoutMs`, a call YouTube doesn't answer in time is
 * given up on, and passes like an outage.
 */
export async function getCounted<T>(
  kind: Kind, method: Method, path: string, q: Record<string, string>, o: { access?: string; now: Date; what: string; timeoutMs?: number },
): Promise<T> {
  const query = new URLSearchParams(q);
  const key = keyFor(o.access);
  if (key) query.set("key", key);
  try {
    const res = await fetch(`${API}/${path}?${query}`, {
      ...(o.access ? { headers: { authorization: `Bearer ${o.access}` } } : {}),
      ...(o.timeoutMs ? { signal: AbortSignal.timeout(o.timeoutMs) } : {}),
    });
    if (!res.ok) await failCounted(res, o.what, kind, method, o.now);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") throw new YouTubeError(`${o.what}: YouTube didn't answer in time`, 0, "timeout");
    throw err;
  }
}

/** One read, counted and then made: for single calls, like Trends' search and the channel at connect. */
export async function youtubeGet<T>(
  kind: Kind, method: Method, path: string, q: Record<string, string>, o: { access?: string; now?: Date; what: string; timeoutMs?: number },
): Promise<T> {
  const now = o.now ?? new Date();
  keyFor(o.access);
  await spend(kind, method, { now });
  return getCounted<T>(kind, method, path, q, { ...o, now });
}

export async function youtubeChannel(access: string, now = new Date()): Promise<{ externalId: string; title: string | null; handle: string | null; avatarUrl: string | null; madeForKids: boolean | null }> {
  const j = await youtubeGet<{ items?: { id: string; snippet: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } }; status?: { madeForKids?: boolean } }[] }>(
    "other", "channels.list", "channels", { part: "snippet,status", mine: "true" }, { access, now, what: "Reading the channel" },
  );
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

/**
 * Channels' public subscriber counts, rounded down as YouTube rounds them,
 * or hidden when a channel hides its count: up to 50 channels a call with
 * the API key, or with a channel's own access, that channel's. Each call
 * is counted with the views the learning loop reads.
 */
export async function youtubeSubscribers(externalIds: string[], access?: string, now = new Date()): Promise<Map<string, { subscribers: number | null; hidden: boolean }>> {
  const out = new Map<string, { subscribers: number | null; hidden: boolean }>();
  for (const page of access ? [externalIds.slice(0, 1)] : pagesOf(externalIds)) {
    const j = await youtubeGet<{ items?: { id: string; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] }>(
      "stats", "channels.list", "channels", access ? { part: "statistics", mine: "true" } : { part: "statistics", id: page.join(",") }, { access, now, what: "Reading subscribers" },
    );
    for (const it of j.items ?? []) {
      const hidden = it.statistics?.hiddenSubscriberCount === true;
      const count = it.statistics?.subscriberCount === undefined ? NaN : Number(it.statistics.subscriberCount);
      out.set(it.id, { subscribers: hidden || !Number.isFinite(count) ? null : count, hidden });
    }
  }
  return out;
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

/** A call to YouTube that got no answer at all, as a failure that passes like an outage. */
async function reach(url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new YouTubeError(`${what}: YouTube couldn't be reached`, 0, "network");
  }
}

/**
 * Uploads a Short, as the creator chose: public ones with a time go up
 * private and YouTube makes them public then; the rest go up as they are.
 * Who it's for is always sent, never assumed. Counted against the day's
 * uploads first; a token refresh costs no quota, so it comes before that.
 * One that gets no answer at all passes like an outage.
 */
export async function youtubeUpload(
  channelId: string,
  bytes: Buffer,
  meta: { title: string; description: string; publishAt: Date | null; categoryId?: string; privacy: YouTubePrivacy; madeForKids: boolean },
  now = new Date(),
): Promise<string> {
  const access = await youtubeAccess(channelId);
  await spend("uploads", "videos.insert", { now });
  const init = await reach(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
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
  }, "Starting the upload");
  if (!init.ok) await failCounted(init, "Starting the upload", "uploads", "videos.insert", now);
  const where = init.headers.get("location");
  if (!where) throw new YouTubeError("YouTube didn't say where to upload", 500, null);
  const put = await reach(where, { method: "PUT", headers: { "content-type": "video/mp4" }, body: new Uint8Array(bytes) }, "Uploading");
  if (!put.ok) await failCounted(put, "Uploading", "uploads", "videos.insert", now);
  const j = (await put.json()) as { id?: string };
  if (!j.id) throw new YouTubeError("YouTube didn't return the video", 500, null);
  return j.id;
}

type VideoItem = {
  id: string;
  snippet?: { channelId?: string };
  status?: { uploadStatus?: string; privacyStatus?: string; failureReason?: string; rejectionReason?: string; madeForKids?: boolean };
};

/** Ids 50 to a call, the most videos.list takes. */
const pagesOf = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50));

/**
 * Where videos are and what YouTube thinks of them, 50 at a time (1 quota
 * unit each call), counted as `kind`: posting's own checks after an
 * upload, or a pasted link's. The whole batch is counted first, so it
 * never stops halfway. With a channel's own access it sees that channel's
 * private videos too; with the API key, only public and unlisted ones. A
 * video YouTube doesn't know is left out.
 */
export async function youtubeVideoStates(ids: string[], o: { access?: string; kind: "uploads" | "checks"; now?: Date }): Promise<Map<string, VideoState>> {
  const out = new Map<string, VideoState>();
  const now = o.now ?? new Date();
  keyFor(o.access);
  const pages = pagesOf(ids);
  await spend(o.kind, "videos.list", { times: pages.length, now });
  for (const page of pages) {
    const j = await getCounted<{ items?: VideoItem[] }>(o.kind, "videos.list", "videos", { part: "snippet,status", id: page.join(",") }, { access: o.access, now, what: "Checking the video" });
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

/** Public view counts, 50 at a time, counted as views: with the API key if there is one, or a channel's own access. */
export async function youtubeViews(ids: string[], o: { access?: string; now?: Date } = {}): Promise<Map<string, { views: number; likes: number | null; comments: number | null }>> {
  const out = new Map<string, { views: number; likes: number | null; comments: number | null }>();
  const now = o.now ?? new Date();
  keyFor(o.access);
  const pages = pagesOf(ids);
  await spend("stats", "videos.list", { times: pages.length, now });
  for (const page of pages) {
    const j = await getCounted<{ items?: { id: string; statistics: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
      "stats", "videos.list", "videos", { part: "statistics", id: page.join(",") }, { access: o.access, now, what: "Reading views" },
    );
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
