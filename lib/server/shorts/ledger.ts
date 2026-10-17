import "server-only";
import { SAME } from "../../shorts/checks";
import { lookNumber, type Look } from "../../shorts/look";
import type { FormatId } from "../../shorts/types";
import { admin } from "../db";

/**
 * The content ledger: what every channel has had, so nothing goes to two
 * of them. Claiming is all or nothing and the item is the table's key, so
 * when two people's Shorts are made at the same moment only one of them
 * can get any item; the other is told which ones it lost and makes
 * something else. Questions, choices and stories are kept with the words
 * that carry their meaning, so one another channel has is caught in
 * other words too.
 */

/** An item to claim, with the words that carry its meaning when it's a question, a choice or a story. */
export type Claim = { item: string; kind: FormatId | "look"; words?: string[] };

/** Of these items, the ones some channel already has. */
export async function takenOf(items: string[]): Promise<Set<string>> {
  if (!items.length) return new Set();
  const rows = await admin((tx) => tx<{ item: string }[]>`select item from public.content_ledger where item in ${tx(items)}`);
  return new Set(rows.map((r) => r.item));
}

/** Every chart some channel has: there are only a few thousand rankings and races to have. */
export async function takenCharts(): Promise<Set<string>> {
  const rows = await admin((tx) => tx<{ item: string }[]>`select item from public.content_ledger where kind in ('ranking', 'race')`);
  return new Set(rows.map((r) => r.item));
}

class Lost extends Error {
  constructor(readonly items: string[]) {
    super("already claimed");
  }
}

/** Postgres gave up on one of two transactions that were waiting on each other. */
const deadlocked = (err: unknown) => (err as { code?: string } | null)?.code === "40P01";

/**
 * Claims items for someone, all or nothing. Returns the items another
 * channel got first (and claims none of them), or nothing when all of
 * them are theirs now.
 */
export async function claim(userId: string, claims: Claim[]): Promise<string[]> {
  // always in the same order, so two claims of the same items wait their turn instead of waiting on each other
  const rows = [...new Map(claims.map((c) => [c.item, c])).values()].sort((x, y) => (x.item < y.item ? -1 : x.item > y.item ? 1 : 0));
  if (!rows.length) return [];
  const json = rows.map((r, n) => ({ n, item: r.item, kind: r.kind, words: r.words ?? null }));
  for (let tries = 1; ; tries++) {
    try {
      await admin(async (tx) => {
        const got = await tx<{ item: string }[]>`
          insert into public.content_ledger (item, kind, user_id, words)
          select item, kind, ${userId}::uuid, words from jsonb_to_recordset(${tx.json(json)}::jsonb) as t (n int, item text, kind text, words text[])
          order by n
          on conflict (item) do nothing
          returning item`;
        // anything someone else has: undo the lot
        if (got.length < rows.length) {
          const mine = new Set(got.map((r) => r.item));
          throw new Lost(rows.filter((r) => !mine.has(r.item)).map((r) => r.item));
        }
      });
      return [];
    } catch (err) {
      if (err instanceof Lost) return err.items;
      // shouldn't happen now they're in order, but if it does: try again, then make something else rather than fail
      if (deadlocked(err)) {
        if (tries < 3) continue;
        return rows.map((r) => r.item);
      }
      throw err;
    }
  }
}

/**
 * Of these new questions, choices or stories, the ones some channel
 * already has in other words: most of the words that carry the meaning
 * are the same (lib/shorts/checks.ts's sameThing, worked out by the
 * database against everything it has the words of).
 */
export async function takenInOtherWords(kind: FormatId, items: { id: string; words: string[] }[]): Promise<Set<string>> {
  const asked = items.filter((x) => x.words.length);
  if (!asked.length) return new Set();
  const rows = await admin((tx) => tx<{ id: string }[]>`
    select distinct c.id
    from jsonb_to_recordset(${tx.json(asked)}::jsonb) as c (id text, words text[])
    join public.content_ledger l on l.kind = ${kind} and l.words && c.words
    cross join lateral (select count(*)::float8 as same from unnest(l.words) w where w = any (c.words)) s
    where s.same / (cardinality(l.words) + cardinality(c.words) - s.same) >= ${SAME}`);
  return new Set(rows.map((r) => r.id));
}

/**
 * The channel's own look. The first time it's needed it takes the lowest
 * look number nobody has, so every channel's is different from every
 * other's; after that it's always the same one. Each of an account's
 * YouTube channels has its own; an account with no channel has one too
 * (`channelId` null), which its first channel takes over.
 */
export async function lookFor(userId: string, channelId: string | null = null): Promise<Look> {
  return admin(async (tx) => {
    const [mine] = await tx<{ item: string }[]>`
      select item from public.content_ledger
      where kind = 'look' and ${channelId ? tx`channel_id = ${channelId}` : tx`user_id = ${userId} and channel_id is null`}
      order by claimed_at limit 1`;
    if (mine) return lookNumber(Number(mine.item.slice("look:".length)));
    for (let tries = 0; tries < 8; tries++) {
      // look 0 is Hookline's own; the lowest free one is never past one more than the number taken
      const [got] = await tx<{ item: string }[]>`
        insert into public.content_ledger (item, kind, user_id, channel_id)
        select 'look:' || n, 'look', ${userId}::uuid, ${channelId}::uuid
        from generate_series(1, (select count(*) from public.content_ledger where kind = 'look')::int + 1) n
        where not exists (select 1 from public.content_ledger l where l.item = 'look:' || n)
        order by n
        limit 1
        on conflict (item) do nothing
        returning item`;
      if (got) return lookNumber(Number(got.item.slice("look:".length)));
    }
    throw new Error("couldn't find a free look");
  });
}
