import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Audience } from "@/components/app/audience";
import { PartnerMeter } from "@/components/app/partner-meter";
import { TypicalAccount } from "@/components/app/typical-account";
import { Working } from "@/components/shorts/working";
import { VsUsual } from "@/components/shorts/vs-usual";
import { cohortView, NOT_YET, SMALL } from "@/lib/app/cohorts";
import {
  addDays, AGE_GROUPS, audienceOf, byColumn, connectAgain, contentSplit, healthLine, lastDay, pacificDay, percentOf, pickedChannel, problemOf, readLine, readState, reportedDay,
  shareDue, totalOf, videoReadings, viewerRows, watched,
  type Problem, type ReadState, type Report, type Step,
} from "@/lib/shorts/proof";
import type { CohortRow } from "@/lib/server/cohorts";
import type { ChannelProof } from "@/lib/server/shorts/proof";
import { safeNext } from "@/lib/server/http";
import { againstUsual, at24h, engagedShare, firstDayLift, formatReason, lift, usualShare } from "@/lib/shorts/learn";
import { insights, measureLine } from "@/lib/shorts/insights";
import { big, keepProgress, nextRules, notesFor, progressOf, rulesOn, YPP_RULES, type Rules } from "@/lib/earnings/ypp";
import { hasScope } from "@/lib/shorts/youtube";
import { ANALYTICS_SCOPE, READONLY_SCOPE, REVENUE_SCOPE, UPLOAD_SCOPE } from "@/lib/server/youtube";

// the goal form's server action, signed in, with what it writes to the database caught instead of written
const written = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/server/auth", () => ({ requireUser: async () => ({ id: "w2-proof", email: "w2-proof@test.local" }) }));
vi.mock("@/lib/server/db", () => ({
  asUser: async (_id: string, fn: (tx: unknown) => unknown) => fn((_sql: TemplateStringsArray, ...values: unknown[]) => {
    written.push(values);
    return Promise.resolve([]);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

describe("YouTube Analytics' reports", () => {
  it("reads rows by column name, in whatever order YouTube gives them, and gives numbers back as numbers", () => {
    const r: Report = {
      columns: ["engagedViews", "video", "views", "averageViewPercentage", "averageViewDuration"],
      rows: [[820, "abc", 1000, 64.2, 17], ["5", "def", "9", 112.5, 31]],
    };
    expect(videoReadings(r)).toEqual([
      { youtubeId: "abc", views: 1000, engaged: 820, avgSeconds: 17, avgPercent: 64.2, revenue: null },
      { youtubeId: "def", views: 9, engaged: 5, avgSeconds: 31, avgPercent: 112.5, revenue: null },
    ]);
    // the same report the other way round reads the same
    expect(videoReadings({ columns: [...r.columns].reverse(), rows: r.rows.map((row) => [...row].reverse()) })).toEqual(videoReadings(r));
    // with YouTube's revenue estimate where it's asked for
    expect(videoReadings({ columns: ["video", "views", "engagedViews", "estimatedRevenue"], rows: [["abc", 10, 6, 0.4213]] })[0].revenue).toBe(0.4213);
    // a row without plays and engaged views says nothing, so it's left out
    expect(videoReadings({ columns: ["video", "views"], rows: [["abc", 3]] })).toEqual([]);
    expect(byColumn({ columns: ["day", "views"], rows: [["2026-10-01", 5]] })).toEqual([{ day: "2026-10-01", views: 5 }]);
  });

  it("takes the last day a daily report has as the day YouTube has reported up to, and a totals report's figures", () => {
    expect(lastDay({ columns: ["views", "day"], rows: [[1, "2026-10-12"], [0, "2026-10-13"], [4, "2026-10-11"]] })).toBe("2026-10-13");
    expect(lastDay({ columns: ["day", "views"], rows: [] })).toBeNull();
    const money: Report = { columns: ["estimatedAdRevenue", "estimatedRevenue"], rows: [[9.25, 12.5]] };
    expect([totalOf(money, "estimatedRevenue"), totalOf(money, "estimatedAdRevenue")]).toEqual([12.5, 9.25]);
    expect(totalOf({ columns: ["estimatedRevenue"], rows: [] }, "estimatedRevenue")).toBeNull();
  });

  it("only takes a Short's engaged share once YouTube has reported the day it went up and the day after, in Pacific time, and no later than its first week", () => {
    // 11pm Pacific on October 13 is 6am on the 14th in UTC: its first two days are the 13th and the 14th
    const late = new Date("2026-10-14T06:00:00Z");
    expect(pacificDay(late)).toBe("2026-10-13");
    expect(shareDue(late, "2026-10-13")).toBe(false);
    expect(shareDue(late, "2026-10-14")).toBe(true);
    // two hours later it's 1am on the 14th there, so it waits a day longer
    const early = new Date("2026-10-14T08:00:00Z");
    expect(pacificDay(early)).toBe("2026-10-14");
    expect(shareDue(early, "2026-10-14")).toBe(false);
    expect(shareDue(early, "2026-10-15")).toBe(true);
    // a reading that runs more than 6 days past the day it went up is about the rest of its life, not its first day: a
    // Short first read that late, like every one already up when Hookline started reading them, never gets a share
    expect(shareDue(late, "2026-10-19")).toBe(true);
    expect(shareDue(late, "2026-10-20")).toBe(false);
    expect(shareDue(early, "2026-10-20")).toBe(true);
    expect(shareDue(late, "2026-12-12")).toBe(false);
    // across the clocks going back on November 1: 11:30pm before is UTC-7, and 11:30pm after is UTC-8
    expect(pacificDay(new Date("2026-11-01T06:30:00Z"))).toBe("2026-10-31");
    expect(pacificDay(new Date("2026-11-02T07:30:00Z"))).toBe("2026-11-01");
    expect(shareDue(new Date("2026-11-02T07:30:00Z"), "2026-11-01")).toBe(false);
    expect(shareDue(new Date("2026-11-02T07:30:00Z"), "2026-11-02")).toBe(true);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-10-13", -89)).toBe("2026-07-16");
  });

  it("sums each age group across genders, in YouTube's order, names the biggest, and gives nothing when YouTube shares nothing", () => {
    const rows = viewerRows({
      columns: ["ageGroup", "gender", "viewerPercentage"],
      rows: [
        ["age25-34", "male", 20], ["age18-24", "female", 15], ["age18-24", "male", 26],
        ["age25-34", "female", 10], ["age13-17", "user_specified", 3], ["age65-", "female", 26],
      ],
    });
    expect(rows[0]).toEqual({ age: "age25-34", gender: "male", percent: 20 });
    const a = audienceOf(rows)!;
    expect(a.ages.map((g) => [g.label, g.percent])).toEqual([["13 to 17", 3], ["18 to 24", 41], ["25 to 34", 30], ["65 and over", 26]]);
    expect(a.genders.map((g) => [g.label, g.percent])).toEqual([["Female", 51], ["Male", 46], ["User-specified", 3]]);
    expect(a.largest).toEqual({ id: "age18-24", label: "18 to 24", percent: 41 });
    expect(AGE_GROUPS[0]).toBe("age13-17");
    expect(audienceOf([])).toBeNull();
    expect(audienceOf(null)).toBeNull();
  });

  it("splits Shorts from long videos, leaving lives and stories out, and gives nothing when YouTube didn't split them", () => {
    const split: Report = { columns: ["creatorContentType", "engagedViews"], rows: [["SHORTS", 1200], ["VIDEO_ON_DEMAND", 300], ["LIVE_STREAM", 999], ["STORY", 5]] };
    expect(contentSplit(split, "engagedViews")).toEqual({ shorts: 1200, long: 300 });
    // no Shorts row: none were watched
    expect(contentSplit({ columns: ["creatorContentType", "estimatedMinutesWatched"], rows: [["VIDEO_ON_DEMAND", 300]] }, "estimatedMinutesWatched")).toEqual({ shorts: 0, long: 300 });
    expect(contentSplit({ columns: ["day", "engagedViews"], rows: [["2026-10-01", 5]] }, "engagedViews")).toBeNull();
    expect(contentSplit(split, "estimatedMinutesWatched")).toBeNull();
  });

  it("says whether YouTube Analytics and revenue were allowed, and doesn't guess when the scopes weren't saved", () => {
    const all = [UPLOAD_SCOPE, READONLY_SCOPE, ANALYTICS_SCOPE, REVENUE_SCOPE].join(" ");
    expect([hasScope(all, ANALYTICS_SCOPE), hasScope(all, REVENUE_SCOPE)]).toEqual([true, true]);
    expect(hasScope(`${UPLOAD_SCOPE} ${READONLY_SCOPE}`, ANALYTICS_SCOPE)).toBe(false);
    expect(hasScope(`${UPLOAD_SCOPE} ${ANALYTICS_SCOPE}`, REVENUE_SCOPE)).toBe(false);
    expect(hasScope(null, ANALYTICS_SCOPE)).toBeNull();
  });

  it("names each failure for what it means: access lost, a limit, no permission, one it can do without, or an error", () => {
    const e = (status: number, reason: string | null = null) => ({ status, reason });
    // access lost: a revoked token, no tokens, no refresh token, or a 401 on anything
    expect(problemOf(e(400, "invalid_grant"), "access")).toBe("access");
    expect(problemOf(e(401, "noTokens"), "access")).toBe("access");
    expect(problemOf(e(401, "noRefresh"), "access")).toBe("access");
    expect(problemOf(e(401), "first")).toBe("access");
    expect(problemOf(e(401), "other")).toBe("access");
    // but not when Google says to try again later
    expect(problemOf(e(503), "access")).toBe("error");
    expect(problemOf(e(0, "network"), "access")).toBe("error");
    // a limit, whatever was being done
    for (const step of ["access", "first", "revenue", "split", "other"] as Step[]) {
      expect(problemOf(e(429), step)).toBe("quota");
      for (const reason of ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"]) expect(problemOf(e(403, reason), step)).toBe("quota");
    }
    // the first query refused: YouTube Analytics wasn't allowed
    expect(problemOf(e(403, "forbidden"), "first")).toBe("scope");
    expect(problemOf(e(403, "insufficientPermissions"), "first")).toBe("scope");
    // revenue refused, or no split: the read carries on without them
    expect(problemOf(e(403, "forbidden"), "revenue")).toBe("skip");
    expect(problemOf(e(400, "badRequest"), "split")).toBe("skip");
    // anything else
    expect(problemOf(e(400, "badRequest"), "first")).toBe("error");
    expect(problemOf(e(403, "forbidden"), "other")).toBe("error");
    expect(problemOf(e(400, "badRequest"), "revenue")).toBe("error");
    expect(problemOf(e(500), "split")).toBe("error");
    expect(problemOf(e(0, "network"), "other")).toBe("error");
  });

  it("says how long people watched, past 100% when they watch again", () => {
    expect(watched(17, 64.2)).toBe("0:17 · 64%");
    expect(watched(75, 112.4)).toBe("1:15 · 112%");
    expect(watched(9, null)).toBe("0:09");
    expect(watched(null, null)).toBeNull();
  });
});

describe("learning from engaged views", () => {
  it("keeps a Short's engaged share between 0 and 1, and has none without plays", () => {
    expect(engagedShare(1000, 640)).toBe(0.64);
    expect(engagedShare(10, 12)).toBe(1);
    expect(engagedShare(10, -1)).toBe(0);
    expect(engagedShare(0, 0)).toBeNull();
    expect(engagedShare(0, 5)).toBeNull();
  });

  it("takes a channel's usual share as the middle of its Shorts' own, once 3 have one", () => {
    expect(usualShare([0.5, null, 0.7])).toBeNull();
    expect(usualShare([])).toBeNull();
    expect(usualShare([0.5, 0.9, 0.7])).toBe(0.7);
    expect(usualShare([0.4, 0.5, null, 0.7, 0.9])).toBe(0.6);
  });

  it("compares by engaged views only with the Short's own share and a usual one, and otherwise exactly as plays are compared now", () => {
    expect(firstDayLift(2000, 0.8, 1000, 0.5)).toEqual({ lift: lift(1600, 500), by: "engaged" });
    expect(firstDayLift(2000, null, 1000, 0.5)).toEqual({ lift: lift(2000, 1000), by: "plays" });
    expect(firstDayLift(2000, 0.8, 1000, null)).toEqual({ lift: lift(2000, 1000), by: "plays" });
    expect(firstDayLift(2000, null, 1000, null).lift).toBe(againstUsual(2000, 24, 1000).vs);
  });

  it("scores the one of two Shorts with the same plays that more people watched past the start higher", () => {
    const watchedOn = firstDayLift(1500, 0.9, 1000, 0.6);
    const swipedPast = firstDayLift(1500, 0.3, 1000, 0.6);
    expect(watchedOn.lift).toBeGreaterThan(swipedPast.lift);
    // more plays than usual, but fewer of them watched than on the usual first day
    expect(swipedPast.lift).toBeLessThan(1);
  });

  it("says which a first day was compared by, on time or read late", () => {
    expect(againstUsual(2000, 24, 1000, 0.8, 0.5)).toEqual({ vs: lift(1600, 500), estimated: false, by: "engaged" });
    // a late reading is scaled back first, whichever it goes by
    expect(againstUsual(2000, 48, 1000, 0.8, 0.5)).toEqual({ vs: lift(at24h(2000, 48) * 0.8, 500), estimated: true, by: "engaged" });
    // with no share of its own, or no usual one, by plays, as first days always were
    expect(againstUsual(2000, 24, 1000, null, 0.5)).toEqual({ vs: lift(2000, 1000), estimated: false, by: "plays" });
    expect(againstUsual(2000, 24, 1000, 0.8)).toEqual({ vs: lift(2000, 1000), estimated: false, by: "plays" });
  });

  it("says what What's working's results were compared by, and that the comparisons are Hookline's", () => {
    expect(measureLine({ engaged: 12, plays: 0 })).toBe("Compared by engaged views, the plays YouTube counts for the Partner Program, not the ones swiped past. The comparisons are Hookline's.");
    expect(measureLine({ engaged: 3, plays: 9 })).toBe("Compared by engaged views where YouTube has reported them, and by plays before that. The comparisons are Hookline's.");
    expect(measureLine({ engaged: 0, plays: 9 })).toBe("Compared by plays until YouTube Analytics reports engaged views for your Shorts. The comparisons are Hookline's.");
    expect(measureLine({ engaged: 0, plays: 0 })).toBe(measureLine({ engaged: 0, plays: 9 }));
    // whichever they went by, they're Hookline's, never YouTube's
    for (const m of [{ engaged: 1, plays: 0 }, { engaged: 1, plays: 1 }, { engaged: 0, plays: 1 }]) expect(measureLine(m)).toMatch(/ The comparisons are Hookline's\.$/);
    // What's working carries the measure it's given, and none without one
    expect(insights([], { engaged: 2, plays: 5 }).measure).toEqual({ engaged: 2, plays: 5 });
    expect(insights([]).measure).toEqual({ engaged: 0, plays: 0 });
  });

  it("gives the queue's reasons as first days against the usual one, whatever they were compared by", () => {
    const quiz = (score: number, samples: number) => ({ kind: "format" as const, name: "quiz", score, samples });
    expect([quiz(1.4, 3), quiz(2.4, 10), quiz(0.5, 10)].map((w) => formatReason("quizzes", w))).toEqual([
      "Your quizzes have averaged 1.4× your usual first day, from 3: too few to go on yet",
      "Your quizzes have averaged 2.4× your usual first day (10 posted)",
      "Your quizzes have averaged 0.5× your usual first day, so fewer of them, but still some to keep checking",
    ]);
  });
});

describe("the Partner Program's bars", () => {
  const today = rulesOn("2026-10-17");

  it("has today's bars, each rung with what needs someone 18 or older", () => {
    expect(today.source).toBe("https://support.google.com/youtube/answer/72851");
    expect(today.rungs.map((r) => [r.id, r.need])).toEqual([
      ["fan", { subscribers: 500, uploads90: 3, shortsViews90: 3_000_000, longHours365: 3_000 }],
      ["ads", { subscribers: 1_000, shortsViews90: 10_000_000, longHours365: 4_000 }],
    ]);
    for (const set of YPP_RULES) for (const r of set.rungs) expect(r.adult).toMatch(/18 or older/);
    expect(today.rungs[0].adult).toBe("Memberships, Super Chat and Super Thanks need the creator to be 18 or older.");
    expect(today.rungs[1].adult).toMatch(/AdSense/);
    expect(today.rungs[1].adult).toMatch(/parent or guardian/);
    // only today's ship: a later set goes in once someone has read it on YouTube's page
    expect(YPP_RULES).toHaveLength(1);
    expect(nextRules("2026-10-17")).toBeNull();
    expect(notesFor("2026-10-17", true)).toEqual([]);
    expect(keepProgress({ subscribers: 5000, uploads90: 40, shortsViews90: 1_200_000, longHours365: null }, today)).toBeNull();
  });

  it("only calls a figure past when it's known and reaches the bar, and a rung past when every part of it is", () => {
    const [fan, ads] = progressOf({ subscribers: 612, uploads90: 41, shortsViews90: 3_100_000, longHours365: 120 }, today);
    expect(fan.subscribers).toEqual({ have: 612, need: 500, past: true });
    expect(fan.uploads).toEqual({ have: 41, need: 3, past: true });
    expect([fan.shorts.past, fan.hours.past, fan.past]).toEqual([true, false, true]);
    expect(ads.uploads).toBeNull();
    expect([ads.subscribers.past, ads.shorts.past, ads.past]).toEqual([false, false, false]);
    // fewer than 3 uploads Hookline knows of isn't known, never not past, and nor is a hidden subscriber count
    const [few] = progressOf({ subscribers: null, uploads90: 2, shortsViews90: 3_100_000, longHours365: null }, today);
    expect(few.uploads).toEqual({ have: 2, need: 3, past: null });
    expect(few.subscribers).toEqual({ have: null, need: 500, past: null });
    expect([few.hours.past, few.past]).toEqual([null, null]);
    // without the split, neither Shorts nor watch hours are known
    expect(progressOf({ subscribers: 800, uploads90: 5, shortsViews90: null, longHours365: null }, today)[0].past).toBeNull();
    // one figure short of its bar is not past
    expect(progressOf({ subscribers: 499, uploads90: 5, shortsViews90: 9_000_000, longHours365: null }, today)[0].past).toBe(false);
    expect(progressOf({ subscribers: 520, uploads90: 5, shortsViews90: 100, longHours365: 3_000 }, today)[0].past).toBe(true);
  });

  it("would start a later set on its own day, with its own numbers and dates and never a count of days, once one is added", () => {
    // made up to check how a later set would work: nothing like it ships until it's on YouTube's own page
    const later: Rules = {
      from: "2027-02-01", source: "https://support.google.com/youtube/answer/12843009", checked: "2026-12-01", newChannelsOnly: true, termsBy: "2027-01-31",
      keepShorts90: 10_000_000, rungs: [today.rungs[0], { ...today.rungs[1], need: { subscribers: 1_000, shortsViews90: 20_000_000, longHours365: 8_000 } }],
    };
    const sets = [...YPP_RULES, later];
    expect(rulesOn("2027-01-31", sets)).toBe(today);
    expect(rulesOn("2027-02-01", sets)).toBe(later);
    expect(nextRules("2027-01-31", sets)).toBe(later);
    expect(nextRules("2027-02-01", sets)).toBeNull();
    const notes = notesFor("2026-10-17", true, sets);
    expect(notes).toEqual([
      "From February 1, 2027, channels joining need 1,000 subscribers and 20 million Shorts views in 90 days or 8,000 watch hours in 12 months for ad revenue.",
      "Channels already in the program don't need to meet the new bar to stay in.",
      "YouTube asks channels in the program to accept its updated terms by January 31, 2027. YouTube Studio shows them.",
    ]);
    // the terms are for channels in the program
    expect(notesFor("2026-10-17", false, sets)).toEqual(notes.slice(0, 2));
    expect(notesFor("2027-02-01", true, sets)).toEqual([]);
    for (const line of notes) {
      expect(line).not.toMatch(/left|to go|from now|countdown|pace|on track|aren't affected/i);
      expect(line).not.toMatch(/[\u2013\u2014]/);
    }
    expect(keepProgress({ subscribers: 5000, uploads90: 40, shortsViews90: 1_200_000, longHours365: null }, later)).toEqual({ have: 1_200_000, need: 10_000_000, past: false });
  });

  it("rounds big figures down, so 2,990,000 never shows as 3 million", () => {
    expect(big(2_990_000)).toBe("2.9 million");
    expect(big(2_999_999)).toBe("2.9 million");
    expect(big(3_000_000)).toBe("3 million");
    expect(big(10_000_000)).toBe("10 million");
    expect(big(1_234_567)).toBe("1.2 million");
    expect(big(999_999)).toBe("999,999");
    expect(big(120.9)).toBe("120");
    expect(big(0)).toBe("0");
  });
});

describe("a goal on engaged views", () => {
  it("saves, counting YouTube's engaged views", async () => {
    const { addGoal } = await import("@/app/app/(shell)/earnings/actions");
    const form = new FormData();
    form.set("series", "youtube:engaged_views");
    form.set("target", "10000");
    form.set("period", "month");
    await expect(addGoal(form)).rejects.toThrow(/^redirect \/app\/earnings$/);
    expect(written).toEqual([["w2-proof", "youtube", "engaged_views", 10000, "month", "10,000 engaged views on YouTube this month"]]);
  });
});

describe("what the screens say about a channel's YouTube Analytics", () => {
  /** A YouTube channel as proofOf gives it to Earnings, read in full, with whatever a test changes. */
  const channel = (o: Partial<ChannelProof> = {}): ChannelProof => ({
    id: "6b1a8f8e-2f7c-4a8e-9d0e-0c3f2b1a9d4e", title: "Ball Clash", status: "connected", problem: null,
    syncedAt: new Date("2026-10-16T19:00:00Z"), through: "2026-10-15", revenueReadable: true, earns: false, sharesAds: false,
    numbers: { subscribers: 312, uploads90: 41, shortsViews90: 1_200_000, longHours365: 120 }, split: true, subscribersHidden: false, audience: null,
    kids: { answer: false, youtubeAtConnect: null, no: 41, yes: 1, unknown: 0, youtubeMarked: 0 },
    ...o,
  });
  /** What a panel says: its words without the markup, with the characters React escapes put back, and curly apostrophes as straight ones. */
  const words = (html: string) =>
    html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/’/g, "'").replace(/\s+/g, " ").trim();
  const said = (el: ReactElement) => words(renderToStaticMarkup(el));
  const meter = (c: ChannelProof) => said(createElement(PartnerMeter, { c, today: "2026-10-17" }));
  const audience = (c: ChannelProof, shown = true) => said(createElement(Audience, { c, shown }));
  /** Nothing here claims a channel qualifies, counts down, projects, or uses a long dash. */
  const NEVER = /reached|qualif|eligible|days left|to go|on track|pace|projected|countdown|[–—]/i;

  it("says where a channel's reading stands, and only one read in full, or kept from one, has numbers to show", () => {
    const at = new Date("2026-10-16T19:00:00Z");
    const state = (status: string, problem: Problem | null, syncedAt: Date | null) => readState({ status, problem, syncedAt });
    expect([
      state("connected", null, at), state("connected", "error", at), state("connected", "quota", at),
      state("connected", null, null), state("connected", "error", null), state("connected", "quota", null),
      state("connected", "scope", null), state("connected", "access", at), state("expired", null, at),
    ]).toEqual(["read", "stale", "stale", "unread", "failing", "failing", "scope", "access", "access"]);
    expect(readLine("read", "2026-10-15")).toBeNull();
    expect(readLine("unread", null)).toBe("Not read yet. Hookline reads YouTube Analytics once a day.");
    expect(readLine("stale", "2026-10-12")).toBe("Showing what YouTube said up to Oct 12. Hookline couldn't read it today and tries again soon.");
    expect(readLine("stale", null)).toBe("Hookline couldn't read it today and tries again soon.");
    expect(readLine("failing", null)).toBe("Hookline couldn't read this channel's YouTube Analytics yet. It tries again soon.");
    expect(readLine("scope", null)).toBe("Hookline isn't allowed to read this channel's YouTube Analytics. Connect it again and leave YouTube Analytics ticked on Google's screen.");
    expect(readLine("access", null)).toBe("Hookline lost access to this channel. Connect it again to see its numbers.");
    for (const s of ["unread", "failing", "scope", "access", "stale"] as ReadState[]) expect(readLine(s, "2026-10-12")).not.toMatch(NEVER);
  });

  it("sends Connect again through Google's screen for that same channel, and back to all of Earnings", () => {
    const url = new URL(connectAgain(channel().id), "https://hookline.app");
    expect(url.pathname).toBe("/api/connect/youtube");
    expect(url.searchParams.get("channel")).toBe(channel().id);
    // the connect route only goes back to a page in the app
    expect(safeNext(url.searchParams.get("next"))).toBe("/app/earnings");
    // and the way back names the channel that came back, for Settings' note: nobody picked it, so Earnings shows them all
    expect(pickedChannel(Object.fromEntries(new URLSearchParams(`connected=already&channel=${channel().id}`)))).toBeNull();
    expect(pickedChannel({ connected: "youtube", channel: channel().id, moved: "2" })).toBeNull();
    // picking one is still picking it
    expect(pickedChannel({ days: "90", channel: channel().id })).toBe(channel().id);
    expect(pickedChannel({})).toBeNull();
  });

  it("dates YouTube's figures by the day it reported up to, and shows its percentages whole", () => {
    expect(reportedDay("2026-10-13")).toBe("Oct 13");
    expect(reportedDay("2027-01-01")).toBe("Jan 1");
    expect([41.4, 0.6, 0.3, 0, 99.6].map(percentOf)).toEqual(["41%", "1%", "Under 1%", "0%", "100%"]);
  });

  it("puts each rung's adult line under it, and calls a channel past its bars only by YouTube Analytics", () => {
    // past fan funding's bars, and not ad revenue's
    const text = meter(channel({ numbers: { subscribers: 612, uploads90: 6, shortsViews90: 3_412_000, longHours365: 120.6 } }));
    expect(text).toContain("Fan funding and Shopping Memberships, Super Chat, Super Thanks and Shopping, where YouTube offers them. Memberships, Super Chat and Super Thanks need the creator to be 18 or older.");
    expect(text).toContain("Ad revenue A share of ad revenue from long videos and Shorts. YouTube pays through AdSense, which needs someone 18 or older, so under 18 a parent or guardian sets it up.");
    for (const row of ["Subscribers 612 of 500", "Public uploads, last 90 days 6 that Hookline knows of. Needs 3.", "Engaged views on Shorts, last 90 days 3.4 million of 3 million",
      "Watch hours on long videos, last 12 months 120 of 3,000", "Subscribers 612 of 1,000", "3.4 million of 10 million", "120 of 4,000"]) {
      expect(text).toContain(row);
    }
    expect(text.match(/past these bars/g)).toHaveLength(1);
    expect(text).toContain("By YouTube Analytics, this channel is past these bars. YouTube Studio's Earn page says whether you can apply.");
    expect(text).toContain("These come from YouTube Analytics and YouTube's public subscriber count. YouTube Studio's Earn page has YouTube's own count, which can differ.");
    expect(text).toContain("Reaching a bar lets you apply. YouTube reviews every channel and turns some down.");
    expect(text).not.toMatch(NEVER);
  });

  it("fills a bar no further than full, and has none for a figure it doesn't know, which says so", () => {
    const c = channel({ numbers: { subscribers: null, uploads90: 41, shortsViews90: 12_000_000, longHours365: null }, subscribersHidden: true });
    const html = renderToStaticMarkup(createElement(PartnerMeter, { c, today: "2026-10-17" }));
    // uploads and Shorts views for fan funding, and Shorts views for ad revenue, every one well past its bar
    expect([...html.matchAll(/aria-valuenow="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([100, 100, 100]);
    const text = words(html);
    expect(text.match(/Not known/g)).toHaveLength(4);
    expect(text).toContain("This channel hides its subscriber count on YouTube, so Hookline can't show it.");
    // a figure that isn't known keeps a rung from being called past
    expect(text).not.toContain("past these bars");
    expect(text).not.toContain("rounds subscriber counts");
  });

  it("leaves Shorts views and watch hours out when YouTube didn't split them, and says so, but not for a channel with no views to split", () => {
    const text = meter(channel({ split: false, numbers: { subscribers: 312, uploads90: 41, shortsViews90: null, longHours365: null } }));
    expect(text).toContain("YouTube didn't split Shorts from long videos for this channel, so their views and watch hours don't show. YouTube Studio's Earn page has them.");
    for (const gone of ["Engaged views on Shorts", "Watch hours on long videos", "And one of these"]) expect(text).not.toContain(gone);
    expect(text).toContain("Subscribers 312 of 500");
    const quiet = meter(channel({ split: false, through: null, numbers: { subscribers: 41, uploads90: 0, shortsViews90: null, longHours365: null } }));
    expect(quiet).not.toContain("didn't split");
    expect(quiet).toContain("Subscribers 41 of 500");
  });

  it("tells a channel YouTube estimates ad revenue for that it already shares in it, and keeps the bars for one that only earns from fans", () => {
    const shares = meter(channel({ earns: true, sharesAds: true, numbers: { subscribers: 15_400, uploads90: 41, shortsViews90: 12_800_000, longHours365: 2210 } }));
    expect(shares).toContain("YouTube estimates ad revenue for this channel, so it already shares in ad revenue.");
    for (const gone of ["Subscribers", "Fan funding", "past these bars"]) expect(shares).not.toContain(gone);
    expect(shares).not.toMatch(NEVER);
    // revenue from Super Thanks or memberships alone isn't ad revenue
    const fans = meter(channel({ earns: true, sharesAds: false }));
    expect(fans).toContain("Ad revenue A share of ad revenue");
    expect(fans).not.toContain("already shares");
  });

  it("gives a later set of bars its dated notes and YouTube's page on it, still with no countdown, once one is added", () => {
    // made up to check how a later set would show: nothing like it ships until it's on YouTube's own page
    const bars = rulesOn("2026-10-17");
    const later: Rules = {
      from: "2027-02-01", source: "https://support.google.com/youtube/answer/12843009", checked: "2026-12-01", newChannelsOnly: true, termsBy: "2027-01-31",
      rungs: [bars.rungs[0], { ...bars.rungs[1], need: { subscribers: 1_000, shortsViews90: 20_000_000, longHours365: 8_000 } }],
    };
    const sets = [...YPP_RULES, later];
    const html = renderToStaticMarkup(createElement(PartnerMeter, { c: channel(), today: "2026-10-17", sets }));
    const text = words(html);
    expect(text).toContain("From February 1, 2027, channels joining need 1,000 subscribers and 20 million Shorts views in 90 days or 8,000 watch hours in 12 months for ad revenue.");
    expect(text).toContain("Channels already in the program don't need to meet the new bar to stay in. YouTube's announcement");
    expect(html).toContain(`href="${later.source}"`);
    // the terms are for channels in the program, as one YouTube estimates ad revenue for is
    const shares = said(createElement(PartnerMeter, { c: channel({ earns: true, sharesAds: true }), today: "2026-10-17", sets }));
    expect(shares).toContain("YouTube asks channels in the program to accept its updated terms by January 31, 2027. YouTube Studio shows them.");
    expect(text).not.toContain("updated terms");
    for (const t of [text, shares]) expect(t).not.toMatch(NEVER);
    // with today's bars alone, nothing dated and no link
    expect(renderToStaticMarkup(createElement(PartnerMeter, { c: channel(), today: "2026-10-17" }))).not.toContain("answer/12843009");
    expect(meter(channel())).not.toContain("announcement");
  });

  it("says when Hookline can't read a channel's revenue, and that YouTube rounds big subscriber counts down", () => {
    const text = meter(channel({ revenueReadable: false, numbers: { subscribers: 1_240, uploads90: 41, shortsViews90: 1_200_000, longHours365: 120 } }));
    expect(text).toContain("Hookline can't read this channel's revenue, so it can't tell whether it's in the Partner Program already. If it is, these bars don't apply to it.");
    expect(text).toContain("YouTube rounds subscriber counts over 1,000 down.");
    expect(meter(channel())).not.toContain("can't read this channel's revenue");
    // not read yet isn't the same as can't be read
    expect(meter(channel({ revenueReadable: null }))).not.toContain("can't read this channel's revenue");
  });

  it("shows who's watching by age and gender, says nobody under 13 is in it, and says so when YouTube shares nothing", () => {
    const c = channel({
      audience: audienceOf([
        { age: "age18-24", gender: "female", percent: 14.4 }, { age: "age18-24", gender: "male", percent: 26.9 },
        { age: "age25-34", gender: "male", percent: 58.4 }, { age: "age45-54", gender: "user_specified", percent: 0.3 },
      ]),
    });
    const text = audience(c);
    expect(text).toContain("Who's watching Signed-in viewers 13 and over, last 90 days");
    for (const row of ["18 to 24 41%", "25 to 34 58%", "45 to 54 Under 1%", "Female 14% · Male 85% · User-specified Under 1%"]) expect(text).toContain(row);
    expect(text).toContain("YouTube only shares this for viewers who are signed in and 13 or older. Nobody under 13 is in it, so it can't tell you whether kids watch.");
    expect(audience(channel())).toContain("YouTube hasn't shared viewers' ages for this channel. It only does once enough signed-in viewers watch.");
    // a channel that can't be read shows no ages, and still shows its made-for-kids answers
    const unread = audience(c, false);
    expect(unread).not.toContain("Who's watching");
    expect(unread).toContain("Made for kids: you said No for this channel.");
  });

  it("gives the creator's made-for-kids answers and YouTube's verdicts, never suggesting one", () => {
    const answered = audience(channel({ kids: { answer: true, youtubeAtConnect: false, no: 3, yes: 38, unknown: 2, youtubeMarked: 1 } }));
    expect(answered).toContain("Made for kids: you said Yes for this channel.");
    expect(answered).toContain("When you connected it, YouTube had this channel as not made for kids.");
    expect(answered).toContain("Your posted Shorts here: 3 not made for kids, 38 made for kids, and 2 with no answer saved.");
    expect(answered).toContain("YouTube marked 1 of them as made for kids.");
    expect(answered).toContain("Whether your channel is made for kids is your call. How YouTube decides");
    // not answered yet: the way to answer it, and nothing about Shorts or a verdict there isn't
    const html = renderToStaticMarkup(createElement(Audience, { c: channel({ kids: { answer: null, youtubeAtConnect: null, no: 0, yes: 0, unknown: 0, youtubeMarked: 0 } }), shown: true }));
    const open = words(html);
    expect(open).toContain("Made for kids: not answered yet. Answer it in Settings");
    expect(html).toContain(`href="/app/settings#audience-${channel().id}"`);
    for (const gone of ["Your posted Shorts here", "When you connected it", "YouTube marked"]) expect(open).not.toContain(gone);
    for (const t of [answered, open]) {
      expect(t).not.toMatch(/should|recommend|suggest|probably|likely/i);
      expect(t).not.toMatch(NEVER);
    }
  });

  it("says under What's working's bars what they were compared by, and that the comparisons are Hookline's", () => {
    const { formats, kinds } = insights([{ kind: "format", name: "quiz", score: 1.6, samples: 5 }]);
    const text = said(createElement(Working, { formats, kinds, measure: { engaged: 2, plays: 3 } }));
    expect(text).toContain(measureLine({ engaged: 2, plays: 3 }));
    expect(said(createElement(Working, { formats, kinds, measure: { engaged: 0, plays: 3 } }))).toContain("Compared by plays until YouTube Analytics reports engaged views for your Shorts. The comparisons are Hookline's.");
  });

  it("gives a Short's first day against its usual a row of its own on its page, said to be Hookline's comparison, never YouTube's, whatever it went by", () => {
    const row = (o: Partial<Parameters<typeof VsUsual>[0]>) => said(createElement(VsUsual, { vs: null, typical: 2050, waiting: false, ...o }));
    const engaged = { vs: 2.7, estimated: false, by: "engaged" as const };
    expect(row({ vs: engaged })).toBe("Hookline's comparison Vs your usual 2.7× Its first day, by engaged views");
    expect(row({ vs: { vs: 0.8, estimated: true, by: "plays" }, channel: "Ball Clash" })).toBe(
      "Hookline's comparison Vs your usual 0.8× Its first day, against Ball Clash's usual, by plays, estimated from a late reading",
    );
    expect(row({ vs: { vs: 1.4, estimated: false, by: "plays" }, waiting: true })).toBe("Hookline's comparison Vs your usual 1.4× By plays for now. Engaged views come in a few days.");
    // before there's anything to compare, it says what it waits for
    expect(row({ typical: null })).toBe("Hookline's comparison Vs your usual — Needs 3 Shorts' first days");
    expect(row({})).toBe("Hookline's comparison Vs your usual — After its first day");
    // and nothing in it says it came from YouTube
    for (const o of [{ vs: engaged }, { vs: engaged, channel: "Ball Clash" }, {}]) expect(row(o)).not.toMatch(/YouTube/);
  });
});

describe("the typical account on /admin", () => {
  /** One week's sign-ups as cohorts() gives them, with whatever a test changes. */
  const week = (o: Partial<CohortRow> = {}): CohortRow => ({
    week: "2026-09-07", accounts: 8, complete: 8, connected: 6, kept: 7, postedAny: 5, posted: { low: 1, median: 2, high: 4 }, tiktok: 2, week4: 3, ...o,
  });
  /** What the card says: its words without the markup, with curly apostrophes as straight ones. */
  const table = (rows: CohortRow[]) =>
    renderToStaticMarkup(createElement(TypicalAccount, { rows })).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/’/g, "'").replace(/\s+/g, " ").trim();
  const young = { complete: 0, postedAny: 0, posted: null, tiktok: 0, week4: 0 };

  it("shows the middle account's Shorts and the middle half's, out of the accounts 4 weeks old, never the best account's", () => {
    expect(cohortView(week())).toEqual({
      key: "2026-09-07", label: "Sep 7", all: false,
      cells: { accounts: "8", connected: "6", kept: "7", postedAny: "5 of 8", posted: "2 (1 to 4)", tiktok: "2 of 8", week4: "3 of 8" },
    });
    // every week together says how many weeks it is
    expect(cohortView(week({ week: null }), 12)).toMatchObject({ key: "all", label: "All 12 weeks", all: true });
  });

  it("shows no figures for a week with fewer than 5 accounts", () => {
    expect(SMALL).toBe(5);
    expect(cohortView(week({ accounts: 4, complete: 4, connected: 3, kept: 3, postedAny: 2, tiktok: 1, week4: 1 })).cells).toBeNull();
    expect(cohortView(week({ accounts: 5, complete: 5, connected: 3, kept: 4, postedAny: 2, tiktok: 1, week4: 1 })).cells).not.toBeNull();
  });

  it("says Not yet for the first 4 weeks until 5 of a week's accounts are 4 weeks old, and still counts what they've done", () => {
    for (const complete of [0, 4]) {
      const cells = cohortView(week({ ...young, complete, posted: complete ? { low: 0, median: 1, high: 1 } : null })).cells!;
      expect(cells).toMatchObject({ accounts: "8", connected: "6", kept: "7" });
      expect([cells.postedAny, cells.posted, cells.tiktok, cells.week4]).toEqual([NOT_YET, NOT_YET, NOT_YET, NOT_YET]);
    }
  });

  it("puts every week together first and the newest week next, says why YouTube's own numbers aren't there, and says when nobody signed up", () => {
    const text = table([
      week({ week: null, accounts: 17, complete: 8, connected: 11, kept: 13 }),
      week({ week: "2026-10-05", accounts: 6, connected: 4, kept: 5, ...young }),
      week({ week: "2026-09-28", accounts: 3, connected: 1, kept: 1, ...young }),
      week(),
    ]);
    expect(text).toMatch(/All 12 weeks 17 11 13 5 of 8 2 \(1 to 4\) 2 of 8 3 of 8 Oct 5 6 4 5 Not yet Not yet Not yet Not yet Sep 28 Fewer than 5 accounts Sep 7 8 6 7 5 of 8/);
    expect(text).toContain("Posted counts only Shorts YouTube confirmed. TikTok counts what was sent.");
    expect(text).toContain("YouTube's own numbers aren't here: YouTube's API rules don't allow combining different people's channels.");
    expect(text).not.toMatch(/[–—]/);
    const nobody = table([week({ week: null, accounts: 0, connected: 0, kept: 0, ...young })]);
    expect(nobody).toContain("Nobody signed up in the 12 weeks before this one.");
    expect(nobody).not.toContain("Fewer than");
  });

  it("is built from Hookline's own records, never from YouTube's figures", () => {
    // not the YouTube Analytics kept for each Short and channel, the learning loop's readings, Earnings' figures, or YouTube itself
    expect(readFileSync("lib/server/cohorts.ts", "utf8")).not.toMatch(/video_analytics|channel_analytics|video_stats|public\.metrics|googleapis/);
  });

  it("tells /admin how YouTube Analytics reads are going as counts only", () => {
    expect(healthLine({ channels: 190, read: 182, scope: 5, access: 3, failing: 2 }))
      .toBe("YouTube Analytics: read for 182 of 190 channels in the last day. Can't read 5 (not allowed), 3 (access lost) and 2 (failing).");
    expect(healthLine({ channels: 4, read: 3, scope: 0, access: 1, failing: 0 })).toBe("YouTube Analytics: read for 3 of 4 channels in the last day. Can't read 1 (access lost).");
    expect(healthLine({ channels: 1, read: 1, scope: 0, access: 0, failing: 0 })).toBe("YouTube Analytics: read for 1 of 1 channel in the last day.");
    expect(healthLine({ channels: 0, read: 0, scope: 0, access: 0, failing: 0 })).toBe("YouTube Analytics: no YouTube channels to read yet.");
  });
});
