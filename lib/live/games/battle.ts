import { ABILITIES, type AbilityId } from "../../battle/abilities";
import { ARENA, World, type BattleEvent, type Team } from "../../battle/sim";
import type { Viewer } from "../events";
import { DEFAULT_GIFTS, DEFAULT_PRICES, tierIn, withGifts, type Tier } from "../menu";
import type { LiveSettings } from "../settings";
import type { Game, GiftAct, Result, RoundStart, Said, VoteOption } from "./types";

/**
 * Ball Battle: RED against BLUE. Each team has a champion ball with an
 * ability, viewers type 1 or 2 to join a team, and every gift does
 * something off the menu: heals, a ball with the gifter's face on it,
 * rage, a shield, a meteor. A team is out when all its balls are.
 */

export const RAGE_SECONDS = 8;
export const SHIELD_SECONDS = 6;
export const SHIELD_HEAL = 10;
/** the most balls a team can have at once, champion included, so it stays readable */
export const MAX_SIDE = 10;
/** a streak of balls stops at a handful; what's past it heals instead */
export const MAX_SUMMONS_AT_ONCE = 5;
/** one gift of 5,000 coins or more brings down three meteors */
export const SHOWER_COINS = 5000;
/** champions start tougher than in a video, so gifts have time to matter */
export const LIVE_HP = 1.5;

export const BATTLE_MENU: Tier[] = ([
  { effect: "heal", min: 1, name: "+1 HP", gift: "Rose", line: "Heals your team 1 HP for every coin", color: "#FF6FB5", icon: "heart" },
  { effect: "small", min: 5, name: "Mini ball", gift: "Finger Heart", line: "A small ball with your face joins your team", color: "#F4F1EA", icon: "person-small" },
  { effect: "ball", min: 20, name: "Big ball", gift: "Perfume", line: "A full fighter with your face joins your team", color: "#34C759", icon: "person" },
  { effect: "rage", min: 99, name: "Rage 2X", gift: "Hand Hearts", line: `Your team hits twice as hard for ${RAGE_SECONDS} seconds`, color: "#FF3B30", icon: "flame", big: true },
  { effect: "shield", min: 299, name: "Shield", gift: "Corgi", line: `Your team can't be hurt for ${SHIELD_SECONDS} seconds, and gets ${SHIELD_HEAL} HP`, color: "#64D2FF", icon: "shield", big: true },
  { effect: "meteor", min: 999, name: "Meteor", gift: "Galaxy", line: "Smashes the other team's biggest ball", color: "#FF9F0A", icon: "meteor", big: true },
] as Tier[]).map((t, i) => ({ ...t, min: DEFAULT_PRICES[i], price: DEFAULT_GIFTS[i].coins }));

/** What a gift does, as steps: a streak of balls stops at a handful, and the rest heals. */
export function battleSteps(effect: string, each: number, count: number): { effect: string; n: number }[] {
  switch (effect) {
    case "heal":
      return [{ effect: "heal", n: each * count }];
    case "small":
    case "ball": {
      const balls = Math.min(count, MAX_SUMMONS_AT_ONCE);
      const out: { effect: string; n: number }[] = [{ effect, n: balls }];
      if (count > balls) out.push({ effect: "heal", n: (count - balls) * Math.ceil(each / 5) });
      return out;
    }
    case "rage":
      return [{ effect: "rage", n: count }];
    case "shield":
      return [{ effect: "shield", n: count }, { effect: "heal", n: SHIELD_HEAL * count }];
    default:
      return [{ effect: "meteor", n: Math.min(5, count * (each >= SHOWER_COINS ? 3 : 1)) }];
  }
}

const matchupKey = (a: AbilityId, b: AbilityId) => `${a}:${b}`;
const matchupLabel = (a: AbilityId, b: AbilityId) => `${ABILITIES[a].name} vs ${ABILITIES[b].name}`;

export class BattleGame implements Game {
  readonly id = "battle" as const;
  readonly teams = true;
  readonly liveInIntro = false;
  readonly menu: Tier[];
  world!: World;
  a: AbilityId = "spike";
  b: AbilityId = "sword";
  private readonly pool: AbilityId[];
  private readonly fightMax: number;
  private readonly sudden: number;
  private names: [string, string];

  constructor(s: LiveSettings) {
    this.menu = withGifts(BATTLE_MENU, s.gifts);
    this.pool = s.abilities.length >= 2 ? s.abilities : ["spike", "sword"];
    this.fightMax = s.roundSeconds;
    // the walls start closing in a little past halfway, so every fight ends
    this.sudden = Math.max(20, Math.round(s.roundSeconds * 0.55));
    this.names = [s.teams[0].name, s.teams[1].name];
  }

  get events(): BattleEvent[] {
    return this.world.events;
  }

  get clock(): number {
    return this.world.clock;
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
    this.a = a;
    this.b = b;
    const w = new World(Math.floor(rand() * 2 ** 31), { suddenDeath: this.sudden, maxTeam: MAX_SIDE });
    const hpA = Math.round(ABILITIES[a].hp * LIVE_HP), hpB = Math.round(ABILITIES[b].hp * LIVE_HP);
    w.add(0, a, ARENA * 0.27, ARENA * (0.42 + w.rand() * 0.16), { hp: hpA, maxHp: hpA });
    w.add(1, b, ARENA * 0.73, ARENA * (0.42 + w.rand() * 0.16), { hp: hpB, maxHp: hpB });
    this.world = w;
  }

  tick() {
    this.world.tick();
  }

  result(): Result | null {
    const w = this.world;
    const c0 = w.count(0), c1 = w.count(1);
    if (c0 === 0 || c1 === 0) return { byTime: false, team: c0 === 0 && c1 === 0 ? null : c0 === 0 ? 1 : 0 };
    if (w.clock >= this.fightMax) {
      const h0 = w.hp(0), h1 = w.hp(1);
      return { byTime: true, team: h0 === h1 ? null : h0 > h1 ? 0 : 1 };
    }
    return null;
  }

  tension(): number {
    // when a team is down to its last few HP, slow it down so everyone sees the end
    const w = this.world;
    return Math.min(w.hp(0), w.hp(1)) <= 3 && w.clock > 5 ? 0.55 : 1;
  }

  teamHp(t: Team): number {
    return this.world.hp(t);
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
    for (const step of battleSteps(tier.effect, each, count)) {
      const n = step.n;
      if (step.effect === "heal") w.heal(team, n);
      else if (step.effect === "small" || step.effect === "ball") {
        for (let i = 0; i < n; i++) {
          if (w.summon(team, this.kind(team), { small: step.effect === "small", tag })) continue;
          // the team is full: the gift heals it instead
          const hp = step.effect === "small" ? 3 : 10;
          w.heal(team, hp);
          full += hp;
        }
      } else if (step.effect === "rage") w.enrage(team, RAGE_SECONDS * n);
      else if (step.effect === "shield") w.protect(team, SHIELD_SECONDS * n);
      else for (let i = 0; i < n; i++) w.meteor(team, i, i * 0.4);
    }
    if (tier.big) return { blast: true };
    if (full > 0) return { toast: `${gift} → +${full} HP, ${this.names[team].toUpperCase()} IS FULL` };
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
