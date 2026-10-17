import { describe, expect, it } from "vitest";
import { historyOf, type HistoryFacts } from "@/lib/shorts/history";
import { tiktokCaption } from "@/lib/shorts/tiktok";
import type { Spec } from "@/lib/shorts/types";
import {
  BEST_AROUND, brokenOf, commentsAllowed, commentsOn, keeping, keptNote, markable, POSTS_AT, postsThroughApi, testChannels, uploadStatus, verdictOf, whyFor,
  withAudience, type VideoState,
} from "@/lib/shorts/youtube";
import { TikTokError } from "@/lib/server/tiktok";

const at = (iso: string) => new Date(iso);
const state = (over: Partial<VideoState> = {}): VideoState => ({
  channelId: "UCmine", uploadStatus: "processed", privacy: "public", failureReason: null, rejectionReason: null, madeForKids: false, ...over,
});

describe("who Hookline uploads to YouTube for", () => {
  it("is only the test channels until YouTube's audit passes, then everyone", () => {
    const test = testChannels(" UCaaa, ,UCbbb ");
    expect(test).toEqual(["UCaaa", "UCbbb"]);
    expect(postsThroughApi("UCaaa", { audited: false, test })).toBe(true);
    expect(postsThroughApi("UCzzz", { audited: false, test })).toBe(false);
    expect(postsThroughApi(null, { audited: false, test })).toBe(false);
    expect(postsThroughApi("UCzzz", { audited: true, test: [] })).toBe(true);
    expect(testChannels(undefined)).toEqual([]);
  });
});

describe("an upload's status", () => {
  const when = at("2026-10-20T16:00:00Z");

  it("schedules public Shorts as private until their time, and sends the rest as chosen", () => {
    expect(uploadStatus({ privacy: "public", publishAt: when, madeForKids: false })).toEqual({
      privacyStatus: "private", publishAt: when.toISOString(), selfDeclaredMadeForKids: false, containsSyntheticMedia: false,
    });
    expect(uploadStatus({ privacy: "public", publishAt: null, madeForKids: false })).toMatchObject({ privacyStatus: "public" });
    expect(uploadStatus({ privacy: "unlisted", publishAt: when, madeForKids: false })).not.toHaveProperty("publishAt");
    expect(uploadStatus({ privacy: "private", publishAt: null, madeForKids: false }).privacyStatus).toBe("private");
  });

  it("always says who it's for and that it isn't synthetic media, never leaving YouTube to assume", () => {
    const s = uploadStatus({ privacy: "public", publishAt: null, madeForKids: true });
    expect(s.selfDeclaredMadeForKids).toBe(true);
    expect(s.containsSyntheticMedia).toBe(false);
  });
});

describe("what YouTube's answer means", () => {
  const due = at("2026-10-20T16:00:00Z");
  const uploadedAt = at("2026-10-20T10:00:00Z");
  const f = (now: string, over: Partial<Parameters<typeof verdictOf>[1]> = {}) => ({ wanted: "public" as const, due, uploadedAt, now: at(now), audited: true, ...over });

  it("counts it as posted only once it's processed and can be seen", () => {
    expect(verdictOf(state(), f("2026-10-20T16:01:00Z"))).toEqual({ kind: "posted", privacy: "public" });
    expect(verdictOf(state({ uploadStatus: "uploaded", privacy: "private" }), f("2026-10-20T16:01:00Z"))).toEqual({ kind: "wait" });
    // the creator chose unlisted, or made it unlisted themselves: that's where it is
    expect(verdictOf(state({ privacy: "unlisted" }), f("2026-10-20T16:01:00Z"))).toEqual({ kind: "posted", privacy: "unlisted" });
    expect(verdictOf(state({ privacy: "private" }), f("2026-10-20T16:01:00Z", { wanted: "private" }))).toEqual({ kind: "posted", privacy: "private" });
  });

  it("gives YouTube a while to make a scheduled one public, then says it stayed private", () => {
    const priv = state({ privacy: "private" });
    expect(verdictOf(priv, f("2026-10-20T16:10:00Z"))).toEqual({ kind: "wait" });
    const after = verdictOf(priv, f("2026-10-20T16:45:00Z"));
    expect(after.kind).toBe("private");
    expect(after.kind === "private" && after.message).toMatch(/kept it private/);
    // before the audit, that's why
    const early = verdictOf(priv, f("2026-10-20T16:45:00Z", { audited: false }));
    expect(early.kind === "private" && early.message).toMatch(/Until YouTube finishes reviewing Hookline/);
  });

  it("says plainly when YouTube rejected it, couldn't process it, or it's gone", () => {
    const dup = verdictOf(state({ uploadStatus: "rejected", rejectionReason: "duplicate" }), f("2026-10-20T16:01:00Z"));
    expect(dup).toEqual({ kind: "failed", message: "YouTube rejected it as a copy of a video already on the channel." });
    expect(verdictOf(state({ uploadStatus: "rejected", rejectionReason: "somethingNew" }), f("2026-10-20T16:01:00Z"))).toMatchObject({ kind: "failed", message: /YouTube Studio says why/ });
    expect(verdictOf(state({ uploadStatus: "failed", failureReason: "codec" }), f("2026-10-20T16:01:00Z"))).toMatchObject({ kind: "failed", message: /couldn't process/ });
    expect(verdictOf(state({ uploadStatus: "deleted" }), f("2026-10-20T16:01:00Z"))).toMatchObject({ kind: "failed", message: /isn't on YouTube any more/ });
    // missing straight after an upload may just be YouTube catching up
    const fresh = at("2026-10-20T16:00:00Z");
    expect(verdictOf(null, f("2026-10-20T16:05:00Z", { uploadedAt: fresh }))).toEqual({ kind: "wait" });
    expect(verdictOf(null, f("2026-10-20T16:30:00Z", { uploadedAt: fresh }))).toMatchObject({ kind: "failed" });
    // still processing a day later is given up on
    expect(verdictOf(state({ uploadStatus: "uploaded" }), f("2026-10-21T17:00:00Z"))).toMatchObject({ kind: "failed", message: /a day later/ });
  });

  it("only calls it gone when the channel it went to says so, and otherwise says it couldn't check", () => {
    // the channel it went to isn't connected any more: the API key can't see private videos, so missing proves nothing
    expect(verdictOf(null, f("2026-10-20T16:20:00Z", { asked: "lost" }))).toEqual({ kind: "wait" });
    const lost = verdictOf(null, f("2026-10-20T16:45:00Z", { asked: "lost" }));
    expect(lost).toMatchObject({ kind: "unchecked", message: /lost access to the YouTube channel it went to.*Reconnect/ });
    const elsewhere = verdictOf(null, f("2026-10-20T16:45:00Z", { asked: "elsewhere" }));
    expect(elsewhere).toMatchObject({ kind: "unchecked", message: /couldn't find it on your connected YouTube channel/ });
    for (const v of [lost, elsewhere]) expect(v.kind === "unchecked" && v.message).not.toMatch(/deleted/);
    // found, it's judged like any other
    expect(verdictOf(state({ privacy: "unlisted" }), f("2026-10-20T16:01:00Z", { asked: "lost" }))).toEqual({ kind: "posted", privacy: "unlisted" });
  });

  it("names what's wrong with a rejected, failed or deleted video, and nothing else", () => {
    expect(brokenOf(state({ uploadStatus: "rejected", rejectionReason: "copyright" }))).toBe("YouTube rejected it over copyright.");
    expect(brokenOf(state({ uploadStatus: "failed", failureReason: "uploadAborted" }))).toBe("The upload to YouTube was cut off. Try again.");
    expect(brokenOf(state({ uploadStatus: "deleted" }))).toMatch(/isn't on YouTube any more/);
    expect(brokenOf(state())).toBeNull();
    expect(brokenOf(state({ uploadStatus: "uploaded" }))).toBeNull();
  });
});

describe("what a yes says", () => {
  const youtube = (api: boolean, answered = true) => ({ api, answered });

  it("says it posts only where Hookline posts it", () => {
    expect(keeping({ scheduling: true, youtube: youtube(true), tiktok: false })).toBe("posts");
    // before YouTube's audit, on a channel that isn't a test one: the creator posts it
    expect(keeping({ scheduling: true, youtube: youtube(false), tiktok: false })).toBe("self");
    expect(keeping({ scheduling: true, youtube: null, tiktok: false })).toBe("self");
    // TikTok gets it at its time either way
    expect(keeping({ scheduling: true, youtube: youtube(false), tiktok: true })).toBe("posts");
    expect(keeping({ scheduling: true, youtube: youtube(true, false), tiktok: false })).toBe("answer");
    expect(keeping({ scheduling: false, youtube: youtube(true), tiktok: true })).toBe("self");
  });

  it("names a time as when it posts, or as the best time to post it", () => {
    expect(keptNote("posts", "Tue 4:00 PM")).toBe("Posting Tue 4:00 PM");
    expect(keptNote("self", "Tue 4:00 PM")).toBe("Kept. Best time to post it: Tue 4:00 PM");
    expect(keptNote("self", null)).toBe("Kept. It's being made into a video now.");
    expect(keptNote("answer", "Tue 4:00 PM")).toMatch(/made for kids, in Settings/);
    for (const how of ["posts", "self", "answer"] as const) expect(keptNote(how, "Tue 4:00 PM")).not.toMatch(/—/);
  });

  it("reads a Short's time in its why list the same way", () => {
    const why = ["Battles beat your usual", `${POSTS_AT} 4pm, a starting guess until your own numbers come in`];
    expect(whyFor(why, false)).toEqual(["Battles beat your usual", `${BEST_AROUND} 4pm, a starting guess until your own numbers come in`]);
    expect(whyFor(whyFor(why, false), true)).toEqual(why);
    expect(whyFor(why, true)).toEqual(why);
  });

  it("offers I posted it on a ready Short and on any failed one with a video", () => {
    expect(markable({ status: "ready", hasFile: true, youtubeId: null })).toBe(true);
    // YouTube refused the upload, so the creator may have put it up themselves
    expect(markable({ status: "failed", hasFile: true, youtubeId: null })).toBe(true);
    expect(markable({ status: "failed", hasFile: true, youtubeId: "abc" })).toBe(true);
    expect(markable({ status: "failed", hasFile: false, youtubeId: null })).toBe(false);
    expect(markable({ status: "scheduled", hasFile: true, youtubeId: "abc" })).toBe(false);
    expect(markable({ status: "approved", hasFile: false, youtubeId: null })).toBe(false);
  });
});

describe("made for kids", () => {
  const spec = { format: "wyr", params: { pairs: [] } } as Spec;

  it("turns comments off, whoever said so", () => {
    expect(commentsOn({ madeForKids: false })).toBe(true);
    expect(commentsOn({ madeForKids: null })).toBe(true);
    expect(commentsOn({ madeForKids: true })).toBe(false);
    expect(commentsOn({ madeForKids: false, youtubeKids: true })).toBe(false);
    // YouTube has the whole channel as made for kids, whatever the creator answered
    expect(commentsOn({ madeForKids: false, channelKids: true })).toBe(false);
    expect(commentsOn({ madeForKids: false, channelKids: false })).toBe(true);
  });

  it("makes the Short end without asking for comments, and leaves others exactly as they were", () => {
    const kids = withAudience(spec, true);
    expect(commentsAllowed(kids)).toBe(false);
    expect((kids.params as { allowComments?: boolean }).allowComments).toBe(false);
    expect(withAudience(kids, false)).toEqual(spec);
    expect(withAudience(spec, null)).toEqual(spec);
    expect(commentsAllowed(spec)).toBe(true);
  });
});

describe("TikTok", () => {
  it("leaves YouTube's #shorts out of the caption", () => {
    expect(tiktokCaption("Spike vs Sword", "Who wins? Comment below.\n#shorts #ballbattle #satisfying")).toBe("Spike vs Sword\n\nWho wins? Comment below.\n#ballbattle #satisfying");
    expect(tiktokCaption("Quiz", "#Shorts #quiz #SHORTS")).toBe("Quiz\n\n#quiz");
    expect(tiktokCaption("Only a title", "#shorts")).toBe("Only a title");
    expect(tiktokCaption("T", "#shortsfeed stays")).toBe("T\n\n#shortsfeed stays");
  });

  it("tries again tomorrow when its daily cap for apps under review is full", () => {
    const cap = new TikTokError("TikTok: full", 403, "reached_active_user_cap");
    expect(cap.tomorrow).toBe(true);
    expect(cap.retry).toBe(false);
    expect(new TikTokError("TikTok: no", 403, "spam_risk_user_banned_from_posting").tomorrow).toBe(false);
  });
});

describe("a Short's history, as YouTube tells it", () => {
  const base: HistoryFacts = {
    createdAt: at("2026-10-01T21:00:00Z"), origin: "daily", decidedAt: at("2026-10-01T23:00:00Z"), status: "ready",
    scheduledFor: at("2026-10-02T19:00:00Z"), render: { status: "done", finishedAt: at("2026-10-02T00:00:00Z"), error: null },
    uploadedAt: null, youtubeId: null, postedAt: null, tiktokAt: null, tiktokPostedAt: null, tiktokError: null, error: null,
  };

  it("calls a suggested time a best time when the creator posts it", () => {
    expect(historyOf({ ...base, byHand: true }).at(-1)).toMatchObject({ title: "Best time to post it", tone: "next" });
  });

  it("says when YouTube didn't make an upload public", () => {
    const kept = historyOf({
      ...base, status: "failed", uploadedAt: at("2026-10-02T01:00:00Z"), publishAt: base.scheduledFor, youtubeId: "abc", error: "YouTube kept it private, so nobody can see it.",
    });
    expect(kept.slice(-2).map((s) => [s.title, s.tone])).toEqual([["Up on YouTube, private until its time", "done"], ["YouTube didn't make it public", "bad"]]);
  });

  it("only says private until its time when it went up that way", () => {
    // unlisted goes up as it is, a few minutes before its time, and is unlisted from then on
    const uploadedAt = at("2026-10-02T18:50:00Z");
    const unlisted = historyOf({ ...base, status: "posted", uploadedAt, postedAt: uploadedAt, youtubeId: "abc", verified: true, youtubePrivacy: "unlisted" });
    expect(unlisted.slice(3).map((s) => s.title)).toEqual(["Unlisted on YouTube"]);
    expect(unlisted.map((s) => s.title)).not.toContain("Up on YouTube, private until its time");
    // public with a time: private until then, public at it
    const later = at("2026-10-02T19:00:00Z");
    const scheduled = historyOf({ ...base, status: "posted", uploadedAt, publishAt: later, postedAt: later, youtubeId: "abc", verified: true, youtubePrivacy: "public" });
    expect(scheduled.slice(3).map((s) => s.title)).toEqual(["Up on YouTube, private until its time", "Public on YouTube"]);
  });

  it("calls a kept Short's time the best time to post it from the start, when the creator posts it", () => {
    const approved = historyOf({ ...base, status: "approved", render: null, byHand: true });
    expect(approved.at(-1)).toMatchObject({ title: "Best time to post it", tone: "next" });
    expect(historyOf({ ...base, status: "approved", render: null }, at("2026-10-02T01:00:00Z")).at(-1)?.title).toBe("Posts");
  });

  it("names where it is, and doesn't call an unchecked link public", () => {
    const posted = { ...base, status: "posted", postedAt: at("2026-10-02T19:00:00Z"), youtubeId: "abc" };
    expect(historyOf({ ...posted, verified: true, youtubePrivacy: "unlisted" }).at(-1)?.title).toBe("Unlisted on YouTube");
    expect(historyOf({ ...posted, verified: false }).at(-1)?.title).toBe("Marked as posted");
  });
});
