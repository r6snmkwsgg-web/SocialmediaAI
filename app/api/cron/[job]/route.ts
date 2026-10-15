import { env } from "@/lib/server/env";
import { dueForShorts, makeShorts } from "@/lib/server/shorts/generate";
import { postDue } from "@/lib/server/shorts/post";
import { collectStats } from "@/lib/server/shorts/stats";
import { syncEarnings } from "@/lib/server/earnings";
import { refreshTrends } from "@/lib/server/trends";

export const maxDuration = 60;

/**
 * The worker's periodic jobs, for a scheduler to call instead (Vercel Cron
 * sends CRON_SECRET as a bearer token): post, stats, shorts, trends,
 * earnings. Safe to run
 * alongside the worker; each job locks what it works on.
 */
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = env().CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Not allowed", { status: 401 });
  const { job } = await params;
  let log: string[];
  if (job === "post") log = await postDue();
  else if (job === "stats") log = await collectStats();
  else if (job === "shorts") {
    log = [];
    // a few at a time: the rest are picked up on the next run
    for (const id of await dueForShorts(new Date(), 5)) log.push(`${await makeShorts(id, { origin: "daily" })} for ${id}`);
  } else if (job === "trends") log = await refreshTrends();
  else if (job === "earnings") log = await syncEarnings();
  else return new Response("No such job", { status: 404 });
  return Response.json({ job, log });
}
