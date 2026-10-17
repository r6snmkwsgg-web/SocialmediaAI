import "server-only";
import { PLANS, type Plan, type PlanId } from "../billing/plans";
import { recapNote } from "../live/proof";
import { SESSION_IDLE, type SessionPayload } from "../live/session";
import { allowedBy, parseSettings, type GameId, type LiveSettings } from "../live/settings";
import { supportersFrom, type TopGifter } from "../live/supporters";
import { token } from "./crypto";
import { admin, asUser, type Tx } from "./db";
import { configured } from "./env";
import { notify } from "./notify";
import type { Goal } from "../app/checklist";
import { clipsAllowed } from "./clips";

/**
 * A streamer's LIVE game on their account: their settings, the private key
 * that lets the game (running in TikTok LIVE Studio, signed out) read
 * them, and the numbers each session saves back.
 */

/** `supporters` are the last LIVE's top gifters' TikTok ids, for welcome backs: ids only, never names */
export type Overlay = { settings: LiveSettings; plan: Plan; supporters: string[] };

/**
 * What the game gets for a key: the settings the plan allows, the plan,
 * and who to welcome back. Null if no such key. Throws when it can't tell
 * (the database is down or not set up), which is not the same as a key
 * that's gone. The game keeps rounds for Shorts only when they can become
 * Shorts, so it never records them for nothing.
 */
export async function overlayFor(key: string, now = new Date()): Promise<Overlay | null> {
  if (!/^[\w-]{16,64}$/.test(key)) return null;
  if (!configured().db) throw new Error("No database");
  return admin(async (tx) => {
    const [r] = await tx<{ user_id: string; settings: unknown; plan: PlanId | null; goal: Goal | null }[]>`
      select k.user_id, s.settings, sub.plan, p.goal
      from public.overlay_keys k
      left join public.live_settings s on s.user_id = k.user_id
      left join public.subscriptions sub on sub.user_id = k.user_id
      left join public.profiles p on p.id = k.user_id
      where k.key = ${key}`;
    if (!r) return null;
    const plan = PLANS[r.plan ?? "free"];
    const settings = allowedBy(parseSettings(r.settings), plan);
    // the name on screen comes from the LIVE itself, as each supporter does something
    return { settings: { ...settings, clips: clipsAllowed(settings, r.goal, configured().tiktokProfile) }, plan, supporters: supportersFrom(await lastLive(tx, r.user_id, now)) };
  });
}

/**
 * The streamer's last LIVE: the newest session that's over and had a
 * round or a gift, as recapLives counts them, so the LIVE now going is
 * never the last one. Reloading the game starts a new session in the
 * middle of a LIVE, so a session begun within 20 minutes of another's last
 * event carries that LIVE on: the one before isn't the last LIVE while it's
 * going, or once it has a round or a gift of its own.
 */
async function lastLive(tx: Tx, userId: string, now: Date): Promise<{ verified: boolean; top_gifters: TopGifter[] } | null> {
  const quiet = new Date(now.getTime() - SESSION_IDLE);
  const [r] = await tx<{ verified: boolean; top_gifters: TopGifter[] }[]>`
    select s.verified, s.top_gifters from public.live_sessions s
    where s.user_id = ${userId} and coalesce(s.last_event_at, s.started_at) < ${quiet} and (s.rounds > 0 or s.coins > 0)
      and not exists (
        select 1 from public.live_sessions n
        where n.user_id = s.user_id
          and n.started_at > coalesce(s.last_event_at, s.started_at)
          and n.started_at <= coalesce(s.last_event_at, s.started_at) + ${SESSION_IDLE} * interval '1 millisecond'
          and (coalesce(n.last_event_at, n.started_at) >= ${quiet} or n.rounds > 0 or n.coins > 0))
    order by s.started_at desc limit 1`;
  return r ?? null;
}

/** Whether their last LIVE was verified as theirs, which is what decides welcome backs; null before any LIVE is over. */
export async function lastLiveOf(userId: string, now = new Date()): Promise<{ verified: boolean } | null> {
  const last = await asUser(userId, (tx) => lastLive(tx, userId, now));
  return last && { verified: last.verified };
}

export type Lookup<T> = { state: "ok"; value: T } | { state: "gone" } | { state: "unsure" };

/**
 * Something read a few times before giving up: "gone" only when it really
 * isn't there, "unsure" when every try failed or took too long. A blip in
 * the database must never look like a key that was replaced, live on
 * someone's stream, and a database that doesn't answer mustn't keep the
 * game from opening.
 */
export async function lookUp<T>(read: () => Promise<T | null>, waits = [300, 1200], limitMs = 3000): Promise<Lookup<T>> {
  for (let i = 0; ; i++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const late = new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error("took too long")), limitMs)));
      const value = await Promise.race([read(), late]);
      return value === null ? { state: "gone" } : { state: "ok", value };
    } catch (err) {
      if (i >= waits.length) {
        console.error("live: couldn't read a game's settings:", err instanceof Error ? err.message : err);
        return { state: "unsure" };
      }
      await new Promise((r) => setTimeout(r, waits[i]));
    } finally {
      clearTimeout(timer);
    }
  }
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

/**
 * The settings form's save. Hiding names is saved on its own (setHideNames),
 * and the form sends back whatever it loaded with, so the stored choice wins
 * over the form's.
 */
export async function saveLiveSettings(userId: string, s: LiveSettings): Promise<void> {
  await asUser(userId, (tx) => tx`
    insert into public.live_settings (user_id, settings, updated_at) values (${userId}, ${tx.json(s)}, now())
    on conflict (user_id) do update set
      settings = excluded.settings || jsonb_strip_nulls(jsonb_build_object('hideNames', live_settings.settings -> 'hideNames')),
      updated_at = now()`);
}

/** One tap: show viewers' initials instead of their names and pictures, or show names again. Everything else stays as it is. */
export async function setHideNames(userId: string, on: boolean): Promise<void> {
  await asUser(userId, (tx) => tx`
    insert into public.live_settings (user_id, settings, updated_at) values (${userId}, ${tx.json({ hideNames: on })}, now())
    on conflict (user_id) do update set settings = live_settings.settings || excluded.settings, updated_at = now()`);
}

export type LiveSession = {
  id: string;
  game: GameId;
  startedAt: Date;
  lastAt: Date;
  rounds: number;
  coins: number;
  peakPlayers: number;
  /** its top 5 gifters, most coins first: shown to the streamer only */
  topGifters: TopGifter[];
  /** the TikTok LIVEs it heard, by username, as its source named them */
  heard: string[];
  /** some of it came from a source that didn't say whose LIVE it was (TikFinity) */
  unknown: boolean;
  /** every LIVE it heard is one of their own connected TikTok accounts, and none of it came from an unknown one, so its coins count */
  verified: boolean;
};

type SessionRow = { id: string; game: GameId; started_at: Date; last_event_at: Date | null; rounds: number; coins: number; peak_players: number; top_gifters: TopGifter[]; heard: string[]; heard_unknown: boolean; verified: boolean };

const toSession = (r: SessionRow): LiveSession => ({
  id: r.id,
  game: r.game,
  startedAt: r.started_at,
  lastAt: r.last_event_at ?? r.started_at,
  rounds: r.rounds,
  coins: r.coins,
  peakPlayers: r.peak_players,
  topGifters: r.top_gifters,
  heard: r.heard,
  unknown: r.heard_unknown,
  verified: r.verified,
});

export async function sessionsOf(userId: string, limit = 20): Promise<LiveSession[]> {
  const rows = await asUser(userId, (tx) => tx<SessionRow[]>`
    select id, game, started_at, last_event_at, rounds, coins, peak_players, top_gifters, heard, heard_unknown, verified
    from public.live_sessions where user_id = ${userId} order by started_at desc limit ${limit}`);
  return rows.map(toSession);
}

/** One of their LIVEs, for its own page; null when it isn't theirs. `id` must be a uuid. */
export async function sessionOf(userId: string, id: string): Promise<LiveSession | null> {
  const [r] = await asUser(userId, (tx) => tx<SessionRow[]>`
    select id, game, started_at, last_event_at, rounds, coins, peak_players, top_gifters, heard, heard_unknown, verified
    from public.live_sessions where id = ${id} and user_id = ${userId}`);
  return r ? toSession(r) : null;
}

/**
 * A session's numbers from the game. Each send is the whole session so
 * far, so numbers only ever go up: a late, older send can't undo a newer
 * one. The LIVEs it heard add up the same way, and so does hearing any of
 * it from a source that didn't say whose LIVE it was: once that's happened
 * the session can't count, whatever later sends say. It counts as theirs
 * only while every LIVE it heard is their own TikTok. False when the key
 * isn't anyone's.
 */
export async function recordSession(p: Omit<SessionPayload, "heard" | "unknown"> & { heard?: string[]; unknown?: boolean }): Promise<boolean> {
  const heard = [...new Set((p.heard ?? []).map((u) => u.toLowerCase()))];
  const unknown = !!p.unknown;
  return admin(async (tx) => {
    const [k] = await tx<{ user_id: string }[]>`select user_id from public.overlay_keys where key = ${p.key}`;
    if (!k) return false;
    await tx`
      insert into public.live_sessions (id, user_id, game, started_at, last_event_at, rounds, coins, peak_players, top_gifters, heard, heard_unknown, verified, updated_at)
      values (${p.id}, ${k.user_id}, ${p.game}, ${new Date(p.startedAt)}, ${new Date(p.lastAt)}, ${p.rounds}, ${p.coins}, ${p.peakPlayers}, ${tx.json(p.topGifters)},
        ${heard}::text[], ${unknown}::boolean, not ${unknown}::boolean and public.own_lives(${k.user_id}, ${heard}::text[]), now())
      on conflict (id) do update set
        rounds = greatest(live_sessions.rounds, excluded.rounds),
        coins = greatest(live_sessions.coins, excluded.coins),
        peak_players = greatest(live_sessions.peak_players, excluded.peak_players),
        top_gifters = case when excluded.coins >= live_sessions.coins then excluded.top_gifters else live_sessions.top_gifters end,
        last_event_at = greatest(live_sessions.last_event_at, excluded.last_event_at),
        heard = array(select distinct h from unnest(live_sessions.heard || excluded.heard) h order by h),
        heard_unknown = live_sessions.heard_unknown or excluded.heard_unknown,
        verified = not (live_sessions.heard_unknown or excluded.heard_unknown) and public.own_lives(live_sessions.user_id, live_sessions.heard || excluded.heard),
        updated_at = now()
      where live_sessions.user_id = excluded.user_id`;
    return true;
  });
}

/** Their connected TikTok accounts' usernames, as TikTok gave them: the LIVEs that count as theirs. */
export async function tiktokUsernamesOf(userId: string): Promise<string[]> {
  const rows = await asUser(userId, (tx) => tx<{ username: string }[]>`
    select username from public.tiktok_usernames where user_id = ${userId} order by verified_at`);
  return rows.map((r) => r.username);
}

/**
 * A TikTok account's username, straight from TikTok as it was connected.
 * LIVEs the game already heard on it now count, even ones from before.
 */
export async function rememberTikTok(userId: string, channelId: string, username: string): Promise<void> {
  await admin(async (tx) => {
    await tx`
      insert into public.tiktok_usernames (channel_id, user_id, username, verified_at) values (${channelId}, ${userId}, ${username.toLowerCase()}, now())
      on conflict (channel_id) do update set username = excluded.username, verified_at = now()`;
    await tx`update public.live_sessions set verified = true where user_id = ${userId} and not verified and not heard_unknown and public.own_lives(user_id, heard)`;
  });
}

/**
 * A recap of each LIVE once it's over: when nothing has happened in it for
 * 20 minutes. Sessions where no real viewer played say nothing. One the
 * game can't show was on their own TikTok says so, and why. Each opens the
 * LIVE's own page, and none names a viewer.
 */
export async function recapLives(now = new Date()): Promise<string[]> {
  const ended = await admin((tx) => tx<{ id: string; user_id: string; rounds: number; coins: number; peak_players: number; heard: string[]; heard_unknown: boolean; verified: boolean; mine: string[] }[]>`
    select s.id, s.user_id, s.rounds, s.coins, s.peak_players, s.heard, s.heard_unknown, s.verified,
      array(select t.username from public.tiktok_usernames t where t.user_id = s.user_id order by t.verified_at) as mine
    from public.live_sessions s
    where s.last_event_at < ${new Date(now.getTime() - SESSION_IDLE)} and s.last_event_at > ${new Date(now.getTime() - 2 * 86400_000)}
      and (s.rounds > 0 or s.coins > 0)
      and not exists (select 1 from public.notifications n where n.user_id = s.user_id and n.key = 'live:' || s.id)
    limit 200`);
  for (const s of ended) {
    const note = recapNote({ rounds: s.rounds, coins: s.coins, peakPlayers: s.peak_players, verified: s.verified, heard: s.heard, unknown: s.heard_unknown }, s.mine, configured().tiktokProfile);
    await notify(s.user_id, { kind: "live", ...note, href: `/app/live/${s.id}`, key: `live:${s.id}` });
  }
  return ended.map((s) => `recap for ${s.id}`);
}
