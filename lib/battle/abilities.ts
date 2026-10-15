/**
 * The abilities a ball can have. Each is a few numbers the simulation reads,
 * plus what a viewer sees: a name for the title card, a colour, and one line
 * on what it does. Tuned so most pairings end in 15 to 45 seconds.
 */

export const ABILITY_IDS = ["spike", "fibonacci", "grow", "sword", "heal", "speed", "clone", "bomb"] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

export type Ability = {
  id: AbilityId;
  name: string;
  color: string;
  /** what it does, in one line, for the picker */
  line: string;
  hp: number;
  radius: number;
  /** damage it deals by touching an enemy */
  touch: number;
  /** pixels a second */
  speed: number;
};

export const ABILITIES: Record<AbilityId, Ability> = {
  spike: { id: "spike", name: "Spike", color: "#FF3B30", line: "Hits three times as hard as anyone else.", hp: 22, radius: 64, touch: 3, speed: 560 },
  fibonacci: { id: "fibonacci", name: "Fibonacci", color: "#FFD60A", line: "Every hit it takes, it splits: 1, 1, 2, 3, 5, 8…", hp: 12, radius: 62, touch: 1, speed: 560 },
  grow: { id: "grow", name: "Grow", color: "#34C759", line: "Gets bigger and tougher every time it bounces off a wall.", hp: 18, radius: 52, touch: 1, speed: 520 },
  sword: { id: "sword", name: "Sword", color: "#64D2FF", line: "A spinning blade that gets longer with every cut.", hp: 20, radius: 58, touch: 1, speed: 540 },
  heal: { id: "heal", name: "Heal", color: "#FF6FB5", line: "Heals a little every time it bounces off a wall.", hp: 18, radius: 62, touch: 1, speed: 560 },
  speed: { id: "speed", name: "Speed", color: "#0A84FF", line: "Faster after every bounce, and faster hits hurt more.", hp: 18, radius: 56, touch: 1, speed: 520 },
  clone: { id: "clone", name: "Clone", color: "#BF5AF2", line: "Every few bounces, a copy of itself joins the fight.", hp: 18, radius: 58, touch: 1, speed: 560 },
  bomb: { id: "bomb", name: "Bomb", color: "#FF9F0A", line: "Drops mines as it moves. Touch one and it blows.", hp: 20, radius: 60, touch: 1, speed: 540 },
};

export const isAbility = (s: unknown): s is AbilityId => typeof s === "string" && (ABILITY_IDS as readonly string[]).includes(s);

/** 1, 1, 2, 3, 5, 8, 13 … the n-th, from 1. */
export function fib(n: number): number {
  let a = 1, b = 1;
  for (let i = 2; i < n; i++) [a, b] = [b, a + b];
  return n <= 2 ? 1 : b;
}
