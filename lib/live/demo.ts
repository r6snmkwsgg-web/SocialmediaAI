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
export const GIFTS: { name: string; coins: number; streak: boolean }[] = [
  { name: "Rose", coins: 1, streak: true },
  { name: "Finger Heart", coins: 5, streak: true },
  { name: "Perfume", coins: 20, streak: true },
  { name: "Hand Hearts", coins: 100, streak: false },
  { name: "Corgi", coins: 299, streak: false },
  { name: "Galaxy", coins: 1000, streak: false },
];

export function demoViewer(i: number): Viewer {
  const name = NAMES[i % NAMES.length];
  return { id: `demo-${i}`, name };
}

/**
 * What the pretend viewers do over `dt` seconds: mostly picking sides and
 * liking, now and then a gift, rarely a big one.
 */
export function demoTick(dt: number, rand: () => number, names: [string, string]): LiveEvent[] {
  const out: LiveEvent[] = [];
  const who = () => demoViewer(Math.floor(rand() * NAMES.length));
  const chance = (perSecond: number) => rand() < perSecond * dt;
  if (chance(0.9)) {
    // each pretend viewer mostly sticks with one side, like real ones do
    const i = Math.floor(rand() * NAMES.length);
    const side = rand() < 0.9 ? i % 2 : 1 - (i % 2);
    out.push({ kind: "chat", viewer: demoViewer(i), text: rand() < 0.75 ? String(side + 1) : names[side] });
  }
  if (chance(2.5)) out.push({ kind: "like", viewer: who(), count: 1 + Math.floor(rand() * 15) });
  if (chance(0.45)) out.push({ kind: "gift", viewer: who(), gift: "Rose", coins: 1, count: 1 + Math.floor(rand() * 5) });
  if (chance(0.16)) out.push({ kind: "gift", viewer: who(), gift: "Finger Heart", coins: 5, count: 1 });
  if (chance(0.06)) out.push({ kind: "gift", viewer: who(), gift: "Perfume", coins: 20, count: 1 });
  if (chance(0.025)) out.push({ kind: "gift", viewer: who(), gift: "Hand Hearts", coins: 100, count: 1 });
  if (chance(0.012)) out.push({ kind: "gift", viewer: who(), gift: "Corgi", coins: 299, count: 1 });
  if (chance(0.006)) out.push({ kind: "gift", viewer: who(), gift: "Galaxy", coins: 1000, count: 1 });
  if (chance(0.03)) out.push({ kind: "share", viewer: who() });
  if (chance(0.03)) out.push({ kind: "follow", viewer: who() });
  return out;
}
