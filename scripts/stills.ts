/**
 * Pictures of every format at five moments, for checking how they're
 * drawn without rendering whole videos:
 *
 *   pnpm stills <folder> [battle quiz wyr texts ranking race]
 *
 * Set CHROME_PATH to use a browser that's already installed.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { rng } from "../lib/battle/sim";
import { FORMATS } from "../lib/shorts/formats";
import { frames } from "../lib/shorts/timing";
import type { FormatId } from "../lib/shorts/types";

const OUT = process.argv[2] ?? "out/stills";
const browserExecutable = process.env.CHROME_PATH;
const only = process.argv.slice(3) as FormatId[];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const serveUrl = await bundle({ entryPoint: resolve("remotion/index.ts"), publicDir: resolve("public") });
  for (const id of (only.length ? only : (Object.keys(FORMATS) as FormatId[]))) {
    const c = FORMATS[id].propose({ rand: rng(11), used: new Set() })!;
    const spec = { format: c.format, params: c.params } as const;
    const inputProps = { spec, tag: true };
    const composition = await selectComposition({ serveUrl, id: "Short", inputProps, browserExecutable });
    const total = frames(spec as never);
    for (const f of [Math.round(total * 0.03), Math.round(total * 0.22), Math.round(total * 0.5), Math.round(total * 0.8), total - 20]) {
      await renderStill({ composition, serveUrl, inputProps, frame: f, output: `${OUT}/${id}-${f}.png`, browserExecutable, scale: 0.5 });
    }
    console.log(id, total, "frames");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
