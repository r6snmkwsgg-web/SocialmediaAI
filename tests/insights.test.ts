import { describe, expect, it } from "vitest";
import { fill, fillReported, fillSince, fromMinor, fromTotals, goalProgress, lastDays, lastReported, sum } from "@/lib/earnings/series";
import { heatmap, isoSeconds, middle, NICHES, perHour } from "@/lib/trends/niches";
import { insights, kindName } from "@/lib/shorts/insights";
import { keyGroups, kindScore, type Weight } from "@/lib/shorts/learn";
import { FORMAT_IDS } from "@/lib/shorts/types";

describe("trends", () => {
  it("reads YouTube's lengths, so only Shorts count", () => {
    expect(isoSeconds("PT59S")).toBe(59);
    expect(isoSeconds("PT1M5S")).toBe(65);
    expect(isoSeconds("PT3M")).toBe(180);
    expect(isoSeconds("PT1H2M")).toBe(3720);
    expect(isoSeconds("nonsense")).toBe(Infinity);
  });

  it("measures growth in views per hour since it went up", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    expect(perHour(1000, new Date("2026-10-15T02:00:00Z"), now)).toBe(100);
    // a video up for minutes isn't credited with an hour's views a second
    expect(perHour(500, new Date("2026-10-15T11:59:00Z"), now)).toBe(500);
  });

  it("only offers 'make one like this' for niches with a format to make", () => {
    for (const n of NICHES) if (n.format) expect(FORMAT_IDS).toContain(n.format);
    expect(NICHES.filter((n) => n.format).map((n) => n.format).sort()).toEqual([...FORMAT_IDS].sort());
    expect(middle([5, 1, 9])).toBe(5);
    expect(middle([])).toBeNull();
  });

  it("averages posting times into days and three-hour blocks", () => {
    const h = heatmap([
      { weekday: 1, hour: 18, lift: 2 },
      { weekday: 1, hour: 19, lift: 0.5 },
      { weekday: 3, hour: 7, lift: 3 },
    ]);
    expect(h.cells[1][6]).toBeCloseTo(1, 6);
    expect(h.counts[1][6]).toBe(2);
    expect(h.cells[3][2]).toBeCloseTo(3, 6);
    expect(h.cells[0][0]).toBeNull();
  });
});

describe("earnings", () => {
  const days = lastDays("2026-10-15", 5);

  it("lists the days, oldest first", () => {
    expect(days).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
    expect(lastDays("2026-03-02", 3)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
  });

  it("leaves days a source didn't report as zero or unknown, as it should", () => {
    const v = new Map([["2026-10-12", 40], ["2026-10-15", 10]]);
    expect(fill(days, v, 0).map((p) => p.value)).toEqual([0, 40, 0, 0, 10]);
    expect(fill(days, v, null).map((p) => p.value)).toEqual([null, 40, null, null, 10]);
  });

  it("shows YouTube's days not reported yet as unknown, never as zero", () => {
    // YouTube runs a few days behind: it has reported up to the 13th
    const v = new Map([["2026-10-11", 40], ["2026-10-13", 10]]);
    expect(fillReported(days, v).map((p) => p.value)).toEqual([40, 0, 10, null, null]);
    expect(lastReported(v)).toBe("2026-10-13");
    // before its first report is unknown too
    expect(fillReported(["2026-10-09", "2026-10-10", ...days], v).map((p) => p.value).slice(0, 2)).toEqual([null, null]);
    expect(fillReported(days, new Map()).every((p) => p.value === null)).toBe(true);
    expect(lastReported(new Map())).toBeNull();
    expect(sum(fillReported(days, v))).toBe(50);
  });

  it("shows days from before a source was first read as unknown, and quiet days after as zero", () => {
    // Stripe read back to the 12th: the 11th is unknown, the 14th had no sales
    const v = new Map([["2026-10-13", 40]]);
    expect(fillSince(days, v, "2026-10-12").map((p) => p.value)).toEqual([null, 0, 40, 0, 0]);
    expect(fillSince(days, v, null).map((p) => p.value)).toEqual([null, null, 40, null, null]);
  });

  it("turns running totals into daily views, and doesn't guess the gaps", () => {
    const totals = new Map([["2026-10-10", 1000], ["2026-10-12", 1300], ["2026-10-13", 1450], ["2026-10-15", 1500]]);
    expect(fromTotals(days, totals).map((p) => p.value)).toEqual([null, 300, 150, null, 50]);
    // a video deleted, so the total dropped: not negative views
    expect(fromTotals(["2026-10-11"], new Map([["2026-10-10", 900], ["2026-10-11", 800]]))[0].value).toBe(0);
  });

  it("counts a goal over this month or all time", () => {
    const ps = [{ day: "2026-09-30", value: 100 }, { day: "2026-10-01", value: 20 }, { day: "2026-10-15", value: null }, { day: "2026-10-14", value: 5 }];
    expect(goalProgress(ps, "month", "2026-10-15")).toBe(25);
    expect(goalProgress(ps, "all", "2026-10-15")).toBe(125);
    expect(sum([])).toBe(0);
  });

  it("reads Stripe's amounts in each currency's own units", () => {
    expect(fromMinor(1999, "usd")).toBe(19.99);
    expect(fromMinor(1999, "JPY")).toBe(1999);
  });
});

describe("what's working, with rounds from a LIVE", () => {
  const w = (kind: Weight["kind"], name: string, score: number, samples: number): Weight => ({ kind, name, score, samples });

  it("learns a clip's results under its game", () => {
    expect(keyGroups("clip:battle")).toEqual(["clip:battle"]);
    expect(keyGroups("clip:rivals")).toEqual(["clip:rivals"]);
    expect(keyGroups("clip:race")).toEqual([]);
    expect(keyGroups("clip")).toEqual([]);
    expect(kindName("clip:battle")).toBe("Ball Battle clips");
    expect(kindName("clip:rivals")).toBe("Rivals clips");
    expect(kindName("clip:royale")).toBeNull();
    expect(kindScore("clip:rivals", [w("key", "clip:rivals", 2, 30)])).toBeGreaterThan(1.3);
  });

  it("shows them once they have results, with no share of tomorrow's queue, since they're never drawn", () => {
    const before = insights([w("format", "quiz", 1.5, 4)]);
    expect(before.formats.map((f) => f.format)).not.toContain("clip");
    expect(before.formats).toHaveLength(FORMAT_IDS.length);
    const got = insights([w("format", "clip", 2.4, 5), w("key", "clip:rivals", 2.6, 4), w("format", "quiz", 1.2, 6)]);
    expect(got.formats[0]).toEqual({ format: "clip", name: "From your LIVE", plural: "rounds from your LIVEs", score: 2.4, samples: 5, share: 0 });
    // the six formats Hookline makes still share all of it
    expect(got.formats.reduce((s, f) => s + f.share, 0)).toBeCloseTo(1);
    expect(got.kinds.map((k) => k.name)).toEqual(["Rivals clips"]);
    expect(got.measured).toBe(11);
  });
});
