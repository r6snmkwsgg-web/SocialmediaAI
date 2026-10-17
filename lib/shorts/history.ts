/**
 * A Short's life, for its page: made, approved, rendered, up on YouTube,
 * public, to TikTok, with what went wrong where it did. Only things that
 * happened (or are booked to) are listed; nothing is guessed. "Public"
 * only ever comes from YouTube saying so, or a link checked with it.
 */

/**
 * What a ready Short is waiting for before it can go up, and when it's
 * tried again: YouTube's uploads for Hookline today (used up by YouTube's
 * word or Hookline's own count), or its plan's uploads today.
 */
export type HeldBack = { on: "youtube_quota" | "plan_cap"; until: Date | null };

/** A wait as it's shown: what for, and when it goes up. */
export type Held = { on: HeldBack["on"]; until: Date };

/** The plan, as a plan wait names it: its name, and the Shorts it uploads a day (uploadCap). */
export type HeldPlan = { name: string; cap: number };

/**
 * How each wait reads, written once for the queue, the Short's page and
 * its history: its pill, its step, its line in the queue, and the box on
 * the Short's page with its lead. {time} is when it goes up, shown in the
 * viewer's own timezone.
 */
export const HELD: Record<Held["on"], { pill: string; step: string; line: (p: HeldPlan) => string; lead: (p: HeldPlan) => string; box: (p: HeldPlan) => string }> = {
  youtube_quota: {
    pill: "Waiting for quota",
    step: "Waiting for YouTube upload quota",
    line: () => "Waiting for YouTube upload quota. It goes up when that resets, around {time}.",
    lead: () => "Waiting for YouTube upload quota.",
    box: () => "YouTube caps how many videos Hookline can upload a day, and today's are used up. It goes up when that resets, around {time}.",
  },
  plan_cap: {
    pill: "Daily uploads done",
    step: "Waiting for your plan's next uploads",
    line: (p) => `${p.name} uploads up to ${p.cap} Shorts a day to YouTube, and today's are done. This one goes up around {time}.`,
    lead: (p) => `Today's uploads on ${p.name} are done.`,
    box: (p) => `${p.name} uploads up to ${p.cap} Shorts a day to YouTube. This one goes up when that resets, around {time}.`,
  },
};

/**
 * The wait to show, if any. A plan wait shows only while the plan still
 * uploads (`cap` is its uploads a day): after a move to Free, a Short
 * reads like any other Free one, never "Free uploads up to 0".
 */
export function heldShown(h: HeldBack | null | undefined, cap: number): Held | null {
  if (!h?.until || (h.on === "plan_cap" && cap <= 0)) return null;
  return { on: h.on, until: h.until };
}

export type HistoryFacts = {
  createdAt: Date;
  origin: "daily" | "replacement";
  decidedAt: Date | null;
  status: string;
  scheduledFor: Date | null;
  render: { status: string; finishedAt: Date | null; error: string | null } | null;
  uploadedAt: Date | null;
  youtubeId: string | null;
  postedAt: Date | null;
  tiktokAt: Date | null;
  tiktokPostedAt: Date | null;
  tiktokError: string | null;
  error: string | null;
  /** the time it was set to go public, when it went up private until then */
  publishAt?: Date | null;
  /** who can see it, as YouTube last said */
  youtubePrivacy?: string | null;
  /** its link was checked with YouTube, or Hookline uploaded it */
  verified?: boolean;
  /** the creator posts it themselves: its time is a suggestion */
  byHand?: boolean;
  heldBack?: HeldBack | null;
};

export type Step = { at: Date | null; title: string; body?: string; tone: "done" | "next" | "bad" };

export function historyOf(f: HistoryFacts, now = new Date()): Step[] {
  const out: Step[] = [{ at: f.createdAt, title: f.origin === "replacement" ? "Made to replace one you skipped" : "Made for your queue", tone: "done" }];
  if (f.status === "rejected") return [...out, { at: f.decidedAt, title: "You skipped it", tone: "done" }];
  if (!f.decidedAt) return [...out, { at: null, title: "Waiting for your yes or no", tone: "next" }];
  out.push({ at: f.decidedAt, title: "You said yes", tone: "done" });

  if (f.render?.status === "done") out.push({ at: f.render.finishedAt, title: "Made into a video", tone: "done" });
  else if (f.status === "failed" && f.error?.startsWith("Rendering failed")) out.push({ at: f.render?.finishedAt ?? null, title: "Couldn't be made into a video", body: f.error ?? undefined, tone: "bad" });
  else out.push({ at: null, title: f.render?.status === "running" ? "Being made into a video now" : "Waiting to be made into a video", tone: "next" });

  if (!f.uploadedAt && f.heldBack && f.status === "ready") out.push({ at: null, title: HELD[f.heldBack.on].step, tone: "next" });
  const seen = f.youtubePrivacy === "unlisted" ? "Unlisted on YouTube" : f.youtubePrivacy === "private" ? "Private on YouTube" : "Public on YouTube";
  const youtubeFailed = f.status === "failed" && !!f.error && !f.error.startsWith("Rendering failed");
  if (f.uploadedAt) {
    const title = f.postedAt && f.postedAt <= f.uploadedAt ? seen : f.publishAt ? "Up on YouTube, private until its time" : "Up on YouTube";
    out.push({ at: f.uploadedAt, title, tone: "done" });
    if (youtubeFailed) out.push({ at: null, title: "YouTube didn't make it public", body: f.error ?? undefined, tone: "bad" });
  } else if (youtubeFailed) out.push({ at: null, title: "YouTube didn't take it", body: f.error ?? undefined, tone: "bad" });
  if (f.postedAt && !(f.uploadedAt && f.postedAt <= f.uploadedAt)) {
    out.push({ at: f.postedAt, title: f.youtubeId && f.verified !== false ? seen : "Marked as posted", tone: "done" });
  } else if (!f.postedAt && f.scheduledFor && f.status !== "failed") {
    out.push({ at: f.scheduledFor, title: f.byHand ? "Best time to post it" : f.scheduledFor > now ? "Posts" : "Due to post", tone: "next" });
  }

  if (f.tiktokPostedAt) out.push({ at: f.tiktokPostedAt, title: "Sent to TikTok", tone: "done" });
  else if (f.tiktokError) out.push({ at: null, title: "TikTok didn't take it", body: f.tiktokError, tone: "bad" });
  else if (f.tiktokAt) out.push({ at: f.tiktokAt, title: "Goes to TikTok", tone: "next" });
  return out;
}
