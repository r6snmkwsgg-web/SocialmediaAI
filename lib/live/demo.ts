import type { LiveEvent, Viewer } from "./events";

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

export function demoViewer(i: number): Viewer {
  return { id: `demo-${i}`, name: NAMES[i % NAMES.length] };
}

/**
 * What the pretend viewers do over `dt` seconds: mostly picking sides and
 * liking, now and then a gift, rarely a big one. Each one sticks with a
 * side, like real viewers do.
 */
export function demoTick(dt: number, rand: () => number): LiveEvent[] {
  const out: LiveEvent[] = [];
  const pick = () => Math.floor(rand() * NAMES.length);
  const chance = (perSecond: number) => rand() < perSecond * dt;
  if (chance(0.6)) {
    const i = pick();
    out.push({ kind: "chat", viewer: demoViewer(i), text: rand() < 0.8 ? String((i % 2) + 1) : i % 2 ? "blue" : "red" });
  }
  if (chance(2)) out.push({ kind: "like", viewer: demoViewer(pick()), count: 1 + Math.floor(rand() * 15) });
  if (chance(0.12)) out.push({ kind: "gift", viewer: demoViewer(pick()), gift: "Rose", coins: 1, count: 1 + Math.floor(rand() * 3) });
  if (chance(0.06)) out.push({ kind: "gift", viewer: demoViewer(pick()), gift: "Finger Heart", coins: 5, count: 1 });
  if (chance(0.03)) out.push({ kind: "gift", viewer: demoViewer(pick()), gift: "Perfume", coins: 20, count: 1 });
  if (chance(0.008)) out.push({ kind: "gift", viewer: demoViewer(pick()), gift: "Hand Hearts", coins: 100, count: 1 });
  if (chance(0.004)) out.push({ kind: "gift", viewer: demoViewer(pick()), gift: "Corgi", coins: 299, count: 1 });
  if (chance(0.002)) out.push({ kind: "gift", viewer: demoViewer(pick()), gift: "Galaxy", coins: 1000, count: 1 });
  if (chance(0.015)) out.push({ kind: "follow", viewer: demoViewer(pick()) });
  return out;
}
