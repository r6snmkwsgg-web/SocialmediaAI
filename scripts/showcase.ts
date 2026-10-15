import { pickBattle } from "../lib/battle/drama";
import type { AbilityId } from "../lib/battle/abilities";

const pairs: [AbilityId, AbilityId][] = [["fibonacci", "spike"], ["sword", "heal"], ["grow", "bomb"], ["clone", "speed"], ["spike", "sword"], ["heal", "bomb"]];
for (const [a, b] of pairs) {
  const { battle, drama } = pickBattle(a, b, 120);
  console.log(`  { a: "${a}", b: "${b}", seed: ${battle.seed} }, // ${drama.seconds.toFixed(1)}s, ${drama.leadChanges} lead changes, winner kept ${(drama.winnerLeft * 100).toFixed(0)}%${drama.comeback ? ", comeback" : ""}, ${battle.winner === 0 ? a : b} wins`);
}
