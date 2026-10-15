import { FPS, TICK, type BattleEvent, type Team } from "../../battle/sim";
import type { Viewer } from "../events";
import { DEFAULT_GIFTS, DEFAULT_PRICES, withGifts, type Tier } from "../menu";
import type { LiveSettings } from "../settings";
import type { Entrant, Game, GiftAct, Result, RoundStart, Said, VoteOption } from "./types";

/**
 * Last One Standing: everyone for themselves. Every viewer who types GO
 * or sends a gift gets a ball with their face on it, all the balls fight,
 * and the last one alive wins the round. Coins are health; bigger gifts
 * are spikes, a shield, a spinning sword, a meteor on the biggest rival.
 * The walls close in after a while, so every round ends. A few CPU balls
 * fight too, so it's never empty.
 */

export const ARENA = 800;
const SPEED = 300;
const MAX_FIGHTERS = 24;
const CPUS = 4;
const HIT_GAP = 0.22;
const CUT_GAP = 0.3;
/** free entries can join this far into a round; gifters can always get in */
const LATE_ENTRY = 15;
const SHRINK_TO = 360;
const SHRINK_OVER = 20;
export const SPIKES_SECONDS = 10;
export const SHIELD_SECONDS = 6;
export const SWORD_SECONDS = 12;
const BLADE = 100;
const METEOR_HIT = 15;
const METEOR_SPLASH = 6;
const METEOR_FALL = 1.2;

export const ROYALE_MENU: Tier[] = ([
  { effect: "join", min: 1, name: "Join +HP", gift: "Rose", line: "Your ball joins the fight, and every coin is +1 HP", color: "#FF6FB5", icon: "heart" },
  { effect: "big", min: 5, name: "Big ball", gift: "Finger Heart", line: "+8 HP and a bigger ball", color: "#34C759", icon: "person" },
  { effect: "spikes", min: 20, name: "Spikes 2X", gift: "Perfume", line: `Your hits do double damage for ${SPIKES_SECONDS} seconds`, color: "#FF3B30", icon: "spikes" },
  { effect: "shield", min: 99, name: "Shield", gift: "Hand Hearts", line: `Nothing can hurt your ball for ${SHIELD_SECONDS} seconds`, color: "#64D2FF", icon: "shield", big: true },
  { effect: "sword", min: 299, name: "Sword", gift: "Corgi", line: `A blade spins around your ball for ${SWORD_SECONDS} seconds`, color: "#F4F1EA", icon: "sword", big: true },
  { effect: "meteor", min: 999, name: "Meteor", gift: "Galaxy", line: "Smashes your biggest rival", color: "#FF9F0A", icon: "meteor", big: true },
] as Tier[]).map((t, i) => ({ ...t, min: DEFAULT_PRICES[i], price: DEFAULT_GIFTS[i].coins }));

export const ARENAS: VoteOption[] = [
  { key: "big", label: "Big arena" },
  { key: "tiny", label: "Tiny arena" },
  { key: "fast", label: "Fast balls" },
];

export type Fighter = Entrant & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  alive: boolean;
  born: number;
  fresh: number;
  spikesUntil: number;
  shieldUntil: number;
  swordUntil: number;
  angle: number;
  /** when it went out, for the podium */
  outAt: number;
};

export const radiusOf = (maxHp: number) => Math.min(72, 24 + 4.2 * Math.sqrt(Math.max(1, maxHp)));

export class RoyaleGame implements Game {
  readonly id = "royale" as const;
  readonly teams = false;
  readonly liveInIntro = true;
  readonly menu: Tier[];
  readonly events: BattleEvent[] = [];
  clock = 0;
  arena = "big";
  fighters: Fighter[] = [];
  readonly meteors: { id: number; target: string; x: number; y: number; from: number; at: number }[] = [];
  private rand: () => number = Math.random;
  private speedMul = 1;
  private suddenAt = 40;
  private startSize = ARENA;
  private readonly maxSeconds: number;
  private readonly hitAt = new Map<string, number>();
  private readonly waiting = new Map<string, Viewer>();
  private nextId = 1;

  constructor(s: LiveSettings) {
    this.menu = withGifts(ROYALE_MENU, s.gifts);
    this.maxSeconds = s.roundSeconds;
  }

  private get f(): number {
    return Math.floor(this.clock * FPS);
  }

  /** has sudden death started? */
  get sudden(): boolean {
    return this.clock >= this.suddenAt;
  }

  /** the walls: the full arena, then closing in once sudden death starts */
  bounds(): { lo: number; size: number } {
    const k = Math.min(1, Math.max(0, (this.clock - this.suddenAt) / SHRINK_OVER));
    const size = this.startSize - (this.startSize - SHRINK_TO) * k;
    return { lo: (ARENA - size) / 2, size };
  }

  start({ option, rand }: RoundStart) {
    this.rand = rand;
    this.arena = option && ARENAS.some((a) => a.key === option.key) ? option.key : "big";
    this.speedMul = this.arena === "fast" ? 1.4 : 1;
    this.startSize = this.arena === "tiny" ? 580 : ARENA;
    this.suddenAt = this.arena === "big" ? Math.round(this.maxSeconds * 0.45) : Math.round(this.maxSeconds * 0.3);
    this.clock = 0;
    this.events.length = 0;
    this.meteors.length = 0;
    this.hitAt.clear();
    this.fighters = [];
    for (let i = 0; i < CPUS; i++) this.add({ id: `cpu-${i + 1}`, name: `CPU ${i + 1}`, cpu: true }, 5);
    for (const v of this.waiting.values()) this.add({ id: v.id, name: v.name, avatar: v.avatar }, 3);
    this.waiting.clear();
  }

  private add(e: Entrant, hp: number): Fighter {
    const { lo, size } = this.bounds();
    const r = radiusOf(hp);
    const ang = this.rand() * Math.PI * 2;
    const speed = SPEED * this.speedMul;
    const f: Fighter = {
      ...e, x: lo + r + this.rand() * (size - 2 * r), y: lo + r + this.rand() * (size - 2 * r),
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r, hp, maxHp: hp, speed,
      alive: true, born: this.clock, fresh: this.clock + 0.8, spikesUntil: 0, shieldUntil: 0, swordUntil: 0,
      angle: this.rand() * Math.PI * 2, outAt: 0,
    };
    this.fighters.push(f);
    // in the countdown nothing moves, so a drop-in ring would just hang there
    if (this.clock > 0) this.events.push({ f: this.f, type: "summon", x: f.x, y: f.y, team: 0, name: e.name, small: hp < 6, color: e.cpu ? "#8D8A83" : "#FFD60A" });
    return f;
  }

  private find(id: string): Fighter | undefined {
    return this.fighters.find((f) => f.id === id && f.alive);
  }

  alive(): Fighter[] {
    return this.fighters.filter((f) => f.alive);
  }

  private grow(f: Fighter, hp: number) {
    f.hp += hp;
    f.maxHp = Math.max(f.maxHp, f.hp);
    f.r = radiusOf(f.maxHp);
  }

  enter(viewer: Viewer): Said | null {
    if (this.find(viewer.id)) return null;
    if (this.clock > LATE_ENTRY) {
      this.waiting.set(viewer.id, viewer);
      return { toast: "is in the next round" };
    }
    if (this.alive().length >= MAX_FIGHTERS) return { toast: "it's full · send a gift to get in" };
    this.add({ id: viewer.id, name: viewer.name, avatar: viewer.avatar }, 3);
    return { toast: "joined the fight" };
  }

  gift({ viewer, tier, count, each, gift }: GiftAct): Said {
    let f = this.find(viewer.id);
    let joined = false;
    if (!f) {
      // a gifter always gets in: a CPU makes way if it's full
      if (this.alive().length >= MAX_FIGHTERS) {
        const cpu = this.fighters.find((x) => x.alive && x.cpu);
        if (cpu) cpu.alive = false;
        else return { toast: "it's full" };
      }
      f = this.add({ id: viewer.id, name: viewer.name, avatar: viewer.avatar }, 3);
      joined = true;
    }
    // every coin is health
    this.grow(f, each * count);
    if (tier.effect === "big") this.grow(f, 8 * count);
    else if (tier.effect === "spikes") f.spikesUntil = Math.max(f.spikesUntil, this.clock) + SPIKES_SECONDS * count;
    else if (tier.effect === "shield") {
      f.shieldUntil = Math.max(f.shieldUntil, this.clock) + SHIELD_SECONDS * count;
      this.events.push({ f: this.f, type: "power", team: 0, power: "shield" });
    } else if (tier.effect === "sword") f.swordUntil = Math.max(f.swordUntil, this.clock) + SWORD_SECONDS * count;
    else if (tier.effect === "meteor") for (let i = 0; i < Math.min(count, 5); i++) this.meteor(f, i, i * 0.4);
    if (tier.big) return { blast: true };
    if (joined) return { toast: `joined the fight · ${gift}` };
    if (tier.effect === "spikes") return { toast: `${gift} → SPIKES 2X` };
    if (tier.effect === "big") return { toast: `${gift} → BIG BALL` };
    return each * count >= 5 ? { toast: `${gift} → +${each * count} HP` } : {};
  }

  heal(viewer: Viewer, _side: Team | null, hp: number) {
    const f = this.find(viewer.id);
    if (f) {
      this.grow(f, hp);
      this.events.push({ f: this.f, type: "heal", x: f.x, y: f.y, team: 0, n: hp });
    }
  }

  share(viewer: Viewer): Said | null {
    if (this.find(viewer.id)) {
      this.heal(viewer, null, 2);
      return { toast: "shared → +2 HP" };
    }
    return this.enter(viewer);
  }

  private meteor(from: Fighter, nth: number, delay: number) {
    const foes = this.alive().filter((f) => f !== from).sort((a, b) => b.hp - a.hp);
    if (foes.length === 0) return;
    const target = foes[nth % foes.length];
    const at = this.clock + delay;
    this.meteors.push({ id: this.nextId++, target: target.id, x: target.x, y: target.y, from: at, at: at + METEOR_FALL });
    this.events.push({ f: this.f, type: "meteor", x: target.x, y: target.y, team: 0, target: 0 });
  }

  private ready(key: string, gap: number): boolean {
    const last = this.hitAt.get(key);
    if (last !== undefined && this.clock - last < gap) return false;
    this.hitAt.set(key, this.clock);
    return true;
  }

  private hurt(f: Fighter, dmg: number) {
    if (!f.alive || f.shieldUntil > this.clock || dmg <= 0) return;
    f.hp = Math.max(0, f.hp - dmg);
    if (f.hp > 0) return;
    f.alive = false;
    f.outAt = this.clock;
    const left = this.alive().length;
    this.events.push({ f: this.f, type: "ko", x: f.x, y: f.y, team: 0, last: left <= 1, color: f.cpu ? "#8D8A83" : "#FFD60A" });
  }

  tick() {
    const dt = TICK;
    this.clock += dt;
    const { lo, size } = this.bounds();
    const hi = lo + size;
    const sudden = this.clock >= this.suddenAt;
    const live = this.alive();

    for (const p of live) {
      p.r = Math.min(p.r, size / 2 - 4);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.swordUntil > this.clock) p.angle += 5.2 * dt;
      let bounced = false;
      if (p.x - p.r < lo) { p.x = lo + p.r; p.vx = Math.abs(p.vx); bounced = true; }
      if (p.x + p.r > hi) { p.x = hi - p.r; p.vx = -Math.abs(p.vx); bounced = true; }
      if (p.y - p.r < lo) { p.y = lo + p.r; p.vy = Math.abs(p.vy); bounced = true; }
      if (p.y + p.r > hi) { p.y = hi - p.r; p.vy = -Math.abs(p.vy); bounced = true; }
      // once the walls close in, touching them hurts
      if (bounced && sudden) this.hurt(p, 1);
    }

    for (const m of this.meteors) {
      if (m.at > this.clock) continue;
      const t = this.fighters.find((f) => f.id === m.target && f.alive);
      if (t) { m.x = t.x; m.y = t.y; }
      for (const o of this.alive()) {
        if (o === t) this.hurt(o, METEOR_HIT);
        else if (Math.hypot(o.x - m.x, o.y - m.y) <= 160 + o.r) this.hurt(o, METEOR_SPLASH);
      }
      this.events.push({ f: this.f, type: "boom", x: m.x, y: m.y, dmg: METEOR_HIT, to: 0 });
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) if (this.meteors[i].at <= this.clock) this.meteors.splice(i, 1);

    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      if (!p.alive) continue;
      for (let j = i + 1; j < live.length; j++) {
        const q = live[j];
        if (!q.alive) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const overlap = p.r + q.r - d;
        if (overlap <= 0) continue;
        const nx = dx / d, ny = dy / d;
        p.x -= (nx * overlap) / 2; p.y -= (ny * overlap) / 2;
        q.x += (nx * overlap) / 2; q.y += (ny * overlap) / 2;
        const pn = p.vx * nx + p.vy * ny, qn = q.vx * nx + q.vy * ny;
        if (pn - qn > 0) {
          p.vx += (qn - pn) * nx; p.vy += (qn - pn) * ny;
          q.vx += (pn - qn) * nx; q.vy += (pn - qn) * ny;
        }
        if (p.fresh > this.clock || q.fresh > this.clock || !this.ready(`${p.id}|${q.id}`, HIT_GAP)) continue;
        const toQ = p.spikesUntil > this.clock ? 2 : 1, toP = q.spikesUntil > this.clock ? 2 : 1;
        const cx = p.x + nx * p.r, cy = p.y + ny * p.r;
        if (q.shieldUntil <= this.clock) this.events.push({ f: this.f, type: "hit", x: q.x, y: q.y - q.r, cx, cy, dmg: toQ, to: 0 });
        if (p.shieldUntil <= this.clock) this.events.push({ f: this.f, type: "hit", x: p.x, y: p.y - p.r, cx, cy, dmg: toP, to: 0 });
        this.hurt(q, toQ);
        this.hurt(p, toP);
      }
    }

    // swords cut whatever they sweep through
    for (const p of this.alive()) {
      if (p.swordUntil <= this.clock) continue;
      const ux = Math.cos(p.angle), uy = Math.sin(p.angle);
      const x0 = p.x + ux * p.r, y0 = p.y + uy * p.r;
      for (const o of this.alive()) {
        if (o === p || o.fresh > this.clock) continue;
        const along = Math.max(0, Math.min(BLADE, (o.x - x0) * ux + (o.y - y0) * uy));
        const px = x0 + ux * along, py = y0 + uy * along;
        if (Math.hypot(o.x - px, o.y - py) > o.r || !this.ready(`c${p.id}|${o.id}`, CUT_GAP)) continue;
        this.events.push({ f: this.f, type: "cut", x: px, y: py, dmg: 2, to: 0 });
        this.hurt(o, 2);
      }
    }

    for (const p of this.alive()) {
      const v = Math.hypot(p.vx, p.vy) || 1;
      p.vx = (p.vx / v) * p.speed;
      p.vy = (p.vy / v) * p.speed;
    }
  }

  result(): Result | null {
    const live = this.alive();
    const timeUp = this.clock >= this.maxSeconds;
    if (live.length > 1 && !timeUp) return null;
    const entrant = (f: Fighter): Entrant => ({ id: f.id, name: f.name, avatar: f.avatar, cpu: f.cpu });
    // the podium: whoever's still in by health, then the last to go out
    const order = [...live.sort((a, b) => b.hp - a.hp), ...this.fighters.filter((f) => !f.alive && f.outAt > 0).sort((a, b) => b.outAt - a.outAt)];
    return { byTime: live.length > 1, champion: order[0] ? entrant(order[0]) : null, podium: order.slice(0, 3).map(entrant) };
  }

  tension(): number {
    const live = this.alive();
    return live.length === 2 && Math.min(live[0].hp, live[1].hp) <= 3 ? 0.55 : 1;
  }

  options(rand: () => number): VoteOption[] {
    const out = [...ARENAS];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  count(): number {
    return this.alive().length;
  }
}
