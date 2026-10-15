import { describe, expect, it } from "vitest";
import countries from "@/data/countries.json";
import { rng } from "@/lib/battle/sim";
import { DATA, latestYear, say } from "@/lib/shorts/data";
import { contentIds, FORMATS } from "@/lib/shorts/formats";
import { CAPITALS, FACTS, proposeQuiz, sum } from "@/lib/shorts/formats/quiz";
import { proposeRace, raceParams } from "@/lib/shorts/formats/race";
import { proposeRanking, ranking } from "@/lib/shorts/formats/ranking";
import { proposeTexts, STORIES } from "@/lib/shorts/formats/texts";
import { PAIRS, proposeWyr } from "@/lib/shorts/formats/wyr";
import { chooseFormats, lift, median, odds, updated } from "@/lib/shorts/learn";
import { soundFor } from "@/lib/shorts/sound";
import { atLocal, bestHours, localParts, nextSlots, offsetMinutes } from "@/lib/shorts/times";
import { FPS, frames, storyTimes } from "@/lib/shorts/timing";
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

  it("works its sums out, with three different answers", () => {
    const rand = rng(1);
    for (let i = 0; i < 200; i++) {
      const s = sum(rand);
      const nums = s.q.match(/\d+/g)!.map(Number);
      const ans = Number(s.a.replace(/,/g, ""));
      if (s.q.includes(" x ")) expect(ans).toBe(nums[0] * nums[1]);
      else if (s.q.includes("%")) expect(ans).toBe((nums[0] * nums[1]) / 100);
      else expect(ans).toBe(nums[0] * nums[0]);
      expect(new Set([s.a, ...s.decoys]).size).toBe(3);
    }
  });

  it("runs out rather than repeating", () => {
    expect(proposeQuiz(ctx(1, CAPITALS.map((c) => c.id)), "capitals")).toBeNull();
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

  it("picks charts that aren't on the channel yet", () => {
    const first = proposeRanking(ctx(2))!;
    expect(proposeRanking(ctx(2, [first.key]))!.key).not.toBe(first.key);
    const race = proposeRace(ctx(2))!;
    expect(race.why[0]).toMatch(/overtakes/);
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

  it("learns the best hours only once it has enough to go on", () => {
    expect(bestHours([{ hour: 18, lift: 2 }])).toBeNull();
    const r = [18, 18, 12, 12, 9, 9].map((hour, i) => ({ hour, lift: hour === 18 ? 3 : hour === 12 ? 1 + i * 0.01 : 0.5 }));
    expect(bestHours(r)).toEqual([18, 12, 9]);
  });
});
