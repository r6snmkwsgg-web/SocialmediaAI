import { FPS, simulate, type Battle } from "./sim";
import type { AbilityId } from "./abilities";

/**
 * How good a fight is to watch. Every fight is a real, random simulation;
 * this only chooses which of many to show: ones where the lead changes
 * hands, the winner scrapes through, someone comes back, and it's over in a
 * Short's length.
 */
export type Drama = {
  score: number;
  /** times the side ahead changed */
  leadChanges: number;
  /** the winner's health at the end, as a share of what it started with */
  winnerLeft: number;
  /** the winner was well behind at some point */
  comeback: boolean;
  seconds: number;
};

/** Each side's share of all the health in the arena, per frame. */
export function strength(b: Battle, team: 0 | 1): number[] {
  return b.frames.map((fr) => {
    const total = fr.hp[0] + fr.hp[1];
    return total > 0 ? fr.hp[team] / total : 0.5;
  });
}

export function drama(b: Battle): Drama {
  const seconds = (b.endFrame + 1) / FPS;
  const s0 = strength(b, 0);
  let leader: 0 | 1 | null = null;
  let leadChanges = 0;
  for (const v of s0) {
    // a little give either side of even, so a wobble isn't a lead change
    const now: 0 | 1 | null = v > 0.56 ? 0 : v < 0.44 ? 1 : leader;
    if (now !== null && leader !== null && now !== leader) leadChanges++;
    if (now !== null) leader = now;
  }
  const w = b.winner;
  const last = b.frames[b.endFrame];
  const winnerLeft = w === null ? 1 : Math.min(1, last.hp[w] / b.start[w]);
  const ws = w === null ? s0 : w === 0 ? s0 : s0.map((v) => 1 - v);
  const comeback = w !== null && Math.min(...ws.slice(FPS)) < 0.32;
  const fit = seconds >= 16 && seconds <= 40 ? 1 : seconds < 16 ? seconds / 16 : Math.max(0, 1 - (seconds - 40) / 20);
  const score = 2 * Math.min(leadChanges, 4) + 4 * (1 - winnerLeft) + 3 * fit + (comeback ? 3 : 0) - (b.byTimeout ? 4 : 0) - (w === null ? 6 : 0);
  return { score, leadChanges, winnerLeft, comeback, seconds };
}

/** Runs the matchup with `tries` seeds from `from` and keeps the best to watch. */
export function pickBattle(a: AbilityId, b: AbilityId, tries = 60, from = 1): { battle: Battle; drama: Drama; tried: number } {
  let best: { battle: Battle; drama: Drama } | null = null;
  for (let i = 0; i < tries; i++) {
    const battle = simulate(a, b, from + i);
    const d = drama(battle);
    if (!best || d.score > best.drama.score) best = { battle, drama: d };
  }
  return { ...best!, tried: tries };
}
