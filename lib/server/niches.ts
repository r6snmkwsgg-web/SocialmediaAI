import "server-only";
import { nicheById, type ChannelNiche } from "../shorts/niches";
import { NICHES } from "../trends/niches";
import { asUser, type Tx } from "./db";

/**
 * What an account's Shorts are about: each of its YouTube channels by its
 * id, and its own Shorts (null), which have a niche of their own while the
 * account has no channel. One nobody picked, or that the code doesn't
 * know, is null: a mix of everything. Run as the user, so it only ever
 * sees their own.
 */
export async function nichesOf(tx: Tx, userId: string): Promise<Map<string | null, ChannelNiche | null>> {
  const rows = await tx<{ id: string | null; niche: string | null }[]>`
    select id, niche from public.channels where user_id = ${userId} and platform = 'youtube'
    union all
    select null::uuid, niche from public.profiles where id = ${userId}`;
  return new Map(rows.map((r) => [r.id, nicheById(r.niche)]));
}

/**
 * The Trends niches an account's Shorts are about, for Trends to show
 * while it follows none: those of each YouTube channel that's still its
 * own, or of its own Shorts (`own`) while it has no channel. In Trends'
 * order, and none while nothing's picked, so Trends shows every niche.
 */
export async function channelTrendNiches(userId: string): Promise<{ ids: string[]; own: boolean }> {
  const rows = await asUser(userId, (tx) => tx<{ niche: string | null; own: boolean }[]>`
    select niche, false as own from public.channels where user_id = ${userId} and platform = 'youtube' and status <> 'revoked'
    union all
    select niche, true from public.profiles where id = ${userId}
      and not exists (select 1 from public.channels where user_id = ${userId} and platform = 'youtube' and status <> 'revoked')`);
  const tied = new Set(rows.flatMap((r) => nicheById(r.niche)?.trends ?? []));
  return { ids: NICHES.filter((n) => tied.has(n.id)).map((n) => n.id), own: rows.some((r) => r.own) };
}
