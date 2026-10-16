import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { pairProblem, questionProblem, storyProblem, textId, words, wordsId } from "../../shorts/checks";
import type { Fact, Pair, Tale } from "../../shorts/types";
import { env } from "../env";

/**
 * New material for a channel's quizzes, would-you-rathers and text
 * stories, written by Claude so channels don't run out and don't share
 * anything. Nothing goes in a Short unless the code's checks pass it
 * (lib/shorts/checks.ts): no sums (the code works those out), nothing
 * unsafe or aimed at young kids, nothing asked before. Quiz facts are
 * only ones Claude is sure of, and a second call answers each question
 * without being told the answer: only the ones it gets right, is sure of
 * and says can't change are kept. Without Claude set up, all of this
 * gives nothing and the formats use their built-in banks.
 */

/** One question to Claude, its answer in the shape asked for, or null. */
export type Ask = <S extends z.ZodType>(system: string, user: string, schema: S) => Promise<z.infer<S> | null>;

let client: Anthropic | null = null;

/**
 * Claude as the app is set up to reach it, or null when it isn't. Every
 * question has to be answered by `until` (a time in ms), retries and all;
 * after that it gives nothing, so a channel's Shorts never wait long on it.
 */
export function claude(until = Infinity): Ask | null {
  const e = env();
  if (!e.ANTHROPIC_API_KEY || !e.ANTHROPIC_MODEL) return null;
  const model = e.ANTHROPIC_MODEL;
  client ??= new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  const c = client;
  return async (system, user, schema) => {
    const left = until - Date.now();
    // not worth starting with only a few seconds to go
    if (left < 5_000) return null;
    try {
      const res = await c.messages.parse(
        {
          model,
          max_tokens: 16000,
          system,
          messages: [{ role: "user", content: user }],
          output_config: { format: zodOutputFormat(schema) },
        },
        Number.isFinite(left) ? { signal: AbortSignal.timeout(left) } : undefined,
      );
      if (res.stop_reason !== "end_turn" || !res.parsed_output) return null;
      return res.parsed_output;
    } catch (err) {
      if (err instanceof Anthropic.APIError) console.error(`fresh: ${err.status} ${err.message}`);
      else console.error("fresh:", err instanceof Error ? err.message : err);
      return null;
    }
  };
}

const pick = <T,>(xs: readonly T[], n: number, rand: () => number) => [...xs].sort(() => rand() - 0.5).slice(0, n);

const AUDIENCE = `The videos are for teens and adults, 16 and over. Never write for young children: no cartoons, toys, pets, fairy tales, colours or shapes, nursery or school-playground topics.
Never touch violence, weapons, death, illness, sex, dating, drugs, alcohol, smoking, gambling, religion, race, ethnicity, nationality as identity, sexuality, gender identity or politics, and never name a living person or a brand.`;

/** Quiz subjects, a few at a time, so every channel's questions come from all over. */
export const TOPICS = [
  "space", "physics", "chemistry", "the human body", "earth science", "oceans", "weather", "animals and plants", "inventions", "computing history", "the internet", "engineering",
  "ancient history", "world history before 1900", "exploration", "geography", "rivers and mountains", "famous buildings", "painting", "classical music", "film history", "classic novels",
  "words and languages", "units and measures", "money and economics", "board and card games", "sport rules", "Olympic history", "cars and engines", "aviation", "food and cooking",
] as const;

const QUESTION = z.object({
  questions: z.array(
    z.object({
      q: z.string().describe("The question, at most 80 characters, ending with a question mark"),
      answer: z.string().describe("The one right answer, at most 26 characters"),
      wrong: z.array(z.string()).describe("Exactly two wrong answers that sound right, at most 26 characters each"),
      level: z.number().int().describe("1: most adults know it. 2: a keen quizzer knows it. 3: hard"),
      topic: z.string().describe("The subject, from the list given"),
    }),
  ),
});

const CHECKED = z.object({
  answers: z.array(
    z.object({
      n: z.number().int().describe("The question's number"),
      pick: z.enum(["A", "B", "C"]).describe("The right option"),
      sure: z.boolean().describe("True only if you are certain, with no doubt at all"),
      changes: z.boolean().describe("True if the answer could ever change: records, rankings, anything current, recent or counted, or anything people disagree on"),
    }),
  ),
});

const SCIENCE_TOPICS = new Set(["space", "physics", "chemistry", "the human body", "earth science", "oceans", "weather", "animals and plants", "computing history", "the internet", "engineering", "inventions"]);

/**
 * New quiz questions for a channel: written, checked by code, then each
 * one answered again by a second call that isn't told the answer. Only
 * questions both agree on, that it's sure of and that can't change, are
 * kept. `known` is what's been asked before, in any words.
 */
export async function freshQuestions(ask: Ask | null, known: string[], rand: () => number, count = 12): Promise<Fact[]> {
  if (!ask) return [];
  const topics = pick(TOPICS, 3, rand);
  const written = await ask(
    `You write multiple-choice trivia questions for short quiz videos.
${AUDIENCE}
Rules:
- Only facts that never change and that you are completely certain of. Nothing about records, rankings, "current", "latest", populations, prices, champions or anything counted that could change.
- Exactly one option is right. The two wrong options are believable but clearly wrong to someone who knows.
- No sums or arithmetic, and no questions about capital cities: those are asked elsewhere.
- Don't give the answer away in the question.
- Mix the levels, with some hard ones.`,
    `Write ${count} questions about ${topics.join(", ")}. Use those as the topic. Every question must be different from these, which have been asked already:\n${known.slice(-40).map((k) => `- ${k}`).join("\n") || "- (none yet)"}`,
    QUESTION,
  );
  if (!written) return [];
  const facts: Fact[] = [];
  const seen = [...known];
  for (const w of written.questions) {
    const level = Math.min(3, Math.max(1, Math.round(w.level))) as 1 | 2 | 3;
    const wrong = w.wrong.map((x) => x.trim()).filter(Boolean);
    if (wrong.length !== 2) continue;
    const topic = SCIENCE_TOPICS.has(w.topic) ? "science" : w.topic.toLowerCase().slice(0, 30) || "general";
    const f: Fact = { id: wordsId("q", w.q), q: w.q.trim(), a: w.answer.trim(), decoys: [wrong[0], wrong[1]], level, topic };
    // every country's capital is already asked from the data
    if (words(f.q).has("capital") || questionProblem(f, seen)) continue;
    seen.push(f.q);
    facts.push(f);
  }
  return doubleCheck(ask, facts, rand);
}

/** The questions a second call, not told the answers, gets right and is sure of, and says can't change. */
export async function doubleCheck(ask: Ask, facts: Fact[], rand: () => number): Promise<Fact[]> {
  if (!facts.length) return [];
  const letters = ["A", "B", "C"] as const;
  const shown = facts.map((f) => {
    const options = [f.a, ...f.decoys].sort(() => rand() - 0.5);
    return { f, options, right: letters[options.indexOf(f.a)] };
  });
  const checked = await ask(
    "You check trivia questions before they're published. Answer each one yourself, and be strict about whether you're sure and whether the answer could change.",
    shown.map((s, i) => `${i + 1}. ${s.f.q}\n${s.options.map((o, k) => `${letters[k]}) ${o}`).join("\n")}`).join("\n\n"),
    CHECKED,
  );
  if (!checked) return [];
  return shown.filter((s, i) => checked.answers.some((a) => a.n === i + 1 && a.pick === s.right && a.sure && !a.changes)).map((s) => s.f);
}

const PAIRS = z.object({
  pairs: z.array(
    z.object({
      a: z.string().describe("The first option, at most 44 characters"),
      b: z.string().describe("The second option, at most 44 characters"),
      theme: z.string().describe("One word for what it's about"),
      pull: z.number().int().describe("How torn people are: 1 a little, 2 quite, 3 completely"),
    }),
  ),
});

const THEMES = ["money", "work", "time", "travel", "tech", "food", "home", "social life", "habits", "powers", "sport", "music", "learning", "city life", "the future"] as const;

/** New would-you-rather choices for a channel, checked by code. `known` is what's been asked before. */
export async function freshPairs(ask: Ask | null, known: string[], rand: () => number, count = 12): Promise<Pair[]> {
  if (!ask) return [];
  const themes = pick(THEMES, 4, rand);
  const written = await ask(
    `You write "would you rather" choices for short videos where viewers comment their pick.
${AUDIENCE}
Rules:
- Both options equally tempting, or equally hard, so people really split. Short and concrete.
- No gross-out, no harm to anyone, no "die" or "lose a loved one" choices.`,
    `Write ${count} choices about ${themes.join(", ")}. Every one must be different from these, which have been asked already:\n${known.slice(-40).map((k) => `- ${k}`).join("\n") || "- (none yet)"}`,
    PAIRS,
  );
  if (!written) return [];
  const out: Pair[] = [];
  const seen = [...known];
  for (const w of written.pairs) {
    const p = { a: w.a.trim(), b: w.b.trim() };
    if (pairProblem(p, seen)) continue;
    seen.push(`${p.a} or ${p.b}`);
    out.push({ id: wordsId("wyr", `${p.a} or ${p.b}`), ...p, theme: w.theme.toLowerCase().slice(0, 20), pull: Math.min(3, Math.max(1, Math.round(w.pull))) as 1 | 2 | 3 });
  }
  return out;
}

const STORIES = z.object({
  stories: z.array(
    z.object({
      title: z.string().describe("What it's about, in a few words"),
      contact: z.string().describe("Who the other person is, like Mum, Boss or Roommate: at most 14 characters"),
      tone: z.enum(["funny", "sweet", "twist"]),
      messages: z.array(z.object({ me: z.boolean().describe("True for the phone's owner, false for the other person"), text: z.string().describe("At most 80 characters") })).describe("8 to 11 messages"),
    }),
  ),
});

/** New made-up text conversations for a channel, checked by code. `known` is what's been told before. */
export async function freshStories(ask: Ask | null, known: string[], count = 2): Promise<Tale[]> {
  if (!ask) return [];
  const written = await ask(
    `You write short made-up text-message conversations for videos labelled STORY, so nobody takes them for real.
${AUDIENCE}
Rules:
- Everyday situations: family, flatmates, work, friends. A turn or a punchline at the end.
- Casual texting style, lowercase is fine. No real names of famous people or brands.`,
    `Write ${count} conversations. Each must be different from these, which have been told already:\n${known.slice(-20).map((k) => `- ${k.slice(0, 120)}`).join("\n") || "- (none yet)"}`,
    STORIES,
  );
  if (!written) return [];
  const out: Tale[] = [];
  const seen = [...known];
  for (const w of written.stories) {
    const messages = w.messages.map((m) => ({ me: m.me, text: m.text.trim() }));
    const t = { title: w.title.trim(), contact: w.contact.trim(), messages };
    if (storyProblem(t, seen)) continue;
    const text = messages.map((m) => m.text).join(" ");
    seen.push(text);
    out.push({ id: textId("story", text), ...t, tone: w.tone });
  }
  return out;
}
