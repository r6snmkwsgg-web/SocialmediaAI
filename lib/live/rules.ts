import type { AbilityId } from "../battle/abilities";

/**
 * What everything a viewer does is worth. The game is RED against BLUE:
 * type 1 or 2 to join, likes heal your team, and every gift does
 * something from the menu below. The menu sits on screen the whole time,
 * by gift name, because viewers know their gifts by name, not by price.
 */

export const TEAMS = [
  { name: "Red", color: "#FF3B30" },
  { name: "Blue", color: "#0A84FF" },
] as const;

/** the champions' abilities: the ones you can read at a glance */
export const LIVE_ABILITIES: AbilityId[] = ["spike", "sword", "grow", "speed", "heal"];

export type Effect = "heal" | "small" | "ball" | "rage" | "shield" | "meteor";

export type Tier = {
  effect: Effect;
  /** the cheapest single gift, in coins, that does it */
  min: number;
  /** what it's called on the menu, a word or two */
  name: string;
  /** the gift at that price viewers will know */
  gift: string;
  /** what it does, in plain words, for the website and the moment it happens */
  line: string;
  color: string;
};

export const RAGE_SECONDS = 8;
export const SHIELD_SECONDS = 6;
export const SHIELD_HEAL = 10;

/** Cheapest first. A gift does the best thing its price reaches. */
export const TIERS: Tier[] = [
  { effect: "heal", min: 1, name: "+1 HP", gift: "Rose", line: "Heals your team 1 HP for every coin", color: "#FF6FB5" },
  { effect: "small", min: 5, name: "Mini ball", gift: "Finger Heart", line: "A small ball with your face joins your team", color: "#F4F1EA" },
  { effect: "ball", min: 20, name: "Big ball", gift: "Perfume", line: "A full fighter with your face joins your team", color: "#34C759" },
  { effect: "rage", min: 99, name: "Rage 2X", gift: "Hand Hearts", line: `Your team hits twice as hard for ${RAGE_SECONDS} seconds`, color: "#FF3B30" },
  { effect: "shield", min: 299, name: "Shield", gift: "Corgi", line: `Your team can't be hurt for ${SHIELD_SECONDS} seconds, and gets ${SHIELD_HEAL} HP`, color: "#64D2FF" },
  { effect: "meteor", min: 999, name: "Meteor", gift: "Galaxy", line: "Smashes the other team's biggest ball", color: "#FF9F0A" },
];

export function tierFor(coins: number): Tier {
  let t = TIERS[0];
  for (const x of TIERS) if (coins >= x.min) t = x;
  return t;
}

/** this many likes on a side is worth 1 HP to it */
export const LIKES_PER_HP = 30;
/** a follow heals your team; a share drops a mini ball, once a round */
export const FOLLOW_HP = 3;
/** the most balls a side can have at once, champion included, so it stays readable */
export const MAX_SIDE = 10;
/** a streak of balls stops at a handful; what's past it heals instead */
export const MAX_SUMMONS_AT_ONCE = 5;
/** one gift of 5,000 coins or more brings down three meteors */
export const SHOWER_COINS = 5000;

/**
 * What a gift does, as steps to run. A streak of cheap gifts adds up (ten
 * roses heal ten), but a streak of balls stops at a handful so the arena
 * stays readable; whatever's past that turns into health.
 */
export function giftSteps(coins: number, count: number): { effect: Effect; n: number }[] {
  const tier = tierFor(coins);
  switch (tier.effect) {
    case "heal":
      return [{ effect: "heal", n: coins * count }];
    case "small":
    case "ball": {
      const balls = Math.min(count, MAX_SUMMONS_AT_ONCE);
      const out: { effect: Effect; n: number }[] = [{ effect: tier.effect, n: balls }];
      if (count > balls) out.push({ effect: "heal", n: (count - balls) * Math.ceil(coins / 5) });
      return out;
    }
    case "rage":
      return [{ effect: "rage", n: count }];
    case "shield":
      return [{ effect: "shield", n: count }, { effect: "heal", n: SHIELD_HEAL * count }];
    case "meteor":
      return [{ effect: "meteor", n: Math.min(5, count * (coins >= SHOWER_COINS ? 3 : 1)) }];
  }
}

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
