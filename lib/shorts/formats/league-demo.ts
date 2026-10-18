import { cardFor, drawNames, FINAL, LEAGUE_HEALTH, makeCast, playOut, ROUND_MATCHES, type Result, type Season } from "../../battle/league";
import { rng } from "../../battle/sim";
import type { Spec } from "../types";
import { leagueCandidate } from "./league";

/**
 * A made-up Ball League, for seeing how league Shorts are drawn (pnpm
 * stills and the render tests), never anyone's league: a cast drawn from
 * a fixed seed and one season played out with real fights at the
 * league's health, then two of its matches made into Shorts as the
 * morning run makes them. One is a round robin match with something at
 * stake; the other is the final, which has a drawn game and runs long
 * enough to be played a little faster.
 */

/** The seed the made-up league is drawn from, picked for a final with a drawn game in it. */
const DEMO = 71;

export async function demoLeague(): Promise<{ match: Spec; final: Spec }> {
  const rand = rng(DEMO);
  const cast = makeCast(drawNames(rand), rand);
  const { results, lots, fixtures } = await playOut(cast, () => 1 + Math.floor(rand() * (2 ** 31 - 2)), rand);
  // a match as its Short says it: the season as it stood before it, and its result
  const shortOf = (r: Result): Spec => {
    const before: Season = { number: 1, lots, fixtures, results: results.filter((x) => x.number < r.number), last: null };
    const card = cardFor(before, cast, r.number, [cast[r.a], cast[r.b]], r);
    const c = leagueCandidate({ card, sides: [cast[r.a], cast[r.b]], games: r.games, health: LEAGUE_HEALTH, tune: "ode", fresh: false });
    return { format: c.format, params: c.params } as Spec;
  };
  const staked = (r: Result) => {
    const s = shortOf(r);
    return s.format === "battle" && s.params.league?.stakes ? s : null;
  };
  // the first round robin match from the middle of the season on with something at stake
  const match = results.filter((r) => r.number >= 15 && r.number <= ROUND_MATCHES).map(staked).find((s) => s !== null);
  const final = results.find((r) => r.number === FINAL)!;
  if (!match || !final.games.some((g, i) => i > 0 && g.winner === null)) throw new Error("the made-up league doesn't have the matches it's drawn for");
  return { match, final: shortOf(final) };
}
