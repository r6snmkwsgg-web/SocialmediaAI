import "server-only";
import { admin } from "./db";

/**
 * The render worker checking in. Each worker process says it's alive
 * every half minute, and what it's rendering, so the app can tell when
 * rendering has stopped (and say so) and the admin page can show who's
 * running.
 */

/** A worker that hasn't checked in for this long has stopped. */
export const GONE_AFTER_MS = 2 * 60_000;

export async function checkIn(id: string, rendering: string | null): Promise<void> {
  await admin((tx) => tx`
    insert into public.workers (id, rendering) values (${id}, ${rendering})
    on conflict (id) do update set seen_at = now(), rendering = excluded.rendering`);
}

export async function checkOut(id: string): Promise<void> {
  await admin((tx) => tx`delete from public.workers where id = ${id}`);
}

export type WorkerStatus = { running: number; lastSeen: Date | null; rendering: number };

export async function workerStatus(now = new Date()): Promise<WorkerStatus> {
  const [r] = await admin((tx) => tx<{ running: number; last_seen: Date | null; rendering: number }[]>`
    select count(*) filter (where seen_at > ${new Date(now.getTime() - GONE_AFTER_MS)})::int as running,
      max(seen_at) as last_seen,
      count(*) filter (where seen_at > ${new Date(now.getTime() - GONE_AFTER_MS)} and rendering is not null)::int as rendering
    from public.workers`);
  return { running: r.running, lastSeen: r.last_seen, rendering: r.rendering };
}

/** Old check-ins from workers that stopped without saying so, a day on. */
export async function forgetStopped(now = new Date()): Promise<void> {
  await admin((tx) => tx`delete from public.workers where seen_at < ${new Date(now.getTime() - 86400_000)}`);
}
