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

type Ball = {
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
};

type Mine = { id: number; team: Team; x: number; y: number; born: number; alive: boolean };

export type BallFrame = { id: number; t: Team; k: AbilityId; x: number; y: number; r: number; hp: number; a: number; L: number; c: boolean };
export type MineFrame = { id: number; t: Team; x: number; y: number; armed: boolean };
export type Frame = { balls: BallFrame[]; mines: MineFrame[]; lo: number; size: number; hp: [number, number]; count: [number, number] };

export type BattleEvent =
  /** contact damage: the number floats up from the ball that took it, the spark is where they touched */
  | { f: number; type: "hit"; x: number; y: number; cx: number; cy: number; dmg: number; to: Team }
  | { f: number; type: "cut"; x: number; y: number; dmg: number; to: Team }
  | { f: number; type: "boom"; x: number; y: number; dmg: number; to: Team }
  | { f: number; type: "spawn"; x: number; y: number; team: Team; n: number }
  | { f: number; type: "heal"; x: number; y: number; team: Team }
  | { f: number; type: "ko"; x: number; y: number; team: Team; last: boolean };

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
export function arenaAt(seconds: number): { lo: number; size: number } {
  const k = Math.min(1, Math.max(0, (seconds - SUDDEN_DEATH) / SHRINK_OVER));
  const size = ARENA - (ARENA - SHRINK_TO) * k;
  return { lo: (ARENA - size) / 2, size };
}

export function simulate(a: AbilityId, b: AbilityId, seed: number): Battle {
  const rand = rng(seed);
  const balls: Ball[] = [];
  const mines: Mine[] = [];
  const events: BattleEvent[] = [];
  const frames: Frame[] = [];
  const hitAt = new Map<string, number>();
  const splits: [number, number] = [0, 0];
  const lastSplit: [number, number] = [-1, -1];
  let clock = 0;
  let nextId = 1;

  const make = (team: Team, kind: AbilityId, x: number, y: number, o: Partial<Ball> = {}): Ball => {
    const ab = ABILITIES[kind];
    const ang = rand() * Math.PI * 2;
    const ball: Ball = {
      id: nextId++, team, kind, x, y,
      vx: Math.cos(ang) * ab.speed, vy: Math.sin(ang) * ab.speed,
      r: ab.radius, hp: ab.hp, maxHp: ab.hp, speed: ab.speed, touch: ab.touch,
      alive: true, bounces: 0, blade: 90, angle: rand() * Math.PI * 2, child: false, lastMine: 0, fresh: 0, ...o,
    };
    balls.push(ball);
    return ball;
  };

  make(0, a, ARENA * 0.27, ARENA * (0.42 + rand() * 0.16));
  make(1, b, ARENA * 0.73, ARENA * (0.42 + rand() * 0.16));
  const start: [number, number] = [ABILITIES[a].hp, ABILITIES[b].hp];

  const teamCount = (t: Team) => balls.reduce((n, x) => n + (x.alive && x.team === t ? 1 : 0), 0);
  const ready = (key: string, now: number, gap: number) => {
    const last = hitAt.get(key);
    if (last !== undefined && now - last < gap) return false;
    hitAt.set(key, now);
    return true;
  };

  /** Damage that lands on a ball, with what it sets off: a Fibonacci split, or a knockout. */
  const hurt = (target: Ball, dmg: number, f: number) => {
    if (!target.alive) return;
    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp <= 0) {
      target.alive = false;
      const left = teamCount(target.team);
      events.push({ f, type: "ko", x: target.x, y: target.y, team: target.team, last: left === 0 });
      if (target.kind === "bomb" && !target.child) blast(target.x, target.y, 170, 4, target.team, f);
      return;
    }
    if (target.kind === "fibonacci" && clock - lastSplit[target.team] >= SPLIT_GAP) {
      const t = target.team;
      lastSplit[t] = clock;
      splits[t]++;
      const n = Math.min(fib(splits[t]), MAX_TEAM - teamCount(t));
      // the copies fan out around it, and can't fight until they're clear
      for (let i = 0; i < n; i++) {
        const ang = (i / Math.max(1, n)) * Math.PI * 2 + rand();
        const d = target.r + 34;
        make(t, "fibonacci", target.x + Math.cos(ang) * d, target.y + Math.sin(ang) * d, { hp: 2, maxHp: 2, r: 30, child: true, fresh: clock + FRESH });
      }
      if (n > 0) events.push({ f, type: "spawn", x: target.x, y: target.y, team: t, n });
    }
  };

  const blast = (x: number, y: number, radius: number, dmg: number, from: Team, f: number) => {
    let hitAny = false;
    for (const o of balls) {
      if (!o.alive || o.team === from) continue;
      if (Math.hypot(o.x - x, o.y - y) <= radius + o.r) {
        hitAny = true;
        hurt(o, dmg, f);
      }
    }
    events.push({ f, type: "boom", x, y, dmg, to: (1 - from) as Team });
    return hitAny;
  };

  let endFrame = -1;
  let winner: Team | null = null;
  let byTimeout = false;
  const maxFrames = MAX_SECONDS * FPS;

  for (let f = 0; f < maxFrames; f++) {
    for (let s = 0; s < SUB; s++) {
      const now = (f * SUB + s) * DT;
      clock = now;
      const { lo, size } = arenaAt(now);
      const hi = lo + size;
      const sudden = now >= SUDDEN_DEATH;

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
        if (p.kind === "grow" && !p.child) {
          p.r = Math.min(p.r + 2, 130);
          if (p.bounces % 2 === 0) { p.maxHp += 1; p.hp += 1; }
          p.touch = 1 + Math.floor((p.r - ABILITIES.grow.radius) / 40);
        } else if (p.kind === "heal" && p.hp < p.maxHp) {
          p.hp += 1;
          events.push({ f, type: "heal", x: p.x, y: p.y, team: p.team });
        } else if (p.kind === "speed") {
          p.speed = Math.min(p.speed * 1.07, ABILITIES.speed.speed * 2.4);
          p.touch = 1 + Math.floor((p.speed / ABILITIES.speed.speed - 1) * 2.5);
        } else if (p.kind === "clone" && !p.child && p.bounces % 4 === 0 && teamCount(p.team) < 10) {
          const c = make(p.team, "clone", p.x, p.y, { hp: Math.max(2, Math.ceil(p.hp / 2)), maxHp: Math.max(2, Math.ceil(p.hp / 2)), r: 40, child: true, fresh: now + FRESH });
          events.push({ f, type: "spawn", x: c.x, y: c.y, team: p.team, n: 1 });
        }
        // once the walls close in, touching them hurts, so a fight can't stall
        if (sudden) hurt(p, 1, f);
      }

      // bombs leave mines behind them
      for (const p of balls) {
        if (!p.alive || p.kind !== "bomb" || p.child || now - p.lastMine < MINE_EVERY) continue;
        p.lastMine = now;
        mines.push({ id: nextId++, team: p.team, x: p.x, y: p.y, born: now, alive: true });
        const mine = mines.filter((m) => m.alive && m.team === p.team);
        if (mine.length > MINES_MAX) mine[0].alive = false;
      }
      for (const m of mines) {
        if (!m.alive || now - m.born < MINE_ARM) continue;
        if (m.x < lo || m.x > hi || m.y < lo || m.y > hi) { m.alive = false; continue; }
        const hit = balls.some((o) => o.alive && o.team !== m.team && o.fresh <= now && Math.hypot(o.x - m.x, o.y - m.y) < o.r + MINE_R);
        if (hit) {
          m.alive = false;
          blast(m.x, m.y, 110, 3, m.team, f);
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
          if (p.team === q.team || p.fresh > now || q.fresh > now || !ready(`h${p.id}-${q.id}`, now, HIT_GAP)) continue;
          const cx = p.x + nx * p.r, cy = p.y + ny * p.r;
          const toQ = p.touch, toP = q.touch;
          events.push({ f, type: "hit", x: q.x, y: q.y - q.r, cx, cy, dmg: toQ, to: q.team });
          events.push({ f, type: "hit", x: p.x, y: p.y - p.r, cx, cy, dmg: toP, to: p.team });
          hurt(q, toQ, f);
          hurt(p, toP, f);
        }
      }

      // sword blades cut whatever they sweep through
      for (const p of balls) {
        if (!p.alive || p.kind !== "sword") continue;
        const ux = Math.cos(p.angle), uy = Math.sin(p.angle);
        const x0 = p.x + ux * p.r, y0 = p.y + uy * p.r;
        for (const o of balls) {
          if (!o.alive || o.team === p.team || o.fresh > now) continue;
          const along = Math.max(0, Math.min(p.blade, (o.x - x0) * ux + (o.y - y0) * uy));
          const px = x0 + ux * along, py = y0 + uy * along;
          if (Math.hypot(o.x - px, o.y - py) > o.r || !ready(`c${p.id}-${o.id}`, now, CUT_GAP)) continue;
          events.push({ f, type: "cut", x: px, y: py, dmg: 3, to: o.team });
          hurt(o, 3, f);
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
    }

    const { lo, size } = arenaAt((f + 1) * SUB * DT);
    const hp: [number, number] = [0, 0];
    const count: [number, number] = [0, 0];
    const live: BallFrame[] = [];
    for (const p of balls) {
      if (!p.alive) continue;
      hp[p.team] += p.hp;
      count[p.team]++;
      live.push({ id: p.id, t: p.team, k: p.kind, x: p.x, y: p.y, r: p.r, hp: p.hp, a: p.angle, L: p.kind === "sword" ? p.blade : 0, c: p.child });
    }
    frames.push({
      balls: live,
      mines: mines.filter((m) => m.alive).map((m) => ({ id: m.id, t: m.team, x: m.x, y: m.y, armed: (f + 1) * SUB * DT - m.born >= MINE_ARM })),
      lo, size, hp, count,
    });

    if (count[0] === 0 || count[1] === 0) {
      endFrame = f;
      winner = count[0] === 0 && count[1] === 0 ? null : count[0] === 0 ? 1 : 0;
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

  return { a, b, seed, frames, events, winner, endFrame, byTimeout, start };
}
