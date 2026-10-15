/**
 * Hookline's worker: the long-running part that Vercel can't host.
 *
 *   pnpm worker
 *
 * It renders approved Shorts with Remotion (one at a time per worker; run
 * more workers for more at once), keeps them in storage, posts what's due,
 * makes each channel's Shorts every morning, collects views for the
 * learning loop, checks Trends and syncs Earnings. It reads the same
 * environment variables as the app.
 */
import "./server-only";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { soundFor, wav } from "../lib/shorts/sound";
import { claimJob, failJob, finishJob, jobProgress, type Job } from "../lib/server/shorts/render";
import { dueForShorts, makeShorts } from "../lib/server/shorts/generate";
import { postDue } from "../lib/server/shorts/post";
import { collectStats } from "../lib/server/shorts/stats";
import { syncEarnings } from "../lib/server/earnings";
import { refreshTrends } from "../lib/server/trends";
import { putVideo } from "../lib/server/storage";

if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no local env file: the environment has it
  }
}

const browserExecutable = process.env.CHROME_PATH || undefined;
const say = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let serveUrl = "";

async function render(job: Job) {
  const dir = mkdtempSync(join(tmpdir(), "hookline-render-"));
  // the soundtrack goes in the bundle's public folder for this one render
  const sound = `sound-${job.videoId}.wav`;
  const soundPath = join(serveUrl, "public", sound);
  writeFileSync(soundPath, wav(soundFor(job.spec)));
  try {
    const inputProps = { spec: job.spec, tag: job.tag, soundFile: sound };
    const composition = await selectComposition({ serveUrl, id: "Short", inputProps, browserExecutable });
    const out = join(dir, `${job.videoId}.mp4`);
    let last = 0;
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: out,
      inputProps,
      browserExecutable,
      onProgress: ({ progress }) => {
        if (Date.now() - last > 1500) {
          last = Date.now();
          void jobProgress(job.id, progress);
        }
      },
    });
    const key = `${job.userId}/${job.videoId}.mp4`;
    await putVideo(key, out);
    await finishJob(job, key);
    say(`rendered ${job.videoId} (${job.spec.format})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(soundPath, { force: true });
  }
}

/** Renders, one after another, for as long as there are jobs. */
async function renderLoop() {
  for (;;) {
    const job = await claimJob().catch((e) => {
      say("couldn't claim a job:", e instanceof Error ? e.message : e);
      return null;
    });
    if (!job) {
      await sleep(2000);
      continue;
    }
    try {
      await render(job);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      say(`render ${job.videoId} failed:`, msg);
      await failJob(job, msg).catch(() => {});
    }
  }
}

/** Something that runs every so often, never twice at once. */
function every(ms: number, name: string, fn: () => Promise<string[] | void>) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const log = await fn();
      if (log?.length) say(`${name}:`, log.join(" · "));
    } catch (e) {
      say(`${name} failed:`, e instanceof Error ? e.message : e);
    } finally {
      busy = false;
    }
  };
  void run();
  setInterval(run, ms);
}

async function main() {
  say("bundling the videos…");
  serveUrl = await bundle({ entryPoint: resolve("remotion/index.ts"), publicDir: resolve("public") });
  say("ready");
  every(60_000, "post", () => postDue());
  every(15 * 60_000, "stats", () => collectStats());
  every(30 * 60_000, "trends", () => refreshTrends());
  every(6 * 3600_000, "earnings", () => syncEarnings());
  every(5 * 60_000, "daily shorts", async () => {
    const out: string[] = [];
    for (const id of await dueForShorts()) {
      const n = await makeShorts(id, { origin: "daily" });
      if (n) out.push(`${n} for ${id}`);
    }
    return out;
  });
  await renderLoop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
