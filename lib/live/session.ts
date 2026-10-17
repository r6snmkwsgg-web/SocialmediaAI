import { z } from "zod";
import { HEARD_MAX, type Heard } from "./proof";
import { GAME_IDS } from "./settings";
import type { Show } from "./show";

/**
 * A LIVE session's numbers as the game sends them to be saved: every half
 * minute while it runs, and once more as it closes. Each send is the
 * whole session so far, so a lost one costs nothing.
 */

/** a stretch this long with nothing from a real viewer ends a session; the next thing starts a new one */
export const SESSION_IDLE = 20 * 60_000;

/** The LIVE's over: nothing from a real viewer since `lastAt` for SESSION_IDLE. The game, the server and the pages all go by this. */
export function over(lastAt: Date | number, now: Date | number = Date.now()): boolean {
  return +now - +lastAt > SESSION_IDLE;
}

export const sessionSchema = z.object({
  /** the streamer's overlay key: whose session this is */
  key: z.string().min(16).max(64).regex(/^[\w-]+$/),
  id: z.uuid(),
  game: z.enum(GAME_IDS),
  /** when a real viewer first and last did something, epoch ms */
  startedAt: z.number().int().positive(),
  lastAt: z.number().int().positive(),
  rounds: z.number().int().min(0).max(100_000),
  coins: z.number().int().min(0).max(1_000_000_000),
  peakPlayers: z.number().int().min(0).max(1_000_000),
  topGifters: z.array(z.object({ id: z.string().max(64), name: z.string().max(64), coins: z.number().int().min(0) })).max(5),
  /** the TikTok LIVEs it heard real viewers on, as the bridge named them */
  heard: z.array(z.string().regex(/^[a-z0-9._]{2,24}$/)).max(HEARD_MAX).default([]),
  /** some of it came from a source that didn't say whose LIVE it was (TikFinity), so it can't count */
  unknown: z.boolean().default(false),
});

export type SessionPayload = z.infer<typeof sessionSchema>;

/** The session so far, ready to send, with the LIVEs it heard; null until a real viewer has done something. */
export function sessionPayload(show: Show, key: string, { heard, unknown }: Heard = { heard: [], unknown: false }): SessionPayload | null {
  const s = show.stats;
  if (s.firstAt === null || s.lastAt === null) return null;
  return {
    key,
    id: s.id,
    game: show.settings.game,
    startedAt: s.firstAt,
    lastAt: s.lastAt,
    rounds: s.rounds,
    coins: s.coins,
    peakPlayers: s.peakPlayers,
    topGifters: show.topGifters(5).map((g) => ({ id: g.viewer.id.slice(0, 64), name: g.viewer.name.slice(0, 64), coins: g.coins })),
    heard: heard.slice(0, HEARD_MAX),
    unknown,
  };
}

/** A session from the game is believable: it happened recently, and in order. */
export function plausible(p: Pick<SessionPayload, "startedAt" | "lastAt">, now = Date.now()): boolean {
  const week = 7 * 24 * 3600_000;
  return p.startedAt > now - week && p.lastAt >= p.startedAt && p.lastAt <= now + 5 * 60_000;
}

/** How long a LIVE ran, the way the app shows it: 45m, or 1h 12m. */
export function lasted(s: { startedAt: Date; lastAt: Date }): string {
  const min = Math.max(1, Math.round((s.lastAt.getTime() - s.startedAt.getTime()) / 60000));
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}
