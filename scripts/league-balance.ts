/**
 * How fair the Ball League's health table is: plays seasons with
 * LEAGUE_HEALTH from seeded random seeds, as the real thing plays them,
 * and prints each power's share of the titles, how often fights are
 * drawn, the matchups one side nearly always wins, and how long finals
 * run (and how many need playing faster to fit a Short), for re-tuning
 * the table in lib/battle/league.ts:
 *
 *   pnpm league-balance [seasons, 300] [seed, 4242]
 */
import { ABILITY_IDS, type AbilityId } from "../lib/battle/abilities";
import { drawNames, FINAL, LEAGUE_HEALTH, makeCast, playOut, ROUND_MATCHES } from "../lib/battle/league";
import { fitSpeed, series } from "../lib/battle/series";
import { FPS, rng } from "../lib/battle/sim";
import { OUTRO } from "../lib/battle/timeline";

const seasons = Number(process.argv[2] ?? 300);
const rand = rng(Number(process.argv[3] ?? 4242));
const seed = () => 1 + Math.floor(rand() * (2 ** 31 - 2));

const titles = Object.fromEntries(ABILITY_IDS.map((p) => [p, 0])) as Record<AbilityId, number>;
// each matchup's round robin results, by power in the order the powers are listed
const pairs = new Map<string, { first: number; second: number; drawn: number }>();
const finals: { seconds: number; speed?: number; cards: number }[] = [];
let games = 0;
let drawn = 0;

async function main() {
  const started = performance.now();
  for (let n = 0; n < seasons; n++) {
    const cast = makeCast(drawNames(rand), rand);
    const { results, champion } = await playOut(cast, seed, rand);
    titles[cast[champion].power]++;
    for (const r of results) {
      games += r.games.length;
      drawn += r.games.filter((g) => g.seed !== null && g.winner === null).length;
      if (r.number > ROUND_MATCHES) continue;
      const [x, y] = [cast[r.a].power, cast[r.b].power].sort((p, q) => ABILITY_IDS.indexOf(p) - ABILITY_IDS.indexOf(q));
      const k = `${x} v ${y}`;
      const p = pairs.get(k) ?? { first: 0, second: 0, drawn: 0 };
      if (r.winner === null) p.drawn++;
      else if (cast[r.winner].power === x) p.first++;
      else p.second++;
      pairs.set(k, p);
    }
    // the final as one Short, at real speed and as it would be made
    const f = results.find((r) => r.number === FINAL)!;
    const [A, B] = [cast[f.a], cast[f.b]];
    const fight = { a: A.power, b: B.power, seed: f.games[0].seed!, hp: [LEAGUE_HEALTH[A.power], LEAGUE_HEALTH[B.power]] as [number, number], games: f.games.map((g) => g.seed) };
    const fit = fitSpeed(fight);
    finals.push({ seconds: (series(fight).endFrom + OUTRO) / FPS, speed: fit.speed, cards: fit.cards?.length ?? 0 });
  }

  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(1)}%`;
  console.log(`${seasons} seasons, ${games} games, in ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
  console.log("titles:");
  for (const [p, v] of Object.entries(titles).sort((a, b) => b[1] - a[1])) console.log(`  ${p.padEnd(10)} ${pct(v, seasons).padStart(6)}  (${LEAGUE_HEALTH[p as AbilityId]} HP)`);
  console.log(`\ndrawn games: ${pct(drawn, games)}`);
  const lopsided = [...pairs.entries()]
    .map(([k, p]) => ({ k, top: Math.max(p.first, p.second) / (p.first + p.second + p.drawn), p }))
    .sort((a, b) => b.top - a.top);
  console.log(`matchups one side wins 95% or more: ${lopsided.filter((x) => x.top >= 0.95).length} of ${pairs.size}; 85% or more: ${lopsided.filter((x) => x.top >= 0.85).length}`);
  for (const x of lopsided.filter((m) => m.top >= 0.85)) console.log(`  ${x.k.padEnd(22)} ${x.p.first}-${x.p.second} (${x.p.drawn} drawn)`);
  const s = finals.map((f) => f.seconds).sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(0);
  console.log(`\nfinals at real speed: median ${at(0.5)} s, 90th percentile ${at(0.9)} s, longest ${s.at(-1)!.toFixed(0)} s`);
  console.log(`played faster to fit: ${finals.filter((f) => f.speed).length}; with drawn games as cards: ${finals.filter((f) => f.cards).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
