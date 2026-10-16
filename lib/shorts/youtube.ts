import type { Spec } from "./types";

/**
 * What YouTube says about a Short, and what Hookline makes of it. A
 * Short only counts as posted once YouTube says it's processed and can be
 * seen the way the creator chose; anything else (rejected, failed, kept
 * private) is said plainly and never counted. Who a Short is for (made for
 * kids or not) is the creator's choice, sent with every upload.
 */

export const YT_PRIVACY = ["public", "unlisted", "private"] as const;
export type YouTubePrivacy = (typeof YT_PRIVACY)[number];

export const YT_PRIVACY_LABEL: Record<YouTubePrivacy, string> = { public: "Public", unlisted: "Unlisted", private: "Private" };

/** Where a creator uploads a Short themselves. */
export const STUDIO_UPLOAD = "https://www.youtube.com/upload";

/** YouTube's guide to whether a channel or video is made for kids. */
export const KIDS_GUIDE = "https://support.google.com/youtube/answer/9528076";

/** A video as YouTube's videos.list describes it (its snippet and status). */
export type VideoState = {
  channelId: string | null;
  /** uploaded (still processing), processed, failed, rejected or deleted */
  uploadStatus: string | null;
  privacy: YouTubePrivacy | null;
  failureReason: string | null;
  rejectionReason: string | null;
  /** YouTube's own verdict, whatever the creator said */
  madeForKids: boolean | null;
};

/**
 * Who can post through the API: everyone once YouTube's audit has passed,
 * and before that only the test channels, since YouTube keeps everything
 * an unaudited app uploads private.
 */
export type ApiAccess = { audited: boolean; test: string[] };

export function testChannels(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function postsThroughApi(externalId: string | null | undefined, a: ApiAccess): boolean {
  return a.audited || (!!externalId && a.test.includes(externalId));
}

/**
 * The status part of an upload. Public Shorts with a time go up private
 * and YouTube makes them public then; unlisted and private ones go up as
 * they are, at their time. The audience is always said out loud, and so is
 * that nothing in them is realistic altered or synthetic media: they're
 * drawn by code.
 */
export function uploadStatus(m: { privacy: YouTubePrivacy; publishAt: Date | null; madeForKids: boolean }) {
  const scheduled = m.privacy === "public" && m.publishAt;
  return {
    privacyStatus: scheduled ? "private" : m.privacy,
    ...(scheduled ? { publishAt: m.publishAt!.toISOString() } : {}),
    selfDeclaredMadeForKids: m.madeForKids,
    containsSyntheticMedia: false,
  };
}

const REJECTED: Record<string, string> = {
  claim: "YouTube rejected it over a rights claim.",
  copyright: "YouTube rejected it over copyright.",
  duplicate: "YouTube rejected it as a copy of a video already on the channel.",
  inappropriate: "YouTube rejected it as inappropriate.",
  legal: "YouTube rejected it for a legal reason.",
  length: "YouTube rejected it as too long.",
  termsOfUse: "YouTube rejected it under its terms of use.",
  trademark: "YouTube rejected it over a trademark.",
  uploaderAccountClosed: "YouTube rejected it because the channel is closed.",
  uploaderAccountSuspended: "YouTube rejected it because the channel is suspended.",
};

const FAILED: Record<string, string> = {
  uploadAborted: "The upload to YouTube was cut off. Try again.",
  emptyFile: "YouTube got an empty file. Try again.",
};

const GONE = "It isn't on YouTube any more. It may have been deleted there.";

/** What's wrong with a video YouTube rejected, couldn't process or deleted, in plain words; null when nothing is. */
export function brokenOf(s: VideoState): string | null {
  if (s.uploadStatus === "deleted") return GONE;
  if (s.uploadStatus === "rejected") return REJECTED[s.rejectionReason ?? ""] ?? "YouTube rejected it. YouTube Studio says why.";
  if (s.uploadStatus === "failed") return FAILED[s.failureReason ?? ""] ?? "YouTube couldn't process the video. Try again.";
  return null;
}

/**
 * Who a Short was looked up as. Only the channel it went to sees its
 * private videos, so only that one can say it's gone:
 * - "uploader": the channel it went to.
 * - "lost": that channel isn't connected any more (expired or revoked), so
 *   the API key asked, which only sees public and unlisted videos.
 * - "elsewhere": which channel it went to isn't known (it was disconnected,
 *   or Hookline uploaded it before it kept that), so their first connected
 *   channel asked.
 */
export type AskedAs = "uploader" | "lost" | "elsewhere";

const UNCHECKED: Record<Exclude<AskedAs, "uploader">, string> = {
  lost: "Hookline lost access to the YouTube channel it went to, so it couldn't check it. Reconnect the channel in Settings, then try again.",
  elsewhere: "Hookline couldn't find it on your connected YouTube channel. If it went to a different channel, connect that one in Settings, then try again.",
};

export type Verdict =
  | { kind: "wait" }
  | { kind: "posted"; privacy: YouTubePrivacy }
  /** processed, but nobody can see it when they should */
  | { kind: "private"; message: string }
  | { kind: "failed"; message: string }
  /** not found, but by someone who can't see everything on the channel it went to: nothing is known about it */
  | { kind: "unchecked"; message: string };

const MINUTE = 60_000;

/**
 * What a Short's state on YouTube means, once its time has come. YouTube
 * takes a little while to process a video and to make a scheduled one
 * public, so a Short gets a grace period before it's called private or
 * missing; one still processing a day later is given up on. Missing only
 * means gone when the channel it went to says so.
 */
export function verdictOf(
  s: VideoState | null,
  f: { wanted: YouTubePrivacy; due: Date; uploadedAt: Date; now: Date; audited: boolean; asked?: AskedAs },
): Verdict {
  const since = (d: Date) => f.now.getTime() - d.getTime();
  const late = since(new Date(Math.max(f.due.getTime(), f.uploadedAt.getTime())));
  const asked = f.asked ?? "uploader";
  if (!s && asked !== "uploader") return late < 30 * MINUTE ? { kind: "wait" } : { kind: "unchecked", message: UNCHECKED[asked] };
  if (!s) return since(f.uploadedAt) < 15 * MINUTE ? { kind: "wait" } : { kind: "failed", message: GONE };
  const broken = brokenOf(s);
  if (broken) return { kind: "failed", message: broken };
  if (s.uploadStatus !== "processed") {
    return late < 24 * 60 * MINUTE ? { kind: "wait" } : { kind: "failed", message: "YouTube still hadn't finished processing it a day later. Check it in YouTube Studio." };
  }
  const privacy = s.privacy ?? "private";
  if (privacy !== "private" || f.wanted === "private") return { kind: "posted", privacy };
  if (since(f.due) < 30 * MINUTE) return { kind: "wait" };
  return {
    kind: "private",
    message: f.audited
      ? "YouTube kept it private, so nobody can see it. Open it in YouTube Studio to see why."
      : "YouTube kept it private, so nobody can see it. Until YouTube finishes reviewing Hookline, everything Hookline uploads stays private.",
  };
}

/**
 * Whether people can comment on a Short: not when it's made for kids, by
 * the creator's choice, by YouTube's verdict on the video, or by YouTube's
 * verdict on the whole channel (which turns comments off on all of it).
 */
export function commentsOn(a: { madeForKids: boolean | null; youtubeKids?: boolean | null; channelKids?: boolean | null }): boolean {
  return a.madeForKids !== true && a.youtubeKids !== true && a.channelKids !== true;
}

/** What the video's ending reads: params.allowComments, true unless it's been turned off. */
export function commentsAllowed(spec: Spec): boolean {
  return (spec.params as { allowComments?: boolean }).allowComments !== false;
}

/** The Short as it'll be made for this audience: one made for kids ends without asking for comments. */
export function withAudience(spec: Spec, madeForKids: boolean | null): Spec {
  const params: Record<string, unknown> = { ...spec.params };
  if (madeForKids) params.allowComments = false;
  else delete params.allowComments;
  return { ...spec, params } as Spec;
}

/**
 * What happens to a Short once it's kept: Hookline posts it at its time
 * (to YouTube where it may upload, or to TikTok with the creator's
 * choices), it waits for the channel's "made for kids?" answer first, or
 * the creator posts it themselves.
 */
export type Keeping = "posts" | "answer" | "self";

export function keeping(a: { scheduling: boolean; youtube: { api: boolean; answered: boolean } | null; tiktok: boolean }): Keeping {
  if (!a.scheduling) return "self";
  // TikTok gets it at its time whatever YouTube is waiting for
  if (a.tiktok) return "posts";
  if (a.youtube?.api) return a.youtube.answered ? "posts" : "answer";
  return "self";
}

/** The toast after a yes: a time it posts only when something will post it, and otherwise the best time to post it. */
export function keptNote(how: Keeping, when: string | null): string {
  if (how === "posts" && when) return `Posting ${when}`;
  if (how === "answer") return "Kept. Say whether your channel is made for kids, in Settings, and it posts.";
  if (how === "self" && when) return `Kept. Best time to post it: ${when}`;
  return "Kept. It's being made into a video now.";
}

/** How a Short's "why" names its time, set when it's made: "Posts at 4pm", or "Best posted around 4pm". */
export const POSTS_AT = "Posts at";
export const BEST_AROUND = "Best posted around";

/** The "why" list as it reads now: its time is when it posts only if Hookline will post it. */
export function whyFor(why: string[], posts: boolean): string[] {
  const [from, to] = posts ? [BEST_AROUND, POSTS_AT] : [POSTS_AT, BEST_AROUND];
  return why.map((w) => (w.startsWith(`${from} `) ? `${to}${w.slice(from.length)}` : w));
}

/**
 * Whether "I posted it" applies: a rendered Short waiting for the creator,
 * or one that failed on its way, to YouTube or in it. Each is one
 * markPosted accepts.
 */
export function markable(c: { status: string; hasFile: boolean; youtubeId: string | null }): boolean {
  return c.hasFile && ((c.status === "ready" && !c.youtubeId) || c.status === "failed");
}
