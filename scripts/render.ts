/**
 * Renders one ball battle to an MP4 with its soundtrack:
 *   pnpm render fibonacci spike [seed] [--tries 60] [--melody ode|elise] [--no-tag]
 * Without a seed it runs the matchup many times and keeps the most dramatic.
 */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { isAbility } from "../lib/battle/abilities";
import { drama, pickBattle } from "../lib/battle/drama";
import { simulate } from "../lib/battle/sim";
import { timeline } from "../lib/battle/timeline";
import { soundtrack, wav, type Melody } from "../lib/battle/sound";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [a, b, seedArg] = args.filter((x, i) => !x.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!isAbility(a) || !isAbility(b)) throw new Error("Usage: pnpm render <ability> <ability> [seed]");

const picked = seedArg ? { battle: simulate(a, b, Number(seedArg)), tried: 1 } : pickBattle(a, b, Number(flag("tries") ?? 60));
const battle = picked.battle;
const d = drama(battle);
console.log(`${a} vs ${b}: seed ${battle.seed} of ${picked.tried} tried, ${d.seconds.toFixed(1)}s, ${d.leadChanges} lead changes, winner kept ${(d.winnerLeft * 100).toFixed(0)}%${d.comeback ? ", a comeback" : ""}`);

const tl = timeline(battle);
// the app's public files (the font) plus this fight's soundtrack
const pub = mkdtempSync(join(tmpdir(), "hookline-"));
cpSync("public", pub, { recursive: true });
writeFileSync(join(pub, "sound.wav"), wav(soundtrack(battle, tl, (flag("melody") as Melody) ?? "ode")));

async function main() {
const serveUrl = await bundle({ entryPoint: resolve("remotion/index.ts"), publicDir: pub });
const inputProps = { a, b, seed: battle.seed, tag: !args.includes("--no-tag"), soundFile: "sound.wav" };
const browserExecutable = process.env.CHROME_PATH || undefined;
const composition = await selectComposition({ serveUrl, id: "Battle", inputProps, browserExecutable });
mkdirSync("out", { recursive: true });
const outputLocation = `out/${a}-vs-${b}-${battle.seed}.mp4`;
await renderMedia({ composition, serveUrl, codec: "h264", outputLocation, inputProps, browserExecutable, onProgress: ({ progress }) => process.stdout.write(`\r${Math.round(progress * 100)}%`) });
console.log(`\n${outputLocation}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
