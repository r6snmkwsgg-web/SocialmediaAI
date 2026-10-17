import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  BUCKETS, capOf, CONNECT_WAIT, DEFAULT_LIMITS, fits, heldOf, KIND_NAMES, KINDS, lastWeek, limitsFrom, METHODS, quotaDay, quotaDayStart, quotaResetsAt, SHARES,
  tryAgainIn, USES, type Bucket, type Method,
} from "@/lib/shorts/quota";
import { PLANS, uploadCap } from "@/lib/billing/plans";
import { HELD, heldShown, historyOf, type HeldBack, type HistoryFacts } from "@/lib/shorts/history";
import { checkAgain, hasScope } from "@/lib/shorts/youtube";
import { dueNiches, kidsOf, NICHES, staleLines, staleOf, type TrendCheck } from "@/lib/trends/niches";
import { ANALYTICS_SCOPE, quotaResetsAt as resetFromYouTube, READONLY_SCOPE, REVENUE_SCOPE, UPLOAD_SCOPE, YOUTUBE_SCOPES, YouTubeError } from "@/lib/server/youtube";

// coming back from Google to connect a channel, for the callback's test: someone signed in, with a code to swap, whose
// channel can't be read. Everything else from lib/server/youtube.ts is the real thing
const reading = vi.hoisted(() => vi.fn<() => Promise<never>>());
vi.mock("@/lib/server/auth", () => ({ currentUser: async () => ({ id: "w2-quota", email: "w2-quota@test.local" }) }));
vi.mock("@/lib/server/http", () => ({ origin: async () => "https://hookline.test" }));
// where connecting started, which the state Google sends back stands for
vi.mock("@/lib/server/oauth", () => ({ finishOAuth: async (_platform: string, state: string | null) => (state ? { next: state } : null) }));
vi.mock("@/lib/server/billing", () => ({ billingFor: async () => ({ plan: null }) }));
vi.mock("@/lib/server/channels", () => ({ channelsOf: async () => [], connectChannel: async () => null }));
vi.mock("@/lib/server/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/youtube")>()),
  youtubeExchange: async () => ({ access: "ya29.w2q", refresh: null, expiresAt: null, scopes: null }),
  youtubeChannel: reading,
}));

const at = (iso: string) => new Date(iso);

describe("the quota day", () => {
  it("runs from 00:05 to 00:05 Pacific, so the minutes just after midnight belong to the day before", () => {
    expect(quotaDay(at("2026-10-17T07:02:00Z"))).toBe("2026-10-16");
    expect(quotaResetsAt(at("2026-10-17T07:02:00Z")).toISOString()).toBe("2026-10-17T07:05:00.000Z");
    expect(quotaDay(at("2026-10-17T07:05:00Z"))).toBe("2026-10-17");
    expect(quotaDayStart(at("2026-10-17T07:05:00Z")).toISOString()).toBe("2026-10-17T07:05:00.000Z");
    expect(quotaDayStart(at("2026-10-17T07:04:59Z")).toISOString()).toBe("2026-10-16T07:05:00.000Z");
    expect(quotaDay(at("2026-11-01T07:02:00Z"))).toBe("2026-10-31");
    // wave 1's resets still hold, where posting has always read them
    expect(resetFromYouTube(at("2026-10-16T12:00:00Z")).toISOString()).toBe("2026-10-17T07:05:00.000Z");
    expect(resetFromYouTube(at("2026-11-02T12:00:00Z")).toISOString()).toBe("2026-11-03T08:05:00.000Z");
  });

  it("is 25 hours long the day the clocks go back and 23 the day they go forward", () => {
    const nov1 = at("2026-11-01T12:00:00Z");
    expect(quotaDay(nov1)).toBe("2026-11-01");
    expect(quotaDayStart(nov1).toISOString()).toBe("2026-11-01T07:05:00.000Z");
    expect(quotaResetsAt(nov1).toISOString()).toBe("2026-11-02T08:05:00.000Z");
    expect(quotaResetsAt(nov1).getTime() - quotaDayStart(nov1).getTime()).toBe(25 * 3600_000);
    const mar8 = at("2026-03-08T12:00:00Z");
    expect(quotaDay(mar8)).toBe("2026-03-08");
    expect(quotaDayStart(mar8).toISOString()).toBe("2026-03-08T08:05:00.000Z");
    expect(quotaResetsAt(mar8).toISOString()).toBe("2026-03-09T07:05:00.000Z");
    expect(quotaResetsAt(mar8).getTime() - quotaDayStart(mar8).getTime()).toBe(23 * 3600_000);
  });

  it("carries on across a month and a year", () => {
    expect(quotaResetsAt(at("2026-10-31T20:00:00Z")).toISOString()).toBe("2026-11-01T07:05:00.000Z");
    expect(quotaDay(at("2027-01-01T08:04:00Z"))).toBe("2026-12-31");
    expect(quotaResetsAt(at("2026-12-31T20:00:00Z")).toISOString()).toBe("2027-01-01T08:05:00.000Z");
  });
});

describe("what each call costs, and which allowance it comes out of", () => {
  it("takes uploads and searches from their own allowances, and every other Data API call from the units", () => {
    expect(METHODS["videos.insert"]).toEqual({ bucket: "uploads", cost: 1 });
    expect(METHODS["search.list"]).toEqual({ bucket: "searches", cost: 1 });
    for (const m of ["videos.list", "channels.list", "superChatEvents.list"] as Method[]) expect(METHODS[m]).toEqual({ bucket: "units", cost: 1 });
    // a stream's calls cost five units each
    expect(METHODS["liveBroadcasts.list"]).toEqual({ bucket: "units", cost: 5 });
    expect(METHODS["liveChatMessages.list"]).toEqual({ bucket: "units", cost: 5 });
    // YouTube Analytics is another API, counted on its own, with no limit until one is set
    expect(METHODS["reports.query"]).toEqual({ bucket: "analytics", cost: 1 });
    expect(DEFAULT_LIMITS).toEqual({ units: 10_000, uploads: 100, searches: 100, analytics: null });
  });

  it("gives shares only to kinds that use that allowance, and names every kind", () => {
    for (const b of BUCKETS) for (const k of Object.keys(SHARES[b])) expect(USES[b]).toContain(k);
    for (const m of Object.values(METHODS)) expect(BUCKETS).toContain(m.bucket);
    for (const k of KINDS) expect(KIND_NAMES[k]).toMatch(/^[A-Z]/);
    expect(KIND_NAMES.live).toBe("YouTube Live");
    expect(KIND_NAMES.analytics).toBe("YouTube Analytics");
  });
});

describe("each part's share of the units", () => {
  it("can never take what posting needs: a fifth of the units is always left for it", () => {
    expect(heldOf("units", 10_000)).toBe(2000);
    expect(capOf("units", "trends", 10_000)).toBe(500);
    expect(capOf("units", "stats", 10_000)).toBe(1500);
    expect(capOf("units", "checks", 10_000)).toBe(3000);
    expect(capOf("units", "other", 10_000)).toBe(500);
    expect(capOf("units", "live", 10_000)).toBe(2500);
    // posting has no share of its own, so it can use the whole allowance
    expect(capOf("units", "uploads", 10_000)).toBe(10_000);
    expect(capOf("uploads", "uploads", 100)).toBe(100);
    // Trends gets all of the searches
    expect(capOf("searches", "trends", 100)).toBe(100);
    // whatever Google grants, at least a fifth stays, since each share is rounded down
    for (const limit of [1, 7, 999, 10_001, 12_345, 1_000_000]) expect(heldOf("units", limit)!).toBeGreaterThanOrEqual(limit * 0.2);
    // with no limit there's no cap either
    expect(capOf("analytics", "analytics", null)).toBeNull();
    expect(heldOf("analytics", null)).toBeNull();
  });

  it("fits a call only under its allowance and its kind's share, and only while YouTube hasn't closed the allowance", () => {
    const trends = { limit: 10_000, cap: 500, used: 9_000, kindUsed: 499, full: false };
    // landing exactly on a limit fits
    expect(fits(trends, 1)).toBe(true);
    expect(fits(trends, 2)).toBe(false);
    const posting = { limit: 10_000, cap: 10_000, used: 9_999, kindUsed: 0, full: false };
    expect(fits(posting, 1)).toBe(true);
    expect(fits(posting, 2)).toBe(false);
    expect(fits({ ...posting, used: 0, full: true }, 1)).toBe(false);
    // with no limit set, only YouTube's word stops it
    expect(fits({ limit: null, cap: null, used: 1e9, kindUsed: 1e9, full: false }, 1)).toBe(true);
    expect(fits({ limit: null, cap: null, used: 0, kindUsed: 0, full: true }, 1)).toBe(false);
  });

  it("takes a daily limit only as a whole number of 1 or more, and Google's default for anything else", () => {
    expect(limitsFrom({ units: "500" }).units).toBe(500);
    expect(limitsFrom({ uploads: " 1000 " }).uploads).toBe(1000);
    for (const bad of ["0", "-5", "1.5", "abc", "", " ", "1e3", undefined]) {
      expect(limitsFrom({ units: bad, uploads: bad, searches: bad, analytics: bad })).toEqual(DEFAULT_LIMITS);
    }
    expect(limitsFrom({})).toEqual(DEFAULT_LIMITS);
    expect(limitsFrom({ analytics: "250" }).analytics).toBe(250);
  });
});

describe("saying when to try again, and the last seven days", () => {
  it("rounds to the hour, or says under an hour", () => {
    const now = at("2026-10-17T02:00:00Z");
    expect(tryAgainIn(at("2026-10-17T02:59:00Z"), now)).toBe("in under an hour");
    expect(tryAgainIn(at("2026-10-17T03:20:00Z"), now)).toBe("in about 1 hour");
    expect(tryAgainIn(at("2026-10-17T07:05:00Z"), now)).toBe("in about 5 hours");
  });

  it("lists 7 quota days oldest first, with days before counting began as not counted, never 0", () => {
    const rows: { day: string; bucket: Bucket; units: number; full: boolean }[] = [
      { day: "2026-10-14", bucket: "units", units: 40, full: false },
      { day: "2026-10-14", bucket: "units", units: 2, full: false },
      { day: "2026-10-16", bucket: "uploads", units: 100, full: true },
      // older than the week: left out
      { day: "2026-10-01", bucket: "units", units: 9, full: true },
    ];
    const week = lastWeek(rows, "2026-10-16", "2026-10-01");
    expect(week.map((d) => d.day)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(week[0]).toEqual({ day: "2026-10-10", used: { units: 0, uploads: 0, searches: 0, analytics: 0 }, full: [] });
    expect(week[4].used?.units).toBe(42);
    expect(week[6]).toEqual({ day: "2026-10-16", used: { units: 0, uploads: 100, searches: 0, analytics: 0 }, full: ["uploads"] });
    // counting began partway through the week
    const begun = lastWeek(rows, "2026-10-16", "2026-10-14");
    expect(begun.slice(0, 4).every((d) => d.used === null && d.full.length === 0)).toBe(true);
    expect(begun[4].used?.units).toBe(42);
    // nothing counted yet: every day reads as not counted
    expect(lastWeek([], "2026-10-16", null).every((d) => d.used === null)).toBe(true);
    expect(lastWeek([], "2026-11-02", null)[0].day).toBe("2026-10-27");
  });
});

describe("YouTube's refusals", () => {
  it("takes any reason naming quota, and dailyLimitExceeded, as an allowance used up, and tries those again after the reset", () => {
    for (const reason of ["quotaExceeded", "dailyLimitExceeded", "uploadQuotaExceeded", "searchQuota"]) {
      const e = new YouTubeError("No more today", 403, reason);
      expect(e.quota).toBe(true);
      expect(e.retry).toBe(true);
    }
    const busy = new YouTubeError("Slow down", 403, "rateLimitExceeded");
    expect(busy.quota).toBe(false);
    expect(busy.retry).toBe(true);
    for (const e of [new YouTubeError("Forbidden", 403, null), new YouTubeError("Bad", 400, "invalidArgument")]) {
      expect(e.quota).toBe(false);
      expect(e.retry).toBe(false);
    }
  });
});

describe("what a channel let Hookline do", () => {
  it("says whether its saved scopes include one, and doesn't guess when none were saved", () => {
    const saved = `${UPLOAD_SCOPE} ${READONLY_SCOPE}`;
    expect(hasScope(saved, UPLOAD_SCOPE)).toBe(true);
    expect(hasScope(saved, READONLY_SCOPE)).toBe(true);
    expect(hasScope(saved, ANALYTICS_SCOPE)).toBe(false);
    expect(hasScope(null, REVENUE_SCOPE)).toBeNull();
    expect(hasScope("", READONLY_SCOPE)).toBe(false);
    // the whole scope, not part of it
    expect(hasScope(READONLY_SCOPE, "https://www.googleapis.com/auth/youtube")).toBe(false);
    // what Google is asked for when a channel connects
    expect(YOUTUBE_SCOPES).toEqual([UPLOAD_SCOPE, READONLY_SCOPE, ANALYTICS_SCOPE, REVENUE_SCOPE]);
  });
});

describe("connecting a channel with no quota left today", () => {
  /** Where coming back from Google goes, for a connect started at `next` whose channel couldn't be read. */
  const back = async (next: string, err: Error) => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/connect/[platform]/callback/route");
    reading.mockReset();
    reading.mockRejectedValue(err);
    const res = await GET(new NextRequest(`https://hookline.test/api/connect/youtube/callback?code=w2q&state=${encodeURIComponent(next)}`), {
      params: Promise.resolve({ platform: "youtube" }),
    });
    return res.headers.get("location");
  };

  it("says so on the welcome page while getting started, and in Settings from anywhere else, whether Hookline's count or YouTube said it", async () => {
    const { QuotaWait } = await import("@/lib/server/quota");
    const counted = new QuotaWait("units", "other", at("2026-10-18T07:05:00Z"), false);
    const refused = new YouTubeError("Reading the channel: The request cannot be completed because you have exceeded your quota.", 403, "quotaExceeded");
    for (const err of [counted, refused]) {
      // nothing past the welcome page opens until getting started is done, so its connect step says it
      expect(await back("/app/welcome?step=connect", err)).toBe("https://hookline.test/app/welcome?step=connect&error=quota");
      expect(await back("/app/settings", err)).toBe("https://hookline.test/app/settings?error=quota");
      // Earnings has no notes for connecting, so Settings says it
      expect(await back("/app/earnings", err)).toBe("https://hookline.test/app/settings?error=quota");
    }
    // anything else is still a connect that didn't work, back where it started
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => logged.mockRestore());
    expect(await back("/app/welcome?step=connect", new YouTubeError("Reading the channel: Forbidden", 403, "forbidden"))).toBe("https://hookline.test/app/welcome?step=connect&error=connect");
    // what both places say, with no dash in it
    expect(CONNECT_WAIT).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("each plan's uploads a day", () => {
  it("uploads none on Free, 6 a day on Pro, and 10 for each connected channel on Creator, always twice a day's Shorts", () => {
    expect(uploadCap(PLANS.free, 1)).toBe(0);
    expect([0, 1].map((n) => uploadCap(PLANS.pro, n))).toEqual([6, 6]);
    // Pro has room for one channel, so another left connected from before adds nothing
    expect(uploadCap(PLANS.pro, 2)).toBe(6);
    // with none connected yet, still one channel's worth, and never more than the plan has room for
    expect([0, 1, 2, 3, 5, 7].map((n) => uploadCap(PLANS.creator, n))).toEqual([10, 10, 20, 30, 50, 50]);
    for (const p of [PLANS.pro, PLANS.creator]) {
      for (const n of [1, 2, 5]) expect(uploadCap(p, n)).toBe(2 * p.shorts.count * Math.min(n, p.channels));
    }
  });
});

describe("asking YouTube about an upload again", () => {
  const due = at("2026-10-20T16:00:00Z");
  const ask = (checked: string | null, now: string, uploadedAt: Date | null = at("2026-10-20T15:00:00Z")) =>
    checkAgain(checked ? at(checked) : null, due, uploadedAt, at(now));

  it("asks every 4 minutes for the first half hour after its time, then every half hour, and always when it's never been asked", () => {
    expect(ask(null, "2026-10-20T16:00:00Z")).toBe(true);
    expect(ask(null, "2026-10-23T16:00:00Z")).toBe(true);
    // in its first half hour
    expect(ask("2026-10-20T16:01:00Z", "2026-10-20T16:05:00Z")).toBe(false);
    expect(ask("2026-10-20T16:01:00Z", "2026-10-20T16:05:01Z")).toBe(true);
    // after it
    expect(ask("2026-10-20T16:29:00Z", "2026-10-20T16:35:00Z")).toBe(false);
    expect(ask("2026-10-20T16:29:00Z", "2026-10-20T16:59:01Z")).toBe(true);
    // two hours on: asked 10 minutes ago it waits, asked 31 minutes ago it's asked again
    expect(ask("2026-10-20T17:50:00Z", "2026-10-20T18:00:00Z")).toBe(false);
    expect(ask("2026-10-20T17:29:00Z", "2026-10-20T18:00:00Z")).toBe(true);
  });

  it("counts the first half hour from the upload when it went up after its time", () => {
    expect(ask("2026-10-20T18:01:00Z", "2026-10-20T18:06:00Z", at("2026-10-20T18:00:00Z"))).toBe(true);
    expect(ask("2026-10-20T18:01:00Z", "2026-10-20T18:06:00Z")).toBe(false);
    // with no upload time, from its time
    expect(ask("2026-10-20T16:20:00Z", "2026-10-20T16:25:00Z", null)).toBe(true);
  });
});

describe("what a Short held back says", () => {
  const until = at("2026-10-21T07:05:00Z");
  const pro = { name: "Pro", cap: 6 };
  const ready: HistoryFacts = {
    createdAt: at("2026-10-20T13:00:00Z"), origin: "daily", decidedAt: at("2026-10-20T14:00:00Z"), status: "ready", scheduledFor: at("2026-10-21T16:00:00Z"),
    render: { status: "done", finishedAt: at("2026-10-20T14:10:00Z"), error: null }, uploadedAt: null, youtubeId: null, postedAt: null,
    tiktokAt: null, tiktokPostedAt: null, tiktokError: null, error: null,
  };
  const steps = (h: HeldBack | null) => historyOf({ ...ready, heldBack: h }, at("2026-10-20T20:00:00Z")).map((s) => s.title);

  it("says what it's waiting for in one place: YouTube's uploads for Hookline, in wave 1's words, or the plan's own", () => {
    expect(HELD.youtube_quota).toMatchObject({ pill: "Waiting for quota", step: "Waiting for YouTube upload quota" });
    expect(HELD.youtube_quota.line(pro)).toBe("Waiting for YouTube upload quota. It goes up when that resets, around {time}.");
    expect(HELD.youtube_quota.lead(pro)).toBe("Waiting for YouTube upload quota.");
    expect(HELD.youtube_quota.box(pro)).toBe("YouTube caps how many videos Hookline can upload a day, and today's are used up. It goes up when that resets, around {time}.");
    expect(HELD.plan_cap).toMatchObject({ pill: "Daily uploads done", step: "Waiting for your plan's next uploads" });
    expect(HELD.plan_cap.line(pro)).toBe("Pro uploads up to 6 Shorts a day to YouTube, and today's are done. This one goes up around {time}.");
    const creator = { name: "Creator", cap: 30 };
    expect(HELD.plan_cap.lead(creator)).toBe("Today's uploads on Creator are done.");
    expect(HELD.plan_cap.box(creator)).toBe("Creator uploads up to 30 Shorts a day to YouTube. This one goes up when that resets, around {time}.");
    // each line says when once, and none of it has a dash
    for (const h of Object.values(HELD)) {
      for (const text of [h.pill, h.step, h.line(pro), h.lead(pro), h.box(pro)]) expect(text).not.toMatch(/[\u2013\u2014]/);
      for (const text of [h.line(pro), h.box(pro)]) expect(text.split("{time}")).toHaveLength(2);
    }
  });

  it("shows a plan wait only while the plan still uploads, and each wait as a step in the history", () => {
    expect(heldShown({ on: "plan_cap", until }, 6)).toEqual({ on: "plan_cap", until });
    expect(steps(heldShown({ on: "plan_cap", until }, 6))).toContain("Waiting for your plan's next uploads");
    expect(steps(heldShown({ on: "youtube_quota", until }, 6))).toContain("Waiting for YouTube upload quota");
    // after a move to Free, a plan wait isn't shown: it reads like any Free Short
    expect(heldShown({ on: "plan_cap", until }, 0)).toBeNull();
    expect(steps(heldShown({ on: "plan_cap", until }, 0))).not.toContain("Waiting for your plan's next uploads");
    // YouTube's quota is everyone's, whatever the plan
    expect(heldShown({ on: "youtube_quota", until }, 0)).toEqual({ on: "youtube_quota", until });
    // nothing to wait for, or no time to say
    expect(heldShown(null, 6)).toBeNull();
    expect(heldShown({ on: "youtube_quota", until: null }, 6)).toBeNull();
    // one already up isn't waiting for anything
    expect(historyOf({ ...ready, uploadedAt: at("2026-10-20T15:00:00Z"), heldBack: { on: "plan_cap", until } }).map((s) => s.title)).not.toContain("Waiting for your plan's next uploads");
  });
});

describe("checking each niche once a day", () => {
  const now = at("2026-10-20T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
  const check = (niche: string, checked: number | null, next: number, outcome: TrendCheck["outcome"] = checked === null ? null : "found"): TrendCheck => ({
    niche, checkedAt: checked === null ? null : hoursAgo(checked), triedAt: hoursAgo(checked ?? 1), outcome, nextAt: hoursAgo(next),
  });

  it("checks niches whose time has come, never-checked ones first, then the longest since checked", () => {
    const checks = [
      check("ball-battles", 30, 6),
      // not due for another two hours
      check("quizzes", 22, -2),
      check("would-you-rather", 48, 24),
      // its first try failed: never checked, so it goes first
      check("text-stories", null, 0.5, "failed"),
      // due exactly now
      check("rankings", 24, 0),
    ];
    const ids = dueNiches(NICHES, checks, now).map((n) => n.id);
    // the five niches with no row at all are never checked, in the list's own order, with the failed one in its place
    const never = NICHES.map((n) => n.id).filter((id) => !checks.some((c) => c.niche === id) || id === "text-stories");
    expect(ids).toEqual([...never, "would-you-rather", "ball-battles", "rankings"]);
    expect(ids).not.toContain("quizzes");
    // nothing is due once every niche was checked a day ago and is next in an hour
    expect(dueNiches(NICHES, NICHES.map((n) => check(n.id, 23, -1)), now)).toEqual([]);
  });

  it("calls a niche shown stale when it's never been checked or not in over 30 hours, with how its last try went", () => {
    const checks = [check("ball-battles", 29, -1), check("quizzes", 31, 0, "quota"), check("gaming", null, -1, "failed"), check("football", 50, 2, "none")];
    const stale = staleOf(checks, ["ball-battles", "quizzes", "gaming", "football", "facts", "not-a-niche"], now);
    expect(stale).toEqual([
      { id: "quizzes", name: "Quizzes", checkedAt: hoursAgo(31), outcome: "quota" },
      { id: "gaming", name: "Gaming", checkedAt: null, outcome: "failed" },
      { id: "football", name: "Football", checkedAt: hoursAgo(50), outcome: "none" },
      { id: "facts", name: "Facts", checkedAt: null, outcome: null },
    ]);
    // only the niches shown
    expect(staleOf(checks, ["ball-battles"], now)).toEqual([]);
  });

  it("says why each stale niche hasn't been checked, never calling one checked that wasn't", () => {
    const stale = (name: string, checkedAt: Date | null, outcome: TrendCheck["outcome"]) => ({ id: name.toLowerCase(), name, checkedAt, outcome });
    const old = hoursAgo(40);
    expect(staleLines([stale("Gaming", old, "quota"), stale("Football", old, "quota")])).toEqual([
      "Not checked in over a day: Gaming, Football. Hookline's YouTube allowance for Trends is used up for today, so they're checked after it resets.",
    ]);
    expect(staleLines([stale("Gaming", old, "quota")])).toEqual([
      "Not checked in over a day: Gaming. Hookline's YouTube allowance for Trends is used up for today, so it's checked after the reset.",
    ]);
    expect(staleLines([stale("Gaming", old, "failed"), stale("Facts", null, "failed")])).toEqual([
      "Not checked in over a day: Gaming. Not checked yet: Facts. YouTube didn't answer, so Hookline tries again within the hour.",
    ]);
    expect(staleLines([stale("Gaming", null, null), stale("Football", old, "found")])).toEqual([
      "Not checked in over a day: Football. Niches are checked while the worker is running.",
      "Not checked yet: Gaming. Niches are checked within half an hour of the worker starting.",
    ]);
    expect(staleLines([])).toEqual([]);
    const all = staleLines([stale("A", old, "quota"), stale("B", null, "failed"), stale("C", old, "none"), stale("D", null, null)]);
    expect(all).toHaveLength(4);
    for (const line of all) expect(line).not.toMatch(/[\u2013\u2014]/);
  });

  it("shows each niche's made-for-kids share with what it's of, and nothing made up when YouTube said nothing", () => {
    expect(kidsOf(9, 48)).toEqual({ text: "9 of 48", pct: 19 });
    expect(kidsOf(0, 12)).toEqual({ text: "0 of 12", pct: 0 });
    expect(kidsOf(0, 0)).toEqual({ text: "Not measured yet", pct: null });
  });
});

describe("every YouTube call is counted", () => {
  /** Every source file of the app, the worker, the bridge, the videos and the scripts. */
  const sources = (): string[] => {
    const out: string[] = [];
    const code = /\.(ts|tsx|mts|mjs|js|cjs)$/;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (code.test(name)) out.push(path);
      }
    };
    for (const dir of ["app", "lib", "components", "worker", "bridge", "remotion", "scripts", "public"]) walk(dir);
    return [...out, ...readdirSync(".").filter((name) => code.test(name))];
  };

  it("makes every Data API call from lib/server/youtube.ts, where each is counted before it's made", () => {
    const calling = sources().filter((f) => /googleapis\.com\/(youtube\/v3|upload\/youtube)/.test(readFileSync(f, "utf8")));
    expect(calling).toEqual([join("lib", "server", "youtube.ts")]);
  });
});
