import "server-only";
import { PLANS, type Plan, type PlanId } from "../billing/plans";
import type { LivePlatform } from "../live/events";
import { recapNote } from "../live/proof";
import { SESSION_IDLE, type SessionPayload } from "../live/session";
import { allowedBy, parseSettings, type GameId, type LiveSettings } from "../live/settings";
import { supportersFrom, type TopGifter } from "../live/supporters";
import { youtubeRecap, type Tally } from "../live/youtube";
import { token } from "./crypto";
import { admin, asUser, type Tx } from "./db";
import { configured } from "./env";
import { notify } from "./notify";
import type { Goal } from "../app/checklist";
import { clipsAllowed } from "./clips";
import { sweepYouTubeLive } from "./ytlive";

/**
 * A streamer's LIVE game on their account: their settings, the private key
 * that lets the game (running in TikTok LIVE Studio or OBS, signed out)
 * read them, and the numbers each session saves back, on TikTok or on
 * YouTube.
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
 * going, or once it has a round or a gift of its own. Only TikTok LIVEs:
 * welcome backs go by TikTok ids, and a YouTube LIVE has no gift coins.
 */
async function lastLive(tx: Tx, userId: string, now: Date): Promise<{ verified: boolean; top_gifters: TopGifter[] } | null> {
  const quiet = new Date(now.getTime() - SESSION_IDLE);
  const [r] = await tx<{ verified: boolean; top_gifters: TopGifter[] }[]>`
    select s.verified, s.top_gifters from public.live_sessions s
    where s.user_id = ${userId} and s.platform = 'tiktok' and coalesce(s.last_event_at, s.started_at) < ${quiet} and (s.rounds > 0 or s.coins > 0)
      and not exists (
        select 1 from public.live_sessions n
        where n.user_id = s.user_id and n.platform = 'tiktok'
          and n.started_at > coalesce(s.last_event_at, s.started_at)
          and n.started_at <= coalesce(s.last_event_at, s.started_at) + ${SESSION_IDLE} * interval '1 millisecond'
          and (coalesce(n.last_event_at, n.started_at) >= ${quiet} or n.rounds > 0 or n.coins > 0))
    order by s.started_at desc limit 1`;
  return r ?? null;
}

/** Whether their last TikTok LIVE was verified as theirs, which is what decides welcome backs; null before any is over. */
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

/**
 * A YouTube stream a session heard: its title, the channel it was on, and
 * what the game heard on it while a game was open. Those are the stream's
 * counts, never the session's, since one stream can run across two
 * sessions, and never what anyone paid.
 */
export type HeardStream = Tally & { id: string; title: string | null; channel: string | null };

export type LiveSession = {
  id: string;
  game: GameId;
  /** where the LIVE was */
  platform: LivePlatform;
  startedAt: Date;
  lastAt: Date;
  rounds: number;
  /** gift coins seen, on TikTok; a YouTube LIVE has none */
  coins: number;
  peakPlayers: number;
  /** its top 5 gifters, most coins first: shown to the streamer only. On YouTube, in the game's order with no coins, and only for 30 days */
  topGifters: TopGifter[];
  /** the TikTok LIVEs it heard, by username, as its source named them */
  heard: string[];
  /** some of it came from a source that didn't say whose LIVE it was (TikFinity) */
  unknown: boolean;
  /** on YouTube, the streams it heard, by video id, and those Hookline still has, with what the game heard on each */
  broadcasts: string[];
  streams: HeardStream[];
  /**
   * every LIVE it heard is one of their own connected TikTok accounts, and none of it came from an unknown one, so its coins
   * count; on YouTube, every stream it heard is one Hookline's own reader heard on their channel
   */
  verified: boolean;
};

type SessionRow = {
  id: string; game: GameId; platform: LivePlatform; started_at: Date; last_event_at: Date | null; rounds: number; coins: number; peak_players: number;
  top_gifters: TopGifter[]; heard: string[]; heard_unknown: boolean; broadcasts: string[]; streams: HeardStream[]; verified: boolean;
};

/** A session's columns, with each YouTube stream it heard as the reader kept it, in the order the session heard them. */
const SESSION = (tx: Tx) => tx`
  s.id, s.game, s.platform, s.started_at, s.last_event_at, s.rounds, s.coins, s.peak_players, s.top_gifters, s.heard, s.heard_unknown, s.broadcasts, s.verified,
  coalesce((
    select json_agg(json_build_object(
      'id', b.broadcast_id, 'title', b.title, 'channel', coalesce(c.title, c.handle), 'superChats', b.super_chats, 'superStickers', b.super_stickers,
      'jewels', b.jewels, 'newMembers', b.new_members, 'giftedMembers', b.gifted_members) order by array_position(s.broadcasts, b.broadcast_id))
    from public.yt_broadcasts b left join public.channels c on c.id = b.channel_id
    where b.user_id = s.user_id and b.broadcast_id = any(s.broadcasts)), '[]'::json) as streams`;

const toSession = (r: SessionRow): LiveSession => ({
  id: r.id,
  game: r.game,
  platform: r.platform,
  startedAt: r.started_at,
  lastAt: r.last_event_at ?? r.started_at,
  rounds: r.rounds,
  coins: r.coins,
  peakPlayers: r.peak_players,
  topGifters: r.top_gifters,
  heard: r.heard,
  unknown: r.heard_unknown,
  broadcasts: r.broadcasts,
  streams: r.streams,
  verified: r.verified,
});

export async function sessionsOf(userId: string, limit = 20): Promise<LiveSession[]> {
  const rows = await asUser(userId, (tx) => tx<SessionRow[]>`
    select ${SESSION(tx)} from public.live_sessions s where s.user_id = ${userId} order by s.started_at desc limit ${limit}`);
  return rows.map(toSession);
}

/** One of their LIVEs, for its own page; null when it isn't theirs. `id` must be a uuid. */
export async function sessionOf(userId: string, id: string): Promise<LiveSession | null> {
  const [r] = await asUser(userId, (tx) => tx<SessionRow[]>`
    select ${SESSION(tx)} from public.live_sessions s where s.id = ${id} and s.user_id = ${userId}`);
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
 *
 * A YouTube session counts as theirs while every stream it names is one
 * their own reader heard, on their own channel. YouTube has no gift coins,
 * so it keeps none, and its top gifters only by name, in the game's order,
 * the newest send's. A session stays on the platform it began on: a send
 * that says the other changes nothing.
 */
export async function recordSession(p: Omit<SessionPayload, "heard" | "unknown" | "platform" | "broadcasts"> & Partial<Pick<SessionPayload, "heard" | "unknown" | "platform" | "broadcasts">>): Promise<boolean> {
  const platform = p.platform ?? "tiktok";
  const youtube = platform === "youtube";
  const heard = youtube ? [] : [...new Set((p.heard ?? []).map((u) => u.toLowerCase()))];
  const unknown = !youtube && !!p.unknown;
  const broadcasts = youtube ? [...new Set(p.broadcasts ?? [])] : [];
  // what the game counts on YouTube is its own power, which never leaves the game
  const coins = youtube ? 0 : p.coins;
  const gifters = youtube ? p.topGifters.map((g) => ({ ...g, coins: 0 })) : p.topGifters;
  return admin(async (tx) => {
    const [k] = await tx<{ user_id: string }[]>`select user_id from public.overlay_keys where key = ${p.key}`;
    if (!k) return false;
    await tx`
      insert into public.live_sessions (id, user_id, game, platform, started_at, last_event_at, rounds, coins, peak_players, top_gifters, heard, heard_unknown, broadcasts, verified, updated_at)
      values (${p.id}, ${k.user_id}, ${p.game}, ${platform}, ${new Date(p.startedAt)}, ${new Date(p.lastAt)}, ${p.rounds}, ${coins}, ${p.peakPlayers}, ${tx.json(gifters)},
        ${heard}::text[], ${unknown}::boolean, ${broadcasts}::text[],
        case when ${youtube}::boolean then public.own_broadcasts(${k.user_id}, ${broadcasts}::text[])
          else not ${unknown}::boolean and public.own_lives(${k.user_id}, ${heard}::text[]) end,
        now())
      on conflict (id) do update set
        rounds = greatest(live_sessions.rounds, excluded.rounds),
        coins = greatest(live_sessions.coins, excluded.coins),
        peak_players = greatest(live_sessions.peak_players, excluded.peak_players),
        -- the gifters of whichever send saw most, or on YouTube, where there are no coins to go by, of the newest
        top_gifters = case
          when live_sessions.platform = 'youtube' then case when excluded.last_event_at >= coalesce(live_sessions.last_event_at, live_sessions.started_at) then excluded.top_gifters else live_sessions.top_gifters end
          when excluded.coins >= live_sessions.coins then excluded.top_gifters else live_sessions.top_gifters end,
        last_event_at = greatest(live_sessions.last_event_at, excluded.last_event_at),
        heard = array(select distinct h from unnest(live_sessions.heard || excluded.heard) h order by h),
        heard_unknown = live_sessions.heard_unknown or excluded.heard_unknown,
        -- in the order the session first heard them
        broadcasts = array(select b from unnest(live_sessions.broadcasts || excluded.broadcasts) with ordinality u (b, i) group by b order by min(i)),
        verified = case when live_sessions.platform = 'youtube' then public.own_broadcasts(live_sessions.user_id, live_sessions.broadcasts || excluded.broadcasts)
          else not (live_sessions.heard_unknown or excluded.heard_unknown) and public.own_lives(live_sessions.user_id, live_sessions.heard || excluded.heard) end,
        updated_at = now()
      where live_sessions.user_id = excluded.user_id and live_sessions.platform = excluded.platform`;
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
 * TikTok LIVEs the game already heard on it now count, even ones from
 * before.
 */
export async function rememberTikTok(userId: string, channelId: string, username: string): Promise<void> {
  await admin(async (tx) => {
    await tx`
      insert into public.tiktok_usernames (channel_id, user_id, username, verified_at) values (${channelId}, ${userId}, ${username.toLowerCase()}, now())
      on conflict (channel_id) do update set username = excluded.username, verified_at = now()`;
    await tx`
      update public.live_sessions set verified = true
      where user_id = ${userId} and platform = 'tiktok' and not verified and not heard_unknown and public.own_lives(user_id, heard)`;
  });
}

type Ended = {
  id: string; user_id: string; platform: LivePlatform; rounds: number; coins: number; peak_players: number; heard: string[]; heard_unknown: boolean; verified: boolean;
  mine: string[]; streams: number; super_chats: number; title: string | null; reads_super_chats: boolean;
};

/**
 * A LIVE's recap: on YouTube, the Super Chats the game heard on its stream, and where to see what viewers paid when Hookline reads
 * them for Earnings; on TikTok, its gift coins seen, or why they don't count.
 */
function recapOf(s: Ended): { title: string; body: string } {
  if (s.platform === "youtube") {
    const earnings = configured().youtubeLive && s.reads_super_chats;
    return youtubeRecap({ rounds: s.rounds, peakPlayers: s.peak_players, superChats: s.super_chats, title: s.streams === 1 ? s.title : null, streams: s.streams, earnings });
  }
  return recapNote({ rounds: s.rounds, coins: s.coins, peakPlayers: s.peak_players, verified: s.verified, heard: s.heard, unknown: s.heard_unknown }, s.mine, configured().tiktokProfile);
}

/**
 * A recap of each LIVE once it's over: when nothing has happened in it for
 * 20 minutes. Sessions where no real viewer played say nothing. One the
 * game can't show was on their own TikTok says so, and why. A YouTube
 * LIVE's says what the game heard on its stream, never what anyone paid.
 * Each opens the LIVE's own page, and none names a viewer. YouTube Live
 * is tidied up at the same time.
 */
export async function recapLives(now = new Date()): Promise<string[]> {
  const ended = await admin((tx) => tx<Ended[]>`
    select s.id, s.user_id, s.platform, s.rounds, s.coins, s.peak_players, s.heard, s.heard_unknown, s.verified,
      array(select t.username from public.tiktok_usernames t where t.user_id = s.user_id order by t.verified_at) as mine,
      cardinality(s.broadcasts) as streams,
      (select coalesce(sum(b.super_chats), 0)::int from public.yt_broadcasts b where b.user_id = s.user_id and b.broadcast_id = any(s.broadcasts)) as super_chats,
      (select b.title from public.yt_broadcasts b where b.user_id = s.user_id and b.broadcast_id = s.broadcasts[1]) as title,
      -- Earnings reads Super Chats only for people who said their channel has them
      coalesce((select p.yt_live_check ->> 'superChat' = 'true' from public.profiles p where p.id = s.user_id), false) as reads_super_chats
    from public.live_sessions s
    where s.last_event_at < ${new Date(now.getTime() - SESSION_IDLE)} and s.last_event_at > ${new Date(now.getTime() - 2 * 86400_000)}
      and (s.rounds > 0 or s.coins > 0)
      and not exists (select 1 from public.notifications n where n.user_id = s.user_id and n.key = 'live:' || s.id)
    limit 200`);
  for (const s of ended) await notify(s.user_id, { kind: "live", ...recapOf(s), href: `/app/live/${s.id}`, key: `live:${s.id}` });
  return [...ended.map((s) => `recap for ${s.id}`), ...(await sweepYouTubeLive(now))];
}
