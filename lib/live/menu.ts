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
};

/** The item a single gift of this price gets: the best one its price reaches. */
export function tierIn(menu: Tier[], coins: number): Tier {
  let t = menu[0];
  for (const x of menu) if (coins >= x.min) t = x;
  return t;
}

/** how long rage lasts, in seconds, in every game that has it */
export const RAGE_SECONDS = 8;

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
