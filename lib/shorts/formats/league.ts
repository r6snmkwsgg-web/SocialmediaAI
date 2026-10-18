import { ABILITIES } from "../../battle/abilities";
import { ordinal, type CastBall, type Game, type Health } from "../../battle/league";
import { fitSpeed } from "../../battle/series";
import type { Melody } from "../../battle/sound";
import type { Candidate, LeagueCard, LeagueLine, LeagueSide } from "../types";
import { matchupId } from "./battle";

/**
 * A Ball League match as a Short: its one real fight, or a knockout's
 * games in turn, with what the league says about it, at a speed that
 * fits a Short. Why it was made says it's a real fight nobody picked and
 * that it counts posted or not. What the title writer is told never says
 * who wins, and never what the result means, which only shows at the end.
 */

/** "match 12 of 31", "semi-final 1", "the final", as a sentence says it. */
function matchOf(card: LeagueCard): string {
  return card.stage === "round" ? `match ${card.number} of 31` : card.stage === "semi" ? `semi-final ${card.number - 28}` : "the final";
}

/** A ball and where it stands: "Havoc Fang, 1st,", or just its name before it's played. */
const standing = (s: LeagueSide, last = false) => (s.place ? `${s.name}, ${ordinal(s.place)}${last ? "" : ","}` : s.name);

/** A line as the title writer reads it, with the ball it's about named. */
const said = (line: LeagueLine, sides: readonly LeagueSide[]) => (line.side === null ? line.text : `${sides[line.side].name}: ${line.text}`);

export function leagueCandidate(o: { card: LeagueCard; sides: readonly [CastBall, CastBall]; games: readonly Game[]; health: Health; tune: Melody; fresh: boolean }): Candidate {
  const { card } = o;
  const [A, B] = o.sides;
  const hp: [number, number] = [o.health[A.power], o.health[B.power]];
  const seeds = o.games.map((g) => g.seed);
  const fight = { a: A.power, b: B.power, seed: seeds[0]!, hp, ...(seeds.length > 1 ? { games: seeds } : {}) };
  const fit = fitSpeed(fight);
  const awarded = o.games.some((g) => g.seed === null);
  const [sa, sb] = card.sides;
  const why = [
    `Season ${card.season}, ${matchOf(card)}: ${standing(sa)} against ${standing(sb, true)}`,
    o.fresh
      ? "One real fight, from a new seed drawn before it ran, since another channel already had the ones drawn for it. Nothing is played again or picked."
      : seeds.length > 1
        ? "Every game is one real fight, from seeds drawn when the season began, used in order. Nothing is picked."
        : "One real fight, from a seed drawn when the season began. Nothing is played again or picked.",
    ...(awarded ? ["The seeds ran out before anyone had two wins, so the higher-placed ball took the games left, as the rules say."] : []),
    ...(fit.speed ? [`It plays at ${fit.speed}x speed, so the whole final fits in one Short.`] : []),
    ...(fit.cards?.length ? ["Drawn games after the first show as a short card, so it fits in one Short."] : []),
    card.stage === "round" ? "It counts in the table whether or not you post it." : "It counts whether or not you post it.",
  ];
  const ball = (b: CastBall, s: LeagueSide) => {
    const p = ABILITIES[b.power];
    const record = `${s.record.won} won, ${s.record.drawn} drawn and ${s.record.lost} lost`;
    return `${b.name} is the ${p.name} ball: ${p.line} ${s.place ? `It's ${ordinal(s.place)} in the table, with ${record}.` : "It hasn't played yet this season."}`;
  };
  // a knockout's drawn game is played again with the next seed, so a semi-final or the final can be more than one fight
  const fights = card.stage === "round"
    ? `This match is one real physics fight${o.fresh ? "" : " from a seed drawn when the season began"}.`
    : `Every game it plays is one real physics fight${o.fresh ? "" : " from seeds drawn when the season began"}, and a drawn game is played again with the next seed.`;
  const facts = [
    `A Ball League Short: season ${card.season}, ${card.stage === "final" ? "the final, first to two wins" : matchOf(card)}. Eight named balls play seasons. ${fights} The table is only real results.`,
    ball(A, sa),
    ball(B, sb),
    ...(card.previously.length ? [`Before this match: ${card.previously.map((l) => said(l, card.sides)).join(". ")}.`] : []),
    ...(card.stakes ? [`At stake: ${said(card.stakes, card.sides)}.`] : []),
    card.stage === "final" ? "Don't say who wins or the score." : "Don't say who wins.",
  ];
  const title =
    card.stage === "round" ? `${A.name} vs ${B.name}: Ball League, season ${card.season}, match ${card.number}`
    : card.stage === "semi" ? `Ball League semi-final: ${A.name} vs ${B.name}`
    : `The Ball League final: ${A.name} vs ${B.name}`;
  return {
    format: "battle",
    params: { ...fight, melody: o.tune, ...fit, league: card },
    key: matchupId(A.power, B.power),
    score: 0,
    why,
    facts,
    title,
  };
}
