/**
 * Pictures of every format at five moments, for checking how they're
 * drawn without rendering whole videos:
 *
 *   pnpm stills <folder> [battle quiz wyr texts ranking race clip]
 *
 * "clip" draws two rounds from a made-up LIVE (demoClip): a Ball Battle
 * one and a Rivals one. Set CHROME_PATH to use a browser that's already
 * installed.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { rng } from "../lib/battle/sim";
import { PLANS } from "../lib/billing/plans";
import { replay } from "../lib/live/clip";
import { demoClip } from "../lib/live/clip-demo";
import { FORMATS } from "../lib/shorts/formats";
import { clipCandidate } from "../lib/shorts/formats/clip";
import { frames } from "../lib/shorts/timing";
import type { FormatId, Spec } from "../lib/shorts/types";

const OUT = process.argv[2] ?? "out/stills";
const browserExecutable = process.env.CHROME_PATH;
const only = process.argv.slice(3) as (FormatId | "clip")[];

/** What to draw for each one asked for: a Short of that format, or for "clip", the two made-up LIVE rounds as the morning run makes them. */
function specsFor(id: FormatId | "clip"): { name: string; spec: Spec }[] {
  if (id === "clip") {
    return (["battle", "rivals"] as const).map((game) => {
      const log = demoClip(game);
      const c = clipCandidate({ log, played_at: new Date(log.at) }, replay(log), { tz: "UTC", per: PLANS.pro.shorts, rand: rng(11) })!;
      return { name: `clip-${game}`, spec: { format: c.format, params: c.params } as Spec };
    });
  }
  const c = FORMATS[id].propose({ rand: rng(11), used: new Set() })!;
  return [{ name: id, spec: { format: c.format, params: c.params } as Spec }];
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const serveUrl = await bundle({ entryPoint: resolve("remotion/index.ts"), publicDir: resolve("public") });
  for (const id of (only.length ? only : (Object.keys(FORMATS) as FormatId[]))) {
    for (const { name, spec } of specsFor(id)) {
      const inputProps = { spec, tag: true };
      const composition = await selectComposition({ serveUrl, id: "Short", inputProps, browserExecutable });
      const total = frames(spec);
      for (const f of [Math.round(total * 0.03), Math.round(total * 0.22), Math.round(total * 0.5), Math.round(total * 0.8), total - 20]) {
        await renderStill({ composition, serveUrl, inputProps, frame: f, output: `${OUT}/${name}-${f}.png`, browserExecutable, scale: 0.5 });
      }
      console.log(name, total, "frames");
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
