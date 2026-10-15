import { z } from "zod";
import { GAME_IDS } from "./settings";
import type { Show } from "./show";

/**
 * A LIVE session's numbers as the game sends them to be saved: every half
 * minute while it runs, and once more as it closes. Each send is the
 * whole session so far, so a lost one costs nothing.
 */

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
});

export type SessionPayload = z.infer<typeof sessionSchema>;

/** The session so far, ready to send; null until a real viewer has done something. */
export function sessionPayload(show: Show, key: string): SessionPayload | null {
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
  };
}

/** A session from the game is believable: it happened recently, and in order. */
export function plausible(p: SessionPayload, now = Date.now()): boolean {
  const week = 7 * 24 * 3600_000;
  return p.startedAt > now - week && p.lastAt >= p.startedAt && p.lastAt <= now + 5 * 60_000;
}
