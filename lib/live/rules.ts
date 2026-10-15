/**
 * What each thing a viewer does is worth in the fight. Kept to one short
 * ladder so it fits on screen and a viewer can read it in a glance: the
 * more a gift costs, the bigger the thing it does.
 */

export type Effect = "heal" | "small" | "ball" | "rage" | "shield" | "meteor";

export type Tier = {
  /** the cheapest gift, in coins, that gets this */
  min: number;
  effect: Effect;
  /** what the gift guide on screen says */
  label: string;
  /** the same, in a word or two, for the guide's chips */
  short: string;
  /** an example gift at about this price, for the guide */
  example: string;
};

/** Cheapest first. Coins are what one of the gift costs the viewer. */
export const TIERS: Tier[] = [
  { min: 1, effect: "heal", label: "+1 HP", short: "+1 HP", example: "Rose" },
  { min: 5, effect: "small", label: "Mini ball with your name", short: "Mini ball", example: "Finger Heart" },
  { min: 20, effect: "ball", label: "Big ball with your name", short: "Big ball", example: "Perfume" },
  { min: 99, effect: "rage", label: "Rage: double damage", short: "Rage", example: "Hand Hearts" },
  { min: 299, effect: "shield", label: "Shield and 10 HP", short: "Shield", example: "Corgi" },
  { min: 999, effect: "meteor", label: "Meteor on the other side", short: "Meteor", example: "Galaxy" },
];

export function tierFor(coins: number): Tier {
  let t = TIERS[0];
  for (const x of TIERS) if (coins >= x.min) t = x;
  return t;
}

export const RAGE_SECONDS = 8;
export const SHIELD_SECONDS = 6;
export const SHIELD_HEAL = 10;
/** this many likes on a side is worth 1 HP to it */
export const LIKES_PER_HP = 30;
/** a share drops a mini ball, but only once a round per viewer */
export const SHARE_BALLS = 1;
/** a big streak can't fill the arena by itself */
export const MAX_SUMMONS_AT_ONCE = 6;
/** one gift of 5,000 coins or more brings down a meteor shower */
export const SHOWER_COINS = 5000;

/**
 * Which side someone means in chat: "1" or "2", left or right, or the
 * name of the ball they want. Null if the message isn't a pick.
 */
export function sideFromChat(text: string, names: [string, string]): 0 | 1 | null {
  const t = text.trim().toLowerCase().replace(/[!.?\s]+$/g, "").replace(/^team\s*/, "").replace(/^#/, "");
  if (t === "1" || t === "l" || t === "left" || t === "1️⃣") return 0;
  if (t === "2" || t === "r" || t === "right" || t === "2️⃣") return 1;
  if (t === names[0].toLowerCase()) return 0;
  if (t === names[1].toLowerCase()) return 1;
  return null;
}

/**
 * What a gift does, as steps to run. A streak of cheap gifts adds up
 * (ten roses heal ten), but a streak of summons stops at a handful so the
 * arena stays readable; whatever's past that turns into health.
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
