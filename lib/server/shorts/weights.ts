import "server-only";
import { withPrior, type Weight } from "../../shorts/learn";
import { nicheById } from "../../shorts/niches";
import type { Tx } from "../db";

/**
 * What a unit's Shorts are picked by. The account's own weights for an
 * account with no channel; for a channel, its own results, each pulled
 * toward what the account's other channels about the same thing found
 * until it has enough of its own. Run as the user, so it only ever sees
 * their own.
 */

/**
 * The channels a channel learns alongside: the account's other YouTube
 * channels about the same thing, whatever their state, since what they
 * learned still stands. Channels that haven't picked what they're about
 * learn alongside each other.
 */
export async function peersOf(tx: Tx, channelId: string): Promise<string[]> {
  const rows = await tx<{ id: string; niche: string | null }[]>`
    select c.id, c.niche from public.channels c join public.channels me on me.user_id = c.user_id
    where me.id = ${channelId} and c.platform = 'youtube'`;
  const about = (niche: string | null | undefined) => nicheById(niche)?.id ?? null;
  const mine = about(rows.find((r) => r.id === channelId)?.niche);
  return rows.filter((r) => r.id !== channelId && about(r.niche) === mine).map((r) => r.id);
}

export async function weightsFor(tx: Tx, channelId: string | null): Promise<Weight[]> {
  if (!channelId) return tx<Weight[]>`select kind, name, score, samples from public.weights`;
  const ids = [channelId, ...(await peersOf(tx, channelId))];
  const rows = await tx<(Weight & { channel_id: string })[]>`
    select channel_id, kind, name, score, samples from public.channel_weights where channel_id in ${tx(ids)}`;
  const strip = ({ kind, name, score, samples }: Weight) => ({ kind, name, score, samples });
  return withPrior(rows.filter((r) => r.channel_id === channelId).map(strip), rows.filter((r) => r.channel_id !== channelId).map(strip));
}
