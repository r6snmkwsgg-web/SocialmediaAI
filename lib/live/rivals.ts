import type { Team } from "../battle/sim";
import { RAGE_SECONDS, type MenuGift, type Tier } from "./menu";

/**
 * Rivals: a ball battle between two sides people already argue about
 * (Messi or Ronaldo, PlayStation or Xbox), red against blue, a new
 * rivalry every round. Both sides fight with the same champion and have
 * the same three powers; each side sets them off with its own gifts, at
 * the same price as the other side's, so the gift someone sends is the
 * side they're on. Every other gift helps the side the giver is on.
 *
 * Rivalries pit choices against each other, never people for who they
 * are: religion, race, where people are from and who they love are off
 * limits, as presets and as a streamer's own. Politics is a choice, but
 * TikTok is strict about LIVEs that stir it up for gifts, so it's there
 * only for a streamer who switches it on.
 */

export const RIVAL_GROUPS = [
  { id: "sports", name: "Sports", on: true },
  { id: "games", name: "Games and tech", on: true },
  { id: "food", name: "Food and fun", on: true },
  { id: "places", name: "Places", on: true },
  { id: "politics", name: "Politics", on: false },
] as const;

export type RivalGroup = (typeof RIVAL_GROUPS)[number]["id"];
export const RIVAL_GROUP_IDS = RIVAL_GROUPS.map((g) => g.id) as [RivalGroup, ...RivalGroup[]];

/** a side's name fits on a team card at a size people can read on a phone */
export const NAME_MAX = 12;

/** red is the left side (team 0), blue the right (team 1) */
export type Rivalry = { id: string; red: string; blue: string; group: RivalGroup | "own" };

export const RIVALRIES: Rivalry[] = [
  { id: "messi-ronaldo", red: "Messi", blue: "Ronaldo", group: "sports" },
  { id: "lakers-celtics", red: "Lakers", blue: "Celtics", group: "sports" },
  { id: "madrid-barca", red: "Real Madrid", blue: "Barcelona", group: "sports" },
  { id: "chiefs-eagles", red: "Chiefs", blue: "Eagles", group: "sports" },
  { id: "yankees-redsox", red: "Yankees", blue: "Red Sox", group: "sports" },
  { id: "lebron-jordan", red: "LeBron", blue: "Jordan", group: "sports" },
  { id: "playstation-xbox", red: "PlayStation", blue: "Xbox", group: "games" },
  { id: "iphone-android", red: "iPhone", blue: "Android", group: "games" },
  { id: "fortnite-minecraft", red: "Fortnite", blue: "Minecraft", group: "games" },
  { id: "roblox-minecraft", red: "Roblox", blue: "Minecraft", group: "games" },
  { id: "pizza-burgers", red: "Pizza", blue: "Burgers", group: "food" },
  { id: "coke-pepsi", red: "Coke", blue: "Pepsi", group: "food" },
  { id: "mcdonalds-bk", red: "McDonald's", blue: "Burger King", group: "food" },
  { id: "cats-dogs", red: "Cats", blue: "Dogs", group: "food" },
  { id: "summer-winter", red: "Summer", blue: "Winter", group: "food" },
  { id: "sweet-salty", red: "Sweet", blue: "Salty", group: "food" },
  { id: "east-west", red: "East Coast", blue: "West Coast", group: "places" },
  { id: "nyc-la", red: "New York", blue: "LA", group: "places" },
  { id: "city-country", red: "City", blue: "Country", group: "places" },
  // red and blue, the way American election maps already colour them
  { id: "republicans-democrats", red: "Republicans", blue: "Democrats", group: "politics" },
];

/** The three powers, the same for both sides, cheapest first. */
export const RIVAL_POWERS: Omit<Tier, "min" | "gift" | "price">[] = [
  { effect: "ball", name: "Your ball", line: "A fighter with your face joins your side", color: "#34C759", icon: "person" },
  { effect: "rage", name: "Rage 2X", line: `Your side hits twice as hard for ${RAGE_SECONDS} seconds`, color: "#FF3B30", icon: "flame", big: true },
  { effect: "meteor", name: "Meteor", line: "Smashes the other side's biggest ball", color: "#FF9F0A", icon: "meteor", big: true },
];

/**
 * Any gift that isn't on either side's menu helps the side the giver is
 * on: one that costs as much as a power sets that power off, and a
 * cheaper one, like a Rose, heals 1 HP a coin.
 */
export const RIVAL_HEAL: Tier = { effect: "heal", min: 1, name: "+1 HP", gift: "Rose", price: 1, line: "Any other gift helps your side: a Rose heals 1 HP, and one that costs as much as a power sets it off", color: "#FF6FB5", icon: "heart" };

export type SideGifts = { red: MenuGift[]; blue: MenuGift[] };

/**
 * Each side's three gifts. Red's are the classics; blue's cost the same
 * where TikTok has a gift at that exact price everywhere (199 and 500),
 * and the nearest everyday one where it doesn't (a Doughnut, 30, against
 * a Perfume, 20). Streamers can swap in their own.
 */
export const DEFAULT_SIDE_GIFTS: SideGifts = {
  red: [
    { name: "Perfume", coins: 20 },
    { name: "Sunglasses", coins: 199 },
    { name: "Money Gun", coins: 500 },
  ],
  blue: [
    { name: "Doughnut", coins: 30 },
    { name: "Hearts", coins: 199 },
    { name: "Gem Gun", coins: 500 },
  ],
};

/** A gift's name as TikTok might send it, made comparable: case, spaces and punctuation don't count, and a donut is a doughnut. */
export function giftKey(name: string): string {
  const k = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ({ donut: "doughnut", donuts: "doughnut", doughnuts: "doughnut" } as Record<string, string>)[k] ?? k;
}

/** One side's three powers, each with that side's gift. */
export function sidePowers(gifts: MenuGift[]): Tier[] {
  return RIVAL_POWERS.map((p, i) => ({ ...p, min: gifts[i].coins, price: gifts[i].coins, gift: gifts[i].name.trim() }));
}

/** One side's whole menu, cheapest first: the heal for any other gift, then its three powers. */
export function sideMenu(gifts: MenuGift[]): Tier[] {
  return [RIVAL_HEAL, ...sidePowers(gifts)];
}

/** Which side a gift is for and what it does there, or null when it's on neither side's menu. */
export function routeGift(gifts: SideGifts, name: string): { side: Team; tier: Tier } | null {
  const k = giftKey(name);
  for (const [side, list] of [[0, gifts.red], [1, gifts.blue]] as const) {
    const i = list.findIndex((g) => giftKey(g.name) === k);
    if (i >= 0) return { side, tier: sidePowers(list)[i] };
  }
  return null;
}

/** Two sides' gifts that make a game: three each, all different, each dearer than the one before. */
export function validSideGifts(g: SideGifts | null | undefined): g is SideGifts {
  if (!g) return false;
  const ok = (l: MenuGift[]) =>
    l.length === 3 && l.every((x, i) => x.name.trim().length > 0 && Number.isInteger(x.coins) && x.coins >= 1 && (i === 0 || x.coins > l[i - 1].coins));
  const keys = [...g.red, ...g.blue].map((x) => giftKey(x.name));
  return ok(g.red) && ok(g.blue) && new Set(keys).size === 6 && keys.every((k) => k.length > 0);
}

/** Where the two sides' gifts aren't the same price, so the settings can say which power costs one side more. */
export function priceGaps(g: SideGifts): { power: string; red: number; blue: number }[] {
  return RIVAL_POWERS.map((p, i) => ({ power: p.name, red: g.red[i].coins, blue: g.blue[i].coins })).filter((x) => x.red !== x.blue);
}

/**
 * Words that name people by their religion, race, where they're from or
 * who they love: things TikTok's rules on hate protect. A rivalry with
 * one of these on either side isn't one Hookline runs: setting people
 * against each other for who they are turns a chat hostile, and TikTok
 * shuts those LIVEs down.
 */
const PEOPLE = new Set([
  // religion
  "christian", "christians", "christianity", "muslim", "muslims", "islam", "islamic", "jew", "jews", "jewish", "judaism",
  "hindu", "hindus", "hinduism", "sikh", "sikhs", "buddhist", "buddhists", "buddhism", "catholic", "catholics", "protestant", "protestants",
  "mormon", "mormons", "atheist", "atheists", "orthodox", "evangelical", "evangelicals", "shia", "sunni", "sunnis", "zionist", "zionists",
  // race and where people are from
  "white people", "black people", "brown people", "asian people", "blacks", "whites", "asians", "arabs", "latinos", "latinas", "hispanics",
  "immigrants", "migrants", "illegals", "foreigners", "mexicans", "africans", "indians", "pakistanis", "chinese people", "israelis", "palestinians",
  // who people love, and who they are
  "gay", "gays", "lesbian", "lesbians", "bisexual", "bisexuals", "lgbt", "lgbtq", "trans", "transgender", "nonbinary", "straight people", "queer",
]);

export function namesPeople(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (PEOPLE.has(n)) return true;
  const words = n.split(" ");
  return words.some((w) => PEOPLE.has(w)) || words.some((w, i) => i < words.length - 1 && PEOPLE.has(`${w} ${words[i + 1]}`));
}

/** A rivalry of the streamer's own that Hookline will run, or why not. */
export function ownRivalryProblem(red: string, blue: string): string | null {
  const a = red.trim(), b = blue.trim();
  if (!a || !b) return "Give both sides a name.";
  if (namesPeople(a) || namesPeople(b)) return "Hookline doesn't set people against each other for their religion, race, where they're from or who they love. Pick something people choose, like teams, games or food.";
  if (a.length > NAME_MAX || b.length > NAME_MAX) return `Keep each name to ${NAME_MAX} letters, so it fits on screen.`;
  if (a.toLowerCase() === b.toLowerCase()) return "The two sides need different names.";
  return null;
}

/** The rivalries in a streamer's rotation: the groups they've switched on, and their own. */
export function rotation(groups: readonly RivalGroup[], own: { red: string; blue: string }[]): Rivalry[] {
  const mine = own
    .filter((r) => ownRivalryProblem(r.red, r.blue) === null)
    .map((r, i) => ({ id: `own-${i}`, red: r.red.trim(), blue: r.blue.trim(), group: "own" as const }));
  const picked = RIVALRIES.filter((r) => groups.includes(r.group as RivalGroup));
  const all = [...picked, ...mine];
  if (all.length >= 2) return all;
  // a new one each round takes at least two: with fewer switched on, the everyday ones join in
  return [...all, ...RIVALRIES.filter((r) => r.group !== "politics" && !all.includes(r))];
}

export const rivalryLabel = (r: Pick<Rivalry, "red" | "blue">) => `${r.red} vs ${r.blue}`;
