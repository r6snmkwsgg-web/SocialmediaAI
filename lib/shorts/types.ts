import type { AbilityId } from "../battle/abilities";
import type { Melody } from "../battle/sound";
import type { Look } from "./look";

/**
 * A Short, as data. Every format is drawn by code from a handful of
 * parameters, so the same parameters always make the same video: what
 * someone approves in the queue is exactly what gets rendered and posted.
 */

export const FORMAT_IDS = ["battle", "quiz", "wyr", "texts", "ranking", "race"] as const;
export type FormatId = (typeof FORMAT_IDS)[number];

/** How a Short ends: asking for a comment, running straight back into its start, or neither. */
export const ENDINGS = ["comment", "loop", "quiet"] as const;
export type Ending = (typeof ENDINGS)[number];

/**
 * What every format shares: the channel's own look and how the video
 * ends. Shorts made before these existed have none of them, and get
 * Hookline's own look and the comment ending.
 */
export type Finish = {
  look?: Look;
  ending?: Ending;
  /** false where comments are off (Shorts made for kids): the video never asks for one */
  allowComments?: boolean;
};

export type BattleParams = { a: AbilityId; b: AbilityId; seed: number; melody?: Melody } & Finish;

export type Question = { id: string; q: string; options: string[]; answer: number; topic: string; level: 1 | 2 | 3 };
export type QuizParams = { questions: Question[] } & Finish;

export type Choice = { id: string; a: string; b: string };
export type WyrParams = { pairs: Choice[] } & Finish;

export type Message = { me: boolean; text: string };
export type Story = { id: string; contact: string; messages: Message[] };
export type TextsParams = { story: Story } & Finish;

export type Metric = "population" | "gdp";
export type Region = "World" | "Africa" | "Asia" | "Europe" | "North America" | "South America" | "Oceania";

export type RankingParams = {
  metric: Metric;
  region: Region;
  year: number;
  /** biggest first */
  items: { iso: string; name: string; value: number }[];
  source: string;
} & Finish;

export type RaceParams = {
  metric: Metric;
  region: Region;
  years: number[];
  /** every country that's ever in the top `top`, with its values over `years` (null where there's no figure) */
  series: { iso: string; name: string; values: (number | null)[] }[];
  top: number;
  source: string;
  /** frames each year takes, so a short stretch of years still makes a Short; RACE.year when missing */
  step?: number;
} & Finish;

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

/** A quiz question before it's asked: the right answer, two wrong ones, and how hard it is. */
export type Fact = { id: string; q: string; a: string; decoys: [string, string]; level: 1 | 2 | 3; topic: string };

/** A would-you-rather choice, with what it's about and how torn people are by it (1 to 3). */
export type Pair = Choice & { theme: string; pull: 1 | 2 | 3 };

/** A text story, with what it's called and its tone. */
export type Tale = Story & { title: string; tone: "funny" | "sweet" | "twist" };

/** What a format needs to know about a channel to make something new for it. */
export type Context = {
  rand: () => number;
  /** what the channel has had (question, story, matchup ids…) and what other channels have: never used again */
  used: Set<string>;
  /** how many times the channel has had each thing, for battles, whose matchups come round again as new fights */
  times?: Map<string, number>;
  /** new material written for this channel, used before the built-in banks */
  fresh?: { questions?: Fact[]; pairs?: Pair[]; stories?: Tale[] };
};
