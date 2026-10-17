import "server-only";
import { at24h, lift, median } from "../../shorts/learn";
import { localParts, type HourResult } from "../../shorts/times";
import type { Tx } from "../db";

/**
 * What a channel's posting times are learned from: its last 60 Shorts'
 * results at 24 hours, each by the local hour it went out. A reading that
 * came late is scaled back to 24 hours first. Each channel learns from its
 * own Shorts (`channelId`), and an account with no channel from the Shorts
 * that have none. Run as the user, so it only ever sees their own.
 */
export async function hourResults(tx: Tx, tz: string, channelId: string | null): Promise<HourResult[]> {
  const rows = await tx<{ views: number; posted_at: Date; hours: number }[]>`
    select s.views::float8 as views, v.posted_at, extract(epoch from s.fetched_at - v.posted_at)::float8 / 3600 as hours
    from public.video_stats s join public.videos v on v.id = s.video_id
    where s.checkpoint = '24h' and v.posted_at is not null and ${channelId ? tx`v.channel_id = ${channelId}` : tx`v.channel_id is null`}
    order by v.posted_at desc limit 60`;
  const views = rows.map((r) => at24h(r.views, r.hours));
  const typical = median(views) ?? 0;
  return rows.map((r, i) => ({ hour: localParts(r.posted_at, tz).hour, lift: lift(views[i], typical) }));
}
