import { describe, expect, it } from "vitest";
import { odds, TREND_MIN, trendLean, trendReason, withTrends } from "@/lib/shorts/learn";

describe("leaning toward what's rising", () => {
  const allowed = ["battle", "quiz", "wyr", "ranking"] as const;

  it("leaves the odds alone with no trends, or with too few rising Shorts to call a trend", () => {
    expect(trendLean({}, allowed)).toEqual({ battle: 1, quiz: 1, wyr: 1, ranking: 1 });
    const thin = trendLean({ quiz: { typical: 9000, videos: TREND_MIN - 1 }, battle: { typical: 100, videos: 10 } }, allowed);
    expect(thin).toEqual({ battle: 1, quiz: 1, wyr: 1, ranking: 1 });
  });

  it("nudges toward the fastest-growing formats, within 0.8 to 1.5", () => {
    const lean = trendLean(
      {
        quiz: { typical: 4000, videos: 12 },
        battle: { typical: 1000, videos: 12 },
        wyr: { typical: 1000, videos: 12 },
        ranking: { typical: 10, videos: 12 },
      },
      allowed
    );
    expect(lean.quiz).toBeCloseTo(1.5); // twice the middle's square root, capped
    expect(lean.battle).toBeCloseTo(1);
    expect(lean.ranking).toBe(0.8); // far behind, but never dropped
  });

  it("only compares the formats the channel makes", () => {
    const lean = trendLean({ quiz: { typical: 4000, videos: 12 }, race: { typical: 1, videos: 12 } }, ["quiz", "battle"]);
    expect(lean).toEqual({ quiz: 1, battle: 1 }); // one rated format is nothing to compare against
  });

  it("keeps the day's odds adding up to 1, every format at least a fifth of the best", () => {
    const o = odds([], allowed);
    const tilted = withTrends(o, { quiz: 1.5, ranking: 0.8 });
    expect(Object.values(tilted).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(tilted.quiz).toBeGreaterThan(tilted.battle);
    expect(tilted.ranking).toBeLessThan(tilted.battle);
    const best = Math.max(...Object.values(tilted));
    for (const p of Object.values(tilted)) expect(p).toBeGreaterThanOrEqual(best / 5 - 1e-9);
  });

  it("only says so in the queue when the lean is worth mentioning", () => {
    expect(trendReason("quizzes", 1.1)).toBeNull();
    expect(trendReason("quizzes", undefined)).toBeNull();
    expect(trendReason("quizzes", 1.4)).toMatch(/^Quizzes are rising on YouTube Shorts right now/);
  });
});
