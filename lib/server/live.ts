import "server-only";
import { PLANS, type Plan, type PlanId } from "../billing/plans";
import type { SessionPayload } from "../live/session";
import { allowedBy, parseSettings, type GameId, type LiveSettings } from "../live/settings";
import { token } from "./crypto";
import { admin, asUser } from "./db";
import { configured } from "./env";

/**
 * A streamer's LIVE game on their account: their settings, the private key
 * that lets the game (running in TikTok LIVE Studio, signed out) read
 * them, and the numbers each session saves back.
 */

/** What the game gets for a key: the settings the plan allows, and the plan. Null if no such key. */
export async function overlayFor(key: string): Promise<{ settings: LiveSettings; plan: Plan } | null> {
  if (!configured().db || !/^[\w-]{16,64}$/.test(key)) return null;
  const rows = await admin((tx) => tx<{ settings: unknown; plan: PlanId | null }[]>`
    select s.settings, sub.plan
    from public.overlay_keys k
    left join public.live_settings s on s.user_id = k.user_id
    left join public.subscriptions sub on sub.user_id = k.user_id
    where k.key = ${key}`);
  if (!rows[0]) return null;
  const plan = PLANS[rows[0].plan ?? "free"];
  return { settings: allowedBy(parseSettings(rows[0].settings), plan), plan };
}

/** The account's overlay key, made the first time it's asked for. */
export async function overlayKeyOf(userId: string): Promise<string> {
  return asUser(userId, async (tx) => {
    await tx`insert into public.overlay_keys (user_id, key) values (${userId}, ${token()}) on conflict (user_id) do nothing`;
    const [r] = await tx<{ key: string }[]>`select key from public.overlay_keys where user_id = ${userId}`;
    return r.key;
  });
}

/** A new key: the old game address stops working at once. */
export async function rotateOverlayKey(userId: string): Promise<string> {
  const key = token();
  await asUser(userId, (tx) => tx`
    insert into public.overlay_keys (user_id, key) values (${userId}, ${key})
    on conflict (user_id) do update set key = excluded.key, created_at = now()`);
  return key;
}

export async function liveSettingsOf(userId: string): Promise<{ settings: LiveSettings; saved: boolean }> {
  const rows = await asUser(userId, (tx) => tx<{ settings: unknown }[]>`select settings from public.live_settings where user_id = ${userId}`);
  return { settings: parseSettings(rows[0]?.settings), saved: rows.length > 0 };
}

export async function saveLiveSettings(userId: string, s: LiveSettings): Promise<void> {
  await asUser(userId, (tx) => tx`
    insert into public.live_settings (user_id, settings, updated_at) values (${userId}, ${tx.json(s)}, now())
    on conflict (user_id) do update set settings = excluded.settings, updated_at = now()`);
}

export type LiveSession = {
  id: string;
  game: GameId;
  startedAt: Date;
  lastAt: Date;
  rounds: number;
  coins: number;
  peakPlayers: number;
  topGifters: { id: string; name: string; coins: number }[];
};

export async function sessionsOf(userId: string, limit = 20): Promise<LiveSession[]> {
  const rows = await asUser(userId, (tx) => tx<{ id: string; game: GameId; started_at: Date; last_event_at: Date | null; rounds: number; coins: number; peak_players: number; top_gifters: LiveSession["topGifters"] }[]>`
    select id, game, started_at, last_event_at, rounds, coins, peak_players, top_gifters
    from public.live_sessions where user_id = ${userId} order by started_at desc limit ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    game: r.game,
    startedAt: r.started_at,
    lastAt: r.last_event_at ?? r.started_at,
    rounds: r.rounds,
    coins: r.coins,
    peakPlayers: r.peak_players,
    topGifters: r.top_gifters,
  }));
}

/**
 * A session's numbers from the game. Each send is the whole session so
 * far, so numbers only ever go up: a late, older send can't undo a newer
 * one. False when the key isn't anyone's.
 */
export async function recordSession(p: SessionPayload): Promise<boolean> {
  return admin(async (tx) => {
    const [k] = await tx<{ user_id: string }[]>`select user_id from public.overlay_keys where key = ${p.key}`;
    if (!k) return false;
    await tx`
      insert into public.live_sessions (id, user_id, game, started_at, last_event_at, rounds, coins, peak_players, top_gifters, updated_at)
      values (${p.id}, ${k.user_id}, ${p.game}, ${new Date(p.startedAt)}, ${new Date(p.lastAt)}, ${p.rounds}, ${p.coins}, ${p.peakPlayers}, ${tx.json(p.topGifters)}, now())
      on conflict (id) do update set
        rounds = greatest(live_sessions.rounds, excluded.rounds),
        coins = greatest(live_sessions.coins, excluded.coins),
        peak_players = greatest(live_sessions.peak_players, excluded.peak_players),
        top_gifters = case when excluded.coins >= live_sessions.coins then excluded.top_gifters else live_sessions.top_gifters end,
        last_event_at = greatest(live_sessions.last_event_at, excluded.last_event_at),
        updated_at = now()
      where live_sessions.user_id = excluded.user_id`;
    return true;
  });
}
