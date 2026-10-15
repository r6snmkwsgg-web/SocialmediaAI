import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Candidate } from "../../shorts/types";
import { env } from "../env";

/**
 * Titles and descriptions, written by Claude from the facts of each video
 * and nothing else. The rules keep them honest: say what's in the video,
 * don't promise what isn't, don't make up numbers, don't give endings
 * away. If Claude isn't set up or anything goes wrong, the format's own
 * plain title is used.
 */

const Written = z.object({
  title: z.string().describe("The title, at most 70 characters"),
  description: z.string().describe("One or two short sentences, then 3 to 5 relevant hashtags including #shorts"),
});

export type Copy = { title: string; description: string };

const SYSTEM = `You write the title and description for a short vertical video a creator is about to post to YouTube Shorts and TikTok.

You're given the facts of the video. Write from those facts only.

Rules:
- The title says what the video really is. Nothing in it can be untrue or promise something the video doesn't have.
- Never invent numbers, statistics, percentages, records or claims ("99% fail", "nobody gets this", "you won't believe").
- Never give away an answer, a winner or an ending.
- If the facts say the video is a made-up story, never present it as real.
- At most 70 characters. Plain, punchy, curious. At most one emoji, and only if it fits. No hashtags in the title. No ALL CAPS sentences.
- The description is one or two short sentences that invite a comment, then 3 to 5 relevant hashtags, one of them #shorts.`;

let client: Anthropic | null = null;

/** A video's title and description from Claude, or null to use the plain one. */
export async function writeCopy(c: Candidate, formatName: string): Promise<Copy | null> {
  const e = env();
  if (!e.ANTHROPIC_API_KEY || !e.ANTHROPIC_MODEL) return null;
  client ??= new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 });
  try {
    const res = await client.messages.parse({
      model: e.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Format: ${formatName}\n\nFacts:\n${c.facts.map((f) => `- ${f}`).join("\n")}\n\nA plain title it could have, for reference: ${c.title}`,
        },
      ],
      output_config: { format: zodOutputFormat(Written), effort: "low" },
    });
    if (res.stop_reason !== "end_turn" || !res.parsed_output) return null;
    return tidy(res.parsed_output);
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error(`titles: ${err.status} ${err.message}`);
    else console.error("titles:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Keeps a written title inside the limits, whatever came back. */
export function tidy(c: Copy): Copy | null {
  const title = c.title.replace(/\s+/g, " ").replace(/#\S+/g, "").trim();
  if (!title) return null;
  return {
    title: title.length > 90 ? `${title.slice(0, 87).trimEnd()}…` : title,
    description: c.description.trim().slice(0, 900),
  };
}

/** The description to use when nothing wrote one. */
export function plainDescription(c: Candidate): string {
  const ask: Record<Candidate["format"], string> = {
    battle: "Who did you pick? Comment before the end.",
    quiz: "How many did you get? Comment your score.",
    wyr: "Comment your picks: A or B for each.",
    texts: "What would you reply? A made-up story.",
    ranking: "Did any surprise you? Figures from the World Bank.",
    race: "Who surprised you most? Figures from the World Bank.",
  };
  const tags: Record<Candidate["format"], string> = {
    battle: "#shorts #ballbattle #satisfying",
    quiz: "#shorts #quiz #trivia",
    wyr: "#shorts #wouldyourather",
    texts: "#shorts #textstory #story",
    ranking: "#shorts #ranking #data",
    race: "#shorts #barchartrace #data",
  };
  return `${ask[c.format]}\n\n${tags[c.format]}`;
}
