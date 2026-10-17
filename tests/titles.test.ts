import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rng } from "@/lib/battle/sim";
import { PLANS } from "@/lib/billing/plans";
import { replay } from "@/lib/live/clip";
import { demoClip } from "@/lib/live/clip-demo";
import { DEFAULT_GIFTS } from "@/lib/live/menu";
import { finish } from "@/lib/shorts/formats";
import { clipCandidate } from "@/lib/shorts/formats/clip";
import type { Candidate } from "@/lib/shorts/types";

/**
 * Titles from Claude: the effort setting is sent until a model turns it
 * down, a model that does is asked again without it (and only then is it
 * blamed), and every fall back to the plain title says why in the log.
 */

const parse = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const real = (await importOriginal<typeof import("@anthropic-ai/sdk")>()).default;
  class Fake extends real {
    constructor() {
      super({ apiKey: "test" });
      (this as unknown as { messages: unknown }).messages = { parse };
    }
  }
  return { default: Fake };
});

const candidate = { format: "quiz", title: "Quiz: capitals", facts: ["Five capital cities"] } as unknown as Candidate;
const answer = { stop_reason: "end_turn", parsed_output: { title: "Five capitals, three seconds each", description: "How many did you get? #shorts" } };

async function titlesWith(model: string) {
  vi.resetModules();
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.ANTHROPIC_MODEL = model;
  return import("@/lib/server/shorts/titles");
}

describe("titles", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    parse.mockReset();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
  });

  it("sends effort to every model until one turns it down", async () => {
    parse.mockResolvedValue(answer);
    const t = await titlesWith("model-a");
    expect(t.takesEffort("model-a")).toBe(true);
    expect(await t.writeCopy(candidate, "Quiz")).toMatchObject({ title: "Five capitals, three seconds each" });
    expect(parse.mock.calls[0][0].output_config).toMatchObject({ effort: "low" });
  });

  it("asks again without effort when a model turns it down, and remembers", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const no = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "effort isn't supported" } }, "effort isn't supported", new Headers());
    parse.mockRejectedValueOnce(no).mockResolvedValue(answer);
    const t = await titlesWith("model-b");
    expect(await t.writeCopy(candidate, "Quiz")).not.toBeNull();
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[1][0].output_config).not.toHaveProperty("effort");
    expect(warn.mock.calls.join(" ")).toMatch(/turned down the effort setting/);
    // from then on it isn't sent at all
    await t.writeCopy(candidate, "Quiz");
    expect(parse).toHaveBeenCalledTimes(3);
    expect(parse.mock.calls[2][0].output_config).not.toHaveProperty("effort");
  });

  it("only blames effort when leaving it off is what fixed it", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const bad = (message: string) => new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message } }, message, new Headers());
    // turned down for something else: asked once without effort, turned down again, the real reason in the log, effort still sent next time
    const t = await titlesWith("model-d");
    parse.mockRejectedValueOnce(bad("messages: text content blocks must be non-empty")).mockRejectedValueOnce(bad("messages: text content blocks must be non-empty")).mockResolvedValue(answer);
    expect(await t.writeCopy(candidate, "Quiz")).toBeNull();
    expect(parse).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.join(" ")).not.toMatch(/turned down the effort setting/);
    expect(warn.mock.calls.at(-1)?.[0]).toMatch(/400 .*text content blocks must be non-empty/);
    await t.writeCopy(candidate, "Quiz");
    expect(parse.mock.calls[2][0].output_config).toMatchObject({ effort: "low" });

    // the same with a vaguer reason: it wasn't the effort, so that isn't remembered
    parse.mockReset();
    const unknown = await titlesWith("model-c");
    parse.mockRejectedValueOnce(bad("Invalid request")).mockRejectedValueOnce(bad("Invalid request")).mockResolvedValue(answer);
    expect(await unknown.writeCopy(candidate, "Quiz")).toBeNull();
    expect(parse).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.join(" ")).not.toMatch(/turned down the effort setting/);
    await unknown.writeCopy(candidate, "Quiz");
    expect(parse.mock.calls[2][0].output_config).toMatchObject({ effort: "low" });
  });

  it("says why whenever it falls back to the plain title", async () => {
    const t = await titlesWith("model-e");
    parse.mockResolvedValueOnce({ stop_reason: "max_tokens", parsed_output: null });
    expect(await t.writeCopy(candidate, "Quiz")).toBeNull();
    expect(warn.mock.calls.at(-1)?.[0]).toMatch(/plain title for "Quiz: capitals" \(model-e\): Claude stopped early \(max_tokens\)/);
    parse.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await t.writeCopy(candidate, "Quiz")).toBeNull();
    expect(warn.mock.calls.at(-1)?.[0]).toMatch(/socket hang up/);
  });

  it("gives a round from a LIVE its plain title and description when what's written talks about gifts", async () => {
    const t = await titlesWith("model-g");
    const clip = { format: "clip", title: "Real Madrid vs Barcelona: a ball battle round from my LIVE", facts: ["A round from a LIVE"] } as unknown as Candidate;
    const written = (title: string, description: string) => parse.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { title, description } });
    for (const [title, description] of [
      ["Barcelona's last-second comeback", "Would you have sent Barcelona a meteor? Catch my next LIVE and back your side! #shorts #live"],
      ["Viewers' gifts flipped this round", "Who would you have backed? #shorts #live"],
      ["One meteor changed everything", "Coins well spent! Who would you have backed? #shorts"],
      ["Barcelona hung on", "Send a shield next time! #shorts #gifting"],
    ]) {
      written(title, description);
      expect(await t.writeCopy(clip, "From your LIVE"), title).toBeNull();
      expect(warn.mock.calls.at(-1)?.[0]).toMatch(/it talked about gifts/);
    }
    // one that only says what happened in the round is kept
    written("Barcelona hung on with 1 HP", "Who would you have backed? Comment before the end. #shorts #ballbattle");
    expect(await t.writeCopy(clip, "From your LIVE")).toEqual({ title: "Barcelona hung on with 1 HP", description: "Who would you have backed? Comment before the end. #shorts #ballbattle" });
    // and any other kind of Short can say it
    written("Five gift ideas, ranked", "Which would you pick? #shorts");
    expect(await t.writeCopy(candidate, "Quiz")).toMatchObject({ title: "Five gift ideas, ranked" });
  });
});

describe("a round from a LIVE", () => {
  const rounds = (["battle", "rivals"] as const).map((game) => {
    const log = demoClip(game);
    return { log, c: clipCandidate({ log, played_at: new Date(log.at) }, replay(log), { tz: "UTC", per: PLANS.pro.shorts, rand: rng(1) })! };
  });

  it("is titled plainly as a ball battle round from the LIVE, with the sides the LIVE had", () => {
    for (const { log, c } of rounds) {
      expect(c.title).toBe(`${log.teams[0].name} vs ${log.teams[1].name}: a ball battle round from my LIVE`);
      expect(c.title.length).toBeLessThanOrEqual(70);
    }
    // a Rivals round says its names only stand for the sides viewers picked
    expect(rounds[1].c.facts.join(" ")).toMatch(/only stand for the sides viewers picked/);
  });

  it("asks for a comment in its description only where comments are on, and credits the LIVE", async () => {
    const { plainDescription } = await import("@/lib/server/shorts/titles");
    const { c } = rounds[0];
    const on = plainDescription(finish(c, { ending: "comment" }));
    expect(on).toMatch(/^Who would you have backed\? Comment before the end\. From my LIVE\./);
    expect(on).toMatch(/#shorts #ballbattle #live$/);
    const off = plainDescription(finish(c, { ending: "comment", allowComments: false }));
    expect(off).not.toMatch(/comment/i);
    expect(off).toMatch(/From my LIVE/);
  });

  it("never gives the title writer a viewer's name, coins, a gift or who won", () => {
    for (const { log, c } of rounds) {
      const facts = finish(c, { ending: "comment" }).facts.join(" ");
      for (const p of log.people) expect(facts, p).not.toMatch(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
      for (const g of [...DEFAULT_GIFTS.map((x) => x.name), "Universe"]) expect(facts).not.toContain(g);
      // it's told not to mention coins, and is never given any
      expect(facts).not.toMatch(/\d[\d,]*\s*coins?/i);
      // nor gifts, and it's told never to ask anyone to send one
      expect(facts).toMatch(/Don't mention gifts, coins, money or what anything costs, and never ask anyone to send anything\. Don't name any viewer\./);
      expect(facts).not.toMatch(/big gifts? went off/);
      expect(facts).toMatch(/Don't say who wins\./);
      expect(facts).not.toMatch(/\bwon\b|\bbeat\b/i);
      const winner = log.teams[log.result.team ?? 0].name;
      // the winner is only ever named as one of the two sides
      expect(facts.split(winner).length - 1).toBe(1);
    }
  });
});
