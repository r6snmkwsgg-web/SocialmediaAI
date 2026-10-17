import { words } from "../checks";
import type { Look } from "../look";
import type { Candidate, Context, Ending, FormatId, ShortFormat, Spec } from "../types";
import { fightId, matchupId, proposeBattle } from "./battle";
import { bankQuestionIds, proposeQuiz } from "./quiz";
import { proposeRace, raceDecadeId, raceOutcomeId } from "./race";
import { proposeRanking, rankingDecadeId, rankingOrderId } from "./ranking";
import { proposeTexts, STORIES } from "./texts";
import { PAIRS, proposeWyr } from "./wyr";

/** Every format, as the app names it and how it makes a Short. */
export const FORMATS: Record<FormatId, { name: string; plural: string; propose: (ctx: Context) => Candidate | null }> = {
  battle: { name: "Ball battle", plural: "ball battles", propose: (ctx) => proposeBattle(ctx) },
  quiz: { name: "Quiz", plural: "quizzes", propose: (ctx) => proposeQuiz(ctx) },
  wyr: { name: "Would you rather", plural: "would-you-rathers", propose: (ctx) => proposeWyr(ctx) },
  texts: { name: "Text story", plural: "text stories", propose: (ctx) => proposeTexts(ctx) },
  ranking: { name: "Ranking", plural: "rankings", propose: (ctx) => proposeRanking(ctx) },
  race: { name: "Bar chart race", plural: "bar chart races", propose: (ctx) => proposeRace(ctx) },
};

/** What the app calls a stored Short's kind: its format's name, or for a round from the creator's own LIVE, where it's from. */
export function formatName(spec: { format: ShortFormat }): string {
  return spec.format === "clip" ? "From your LIVE" : FORMATS[spec.format].name;
}

/** The same, for more than one. */
export function formatPlural(spec: { format: ShortFormat }): string {
  return spec.format === "clip" ? "rounds from your LIVEs" : FORMATS[spec.format].plural;
}

/**
 * What a Short used up on its channel, so the channel doesn't repeat
 * itself: questions, choices, stories, matchups, and a chart's figure and
 * region for that decade. Shorts saved with odd parameters give nothing.
 * A round from a LIVE uses up nothing here: it stops waiting the moment
 * it becomes a Short, so it can't come round again.
 */
export function contentIds(spec: Spec): string[] {
  if (!spec.params) return [];
  switch (spec.format) {
    case "battle":
      return spec.params.a && spec.params.b ? [matchupId(spec.params.a, spec.params.b)] : [];
    case "quiz":
      return (spec.params.questions ?? []).map((q) => q.id);
    case "wyr":
      return (spec.params.pairs ?? []).map((x) => x.id);
    case "texts":
      return spec.params.story?.id ? [spec.params.story.id] : [];
    case "ranking":
      return spec.params.year ? [rankingDecadeId(spec.params)] : [];
    case "race":
      return spec.params.years?.length ? [raceDecadeId(spec.params)] : [];
    case "clip":
      return [];
  }
}

/**
 * What a Short takes from everyone: once a channel has it, no other
 * channel ever gets it (the content ledger). A battle's is the fight
 * itself, a matchup and its seed, so battles never run out. A chart's is
 * how it comes out: a countdown's countries in order, a race's top
 * countries at the start and the finish. Questions, choices and stories
 * come with the words that carry their meaning, so they're caught in
 * other words too. A round from a LIVE claims nothing: it was the
 * creator's own, and no other channel could ever make it.
 */
export function ledgerClaims(spec: Spec): { item: string; words?: string[] }[] {
  if (!spec.params) return [];
  const said = (text: string | undefined) => (text ? { words: [...words(text)] } : {});
  switch (spec.format) {
    case "battle":
      return spec.params.a && spec.params.b ? [{ item: fightId(spec.params.a, spec.params.b, spec.params.seed) }] : [];
    case "ranking":
      return spec.params.items?.length ? [{ item: rankingOrderId(spec.params) }] : [];
    case "race":
      return spec.params.years?.length && spec.params.series?.length ? [{ item: raceOutcomeId(spec.params) }] : [];
    case "quiz":
      return (spec.params.questions ?? []).map((q) => ({ item: q.id, ...said(q.q) }));
    case "wyr":
      return (spec.params.pairs ?? []).map((x) => ({ item: x.id, ...said(x.a && x.b ? `${x.a} or ${x.b}` : undefined) }));
    case "texts":
      return spec.params.story?.id ? [{ item: spec.params.story.id, ...said(spec.params.story.messages?.map((m) => m.text).join(" ")) }] : [];
    case "clip":
      return [];
  }
}

/** The same, just the items. */
export const ledgerIds = (spec: Spec): string[] => ledgerClaims(spec).map((c) => c.item);

/** Every item the built-in banks have, sums included, to find which of them another channel already has. */
export function bankIds(): string[] {
  return [...bankQuestionIds(), ...PAIRS.map((p) => p.id), ...STORIES.map((s) => s.id)];
}

/** What each ending asks of viewers, in words for whoever writes the title. */
const ENDING_FACT: Record<ShortFormat, Record<Ending, string>> = {
  battle: { comment: "During the fight it asks viewers to comment who they picked.", loop: "It loops: the end runs straight back into the start of the fight.", quiet: "It doesn't ask viewers to comment." },
  quiz: { comment: "It ends asking viewers to comment their score.", loop: "It loops: the end runs straight back into the first question.", quiet: "It doesn't ask viewers to comment." },
  wyr: { comment: "It ends asking viewers to comment their picks.", loop: "It loops: the end runs straight back into the first choice.", quiet: "It doesn't ask viewers to comment." },
  texts: { comment: "It ends asking viewers to comment what they'd reply.", loop: "It loops: the end runs straight back into the first message.", quiet: "It doesn't ask viewers to comment." },
  ranking: { comment: "It ends asking viewers to comment if any surprised them.", loop: "It loops: the end runs straight back into the start of the countdown.", quiet: "It doesn't ask viewers to comment." },
  race: { comment: "It ends asking viewers to comment who surprised them most.", loop: "It loops: the end runs straight back into the first year.", quiet: "It doesn't ask viewers to comment." },
  clip: { comment: "During the round it asks viewers to comment who they'd back.", loop: "It loops: the end runs straight back into the start of the round.", quiet: "It doesn't ask viewers to comment." },
};

/**
 * A Short made for a channel: in the channel's own look, with its ending.
 * Where comments are off it never asks for one, and neither do the facts
 * the title is written from.
 */
export function finish(c: Candidate, opts: { look?: Look; ending?: Ending; allowComments?: boolean }): Candidate {
  const ending: Ending = opts.allowComments === false && opts.ending !== "loop" ? "quiet" : (opts.ending ?? "comment");
  const params = { ...c.params, ...(opts.look ? { look: opts.look } : {}), ending, ...(opts.allowComments === false ? { allowComments: false } : {}) };
  return { ...c, params, facts: [...c.facts, ENDING_FACT[c.format][ending]] } as Candidate;
}
