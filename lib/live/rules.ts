import type { AbilityId } from "../battle/abilities";

/**
 * The whole game, as a viewer has to understand it, is three rules:
 *
 *   1. Type 1 or 2 to join RED or BLUE.
 *   2. Send a gift and your ball joins the fight, with your face on it.
 *      Send more and it grows.
 *   3. Likes heal your team.
 *
 * Everything here is in service of keeping it that simple.
 */

export const TEAMS = [
  { name: "Red", color: "#FF3B30" },
  { name: "Blue", color: "#0A84FF" },
] as const;

/** the champions' abilities: the ones you can read at a glance */
export const LIVE_ABILITIES: AbilityId[] = ["spike", "sword", "grow", "speed", "heal"];

/** this many likes on a side is worth 1 HP to it */
export const LIKES_PER_HP = 30;
/** a follow or a share heals the side a little */
export const FOLLOW_HP = 3;
export const SHARE_HP = 2;
/** the most balls a side can have at once, champion included, so it stays readable */
export const MAX_SIDE = 7;

/**
 * How big and tough a viewer's ball is, from what they've given this
 * round. Every gift counts, so a rose gets you in and a Galaxy makes you
 * the biggest thing in the arena.
 */
export function ballFor(coins: number): { r: number; hp: number; touch: number } {
  const c = Math.max(1, coins);
  return {
    r: Math.round(Math.min(130, 30 + 28 * Math.log10(1 + c))),
    hp: Math.round(3 + 3 * Math.sqrt(c)),
    touch: 1 + Math.floor(Math.log10(1 + c)),
  };
}

/** what the guide on the website shows: a few gifts, and the ball each one makes */
export const SIZES = [
  { gift: "Rose", coins: 1 },
  { gift: "Perfume", coins: 20 },
  { gift: "Hand Hearts", coins: 100 },
  { gift: "Galaxy", coins: 1000 },
].map((g) => ({ ...g, ...ballFor(g.coins) }));

/**
 * Which side someone means in chat: "1" or "2", red or blue, left or
 * right. Null if the message isn't a pick.
 */
export function sideFromChat(text: string): 0 | 1 | null {
  const t = text.trim().toLowerCase().replace(/[!.?\s]+$/g, "").replace(/^team\s*/, "").replace(/^#/, "");
  if (t === "1" || t === "1️⃣" || t === "red" || t === "left" || t === "l") return 0;
  if (t === "2" || t === "2️⃣" || t === "blue" || t === "right" || t === "r") return 1;
  return null;
}
