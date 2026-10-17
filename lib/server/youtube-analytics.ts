import "server-only";
import type { Report } from "../shorts/proof";
import { spend } from "./quota";
import { failCounted, YouTubeError } from "./youtube";

/**
 * YouTube Analytics. Every report Hookline reads, for Earnings and for
 * each Short's own numbers, is asked from here, as the channel the access
 * belongs to, and counted in the quota ledger before it's made. It's its
 * own API with its own allowance, so these count as YouTube Analytics,
 * never against the Data API's units. When YouTube says that allowance is
 * used up, it's closed until the reset.
 */

const REPORTS = "https://youtubeanalytics.googleapis.com/v2/reports";

/** how long a report gets before it's given up on, like an outage, so one that hangs can't hold up the rest */
const TIMEOUT_MS = 30_000;

export type { Report };

export type ReportQuery = { startDate: string; endDate: string; metrics: string[]; dimensions?: string[]; filters?: string; sort?: string; maxResults?: number };

/** One YouTube Analytics report for the channel this access belongs to, with its column names. */
export async function analyticsReport(access: string, q: ReportQuery, now = new Date()): Promise<Report> {
  const query = new URLSearchParams({ ids: "channel==MINE", startDate: q.startDate, endDate: q.endDate, metrics: q.metrics.join(",") });
  if (q.dimensions?.length) query.set("dimensions", q.dimensions.join(","));
  if (q.filters) query.set("filters", q.filters);
  if (q.sort) query.set("sort", q.sort);
  if (q.maxResults) query.set("maxResults", String(q.maxResults));
  await spend("analytics", "reports.query", { now });
  let res: Response;
  try {
    res = await fetch(`${REPORTS}?${query}`, { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") throw new YouTubeError("YouTube Analytics didn't answer in time", 0, "timeout");
    throw new YouTubeError("YouTube Analytics couldn't be reached", 0, "network");
  }
  if (!res.ok) await failCounted(res, "YouTube Analytics", "analytics", "reports.query", now);
  const j = (await res.json()) as { columnHeaders?: { name?: string }[]; rows?: (string | number)[][] };
  return { columns: (j.columnHeaders ?? []).map((c) => c.name ?? ""), rows: j.rows ?? [] };
}
