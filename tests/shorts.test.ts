import { describe, expect, it } from "vitest";
import countries from "@/data/countries.json";
import { rng } from "@/lib/battle/sim";
import { DATA, latestYear, say } from "@/lib/shorts/data";
import { contentIds, FORMATS, ledgerIds } from "@/lib/shorts/formats";
import { CAPITALS, dataCapitals, FACTS, proposeQuiz, sum } from "@/lib/shorts/formats/quiz";
import { proposeRace, raceOutcomeId, raceParams } from "@/lib/shorts/formats/race";
import { proposeRanking, ranking, rankingYears, topOf } from "@/lib/shorts/formats/ranking";
import { proposeTexts, STORIES } from "@/lib/shorts/formats/texts";
import { PAIRS, proposeWyr } from "@/lib/shorts/formats/wyr";
import { againstUsual, at24h, chooseFormats, formatReason, kindScore, lift, median, odds, standout, steady, updated } from "@/lib/shorts/learn";
import { byDay, dayKey, gridBounds, monthGrid, parseMonth, shiftMonth } from "@/lib/shorts/calendar";
import { historyOf, type HistoryFacts } from "@/lib/shorts/history";
import { insights, kindName, readAfter, times as timesX } from "@/lib/shorts/insights";
import { soundFor } from "@/lib/shorts/sound";
import { labelOf, postSettings, problemWith, tiktokChoices, tiktokReason, type Creator, type TikTokChoices } from "@/lib/shorts/tiktok";
import { atLocal, bestHours, EXPLORE, hourToTry, isWhenLine, localParts, nextSlots, offsetMinutes, planSlots, STARTING_HOURS, TRY_HOURS, whenLine, type HourResult, type Slot } from "@/lib/shorts/times";
import { FPS, frames, RACE, raceStep, storyTimes } from "@/lib/shorts/timing";
import { FORMAT_IDS, type FormatId } from "@/lib/shorts/types";

const ctx = (seed: number, used: string[] = []) => ({ rand: rng(seed), used: new Set(used) });

describe("every format", () => {
  it.each(FORMAT_IDS)("%s makes the same Short from the same seed, a Short's length", (id) => {
    const a = FORMATS[id].propose(ctx(5))!;
    const b = FORMATS[id].propose(ctx(5))!;
    expect(a).toEqual(b);
    const secs = frames(a) / FPS;
    expect(secs).toBeGreaterThan(15);
    expect(secs).toBeLessThan(60);
    expect(a.why.length).toBeGreaterThan(0);
    expect(a.title.length).toBeLessThanOrEqual(100);
    expect(soundFor(a).length).toBeGreaterThan(0);
  });

  it.each(FORMAT_IDS)("%s never repeats what's already on the channel", (id) => {
    const first = FORMATS[id].propose(ctx(9))!;
    const next = FORMATS[id].propose(ctx(9, contentIds(first)))!;
    const used = new Set(contentIds(first));
    expect(contentIds(next).some((x) => used.has(x))).toBe(false);
  });
});

describe("quizzes", () => {
  it("has every capital right, as the country-codes data has it", () => {
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    // Kazakhstan's capital went back to being Astana in 2022; the data still has the name it had before
    const alias: Record<string, string> = { washingtondc: "washington", naypyidaw: "naypyitaw", astana: "nursultan" };
    const data = (countries as { countries: Record<string, { capital: string }> }).countries;
    for (const c of CAPITALS) {
      const want = norm(data[c.iso]?.capital ?? "");
      const got = norm(c.a);
      expect(alias[got] ?? got, c.country).toBe(want);
      expect(c.decoys).not.toContain(c.a);
    }
  });

  it("marks the right answer, in a different place across the quiz", () => {
    const q = proposeQuiz(ctx(3), "science")!;
    if (q.format !== "quiz") throw new Error();
    for (const x of q.params.questions) {
      const fact = FACTS.find((f) => f.id === x.id)!;
      expect(x.options[x.answer]).toBe(fact.a);
      expect(new Set(x.options).size).toBe(3);
    }
    expect(new Set(q.params.questions.map((x) => x.answer)).size).toBeGreaterThan(1);
    expect(q.params.questions.at(-1)!.level).toBe(3);
  });

  it("works its sums out, with three different answers, and never asks a times table", () => {
    const rand = rng(1);
    for (let i = 0; i < 200; i++) {
      const s = sum(rand);
      const nums = s.q.match(/\d+/g)!.map(Number);
      const ans = Number(s.a.replace(/,/g, ""));
      if (s.q.includes(" x ")) {
        expect(ans).toBe(nums[0] * nums[1]);
        expect(nums[0]).toBeGreaterThanOrEqual(12);
      } else if (s.q.includes("%")) expect(ans).toBe((nums[0] * nums[1]) / 100);
      else expect(ans).toBe(nums[0] * nums[0]);
      expect(Number.isInteger(ans)).toBe(true);
      expect(new Set([s.a, ...s.decoys]).size).toBe(3);
      expect(s.level).toBeGreaterThan(1);
    }
  });

  it("runs out rather than repeating", () => {
    expect(proposeQuiz(ctx(1, [...CAPITALS.map((c) => c.id), ...dataCapitals().map((c) => c.id)]), "capitals")).toBeNull();
  });

  it("asks another kind when one has run out, rather than nothing", () => {
    const used = [...CAPITALS.map((c) => c.id), ...dataCapitals().map((c) => c.id)];
    for (let seed = 1; seed <= 12; seed++) {
      const q = proposeQuiz(ctx(seed, used));
      expect(q?.key).not.toBe("quiz:capitals");
      expect(q).not.toBeNull();
    }
  });

  it("asks every country's capital the data has, with real capitals as the wrong answers", () => {
    const caps = new Set(Object.values((countries as { countries: Record<string, { capital: string }> }).countries).map((c) => c.capital.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
    const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const all = dataCapitals();
    expect(all.length).toBeGreaterThan(100);
    for (const f of all) {
      expect(caps.has(plain(f.a)), f.q).toBe(true);
      for (const d of f.decoys) expect(caps.has(plain(d)), f.q).toBe(true);
      expect(new Set([f.a, ...f.decoys]).size).toBe(3);
    }
    // none that are disputed, have moved lately, or give themselves away
    expect(all.map((f) => f.id)).not.toContain("cap-ISR");
    expect(all.some((f) => f.q.includes(f.a))).toBe(false);
  });
});

describe("would you rather, and stories", () => {
  it("asks five different choices, the toughest last", () => {
    const w = proposeWyr(ctx(4))!;
    if (w.format !== "wyr") throw new Error();
    expect(new Set(w.params.pairs.map((p) => p.id)).size).toBe(5);
    const pulls = w.params.pairs.map((p) => PAIRS.find((x) => x.id === p.id)!.pull);
    expect(pulls).toEqual([...pulls].sort((a, b) => a - b));
  });

  it("has every story fit a Short, and runs out of stories rather than repeating", () => {
    for (const s of STORIES) {
      const t = storyTimes(s.messages);
      expect(t.at(-1)!.at / FPS, s.id).toBeLessThan(45);
      expect(t.every((x, i) => i === 0 || x.at > t[i - 1].at)).toBe(true);
    }
    expect(proposeTexts(ctx(1, STORIES.map((s) => s.id)))).toBeNull();
  });
});

describe("rankings and races from real data", () => {
  it("ranks from the World Bank's figures, biggest first", () => {
    const year = latestYear("population");
    const r = ranking("population", "World", 10, year);
    const i = DATA.population.years.indexOf(year);
    expect(r.items).toHaveLength(10);
    expect(r.items.every((x, k) => k === 0 || x.value <= r.items[k - 1].value)).toBe(true);
    expect(r.items[0].value).toBe(DATA.population.values[r.items[0].iso][i]);
    expect(r.source).toContain("World Bank");
  });

  it("says numbers the way people do", () => {
    expect(say("population", 1_450_935_791)).toBe("1.45 billion");
    expect(say("gdp", 27_360_935_000_000)).toBe("$27.4 trillion");
    expect(say("population", 92_400_000)).toBe("92.4 million");
    expect(say("gdp", 4_000_000_000)).toBe("$4 billion");
  });

  it("keeps everyone who's ever in the top of a race, and counts the overtakes", () => {
    const r = raceParams("gdp", "Asia", 1990, 2020, 10);
    expect(r.years[0]).toBe(1990);
    expect(r.years.at(-1)).toBe(2020);
    expect(r.series.length).toBeGreaterThanOrEqual(10);
    expect(r.series.every((s) => s.values.length === r.years.length)).toBe(true);
    expect(r.overtakes).toBeGreaterThan(0);
  });

  it("picks charts that aren't on the channel yet, nor on anyone else's", () => {
    const first = proposeRanking(ctx(2))!;
    const next = proposeRanking(ctx(2, contentIds(first)))!;
    expect(contentIds(next)).not.toEqual(contentIds(first));
    // another channel's year of the same chart is out too
    const other = proposeRanking(ctx(2, ledgerIds(first)))!;
    expect(ledgerIds(other)).not.toEqual(ledgerIds(first));
    const race = proposeRace(ctx(2))!;
    expect(race.why[0]).toMatch(/overtakes/);
    const again = proposeRace(ctx(2, [...contentIds(race), ...ledgerIds(race)]))!;
    expect(ledgerIds(again)).not.toEqual(ledgerIds(race));
    expect(contentIds(again)).not.toEqual(contentIds(race));
  });

  it("claims a chart by how it comes out, so another year that comes out the same isn't another chart", () => {
    const years = rankingYears("population", "South America");
    const ids = years.map((y) => ledgerIds({ format: "ranking", params: ranking("population", "South America", topOf("South America"), y) }));
    // the same countries in the same order, year after year
    expect(new Set(ids.flat()).size).toBeLessThan(years.length / 5);
    const had = ids[0][0];
    for (let seed = 1; seed < 6; seed++) {
      const r = proposeRanking(ctx(seed, [had]));
      expect(r && ledgerIds(r)).not.toContain(had);
    }
    // a race that starts and ends the same way as one someone has is out, whatever its years
    const races = [1960, 1963, 1966].map((from) => raceParams("population", "South America", from, 2020, topOf("South America")));
    const same = races.filter((r) => raceOutcomeId(r) === raceOutcomeId(races[0]));
    expect(same.length).toBeGreaterThan(1);
    const r = proposeRace(ctx(3, [raceOutcomeId(races[0])]))!;
    expect(ledgerIds(r)).not.toContain(raceOutcomeId(races[0]));
  });

  it("ranks a year only when everyone near the top has a figure for it", () => {
    const years = rankingYears("gdp", "Europe");
    expect(Math.min(...years)).toBeGreaterThanOrEqual(1990);
    expect(years).toContain(latestYear("gdp"));
    const popYears = rankingYears("population", "World");
    expect(popYears.length).toBeGreaterThan(50);
    for (const y of years) {
      const r = ranking("gdp", "Europe", 10, y);
      expect(r.items).toHaveLength(10);
    }
  });

  it("slows a short stretch of years down, so every race is a Short's length", () => {
    expect(raceStep(61)).toBe(RACE.year);
    expect(raceStep(21)).toBeGreaterThan(RACE.year);
    const r = raceParams("gdp", "Asia", 2003, 2023, 10);
    const secs = frames({ format: "race", params: r }) / FPS;
    expect(secs).toBeGreaterThan(18);
    expect(secs).toBeLessThan(40);
  });
});

describe("the learning loop", () => {
  it("compares a video with the channel's typical one", () => {
    expect(lift(190, 90)).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });

  it("averages results so a good one and a bad one cancel out", () => {
    const a = updated({ score: 1, samples: 0 }, 2);
    const b = updated(a, 0.5);
    expect(b.samples).toBe(2);
    expect(b.score).toBeCloseTo(1, 5);
  });

  it("favours what's working, but never stops trying the rest", () => {
    const o = odds([{ kind: "format", name: "quiz", score: 3, samples: 10 }, { kind: "format", name: "texts", score: 0.2, samples: 10 }]);
    expect(o.quiz).toBeGreaterThan(o.battle);
    expect(o.texts).toBeGreaterThan(0);
    expect(o.texts).toBeGreaterThanOrEqual(o.quiz / 5 - 1e-9);
    const sumOdds = Object.values(o).reduce((a, b) => a + b, 0);
    expect(sumOdds).toBeCloseTo(1, 6);
  });

  it("trusts a format's score only once it has a few results", () => {
    const o = odds([{ kind: "format", name: "quiz", score: 3, samples: 1 }]);
    const even = 1 / FORMAT_IDS.length;
    expect(o.quiz).toBeLessThan(even * 1.6);
  });

  it("never lets one lucky Short double a format's share", () => {
    // the biggest lift one result can carry, 20×, on a format with nothing else
    const lucky = odds([{ kind: "format", name: "quiz", score: 20, samples: 1 }]);
    expect(lucky.quiz / lucky.battle).toBeLessThan(1.5);
    // even five lucky ones in a row only pull it partway
    expect(steady({ score: 20, samples: 5 })).toBeLessThan(4);
  });

  it("pulls a score toward usual until it has the results to stand on", () => {
    expect(steady(undefined)).toBe(1);
    expect(steady({ score: 3, samples: 0 })).toBe(1);
    expect(steady({ score: 4, samples: 8 })).toBeCloseTo(2, 6);
    // the more results, the more it counts, but never fully
    const by = [1, 3, 8, 20, 200].map((n) => steady({ score: 2, samples: n }));
    expect(by).toEqual([...by].sort((a, b) => a - b));
    expect(by.at(-1)).toBeLessThan(2);
    expect(steady({ score: 0.5, samples: 8 })).toBeCloseTo(1 / steady({ score: 2, samples: 8 }), 6);
    // the same goes for kinds: one result barely moves a matchup
    const w = [{ kind: "key" as const, name: "battle:spike", score: 4, samples: 1 }];
    expect(kindScore("battle:spike:sword", w)).toBeLessThan(1.1);
  });

  it("scales a late reading back to 24 hours", () => {
    expect(at24h(1000, 24)).toBe(1000);
    expect(at24h(1000, 23.9)).toBe(1000);
    expect(at24h(1000, 48)).toBeCloseTo(1000 / Math.SQRT2, 6);
    // between "it all came on day one" (1000) and "it came in evenly" (500)
    expect(at24h(1000, 48)).toBeGreaterThan(500);
    expect(at24h(1000, 48)).toBeLessThan(1000);
  });

  it("says how long after posting a reading was really taken, and marks a late first day as an estimate", () => {
    expect([1.1, 24.2, 72.3].map(readAfter)).toEqual(["After 1 hour", "After 1 day", "After 3 days"]);
    // late ones say so, rounded down so it's always true
    expect([5.9, 30.6, 48.5, 50, 100].map(readAfter)).toEqual(["After 5 hours", "After 30 hours", "After 2 days", "After 50 hours", "After 4 days"]);
    expect(againstUsual(500, 24.3, 240)).toEqual({ vs: lift(500, 240), estimated: false });
    expect(againstUsual(500, 48, 240)).toEqual({ vs: lift(at24h(500, 48), 240), estimated: true });
  });

  it("says what a format really averaged, and only calls it a pattern once there's enough", () => {
    expect(formatReason("quizzes", undefined)).toBe("Still learning what works on your channel: trying quizzes");
    expect(formatReason("quizzes", { kind: "format", name: "quiz", score: 3, samples: 2 })).toMatch(/2 quizzes so far/);
    expect(formatReason("quizzes", { kind: "format", name: "quiz", score: 1.4, samples: 3 })).toBe("Your quizzes have averaged 1.4× your usual views at 24 hours, from 3: too few to go on yet");
    expect(formatReason("quizzes", { kind: "format", name: "quiz", score: 2.4, samples: 10 })).toBe("Your quizzes have averaged 2.4× your usual views at 24 hours (10 posted)");
    expect(formatReason("quizzes", { kind: "format", name: "quiz", score: 0.5, samples: 10 })).toMatch(/^Your quizzes have averaged 0\.5× .*fewer of them/);
    expect(formatReason("quizzes", { kind: "format", name: "quiz", score: 1.05, samples: 10 })).toBe("Quizzes do about as well as your usual Short (10 posted)");
  });

  it("only names a kind that clearly stands out", () => {
    const w = (name: string, score: number, samples: number) => ({ kind: "key" as const, name, score, samples });
    expect(standout("battle:spike:sword", [w("battle:spike", 3, 2)])).toBeNull();
    expect(standout("battle:spike:sword", [w("battle:spike", 1.2, 10)])).toBeNull();
    expect(standout("battle:spike:sword", [w("battle:spike", 2, 6), w("battle:sword", 3, 9)])?.name).toBe("battle:sword");
  });

  it("picks never more than two of a kind in a day", () => {
    const o = Object.fromEntries(FORMAT_IDS.map((f) => [f, f === "quiz" ? 100 : 0.001])) as Record<FormatId, number>;
    const picked = chooseFormats(5, o, rng(1));
    expect(picked).toHaveLength(5);
    expect(picked.filter((f) => f === "quiz").length).toBe(2);
  });
});

describe("posting times", () => {
  it("knows local time across a clock change", () => {
    expect(atLocal(2026, 7, 1, 18, "America/New_York").toISOString()).toBe("2026-07-01T22:00:00.000Z");
    expect(atLocal(2026, 12, 1, 18, "America/New_York").toISOString()).toBe("2026-12-01T23:00:00.000Z");
    expect(offsetMinutes(new Date("2026-07-01T12:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(localParts(new Date("2026-07-01T22:00:00Z"), "America/New_York")).toMatchObject({ y: 2026, m: 7, d: 1, hour: 18 });
  });

  it("finds the next free times, an hour out and two hours apart from anything booked", () => {
    const now = new Date("2026-07-01T15:30:00Z"); // 11:30 in New York
    const taken = [new Date("2026-07-01T16:00:00Z")]; // noon
    const slots = nextSlots(3, now, "America/New_York", [12, 16, 19], taken);
    expect(slots.map((d) => localParts(d, "America/New_York").hour)).toEqual([16, 19, 12]);
    expect(slots[2].getTime()).toBeGreaterThan(slots[1].getTime());
  });

  const at = (hour: number, lift: number, n: number): HourResult[] => Array.from({ length: n }, () => ({ hour, lift }));

  it("learns the best hours only once it has enough to go on", () => {
    expect(bestHours([{ hour: 18, lift: 2 }])).toBeNull();
    // the three hours it's posted at aren't "best" until another hour has really been tried
    const three = [...at(12, 1.2, 9), ...at(16, 1, 9), ...at(19, 0.8, 9)];
    expect(bestHours(three)).toBeNull();
    expect(bestHours([...three, ...at(9, 2, 2)])).toBeNull();
    expect(bestHours([...three, ...at(9, 2, 3)])).toEqual([9, 12, 16]);
  });

  it("doesn't let one lucky Short make an hour the best", () => {
    const usual = [...at(12, 1.3, 10), ...at(16, 1.2, 10), ...at(19, 1.1, 10)];
    // one 20× Short at 8am, with two ordinary ones, doesn't beat ten steady 1.3× ones at noon
    expect(bestHours([...usual, { hour: 8, lift: 20 }, ...at(8, 1, 2)])).toEqual([12, 16, 19]);
    // three good ones in a row is a real result
    expect(bestHours([...usual, ...at(8, 2, 3)])![0]).toBe(8);
  });

  it("tries other hours some of the time, finishing one before starting the next", () => {
    expect(STARTING_HOURS).toEqual([12, 16, 19]);
    // an hour already started is finished first, and an hour in use is never picked
    expect(hourToTry(new Map([[9, 1]]), STARTING_HOURS, rng(1))).toBe(9);
    expect(hourToTry(new Map([[9, 3], [12, 1]]), STARTING_HOURS, rng(1))).not.toBe(9);
    const now = new Date("2026-07-01T10:00:00Z");
    const tz = "America/New_York";
    const slots = planSlots(80, now, tz, [], [], rng(7));
    expect(slots.every((x) => x !== null)).toBe(true);
    const trying = slots.filter((x) => x?.why === "try");
    // about one in five, never at the starting hours, and all the rest at them
    expect(trying.length / slots.length).toBeGreaterThan(0.1);
    expect(trying.length / slots.length).toBeLessThan(0.3);
    expect(trying.every((x) => !STARTING_HOURS.includes(localParts(x!.at, tz).hour))).toBe(true);
    // each hour tried gets three Shorts, enough to measure, before the next one starts
    const runs = trying.map((x) => localParts(x!.at, tz).hour).join(",").match(/(\d+)(,\1)*/g)!;
    expect(runs.slice(0, -1).every((r) => r.split(",").length === 3)).toBe(true);
    expect(slots.filter((x) => x?.why === "guess").every((x) => STARTING_HOURS.includes(localParts(x!.at, tz).hour))).toBe(true);
    // with exploring off, as when a yes needs a new time, only the usual hours
    expect(planSlots(10, now, tz, [], [], rng(7), 0).every((x) => x?.why === "guess")).toBe(true);
  });

  it("only picks best hours that fit in a day together, and that beat an hour really tried", () => {
    // noon and 1pm both do well, but posts are two hours apart, so only the better of them is used
    const close = [...at(13, 1.6, 9), ...at(12, 1.5, 9), ...at(19, 1.4, 9), ...at(16, 1, 9)];
    expect(bestHours([...close, ...at(9, 0.8, 3)])).toEqual([13, 19, 16]);
    // left out only for being too close isn't beaten: 16 has to have done better than something
    expect(bestHours(close)).toBeNull();
    for (const seed of [1, 2, 3]) {
      const rand = rng(seed);
      const noisy = TRY_HOURS.flatMap((h) => Array.from({ length: 4 }, () => ({ hour: h, lift: 0.5 + rand() * 2 })));
      const best = bestHours(noisy)!;
      expect(best).toHaveLength(3);
      for (const a of best) for (const b of best) if (a !== b) expect(Math.abs(a - b)).toBeGreaterThanOrEqual(2);
    }
  });

  it("counts a Short still waiting for its 24-hour reading toward the hour it's trying", () => {
    const tz = "America/New_York";
    const now = new Date("2026-07-01T10:05:00Z");
    // posted at 9am yesterday, not measured yet: 9am is the hour to finish
    const yesterday9 = new Date("2026-06-30T13:00:00Z");
    for (const seed of [1, 2, 3, 4]) {
      const [s] = planSlots(1, now, tz, [], [], rng(seed), 1, [yesterday9]);
      expect(s).toMatchObject({ why: "try" });
      expect(localParts(s!.at, tz).hour).toBe(9);
    }
  });

  it("tries an hour in place of a usual time that day, so the rest never get pushed later", () => {
    const tz = "America/New_York";
    const now = new Date("2026-07-01T10:05:00Z"); // 6:05am there
    const day = (s: Slot | null) => localParts(s!.at, tz).d;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      // every one of them up for trying: one hour gets tried (one at a time), and all three are still today, two hours apart
      const all = planSlots(3, now, tz, [], [], rng(seed), 1);
      expect(all.map(day)).toEqual([1, 1, 1]);
      expect(all.filter((x) => x?.why === "try")).toHaveLength(1);
      expect(all[1]!.at.getTime() - all[0]!.at.getTime()).toBeGreaterThanOrEqual(2 * 3600_000);
      expect(all[2]!.at.getTime() - all[1]!.at.getTime()).toBeGreaterThanOrEqual(2 * 3600_000);
      // a week's worth at once lands on the same days as with no trying at all
      expect(planSlots(21, now, tz, [], [], rng(seed), 0.5).map(day)).toEqual(planSlots(21, now, tz, [], [], rng(seed), 0).map(day));
    }
    // an hour being finished that doesn't fit today waits, rather than going to tomorrow or starting another
    // (1pm has two Shorts posted, today's noon and 4pm are booked, and 1pm is too close to noon)
    const booked = [atLocal(2026, 7, 1, 12, tz), atLocal(2026, 7, 1, 16, tz)];
    const [s] = planSlots(1, now, tz, [], booked, rng(1), 1, [atLocal(2026, 6, 29, 13, tz), atLocal(2026, 6, 30, 13, tz)]);
    expect(s).toMatchObject({ why: "guess", at: atLocal(2026, 7, 1, 19, tz) });
  });

  /**
   * A channel's year, day by day, the way the worker runs it: three Shorts
   * made at 6:05am, everything not yet posted counted as booked, and each
   * posted Short measured a day later. `lift` is how a Short does at each hour.
   */
  function year(lift: (hour: number) => number, seed: number) {
    const tz = "America/New_York";
    const rand = rng(seed);
    let booked: Date[] = [];
    const posted: Date[] = [];
    const days: { now: Date; slots: (Slot | null)[]; pending: number; best: number[] | null }[] = [];
    for (let d = 0; d < 365; d++) {
      const date = new Date(Date.UTC(2026, 2, 1 + d));
      const now = new Date(atLocal(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 6, tz).getTime() + 5 * 60_000);
      posted.push(...booked.filter((t) => t <= now));
      const pending = booked.filter((t) => t > now);
      const read = posted.filter((t) => t.getTime() + 24 * 3600_000 <= now.getTime()).slice(-60);
      const results = read.map((t) => ({ hour: localParts(t, tz).hour, lift: lift(localParts(t, tz).hour) }));
      const unmeasured = posted.filter((t) => t.getTime() + 24 * 3600_000 > now.getTime());
      const slots = planSlots(3, now, tz, results, pending, rand, EXPLORE, unmeasured);
      booked = [...pending, ...slots.filter((s): s is Slot => !!s).map((s) => s.at)];
      days.push({ now, slots, pending: pending.length, best: bestHours(results) });
    }
    return { tz, days };
  }

  it("keeps a Pro channel's three a day on the day they're made, all year, while it learns", () => {
    // noon and 1pm both beat everything else, which once let the best hours sit too close to fit
    for (const seed of [1, 2, 3]) {
      const { tz, days } = year((h) => (h === 13 ? 1.6 : h === 12 ? 1.5 : h === 19 ? 1.4 : 0.9), seed);
      const slots = days.flatMap((d) => d.slots);
      expect(slots.every((s) => s !== null)).toBe(true);
      // nothing left over from yesterday, and nothing booked further out than tonight
      expect(days.every((d) => d.pending === 0)).toBe(true);
      expect(days.every((d) => d.slots.every((s) => s!.at.getTime() - d.now.getTime() < 17 * 3600_000))).toBe(true);
      // about one in five tried at another hour
      const tried = slots.filter((s) => s!.why === "try").length / slots.length;
      expect(tried).toBeGreaterThan(0.15);
      expect(tried).toBeLessThan(0.25);
      // it learns, and its best hours always fit together
      expect(days.slice(30).filter((d) => d.best).length).toBeGreaterThan(300);
      for (const d of days.filter((x) => x.best)) {
        expect(d.best).toContain(12);
        expect(d.best).toContain(19);
        expect(d.best).not.toContain(13);
      }
      // the first hours tried each get their three before the next one starts
      const first = slots.filter((s) => s!.why === "try").slice(0, 12).map((s) => localParts(s!.at, tz).hour);
      expect(first.join(",").match(/(\d+)(,\1)*/g)!.every((r) => r.split(",").length === 3)).toBe(true);
    }
  });

  it("says exactly what's known about each time", () => {
    const tz = "America/New_York";
    const noon = new Date("2026-07-01T16:00:00Z");
    expect(whenLine({ at: noon, why: "guess", results: 0 }, tz, true)).toBe("Posts at noon, a starting guess until your own numbers come in");
    expect(whenLine({ at: noon, why: "try", results: 1 }, tz, true)).toBe("Posts at noon: trying another hour, to learn when your Shorts do best");
    expect(whenLine({ at: noon, why: "best", results: 6 }, tz, false)).toBe("Best posted around noon: one of your best hours so far, from 6 Shorts posted then");
    expect(isWhenLine("Posts at 4pm, a starting guess until your own numbers come in")).toBe(true);
    expect(isWhenLine("Your quizzes have averaged 2.0× your usual views")).toBe(false);
    // once it's learned, the best hours are the ones used, and say how many Shorts they're from
    const learned = [...at(12, 1.2, 9), ...at(16, 1, 9), ...at(19, 0.8, 9), ...at(9, 2, 4)];
    const best = planSlots(3, new Date("2026-07-01T10:00:00Z"), tz, learned, [], rng(3), 0);
    expect(best.map((x) => x!.why)).toEqual(["best", "best", "best"]);
    expect(best.map((x) => localParts(x!.at, tz).hour).sort((a, b) => a - b)).toEqual([9, 12, 16]);
    expect(best.find((x) => localParts(x!.at, tz).hour === 9)!.results).toBe(4);
  });
});

describe("TikTok's questions", () => {
  const creator: Creator = { nickname: "Matt", privacy: ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "SELF_ONLY"], commentOff: false, duetOff: true, stitchOff: false, maxSeconds: 60 };
  const pick: TikTokChoices = { privacy: "PUBLIC_TO_EVERYONE", comment: true, duet: true, stitch: false, disclose: false, yourBrand: false, branded: false };

  it("posts only what the creator picked, from what TikTok offers their account", () => {
    expect(problemWith(pick, creator, 30)).toBeNull();
    expect(problemWith({ ...pick, privacy: "MUTUAL_FOLLOW_FRIENDS" }, creator, 30)).toMatch(/choices TikTok gives/);
    expect(problemWith(pick, creator, 75)).toMatch(/up to 60 seconds/);
    expect(tiktokChoices.safeParse({ ...pick, privacy: "EVERYONE" }).success).toBe(false);
  });

  it("asks what a promotion is for, and never lets branded content be private", () => {
    expect(problemWith({ ...pick, disclose: true }, creator, 30)).toMatch(/promotes you, someone else, or both/);
    expect(problemWith({ ...pick, disclose: true, yourBrand: true }, creator, 30)).toBeNull();
    expect(problemWith({ ...pick, disclose: true, branded: true, privacy: "SELF_ONLY" }, creator, 30)).toMatch(/can't be private/);
    expect(labelOf({ disclose: false, yourBrand: true, branded: true })).toBeNull();
    expect(labelOf({ disclose: true, yourBrand: true, branded: false })).toBe("Promotional content");
    expect(labelOf({ disclose: true, yourBrand: true, branded: true })).toBe("Paid partnership");
  });

  it("keeps off whatever the creator has switched off on TikTok", () => {
    expect(postSettings(pick, creator)).toEqual({
      privacy_level: "PUBLIC_TO_EVERYONE",
      disable_comment: false,
      disable_duet: true,
      disable_stitch: true,
      brand_content_toggle: false,
      brand_organic_toggle: false,
    });
    expect(postSettings({ ...pick, disclose: true, branded: true }, creator)).toMatchObject({ brand_content_toggle: true, brand_organic_toggle: false });
  });

  it("says why TikTok turned a post down in words a creator can act on", () => {
    expect(tiktokReason("spam_risk_too_many_posts", "TikTok: x")).toMatch(/daily limit for this account is full/);
    expect(tiktokReason("something_new", "TikTok: something new")).toBe("TikTok: something new");
    expect(tiktokReason(null, "TikTok: 500")).toBe("TikTok: 500");
  });
});

describe("the Shorts calendar", () => {
  it("lays a month out in whole weeks, Sunday first", () => {
    const oct = monthGrid({ y: 2026, m: 10 });
    expect(oct).toHaveLength(5);
    expect(oct[0][0]).toMatchObject({ y: 2026, m: 9, d: 27, inMonth: false });
    expect(oct.at(-1)!.at(-1)).toMatchObject({ m: 10, d: 31, inMonth: true });
    // February 2026 starts on a Sunday and fits in exactly four weeks
    expect(monthGrid({ y: 2026, m: 2 })).toHaveLength(4);
  });

  it("reads the month from the address, or uses this one where they are", () => {
    const now = new Date("2026-10-31T23:30:00Z");
    expect(parseMonth("2027-01", now, "UTC")).toEqual({ y: 2027, m: 1 });
    expect(parseMonth("2027-13", now, "UTC")).toEqual({ y: 2026, m: 10 });
    expect(parseMonth(undefined, now, "Asia/Tokyo")).toEqual({ y: 2026, m: 11 });
    expect(shiftMonth({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
    expect(shiftMonth({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 });
  });

  it("puts each Short on the day it posts where they live", () => {
    const { from, to } = gridBounds({ y: 2026, m: 10 }, "America/New_York");
    expect(from.toISOString()).toBe("2026-09-27T04:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    const late = { at: new Date("2026-10-16T02:00:00Z") };
    expect(dayKey(late.at, "America/New_York")).toBe("2026-10-15");
    expect([...byDay([late], "UTC").keys()]).toEqual(["2026-10-16"]);
  });
});

describe("what's working", () => {
  const w = (kind: "format" | "key", name: string, score: number, samples: number) => ({ kind, name, score, samples });

  it("names kinds the way people say them", () => {
    expect(kindName("battle:spike")).toBe("Spike battles");
    expect(kindName("quiz:capitals")).toBe("Capital city quizzes");
    expect(kindName("texts:twist")).toBe("Stories with a twist");
    expect(kindName("ranking:gdp")).toBe("GDP rankings");
    expect(kindName("race:population")).toBe("Population races");
    expect(kindName("wyr")).toBeNull();
  });

  it("puts measured formats first, best first, and only kinds that clearly stand out", () => {
    const got = insights([w("format", "quiz", 1.9, 6), w("format", "battle", 0.8, 4), w("key", "quiz:capitals", 2.2, 4), w("key", "texts:funny", 1.05, 9), w("key", "battle:grow", 3, 2)]);
    expect(got.formats.map((f) => f.format).slice(0, 2)).toEqual(["quiz", "battle"]);
    expect(got.formats[2].samples).toBe(0);
    expect(got.measured).toBe(10);
    expect(got.kinds.map((k) => k.name)).toEqual(["Capital city quizzes"]);
    expect(got.formats.reduce((s, f) => s + f.share, 0)).toBeCloseTo(1);
    expect(timesX(1.94)).toBe("1.9×");
    expect(timesX(12.4)).toBe("12×");
  });
});

describe("a Short's history", () => {
  const base: HistoryFacts = {
    createdAt: new Date("2026-10-01T21:00:00Z"), origin: "daily", decidedAt: new Date("2026-10-01T23:00:00Z"), status: "posted",
    scheduledFor: new Date("2026-10-02T19:00:00Z"), render: { status: "done", finishedAt: new Date("2026-10-02T00:00:00Z"), error: null },
    uploadedAt: new Date("2026-10-02T01:00:00Z"), publishAt: new Date("2026-10-02T19:00:00Z"), youtubeId: "abc", postedAt: new Date("2026-10-02T19:00:00Z"),
    tiktokAt: null, tiktokPostedAt: null, tiktokError: null, error: null,
  };

  it("lists what happened, in order, and what's booked next", () => {
    expect(historyOf(base).map((s) => s.title)).toEqual(["Made for your queue", "You said yes", "Made into a video", "Up on YouTube, private until its time", "Public on YouTube"]);
    const coming = historyOf({ ...base, status: "scheduled", postedAt: null, tiktokAt: base.scheduledFor }, new Date("2026-10-02T02:00:00Z"));
    expect(coming.slice(-2).map((s) => [s.title, s.tone])).toEqual([["Posts", "next"], ["Goes to TikTok", "next"]]);
  });

  it("says where it went wrong", () => {
    const failed = historyOf({ ...base, status: "failed", render: { status: "failed", finishedAt: null, error: "x" }, uploadedAt: null, postedAt: null, youtubeId: null, error: "Rendering failed: x" });
    expect(failed.at(-1)).toMatchObject({ title: "Couldn't be made into a video", tone: "bad" });
    expect(historyOf({ ...base, status: "review", decidedAt: null }).at(-1)?.title).toBe("Waiting for your yes or no");
    expect(historyOf({ ...base, status: "rejected" }).at(-1)?.title).toBe("You skipped it");
  });

  it("says when it's waiting for YouTube's upload quota", () => {
    const waiting = historyOf({ ...base, status: "ready", uploadedAt: null, youtubeId: null, postedAt: null, heldBack: { on: "youtube_quota", until: new Date("2026-10-03T07:05:00Z") } }, new Date("2026-10-02T20:00:00Z"));
    expect(waiting.map((s) => s.title)).toContain("Waiting for YouTube upload quota");
    expect(waiting.at(-1)).toMatchObject({ title: "Due to post", tone: "next" });
    expect(historyOf(base).map((s) => s.title)).not.toContain("Waiting for YouTube upload quota");
  });
});
