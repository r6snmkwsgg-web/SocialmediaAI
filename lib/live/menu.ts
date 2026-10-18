/**
 * A game's gift menu: six things a gift can do, cheapest first. Every game
 * has one in the same shape, so the screen can always draw it the same way
 * and a viewer who knows one game can read the next. Viewers know their
 * gifts by name, so each item carries the gift at that price.
 */

/** the little pictures the menu and the fight share */
export type Icon = "heart" | "person-small" | "person" | "flame" | "shield" | "meteor" | "plus" | "weight" | "boost" | "ghost" | "wave" | "rocket" | "spikes" | "sword";

export type Tier = {
  /** what it does, as the game knows it */
  effect: string;
  /** the cheapest single gift, in coins, that does it */
  min: number;
  /** what it's called on the menu, a word or two */
  name: string;
  /** the gift at that price viewers will know */
  gift: string;
  /** what that gift costs, when it isn't exactly `min` (a 99-coin gift still gets the 100-coin item) */
  price?: number;
  /** what it does, in plain words */
  line: string;
  color: string;
  icon: Icon;
  /** the big ones get a banner when they go off, the rest a line */
  big?: boolean;
  /** on YouTube: set off by any Jewels gifts worth `min` or more, or by a Super Chat of one colour; none means TikTok coins */
  unit?: "jewels" | "super";
  /** a Super Chat item's colour, for its chip */
  chip?: string;
};

/** The item a single gift of this price gets: the best one its price reaches. */
export function tierIn(menu: Tier[], coins: number): Tier {
  let t = menu[0];
  for (const x of menu) if (coins >= x.min) t = x;
  return t;
}

/** how long rage lasts, in seconds, in every game that has it */
export const RAGE_SECONDS = 8;

/** past 100 coins, a gift's worth grows this much faster than its coins for every tenfold */
const WORTH_BONUS = 0.02;

/**
 * What a gift is worth in a fight, in HP: one per coin, so a thousand Roses
 * and a Galaxy weigh about the same, and a little more per coin past 100,
 * so the bigger the gift, the more it gets for each coin.
 */
export function worth(coins: number): number {
  return coins <= 100 ? coins : Math.round(coins * (1 + WORTH_BONUS * Math.log10(coins / 100)));
}

/** How big a gift is, for its moment on screen and in a clip: 0 for most, 1 for a Galaxy's worth, 2 for ten times that and more. */
export function giftLevel(coins: number): 0 | 1 | 2 {
  return coins >= 10_000 ? 2 : coins >= 999 ? 1 : 0;
}

/** How many times over a gift pays for the top of the menu: a Universe is 45 Galaxies, and does more than one. */
export function timesOver(each: number, top: Tier): number {
  return Math.max(1, Math.floor(each / Math.max(1, top.min)));
}

/** where each item of a default menu starts: a little under the gift's price, so gifts that cost 99 or 999 count too */
export const DEFAULT_PRICES = [1, 5, 20, 99, 299, 999];

/** a gift on a menu: its name as viewers know it, and what one costs in coins */
export type MenuGift = { name: string; coins: number };

/** the gifts every default menu uses, at what they cost on TikTok */
export const DEFAULT_GIFTS: MenuGift[] = [
  { name: "Rose", coins: 1 },
  { name: "Finger Heart", coins: 5 },
  { name: "Perfume", coins: 20 },
  { name: "Hand Hearts", coins: 100 },
  { name: "Corgi", coins: 299 },
  { name: "Galaxy", coins: 1000 },
];

/** A default menu's items, with the default gifts and where each starts. */
export function defaultMenu(items: Omit<Tier, "min" | "gift" | "price">[]): Tier[] {
  return items.map((t, i) => ({ ...t, min: DEFAULT_PRICES[i], gift: DEFAULT_GIFTS[i].name, price: DEFAULT_GIFTS[i].coins }));
}

/** Six gifts that can make a menu: the first costs 1 coin, so every gift does something, and each costs more than the last. */
export function validGifts(gifts: MenuGift[] | null | undefined): gifts is MenuGift[] {
  return (
    !!gifts &&
    gifts.length === 6 &&
    gifts[0].coins === 1 &&
    gifts.every((g, i) => g.name.trim().length > 0 && Number.isInteger(g.coins) && g.coins >= 1 && (i === 0 || g.coins > gifts[i - 1].coins))
  );
}

/** A menu with the streamer's own gifts on it. If they don't make a menu, the defaults stand. */
export function withGifts(menu: Tier[], gifts?: MenuGift[] | null): Tier[] {
  if (!validGifts(gifts) || gifts.length !== menu.length) return menu;
  return menu.map((t, i) => ({ ...t, min: gifts[i].coins, price: gifts[i].coins, gift: gifts[i].name.trim() }));
}
