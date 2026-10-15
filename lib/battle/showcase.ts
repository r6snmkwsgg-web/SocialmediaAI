import type { AbilityId } from "./abilities";

/**
 * Fights picked ahead of time for the homepage: each matchup run 120 times,
 * the most dramatic kept (scripts/showcase.ts). The same seed always plays
 * the same fight, so these are real simulations, not recordings.
 */
export const SHOWCASE: { a: AbilityId; b: AbilityId; seed: number }[] = [
  { a: "grow", b: "bomb", seed: 32 }, // 33.6s, 4 lead changes, a comeback
  { a: "clone", b: "speed", seed: 24 }, // 23.4s, 3 lead changes, a comeback
  { a: "fibonacci", b: "spike", seed: 4 }, // 24.9s
  { a: "sword", b: "heal", seed: 2 }, // 40.7s, 4 lead changes
  { a: "spike", b: "sword", seed: 98 }, // 24.2s, a comeback
  { a: "heal", b: "bomb", seed: 66 }, // 41.0s, 4 lead changes, a comeback
];
