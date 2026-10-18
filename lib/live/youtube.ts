import type { LiveEvent, LivePlatform, Viewer } from "./events";
import type { Tier } from "./menu";
import { RIVAL_HEAL, RIVAL_POWERS } from "./rivals";
import type { GameId } from "./settings";

/**
 * YouTube Live, for the LIVE games: what each live chat message means to
 * the game, how much each Super Chat colour does, how long to wait between
 * reads of the chat, the menu a YouTube stream shows, and a stream's
 * recap. It's all plain logic, so the server, the game and the tests share
 * it.
 *
 * YouTube's chat has no likes or coins. Viewers send Super Chats, Super
 * Stickers, memberships and Jewels gifts, and each Super Chat colour does
 * more than the one below, the same in every currency: the amount decides
 * the colour, and the colour decides the power. Power is only for the
 * game. Nothing here ever reads an amount or a currency.
 */

/** never read the chat faster than this; YouTube's own pollingIntervalMillis wins when it's longer */
export const READ_FLOOR_MS = 10_000;
/** after QUIET_READS reads in a row find nothing new, the chat is read this often instead, unless a game is hurrying */
export const QUIET_READ_MS = 20_000;
export const QUIET_READS = 3;
/** how long a game's hurry (counting down or voting) keeps the reader at the floor */
export const HURRY_MS = 15_000;
/** a reloaded game, Check now or OBS starting the stream looks for the stream straight away, at most this often */
export const NUDGE_MS = 60_000;
/** a Jewels gift combo whose last step is older than this is over */
export const STREAK_MS = 2 * 60_000;

const MINUTE = 60_000;

/**
 * How long to wait before looking for the stream again, by how long it's
 * been looking: every minute for the first 10 minutes, every 5 minutes up
 * to 3 hours, then every 30 minutes. It never stops, since OBS keeps a
 * game open between streams.
 */
export function lookWait(since: number, now: number): number {
  const t = now - since;
  return t < 10 * MINUTE ? MINUTE : t < 180 * MINUTE ? 5 * MINUTE : 30 * MINUTE;
}

/**
 * How long to wait before reading the chat again: never under 10 seconds
 * or what YouTube asked for, and 20 seconds once 3 reads in a row found
 * nothing new, except while a game counts down or votes.
 */
export function readWait(pollingMs: number, quiet: number, hurrying: boolean): number {
  const floor = Math.max(READ_FLOOR_MS, Number.isFinite(pollingMs) ? pollingMs : 0);
  return quiet >= QUIET_READS && !hurrying ? Math.max(floor, QUIET_READ_MS) : floor;
}

/**
 * Game power for each of YouTube's Super Chat tiers, which are its
 * colours: about 100 for each US dollar at the bottom of that colour, so a
 * Yellow Super Chat does what a 1,000-coin gift does on TikTok. Only for
 * the game, never shown.
 */
export const TIER_POWER = [100, 200, 500, 1000, 2000, 5000, 10_000];
/** each tier's colour, as YouTube names it; tier 7 and every tier above it are red */
export const TIER_NAMES = ["Blue", "Light blue", "Green", "Yellow", "Orange", "Magenta", "Red"];
/** each tier's colour as YouTube draws it, for the menu's chips */
export const TIER_CHIPS = ["#1E88E5", "#00E5FF", "#1DE9B6", "#FFCA28", "#F57C00", "#E91E63", "#E62117"];
/** each red tier above the seventh adds this much */
const RED_STEP = 10_000;
/** a Jewel counts like a TikTok coin */
export const JEWEL_POWER = 1;
/** a new or gifted membership, like a Green Super Chat */
export const MEMBER_POWER = 500;

/** A tier as YouTube sent it, or null when it left it out. */
function tierFrom(v: unknown): number | null {
  const t = num(v);
  return Number.isInteger(t) && t >= 1 ? t : null;
}

/** A tier's power: tier 1's when YouTube leaves it out, and 10,000 more for each red tier above 7. */
export function tierPower(tier: number | null | undefined): number {
  const t = tier && tier >= 1 ? Math.floor(tier) : 1;
  return t <= TIER_POWER.length ? TIER_POWER[t - 1] : TIER_POWER[TIER_POWER.length - 1] + (t - TIER_POWER.length) * RED_STEP;
}

/** A tier's colour as YouTube names it. */
export function tierName(tier: number): string {
  return TIER_NAMES[Math.min(Math.max(1, Math.floor(tier)), TIER_NAMES.length) - 1];
}

/** A tier's chip colour. */
export function tierChip(tier: number): string {
  return TIER_CHIPS[Math.min(Math.max(1, Math.floor(tier)), TIER_CHIPS.length) - 1];
}

/** A Super Chat as the game names it: by its colour, or just "Super Chat" when YouTube didn't say which. */
const superName = (tier: number | null) => (tier ? `${tierName(tier)} Super Chat` : "Super Chat");

/** What the reader heard on a stream, counted as it was handed out: how many of each, never what anyone paid. */
export type Tally = { superChats: number; superStickers: number; jewels: number; newMembers: number; giftedMembers: number };

/** Jewels gift combos so far, by viewer and gift ('yt:UC…|Gift name'): the count handed out, and when its last step was sent (epoch ms). */
export type Streaks = Record<string, { n: number; at: number }>;

/**
 * One chat message, read: its id and when YouTube says it was sent, a
 * Jewels gift's combo count (0 for everything else), what the game should
 * do with it, what it adds to the stream's counts, and whether it removes
 * another message or ends the chat.
 */
export type YouTubeRead = {
  id: string;
  publishedAt: number;
  combo: number;
  events: LiveEvent[];
  tally: Partial<Tally>;
  control?: { deleted?: string; ended?: true };
};

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** The first `n` letters of a string, never splitting one. */
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

/**
 * Who sent a message: their channel, as an id of its own kind so it never
 * meets a TikTok id, their name without YouTube's @, and their picture.
 * Null when YouTube didn't say whose channel it was.
 */
function authorOf(snippet: Obj, author: Obj): Viewer | null {
  const channel = str(author.channelId) ?? str(snippet.authorChannelId);
  if (!channel) return null;
  const name = cut((str(author.displayName) ?? "").trim().replace(/^@/, ""), 40) || "someone";
  return { id: `yt:${channel}`, name, avatar: str(author.profileImageUrl) ?? undefined };
}

/**
 * What's new in a Jewels gift combo: only the rise since the count last
 * handed out, by viewer and gift, whether YouTube sends one message again
 * with a higher count or a new message for each step. A count that doesn't
 * rise, sent later, starts a new combo; one that isn't later is a step
 * already seen. A combo quiet for two minutes is over.
 */
function comboStep(was: Streaks[string] | undefined, count: number, at: number): { pay: number; next: Streaks[string] } {
  if (!was || at - was.at > STREAK_MS) return { pay: count, next: { n: count, at } };
  if (count > was.n) return { pay: count - was.n, next: { n: count, at: Math.max(at, was.at) } };
  if (at > was.at) return { pay: count, next: { n: count, at } };
  return { pay: 0, next: was };
}

/** message kinds YouTube documents that the game has no use for: polls, bans, members-only mode, and a gifted membership's recipient (the gifter's message counts it) */
const UNUSED = new Set(["tombstone", "pollEvent", "giftMembershipReceivedEvent", "userBannedEvent", "sponsorOnlyModeStartedEvent", "sponsorOnlyModeEndedEvent", "fanFundingEvent"]);
const unknown = new Set<string>();

/** A kind of message nobody has told the game about: said once, so a change on YouTube's side shows in the logs. */
function noteUnknown(type: string) {
  if (UNUSED.has(type) || unknown.has(type)) return;
  unknown.add(type);
  console.warn(`youtube live: a kind of chat message the game doesn't read: ${type || "(none)"}`);
}

/**
 * One live chat message, as YouTube's liveChatMessages.list sends it, read
 * for the game. A Super Chat's comment comes before its power, so '2' in a
 * Super Chat puts its sender on blue first. Power comes from the Super
 * Chat's colour, never its amount. Jewels combos pay only what's new,
 * kept in `streaks` across reads. Null for something that isn't a message.
 */
export function readMessage(raw: unknown, streaks: Streaks, now: number): YouTubeRead | null {
  const m = obj(raw);
  const s = obj(m?.snippet);
  const id = str(m?.id);
  if (!m || !s || !id) return null;
  const type = str(s.type) ?? "";
  const sent = Date.parse(str(s.publishedAt) ?? "");
  const read: YouTubeRead = { id, publishedAt: Number.isFinite(sent) ? sent : now, combo: 0, events: [], tally: {} };

  // what a message does to the chat itself, whoever sent it
  if (type === "messageDeletedEvent" || type === "messageRetractedEvent") {
    const gone = str(obj(s.messageDeletedDetails)?.deletedMessageId) ?? str(obj(s.messageRetractedDetails)?.retractedMessageId);
    return gone ? { ...read, control: { deleted: gone } } : read;
  }
  if (type === "chatEndedEvent") return { ...read, control: { ended: true } };

  const viewer = authorOf(s, obj(m.authorDetails) ?? {});
  if (!viewer) return read;
  const said = (text: unknown): LiveEvent[] => {
    const t = str(text);
    return t ? [{ kind: "chat", viewer, text: cut(t.trim(), 200) }] : [];
  };
  const gift = (name: string, coins: number, count = 1): LiveEvent => ({ kind: "gift", viewer, gift: name, coins, count });

  switch (type) {
    case "textMessageEvent":
      return { ...read, events: said(obj(s.textMessageDetails)?.messageText ?? s.displayMessage) };
    case "superChatEvent": {
      const d = obj(s.superChatDetails) ?? {};
      const tier = tierFrom(d.tier);
      return { ...read, events: [...said(d.userComment), gift(superName(tier), tierPower(tier))], tally: { superChats: 1 } };
    }
    case "superStickerEvent":
      return { ...read, events: [gift("Super Sticker", tierPower(tierFrom(obj(s.superStickerDetails)?.tier)))], tally: { superStickers: 1 } };
    case "newSponsorEvent": {
      // a member moving up a level is a membership bought, but not a new member
      const upgrade = obj(s.newSponsorDetails)?.isUpgrade === true;
      return { ...read, events: [gift(upgrade ? "Membership upgrade" : "New member", MEMBER_POWER)], tally: upgrade ? {} : { newMembers: 1 } };
    }
    case "memberMilestoneChatEvent":
      return { ...read, events: said(obj(s.memberMilestoneChatDetails)?.userComment) };
    case "membershipGiftingEvent": {
      const n = Math.min(50, Math.max(1, Math.floor(num(obj(s.membershipGiftingDetails)?.giftMembershipsCount))));
      return { ...read, events: [gift("Gifted membership", MEMBER_POWER, n)], tally: { giftedMembers: n } };
    }
    case "giftEvent":
      return jewelsGift(read, viewer, obj(s.giftDetails) ?? {}, streaks);
    default:
      noteUnknown(type);
      return read;
  }
}

/** A Jewels gift, from its giftDetails: its own name, a Jewel's power for each of its Jewels, as many as are new in its combo. */
function jewelsGift(read: YouTubeRead, viewer: Viewer, d: Obj, streaks: Streaks): YouTubeRead {
  const name = cut(str(d.giftName)?.trim() ?? "Gift", 40);
  const jewels = Math.floor(num(d.jewelsAmount));
  const combo = Math.max(1, Math.floor(num(d.comboCount)));
  if (jewels <= 0) return { ...read, combo };
  const key = `${viewer.id}|${name}`;
  const step = comboStep(streaks[key], combo, read.publishedAt);
  streaks[key] = step.next;
  if (step.pay <= 0) return { ...read, combo };
  return { ...read, combo, events: [{ kind: "gift", viewer, gift: name, coins: jewels * JEWEL_POWER, count: step.pay }], tally: { jewels: jewels * step.pay } };
}

/** The combos still going: one whose last step is more than two minutes old is over. */
export function keepStreaks(streaks: Streaks, now: number): Streaks {
  return Object.fromEntries(Object.entries(streaks).filter(([, s]) => now - s.at <= STREAK_MS));
}

/** Streaks as they were saved, keeping only entries that make sense. */
export function streaksOf(raw: unknown): Streaks {
  const o = obj(raw) ?? {};
  const out: Streaks = {};
  for (const [k, v] of Object.entries(o)) {
    const e = obj(v);
    if (e && Number.isFinite(e.n) && Number.isFinite(e.at)) out[k] = { n: e.n as number, at: e.at as number };
  }
  return out;
}

/** A page's counts added up. */
export function tallyOf(reads: Pick<YouTubeRead, "tally">[]): Tally {
  const t: Tally = { superChats: 0, superStickers: 0, jewels: 0, newMembers: 0, giftedMembers: 0 };
  for (const r of reads) for (const k of Object.keys(t) as (keyof Tally)[]) t[k] += r.tally[k] ?? 0;
  return t;
}

/** What the game heard on several streams, added up. */
export const addTallies = (ts: Tally[]): Tally => tallyOf(ts.map((tally) => ({ tally })));

/** A menu item set off by a Super Chat of this tier: named for its colour and drawn with its chip, never with a price. */
function superItem(tier: number): Pick<Tier, "gift" | "min" | "price" | "unit" | "chip"> {
  const power = tierPower(tier);
  return { gift: `${tierName(tier)} Super Chat`, min: power, price: power, unit: "super", chip: tierChip(tier) };
}

/** A menu item set off by any Jewels gifts worth at least `min`: drawn as a threshold, since no one gift is claimed to cost that. */
function jewelsItem(min: number): Pick<Tier, "gift" | "min" | "price" | "unit"> {
  return { gift: "Gifts", min, price: min, unit: "jewels" };
}

/** what sets off each item of a game's menu on YouTube: Jewels gifts worth 1, 5 or 20, then a Blue, Light blue or Yellow Super Chat */
const YT_ITEMS = [jewelsItem(1), jewelsItem(5), jewelsItem(20), superItem(1), superItem(2), superItem(4)];
/** where each item of a YouTube menu starts, in power */
export const YT_PRICES = YT_ITEMS.map((t) => t.min);

/**
 * A game's menu on YouTube: the same six things in the same order, set off
 * by Jewels gifts for the three small ones and by Super Chat colours for
 * the big ones. So a Blue Super Chat sets off what TikTok's 99-coin gift
 * does, Light blue and Green what its 299 does, and Yellow and up the top
 * item, with more of it for the colours above. It works the same in every
 * currency. The streamer's own TikTok gift menu doesn't apply.
 */
export function youtubeMenu(menu: Tier[]): Tier[] {
  return menu.map((t, i) => (YT_ITEMS[i] ? { ...t, ...YT_ITEMS[i] } : t));
}

/**
 * Rivals' menu on YouTube, the same for both sides, since nothing sent on
 * YouTube says which side it's for: the chat picks the side (a Super
 * Chat's own comment too). Jewels gifts heal it, then a Blue Super Chat
 * brings a ball, Light blue Rage 2X and Green meteors.
 */
export const YT_SIDE_MENU: Tier[] = [
  { ...RIVAL_HEAL, ...jewelsItem(1), line: "Jewels gifts heal your side, 1 HP for every Jewel. A big one sets off the power it reaches" },
  ...RIVAL_POWERS.map((p, i) => ({ ...p, ...superItem(i + 1) })),
];

/** What the reader is doing, as a game hears it. */
export type YouTubeState = "off" | "setup" | "reconnect" | "not_live" | "live" | "chat_off" | "ended" | "paused" | "error";

/** Hookline's answer to a game asking for its YouTube chat (GET /api/live/youtube). */
export type YouTubeLiveReply = {
  state: YouTubeState;
  /** the channel's name */
  channel: string | null;
  /** the stream's title, and its video id */
  title: string | null;
  broadcast: string | null;
  /** while paused: until when (ISO), and whose YouTube LIVE time ran out */
  until: string | null;
  who: "account" | "everyone" | null;
  /** a plain reason, shown beside the game */
  detail: string | null;
  /** YouTube has the stream as made for kids, which is why its chat is off: YouTube's own word, only ever said as a fact */
  kids: boolean;
  /** what happened since the game last asked, in order */
  events: LiveEvent[];
  /** pass back as `after` */
  seq: number;
  /** how long to wait before asking again, in ms */
  wait: number;
};

/** What a game shows about its YouTube chat: the reply without its events, or `gone` once its key has been replaced. */
export type YouTubeStatus = Omit<YouTubeLiveReply, "events" | "seq" | "wait"> | { state: "gone" };

/**
 * The LIVE page's "Try it with the test panel" address. With the
 * streamer's key a YouTube game is the real thing, reading their stream's
 * chat, so only someone shown YouTube's setup (`canPlay`) gets it; anyone
 * else gets the game in YouTube's look, with nothing read. TikTok's is the
 * streamer's own game with no LIVE to hear.
 */
export function tryItHref(key: string, side: LivePlatform, canPlay: boolean, game: GameId): string {
  if (side === "tiktok") return `/live/play?key=${key}`;
  return canPlay ? `/live/play?key=${key}&src=youtube` : `/live/play?src=youtube&game=${game}`;
}

const n = (v: number) => v.toLocaleString("en-US");

/**
 * A YouTube LIVE's recap notification, once it's over. Its counts are what
 * the game heard on the stream, never the session's and never what anyone
 * paid, and like every recap it names no viewer. `title` is the stream's,
 * for a session that heard one; `streams` how many it heard. `earnings`
 * when Hookline reads their channel's Super Chats, so Earnings gets what
 * viewers paid. It never says when, since a read can wait for YouTube's
 * quota.
 */
export function youtubeRecap(s: { rounds: number; peakPlayers: number; superChats: number; title: string | null; streams?: number; earnings?: boolean }): { title: string; body: string } {
  const rounds = `${n(s.rounds)} round${s.rounds === 1 ? "" : "s"}`;
  const where = s.title ? `"${s.title}"` : (s.streams ?? 1) > 1 ? "your streams" : "your stream";
  const paid = s.earnings ? " What viewers paid shows in Earnings, from YouTube." : "";
  const heard = s.superChats > 0 ? ` The game heard ${n(s.superChats)} Super Chat${s.superChats === 1 ? "" : "s"} on ${where}.${paid}` : "";
  return { title: `LIVE recap on YouTube: ${rounds}`, body: `${n(s.peakPlayers)} playing at once.${heard}` };
}
