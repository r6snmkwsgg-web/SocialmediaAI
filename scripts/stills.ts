/**
 * Pictures of every format at five moments, for checking how they're
 * drawn without rendering whole videos:
 *
 *   pnpm stills <folder> [battle quiz wyr texts ranking race clip league]
 *
 * "clip" draws two rounds from a made-up LIVE (demoClip): a Ball Battle
 * one and a Rivals one. "league" draws a made-up Ball League's round robin
 * match and final (demoLeague), and the final again with its drawn game
 * as a card, at the moments a league Short has as well: its "previously",
 * what's at stake, each game's start and the gap after it, and the
 * ending. Set CHROME_PATH to use a browser that's already installed.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { GAP, series } from "../lib/battle/series";
import { rng } from "../lib/battle/sim";
import { PLANS } from "../lib/billing/plans";
import { replay } from "../lib/live/clip";
import { demoClip } from "../lib/live/clip-demo";
import { FORMATS } from "../lib/shorts/formats";
import { clipCandidate } from "../lib/shorts/formats/clip";
import { demoLeague } from "../lib/shorts/formats/league-demo";
import { frames, LEAGUE_OPEN } from "../lib/shorts/timing";
import type { FormatId, Spec } from "../lib/shorts/types";

const OUT = process.argv[2] ?? "out/stills";
const browserExecutable = process.env.CHROME_PATH;
const only = process.argv.slice(3) as (FormatId | "clip" | "league")[];

/**
 * What to draw for each one asked for: a Short of that format, for
 * "clip" the two made-up LIVE rounds, and for "league" the made-up
 * league's two matches, as the morning run makes them.
 */
async function specsFor(id: FormatId | "clip" | "league"): Promise<{ name: string; spec: Spec }[]> {
  if (id === "clip") {
    return (["battle", "rivals"] as const).map((game) => {
      const log = demoClip(game);
      const c = clipCandidate({ log, played_at: new Date(log.at) }, replay(log), { tz: "UTC", per: PLANS.pro.shorts, rand: rng(11) })!;
      return { name: `clip-${game}`, spec: { format: c.format, params: c.params } as Spec };
    });
  }
  if (id === "league") {
    const { match, final } = await demoLeague();
    // the final's drawn game as a card, as a final too long even at double speed shows them
    const drawn = final.format === "battle" ? series(final.params).games.findIndex((g, i) => i > 0 && g.winner === null) : -1;
    const carded = { ...final, params: { ...final.params, cards: [drawn] } } as Spec;
    return [{ name: "league-match", spec: match }, { name: "league-final", spec: final }, { name: "league-final-card", spec: carded }];
  }
  const c = FORMATS[id].propose({ rand: rng(11), used: new Set() })!;
  return [{ name: id, spec: { format: c.format, params: c.params } as Spec }];
}

/** The frames to draw: five through every Short, and for a Ball League match its opening, its stakes, each game's start and gap, and its ending. */
function momentsOf(spec: Spec): number[] {
  const total = frames(spec);
  const five = [Math.round(total * 0.03), Math.round(total * 0.22), Math.round(total * 0.5), Math.round(total * 0.8), total - 20];
  if (spec.format !== "battle" || !spec.params.league) return five;
  const s = series(spec.params);
  const games = s.games.flatMap((g, i) => [
    ...(i > 0 ? [g.from + 10] : []),
    ...(g.tl && i < s.games.length - 1 ? [g.from + g.tl.outroFrom + GAP / 2] : []),
    ...(!g.tl ? [g.from + 30] : []),
  ]);
  return [...new Set([30, LEAGUE_OPEN + 30, ...games, s.endFrom + 40, ...five])].sort((a, b) => a - b);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const serveUrl = await bundle({ entryPoint: resolve("remotion/index.ts"), publicDir: resolve("public") });
  for (const id of (only.length ? only : (Object.keys(FORMATS) as FormatId[]))) {
    for (const { name, spec } of await specsFor(id)) {
      const inputProps = { spec, tag: true };
      const composition = await selectComposition({ serveUrl, id: "Short", inputProps, browserExecutable });
      for (const f of momentsOf(spec)) {
        await renderStill({ composition, serveUrl, inputProps, frame: f, output: `${OUT}/${name}-${f}.png`, browserExecutable, scale: 0.5 });
      }
      console.log(name, frames(spec), "frames");
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
