import { FPS, TICK, type BattleEvent, type Team } from "../../battle/sim";
import type { Viewer } from "../events";
import { DEFAULT_GIFTS, DEFAULT_PRICES, timesOver, withGifts, type Tier } from "../menu";
import type { LiveSettings } from "../settings";
import type { Entrant, Game, GiftAct, Result, RoundStart, Said, VoteOption } from "./types";

/**
 * Ball Race: every viewer's ball races down a marble-run board, and the
 * first across the line wins. Typing GO gets you in for free, light;
 * every coin gifted makes your ball heavier, and heavier balls fall
 * faster and shove lighter ones aside. Bigger gifts are power-ups you can
 * use mid-race: a boost, a ghost that slips through pegs, a shockwave, a
 * rocket to the last ramp. A few CPU balls race too, so there's always a
 * field to beat.
 */

export const BOARD = 800;
export const FINISH = 760;
const G = 900;
const VT = 250;
const MAX_RACERS = 24;
const CPUS = 3;
const GHOST_SECONDS = 4;
const STUN_SECONDS = 1.2;
const SHOCK_RANGE = 260;
const HIT_GAP = 0.25;
/** the most power-ups one gift sets off */
const MAX_POWERS = 3;

export const RACE_MENU: Tier[] = ([
  { effect: "enter", min: 1, name: "Join +weight", gift: "Rose", line: "Your ball joins the race, and every coin makes it heavier", color: "#FF6FB5", icon: "plus" },
  { effect: "heavy", min: 5, name: "Heavy ball", gift: "Finger Heart", line: "Your ball gets much heavier: heavy balls fall faster and shove others aside", color: "#F4F1EA", icon: "weight" },
  { effect: "boost", min: 20, name: "Boost", gift: "Perfume", line: "A burst of speed for your ball", color: "#34C759", icon: "boost" },
  { effect: "ghost", min: 99, name: "Ghost", gift: "Hand Hearts", line: `Your ball slips through pegs and other balls for ${GHOST_SECONDS} seconds`, color: "#BF5AF2", icon: "ghost", big: true },
  { effect: "shock", min: 299, name: "Shockwave", gift: "Corgi", line: "Knocks every ball near yours back and stuns it", color: "#64D2FF", icon: "wave", big: true },
  { effect: "rocket", min: 999, name: "Rocket", gift: "Galaxy", line: "Blasts your ball down to the last stretch, and a gift worth several of these adds a shockwave and a ghost", color: "#FF9F0A", icon: "rocket", big: true },
] as Tier[]).map((t, i) => ({ ...t, min: DEFAULT_PRICES[i], price: DEFAULT_GIFTS[i].coins }));

export type Seg = { x1: number; y1: number; x2: number; y2: number };
export type Peg = { x: number; y: number; r: number };

export type Racer = Entrant & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  weight: number;
  /** a gift's worth of extra weight beyond its coins */
  bonus: number;
  ghostUntil: number;
  stunUntil: number;
  /** when it joined, for the drop-in pop */
  born: number;
  finishedAt: number | null;
  place: number;
  /** power-ups bought before the start, to fire on release */
  queued: string[];
  /** how long it's been stuck, barely moving */
  still: number;
  free: boolean;
};

export const LAYOUTS: VoteOption[] = [
  { key: "zigzag", label: "Zigzag" },
  { key: "pegs", label: "Peg forest" },
  { key: "funnels", label: "Funnels" },
];

/** One ramp across the board, sloping down to a gap at one side. */
function ramp(y: number, toRight: boolean): Seg {
  return toRight ? { x1: 0, y1: y, x2: 630, y2: y + 58 } : { x1: BOARD, y1: y, x2: 170, y2: y + 58 };
}

/**
 * A board from a layout and a seed: ramps to roll down, pegs to bounce
 * off, funnels that make balls queue. Every layout has ramps, so a race
 * takes long enough for power-ups to matter; where the last stretch
 * starts is where a rocket lands.
 */
export function buildBoard(layout: string, rand: () => number): { segs: Seg[]; pegs: Peg[]; rocketY: number; drag: number } {
  const segs: Seg[] = [];
  const pegs: Peg[] = [];
  const jitter = (n: number) => (rand() - 0.5) * n;
  if (layout === "pegs") {
    // a real Plinko: staggered rows, far enough apart that the biggest ball
    // fits through any gap, and thick air so the fall takes a while
    for (let row = 0, y = 150; y <= 700; row++, y += 90) {
      for (let x = row % 2 ? 100 : 50; x <= BOARD - 40; x += 100) if (rand() > 0.1) pegs.push({ x: x + jitter(6), y, r: 9 });
    }
    return { segs, pegs, rocketY: 620, drag: 0.32 };
  }
  if (layout === "funnels") {
    // funnels make balls queue at the neck; a ramp under each carries them on
    for (const [y, toRight] of [[150, true], [404, false]] as const) {
      segs.push({ x1: 0, y1: y - 60, x2: 345, y2: y + 20 });
      segs.push({ x1: BOARD, y1: y - 60, x2: BOARD - 345, y2: y + 20 });
      segs.push(ramp(y + 96, toRight));
    }
    segs.push(ramp(640, true));
    return { segs, pegs, rocketY: 600, drag: 1 };
  }
  // zigzag: ramps that slope one way then the other, a gap at each low end
  for (let i = 0; i < 5; i++) {
    const y = 150 + i * 118;
    segs.push(ramp(y, i % 2 === 0));
  }
  return { segs, pegs, rocketY: 150 + 4 * 118 - 40, drag: 1 };
}

/** heavier balls are bigger, and fall faster: drag matters less to them */
export const radiusOf = (w: number) => Math.min(38, 26 + 3 * Math.log2(Math.max(1, w)));
export const speedOf = (w: number) => Math.min(2.4, 1 + 0.42 * Math.log10(Math.max(1, w)));

export class RaceGame implements Game {
  readonly id = "race" as const;
  readonly teams = false;
  readonly liveInIntro = true;
  readonly menu: Tier[];
  readonly events: BattleEvent[] = [];
  clock = 0;
  layout = "zigzag";
  segs: Seg[] = [];
  pegs: Peg[] = [];
  racers: Racer[] = [];
  private rocketY = 600;
  /** how thick the air is on this board: below 1 slows everything down */
  private drag = 1;
  private placed = 0;
  private firstAt: number | null = null;
  private rand: () => number = Math.random;
  private readonly maxSeconds: number;
  private readonly hitAt = new Map<string, number>();
  /** free entries that came in after the start, for the next race */
  private readonly waiting = new Map<string, Viewer>();

  constructor(s: LiveSettings) {
    this.menu = withGifts(RACE_MENU, s.gifts);
    this.maxSeconds = Math.min(s.roundSeconds, 75);
  }

  private get f(): number {
    return Math.floor(this.clock * FPS);
  }

  /** has the race started? Before that, everyone waits in the gate */
  get running(): boolean {
    return this.clock > 0;
  }

  start({ option, rand }: RoundStart) {
    this.rand = rand;
    this.layout = option && LAYOUTS.some((l) => l.key === option.key) ? option.key : LAYOUTS[Math.floor(rand() * LAYOUTS.length)].key;
    const b = buildBoard(this.layout, rand);
    this.segs = b.segs;
    this.pegs = b.pegs;
    this.rocketY = b.rocketY;
    this.drag = b.drag;
    this.clock = 0;
    this.placed = 0;
    this.firstAt = null;
    this.events.length = 0;
    this.hitAt.clear();
    this.racers = [];
    for (let i = 0; i < CPUS; i++) this.add({ id: `cpu-${i + 1}`, name: `CPU ${i + 1}`, cpu: true }, 1, false);
    for (const v of this.waiting.values()) this.add({ id: v.id, name: v.name, avatar: v.avatar }, 1, true);
    this.waiting.clear();
  }

  private add(e: Entrant, weight: number, free: boolean): Racer {
    const r = radiusOf(weight);
    const racer: Racer = {
      ...e, x: 0, y: 0, vx: 0, vy: 0, r, weight, bonus: 0, ghostUntil: 0, stunUntil: 0,
      born: this.clock, finishedAt: null, place: 0, queued: [], still: 0, free,
    };
    this.racers.push(racer);
    if (this.running) {
      // a late entry drops in from the top
      racer.x = r + this.rand() * (BOARD - 2 * r);
      racer.y = 40;
    } else this.lineUp();
    if (this.running) this.events.push({ f: this.f, type: "summon", x: racer.x, y: racer.y, team: 0, name: e.name, small: free, color: e.cpu ? "#8D8A83" : "#FFD60A" });
    return racer;
  }

  /** Before the start: everyone in the gate, across the top in one or two rows. */
  private lineUp() {
    const n = this.racers.length;
    const rows = n > 12 ? 2 : 1;
    const per = Math.ceil(n / rows);
    this.racers.forEach((r, i) => {
      const row = Math.floor(i / per), col = i % per;
      r.x = (BOARD / (per + 1)) * (col + 1);
      r.y = 46 + row * 52;
    });
  }

  private find(id: string): Racer | undefined {
    return this.racers.find((r) => r.id === id);
  }

  private reweigh(r: Racer, viewerCoins: number) {
    r.weight = Math.max(r.weight, 1 + viewerCoins + r.bonus);
    r.r = radiusOf(r.weight);
  }

  /** Make room for a gifter in a full race: a CPU goes first, then the newest free entry. */
  private makeRoom(): boolean {
    if (this.racers.length < MAX_RACERS) return true;
    const out = this.racers.findIndex((r) => r.cpu && r.finishedAt === null) >= 0
      ? this.racers.findIndex((r) => r.cpu && r.finishedAt === null)
      : this.racers.map((r, i) => (r.free && r.finishedAt === null ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    if (out < 0) return false;
    this.racers.splice(out, 1);
    return true;
  }

  enter(viewer: Viewer): Said | null {
    if (this.find(viewer.id)) return null;
    if (this.running) {
      this.waiting.set(viewer.id, viewer);
      return { toast: "is in the next race" };
    }
    if (this.racers.length >= MAX_RACERS) return { toast: "race is full · send a gift to get in" };
    this.add({ id: viewer.id, name: viewer.name, avatar: viewer.avatar }, 1, true);
    return { toast: "joined the race" };
  }

  gift({ viewer, tier, count, each, total, gift }: GiftAct): Said {
    let r = this.find(viewer.id);
    let joined = false;
    if (!r) {
      if (!this.makeRoom()) return { toast: "race is full" };
      r = this.add({ id: viewer.id, name: viewer.name, avatar: viewer.avatar }, 1, false);
      joined = true;
    }
    r.free = false;
    if (tier.effect === "heavy") r.bonus += 10 * count;
    this.reweigh(r, total);
    let powers: string[] = [];
    if (tier.effect === "rocket") {
      // more than one rocket can't take a ball further, so a bigger gift adds the powers under it
      powers = ["rocket", "shock", "ghost"].slice(0, Math.min(MAX_POWERS, count * timesOver(each, tier)));
    } else if (tier.effect === "boost" || tier.effect === "ghost" || tier.effect === "shock") {
      powers = Array<string>(Math.min(count, MAX_POWERS)).fill(tier.effect);
    }
    for (const p of powers) {
      if (this.running && r.finishedAt === null) this.power(r, p);
      else r.queued.push(p);
    }
    if (tier.big) {
      // "×3" only for three of the same; a rocket's shockwave and ghost are named, not counted as rockets
      const same = powers.every((p) => p === powers[0]);
      return { blast: true, many: same && powers.length > 1 ? powers.length : undefined, extra: same ? undefined : powers.slice(1) };
    }
    if (joined) return { toast: `joined the race · ${gift}` };
    if (tier.effect === "heavy") return { toast: `${gift} → HEAVY BALL` };
    if (tier.effect === "boost") return { toast: `${gift} → BOOST` };
    return { toast: `${gift} → heavier` };
  }

  heal(viewer: Viewer, _side: Team | null, n: number) {
    const r = this.find(viewer.id);
    if (!r) return;
    r.bonus += n;
    r.weight += n;
    r.r = radiusOf(r.weight);
  }

  share(viewer: Viewer): Said | null {
    const r = this.find(viewer.id);
    if (r) {
      this.heal(viewer, null, 2);
      return { toast: "shared → heavier" };
    }
    return this.enter(viewer);
  }

  /** A power-up going off on a ball. */
  private power(r: Racer, effect: string) {
    if (effect === "boost") {
      const sp = Math.hypot(r.vx, r.vy);
      const ux = sp > 40 ? r.vx / sp : 0, uy = sp > 40 ? r.vy / sp : 1;
      r.vx += ux * 460 * this.drag;
      r.vy += uy * 460 * this.drag;
      this.events.push({ f: this.f, type: "spawn", x: r.x, y: r.y, team: 0, n: 0 });
    } else if (effect === "ghost") {
      r.ghostUntil = Math.max(r.ghostUntil, this.clock) + GHOST_SECONDS;
      this.events.push({ f: this.f, type: "power", team: 0, power: "shield" });
    } else if (effect === "shock") {
      for (const o of this.racers) {
        if (o === r || o.finishedAt !== null) continue;
        const dx = o.x - r.x, dy = o.y - r.y, d = Math.hypot(dx, dy) || 1;
        if (d > SHOCK_RANGE) continue;
        const push = 520 * (1 - d / SHOCK_RANGE) + 160;
        o.vx += (dx / d) * push;
        o.vy += (dy / d) * push - 260;
        o.stunUntil = this.clock + STUN_SECONDS;
      }
      this.events.push({ f: this.f, type: "boom", x: r.x, y: r.y, dmg: 0, to: 0 });
    } else if (effect === "rocket") {
      this.events.push({ f: this.f, type: "meteor", x: r.x, y: r.y, team: 0, target: 0 });
      r.y = Math.max(r.y, this.rocketY);
      r.x = Math.min(BOARD - r.r, Math.max(r.r, r.x));
      r.vx = 0;
      r.vy = 120;
      this.events.push({ f: this.f, type: "boom", x: r.x, y: r.y, dmg: 0, to: 0 });
    }
  }

  private ready(key: string): boolean {
    const last = this.hitAt.get(key);
    if (last !== undefined && this.clock - last < HIT_GAP) return false;
    this.hitAt.set(key, this.clock);
    return true;
  }

  tick() {
    const dt = TICK;
    const first = this.clock === 0;
    this.clock += dt;
    if (first) {
      // the gate's order is a coin toss each race, so a starting spot is luck, not an edge
      const spots = this.racers.map((r) => ({ x: r.x, y: r.y }));
      for (let i = spots.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [spots[i], spots[j]] = [spots[j], spots[i]];
      }
      this.racers.forEach((r, i) => Object.assign(r, spots[i]));
      for (const r of this.racers) for (const e of r.queued.splice(0)) this.power(r, e);
    }
    const live = this.racers.filter((r) => r.finishedAt === null);

    for (const r of live) {
      const ghost = r.ghostUntil > this.clock;
      const stunned = r.stunUntil > this.clock;
      // heavier balls drop harder: it's a game, and the gift menu promises it
      r.vy += G * this.drag * this.drag * Math.sqrt(speedOf(r.weight)) * dt;
      // drag pulls each ball toward its own top speed: heavier ones are faster
      const top = VT * this.drag * speedOf(r.weight) * (stunned ? 0.45 : 1);
      const sp = Math.hypot(r.vx, r.vy);
      if (sp > top) {
        const k = Math.max(top / sp, 1 - 5 * dt);
        r.vx *= k;
        r.vy *= k;
      }
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      if (r.x < r.r) { r.x = r.r; r.vx = Math.abs(r.vx) * 0.4; }
      if (r.x > BOARD - r.r) { r.x = BOARD - r.r; r.vx = -Math.abs(r.vx) * 0.4; }
      if (r.y < r.r) { r.y = r.r; r.vy = Math.abs(r.vy) * 0.3; }
      for (const s of this.segs) this.hitSeg(r, s, dt);
      if (!ghost) for (const p of this.pegs) this.hitPeg(r, p);
      // nothing stays wedged for long: a ball that's barely moving gets a shake
      r.still = Math.hypot(r.vx, r.vy) < 25 ? r.still + dt : 0;
      if (r.still > 1.2) {
        r.vx += (this.rand() < 0.5 ? -1 : 1) * 220;
        r.vy -= 120;
        r.still = 0;
      }
      if (r.y - r.r > FINISH) {
        r.finishedAt = this.clock;
        r.place = ++this.placed;
        if (this.firstAt === null) this.firstAt = this.clock;
        r.y = FINISH + 18;
        this.events.push({ f: this.f, type: "spawn", x: r.x, y: FINISH, team: 0, n: r.place });
      }
    }

    // balls shove each other: the heavier one barely moves
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      if (p.finishedAt !== null || p.ghostUntil > this.clock) continue;
      for (let j = i + 1; j < live.length; j++) {
        const q = live[j];
        if (q.finishedAt !== null || q.ghostUntil > this.clock) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const overlap = p.r + q.r - d;
        if (overlap <= 0) continue;
        const nx = dx / d, ny = dy / d;
        const ip = 1 / p.weight, iq = 1 / q.weight;
        p.x -= nx * overlap * (ip / (ip + iq));
        p.y -= ny * overlap * (ip / (ip + iq));
        q.x += nx * overlap * (iq / (ip + iq));
        q.y += ny * overlap * (iq / (ip + iq));
        const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
        if (rel >= 0) continue;
        const jm = (-(1 + 0.5) * rel) / (ip + iq);
        p.vx -= jm * ip * nx;
        p.vy -= jm * ip * ny;
        q.vx += jm * iq * nx;
        q.vy += jm * iq * ny;
        if (Math.abs(rel) > 120 && this.ready(`${p.id}|${q.id}`)) {
          this.events.push({ f: this.f, type: "hit", x: q.x, y: q.y - q.r, cx: p.x + nx * p.r, cy: p.y + ny * p.r, dmg: 0, to: 0 });
        }
      }
    }
  }

  private hitSeg(r: Racer, s: Seg, dt: number) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((r.x - s.x1) * dx + (r.y - s.y1) * dy) / len2));
    const cx = s.x1 + t * dx, cy = s.y1 + t * dy;
    const ex = r.x - cx, ey = r.y - cy;
    const d = Math.hypot(ex, ey);
    if (d >= r.r || d === 0) return;
    const nx = ex / d, ny = ey / d;
    r.x += nx * (r.r - d);
    r.y += ny * (r.r - d);
    const vn = r.vx * nx + r.vy * ny;
    if (vn < 0) {
      r.vx -= 1.25 * vn * nx;
      r.vy -= 1.25 * vn * ny;
    }
    // a little rolling resistance along the ramp, less for heavy balls
    const keep = 1 - (0.9 * dt) / speedOf(r.weight) ** 2;
    const tx = r.vx - (r.vx * nx + r.vy * ny) * nx, ty = r.vy - (r.vx * nx + r.vy * ny) * ny;
    r.vx -= tx * (1 - keep);
    r.vy -= ty * (1 - keep);
  }

  private hitPeg(r: Racer, p: Peg) {
    const dx = r.x - p.x, dy = r.y - p.y;
    const d = Math.hypot(dx, dy);
    const min = r.r + p.r;
    if (d >= min || d === 0) return;
    const nx = dx / d, ny = dy / d;
    r.x = p.x + nx * min;
    r.y = p.y + ny * min;
    const vn = r.vx * nx + r.vy * ny;
    if (vn < 0) {
      // heavy balls plow through: a peg turns them less
      const k = 1 + 0.45 / speedOf(r.weight) ** 2;
      r.vx -= k * vn * nx;
      r.vy -= k * vn * ny;
      // a nudge, so balls don't balance on a peg
      r.vx += (this.rand() - 0.5) * 40;
      if (Math.abs(vn) > 150 && this.ready(`peg${r.id}`)) this.events.push({ f: this.f, type: "hit", x: r.x, y: r.y - r.r, cx: p.x + nx * p.r, cy: p.y + ny * p.r, dmg: 0, to: 0 });
    }
  }

  result(): Result | null {
    const done = this.racers.filter((r) => r.finishedAt !== null).sort((a, b) => a.place - b.place);
    const live = this.racers.length - done.length;
    // the winner's in: give the next couple a moment to cross for the podium
    const settle = this.firstAt !== null && (done.length >= 3 || live === 0 || this.clock - this.firstAt >= 2.5);
    const timeUp = this.clock >= this.maxSeconds;
    if (!settle && !timeUp) return null;
    const rest = this.racers.filter((r) => r.finishedAt === null).sort((a, b) => b.y - a.y);
    const order = [...done, ...rest];
    const entrant = (r: Racer): Entrant => ({ id: r.id, name: r.name, avatar: r.avatar, cpu: r.cpu });
    return { byTime: done.length === 0, champion: order[0] ? entrant(order[0]) : null, podium: order.slice(0, 3).map(entrant) };
  }

  tension(): number {
    // a photo finish: two balls closing on the line together
    if (this.firstAt !== null) return 1;
    const near = this.racers.filter((r) => r.finishedAt === null && FINISH - r.y < 140);
    return near.length >= 2 ? 0.5 : 1;
  }

  options(rand: () => number): VoteOption[] {
    const out = [...LAYOUTS];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  count(): number {
    return this.racers.length;
  }

  /** where everyone is, leader first */
  standings(): Racer[] {
    return [...this.racers].sort((a, b) => {
      if (a.finishedAt !== null || b.finishedAt !== null) return (a.finishedAt === null ? 1e9 : a.place) - (b.finishedAt === null ? 1e9 : b.place);
      return b.y - a.y;
    });
  }
}
