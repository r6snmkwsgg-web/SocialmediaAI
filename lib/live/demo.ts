import type { LiveEvent, Viewer } from "./events";
import type { MenuGift, Tier } from "./menu";

/**
 * Pretend viewers, for trying the show out before going live and for the
 * preview on the website. Everything they do is made up, so the screen
 * says DEMO whenever they're on.
 */

const NAMES = [
  "jayden.k", "mia_plays", "noahhh", "sofi", "lucas0", "ellie.b", "kai", "zara_x", "ben10", "lily.r",
  "omar", "chloe", "theo_v", "nina", "max", "ivy.m", "leo", "ruby", "sam_t", "ava",
];

/** gifts at about the prices of real ones */
export const GIFTS: { name: string; coins: number }[] = [
  { name: "Rose", coins: 1 },
  { name: "Finger Heart", coins: 5 },
  { name: "Perfume", coins: 20 },
  { name: "Hand Hearts", coins: 100 },
  { name: "Corgi", coins: 299 },
  { name: "Galaxy", coins: 1000 },
];

/** how often each of a menu's six gifts is sent, a second, cheapest first: mostly small ones, rarely a big one */
const ODDS = [0.12, 0.06, 0.03, 0.008, 0.004, 0.002];
/** and each side's three, where each side has its own */
const SIDE_ODDS = [0.05, 0.008, 0.003];

export function demoViewer(i: number): Viewer {
  return { id: `demo-${i}`, name: NAMES[i % NAMES.length], pretend: true };
}

/**
 * What a pretend viewer sends for a menu item: its own gift, at its price.
 * On YouTube the small items take any Jewels gifts, so it's a Jewels gift
 * worth just enough, never a real gift's name at a price nobody charges.
 */
export function pretendGift(t: Tier): MenuGift {
  return { name: t.unit === "jewels" ? "Jewels gift" : t.gift, coins: t.price ?? t.min };
}

export type DemoOptions = {
  /** team games: viewers pick a side; otherwise they type GO */
  teams?: boolean;
  /** the vote is on, so viewers vote too */
  voting?: boolean;
  /** what they send, cheapest first: the menu's gifts */
  gifts?: MenuGift[];
  /** where each side has its own gifts (Rivals), each side's three; the cheapest of `gifts` heals */
  sides?: [MenuGift[], MenuGift[]];
  /** likes and follows, which only TikTok's LIVEs have */
  likes?: boolean;
};

/**
 * What the pretend viewers do over `dt` seconds: mostly picking sides and
 * liking, now and then a gift, rarely a big one. Each one sticks with a
 * side, like real viewers do.
 */
export function demoTick(dt: number, rand: () => number, { teams = true, voting = false, gifts = GIFTS, sides, likes = true }: DemoOptions = {}): LiveEvent[] {
  const out: LiveEvent[] = [];
  const pick = () => Math.floor(rand() * NAMES.length);
  const chance = (perSecond: number) => rand() < perSecond * dt;
  if (chance(0.6)) {
    const i = pick();
    // pick a team (or type GO), and vote while there's a vote on
    const text = voting && rand() < 0.7 ? "ABC"[(i + Math.floor(rand() * 2)) % 3] : teams ? (rand() < 0.8 ? String((i % 2) + 1) : i % 2 ? "blue" : "red") : "go";
    out.push({ kind: "chat", viewer: demoViewer(i), text });
  }
  if (likes && chance(2)) out.push({ kind: "like", viewer: demoViewer(pick()), count: 1 + Math.floor(rand() * 15) });
  // the cheapest gift comes a few at a time
  const small = gifts[0];
  if (small && chance(ODDS[0])) out.push({ kind: "gift", viewer: demoViewer(pick()), gift: small.name, coins: small.coins, count: 1 + Math.floor(rand() * 3) });
  if (sides) {
    // where each side has its own gifts, each viewer sends their side's
    sides[0].forEach((_, tier) => {
      if (!chance(SIDE_ODDS[tier] ?? 0.002)) return;
      const i = pick();
      const g = sides[i % 2][tier];
      out.push({ kind: "gift", viewer: demoViewer(i), gift: g.name, coins: g.coins, count: 1 });
    });
  } else {
    gifts.slice(1).forEach((g, i) => {
      if (chance(ODDS[i + 1] ?? 0.002)) out.push({ kind: "gift", viewer: demoViewer(pick()), gift: g.name, coins: g.coins, count: 1 });
    });
  }
  if (likes && chance(0.015)) out.push({ kind: "follow", viewer: demoViewer(pick()) });
  return out;
}
