import type { LiveEvent } from "./events";
import type { Show } from "./show";

/**
 * Whose LIVE a session's coins came from. The game can be pointed at any
 * TikTok LIVE, so coins only count as the streamer's when the game heard
 * their own LIVE: the bridge says which account it's connected to, the
 * game reports every LIVE it heard real viewers on, and the server checks
 * those against the TikTok account the streamer connected (TikTok itself
 * says what its username is). TikFinity doesn't say whose LIVE it is, so
 * a session heard through it, even only partly (say the bridge was switched
 * off halfway), can't be checked and doesn't count.
 *
 * The coins are what viewers sent, never what TikTok pays the streamer,
 * so they're always "gift coins seen", never earnings.
 */

/** The most LIVEs one session reports; more than this and something's wrong anyway. */
export const HEARD_MAX = 10;

/**
 * What a session reports about whose LIVE it heard: the LIVEs its source
 * named, and whether any of it came from a source that didn't say. The
 * server can't tell "didn't say" from "nothing new" in a list, so it's
 * said out loud, and once said it sticks.
 */
export type Heard = { heard: string[]; unknown: boolean };

/**
 * The LIVEs each session heard real viewers on, by session id: noted as
 * events come in, with the account the source said it was connected to at
 * that moment, or none when it didn't say.
 */
export class HeardLog {
  private readonly by = new Map<string, { users: Set<string>; unknown: boolean }>();

  note(sessionId: string, user: string | null) {
    let h = this.by.get(sessionId);
    if (!h) this.by.set(sessionId, (h = { users: new Set(), unknown: false }));
    if (user) h.users.add(user);
    else h.unknown = true;
  }

  /** What to report for a session: the LIVEs it heard, and whether any of it came from a source that didn't say whose LIVE it was. */
  of(sessionId: string): Heard {
    const h = this.by.get(sessionId);
    return { heard: h ? [...h.users].slice(0, HEARD_MAX) : [], unknown: !!h?.unknown };
  }
}

/**
 * Whether the log notes an event: anything a real viewer does, except
 * joining. A join never starts a session, so the first joins of the next
 * LIVE would be filed under the last one, and could unverify it for good.
 */
export function notesHeard(e: LiveEvent): boolean {
  return !e.viewer.pretend && e.kind !== "join";
}

/**
 * The session an event the show has just handled is noted under: the one
 * now going, for anything notesHeard takes. Null after 20 quiet minutes,
 * until something starts the next session: a hello, a second follow or a
 * second share doesn't, and noted under the last one, it could unverify
 * that LIVE for good.
 */
export function heardIn(show: Pick<Show, "stats" | "liveNow">, e: LiveEvent): string | null {
  return notesHeard(e) && show.liveNow() ? show.stats.id : null;
}

/** Whether a session counts as the streamer's: it heard at least one LIVE, and every one was theirs. */
export function ownLive(heard: string[], mine: string[]): boolean {
  const own = new Set(mine.map((u) => u.toLowerCase()));
  return heard.length > 0 && heard.every((u) => own.has(u.toLowerCase()));
}

const at = (users: string[]) => users.map((u) => `@${u}`).join(", ");

/** What to say while Hookline doesn't ask TikTok for usernames yet, so no LIVE can be checked. */
export const NO_USERNAMES = "Hookline can't check TikTok usernames yet, so no LIVE counts in Earnings for now.";

/**
 * Why a session doesn't count, in a sentence, or null when it does.
 * `checking` is false while Hookline doesn't ask TikTok for usernames yet
 * (TIKTOK_PROFILE), when connecting TikTok wouldn't make anything count.
 */
export function whyNotCounted(s: { verified: boolean; heard: string[]; unknown?: boolean }, mine: string[], checking = true): string | null {
  if (s.verified) return null;
  if (!checking && !mine.length) return `${s.heard.length ? `The game heard ${at(s.heard)}, but ` : ""}Hookline can't check TikTok usernames yet.`;
  if (!s.heard.length) return "The game couldn't tell whose LIVE this was. TikFinity doesn't say; Hookline Bridge does.";
  const others = s.heard.filter((u) => !mine.includes(u));
  if (mine.length && others.length) return `The game heard ${at(others)}, not your connected TikTok (${at(mine)}).`;
  if (s.unknown) return "Part of it came through TikFinity, which doesn't say whose LIVE it is, so the game couldn't tell it was all yours.";
  if (!mine.length) return `The game heard ${at(s.heard)}. Connect that TikTok in Settings and this LIVE counts.`;
  return "This LIVE hasn't been checked against your TikTok yet.";
}

const n = (v: number) => v.toLocaleString("en-US");

/**
 * A LIVE's recap notification, once it's over. A LIVE that isn't verified
 * as theirs says so, and why. It names no viewer, so supporters' names stay
 * only with the session they gifted in.
 */
export function recapNote(s: { rounds: number; coins: number; peakPlayers: number; verified: boolean; heard: string[]; unknown?: boolean }, mine: string[], checking = true): { title: string; body: string } {
  const rounds = `${n(s.rounds)} round${s.rounds === 1 ? "" : "s"}`;
  if (s.verified) return { title: `LIVE recap: ${rounds}, ${n(s.coins)} gift coins seen`, body: `${n(s.peakPlayers)} playing at once. Your recap card is ready.` };
  const why = whyNotCounted(s, mine, checking)!;
  return { title: `LIVE recap: ${rounds}, not verified`, body: `${why} Its ${n(s.coins)} gift coins seen don't count in Earnings.` };
}
