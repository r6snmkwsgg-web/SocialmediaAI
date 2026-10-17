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
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { soundFor, wav } from "../lib/shorts/sound";
import { claimJob, failJob, finishJob, jobProgress, type Job } from "../lib/server/shorts/render";
import { runDailyShorts } from "../lib/server/shorts/generate";
import { postDue } from "../lib/server/shorts/post";
import { collectStats } from "../lib/server/shorts/stats";
import { syncEarnings } from "../lib/server/earnings";
import { refreshTrends } from "../lib/server/trends";
import { recapLives } from "../lib/server/live";
import { tidyClips } from "../lib/server/clips";
import { unmakeable } from "../lib/live/clip-rules";
import { putVideo } from "../lib/server/storage";
import { checkIn, checkOut, forgetStopped } from "../lib/server/worker";

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
// who this worker is when it checks in, and what it's rendering right now
const workerId = `${hostname()}-${process.pid}`;
let rendering: string | null = null;

/** One video for a job, with or without the free plan's tag, reporting progress from `from` to `to`. */
async function renderOne(job: Job, tag: boolean, out: string, from: number, to: number) {
  // the soundtrack goes in the bundle's public folder for this one render
  const sound = `sound-${job.videoId}.wav`;
  const soundPath = join(serveUrl, "public", sound);
  writeFileSync(soundPath, wav(soundFor(job.spec)));
  try {
    const inputProps = { spec: job.spec, tag, soundFile: sound };
    const composition = await selectComposition({ serveUrl, id: "Short", inputProps, browserExecutable });
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
          void jobProgress(job.id, from + (to - from) * progress);
        }
      },
    });
  } finally {
    rmSync(soundPath, { force: true });
  }
}

/**
 * A job's video, kept in storage. A tagged one whose owner has TikTok
 * gets a second copy without the tag, since TikTok doesn't allow app
 * watermarks; a clean-only job makes just that copy. A round from a LIVE
 * is checked once more first, and one that can't be made never will be,
 * so it isn't tried again.
 */
async function render(job: Job) {
  const why = job.spec.format === "clip" ? unmakeable(job.spec.params) : null;
  if (why) {
    await failJob(job, why, true);
    say(`can't make ${job.videoId}: ${why}`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "hookline-render-"));
  const cleanKey = `${job.userId}/${job.videoId}-clean.mp4`;
  try {
    if (job.clean) {
      const out = join(dir, `${job.videoId}-clean.mp4`);
      await renderOne(job, false, out, 0, 1);
      await putVideo(cleanKey, out);
      await finishJob(job, cleanKey);
      say(`made TikTok's copy of ${job.videoId}`);
      return;
    }
    const out = join(dir, `${job.videoId}.mp4`);
    await renderOne(job, job.tag, out, 0, job.alsoClean ? 0.5 : 1);
    const key = `${job.userId}/${job.videoId}.mp4`;
    await putVideo(key, out);
    let clean: string | null = null;
    if (job.alsoClean) {
      const cleanOut = join(dir, `${job.videoId}-clean.mp4`);
      await renderOne(job, false, cleanOut, 0.5, 1);
      await putVideo(cleanKey, cleanOut);
      clean = cleanKey;
    }
    await finishJob(job, key, clean);
    say(`rendered ${job.videoId} (${job.spec.format})${clean ? ", and TikTok's copy" : ""}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
    rendering = job.videoId;
    void checkIn(workerId, rendering).catch(() => {});
    try {
      await render(job);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      say(`render ${job.videoId} failed:`, msg);
      await failJob(job, msg).catch(() => {});
    } finally {
      rendering = null;
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
  every(30_000, "check in", async () => {
    await checkIn(workerId, rendering);
  });
  every(3600_000, "tidy check-ins", () => forgetStopped());
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void checkOut(workerId).finally(() => process.exit(0));
    });
  }
  every(60_000, "post", () => postDue());
  every(15 * 60_000, "stats", () => collectStats());
  // each niche is checked once a day: every half hour this checks only the ones whose day has come
  every(30 * 60_000, "trends", () => refreshTrends());
  every(6 * 3600_000, "earnings", () => syncEarnings());
  every(5 * 60_000, "live recaps", () => recapLives());
  every(3600_000, "clips", () => tidyClips());
  every(5 * 60_000, "daily shorts", () => runDailyShorts());
  await renderLoop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
