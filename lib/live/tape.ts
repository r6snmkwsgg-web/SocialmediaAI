import type { AbilityId } from "../battle/abilities";
import { METEOR_HIT, World, type Ball, type BattleEvent, type Tag, type Team } from "../battle/sim";
import type { LiveOptions } from "./games/battle";

/**
 * A LIVE round, written down as it reached the arena, so it can be played
 * again exactly. The World is deterministic: fixed steps, its own seeded
 * random numbers and its own trig. Everything viewers do reaches it through
 * five calls (heal, summon, rage, shield, meteor), always between physics
 * steps, so the seed, the champions and those calls with the step each
 * landed on are the whole round. The show around it runs on real time and
 * can't be played again, which is why the record is taken here.
 */

/** what reached the arena, at the physics step it landed on, in the order it happened; a ball keeps the viewer id it was for, never a name or picture */
export type TapeInput =
  | [step: number, op: "h", team: Team, hp: number]
  | [step: number, op: "s", team: Team, kind: AbilityId, small: 0 | 1, hp: number, viewer: string | null]
  | [step: number, op: "r" | "p", team: Team, seconds: number]
  | [step: number, op: "m", team: Team, nth: number, delay: number, hit: number];

/** A round as the game played it: what the arena needs to play it again, and how it stood when it was decided. */
export type RoundTape = {
  /** the World's seed */
  seed: number;
  /** each side's champion, and its health */
  a: AbilityId;
  b: AbilityId;
  hp: [number, number];
  world: LiveOptions;
  /** the round's time limit, in seconds */
  fightMax: number;
  inputs: TapeInput[];
  /** the step it was decided on, and the world's fingerprint then */
  end: number;
  check: string;
  /** Rivals: the round's rivalry */
  rivalry?: { id: string; group: string };
};

/**
 * A World that writes down every heal, ball, rage, shield and meteor with
 * the step it landed on, then does exactly what a plain World does. It's
 * only made for a round that's being kept, so videos and the free game
 * never pay for it.
 */
export class RecordedWorld extends World {
  readonly inputs: TapeInput[] = [];

  heal(team: Team, n: number): Ball | null {
    this.inputs.push([this.sub, "h", team, n]);
    return super.heal(team, n);
  }

  summon(team: Team, kind: AbilityId, o: { small: boolean; tag?: Tag; hp?: number }): Ball | null {
    this.inputs.push([this.sub, "s", team, kind, o.small ? 1 : 0, o.hp ?? 0, o.tag?.id ?? null]);
    return super.summon(team, kind, o);
  }

  enrage(team: Team, seconds: number) {
    this.inputs.push([this.sub, "r", team, seconds]);
    super.enrage(team, seconds);
  }

  protect(team: Team, seconds: number) {
    this.inputs.push([this.sub, "p", team, seconds]);
    super.protect(team, seconds);
  }

  meteor(team: Team, nth = 0, delay = 0, hit = METEOR_HIT): boolean {
    this.inputs.push([this.sub, "m", team, nth, delay, hit]);
    return super.meteor(team, nth, delay, hit);
  }
}

const bits = new DataView(new ArrayBuffer(8));

const KINDS: BattleEvent["type"][] = ["hit", "cut", "boom", "spawn", "heal", "ko", "summon", "power", "meteor", "saved"];

/** what an event says happened, as numbers: what, when, where, to which side and how much, never a name */
function numbers(e: BattleEvent): number[] {
  const out = [KINDS.indexOf(e.type), e.f];
  if ("x" in e) out.push(e.x, e.y);
  if ("dmg" in e) out.push(e.dmg, e.to);
  if ("team" in e) out.push(e.team);
  if ("n" in e && e.n !== undefined) out.push(e.n);
  if ("hit" in e && e.hit !== undefined) out.push(e.hit);
  if (e.type === "power") out.push(e.power === "rage" ? 1 : 2);
  if (e.type === "meteor") out.push(e.target);
  if (e.type === "summon") out.push(e.small ? 1 : 0);
  return out;
}

/**
 * The world as it stands, as 8 hex digits: FNV-1a over the exact bits of
 * the step, every live ball's id, place, speed, size, health, most health
 * and angle, the most health and last place of every ball that went down,
 * both sides' rage, shield, hanging on and what they owe, every meteor on
 * its way down, and everything that happened in the arena to get there
 * (each hit, heal, drop-in, power, meteor and knockout, when, where and how
 * much). A round that played out any differently, even by one heal's
 * amount or one step, comes out different.
 */
export function fingerprint(w: World): string {
  let h = 0x811c9dc5;
  const mix = (x: number) => {
    bits.setFloat64(0, x);
    for (let i = 0; i < 8; i++) h = Math.imul(h ^ bits.getUint8(i), 0x01000193);
  };
  mix(w.sub);
  for (const b of w.balls) for (const x of b.alive ? [b.id, b.x, b.y, b.vx, b.vy, b.r, b.hp, b.maxHp, b.angle] : [b.id, b.maxHp, b.x, b.y]) mix(x);
  for (const x of [...w.rage, ...w.shield, ...w.hanging, ...w.owed]) mix(x);
  for (const m of w.meteors) for (const x of [m.id, m.at, m.hit]) mix(x);
  for (const e of w.events) for (const x of numbers(e)) mix(x);
  return (h >>> 0).toString(16).padStart(8, "0");
}
