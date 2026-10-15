import type { Candidate, Context, FormatId, Spec } from "../types";
import { matchupId, proposeBattle } from "./battle";
import { proposeQuiz } from "./quiz";
import { proposeRace } from "./race";
import { proposeRanking } from "./ranking";
import { proposeTexts } from "./texts";
import { proposeWyr } from "./wyr";

/** Every format, as the app names it and how it makes a Short. */
export const FORMATS: Record<FormatId, { name: string; plural: string; propose: (ctx: Context) => Candidate | null }> = {
  battle: { name: "Ball battle", plural: "ball battles", propose: (ctx) => proposeBattle(ctx) },
  quiz: { name: "Quiz", plural: "quizzes", propose: (ctx) => proposeQuiz(ctx) },
  wyr: { name: "Would you rather", plural: "would-you-rathers", propose: (ctx) => proposeWyr(ctx) },
  texts: { name: "Text story", plural: "text stories", propose: (ctx) => proposeTexts(ctx) },
  ranking: { name: "Ranking", plural: "rankings", propose: (ctx) => proposeRanking(ctx) },
  race: { name: "Bar chart race", plural: "bar chart races", propose: (ctx) => proposeRace(ctx) },
};

/** What a Short used up, so the next ones don't repeat it: questions, choices, stories, matchups, charts. */
export function contentIds(spec: Spec): string[] {
  switch (spec.format) {
    case "battle":
      return [matchupId(spec.params.a, spec.params.b)];
    case "quiz":
      return spec.params.questions.map((q) => q.id);
    case "wyr":
      return spec.params.pairs.map((p) => p.id);
    case "texts":
      return [spec.params.story.id];
    case "ranking":
      return [`ranking:${spec.params.metric}:${spec.params.region}`];
    case "race":
      return [`race:${spec.params.metric}:${spec.params.region}`];
  }
}
