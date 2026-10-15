/**
 * The pictures shared links show (public/og/*.png), each with a real
 * frame of a real Short:
 *
 *   pnpm og
 *
 * Set CHROME_PATH to use a browser that's already installed.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { demoShorts } from "../lib/shorts/demos";
import { frames } from "../lib/shorts/timing";
import type { OgProps } from "../remotion/Og";

async function main() {
  const [battle, quiz, , , , race] = demoShorts();
  const cards: Record<string, OgProps> = {
    home: { kicker: "Shorts · LIVE games · Trends · Earnings", lines: ["Content that makes itself.", "Lives that pay."], spec: battle.spec, frame: Math.round(frames(battle.spec) * 0.45) },
    shorts: { kicker: "Shorts", lines: ["You swipe.", "It posts."], spec: quiz.spec, frame: 45 + 141 + 15 + 90 + 10 },
    live: { kicker: "For TikTok LIVE", lines: ["Your chat plays.", "Gifts do the rest."], spec: battle.spec, frame: Math.round(frames(battle.spec) * 0.7) },
    trends: { kicker: "Trends", lines: ["Catch it while", "it's rising."], spec: race.spec, frame: Math.round(frames(race.spec) * 0.6) },
  };
  const serveUrl = await bundle({ entryPoint: resolve("remotion/index.ts"), publicDir: resolve("public") });
  mkdirSync("public/og", { recursive: true });
  for (const [name, inputProps] of Object.entries(cards)) {
    const composition = await selectComposition({ serveUrl, id: "Og", inputProps, browserExecutable: process.env.CHROME_PATH });
    await renderStill({ composition, serveUrl, inputProps, output: `public/og/${name}.png`, browserExecutable: process.env.CHROME_PATH });
    console.log(`public/og/${name}.png`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
