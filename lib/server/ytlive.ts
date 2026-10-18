import "server-only";
import type { PlanId } from "../billing/plans";
import type { LiveEvent } from "../live/events";
import {
  HURRY_MS, keepStreaks, lookWait, NUDGE_MS, READ_FLOOR_MS, readMessage, readWait, streaksOf, tallyOf,
  type Streaks, type YouTubeLiveReply, type YouTubeRead, type YouTubeState,
} from "../live/youtube";
import { METHODS, quotaResetsAt, type Method } from "../shorts/quota";
import { hasScope } from "../shorts/youtube";
import { markExpired } from "./channels-store";
import { admin, asUser, type Tx } from "./db";
import { configured } from "./env";
import { giveBackLiveUnits, liveUnitsOf, QuotaWait, takeLiveUnits, usageToday } from "./quota";
import { READONLY_SCOPE, youtubeAccess, youtubeActiveBroadcast, youtubeChatPage, YouTubeError, type LiveBroadcast } from "./youtube";

/**
 * YouTube Live on the server. While a game (or the setup page) is asking,
 * Hookline reads the live chat of the account's own stream through its
 * connected channel and hands every open game what happened. Each account
 * has one reader, and it's lazy: YouTube is only asked while something
 * asks Hookline, so a closed game costs nothing. A turn is claimed on the
 * reader's row, so several open windows never ask YouTube more often than
 * one would, and each request makes at most one YouTube call, never inside
 * a transaction. Every call comes out of the account's own YouTube LIVE
 * time and everyone's. Turn times come from the database's clock, so two
 * servers never disagree about whose turn it is.
 */

/** chat rows are kept this long, for open games to pick up */
const KEEP_EVENTS_MS = 10 * 60_000;
/** the oldest an event can be and still go to a game: a game further behind starts again from now */
const FRESH_MS = 60_000;
/** YouTube viewers' names stay in saved sessions this long */
const KEEP_NAMES_MS = 30 * 86400_000;
/** a message sent this long before the newest one already seen is old news: the chat's history, or YouTube sending it again */
const OLD_NEWS_MS = 30_000;
/** when the reader finds a stream's chat, or picks it up again after a gap, it counts what was said from this long before */
const BACK_MS = 10_000;
/** a turn is held this long: past the 5 seconds a token refresh is given and a YouTube call's 8 after it */
const LEASE_MS = 15_000;
/** a token refresh Google hasn't answered in this long passes like an outage, so a turn never outlasts its lease */
const REFRESH_MS = 5000;
/** a game asking after nobody has for this long starts afresh, and what was said meanwhile is history */
const AWAY_MS = 10 * 60_000;
/** a game asked this recently, so the LIVE page says one is open */
const OPEN_MS = 90_000;
/** readers nobody has asked for in this long go back to idle */
const IDLE_MS = 3600_000;
/** the most chat rows one reply carries */
const MAX_ROWS = 500;
/** a reply's wait: just after the reader's next turn, between a second and a minute */
const WAIT_EXTRA_MS = 300;
const WAIT_MIN_MS = 1000;
const WAIT_MAX_MS = 60_000;
/** Free accounts pause once everyone's LIVE units reach this share of YouTube Live's, so paying accounts keep the rest */
const FREE_SHARE = 0.8;
/** how long to leave YouTube after an outage, after a refusal, and while a channel needs connecting again */
const OUTAGE_MS = 30_000;
const REFUSED_MS = 5 * 60_000;
const RECONNECT_MS = 60_000;

/** why, in plain words, for the LIVE page and beside the game */
const WHY = {
  lost: "Hookline lost access to this channel.",
  scope: "Hookline isn't allowed to see this YouTube account.",
  kids: "YouTube has this stream as made for kids, so it has no live chat.",
  chatOff: "Live chat is off on this stream.",
  down: "YouTube isn't answering.",
  refused: "YouTube didn't let Hookline read this chat.",
};

type ReaderState = "idle" | "not_live" | "live" | "chat_off" | "ended" | "paused" | "reconnect" | "error";
type Who = "account" | "everyone";

/** The reader as it's stored, with its stream's title from what the reader heard. */
type Reader = {
  user_id: string;
  channel_id: string | null;
  state: ReaderState;
  detail: string | null;
  broadcast_id: string | null;
  chat_id: string | null;
  page_token: string | null;
  seen_until: Date | null;
  read_at: Date | null;
  poll_ms: number | null;
  asked_at: Date | null;
  game_at: Date | null;
  looking_since: Date | null;
  nudged_at: Date | null;
  hurry_until: Date | null;
  next_at: Date;
  busy_until: Date | null;
  quiet: number;
  paused_until: Date | null;
  paused_for: Who | null;
  streaks: unknown;
  title: string | null;
};

/** What a turn or an ask changes on the reader. */
type Patch = Partial<Omit<Reader, "user_id" | "channel_id" | "title" | "streaks">> & { streaks?: Streaks };

/**
 * What an ask says: its first, a look-now, a countdown or vote going on, whether the stream was found on another channel,
 * and whether it's the LIVE page asking rather than a game.
 */
type Ask = { first: boolean; go: boolean; hurry: boolean; restart: boolean; setup: boolean };

/** The channel the game reads with. */
type LiveChannel = { id: string; name: string | null; status: string; scopes: string | null; elsewhere: boolean };

const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const earlier = (a: Date, b: Date) => (a < b ? a : b);

/** nothing of a stream's chat kept: no chat, place in it or combos */
const OFF_CHAT: Patch = { chat_id: null, page_token: null, seen_until: null, poll_ms: null, quiet: 0, streaks: {} };
/** nothing of a stream kept at all */
const OFF_STREAM: Patch = { ...OFF_CHAT, broadcast_id: null };
const NOT_PAUSED: Patch = { paused_until: null, paused_for: null };

/** The reader's columns, with its stream's title. The table goes by its own name: the query builder would read an alias before a set as a select. */
const READER = (tx: Tx) => tx`yt_live_readers.*, (select b.title from public.yt_broadcasts b
  where b.user_id = yt_live_readers.user_id and b.broadcast_id = yt_live_readers.broadcast_id) as title`;

/** The database's clock, which every server shares. */
async function clock(): Promise<Date> {
  const [r] = await admin((tx) => tx<{ now: Date }[]>`select clock_timestamp() as now`);
  return r.now;
}

/** The account behind a game's key and its plan, the way overlayFor finds them, with the database's clock; null for a key that isn't anyone's. */
async function keyOwner(key: string): Promise<{ userId: string; plan: PlanId; now: Date } | null> {
  if (!/^[\w-]{16,64}$/.test(key)) return null;
  const [r] = await admin((tx) => tx<{ user_id: string; plan: PlanId | null; now: Date }[]>`
    select k.user_id, sub.plan, now() as now from public.overlay_keys k
    left join public.subscriptions sub on sub.user_id = k.user_id
    where k.key = ${key}`);
  return r ? { userId: r.user_id, plan: r.plan ?? "free", now: r.now } : null;
}

/**
 * The channel the game reads with: always one of the account's own YouTube
 * channels that isn't disconnected, the one they picked first, then one
 * that's connected before one that needs reconnecting, then the first
 * added. Null when they have none. `elsewhere` when the stream the reader
 * is on was found on another channel, so reading starts over on this one.
 */
async function liveChannel(userId: string): Promise<LiveChannel | null> {
  const [c] = await admin((tx) => tx<{ id: string; title: string | null; handle: string | null; status: string; scopes: string | null; elsewhere: boolean }[]>`
    select c.id, c.title, c.handle, c.status, t.scopes, (r.broadcast_id is not null and b.channel_id is distinct from c.id) as elsewhere
    from public.channels c
    left join public.channel_tokens t on t.channel_id = c.id
    left join public.yt_live_readers r on r.user_id = c.user_id
    left join public.yt_broadcasts b on b.user_id = r.user_id and b.broadcast_id = r.broadcast_id
    where c.user_id = ${userId} and c.platform = 'youtube' and c.status <> 'revoked'
    order by (c.id = r.channel_id) is true desc, (c.status = 'connected') desc, c.added_at, c.id
    limit 1`);
  return c ? { id: c.id, name: c.title ?? c.handle, status: c.status, scopes: c.scopes, elsewhere: c.elsewhere } : null;
}

/** Why the game can't read with this channel until it's connected again, or null when it can. A token whose scopes weren't saved is tried. */
function reconnectWhy(c: LiveChannel): string | null {
  if (c.status !== "connected") return WHY.lost;
  return hasScope(c.scopes, READONLY_SCOPE) === false ? WHY.scope : null;
}

/** Writes a patch to the reader and returns it as it now stands. */
async function write(tx: Tx, userId: string, p: Patch, at: Date): Promise<Reader> {
  const set: Record<string, unknown> = { ...p, updated_at: at };
  if (p.streaks) set.streaks = tx.json(p.streaks);
  const [r] = await tx<Reader[]>`update public.yt_live_readers set ${tx(set)} where user_id = ${userId} returning ${READER(tx)}`;
  return r;
}

/** The end of a turn: what it found written, and the turn let go of. */
function finish(r: Reader, p: Patch, at: Date): Promise<Reader> {
  return admin((tx) => write(tx, r.user_id, { ...p, busy_until: null }, at));
}

/**
 * What an ask changes. It's noted, so the reader keeps going while someone
 * listens. A fresh ask (a game's first or a look-now, at most once a
 * minute between them, or the first in 10 minutes) looks for the stream
 * straight away while there's no chat, and after a stream ended. After 10
 * minutes with nobody asking, what was said meanwhile is history, so
 * reading picks up from now. A hurry keeps a quiet chat's next read at the
 * floor, but never undoes a wait YouTube asked for, or one after a refusal
 * or an outage. Reading starts over when the stream was found on another
 * channel.
 */
function asked(r: Reader, a: Ask, now: Date): Patch {
  const t = now.getTime();
  // a reload, Check now and OBS starting the stream each look at once, but all of them together at most once a minute
  const nudged = (a.first || a.go) && (!r.nudged_at || t - r.nudged_at.getTime() >= NUDGE_MS);
  const away = !r.asked_at || t - r.asked_at.getTime() >= AWAY_MS;
  const p: Patch = { asked_at: now, ...(a.setup ? {} : { game_at: now }), ...(nudged ? { nudged_at: now } : {}) };
  if (a.restart) return { ...p, ...OFF_STREAM, ...NOT_PAUSED, state: "idle", detail: null, looking_since: now, next_at: now };
  if (nudged || away) {
    p.looking_since = now;
    if (!r.chat_id || r.state === "ended") p.next_at = earlier(r.next_at, now);
    else if (away) Object.assign(p, { page_token: null, seen_until: new Date(t - BACK_MS), quiet: 0, streaks: {} });
  }
  if (a.hurry) {
    p.hurry_until = new Date(t + HURRY_MS);
    if (quietSlowdown(r)) p.next_at = earlier(p.next_at ?? r.next_at, plus(r.read_at!, Math.max(READ_FLOOR_MS, r.poll_ms ?? 0)));
  }
  return p;
}

/** Whether a live chat's next read is no later than a quiet chat's would be: the only wait a game counting down or voting can cut short. */
function quietSlowdown(r: Reader): boolean {
  return r.state === "live" && !!r.read_at && r.next_at <= plus(r.read_at, readWait(r.poll_ms ?? 0, r.quiet, false));
}

/** A game or the setup page asking: the reader made if it's new, and the ask noted, one at a time. */
async function touch(userId: string, a: Ask, now: Date): Promise<Reader> {
  return admin(async (tx) => {
    await tx`insert into public.yt_live_readers (user_id, next_at, updated_at) values (${userId}, ${now}, ${now}) on conflict (user_id) do nothing`;
    const [r] = await tx<Reader[]>`select ${READER(tx)} from public.yt_live_readers where user_id = ${userId} for update`;
    return write(tx, userId, asked(r, a, now), now);
  });
}

/** Takes the reader's turn when it's due and nobody holds it. Whoever gets the row back asks YouTube; everyone else only reads what's there. */
async function claim(userId: string, now: Date): Promise<Reader | null> {
  const [r] = await admin((tx) => tx<Reader[]>`
    update public.yt_live_readers set busy_until = ${plus(now, LEASE_MS)}
    where user_id = ${userId} and next_at <= ${now} and (busy_until is null or busy_until < ${now})
    returning ${READER(tx)}`);
  return r ?? null;
}

/** The day's YouTube LIVE time is used up, the account's or everyone's: nothing is asked until the reset, and reading then picks up from the reset. */
const paused = (who: Who, until: Date): Patch => ({
  state: "paused", detail: null, paused_for: who, paused_until: until, next_at: until, page_token: null, seen_until: new Date(until.getTime() - BACK_MS), streaks: {},
});

/** The channel needs connecting again: nothing of its stream is kept. */
const lost = (why: string, next: Date): Patch => ({ ...OFF_STREAM, ...NOT_PAUSED, state: "reconnect", detail: why, next_at: next });

/** The channel was disconnected, or the streamer picked another, while YouTube was being asked: nothing of what it said is kept, and the next ask starts over. */
const forgotten = (at: Date): Patch => ({ ...OFF_STREAM, ...NOT_PAUSED, state: "idle", detail: null, next_at: at, busy_until: null });

/**
 * The stream went offline, or its chat ended. The reader looks for the
 * next stream a minute after it first ended, and less often the longer
 * it's been, as when it waits for any stream. It keeps which stream that
 * was: one YouTube still lists after it went offline (its auto-stop is
 * off) is only read again on that schedule, rather than every minute while
 * nobody is streaming. Its chat as it went is dropped.
 */
async function endStream(tx: Tx, r: Reader, at: Date): Promise<Patch> {
  await tx`update public.yt_broadcasts set ended_at = coalesce(ended_at, ${at}) where user_id = ${r.user_id} and broadcast_id = ${r.broadcast_id}`;
  // read again because it was still listed: it ended when the reader first saw it end
  const since = r.state === "ended" && r.looking_since ? r.looking_since : at;
  return { ...OFF_CHAT, ...NOT_PAUSED, state: "ended", detail: null, looking_since: since, next_at: plus(at, lookWait(since.getTime(), at.getTime())) };
}

/** Whether the channel the reader asked YouTube with is still connected, waiting for a disconnect under way: what YouTube said through it is kept only then. */
async function stillOn(tx: Tx, ch: LiveChannel): Promise<boolean> {
  const [c] = await tx`select 1 from public.channels where id = ${ch.id} and status <> 'revoked' for share`;
  return !!c;
}

/** Whether a look-now came in the last minute: a stream found again after it went offline is read straight away then. */
const lookedNow = (r: Reader, at: Date) => !!r.nudged_at && at.getTime() - r.nudged_at.getTime() < NUDGE_MS;

/** Whether a Free account's call fits: Free accounts stop at 80% of YouTube Live's share of the day's units. */
async function freeRoom(plan: PlanId, units: number, now: Date): Promise<boolean> {
  if (plan !== "free") return true;
  const u = await usageToday("units", now);
  const { used, cap } = u.kinds.live;
  return !u.full && (cap === null || used + units <= Math.floor(cap * FREE_SHARE));
}

/**
 * The reader's turn, with at most one YouTube call: it looks for the
 * stream while there's no chat, and reads the chat once there is. The
 * call comes out of the account's LIVE time and everyone's first, and when
 * either has run out the reader pauses until the reset instead. Whatever
 * happens, the turn is let go of.
 */
async function step(r: Reader, ch: LiveChannel, plan: PlanId, now: Date, later: () => Promise<Date>): Promise<Reader> {
  const reading = !!(r.chat_id && r.broadcast_id);
  const method: Method = reading ? "liveChatMessages.list" : "liveBroadcasts.list";
  const units = METHODS[method].cost;
  try {
    if (!(await freeRoom(plan, units, now))) return await finish(r, paused("everyone", quotaResetsAt(now)), now);
    let access: string;
    try {
      // a token refresh costs no quota, so it comes before the count
      access = await accessOf(ch.id);
    } catch (err) {
      return await finish(r, await noAccess(err, ch, now), now);
    }
    if (!(await takeLiveUnits(r.user_id, units, now))) return await finish(r, paused("account", quotaResetsAt(now)), now);
    try {
      return reading ? await read(r, ch, access, now, later) : await look(r, ch, access, now, later);
    } catch (err) {
      if (!(err instanceof QuotaWait)) throw err;
      // everyone's LIVE time ran out before the call was made, so the account's units come back
      await giveBackLiveUnits(r.user_id, units, now);
      return await finish(r, paused("everyone", err.until), now);
    }
  } catch (err) {
    const at = await later();
    return finish(r, await refused(err, r, ch, at), at);
  }
}

/**
 * The channel's access, refreshed when it's run out. A refresh Google
 * doesn't answer in time is given up on like an outage, and finishes by
 * itself if Google answers later, so the next turn has the new token.
 */
function accessOf(channelId: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new YouTubeError("Refreshing access: Google didn't answer in time", 0, "timeout")), REFRESH_MS);
  });
  return Promise.race([youtubeAccess(channelId), late]).finally(() => clearTimeout(timer));
}

/** The channel's token couldn't be refreshed: Google refused it (the channel is marked as needing reconnecting, which tells them once), or didn't answer. */
async function noAccess(err: unknown, ch: LiveChannel, now: Date): Promise<Patch> {
  if (err instanceof YouTubeError && (err.status === 400 || err.status === 401)) {
    await markExpired(ch.id);
    return lost(WHY.lost, plus(now, RECONNECT_MS));
  }
  return { state: "error", detail: WHY.down, next_at: plus(now, OUTAGE_MS) };
}

/** How long the reader would usually wait now: a read's wait while there's a chat, a look's while there isn't. */
function usualWait(r: Reader, at: Date): number {
  if (r.chat_id) return readWait(r.poll_ms ?? 0, r.quiet, !!r.hurry_until && r.hurry_until > at);
  return lookWait((r.looking_since ?? at).getTime(), at.getTime());
}

/** What YouTube refusing or failing means for the reader, and when to ask again. */
async function refused(err: unknown, r: Reader, ch: LiveChannel, at: Date): Promise<Patch> {
  if (!(err instanceof YouTubeError)) {
    console.error("youtube live: asking YouTube failed:", err instanceof Error ? err.message : err);
    return { state: "error", detail: WHY.down, next_at: plus(at, OUTAGE_MS) };
  }
  // YouTube itself says the project's quota is used up: everyone waits for the reset
  if (err.quota) return paused("everyone", quotaResetsAt(at));
  if (err.status === 401) {
    await markExpired(ch.id);
    return lost(WHY.lost, plus(at, RECONNECT_MS));
  }
  if (r.chat_id && (err.reason === "liveChatEnded" || err.reason === "liveChatNotFound")) return admin((tx) => endStream(tx, r, at));
  if (err.reason === "liveChatDisabled") {
    return { ...NOT_PAUSED, state: "chat_off", detail: WHY.chatOff, chat_id: null, page_token: null, next_at: plus(at, lookWait((r.looking_since ?? at).getTime(), at.getTime())) };
  }
  // asked too often: twice the usual wait, up to a minute, and never sooner than usual
  if (err.reason === "rateLimitExceeded" || err.status === 429) {
    const wait = usualWait(r, at);
    return { next_at: plus(at, Math.max(wait, Math.min(WAIT_MAX_MS, 2 * wait))) };
  }
  if (err.reason === "insufficientPermissions") return lost(WHY.scope, plus(at, REFUSED_MS));
  if (err.status === 0 || err.status >= 500) return { state: "error", detail: WHY.down, next_at: plus(at, OUTAGE_MS) };
  // anything else: its place in the chat may be what's wrong, so reading picks up from now next time
  return { state: "error", detail: WHY.refused, page_token: null, next_at: plus(at, REFUSED_MS) };
}

/** The stream the reader found, kept with the channel it was found on: how a session that names it is known to be theirs. */
async function heard(tx: Tx, userId: string, channelId: string, b: LiveBroadcast, at: Date): Promise<void> {
  await tx`
    insert into public.yt_broadcasts (user_id, broadcast_id, channel_id, title, started_at, heard_at)
    values (${userId}, ${b.id}, ${channelId}, ${b.title}, ${b.startedAt}, ${at})
    on conflict (user_id, broadcast_id) do update set
      title = excluded.title, started_at = coalesce(yt_broadcasts.started_at, excluded.started_at), ended_at = null, heard_at = excluded.heard_at`;
}

/**
 * Looking for the account's live stream, on its own channel. Found with a
 * chat, it's read on the next ask, counting from a few seconds before it
 * was found. Found with chat off, or not found, it's looked for again on
 * the slow schedule. The stream the reader saw end, still listed because
 * it went offline without ending, is read again on that schedule too, or
 * straight away after a look-now, and only that read says it's back.
 * Nothing is kept for a channel disconnected meanwhile.
 */
async function look(r: Reader, ch: LiveChannel, access: string, now: Date, later: () => Promise<Date>): Promise<Reader> {
  const b = await youtubeActiveBroadcast(access, now);
  const at = await later();
  const again = plus(at, lookWait((r.looking_since ?? at).getTime(), at.getTime()));
  if (!b) return finish(r, { ...OFF_STREAM, ...NOT_PAUSED, state: "not_live", detail: null, next_at: again }, at);
  return admin(async (tx) => {
    if (!(await stillOn(tx, ch))) return write(tx, r.user_id, forgotten(at), at);
    const from = new Date(at.getTime() - BACK_MS);
    if (b.chatId && r.state === "ended" && r.broadcast_id === b.id) {
      return write(tx, r.user_id, { state: "ended", chat_id: b.chatId, seen_until: from, read_at: null, next_at: lookedNow(r, at) ? at : again, busy_until: null }, at);
    }
    await heard(tx, r.user_id, ch.id, b, at);
    const found: Patch = b.chatId
      ? { state: "live", detail: null, chat_id: b.chatId, seen_until: from, read_at: null, next_at: at }
      : { state: "chat_off", detail: b.madeForKids ? WHY.kids : WHY.chatOff, next_at: again };
    return write(tx, r.user_id, { ...OFF_STREAM, ...NOT_PAUSED, ...found, broadcast_id: b.id, busy_until: null }, at);
  });
}

/** Saves what's new for every open game, in order and once each: a message YouTube sends again is handed out once. Returns what was saved. */
async function keep(tx: Tx, r: Reader, fresh: YouTubeRead[], at: Date): Promise<YouTubeRead[]> {
  if (!fresh.length) return [];
  const rows = fresh.map((x, i) => ({ i, id: x.id, combo: x.combo, events: x.events }));
  const saved = await tx<{ message_id: string; combo: number }[]>`
    insert into public.yt_chat_events (user_id, broadcast_id, message_id, combo, events, created_at)
    select ${r.user_id}, ${r.broadcast_id}, m.id, m.combo, m.events, ${at}
    from jsonb_to_recordset(${tx.json(rows)}) as m(i int, id text, combo int, events jsonb)
    order by m.i
    on conflict (user_id, message_id, combo) do nothing
    returning message_id, combo`;
  const took = new Set(saved.map((s) => `${s.message_id}|${s.combo}`));
  return fresh.filter((x) => took.has(`${x.id}|${x.combo}`));
}

/** Adds what was saved to the stream's counts: how many of each, never what anyone paid. */
async function count(tx: Tx, r: Reader, kept: YouTubeRead[], at: Date): Promise<void> {
  const t = tallyOf(kept);
  if (!Object.values(t).some((v) => v > 0)) return;
  await tx`
    update public.yt_broadcasts set super_chats = super_chats + ${t.superChats}, super_stickers = super_stickers + ${t.superStickers},
      jewels = jewels + ${t.jewels}, new_members = new_members + ${t.newMembers}, gifted_members = gifted_members + ${t.giftedMembers}, heard_at = ${at}
    where user_id = ${r.user_id} and broadcast_id = ${r.broadcast_id}`;
}

/**
 * Reading the chat: each message read in order, with the chat's history
 * and anything YouTube sends again dropped, and anything deleted or
 * retracted in the same page never handed out. What's new is saved for
 * every open game in one short transaction, with the stream's counts, and
 * the account's chat older than 10 minutes goes. A stream gone offline, or
 * a chat that ended, sends the reader looking again; one that went offline
 * and is back is read on as before. Nothing is kept when the channel was
 * disconnected meanwhile, or the reader moved on from this stream.
 */
async function read(r: Reader, ch: LiveChannel, access: string, now: Date, later: () => Promise<Date>): Promise<Reader> {
  const page = await youtubeChatPage(access, r.chat_id!, r.page_token, now);
  const at = await later();
  const t = at.getTime();
  const streaks = streaksOf(r.streaks);
  const reads = page.items.map((it) => readMessage(it, streaks, t)).filter((x): x is YouTubeRead => x !== null);
  const gone = new Set(reads.flatMap((x) => (x.control?.deleted ? [x.control.deleted] : [])));
  const over = page.offline || reads.some((x) => x.control?.ended);
  const seen = r.seen_until?.getTime() ?? t - BACK_MS;
  // never anything from more than a minute ago, whatever YouTube sends
  const from = Math.max(seen - OLD_NEWS_MS, t - FRESH_MS);
  const once = new Set<string>();
  const fresh = reads.filter((x) => {
    const k = `${x.id}|${x.combo}`;
    const take = x.events.length > 0 && x.publishedAt > from && !gone.has(x.id) && !once.has(k);
    once.add(k);
    return take;
  });
  const newest = Math.max(seen, ...reads.map((x) => x.publishedAt));
  return admin(async (tx) => {
    // the channel before the reader, in the order a disconnect takes them, so neither waits on the other for good
    if (!(await stillOn(tx, ch))) return write(tx, r.user_id, forgotten(at), at);
    const [still] = await tx`select 1 from public.yt_live_readers where user_id = ${r.user_id} and broadcast_id = ${r.broadcast_id} and chat_id = ${r.chat_id} for update`;
    if (!still) return write(tx, r.user_id, forgotten(at), at);
    const kept = await keep(tx, r, fresh, at);
    await count(tx, r, kept, at);
    // one removed later stands in the game, as YouTube doesn't refund a removed Super Chat, but no game that hasn't had it gets it now
    if (gone.size) await tx`delete from public.yt_chat_events where user_id = ${r.user_id} and message_id = any(${[...gone]})`;
    await tx`delete from public.yt_chat_events where user_id = ${r.user_id} and created_at < ${new Date(t - KEEP_EVENTS_MS)}`;
    if (over) return write(tx, r.user_id, { ...(await endStream(tx, r, at)), busy_until: null }, at);
    // a stream that went offline is back
    if (r.state === "ended") await tx`update public.yt_broadcasts set ended_at = null where user_id = ${r.user_id} and broadcast_id = ${r.broadcast_id}`;
    const quiet = kept.length ? 0 : r.quiet + 1;
    const hurrying = !!r.hurry_until && r.hurry_until > at;
    return write(tx, r.user_id, {
      ...NOT_PAUSED, state: "live", detail: null, page_token: page.next ?? r.page_token, seen_until: new Date(newest), read_at: at,
      poll_ms: page.waitMs || null, quiet, streaks: keepStreaks(streaks, t), next_at: plus(at, readWait(page.waitMs, quiet, hurrying)), busy_until: null,
    }, at);
  });
}

/**
 * What happened since a game's last ask, in order, from the last minute
 * only: a game that fell behind (it lost Hookline for a while) starts again
 * from now, rather than getting old votes and Super Chats in another
 * round. A game's first ask gets nothing and starts from now.
 */
async function eventsAfter(userId: string, after: number | null, now: Date): Promise<{ events: LiveEvent[]; seq: number }> {
  return admin(async (tx) => {
    // the newest first, so nothing saved meanwhile is skipped
    const [top] = await tx<{ seq: string | null }[]>`select max(seq)::text as seq from public.yt_chat_events where user_id = ${userId}`;
    const newest = Number(top?.seq ?? 0);
    if (after === null) return { events: [], seq: newest };
    const rows = await tx<{ seq: string; events: LiveEvent[] }[]>`
      select seq::text as seq, events from public.yt_chat_events
      where user_id = ${userId} and seq > ${after} and created_at > ${new Date(now.getTime() - FRESH_MS)}
      order by seq limit ${MAX_ROWS}`;
    return { events: rows.flatMap((r) => r.events), seq: rows.length ? Number(rows[rows.length - 1].seq) : newest };
  });
}

/** How long a game should wait before asking again: just after the reader's next turn, and a minute while there's nothing to hear. */
function waitOf(state: YouTubeState, nextAt: Date, now: Date): number {
  if (state === "setup" || state === "reconnect" || state === "paused" || state === "off") return WAIT_MAX_MS;
  return Math.min(WAIT_MAX_MS, Math.max(WAIT_MIN_MS, nextAt.getTime() - now.getTime() + WAIT_EXTRA_MS));
}

/** The stream the reader is on, if any: once it ended there's none, though the reader remembers which it was. */
const onStream = (r: Reader) => (r.state === "ended" ? null : r.broadcast_id);

/** Whether YouTube has the stream as made for kids, which is why its chat is off: YouTube's word, never Hookline's. */
const forKids = (r: Reader) => r.state === "chat_off" && r.detail === WHY.kids;

function replyOf(r: Reader, ch: LiveChannel | null, events: LiveEvent[], seq: number, now: Date): YouTubeLiveReply {
  // a reader that hasn't looked yet is looking
  const state: YouTubeState = !ch ? "setup" : r.state === "idle" ? "not_live" : r.state;
  const pause = state === "paused";
  const on = onStream(r);
  return {
    state,
    channel: ch?.name ?? null,
    title: on ? r.title : null,
    broadcast: on,
    until: pause && r.paused_until ? r.paused_until.toISOString() : null,
    who: pause ? r.paused_for : null,
    detail: ch ? r.detail : null,
    kids: !!ch && forKids(r),
    events,
    seq,
    wait: waitOf(state, r.next_at, now),
  };
}

/**
 * A game asking for its YouTube chat, by its key: `after` is the seq it
 * last had (null on its first ask), `go` looks for the stream now, and
 * `hurry` says it's counting down or voting, and `setup` that it's the
 * LIVE page asking rather than a game. The reader takes its turn if it's
 * due, and the reply carries what happened since `after` and when to ask
 * again. Null when the key isn't anyone's. `now` and `later` are for
 * tests: when the ask came in, and when YouTube had answered; the
 * database's clock is used otherwise.
 */
export async function youtubeLiveFor(
  key: string, after: number | null, o: { go?: boolean; hurry?: boolean; setup?: boolean; now?: Date; later?: Date } = {},
): Promise<YouTubeLiveReply | null> {
  const owner = await keyOwner(key);
  if (!owner) return null;
  const now = o.now ?? owner.now;
  const later = o.now ? async () => o.later ?? now : clock;
  const ch = await liveChannel(owner.userId);
  let r = await touch(owner.userId, { first: after === null, go: !!o.go, hurry: !!o.hurry, restart: !!ch?.elsewhere, setup: !!o.setup }, now);
  // the game counts its wait from when it gets the reply: after YouTube answered, for the ask that took the turn
  let end = now;
  const why = ch && reconnectWhy(ch);
  if (ch && why) r = await admin((tx) => write(tx, owner.userId, lost(why, plus(now, RECONNECT_MS)), now));
  else if (ch) {
    const turn = await claim(owner.userId, now);
    if (turn) {
      r = await step(turn, ch, owner.plan, now, later);
      end = await later();
    }
  }
  const { events, seq } = await eventsAfter(owner.userId, after, now);
  return replyOf(r, ch, events, seq, end);
}

/**
 * The streamer picking the channel they go live on: only one of their own
 * YouTube channels that isn't disconnected. Reading starts over on it, and
 * the next ask looks for its stream straight away. Written as the server,
 * since the reader is the server's to write.
 */
export async function chooseLiveChannel(userId: string, channelId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channelId)) return false;
  return admin(async (tx) => {
    const [mine] = await tx`
      select 1 from public.channels where id = ${channelId} and user_id = ${userId} and platform = 'youtube' and status <> 'revoked'`;
    if (!mine) return false;
    await tx`
      insert into public.yt_live_readers (user_id, channel_id) values (${userId}, ${channelId})
      on conflict (user_id) do update set channel_id = excluded.channel_id, state = 'idle', detail = null, broadcast_id = null, chat_id = null,
        page_token = null, seen_until = null, poll_ms = null, quiet = 0, streaks = '{}'::jsonb, paused_until = null, paused_for = null,
        asked_at = null, next_at = now(), updated_at = now()`;
    return true;
  });
}

/** What the LIVE page shows about YouTube Live. */
export type YouTubeLiveSummary = {
  /** what a game would hear, or idle before anything has looked */
  state: YouTubeState | "idle";
  detail: string | null;
  /** YouTube has the stream as made for kids, which is why its chat is off */
  kids: boolean;
  /** the channel the game reads, and its name */
  channelId: string | null;
  channel: string | null;
  title: string | null;
  /** a game asked in the last 90 seconds */
  open: boolean;
  /** how much of today's YouTube LIVE time the account has used, from 0 to 1 */
  used: number;
  until: Date | null;
  who: Who | null;
};

/** YouTube Live for the LIVE page: the reader's state, the channel and stream, whether a game is open, and today's share of the account's LIVE time. */
export async function youtubeLiveOf(userId: string, now?: Date): Promise<YouTubeLiveSummary> {
  const at = now ?? (await clock());
  const [ch, rows, units] = await Promise.all([
    liveChannel(userId),
    asUser(userId, (tx) => tx<Reader[]>`select ${READER(tx)} from public.yt_live_readers where user_id = ${userId}`),
    liveUnitsOf(userId, at),
  ]);
  const r = rows[0] ?? null;
  const why = ch && reconnectWhy(ch);
  const state = !configured().youtubeLive ? "off" : !ch ? "setup" : why ? "reconnect" : (r?.state ?? "idle");
  const pause = state === "paused";
  return {
    state,
    detail: why || r?.detail || null,
    kids: state === "chat_off" && !!r && forKids(r),
    channelId: ch?.id ?? null,
    channel: ch?.name ?? null,
    title: r && onStream(r) ? r.title : null,
    open: !!r?.game_at && at.getTime() - r.game_at.getTime() <= OPEN_MS,
    used: units.most > 0 ? Math.min(1, units.used / units.most) : 1,
    until: pause ? (r?.paused_until ?? null) : null,
    who: pause ? (r?.paused_for ?? null) : null,
  };
}

/**
 * Tidies YouTube Live, run with each LIVE's recap: chat older than 10
 * minutes goes (each read also deletes its own account's), YouTube
 * viewers' names leave saved sessions 30 days after they started, and
 * readers nobody has asked for in an hour go back to idle, keeping the
 * channel they picked.
 */
export async function sweepYouTubeLive(now = new Date()): Promise<string[]> {
  return admin(async (tx) => {
    const chat = await tx`delete from public.yt_chat_events where created_at < ${new Date(now.getTime() - KEEP_EVENTS_MS)}`;
    const names = await tx`
      update public.live_sessions set top_gifters = '[]'::jsonb
      where platform = 'youtube' and top_gifters <> '[]'::jsonb and started_at < ${new Date(now.getTime() - KEEP_NAMES_MS)}
      returning id`;
    const idle = await tx`
      update public.yt_live_readers set state = 'idle', detail = null, broadcast_id = null, chat_id = null, page_token = null, seen_until = null,
        poll_ms = null, quiet = 0, streaks = '{}'::jsonb, hurry_until = null, paused_until = null, paused_for = null, updated_at = ${now}
      where (asked_at is null or asked_at < ${new Date(now.getTime() - IDLE_MS)}) and (busy_until is null or busy_until < ${now})
        and (state <> 'idle' or broadcast_id is not null or streaks <> '{}'::jsonb)
      returning user_id`;
    const out: string[] = [];
    if (chat.count) out.push(`youtube live: ${chat.count} chat rows older than 10 minutes gone`);
    if (names.length) out.push(`youtube live: viewers' names gone from ${names.length} sessions over 30 days old`);
    if (idle.length) out.push(`youtube live: ${idle.length} readers nobody asked for in an hour back to idle`);
    return out;
  });
}
