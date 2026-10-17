import { env } from "@/lib/server/env";
import { recapLives } from "@/lib/server/live";
import { runDailyShorts } from "@/lib/server/shorts/generate";
import { postDue } from "@/lib/server/shorts/post";
import { collectStats } from "@/lib/server/shorts/stats";
import { syncEarnings } from "@/lib/server/earnings";
import { refreshTrends } from "@/lib/server/trends";

// a channel's Shorts can take a minute or two while Claude writes new material: 300 seconds is what Vercel allows on every plan with fluid compute, which is on by default
export const maxDuration = 300;

/**
 * The worker's periodic jobs, for a scheduler to call instead (Vercel Cron
 * sends CRON_SECRET as a bearer token): post, stats, shorts, trends,
 * earnings, live. Trends checks only the niches whose daily check has
 * come, so calling it often uses no more of YouTube's quota. Safe to run
 * alongside the worker; each job locks what it works on.
 */
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = env().CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Not allowed", { status: 401 });
  const { job } = await params;
  let log: string[];
  if (job === "post") log = await postDue();
  else if (job === "stats") log = await collectStats();
  // a few at a time, and nobody new after two and a half minutes, so the request always finishes: the rest are picked up on the next run
  else if (job === "shorts") log = await runDailyShorts(new Date(), 5, 150_000);
  else if (job === "trends") log = await refreshTrends();
  else if (job === "live") log = await recapLives();
  else if (job === "earnings") log = await syncEarnings();
  else return new Response("No such job", { status: 404 });
  return Response.json({ job, log });
}
