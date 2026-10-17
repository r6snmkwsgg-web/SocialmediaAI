import "server-only";
import { withPrior, type Weight } from "../../shorts/learn";
import type { Tx } from "../db";

/**
 * What a unit's Shorts are picked by. The account's own weights for an
 * account with no channel; for a channel, its own results, each pulled
 * toward what the account's other channels found until it has enough of
 * its own. Run as the user, so it only ever sees their own.
 */

/** The channels a channel learns alongside: the account's other YouTube channels, whatever their state, since what they learned still stands. */
export async function peersOf(tx: Tx, channelId: string): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`
    select c.id from public.channels c join public.channels me on me.user_id = c.user_id
    where me.id = ${channelId} and c.id <> me.id and c.platform = 'youtube'`;
  return rows.map((r) => r.id);
}

export async function weightsFor(tx: Tx, channelId: string | null): Promise<Weight[]> {
  if (!channelId) return tx<Weight[]>`select kind, name, score, samples from public.weights`;
  const ids = [channelId, ...(await peersOf(tx, channelId))];
  const rows = await tx<(Weight & { channel_id: string })[]>`
    select channel_id, kind, name, score, samples from public.channel_weights where channel_id in ${tx(ids)}`;
  const strip = ({ kind, name, score, samples }: Weight) => ({ kind, name, score, samples });
  return withPrior(rows.filter((r) => r.channel_id === channelId).map(strip), rows.filter((r) => r.channel_id !== channelId).map(strip));
}
