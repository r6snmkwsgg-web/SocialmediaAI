import { ABILITY_IDS } from "../lib/battle/abilities";
import { simulate } from "../lib/battle/sim";
import { drama } from "../lib/battle/drama";

const seeds = Number(process.argv[2] ?? 30);
const wins: Record<string, number> = {};
const rows: string[] = [];
let slowest = 0;
for (let i = 0; i < ABILITY_IDS.length; i++) {
  for (let j = i + 1; j < ABILITY_IDS.length; j++) {
    const a = ABILITY_IDS[i], b = ABILITY_IDS[j];
    let aw = 0, bw = 0, to = 0, best = -99, maxBalls = 0;
    const secs: number[] = [];
    for (let s = 1; s <= seeds; s++) {
      const t0 = performance.now();
      const x = simulate(a, b, s);
      slowest = Math.max(slowest, performance.now() - t0);
      if (x.winner === 0) aw++; else if (x.winner === 1) bw++;
      if (x.byTimeout) to++;
      const d = drama(x);
      secs.push(d.seconds);
      best = Math.max(best, d.score);
      for (const fr of x.frames) maxBalls = Math.max(maxBalls, fr.balls.length);
    }
    wins[a] = (wins[a] ?? 0) + aw; wins[b] = (wins[b] ?? 0) + bw;
    secs.sort((p, q) => p - q);
    rows.push(`${a.padEnd(9)} vs ${b.padEnd(9)} ${String(aw).padStart(3)}-${String(bw).padEnd(3)} timeouts ${String(to).padStart(2)}  median ${secs[secs.length >> 1].toFixed(1)}s  [${secs[0].toFixed(0)}-${secs[secs.length - 1].toFixed(0)}]  best drama ${best.toFixed(1)}  balls<=${maxBalls}`);
  }
}
console.log(rows.join("\n"));
console.log("\nwins:", Object.entries(wins).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k} ${v}`).join(", "));
console.log("slowest sim ms:", slowest.toFixed(0));
