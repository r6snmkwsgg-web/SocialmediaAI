import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
