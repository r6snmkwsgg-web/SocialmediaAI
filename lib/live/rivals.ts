import type { Team } from "../battle/sim";
import { RAGE_SECONDS, type MenuGift, type Tier } from "./menu";
import { namesPeople, pitsPeople, plainLetters } from "./offlimits";

/**
 * Rivals: a ball battle between two sides people already argue about
 * (Messi or Ronaldo, PlayStation or Xbox), red against blue, a new
 * rivalry every round. Both sides fight with the same champion and have
 * the same three powers; each side sets them off with its own gifts, at
 * the same price as the other side's, so the gift someone sends is the
 * side they're on. Every other gift helps the side the giver is on.
 *
 * Rivalries pit choices against each other, never people for who they
 * are: religion, race, where people are from, gender and who they love
 * are off limits, as presets and as a streamer's own (see offlimits.ts).
 * Politics is a choice, but TikTok is strict about LIVEs that stir it up
 * for gifts, so it's there only for a streamer who switches it on. Only
 * viewers 18 and over can send gifts, so Hookline's lean grown-up: clubs,
 * consoles, phones, fast food, cars. The ones that skew young are a group
 * of their own, off to start.
 */

export const RIVAL_GROUPS = [
  { id: "sports", name: "Sports", on: true, note: "" },
  { id: "games", name: "Games and tech", on: true, note: "" },
  { id: "food", name: "Food and drink", on: true, note: "" },
  { id: "cars", name: "Cars", on: true, note: "" },
  { id: "young", name: "All ages", on: false, note: "Off to start: these skew young, and only viewers 18 and over can send gifts." },
  { id: "politics", name: "Politics", on: false, note: "" },
] as const;

export type RivalGroup = (typeof RIVAL_GROUPS)[number]["id"];
export const RIVAL_GROUP_IDS = RIVAL_GROUPS.map((g) => g.id) as [RivalGroup, ...RivalGroup[]];

/** Saved groups that are still groups, in order: ones since taken away (Places) are dropped, not the whole setting. */
export function knownGroups(ids: readonly string[]): RivalGroup[] {
  return RIVAL_GROUP_IDS.filter((id) => ids.includes(id));
}

/** a side's name fits on a team card at a size people can read on a phone */
export const NAME_MAX = 12;

/** red is the left side (team 0), blue the right (team 1) */
export type Rivalry = { id: string; red: string; blue: string; group: RivalGroup | "own" };

export const RIVALRIES: Rivalry[] = [
  { id: "messi-ronaldo", red: "Messi", blue: "Ronaldo", group: "sports" },
  { id: "madrid-barca", red: "Real Madrid", blue: "Barcelona", group: "sports" },
  { id: "united-liverpool", red: "Man United", blue: "Liverpool", group: "sports" },
  { id: "arsenal-spurs", red: "Arsenal", blue: "Spurs", group: "sports" },
  { id: "lakers-celtics", red: "Lakers", blue: "Celtics", group: "sports" },
  { id: "lebron-jordan", red: "LeBron", blue: "Jordan", group: "sports" },
  { id: "chiefs-eagles", red: "Chiefs", blue: "Eagles", group: "sports" },
  { id: "cowboys-packers", red: "Cowboys", blue: "Packers", group: "sports" },
  { id: "yankees-redsox", red: "Yankees", blue: "Red Sox", group: "sports" },
  { id: "ferrari-mclaren", red: "Ferrari", blue: "McLaren", group: "sports" },
  { id: "verstappen-hamilton", red: "Verstappen", blue: "Hamilton", group: "sports" },
  { id: "playstation-xbox", red: "PlayStation", blue: "Xbox", group: "games" },
  { id: "iphone-android", red: "iPhone", blue: "Android", group: "games" },
  { id: "apple-samsung", red: "Apple", blue: "Samsung", group: "games" },
  { id: "pc-console", red: "PC", blue: "Console", group: "games" },
  { id: "cod-battlefield", red: "Call of Duty", blue: "Battlefield", group: "games" },
  { id: "mcdonalds-bk", red: "McDonald's", blue: "Burger King", group: "food" },
  { id: "coke-pepsi", red: "Coke", blue: "Pepsi", group: "food" },
  { id: "kfc-popeyes", red: "KFC", blue: "Popeyes", group: "food" },
  { id: "starbucks-dunkin", red: "Starbucks", blue: "Dunkin'", group: "food" },
  { id: "tacobell-chipotle", red: "Taco Bell", blue: "Chipotle", group: "food" },
  { id: "redbull-monster", red: "Red Bull", blue: "Monster", group: "food" },
  { id: "coffee-tea", red: "Coffee", blue: "Tea", group: "food" },
  { id: "pizza-burgers", red: "Pizza", blue: "Burgers", group: "food" },
  { id: "ford-chevy", red: "Ford", blue: "Chevy", group: "cars" },
  { id: "bmw-mercedes", red: "BMW", blue: "Mercedes", group: "cars" },
  { id: "toyota-honda", red: "Toyota", blue: "Honda", group: "cars" },
  { id: "lambo-ferrari", red: "Lamborghini", blue: "Ferrari", group: "cars" },
  { id: "tesla-porsche", red: "Tesla", blue: "Porsche", group: "cars" },
  { id: "fortnite-minecraft", red: "Fortnite", blue: "Minecraft", group: "young" },
  { id: "roblox-minecraft", red: "Roblox", blue: "Minecraft", group: "young" },
  { id: "mario-sonic", red: "Mario", blue: "Sonic", group: "young" },
  { id: "cats-dogs", red: "Cats", blue: "Dogs", group: "young" },
  { id: "summer-winter", red: "Summer", blue: "Winter", group: "young" },
  // red and blue, the way American election maps already colour them
  { id: "republicans-democrats", red: "Republicans", blue: "Democrats", group: "politics" },
];

/** The three powers, the same for both sides, cheapest first. */
export const RIVAL_POWERS: Omit<Tier, "min" | "gift" | "price">[] = [
  { effect: "ball", name: "Your ball", line: "A fighter with your face joins your side, with 1 HP for every coin", color: "#34C759", icon: "person" },
  { effect: "rage", name: "Rage 2X", line: `Your side hits twice as hard for ${RAGE_SECONDS} seconds, and heals 1 HP for every coin`, color: "#FF3B30", icon: "flame", big: true },
  { effect: "meteor", name: "Meteor", line: "Meteors smash the other side's biggest ball and heal yours, more of them the bigger the gift", color: "#FF9F0A", icon: "meteor", big: true },
];

/**
 * Any gift that isn't on either side's menu helps the side the giver is
 * on: one that costs as much as a power sets that power off, a cheaper
 * one, like a Rose, heals 1 HP a coin, and one that costs more than the
 * meteor brings down more meteors, by its coins.
 */
export const RIVAL_HEAL: Tier = { effect: "heal", min: 1, name: "+1 HP", gift: "Rose", price: 1, line: "Any other gift helps your side: a Rose heals 1 HP, one that costs as much as a power sets it off, and a bigger one brings down more meteors", color: "#FF6FB5", icon: "heart" };

export type SideGifts = { red: MenuGift[]; blue: MenuGift[] };

/**
 * Each side's three gifts: three pairs that cost exactly the same, from
 * TikTok's regular gifts that anyone can send, so neither side pays more
 * for the same power. Gifts that some price lists put behind a gifter
 * level (the Money Gun, the Gem Gun, Confetti) are left out. Streamers can
 * swap in their own.
 */
export const DEFAULT_SIDE_GIFTS: SideGifts = {
  red: [
    { name: "Paper Crane", coins: 99 },
    { name: "Sunglasses", coins: 199 },
    { name: "Corgi", coins: 299 },
  ],
  blue: [
    { name: "Little Crown", coins: 99 },
    { name: "Hearts", coins: 199 },
    { name: "Boxing Gloves", coins: 299 },
  ],
};

/** the same gift, spelled the other ways it turns up */
const ALIASES: Record<string, string> = { donut: "doughnut", donuts: "doughnut", doughnuts: "doughnut", boxingglove: "boxinggloves", handheart: "handhearts", papercranes: "papercrane" };

/** A gift's name as TikTok might send it, made comparable: case, spaces and punctuation don't count, and a donut is a doughnut. */
export function giftKey(name: string): string {
  const k = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ALIASES[k] ?? k;
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

export { namesPeople };

/**
 * Why two sides' names can't go up against each other, or null: they're
 * in letters Hookline can read, and say nothing about who people are.
 * Rivals' own rivalries and the battle's team names both go through it.
 */
export function sidesProblem(red: string, blue: string): string | null {
  const a = red.trim(), b = blue.trim();
  if (!plainLetters(a) || !plainLetters(b)) return "Use letters A to Z (accents are fine), numbers and simple punctuation. Other alphabets and emoji can't be checked yet.";
  if (pitsPeople(a, b)) return "Hookline doesn't set people against each other for their country, religion, race, gender or who they love. Pick something people choose, like teams, games or food.";
  return null;
}

/** A rivalry of the streamer's own that Hookline will run, or why not. */
export function ownRivalryProblem(red: string, blue: string): string | null {
  const a = red.trim(), b = blue.trim();
  if (!a || !b) return "Give both sides a name.";
  const why = sidesProblem(a, b);
  if (why) return why;
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
  // a new one each round takes at least two: with fewer switched on, the groups that start on join in
  const everyday = RIVAL_GROUPS.filter((g) => g.on).map((g): string => g.id);
  return [...all, ...RIVALRIES.filter((r) => everyday.includes(r.group) && !all.includes(r))];
}

export const rivalryLabel = (r: Pick<Rivalry, "red" | "blue">) => `${r.red} vs ${r.blue}`;
