import { rng } from "../battle/sim";
import { FORMATS } from "./formats";
import type { FormatId, Spec } from "./types";

/**
 * One Short of each format for the website, made the same way the app
 * makes them (so they're real, not mock-ups), from fixed seeds so the
 * page doesn't change on every visit.
 */

const LINES: Record<FormatId, string> = {
  battle: "Two powers, one arena, real physics. The best of dozens of fights.",
  quiz: "Five questions, three seconds each. Facts that don't change.",
  wyr: "Five hard choices. The comments are the poll; nothing's made up.",
  texts: "A made-up conversation with a turn at the end, labelled as a story.",
  ranking: "A countdown to #1 from World Bank figures, the source on screen.",
  race: "Countries overtaking each other year by year, from real figures.",
};

const SEEDS: Record<FormatId, number> = { battle: 3, quiz: 21, wyr: 8, texts: 2, ranking: 5, race: 4 };

export function demoShorts(order: FormatId[] = ["battle", "quiz", "wyr", "texts", "ranking", "race"]): { name: string; line: string; spec: Spec }[] {
  return order.map((f) => {
    const c = FORMATS[f].propose({ rand: rng(SEEDS[f]), used: new Set() })!;
    return { name: FORMATS[f].name, line: LINES[f], spec: { format: c.format, params: c.params } as Spec };
  });
}
