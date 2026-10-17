import { describe, expect, it } from "vitest";
import { rng } from "@/lib/battle/sim";
import { PLANS, postsPerDay } from "@/lib/billing/plans";
import { addUp, fillReported, lastDays } from "@/lib/earnings/series";
import { channelNames, channelSettingsFrom, gettingShorts, hasRoom, postsAll, roomLeft, unitsOf, uploadsTo, type ChannelRow } from "@/lib/shorts/channels";
import { insights } from "@/lib/shorts/insights";
import { formatReason, odds, standout, steady, withPrior, type Weight } from "@/lib/shorts/learn";
import { atLocal, bestHours, EXPLORE, localParts, planSlots, startingHours, STARTING_HOURS, type HourResult, type Slot } from "@/lib/shorts/times";
import { tiktokReason, tiktokTime } from "@/lib/shorts/tiktok";
import { keptNote } from "@/lib/shorts/youtube";
import { TikTokError } from "@/lib/server/tiktok";

/** A YouTube channel, connected and getting Shorts, first connected `day` days into October. */
const yt = (id: string, day: number, over: Partial<ChannelRow> = {}): ChannelRow => ({
  id, platform: "youtube", status: "connected", shortsOn: true, addedAt: new Date(Date.UTC(2026, 9, day)), ...over,
});

describe("which channels get Shorts", () => {
  it("gives new Shorts to the YouTube channels connected first, as many as the plan has room for, keeping expired ones", () => {
    const channels = [
      yt("c4", 4),
      yt("c2", 2, { status: "expired" }),
      yt("c0", 0, { status: "revoked" }),
      yt("c3", 3, { shortsOn: false }),
      yt("c1", 1),
      { ...yt("t0", 0), platform: "tiktok" as const },
      // connected at the same moment as c2: the id decides, as it does in the database
      yt("c2a", 2),
    ];
    expect(gettingShorts(channels, 5).map((c) => c.id)).toEqual(["c1", "c2", "c2a", "c4"]);
    expect(gettingShorts(channels, 1).map((c) => c.id)).toEqual(["c1"]);
    expect(unitsOf(channels, 2)).toEqual(["c1", "c2"]);
  });

  it("makes an account with no channel that isn't disconnected its own unit, and gives one whose channels are all switched off none", () => {
    expect(unitsOf([], 1)).toEqual([null]);
    expect(unitsOf([yt("gone", 1, { status: "revoked" }), { ...yt("t", 1), platform: "tiktok" }], 5)).toEqual([null]);
    expect(unitsOf([yt("off", 1, { shortsOn: false }), yt("off2", 2, { shortsOn: false })], 5)).toEqual([]);
    // an expired channel still gets Shorts: it's waiting to be reconnected
    expect(unitsOf([yt("lost", 1, { status: "expired" })], 1)).toEqual(["lost"]);
  });

  it("keeps each channel to its share and the account to the plan's total", () => {
    // Pro: one channel, 3 a day
    expect(roomLeft({ each: 3, units: 1, made: 0, accountMade: 0 })).toBe(3);
    expect(roomLeft({ each: 3, units: 1, made: 3, accountMade: 3 })).toBe(0);
    // Creator with 3 channels: 5 each, 15 in all
    expect(roomLeft({ each: 5, units: 3, made: 0, accountMade: 10 })).toBe(5);
    expect(roomLeft({ each: 5, units: 3, made: 5, accountMade: 10 })).toBe(0);
    expect(roomLeft({ each: 5, units: 3, made: 2, accountMade: 14 })).toBe(1);
    // a Pro channel swapped for another the same day: the old one's 3 still count, so nothing extra
    expect(roomLeft({ each: 3, units: 1, made: 0, accountMade: 3 })).toBe(0);
    // disconnected and connected again, it's the same channel with the same Shorts
    expect(roomLeft({ each: 5, units: 2, made: 5, accountMade: 5 })).toBe(0);
    // every channel switched off counts as one share for the account, and never below nothing
    expect(roomLeft({ each: 3, units: 0, made: 0, accountMade: 4 })).toBe(0);
  });

  it("has room for a channel they have, and for a new one only while the plan has room", () => {
    const five = ["a", "b", "c", "d", "e"].map((externalId) => ({ externalId, status: "connected" }));
    expect(hasRoom(five, "f", PLANS.creator.channels)).toBe(false);
    expect(hasRoom(five.slice(0, 4), "f", PLANS.creator.channels)).toBe(true);
    expect(hasRoom(five, "c", PLANS.creator.channels)).toBe(true);
    // Pro has room for one; reconnecting it is fine, and so is coming back once the other is disconnected
    expect(hasRoom([{ externalId: "a", status: "expired" }], "b", PLANS.pro.channels)).toBe(false);
    expect(hasRoom([{ externalId: "a", status: "expired" }], "a", PLANS.pro.channels)).toBe(true);
    expect(hasRoom([{ externalId: "a", status: "revoked" }, { externalId: "b", status: "connected" }], "a", PLANS.pro.channels)).toBe(false);
    expect(hasRoom([{ externalId: "a", status: "revoked" }], "b", PLANS.pro.channels)).toBe(true);
    // one TikTok account on every plan
    for (const p of Object.values(PLANS)) expect(hasRoom([{ externalId: "tt", status: "connected" }], "tt2", p.tiktokAccounts)).toBe(false);
  });

  it("says Hookline uploads only for a plan that posts, to a connected channel it may upload to", () => {
    expect(uploadsTo({ status: "connected", api: true }, true)).toBe(true);
    expect(uploadsTo({ status: "connected", api: true }, false)).toBe(false);
    expect(uploadsTo({ status: "connected", api: false }, true)).toBe(false);
    expect(uploadsTo({ status: "expired", api: true }, true)).toBe(false);
    expect(uploadsTo({ status: "revoked", api: true }, true)).toBe(false);
    expect(uploadsTo(null, true)).toBe(false);
  });

  it("names each channel, telling apart two that share a name", () => {
    const names = channelNames([
      { id: "a", title: "Ball Clash", handle: "@ballclash" },
      { id: "b", title: "Ball Clash", handle: "@ballclash2" },
      { id: "c", title: null, handle: "@quizzy" },
      { id: "d", title: null, handle: null },
      { id: "e", title: "Maps", handle: null },
      { id: "f", title: "Maps", handle: null },
    ]);
    expect([...names.values()]).toEqual(["Ball Clash (@ballclash)", "Ball Clash (@ballclash2)", "@quizzy", "Your channel", "Maps", "Maps 2"]);
    expect(channelNames([{ id: "a", title: "Solo", handle: "@solo" }]).get("a")).toBe("Solo");
  });
});

describe("plans and channels", () => {
  it("makes Creator's 5 a day for each of up to 5 channels, gives Free and Pro one, and every plan one TikTok account", () => {
    expect(PLANS.creator).toMatchObject({ channels: 5, shorts: { per: "day", count: 5 } });
    expect(PLANS.pro.channels).toBe(1);
    expect(PLANS.free.channels).toBe(1);
    for (const p of Object.values(PLANS)) expect(p.tiktokAccounts).toBe(1);
    expect([postsPerDay(PLANS.free), postsPerDay(PLANS.pro), postsPerDay(PLANS.creator)]).toEqual([3, 3, 5]);
  });
});

describe("posting times for five a day", () => {
  const tz = "America/New_York";
  const at = (hour: number, lift: number, n: number): HourResult[] => Array.from({ length: n }, () => ({ hour, lift }));

  it("starts five a day at 10am, noon, 4pm, 7pm and 9pm, and three a day at noon, 4pm and 7pm", () => {
    expect(startingHours(5)).toEqual([10, 12, 16, 19, 21]);
    expect(startingHours(3)).toEqual(STARTING_HOURS);
    expect(startingHours(4)).toEqual([10, 12, 16, 19]);
    const hours = startingHours(5);
    for (let i = 1; i < hours.length; i++) expect(hours[i] - hours[i - 1]).toBeGreaterThanOrEqual(2);
  });

  it("fits five a day, two hours apart, on the day they're made, trying other hours or not", () => {
    // 6:05am there, as the morning run makes them
    const now = new Date("2026-07-01T10:05:00Z");
    const day = (s: Slot | null) => localParts(s!.at, tz).d;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const explore of [0, EXPLORE, 1]) {
        const slots = planSlots(5, now, tz, [], [], rng(seed), explore, [], 5);
        expect(slots.every((s) => s !== null)).toBe(true);
        expect(slots.map(day)).toEqual([1, 1, 1, 1, 1]);
        for (let i = 1; i < slots.length; i++) expect(slots[i]!.at.getTime() - slots[i - 1]!.at.getTime()).toBeGreaterThanOrEqual(2 * 3600_000);
      }
      // a week's worth lands five on each day
      const week = planSlots(35, now, tz, [], [], rng(seed), EXPLORE, [], 5);
      const perDay = new Map<number, number>();
      for (const s of week) perDay.set(day(s), (perDay.get(day(s)) ?? 0) + 1);
      expect([...perDay.values()]).toEqual([5, 5, 5, 5, 5, 5, 5]);
    }
    // with nothing tried, the starting hours
    expect(planSlots(5, now, tz, [], [], rng(1), 0, [], 5).map((s) => localParts(s!.at, tz).hour)).toEqual([10, 12, 16, 19, 21]);
  });

  it("plans three a day exactly as before", () => {
    const now = new Date("2026-07-01T10:05:00Z");
    const show = (slots: (Slot | null)[]) => slots.map((s) => s && `${s.at.toISOString()} ${s.why}`);
    const learned = [...at(9, 2, 4), ...at(12, 1.2, 9), ...at(16, 1, 9), ...at(19, 0.8, 9)];
    // what planSlots gave for these seeds before a channel could post more than three a day
    const before: Record<number, { guess: string[]; best: string[] }> = {
      1: {
        guess: ["2026-07-01T20:00:00.000Z guess", "2026-07-01T22:00:00.000Z try", "2026-07-02T16:00:00.000Z guess", "2026-07-02T20:00:00.000Z guess", "2026-07-02T23:00:00.000Z guess", "2026-07-03T16:00:00.000Z guess", "2026-07-03T20:00:00.000Z guess"],
        best: ["2026-07-01T13:00:00.000Z best", "2026-07-01T20:00:00.000Z best", "2026-07-01T22:00:00.000Z try", "2026-07-02T13:00:00.000Z best", "2026-07-02T16:00:00.000Z best"],
      },
      2: {
        guess: ["2026-07-01T20:00:00.000Z guess", "2026-07-01T23:00:00.000Z guess", "2026-07-02T16:00:00.000Z guess", "2026-07-02T20:00:00.000Z guess", "2026-07-02T23:00:00.000Z guess", "2026-07-03T16:00:00.000Z guess", "2026-07-03T20:00:00.000Z guess"],
        best: ["2026-07-01T13:00:00.000Z best", "2026-07-01T16:00:00.000Z best", "2026-07-01T20:00:00.000Z best", "2026-07-02T13:00:00.000Z best", "2026-07-02T16:00:00.000Z best"],
      },
      3: {
        guess: ["2026-07-01T18:00:00.000Z try", "2026-07-01T20:00:00.000Z guess", "2026-07-02T18:00:00.000Z try", "2026-07-02T20:00:00.000Z guess", "2026-07-02T23:00:00.000Z guess", "2026-07-03T18:00:00.000Z try", "2026-07-03T20:00:00.000Z guess"],
        best: ["2026-07-01T13:00:00.000Z best", "2026-07-01T20:00:00.000Z best", "2026-07-01T22:00:00.000Z try", "2026-07-02T16:00:00.000Z best", "2026-07-02T22:00:00.000Z try"],
      },
    };
    for (const [seed, want] of Object.entries(before)) {
      expect(show(planSlots(7, now, tz, [], [atLocal(2026, 7, 1, 12, tz)], rng(Number(seed))))).toEqual(want.guess);
      expect(show(planSlots(7, now, tz, [], [atLocal(2026, 7, 1, 12, tz)], rng(Number(seed)), EXPLORE, [], 3))).toEqual(want.guess);
      expect(show(planSlots(5, now, tz, learned, [], rng(Number(seed))))).toEqual(want.best);
    }
  });

  it("names five best hours only once six hours have three results each, and the five beat the sixth", () => {
    const five = [...at(8, 2, 3), ...at(10, 1.8, 3), ...at(12, 1.6, 3), ...at(14, 1.4, 3), ...at(16, 1.2, 3)];
    expect(bestHours(five, 5)).toBeNull();
    expect(bestHours([...five, ...at(19, 0.8, 2)], 5)).toBeNull();
    expect(bestHours([...five, ...at(19, 0.8, 3)], 5)).toEqual([8, 10, 12, 14, 16]);
    // as good as the five, it isn't beaten
    expect(bestHours([...five, ...at(19, 1.2, 3)], 5)).toBeNull();
    // hours too close to fit five in a day, two hours apart, aren't five best ones
    expect(bestHours([...at(8, 2, 3), ...at(9, 2, 3), ...at(10, 2, 3), ...at(11, 2, 3), ...at(12, 2, 3), ...at(13, 1, 3)], 5)).toBeNull();
    // and three a day still needs only four hours
    expect(bestHours([...at(8, 2, 3), ...at(10, 1.8, 3), ...at(12, 1.6, 3), ...at(19, 0.8, 3)])).toEqual([8, 10, 12]);
  });
});

describe("learning on a new channel from the account's others", () => {
  const w = (name: string, score: number, samples: number, kind: Weight["kind"] = "format"): Weight => ({ kind, name, score, samples });

  it("learns exactly as before without other channels", () => {
    // what steady gave before a score could have a prior
    const pinned: [number, number, number][] = [[2, 1, 1.080059738892306], [2, 8, 1.414213562373095], [0.5, 3, 0.8277532798848107], [4, 20, 2.6918003852647123], [3, 200, 2.191799866929709], [0.25, 12, 0.4352752816480621]];
    for (const [score, samples, was] of pinned) {
      expect(steady({ score, samples })).toBe(was);
      expect(steady({ score, samples, prior: 1 })).toBe(was);
    }
    expect(steady({ score: 3, samples: 0 })).toBe(1);
    const own = [w("quiz", 2, 6), w("battle", 0.7, 12), w("battle:spike", 1.6, 4, "key")];
    const alone = withPrior(own, []);
    expect(alone.map(({ prior, ...rest }) => ({ rest, prior }))).toEqual(own.map((x) => ({ rest: x, prior: 1 })));
    expect(odds(alone)).toEqual(odds(own));
  });

  it("starts a channel with no results at its other channels' steady score, and moves it toward its own as they come", () => {
    const others = [w("quiz", 2, 20)];
    const [fresh] = withPrior([], others);
    expect(fresh).toMatchObject({ kind: "format", name: "quiz", score: 1, samples: 0 });
    expect(steady(fresh)).toBeCloseTo(steady({ score: 2, samples: 20 }), 10);
    // two other channels that disagree cancel out
    expect(withPrior([], [w("quiz", 2, 10), w("quiz", 0.5, 10)])[0].prior).toBeCloseTo(1, 10);
    // with 20 of its own, mostly its own: below usual, though the others did well
    const [own] = withPrior([w("quiz", 0.5, 20)], [w("quiz", 4, 20)]);
    expect(steady(own)).toBeLessThan(1);
    expect(steady(own)).toBeGreaterThan(steady({ score: 0.5, samples: 20 }));
    // a new channel's odds follow what its others found
    const o = odds(withPrior([], [w("quiz", 3, 20), w("battle", 0.4, 20)]));
    const even = 1 / Object.keys(o).length;
    expect(o.quiz).toBeGreaterThan(even);
    expect(o.battle).toBeLessThan(even);
  });

  it("says what a new channel's others found, with no figure, and goes by its own once it has its own", () => {
    const well = withPrior([], [w("quiz", 3, 20)])[0];
    const badly = withPrior([w("quiz", 1.4, 2)], [w("quiz", 0.3, 20)])[0];
    const even = withPrior([], [w("quiz", 1.02, 20)])[0];
    expect(formatReason("quizzes", well)).toBe("Your quizzes have done well on your other channels, so this one starts with more of them");
    expect(formatReason("quizzes", badly)).toBe("Your quizzes have done less well on your other channels, so this one starts with fewer, but still some");
    expect(formatReason("quizzes", even)).toBe("Still learning what works on your channel: trying quizzes");
    for (const x of [well, badly]) expect(formatReason("quizzes", x)).not.toMatch(/\d/);
    // with results of its own, what it says is about those
    expect(formatReason("quizzes", { ...w("quiz", 1.05, 10), prior: 3 })).toBe("Quizzes do about as well as your usual Short (10 posted)");
    // and a kind only stands out on its own channel's results, not its others'
    expect(standout("battle:spike:sword", [{ ...w("battle:spike", 1, 3, "key"), prior: 3 }])).toBeNull();
    expect(standout("battle:spike:sword", [{ ...w("battle:spike", 3, 9, "key"), prior: 1 }])?.name).toBe("battle:spike");
  });

  it("shows what's working on a channel by its own results, with a share of its queue that starts from its others'", () => {
    const mine = insights(withPrior([w("quiz", 1.5, 4), w("battle:spike", 1, 3, "key")], [w("battle", 2, 20), w("battle:spike", 1.6, 10, "key")]));
    const format = (f: string) => mine.formats.find((x) => x.format === f)!;
    // the figures shown are its own: battles not measured here yet, quizzes at what they averaged
    expect(format("battle")).toMatchObject({ score: 1, samples: 0 });
    expect(format("quiz")).toMatchObject({ score: 1.5, samples: 4 });
    expect(mine.measured).toBe(4);
    // what it's given more of starts from what the others found
    expect(format("battle").share).toBeGreaterThan(format("wyr").share);
    // and a kind stands out by its own results only: Spike did as usual on this one, well on the other
    expect(mine.kinds).toEqual([]);
    expect(insights([w("battle:spike", 1.6, 10, "key")]).kinds.map((k) => k.name)).toEqual(["Spike battles"]);
  });
});

describe("Earnings across channels", () => {
  const days = lastDays("2026-10-15", 6);
  const reported = (values: Record<string, number>) => fillReported(days, new Map(Object.entries(values)));

  it("adds up channels' days, unknown until every channel being read then has reported", () => {
    const a = { points: reported({ "2026-10-10": 10, "2026-10-11": 20, "2026-10-12": 30, "2026-10-13": 40 }), from: "2026-10-10" };
    const b = { points: reported({ "2026-10-10": 1, "2026-10-12": 3 }), from: "2026-10-10" };
    // the 11th: b had nothing (0); the 13th: b hasn't reported yet; after that, neither has
    expect(addUp([a, b]).map((p) => p.value)).toEqual([11, 20, 33, null, null, null]);
    expect(addUp([a]).map((p) => p.value)).toEqual(a.points.map((p) => p.value));
  });

  it("takes nothing from a channel before its first report, or after an expired one's last", () => {
    const a = { points: reported({ "2026-10-10": 10, "2026-10-11": 20, "2026-10-12": 30, "2026-10-13": 40 }), from: "2026-10-10" };
    // added later: its first report is the 12th
    const later = { points: reported({ "2026-10-12": 5, "2026-10-13": 6 }), from: "2026-10-12" };
    expect(addUp([a, later]).map((p) => p.value)).toEqual([10, 20, 35, 46, null, null]);
    // needs reconnecting: it stopped reporting on the 11th, and doesn't hold the rest back
    const expired = { points: reported({ "2026-10-10": 7, "2026-10-11": 8 }), from: "2026-10-10", until: "2026-10-11" };
    expect(addUp([a, expired]).map((p) => p.value)).toEqual([17, 28, 30, 40, null, null]);
    // a channel with nothing reported adds nothing, and a day no channel was read is unknown
    expect(addUp([{ points: reported({}), from: null }, later]).map((p) => p.value)).toEqual([null, null, 5, 6, null, null]);
    expect(addUp([])).toEqual([]);
  });
});

describe("posting each channel's Shorts", () => {
  const tz = "America/New_York";
  const local = (d: number, h: number) => atLocal(2026, 7, d, h, tz);

  it("keeps one channel's TikTok times, and moves another channel's to two hours from them", () => {
    // one channel's own times are two hours apart already
    const booked: Date[] = [];
    for (const h of startingHours(5)) {
      const t = tiktokTime(local(1, h), booked, tz);
      expect(t).toEqual(local(1, h));
      booked.push(t);
    }
    // a second channel's 4pm post, with the first channel's already at 4pm
    expect(tiktokTime(local(2, 16), [local(2, 16)], tz)).toEqual(local(2, 18));
    // half past is too close as well, and it goes on a whole hour
    expect(tiktokTime(new Date(local(2, 16).getTime() + 30 * 60_000), [local(2, 16)], tz)).toEqual(local(2, 18));
    // two hours from what's booked on either side
    expect(tiktokTime(local(2, 12), [local(2, 11), local(2, 14)], tz)).toEqual(local(2, 16));
  });

  it("never moves a TikTok post before 7am or after 10pm, so the account gets at most 8 a day", () => {
    // 10pm is an hour from 9pm, and later is too late: the next morning at 7
    expect(tiktokTime(local(3, 21), [local(3, 21)], tz)).toEqual(local(4, 7));
    expect(tiktokTime(local(3, 22), [local(3, 22)], tz)).toEqual(local(4, 7));
    // everything asked for at 7am on one day
    const booked: Date[] = [];
    for (let i = 0; i < 9; i++) booked.push(tiktokTime(local(5, 7), booked, tz));
    expect(booked.slice(0, 8).map((t) => [localParts(t, tz).d, localParts(t, tz).hour])).toEqual([[5, 7], [5, 9], [5, 11], [5, 13], [5, 15], [5, 17], [5, 19], [5, 21]]);
    expect(booked[8]).toEqual(local(6, 7));
  });

  it("waits for tomorrow when the TikTok account's daily limit is full, and says so in plain words", () => {
    expect(new TikTokError("TikTok: too many", 403, "spam_risk_too_many_posts").tomorrow).toBe(true);
    expect(tiktokReason("spam_risk_too_many_posts", "TikTok: x")).toBe("TikTok's daily limit for this account is full. It goes at the same time tomorrow.");
    // drafts have a limit of their own, which the creator clears by posting the ones waiting
    expect(new TikTokError("TikTok: drafts", 403, "spam_risk_too_many_pending_share").tomorrow).toBe(false);
    expect(tiktokReason("spam_risk_too_many_pending_share", "TikTok: x")).toBe(
      "TikTok holds at most 5 drafts from apps a day. Post the ones waiting in your drafts, or try again tomorrow.",
    );
  });

  it("names the channel still to say whether it's made for kids", () => {
    expect(keptNote("answer", "Tue 4:00 PM", "Quiz Den")).toBe("Kept. Say whether Quiz Den is made for kids, in Settings, and it posts.");
    expect(keptNote("answer", null)).toBe("Kept. Say whether your channel is made for kids, in Settings, and it posts.");
    expect(keptNote("posts", "Tue 4:00 PM", "Quiz Den")).toBe("Posting Tue 4:00 PM");
  });
});

describe("several channels on screen", () => {
  const up = { status: "connected", api: true };
  const self = { status: "connected", api: false };

  it("says a yes posts only when Hookline uploads to every channel shown, or TikTok takes it", () => {
    expect(postsAll([up, up], true, false)).toBe(true);
    // a test channel and one that isn't: kept, unless TikTok direct posting is on
    expect(postsAll([up, self], true, false)).toBe(false);
    expect(postsAll([up, self], true, true)).toBe(true);
    // one that needs reconnecting, a Short from before the account had a channel, and Free post nothing themselves
    expect(postsAll([{ status: "expired", api: true }], true, false)).toBe(false);
    expect(postsAll([undefined], true, false)).toBe(false);
    expect(postsAll([up], false, false)).toBe(false);
    // and with no channel getting Shorts, nothing posts
    expect(postsAll([], true, true)).toBe(false);
  });

  it("reads whether a channel gets Shorts only from a form that showed its checkbox", () => {
    const form = (...entries: [string, string][]) => {
      const f = new FormData();
      for (const [k, v] of entries) f.append(k, v);
      return f;
    };
    expect(channelSettingsFrom(form(["id", "c"], ["shortsShown", "1"], ["shortsOn", "on"]))).toEqual({ shortsOn: true });
    // an unticked checkbox sends nothing, so the marker beside it is what says it was there
    expect(channelSettingsFrom(form(["id", "c"], ["shortsShown", "1"]))).toEqual({ shortsOn: false });
    expect(channelSettingsFrom(form(["id", "c"]))).toEqual({});
    expect(channelSettingsFrom(form(["id", "c"], ["shortsOn", "on"]))).toEqual({});
  });
});
