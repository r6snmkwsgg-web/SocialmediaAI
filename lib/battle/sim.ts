import { ABILITIES, fib, type AbilityId } from "./abilities";

/**
 * A ball battle, worked out in full before a single frame is drawn: every
 * ball's place, size and health on every frame, and every hit, cut, blast,
 * split and knockout as an event the video and the soundtrack read. The
 * same two abilities and seed always give the same fight, so a video can be
 * previewed in the browser and rendered on a server and match frame for
 * frame.
 */

export const FPS = 30;
const SUB = 2;
const DT = 1 / (FPS * SUB);
/** One step of the physics, in seconds: two to a video frame. */
export const TICK = DT;
/** The arena is a square this many units across; the video draws it 960 pixels wide. */
export const ARENA = 800;
const MAX_SECONDS = 58;
/** After this long the walls start closing in, so every fight ends. */
export const SUDDEN_DEATH = 36;
export const SHRINK_TO = 370;
const SHRINK_OVER = 14;
const MAX_TEAM = 21;
/** a split can only happen this often, and new copies can't hit or be hit straight away */
const SPLIT_GAP = 0.6;
const FRESH = 0.5;
const HIT_GAP = 0.22;
const CUT_GAP = 0.3;
const MINE_EVERY = 3;
const MINE_ARM = 0.6;
const MINES_MAX = 4;
const MINE_R = 16;

export type Team = 0 | 1;

/** Who summoned a ball, on a live stream: their name goes on it. */
export type Tag = { name: string; avatar?: string };

export type Ball = {
  id: number;
  team: Team;
  kind: AbilityId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  touch: number;
  alive: boolean;
  bounces: number;
  blade: number;
  angle: number;
  child: boolean;
  lastMine: number;
  /** until when it can't hit or be hit, just after it appears */
  fresh: number;
  /** when it appeared */
  born: number;
  tag?: Tag;
  /** a viewer's ball on a live: no ability, just a ball with their face on it */
  plain?: boolean;
};

export type Mine = { id: number; team: Team; x: number; y: number; born: number; alive: boolean };

export type BallFrame = { id: number; t: Team; k: AbilityId; x: number; y: number; r: number; hp: number; a: number; L: number; c: boolean };
export type MineFrame = { id: number; t: Team; x: number; y: number; armed: boolean };
export type Frame = { balls: BallFrame[]; mines: MineFrame[]; lo: number; size: number; hp: [number, number]; count: [number, number] };

export type BattleEvent =
  /** contact damage: the number floats up from the ball that took it, the spark is where they touched */
  | { f: number; type: "hit"; x: number; y: number; cx: number; cy: number; dmg: number; to: Team }
  | { f: number; type: "cut"; x: number; y: number; dmg: number; to: Team }
  | { f: number; type: "boom"; x: number; y: number; dmg: number; to: Team }
  | { f: number; type: "spawn"; x: number; y: number; team: Team; n: number }
  | { f: number; type: "heal"; x: number; y: number; team: Team; n?: number }
  | { f: number; type: "ko"; x: number; y: number; team: Team; last: boolean }
  /** only live: a viewer's ball dropping in, or growing when they give more */
  | { f: number; type: "summon"; x: number; y: number; team: Team; name?: string; grew: boolean };

export type Battle = {
  a: AbilityId;
  b: AbilityId;
  seed: number;
  frames: Frame[];
  events: BattleEvent[];
  /** null only if both teams went down on the same frame */
  winner: Team | null;
  /** the frame the fight was decided on */
  endFrame: number;
  /** decided on health when time ran out, not by a knockout */
  byTimeout: boolean;
  /** each team's health at the start */
  start: [number, number];
};

/** A small fast seeded random number generator, so a seed is a whole fight. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the walls are at a moment: the full arena, then closing in after sudden death starts. */
export function arenaAt(seconds: number, suddenDeath = SUDDEN_DEATH): { lo: number; size: number } {
  const k = Math.min(1, Math.max(0, (seconds - suddenDeath) / SHRINK_OVER));
  const size = ARENA - (ARENA - SHRINK_TO) * k;
  return { lo: (ARENA - size) / 2, size };
}

export type WorldOptions = {
  /** when the walls start closing in */
  suddenDeath?: number;
  /** the most balls a team can have at once */
  maxTeam?: number;
};

/**
 * The arena and everything in it, one physics step at a time. A video runs
 * it start to finish in one go; a live stream runs it in real time and
 * reaches in while it runs: viewers' gifts drop in balls with their faces
 * on, and likes heal their side.
 */
export class World {
  readonly rand: () => number;
  readonly balls: Ball[] = [];
  readonly mines: Mine[] = [];
  readonly events: BattleEvent[] = [];
  readonly suddenDeath: number;
  readonly maxTeam: number;
  /** physics steps run so far */
  sub = 0;
  clock = 0;
  private nextId = 1;
  private readonly hitAt = new Map<string, number>();
  private readonly splits: [number, number] = [0, 0];
  private readonly lastSplit: [number, number] = [-1, -1];

  constructor(seed: number, o: WorldOptions = {}) {
    this.rand = rng(seed);
    this.suddenDeath = o.suddenDeath ?? SUDDEN_DEATH;
    this.maxTeam = o.maxTeam ?? MAX_TEAM;
  }

  /** the video frame the world is on */
  get f(): number {
    return Math.floor(this.sub / SUB);
  }

  arena(): { lo: number; size: number } {
    return arenaAt(this.clock, this.suddenDeath);
  }

  add(team: Team, kind: AbilityId, x: number, y: number, o: Partial<Ball> = {}): Ball {
    const ab = ABILITIES[kind];
    const ang = this.rand() * Math.PI * 2;
    const ball: Ball = {
      id: this.nextId++, team, kind, x, y,
      vx: Math.cos(ang) * ab.speed, vy: Math.sin(ang) * ab.speed,
      r: ab.radius, hp: ab.hp, maxHp: ab.hp, speed: ab.speed, touch: ab.touch,
      alive: true, bounces: 0, blade: 90, angle: this.rand() * Math.PI * 2, child: false, lastMine: 0, fresh: 0, born: this.clock, ...o,
    };
    this.balls.push(ball);
    return ball;
  }

  count(t: Team): number {
    return this.balls.reduce((n, x) => n + (x.alive && x.team === t ? 1 : 0), 0);
  }

  hp(t: Team): number {
    return this.balls.reduce((n, x) => n + (x.alive && x.team === t ? x.hp : 0), 0);
  }

  private ready(key: string, now: number, gap: number): boolean {
    const last = this.hitAt.get(key);
    if (last !== undefined && now - last < gap) return false;
    this.hitAt.set(key, now);
    return true;
  }

  /** Damage that lands on a ball, with what it sets off: a Fibonacci split, or a knockout. */
  private hurt(target: Ball, dmg: number, f: number) {
    if (!target.alive) return;
    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp <= 0) {
      target.alive = false;
      const left = this.count(target.team);
      this.events.push({ f, type: "ko", x: target.x, y: target.y, team: target.team, last: left === 0 });
      if (target.kind === "bomb" && !target.child) this.blast(target.x, target.y, 170, 4, target.team, f);
      return;
    }
    if (target.kind === "fibonacci" && !target.plain && this.clock - this.lastSplit[target.team] >= SPLIT_GAP) {
      const t = target.team;
      this.lastSplit[t] = this.clock;
      this.splits[t]++;
      const n = Math.min(fib(this.splits[t]), this.maxTeam - this.count(t));
      // the copies fan out around it, and can't fight until they're clear
      for (let i = 0; i < n; i++) {
        const ang = (i / Math.max(1, n)) * Math.PI * 2 + this.rand();
        const d = target.r + 34;
        this.add(t, "fibonacci", target.x + Math.cos(ang) * d, target.y + Math.sin(ang) * d, { hp: 2, maxHp: 2, r: 30, child: true, fresh: this.clock + FRESH, tag: target.tag });
      }
      if (n > 0) this.events.push({ f, type: "spawn", x: target.x, y: target.y, team: t, n });
    }
  }

  private blast(x: number, y: number, radius: number, dmg: number, from: Team, f: number) {
    for (const o of this.balls) {
      if (!o.alive || o.team === from) continue;
      if (Math.hypot(o.x - x, o.y - y) <= radius + o.r) this.hurt(o, dmg, f);
    }
    this.events.push({ f, type: "boom", x, y, dmg, to: (1 - from) as Team });
  }

  /** One physics step. */
  tick() {
    const f = this.f;
    const now = this.sub * DT;
    this.clock = now;
    const { lo, size } = arenaAt(now, this.suddenDeath);
    const hi = lo + size;
    const sudden = now >= this.suddenDeath;
    const balls = this.balls;

    for (const p of balls) {
      if (!p.alive) continue;
      p.r = Math.min(p.r, size / 2 - 4);
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      if (p.kind === "sword") p.angle += 5.2 * DT;
      let bounced = false;
      if (p.x - p.r < lo) { p.x = lo + p.r; p.vx = Math.abs(p.vx); bounced = true; }
      if (p.x + p.r > hi) { p.x = hi - p.r; p.vx = -Math.abs(p.vx); bounced = true; }
      if (p.y - p.r < lo) { p.y = lo + p.r; p.vy = Math.abs(p.vy); bounced = true; }
      if (p.y + p.r > hi) { p.y = hi - p.r; p.vy = -Math.abs(p.vy); bounced = true; }
      if (!bounced) continue;
      p.bounces++;
      if (p.plain) {
        // a viewer's ball has no ability
      } else if (p.kind === "grow" && !p.child) {
        p.r = Math.min(p.r + 2, 130);
        if (p.bounces % 2 === 0) { p.maxHp += 1; p.hp += 1; }
        p.touch = 1 + Math.floor((p.r - ABILITIES.grow.radius) / 40);
      } else if (p.kind === "heal" && p.hp < p.maxHp) {
        p.hp += 1;
        this.events.push({ f, type: "heal", x: p.x, y: p.y, team: p.team });
      } else if (p.kind === "speed") {
        p.speed = Math.min(p.speed * 1.07, ABILITIES.speed.speed * 2.4);
        p.touch = 1 + Math.floor((p.speed / ABILITIES.speed.speed - 1) * 2.5);
      } else if (p.kind === "clone" && !p.child && p.bounces % 4 === 0 && this.count(p.team) < Math.min(10, this.maxTeam)) {
        const c = this.add(p.team, "clone", p.x, p.y, { hp: Math.max(2, Math.ceil(p.hp / 2)), maxHp: Math.max(2, Math.ceil(p.hp / 2)), r: 40, child: true, fresh: now + FRESH, tag: p.tag });
        this.events.push({ f, type: "spawn", x: c.x, y: c.y, team: p.team, n: 1 });
      }
      // once the walls close in, touching them hurts, so a fight can't stall
      if (sudden) this.hurt(p, 1, f);
    }

    // bombs leave mines behind them
    for (const p of balls) {
      if (!p.alive || p.kind !== "bomb" || p.child || p.plain || now - p.lastMine < MINE_EVERY) continue;
      p.lastMine = now;
      this.mines.push({ id: this.nextId++, team: p.team, x: p.x, y: p.y, born: now, alive: true });
      const mine = this.mines.filter((m) => m.alive && m.team === p.team);
      if (mine.length > MINES_MAX) mine[0].alive = false;
    }
    for (const m of this.mines) {
      if (!m.alive || now - m.born < MINE_ARM) continue;
      if (m.x < lo || m.x > hi || m.y < lo || m.y > hi) { m.alive = false; continue; }
      const hit = balls.some((o) => o.alive && o.team !== m.team && o.fresh <= now && Math.hypot(o.x - m.x, o.y - m.y) < o.r + MINE_R);
      if (hit) {
        m.alive = false;
        this.blast(m.x, m.y, 110, 3, m.team, f);
      }
    }

    // balls hitting each other: bounce apart, and enemies trade damage
    for (let i = 0; i < balls.length; i++) {
      const p = balls[i];
      if (!p.alive) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const q = balls[j];
        if (!q.alive) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const overlap = p.r + q.r - d;
        if (overlap <= 0) continue;
        const nx = dx / d, ny = dy / d;
        p.x -= nx * overlap / 2; p.y -= ny * overlap / 2;
        q.x += nx * overlap / 2; q.y += ny * overlap / 2;
        const pn = p.vx * nx + p.vy * ny, qn = q.vx * nx + q.vy * ny;
        if (pn - qn > 0) {
          p.vx += (qn - pn) * nx; p.vy += (qn - pn) * ny;
          q.vx += (pn - qn) * nx; q.vy += (pn - qn) * ny;
        }
        if (p.team === q.team || p.fresh > now || q.fresh > now || !this.ready(`h${p.id}-${q.id}`, now, HIT_GAP)) continue;
        const cx = p.x + nx * p.r, cy = p.y + ny * p.r;
        const toQ = p.touch, toP = q.touch;
        this.events.push({ f, type: "hit", x: q.x, y: q.y - q.r, cx, cy, dmg: toQ, to: q.team });
        this.events.push({ f, type: "hit", x: p.x, y: p.y - p.r, cx, cy, dmg: toP, to: p.team });
        this.hurt(q, toQ, f);
        this.hurt(p, toP, f);
      }
    }

    // sword blades cut whatever they sweep through
    for (const p of balls) {
      if (!p.alive || p.kind !== "sword" || p.plain) continue;
      const ux = Math.cos(p.angle), uy = Math.sin(p.angle);
      const x0 = p.x + ux * p.r, y0 = p.y + uy * p.r;
      for (const o of balls) {
        if (!o.alive || o.team === p.team || o.fresh > now) continue;
        const along = Math.max(0, Math.min(p.blade, (o.x - x0) * ux + (o.y - y0) * uy));
        const px = x0 + ux * along, py = y0 + uy * along;
        if (Math.hypot(o.x - px, o.y - py) > o.r || !this.ready(`c${p.id}-${o.id}`, now, CUT_GAP)) continue;
        this.events.push({ f, type: "cut", x: px, y: py, dmg: 3, to: o.team });
        this.hurt(o, 3, f);
        p.blade = Math.min(p.blade + 16, 300);
      }
    }

    // every ball keeps its own speed, whatever it bounced off
    for (const p of balls) {
      if (!p.alive) continue;
      const v = Math.hypot(p.vx, p.vy) || 1;
      p.vx = (p.vx / v) * p.speed;
      p.vy = (p.vy / v) * p.speed;
    }
    this.sub++;
  }

  /** A video frame's worth of steps. */
  step() {
    for (let s = 0; s < SUB; s++) this.tick();
  }

  /** Where everything is now, as the video draws it. */
  frame(): Frame {
    const t = this.sub * DT;
    const { lo, size } = arenaAt(t, this.suddenDeath);
    const hp: [number, number] = [0, 0];
    const count: [number, number] = [0, 0];
    const live: BallFrame[] = [];
    for (const p of this.balls) {
      if (!p.alive) continue;
      hp[p.team] += p.hp;
      count[p.team]++;
      live.push({ id: p.id, t: p.team, k: p.kind, x: p.x, y: p.y, r: p.r, hp: p.hp, a: p.angle, L: p.kind === "sword" ? p.blade : 0, c: p.child });
    }
    return {
      balls: live,
      mines: this.mines.filter((m) => m.alive).map((m) => ({ id: m.id, t: m.team, x: m.x, y: m.y, armed: t - m.born >= MINE_ARM })),
      lo, size, hp, count,
    };
  }

  // ── what viewers can do, live ──

  /**
   * A viewer's ball, dropped in on their side with their face on it: a
   * plain ball, no ability, as big and tough as their gift made it.
   * Nothing happens if the side is already full.
   */
  summon(team: Team, kind: AbilityId, o: { tag?: Tag; r: number; hp: number; touch: number }): Ball | null {
    if (this.count(team) >= this.maxTeam) return null;
    const { lo, size } = this.arena();
    const r = Math.min(o.r, size / 2 - 8);
    const x = lo + r + (size - 2 * r) * (team === 0 ? 0.05 + this.rand() * 0.25 : 0.7 + this.rand() * 0.25);
    const y = lo + r + this.rand() * (size - 2 * r);
    const ball = this.add(team, kind, x, y, { r, hp: o.hp, maxHp: o.hp, touch: o.touch, plain: true, child: true, fresh: this.clock + 0.8, tag: o.tag });
    this.events.push({ f: this.f, type: "summon", x: ball.x, y: ball.y, team, name: o.tag?.name, grew: false });
    return ball;
  }

  /** A viewer gave more: their ball gets bigger and tougher. */
  grow(ball: Ball, o: { r: number; hp: number; touch: number }) {
    const gain = Math.max(0, o.hp - ball.maxHp);
    ball.maxHp = Math.max(ball.maxHp, o.hp);
    ball.hp += gain;
    ball.r = Math.max(ball.r, Math.min(o.r, this.arena().size / 2 - 8));
    ball.touch = Math.max(ball.touch, o.touch);
    ball.born = this.clock;
    this.events.push({ f: this.f, type: "summon", x: ball.x, y: ball.y, team: ball.team, name: ball.tag?.name, grew: true });
  }

  /** Health for a team, onto its strongest ball; past full, it raises the ball's maximum. */
  heal(team: Team, n: number): Ball | null {
    let best: Ball | null = null;
    for (const b of this.balls) if (b.alive && b.team === team && (!best || b.maxHp > best.maxHp)) best = b;
    if (!best) return null;
    best.hp += n;
    best.maxHp = Math.max(best.maxHp, best.hp);
    this.events.push({ f: this.f, type: "heal", x: best.x, y: best.y, team, n });
    return best;
  }
}

export function simulate(a: AbilityId, b: AbilityId, seed: number): Battle {
  const w = new World(seed);
  w.add(0, a, ARENA * 0.27, ARENA * (0.42 + w.rand() * 0.16));
  w.add(1, b, ARENA * 0.73, ARENA * (0.42 + w.rand() * 0.16));
  const start: [number, number] = [ABILITIES[a].hp, ABILITIES[b].hp];
  const frames: Frame[] = [];
  let endFrame = -1;
  let winner: Team | null = null;
  let byTimeout = false;
  const maxFrames = MAX_SECONDS * FPS;

  for (let f = 0; f < maxFrames; f++) {
    w.step();
    const fr = w.frame();
    frames.push(fr);
    if (fr.count[0] === 0 || fr.count[1] === 0) {
      endFrame = f;
      winner = fr.count[0] === 0 && fr.count[1] === 0 ? null : fr.count[0] === 0 ? 1 : 0;
      break;
    }
  }

  if (endFrame < 0) {
    endFrame = frames.length - 1;
    byTimeout = true;
    const last = frames[endFrame];
    // on time: whoever kept more of their starting health
    const share0 = last.hp[0] / start[0], share1 = last.hp[1] / start[1];
    winner = share0 === share1 ? null : share0 > share1 ? 0 : 1;
  }

  return { a, b, seed, frames, events: w.events, winner, endFrame, byTimeout, start };
}
