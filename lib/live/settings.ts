import { z } from "zod";
import { ABILITY_IDS, type AbilityId } from "../battle/abilities";
import { DEFAULT_PRICES } from "./menu";

/**
 * A streamer's settings for their live game, saved on their account and
 * read by the game when it opens. Everything has a default, so a game
 * with no account behind it (the demo, a first try) still runs.
 */

export const GAME_IDS = ["battle", "race", "royale"] as const;
export type GameId = (typeof GAME_IDS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const liveSettingsSchema = z.object({
  game: z.enum(GAME_IDS),
  /** the six menu prices, cheapest first; null keeps the game's own */
  prices: z.array(z.number().int().min(1).max(100_000)).length(6).nullable(),
  /** the longest a round runs before it's decided on what's left */
  roundSeconds: z.number().int().min(30).max(300),
  teams: z
    .array(z.object({ name: z.string().trim().min(1).max(12), color: hex }))
    .length(2),
  volume: z.number().min(0).max(1),
  /** the abilities a battle's champions are drawn from */
  abilities: z.array(z.enum(ABILITY_IDS)).min(2),
  /** a vote for what's next, between rounds */
  vote: z.boolean(),
});

export type LiveSettings = z.infer<typeof liveSettingsSchema>;

/** the five that read at a glance on a phone; the others make a mess live */
export const LIVE_ABILITIES: AbilityId[] = ["spike", "sword", "grow", "speed", "heal"];

export const DEFAULT_SETTINGS: LiveSettings = {
  game: "battle",
  prices: null,
  roundSeconds: 90,
  teams: [
    { name: "Red", color: "#FF3B30" },
    { name: "Blue", color: "#0A84FF" },
  ],
  volume: 0.7,
  abilities: LIVE_ABILITIES,
  vote: true,
};

/** Settings from anywhere (the database, a URL): whatever's valid, defaults for the rest. */
export function parseSettings(raw: unknown): LiveSettings {
  const base = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return base;
  const out: Record<string, unknown> = { ...base };
  const shape = liveSettingsSchema.shape;
  for (const key of Object.keys(shape) as (keyof LiveSettings)[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === undefined) continue;
    const r = shape[key].safeParse(v);
    if (r.success) out[key] = r.data;
  }
  const s = out as LiveSettings;
  // prices must climb from 1, or the game's own stand
  if (s.prices && !(s.prices[0] === 1 && s.prices.every((p, i) => i === 0 || p > s.prices![i - 1]))) s.prices = null;
  return s;
}

export { DEFAULT_PRICES };
