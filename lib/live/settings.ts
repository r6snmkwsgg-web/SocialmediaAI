import { z } from "zod";
import { ABILITY_IDS, type AbilityId } from "../battle/abilities";
import { validGifts } from "./menu";
import { NAME_MAX, ownRivalryProblem, RIVAL_GROUP_IDS, RIVAL_GROUPS, validSideGifts } from "./rivals";

/**
 * A streamer's settings for their live game, saved on their account and
 * read by the game when it opens. Everything has a default, so a game
 * with no account behind it (the demo, a first try) still runs.
 */

export const GAME_IDS = ["battle", "race", "royale", "rivals"] as const;
export type GameId = (typeof GAME_IDS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const gift = z.object({ name: z.string().trim().min(1).max(20), coins: z.number().int().min(1).max(100_000) });

export const liveSettingsSchema = z.object({
  game: z.enum(GAME_IDS),
  /** the streamer's own six gifts, cheapest first; null keeps the game's own */
  gifts: z
    .array(z.object({ name: z.string().trim().min(1).max(20), coins: z.number().int().min(1).max(100_000) }))
    .length(6)
    .nullable(),
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
  /** Rivals: which of Hookline's rivalries come up, the streamer's own, and each side's gifts (null keeps Hookline's) */
  rivals: z.object({
    groups: z.array(z.enum(RIVAL_GROUP_IDS)).max(RIVAL_GROUP_IDS.length),
    own: z.array(z.object({ red: z.string().trim().max(NAME_MAX), blue: z.string().trim().max(NAME_MAX) })).max(12),
    gifts: z.object({ red: z.array(gift).length(3), blue: z.array(gift).length(3) }).nullable(),
  }),
});

export type LiveSettings = z.infer<typeof liveSettingsSchema>;

/** the five that read at a glance on a phone; the others make a mess live */
export const LIVE_ABILITIES: AbilityId[] = ["spike", "sword", "grow", "speed", "heal"];

export const DEFAULT_SETTINGS: LiveSettings = {
  game: "battle",
  gifts: null,
  roundSeconds: 90,
  teams: [
    { name: "Red", color: "#FF3B30" },
    { name: "Blue", color: "#0A84FF" },
  ],
  volume: 0.7,
  abilities: LIVE_ABILITIES,
  vote: true,
  rivals: { groups: RIVAL_GROUPS.filter((g) => g.on).map((g) => g.id), own: [], gifts: null },
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
  // a menu has to start at 1 coin and climb, or the game's own stands
  if (s.gifts && !validGifts(s.gifts)) s.gifts = null;
  // rivalries Hookline won't run are dropped, and side gifts that don't make a game fall back to Hookline's
  s.rivals = {
    ...s.rivals,
    own: s.rivals.own.filter((r) => ownRivalryProblem(r.red, r.blue) === null),
    gifts: validSideGifts(s.rivals.gifts) ? s.rivals.gifts : null,
  };
  return s;
}

/** What a plan allows: games it doesn't include fall back to the battle, and only some plans get their own gifts. */
export function allowedBy(s: LiveSettings, plan: { games: readonly GameId[]; customMenus: boolean }): LiveSettings {
  return {
    ...s,
    game: plan.games.includes(s.game) ? s.game : "battle",
    gifts: plan.customMenus ? s.gifts : null,
    rivals: plan.customMenus ? s.rivals : { ...s.rivals, gifts: null },
  };
}
