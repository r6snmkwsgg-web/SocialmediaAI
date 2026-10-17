/**
 * LIVE rounds played back in headless Chromium, the engine OBS, TikTok LIVE
 * Studio and the renderer run on, against Node, which the server and the
 * worker run on. A clip is only true if a round recorded in a streamer's
 * browser source plays back to the same fingerprint everywhere:
 *
 *   pnpm replay-check
 *
 * It plays back the pinned fixture and rounds just recorded in Node, then
 * records rounds in Chromium for Node to play back. Set CHROME_PATH to use a
 * browser that's already installed, best of all the one the tester's OBS
 * uses.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { replay, type ClipLog } from "../lib/live/clip";
import { scriptedShow } from "../lib/live/clip-demo";

/** one round played back in both engines: whether each one got the record's own fingerprint */
export type Check = { what: string; node: string; chromium: string; same: boolean };

/** what the page has of the clip code */
type Clips = {
  replay: (log: ClipLog) => { check: string; exact: boolean };
  scriptedShow: (game: "battle" | "rivals", seed: number) => { kept: { log: ClipLog }[] };
};

/** The clip code, bundled for a page. */
async function bundled(): Promise<string> {
  const out = await build({
    stdin: { contents: 'export { replay } from "./lib/live/clip"; export { scriptedShow } from "./lib/live/clip-demo";', resolveDir: resolve("."), loader: "ts" },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "Clips",
    platform: "browser",
    logLevel: "warning",
  });
  return out.outputFiles[0].text;
}

const name = (log: ClipLog) => `${log.game} round ${log.round} (${Math.round(log.end / 60)}s)`;

export async function replayCheck(): Promise<{ browser: string; checks: Check[] }> {
  const fixture = JSON.parse(readFileSync(resolve("tests/fixtures/clip-rivals.json"), "utf8")) as ClipLog;
  const fresh = [...scriptedShow("battle", 1).kept, ...scriptedShow("rivals", 1).kept].map((k) => k.log);
  const ours: [string, ClipLog][] = [["the fixture", fixture], ...fresh.map((log): [string, ClipLog] => [`recorded in Node: ${name(log)}`, log])];
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>Replay check</title>");
    await page.addScriptTag({ content: await bundled() });
    const version = await page.evaluate(() => navigator.userAgent);
    const there = await page.evaluate((logs) => logs.map((l) => (globalThis as unknown as { Clips: Clips }).Clips.replay(l)), ours.map(([, log]) => log));
    const recorded = await page.evaluate(() => {
      const { scriptedShow } = (globalThis as unknown as { Clips: Clips }).Clips;
      return [...scriptedShow("battle", 2).kept, ...scriptedShow("rivals", 2).kept].map((k) => k.log);
    });
    const checks: Check[] = ours.map(([what, log], i) => {
      const node = replay(log);
      return { what, node: node.check, chromium: there[i].check, same: node.exact && there[i].exact && node.check === there[i].check };
    });
    for (const log of recorded) {
      const node = replay(log);
      checks.push({ what: `recorded in Chromium: ${name(log)}`, node: node.check, chromium: log.check, same: node.exact });
    }
    return { browser: version, checks };
  } finally {
    await browser.close();
  }
}

async function main() {
  const { browser, checks } = await replayCheck();
  console.log(browser);
  for (const c of checks) console.log(`${c.same ? "same" : "DIFFERENT"}  ${c.what}: Node ${c.node}, Chromium ${c.chromium}`);
  const off = checks.filter((c) => !c.same).length;
  console.log(off ? `${off} of ${checks.length} rounds played back differently.` : `All ${checks.length} rounds played back exactly the same.`);
  if (off) process.exit(1);
}

// run as a script, not when a test brings it in
if (process.argv[1]?.endsWith("replay-check.ts")) main().catch((e) => { console.error(e); process.exit(1); });
