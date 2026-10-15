/**
 * A Short's life, for its page: made, approved, rendered, up on YouTube,
 * public, to TikTok, with what went wrong where it did. Only things that
 * happened (or are booked to) are listed; nothing is guessed.
 */

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

  if (f.uploadedAt) out.push({ at: f.uploadedAt, title: f.postedAt && f.postedAt <= f.uploadedAt ? "Posted on YouTube" : "Up on YouTube, private until its time", tone: "done" });
  else if (f.status === "failed" && f.error && !f.error.startsWith("Rendering failed")) out.push({ at: null, title: "YouTube didn't take it", body: f.error, tone: "bad" });
  if (f.postedAt && !(f.uploadedAt && f.postedAt <= f.uploadedAt)) out.push({ at: f.postedAt, title: f.youtubeId ? "Public on YouTube" : "Marked as posted", tone: "done" });
  else if (!f.postedAt && f.scheduledFor && f.status !== "failed") out.push({ at: f.scheduledFor, title: f.scheduledFor > now ? "Posts" : "Due to post", tone: "next" });

  if (f.tiktokPostedAt) out.push({ at: f.tiktokPostedAt, title: "Sent to TikTok", tone: "done" });
  else if (f.tiktokError) out.push({ at: null, title: "TikTok didn't take it", body: f.tiktokError, tone: "bad" });
  else if (f.tiktokAt) out.push({ at: f.tiktokAt, title: "Goes to TikTok", tone: "next" });
  return out;
}
