import { ABILITIES, ABILITY_IDS, type AbilityId } from "../../battle/abilities";
import { pickBattle } from "../../battle/drama";
import { MELODIES, type Melody } from "../../battle/sound";
import type { Candidate, Context } from "../types";

/**
 * Ball battles: two abilities, one arena, a real fight. The most dramatic
 * of many runs is the one that's posted. A channel has every matchup once
 * before any comes round again, and then it's a different fight: each
 * fight (a matchup and its seed) goes to one channel only.
 */

export const matchupId = (a: AbilityId, b: AbilityId) => `battle:${[a, b].sort().join(":")}`;

/** One fight, in the order the sides are drawn: no other channel ever gets it. */
export const fightId = (a: AbilityId, b: AbilityId, seed: number) => `battle:${a}:${b}:${seed}`;

export const MELODY_IDS = Object.keys(MELODIES) as Melody[];

export function proposeBattle(ctx: Context, matchups = 6, runs = 40): Candidate | null {
  const pairs: [AbilityId, AbilityId][] = [];
  for (let i = 0; i < ABILITY_IDS.length; i++) for (let j = i + 1; j < ABILITY_IDS.length; j++) pairs.push([ABILITY_IDS[i], ABILITY_IDS[j]]);
  const times = (a: AbilityId, b: AbilityId) => (ctx.used.has(matchupId(a, b)) ? Math.max(1, ctx.times?.get(matchupId(a, b)) ?? 1) : 0);
  // the matchups the channel has had least: new ones first, then round again
  const least = Math.min(...pairs.map(([a, b]) => times(a, b)));
  const fresh = pairs.filter(([a, b]) => times(a, b) === least);
  for (let i = fresh.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rand() * (i + 1));
    [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
  }
  let best: ReturnType<typeof pickBattle> | null = null;
  for (const [x, y] of fresh.slice(0, matchups)) {
    const [a, b] = ctx.rand() < 0.5 ? [x, y] : [y, x];
    const got = pickBattle(a, b, runs, 1 + Math.floor(ctx.rand() * 1_000_000));
    if (!best || got.drama.score > best.drama.score) best = got;
  }
  const { battle, drama: d } = best!;
  const A = ABILITIES[battle.a], B = ABILITIES[battle.b];
  const tried = Math.min(matchups, fresh.length) * runs;
  return {
    format: "battle",
    // a tune of its own, so a channel's battles don't all sound the same
    params: { a: battle.a, b: battle.b, seed: battle.seed, melody: MELODY_IDS[Math.floor(ctx.rand() * MELODY_IDS.length)] },
    key: matchupId(battle.a, battle.b),
    score: d.score,
    why: [
      `The best of ${tried} fights: ${d.leadChanges} lead change${d.leadChanges === 1 ? "" : "s"}${d.comeback ? " and a comeback" : ""}, over in ${Math.round(d.seconds)} seconds`,
      least ? `A fight nobody's seen before: your channel has had every matchup, so ${A.name} vs ${B.name} comes round again` : `${A.name} vs ${B.name} hasn't been on your channel before`,
    ],
    facts: [
      "A ball battle Short: two balls with different powers bounce around an arena and fight until one is knocked out. It's a real physics simulation; nobody picks the winner.",
      `${A.name}: ${A.line} ${B.name}: ${B.line}`,
      `${d.leadChanges} lead changes${d.comeback ? ", and the winner comes back from well behind" : ""}. Don't say who wins.`,
    ],
    title: `${A.name} vs ${B.name}: who wins?`,
  };
}
