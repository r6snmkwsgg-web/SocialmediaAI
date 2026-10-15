import type { AbilityId } from "../battle/abilities";

/**
 * A Short, as data. Every format is drawn by code from a handful of
 * parameters, so the same parameters always make the same video: what
 * someone approves in the queue is exactly what gets rendered and posted.
 */

export const FORMAT_IDS = ["battle", "quiz", "wyr", "texts", "ranking", "race"] as const;
export type FormatId = (typeof FORMAT_IDS)[number];

export type BattleParams = { a: AbilityId; b: AbilityId; seed: number };

export type Question = { id: string; q: string; options: string[]; answer: number; topic: string; level: 1 | 2 | 3 };
export type QuizParams = { questions: Question[] };

export type Choice = { id: string; a: string; b: string };
export type WyrParams = { pairs: Choice[] };

export type Message = { me: boolean; text: string };
export type Story = { id: string; contact: string; messages: Message[] };
export type TextsParams = { story: Story };

export type Metric = "population" | "gdp";
export type Region = "World" | "Africa" | "Asia" | "Europe" | "North America" | "South America" | "Oceania";

export type RankingParams = {
  metric: Metric;
  region: Region;
  year: number;
  /** biggest first */
  items: { iso: string; name: string; value: number }[];
  source: string;
};

export type RaceParams = {
  metric: Metric;
  region: Region;
  years: number[];
  /** every country that's ever in the top `top`, with its values over `years` (null where there's no figure) */
  series: { iso: string; name: string; values: (number | null)[] }[];
  top: number;
  source: string;
};

export type Spec =
  | { format: "battle"; params: BattleParams }
  | { format: "quiz"; params: QuizParams }
  | { format: "wyr"; params: WyrParams }
  | { format: "texts"; params: TextsParams }
  | { format: "ranking"; params: RankingParams }
  | { format: "race"; params: RaceParams };

export type ParamsOf<F extends FormatId> = Extract<Spec, { format: F }>["params"];

/** One run of a format: a Short it could make, and what's good about it. */
export type Candidate = Spec & {
  /** what the learning loop tracks, like "battle:spike:sword" or "quiz:capitals" */
  key: string;
  /** how good it is to watch, on the format's own scale: only compared within a format */
  score: number;
  /** why it was picked, in plain words, for the queue */
  why: string[];
  /** what's in the video, for whoever writes the title; nothing it doesn't show */
  facts: string[];
  /** a title that works with no writer */
  title: string;
};

/** What a format needs to know about a channel to make something new for it. */
export type Context = {
  rand: () => number;
  /** content already on the channel (question, story, matchup ids…), so nothing repeats */
  used: Set<string>;
};
