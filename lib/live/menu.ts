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

/** the prices TikTok's common gifts cost, which every default menu uses */
export const DEFAULT_PRICES = [1, 5, 20, 99, 299, 999];

/**
 * A menu with the streamer's own prices. Prices have to climb, and the
 * first item always starts at 1 coin so every gift does something; if
 * they don't, the defaults stand.
 */
export function withPrices(menu: Tier[], prices?: number[] | null): Tier[] {
  if (!prices || prices.length !== menu.length) return menu;
  const ok = prices[0] === 1 && prices.every((p, i) => Number.isInteger(p) && p >= 1 && (i === 0 || p > prices[i - 1]));
  if (!ok) return menu;
  return menu.map((t, i) => ({ ...t, min: prices[i] }));
}
