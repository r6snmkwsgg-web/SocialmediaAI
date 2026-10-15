/**
 * What happens on a TikTok LIVE, in one shape, whichever tool heard it.
 *
 * Two kinds of message come in. Hookline's own bridge uses
 * tiktok-live-connector 2.x, which nests things: `user.nickname`,
 * `giftDetails.diamondCount`. TikFinity, and older tools built on the 1.x
 * connector, send it flat: `nickname`, `diamondCount`. Both arrive as
 * `{ event, data }`. This reads either and says what happened.
 *
 * Gift streaks need care. A run of roses arrives as a string of messages
 * whose `repeatCount` keeps climbing (1, 2, 5, 9…) and then one that says
 * the streak is over. Counting each message would pay out 1+2+5+9; this
 * pays out only what's new each time, so ten roses are worth ten.
 */

export type Viewer = {
  id: string;
  name: string;
  avatar?: string;
  /** a demo or test-panel viewer: plays like anyone, never counts in the session's numbers */
  pretend?: boolean;
};

export type LiveEvent =
  /** `coins` is what one of the gift costs; `count` is how many just arrived */
  | { kind: "gift"; viewer: Viewer; gift: string; coins: number; count: number }
  | { kind: "chat"; viewer: Viewer; text: string }
  | { kind: "like"; viewer: Viewer; count: number }
  | { kind: "follow"; viewer: Viewer }
  | { kind: "share"; viewer: Viewer }
  | { kind: "join"; viewer: Viewer };

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v || undefined;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return undefined;
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "") return Number(v) || 0;
  return 0;
}

function first(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return undefined;
}

/** a picture URL from any of the shapes TikTok uses for one */
function picture(v: unknown): string | undefined {
  if (typeof v === "string") return v || undefined;
  const o = obj(v);
  if (!o) return undefined;
  const urls = o.urls ?? o.url ?? o.urlList ?? o.url_list;
  if (Array.isArray(urls)) return urls.find((u): u is string => typeof u === "string" && u.length > 0);
  return undefined;
}

/** Who did it, from either shape. Null if there's no way to tell. */
export function viewerOf(d: Obj): Viewer | null {
  const u = obj(d.user) ?? {};
  const details = obj(d.userDetails) ?? {};
  const id = first(u.userId, u.uniqueId, u.displayId, d.userId, d.uniqueId);
  if (!id) return null;
  const name = first(u.nickname, u.uniqueId, u.displayId, d.nickname, d.uniqueId) ?? "someone";
  const pics = details.profilePictureUrls;
  const avatar =
    picture(u.profilePicture) ??
    picture(u.avatarThumb) ??
    first(d.profilePictureUrl) ??
    (Array.isArray(pics) ? first(...pics) : undefined);
  return { id, name: name.slice(0, 40), avatar };
}

/** The streak a viewer is partway through, per gift: what's been paid out so far. */
export type Streaks = Map<string, number>;

/**
 * One raw message in, at most one event out. `name` is the connector's
 * event name (gift, chat, like, social, follow, share, member).
 */
export function normalize(name: string, raw: unknown, streaks: Streaks): LiveEvent | null {
  const d = obj(raw);
  if (!d) return null;
  const viewer = viewerOf(d);
  if (!viewer) return null;
  const ev = name.toLowerCase();

  if (ev === "gift") {
    const g = obj(d.giftDetails) ?? obj(d.gift) ?? {};
    const giftId = first(d.giftId, g.id, g.giftId) ?? "?";
    const gift = first(g.giftName, g.name, g.describe, d.giftName, d.describe) ?? "Gift";
    const coins = num(g.diamondCount ?? g.diamond_count ?? d.diamondCount);
    const type = num(g.giftType ?? g.type ?? d.giftType);
    const total = Math.max(1, num(d.repeatCount ?? d.comboCount ?? 1));
    const ended = d.repeatEnd === true || num(d.repeatEnd) === 1;
    if (coins <= 0) return null;

    if (type !== 1) return { kind: "gift", viewer, gift, coins, count: total };
    // a streak: pay out only what's new since the last message about it
    const key = `${viewer.id}:${giftId}`;
    const paid = streaks.get(key) ?? 0;
    // a count lower than before means a fresh streak whose ending we missed
    const count = total >= paid ? total - paid : total;
    if (ended) streaks.delete(key);
    else streaks.set(key, total);
    return count > 0 ? { kind: "gift", viewer, gift, coins, count } : null;
  }

  if (ev === "chat" || ev === "comment") {
    const text = first(d.comment, d.content, d.text);
    return text ? { kind: "chat", viewer, text: text.slice(0, 200) } : null;
  }

  if (ev === "like") {
    const count = Math.max(1, num(d.likeCount ?? d.count ?? 1));
    return { kind: "like", viewer, count };
  }

  if (ev === "follow") return { kind: "follow", viewer };
  if (ev === "share") return { kind: "share", viewer };
  if (ev === "member" || ev === "join") return { kind: "join", viewer };

  if (ev === "social") {
    // the 1.x connector reports follows and shares as "social", told apart by displayType
    const type = first(d.displayType, obj(obj(d.common)?.displayText)?.key) ?? "";
    if (type.includes("follow")) return { kind: "follow", viewer };
    if (type.includes("share")) return { kind: "share", viewer };
    return null;
  }

  return null;
}

/**
 * A message off a WebSocket, as text. Takes `{ event, data }` (TikFinity,
 * Hookline's bridge) and a few near relatives, and ignores anything else.
 * Hookline's bridge can also send an event it already worked out.
 */
export function parseMessage(text: string, streaks: Streaks): LiveEvent | null {
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return null;
  }
  const m = obj(msg);
  if (!m) return null;
  const ready = obj(m.hookline);
  if (ready && typeof ready.kind === "string" && obj(ready.viewer)) return ready as unknown as LiveEvent;
  const name = first(m.event, m.type, m.eventName);
  if (!name) return null;
  return normalize(name, m.data ?? m.payload ?? m, streaks);
}
