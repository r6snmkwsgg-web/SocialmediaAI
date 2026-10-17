import { ABILITIES, type AbilityId } from "../../battle/abilities";
import { ARENA, World, type BattleEvent, type Team } from "../../battle/sim";
import type { Viewer } from "../events";
import { DEFAULT_GIFTS, DEFAULT_PRICES, RAGE_SECONDS, tierIn, withGifts, worth, type Tier } from "../menu";
import type { GameId, LiveSettings } from "../settings";
import type { Game, GiftAct, Result, RoundStart, Said, VoteOption } from "./types";
import type { WorldOptions } from "../../battle/sim";
import { fingerprint, RecordedWorld, type RoundTape } from "../tape";

/**
 * Ball Battle: RED against BLUE. Each team has a champion ball with an
 * ability, viewers type 1 or 2 to join a team, and every gift does
 * something off the menu: heals, a ball with the gifter's face on it,
 * rage, a shield, meteors. A team is out when all its balls are.
 *
 * Every coin counts about the same, whatever the gift: a coin is 1 HP,
 * as health for the gifter's team, a ball's health, or a meteor's hit on
 * the other team. The powers come on top, so a bigger gift always does
 * at least what the same coins in Roses would, and looks it.
 */

export { RAGE_SECONDS };
export const SHIELD_SECONDS = 6;
/** the most balls a team can have at once, champion included, so it stays readable */
export const MAX_SIDE = 10;
/** a streak of balls stops at a handful; what's past it heals instead */
export const MAX_SUMMONS_AT_ONCE = 5;
/** champions start tougher than in a video, so gifts have time to matter */
export const LIVE_HP = 1.5;
/**
 * a meteor gift's worth: half heals the sender's team and half falls on the
 * other one, so two sides trading the same coins in meteors cancel out
 */
export const METEOR_HEAL = 1 / 2;
/** rage and a shield stack up to two gifts' worth at a time; past that, a gift is its coins in HP */
export const POWER_STACK = 2;
/** a meteor for about every this much of a hit, up to METEORS_MAX; past that, each one hits harder */
export const METEOR_STEP = 100;
export const METEORS_MAX = 12;
/** seconds between meteors in a shower */
export const METEOR_GAP = 0.3;
/** once the walls close in, a touch takes this share of a ball's health, so a round gifted big still ends in a knockout */
export const WALL_SHARE = 0.04;
/**
 * a meteor that would knock out a team's last ball leaves it hanging on for
 * this many seconds (in slow motion, about seven real ones), owing the rest:
 * the team's side can pay it off with gifts, likes and the rest, or it goes
 * down. So no single gift ends a round on the spot, and the same coins sent a
 * moment apart still come out even.
 */
export const HANG_ON = 4;

/** the arena's rules for a LIVE round: when the walls close in, how many balls a side can have, what the walls take, and how long a side hangs on */
export type LiveOptions = Required<WorldOptions>;

/** The arena's rules for a LIVE round this long: the walls start closing in a little past halfway, so every fight ends. */
export function liveOptions(roundSeconds: number): LiveOptions {
  return { suddenDeath: Math.max(20, Math.round(roundSeconds * 0.55)), maxTeam: MAX_SIDE, wallShare: WALL_SHARE, hangOn: HANG_ON };
}

/** Each champion's health on a LIVE: tougher than in a video, so gifts have time to matter. */
export function liveHp(a: AbilityId, b: AbilityId): [number, number] {
  return [Math.round(ABILITIES[a].hp * LIVE_HP), Math.round(ABILITIES[b].hp * LIVE_HP)];
}

/**
 * A fresh arena with each team's champion in it, where the battle has
 * always put them. A recorded one also writes down everything viewers do
 * to it, so the round can be played again exactly; it plays the same.
 */
export function liveWorld(a: AbilityId, b: AbilityId, seed: number, options: LiveOptions, hp: [number, number], record = false): World {
  const w = record ? new RecordedWorld(seed, options) : new World(seed, options);
  w.add(0, a, ARENA * 0.27, ARENA * (0.42 + w.rand() * 0.16), { hp: hp[0], maxHp: hp[0] });
  w.add(1, b, ARENA * 0.73, ARENA * (0.42 + w.rand() * 0.16), { hp: hp[1], maxHp: hp[1] });
  return w;
}

/** Who won, once it's decided: a knockout, or when time's up, whoever has more health less what a side hanging on owes. */
export function liveResult(w: World, fightMax: number): { byTime: boolean; team: Team | null } | null {
  const c0 = w.count(0), c1 = w.count(1);
  if (c0 === 0 || c1 === 0) return { byTime: false, team: c0 === 0 && c1 === 0 ? null : c0 === 0 ? 1 : 0 };
  if (w.clock >= fightMax) {
    const h0 = w.hp(0) - w.owed[0], h1 = w.hp(1) - w.owed[1];
    return { byTime: true, team: h0 === h1 ? null : h0 > h1 ? 0 : 1 };
  }
  return null;
}

export const BATTLE_MENU: Tier[] = ([
  { effect: "heal", min: 1, name: "+1 HP", gift: "Rose", line: "Heals your team 1 HP for every coin", color: "#FF6FB5", icon: "heart" },
  { effect: "small", min: 5, name: "Mini ball", gift: "Finger Heart", line: "A small ball with your face joins your team, with 1 HP for every coin", color: "#F4F1EA", icon: "person-small" },
  { effect: "ball", min: 20, name: "Big ball", gift: "Perfume", line: "A full fighter with your face joins your team, with 1 HP for every coin", color: "#34C759", icon: "person" },
  { effect: "rage", min: 99, name: "Rage 2X", gift: "Hand Hearts", line: `Your team hits twice as hard for ${RAGE_SECONDS} seconds, and heals 1 HP for every coin`, color: "#FF3B30", icon: "flame", big: true },
  { effect: "shield", min: 299, name: "Shield", gift: "Corgi", line: `Nothing but a meteor can hurt your team for ${SHIELD_SECONDS} seconds, and it heals 1 HP for every coin`, color: "#64D2FF", icon: "shield", big: true },
  { effect: "meteor", min: 999, name: "Meteor", gift: "Galaxy", line: "Meteors smash the other team's biggest ball and heal yours, more of them the bigger the gift", color: "#FF9F0A", icon: "meteor", big: true },
] as Tier[]).map((t, i) => ({ ...t, min: DEFAULT_PRICES[i], price: DEFAULT_GIFTS[i].coins }));

/** One step of what a gift does: `hp` is each ball's health, or each meteor's hit. */
export type Step = { effect: string; n: number; hp?: number };

/** A meteor shower worth `total` HP of hits: one meteor for about every METEOR_STEP, up to METEORS_MAX. */
export function meteorShower(total: number): { n: number; hit: number } {
  const n = Math.max(1, Math.min(METEORS_MAX, Math.round(total / METEOR_STEP)));
  return { n, hit: Math.max(1, Math.round(total / n)) };
}

/**
 * What a gift does, as steps. Every coin is about 1 HP: a ball carries its
 * gift's coins as health, rage and the shield heal 1 HP a coin on top of the
 * power, and a meteor gift splits its worth between hits on the other team
 * and health for the sender's. A streak of balls stops at a handful, and
 * the rest heals.
 */
export function battleSteps(effect: string, each: number, count: number): Step[] {
  const coins = each * count;
  switch (effect) {
    case "heal":
      return [{ effect: "heal", n: coins }];
    case "small":
    case "ball": {
      const balls = Math.min(count, MAX_SUMMONS_AT_ONCE);
      const out: Step[] = [{ effect, n: balls, hp: each }];
      if (count > balls) out.push({ effect: "heal", n: (count - balls) * each });
      return out;
    }
    case "rage":
    case "shield":
      return [{ effect, n: count }, { effect: "heal", n: coins }];
    default: {
      const total = worth(coins);
      const heal = Math.round(total * METEOR_HEAL);
      const { n, hit } = meteorShower(total - heal);
      return [{ effect: "meteor", n, hp: hit }, { effect: "heal", n: heal }];
    }
  }
}

const matchupKey = (a: AbilityId, b: AbilityId) => `${a}:${b}`;
const matchupLabel = (a: AbilityId, b: AbilityId) => `${ABILITIES[a].name} vs ${ABILITIES[b].name}`;

export class BattleGame implements Game {
  readonly id: GameId = "battle";
  readonly teams = true;
  readonly liveInIntro = false;
  readonly menu: Tier[];
  world!: World;
  a: AbilityId = "spike";
  b: AbilityId = "sword";
  /** this round's World seed, and each champion's health */
  seed = 0;
  hp: [number, number] = [0, 0];
  protected readonly pool: AbilityId[];
  protected readonly fightMax: number;
  /** the arena's rules for this game's rounds */
  protected readonly rules: LiveOptions;
  /** each round is written down as it reaches the arena, so the best can become a clip */
  private readonly record: boolean;
  protected teamNames: [string, string];

  constructor(s: LiveSettings) {
    this.menu = withGifts(BATTLE_MENU, s.gifts);
    this.pool = s.abilities.length >= 2 ? s.abilities : ["spike", "sword"];
    this.fightMax = s.roundSeconds;
    this.rules = liveOptions(s.roundSeconds);
    this.record = s.clips;
    this.teamNames = [s.teams[0].name, s.teams[1].name];
  }

  get events(): BattleEvent[] {
    return this.world.events;
  }

  get clock(): number {
    return this.world.clock;
  }

  /** physics steps run this round */
  get step(): number {
    return this.world.sub;
  }

  kind(side: Team): AbilityId {
    return side === 0 ? this.a : this.b;
  }

  /** "Spike", "Sword": what each team's champion is this round */
  ability(side: Team): string {
    return ABILITIES[this.kind(side)].name;
  }

  start({ option, rand }: RoundStart) {
    const picked = option?.key.split(":") as [AbilityId, AbilityId] | undefined;
    let a: AbilityId, b: AbilityId;
    if (picked && picked[0] in ABILITIES && picked[1] in ABILITIES && picked[0] !== picked[1]) [a, b] = picked;
    else {
      const last = [this.a, this.b];
      do {
        a = this.pool[Math.floor(rand() * this.pool.length)];
        b = this.pool[Math.floor(rand() * this.pool.length)];
      } while (a === b || (a === last[0] && b === last[1] && this.pool.length > 2));
    }
    this.arena(a, b, rand);
  }

  /** A fresh arena with each team's champion in it. */
  protected arena(a: AbilityId, b: AbilityId, rand: () => number) {
    this.a = a;
    this.b = b;
    this.seed = Math.floor(rand() * 2 ** 31);
    this.hp = liveHp(a, b);
    this.world = liveWorld(a, b, this.seed, this.rules, this.hp, this.record);
  }

  tick() {
    this.world.tick();
  }

  result(): Result | null {
    return liveResult(this.world, this.fightMax);
  }

  /** This round as it reached the arena, for a clip: null when rounds aren't being written down. */
  tape(): RoundTape | null {
    const w = this.world;
    if (!(w instanceof RecordedWorld)) return null;
    return { seed: this.seed, a: this.a, b: this.b, hp: this.hp, world: this.rules, fightMax: this.fightMax, inputs: w.inputs, end: w.sub, check: fingerprint(w) };
  }

  tension(): number {
    // when a team is down to its last few HP, or hanging on, slow it down so everyone sees the end, and has time to save it
    const w = this.world;
    if (this.hanging(0) || this.hanging(1)) return 0.55;
    return Math.min(w.hp(0), w.hp(1)) <= 3 && w.clock > 5 ? 0.55 : 1;
  }

  /** whether a team is hanging on after a meteor, and has until time's up to pay what it owes */
  hanging(t: Team): boolean {
    return this.world.hanging[t] > this.world.clock;
  }

  /** a team's health, less what it owes from a meteor */
  teamHp(t: Team): number {
    return this.world.hp(t) - this.world.owed[t];
  }

  count(): number {
    return this.world.count(0) + this.world.count(1);
  }

  enter(): Said | null {
    return null;
  }

  heal(_viewer: Viewer, side: Team | null, hp: number) {
    if (side !== null) this.world.heal(side, hp);
  }

  share(viewer: Viewer, side: Team | null): Said | null {
    if (side === null) return null;
    const ball = this.world.summon(side, this.kind(side), { small: true, tag: { id: viewer.id, name: viewer.name, avatar: viewer.avatar } });
    return ball ? { toast: "shared → MINI BALL" } : null;
  }

  gift({ viewer, side, tier, count, each, gift }: GiftAct): Said {
    const w = this.world;
    const team: Team = side ?? 0;
    const tag = { id: viewer.id, name: viewer.name, avatar: viewer.avatar };
    let full = 0;
    let meteors = 0;
    for (const step of battleSteps(tier.effect, each, count)) {
      const n = step.n;
      if (step.effect === "heal") {
        if (n > 0) w.heal(team, n);
      } else if (step.effect === "small" || step.effect === "ball") {
        for (let i = 0; i < n; i++) {
          if (w.summon(team, this.kind(team), { small: step.effect === "small", tag, hp: step.hp })) continue;
          // the team is full: the gift heals it instead
          const hp = step.hp ?? each;
          w.heal(team, hp);
          full += hp;
        }
      } else if (step.effect === "rage") {
        const add = Math.min(RAGE_SECONDS * n, RAGE_SECONDS * POWER_STACK - Math.max(0, w.rage[team] - w.clock));
        if (add > 0) w.enrage(team, add);
      } else if (step.effect === "shield") {
        const add = Math.min(SHIELD_SECONDS * n, SHIELD_SECONDS * POWER_STACK - Math.max(0, w.shield[team] - w.clock));
        if (add > 0) w.protect(team, add);
      } else {
        // a shower onto their strongest ball; when it's gone, the next one lands on whoever's strongest then
        for (let i = 0; i < n; i++) w.meteor(team, 0, i * METEOR_GAP, step.hp);
        meteors = n;
      }
    }
    if (tier.big) return { blast: true, many: meteors > 1 ? meteors : undefined };
    if (full > 0) return { toast: `${gift} → +${full} HP, ${this.teamNames[team].toUpperCase()} IS FULL` };
    if (tier.effect === "heal") return each * count >= 5 ? { toast: `${gift} → +${each * count} HP` } : {};
    return { toast: `${gift} → ${tier.name.toUpperCase()}` };
  }

  options(rand: () => number): VoteOption[] {
    const pairs: [AbilityId, AbilityId][] = [];
    for (const a of this.pool) for (const b of this.pool) if (a < b) pairs.push([a, b]);
    // never offer the matchup that just played
    const fresh = pairs.filter(([a, b]) => !((a === this.a && b === this.b) || (a === this.b && b === this.a)));
    const from = fresh.length >= 3 ? fresh : pairs;
    const out: VoteOption[] = [];
    const taken = new Set<number>();
    while (out.length < Math.min(3, from.length)) {
      const i = Math.floor(rand() * from.length);
      if (taken.has(i)) continue;
      taken.add(i);
      // which side each lands on is a coin flip, so neither team always gets the same one
      const [x, y] = rand() < 0.5 ? from[i] : [from[i][1], from[i][0]];
      out.push({ key: matchupKey(x, y), label: matchupLabel(x, y) });
    }
    return out;
  }
}

export { tierIn };
