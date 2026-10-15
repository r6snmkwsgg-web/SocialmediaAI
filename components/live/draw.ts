import { ARENA, FPS, type Ball, type Team } from "@/lib/battle/sim";
import { INTRO, KO_HOLD, LIVE_SUDDEN, WIN, type Show } from "@/lib/live/round";
import { TEAMS, TIERS, type Effect } from "@/lib/live/rules";

/**
 * The live show, drawn onto a 1080 × 1920 canvas every frame. Someone who
 * scrolls onto the LIVE has to get it in a couple of seconds, so it reads
 * top to bottom: the two teams and how to join them, the gift menu (by
 * gift name, with a picture for each), then the fight. Whatever a gift
 * does shows up in the fight with the same picture the menu used, and its
 * menu item lights up, so the menu teaches itself. A stream covers the
 * very top with the streamer's name and the bottom with chat, so all of
 * that sits in the middle.
 */

export const W = 1080;
export const H = 1920;
const M = 80;
const SIDE = W - 2 * M;
const AX = M;
const AY = 592;
const SCALE = SIDE / ARENA;
const PAPER = "#F4F1EA";
const INK = "#0B0B0C";
const DIM = "#8D8A83";
const SIGNAL = "#FF4A1C";
const GOLD = "#FFD60A";
const FONT = "Anton";
/** how long a hit's spark stays up, in seconds of fight */
const FX = 0.5;

export type View = {
  /** pretend viewers are on: say so */
  demo: boolean;
  /** a viewer's picture, once it's loaded */
  image: (url: string) => HTMLImageElement | null;
  /** the connection's state, when it isn't connected */
  status?: string;
};

type Ctx = CanvasRenderingContext2D;

const ease = (k: number) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
/** a springy pop from 0 to 1 and a touch past it */
const pop = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 + Math.sin(k * Math.PI * 1.5) * Math.exp(-k * 4) * 0.35 - (1 - k) ** 4);
const color = (t: Team) => TEAMS[t].color;
const tier = (e: Effect) => TIERS.find((t) => t.effect === e)!;

type TextOpts = { size: number; color?: string; align?: CanvasTextAlign; stroke?: number; spacing?: number; alpha?: number; max?: number };

function text(ctx: Ctx, s: string, x: number, y: number, o: TextOpts) {
  ctx.save();
  let size = o.size;
  ctx.font = `${size}px ${FONT}`;
  if ("letterSpacing" in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`;
  if (o.max) {
    const w = ctx.measureText(s).width;
    if (w > o.max) {
      size = Math.max(8, size * (o.max / w));
      ctx.font = `${size}px ${FONT}`;
    }
  }
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha *= o.alpha ?? 1;
  if (o.stroke) {
    ctx.lineWidth = o.stroke;
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = o.color ?? PAPER;
  ctx.fillText(s, x, y);
  ctx.restore();
}

function measure(ctx: Ctx, s: string, size: number, spacing = 0): number {
  ctx.save();
  ctx.font = `${size}px ${FONT}`;
  if ("letterSpacing" in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${spacing}px`;
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

function circle(ctx: Ctx, x: number, y: number, r: number, fill?: string, stroke?: string, lw = 0) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function outline(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, stroke: string, lw: number) {
  ctx.beginPath();
  ctx.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, r);
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/** A viewer's face in a circle, or their first letter when there's no picture. */
function face(ctx: Ctx, view: View, name: string, avatar: string | undefined, x: number, y: number, r: number, ring: string, lw = Math.max(3, r * 0.12)) {
  const img = avatar ? view.image(avatar) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  else {
    ctx.fillStyle = "#26262A";
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    text(ctx, (name.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase(), x, y + r * 0.4, { size: r * 1.1, align: "center" });
  }
  ctx.restore();
  circle(ctx, x, y, r, undefined, ring, lw);
}

function coin(ctx: Ctx, x: number, y: number, r: number) {
  circle(ctx, x, y, r, GOLD, INK, Math.max(1.5, r * 0.25));
}

// ── pictures: one for each thing on the menu, used the same way in the fight ──

function heart(ctx: Ctx, x: number, y: number, s: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 32, s / 32);
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.bezierCurveTo(-18, 0, -16, -16, -6, -16);
  ctx.bezierCurveTo(-2, -16, 0, -12, 0, -10);
  ctx.bezierCurveTo(0, -12, 2, -16, 6, -16);
  ctx.bezierCurveTo(16, -16, 18, 0, 0, 12);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function person(ctx: Ctx, x: number, y: number, r: number, fill: string) {
  circle(ctx, x, y, r, "#26262A", fill, Math.max(2, r * 0.16));
  circle(ctx, x, y - r * 0.18, r * 0.3, fill);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.84, 0, Math.PI * 2);
  ctx.clip();
  circle(ctx, x, y + r * 0.72, r * 0.52, fill);
  ctx.restore();
}

function flame(ctx: Ctx, x: number, y: number, s: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -s / 2);
  ctx.bezierCurveTo(s * 0.45, -s * 0.1, s * 0.4, s * 0.45, 0, s / 2);
  ctx.bezierCurveTo(-s * 0.4, s * 0.45, -s * 0.45, 0, -s * 0.12, -s * 0.18);
  ctx.bezierCurveTo(-s * 0.05, 0, s * 0.05, -s * 0.2, 0, -s / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function shieldShape(ctx: Ctx, x: number, y: number, s: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -s / 2);
  ctx.lineTo(s * 0.42, -s * 0.32);
  ctx.quadraticCurveTo(s * 0.4, s * 0.25, 0, s / 2);
  ctx.quadraticCurveTo(-s * 0.4, s * 0.25, -s * 0.42, -s * 0.32);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function meteorShape(ctx: Ctx, x: number, y: number, s: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = fill;
  ctx.lineCap = "round";
  ctx.lineWidth = s * 0.16;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(s * 0.05, -s * 0.05);
  ctx.lineTo(s * 0.48, -s * 0.48);
  ctx.stroke();
  ctx.globalAlpha = 1;
  circle(ctx, -s * 0.12, s * 0.12, s * 0.32, fill);
  ctx.restore();
}

function crown(ctx: Ctx, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-s / 2, s * 0.3);
  ctx.lineTo(-s / 2, -s * 0.2);
  ctx.lineTo(-s / 4, s * 0.05);
  ctx.lineTo(0, -s * 0.38);
  ctx.lineTo(s / 4, s * 0.05);
  ctx.lineTo(s / 2, -s * 0.2);
  ctx.lineTo(s / 2, s * 0.3);
  ctx.closePath();
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

function icon(ctx: Ctx, e: Effect, x: number, y: number, s: number) {
  const c = tier(e).color;
  if (e === "heal") heart(ctx, x, y + s * 0.05, s * 0.95, c);
  else if (e === "small") person(ctx, x, y, s * 0.3, c);
  else if (e === "ball") person(ctx, x, y, s * 0.46, c);
  else if (e === "rage") flame(ctx, x, y, s, c);
  else if (e === "shield") shieldShape(ctx, x, y, s, c);
  else meteorShape(ctx, x, y, s, c);
}

// ── the arena ──

function drawBall(ctx: Ctx, view: View, w: Show["world"], b: Ball, turn: number, crowned: boolean) {
  const c = color(b.team);
  // a new ball pops in
  const k = b.born > 0 ? ease((w.clock - b.born) / 0.35) : 1;
  const r = b.r * (0.55 + 0.45 * k);
  const fresh = b.fresh > w.clock;
  const raging = w.rage[b.team] > w.clock;

  if (raging) {
    // flames around it: the menu's rage picture, on every ball of the team
    for (let i = 0; i < 8; i++) {
      const a = turn * 1.5 + (i / 8) * Math.PI * 2;
      const flick = 0.75 + 0.25 * Math.sin(turn * 14 + i * 2);
      flame(ctx, b.x + Math.cos(a) * (r + 10), b.y + Math.sin(a) * (r + 10), 30 * flick, i % 2 ? "#FF9F0A" : "#FF3B30");
    }
  }
  if (!b.plain && b.kind === "spike") {
    const n = 12;
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const ang = turn + (i / (n * 2)) * Math.PI * 2;
      const rad = i % 2 === 0 ? r + 22 : r - 2;
      const px = b.x + Math.cos(ang) * rad, py = b.y + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  if (!b.plain && b.kind === "sword") {
    const x0 = b.x + Math.cos(b.angle) * r, y0 = b.y + Math.sin(b.angle) * r;
    const x1 = b.x + Math.cos(b.angle) * (r + b.blade), y1 = b.y + Math.sin(b.angle) * (r + b.blade);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 20;
    ctx.stroke();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 10;
    ctx.stroke();
  }

  ctx.save();
  if (fresh) ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(turn * 10));
  if (b.tag) {
    // a viewer's ball: their face, ringed in their team's colour
    face(ctx, view, b.tag.name, b.tag.avatar, b.x, b.y, r, c, Math.max(6, r * 0.14));
    const hr = Math.max(15, r * 0.34);
    const hx = b.x + r * 0.74, hy = b.y - r * 0.74;
    circle(ctx, hx, hy, hr, c, INK, 4);
    text(ctx, String(Math.ceil(b.hp)), hx, hy + hr * 0.4, { size: hr * 1.1, align: "center", color: "#fff" });
    text(ctx, b.tag.name, b.x, b.y + r + (b.plain ? 24 : 30), { size: b.plain ? 22 : 28, align: "center", stroke: 7, max: 200 });
  } else {
    circle(ctx, b.x, b.y, r, c, PAPER, 6);
    const size = Math.max(28, r * 0.95);
    text(ctx, String(Math.ceil(b.hp)), b.x, b.y + size * 0.36, { size, align: "center", color: "#fff" });
  }
  ctx.restore();

  if (raging) {
    // and a 2X on it, so it's plain what rage does
    const bx = b.x - r * 0.78, by = b.y - r * 0.78;
    roundRect(ctx, bx - 26, by - 18, 52, 36, 10, "#FF3B30");
    text(ctx, "2X", bx, by + 12, { size: 30, align: "center", color: "#fff" });
  }
  if (w.shield[b.team] > w.clock) {
    const pulse = 0.5 + 0.5 * Math.sin(turn * 6);
    circle(ctx, b.x, b.y, r + 16 + pulse * 4, "rgba(100,210,255,0.14)", "#64D2FF", 5);
  }
  if (crowned) crown(ctx, b.x, b.y - r - 26, Math.min(76, Math.max(40, r * 0.8)));
}

function drawEffects(ctx: Ctx, show: Show) {
  const w = show.world;
  const ev = w.events;
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i];
    const age = w.clock - e.f / FPS;
    if (age > FX * 2) break;
    if (age < 0) continue;
    const k = age / FX;
    const fade = Math.max(0, 1 - k);
    ctx.save();
    switch (e.type) {
      case "hit":
      case "cut":
        if (fade <= 0) break;
        ctx.globalAlpha = fade;
        circle(ctx, e.type === "hit" ? e.cx : e.x, e.type === "hit" ? e.cy : e.y, 8 + 36 * k, undefined, PAPER, 5 * fade);
        // only the big hits get a number; the health on each ball says the rest
        if (e.dmg >= 4) text(ctx, `-${e.dmg}`, e.x, e.y - 12 - 60 * k, { size: 60, align: "center", color: e.dmg >= 6 ? "#FF3B30" : PAPER, stroke: 8 });
        break;
      case "ko": {
        const kk = age / (FX * 2);
        ctx.globalAlpha = Math.max(0, 1 - kk);
        for (let p = 0; p < 14; p++) {
          const ang = (p / 14) * Math.PI * 2 + i;
          circle(ctx, e.x + Math.cos(ang) * 170 * ease(kk), e.y + Math.sin(ang) * 170 * ease(kk), 14 * (1 - kk) + 2, color(e.team));
        }
        break;
      }
      case "heal":
        if (fade <= 0) break;
        ctx.globalAlpha = fade;
        // the menu's heart, with the amount
        heart(ctx, e.x - 26, e.y - 62 - 40 * k, 30, tier("heal").color);
        text(ctx, `+${e.n ?? 1}`, e.x + 12, e.y - 50 - 40 * k, { size: 44, align: "center", color: tier("heal").color, stroke: 7 });
        break;
      case "summon": {
        const kk = age / (FX * 2);
        ctx.globalAlpha = Math.max(0, 1 - kk);
        circle(ctx, e.x, e.y, 50 + 160 * ease(kk), undefined, color(e.team), 12 * (1 - kk));
        break;
      }
      case "boom": {
        const kk = age / (FX * 2);
        ctx.globalAlpha = Math.max(0, 1 - kk);
        circle(ctx, e.x, e.y, 40 + 200 * kk, "rgba(255,159,10,0.3)", "#FF9F0A", 12 * (1 - kk));
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }
}

/** A target on the ball a meteor is aimed at, and the meteor falling onto it. */
function drawMeteors(ctx: Ctx, show: Show, turn: number) {
  const w = show.world;
  for (const m of w.meteors) {
    if (w.clock < m.from) continue;
    const t = w.balls.find((b) => b.id === m.target && b.alive);
    const x = t ? t.x : m.x, y = t ? t.y : m.y;
    const k = Math.min(1, (w.clock - m.from) / (m.at - m.from));
    ctx.save();
    const rr = (t ? t.r : 60) + 40 - 24 * k;
    ctx.translate(x, y);
    ctx.rotate(turn * 2);
    ctx.strokeStyle = "#FF3B30";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(rr - 20, 0);
      ctx.lineTo(rr + 20, 0);
      ctx.stroke();
    }
    ctx.restore();
    const sx = x + 520 * (1 - k), sy = y - 900 * (1 - k);
    ctx.save();
    const g = ctx.createLinearGradient(sx, sy, sx + 170, sy - 300);
    g.addColorStop(0, "rgba(255,159,10,0.95)");
    g.addColorStop(1, "rgba(255,159,10,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 46;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + 170, sy - 300);
    ctx.stroke();
    circle(ctx, sx, sy, 38, "#FF9F0A", INK, 6);
    circle(ctx, sx - 9, sy - 9, 13, GOLD);
    ctx.restore();
  }
}

function drawArena(ctx: Ctx, show: Show, view: View, turn: number) {
  const w = show.world;
  const { lo, size } = w.arena();
  const sudden = w.clock >= LIVE_SUDDEN;

  // a shake when a ball is knocked out or a meteor lands
  let shake = 0;
  for (let i = w.events.length - 1; i >= 0; i--) {
    const e = w.events[i];
    const age = w.clock - e.f / FPS;
    if (age > 0.4) break;
    if ((e.type === "ko" || e.type === "boom") && age >= 0) shake = Math.max(shake, (e.type === "boom" ? 16 : 10) * (1 - age / 0.4));
  }

  ctx.save();
  ctx.translate(AX + Math.sin(turn * 37) * shake, AY + Math.cos(turn * 29) * shake);
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = "#111113";
  ctx.fillRect(0, 0, ARENA, ARENA);
  // each team's half, faintly
  ctx.fillStyle = "rgba(255,59,48,0.05)";
  ctx.fillRect(0, 0, ARENA / 2, ARENA);
  ctx.fillStyle = "rgba(10,132,255,0.05)";
  ctx.fillRect(ARENA / 2, 0, ARENA / 2, ARENA);

  if (sudden) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ARENA, ARENA);
    ctx.rect(lo + size, lo, -size, size);
    ctx.clip("evenodd");
    ctx.strokeStyle = "rgba(255,59,48,0.25)";
    ctx.lineWidth = 9;
    ctx.beginPath();
    for (let d = -ARENA; d < ARENA * 2; d += 22) {
      ctx.moveTo(d, 0);
      ctx.lineTo(d + ARENA, ARENA);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = sudden ? "#FF3B30" : PAPER;
  ctx.lineWidth = 8;
  ctx.strokeRect(lo, lo, size, size);

  ctx.save();
  ctx.beginPath();
  ctx.rect(-4, -4, ARENA + 8, ARENA + 8);
  ctx.clip();
  // the crown sits on the biggest ball of whoever's given the most
  let king: Ball | undefined;
  for (const b of w.balls) if (b.alive && show.crown && b.tag?.id === show.crown && (!king || b.r > king.r)) king = b;
  // champions under viewers' balls, so faces and names stay readable
  for (const b of w.balls) if (b.alive && !b.tag) drawBall(ctx, view, w, b, turn, false);
  for (const b of w.balls) if (b.alive && b.tag) drawBall(ctx, view, w, b, turn, b === king);
  drawEffects(ctx, show);
  drawMeteors(ctx, show, turn);
  ctx.restore();
  ctx.restore();

  if (sudden && show.phase === "fight") text(ctx, "THE WALLS ARE CLOSING IN", W / 2, AY + SIDE - 28, { size: 40, align: "center", color: "#FF3B30", spacing: 3, stroke: 8 });
}

// ── around it ──

function drawTop(ctx: Ctx, show: Show, view: View) {
  const y = 150;
  text(ctx, `ROUND ${show.round}`, M, y, { size: 32, color: DIM, spacing: 3 });
  const s0 = String(show.series[0]), s1 = String(show.series[1]);
  const w1 = measure(ctx, s1, 32, 2), wd = measure(ctx, "  –  ", 32, 2);
  text(ctx, s1, W - M, y, { size: 32, color: color(1), align: "right", spacing: 2 });
  text(ctx, "  –  ", W - M - w1, y, { size: 32, color: DIM, align: "right", spacing: 2 });
  text(ctx, s0, W - M - w1 - wd, y, { size: 32, color: color(0), align: "right", spacing: 2 });
  if (view.demo) text(ctx, "DEMO · PRETEND VIEWERS", W / 2, y, { size: 26, color: SIGNAL, align: "center", spacing: 3 });
  else if (view.status) text(ctx, view.status, W / 2, y, { size: 24, color: DIM, align: "center", spacing: 3 });
}

/** The two teams: how to join each, and how much health each has. */
function drawTeams(ctx: Ctx, show: Show) {
  const w = show.world;
  const y = 172, h = 168, gap = 20;
  const cw = (SIDE - gap) / 2;
  ([0, 1] as Team[]).forEach((t) => {
    const x = M + t * (cw + gap);
    const right = t === 1;
    roundRect(ctx, x, y, cw, h, 18, color(t));
    const inner = right ? x + cw - 26 : x + 26;
    const outer = right ? x + 26 : x + cw - 26;
    const a: CanvasTextAlign = right ? "right" : "left";
    const b: CanvasTextAlign = right ? "left" : "right";
    text(ctx, `TYPE ${t + 1}`, inner, y + 82, { size: 78, color: "#fff", align: a, spacing: 1 });
    text(ctx, `${TEAMS[t].name.toUpperCase()} · ${show.ability(t).toUpperCase()}`, inner, y + 122, { size: 30, color: "#fff", align: a, spacing: 2, alpha: 0.85 });
    const m = show.memberCount(t);
    if (m > 0) text(ctx, `${m} ${m === 1 ? "PLAYER" : "PLAYERS"}`, inner, y + 152, { size: 22, color: "#fff", align: a, spacing: 2, alpha: 0.7 });
    text(ctx, String(Math.ceil(w.hp(t))), outer, y + 104, { size: 96, color: "#fff", align: b });
    text(ctx, "HP", outer, y + 142, { size: 26, color: "#fff", align: b, spacing: 3, alpha: 0.75 });
  });

  // who's ahead, as one bar
  const h0 = w.hp(0), h1 = w.hp(1);
  const share = h0 + h1 > 0 ? h0 / (h0 + h1) : 0.5;
  const by = y + h + 12;
  const split = M + SIDE * share;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(M, by, SIDE, 18, 9);
  ctx.clip();
  ctx.fillStyle = color(0);
  ctx.fillRect(M, by, split - M, 18);
  ctx.fillStyle = color(1);
  ctx.fillRect(split, by, M + SIDE - split, 18);
  ctx.restore();
  ctx.fillStyle = PAPER;
  ctx.fillRect(split - 3, by - 6, 6, 30);
}

/**
 * The gift menu: six things a gift can do, by the gift viewers know. An
 * item lights up when someone sends it, and rage and shield show which
 * team has them and for how long.
 */
function drawMenu(ctx: Ctx, show: Show) {
  const w = show.world;
  const top = 392, h = 86, gap = 10;
  const cw = (SIDE - gap * 2) / 3;
  TIERS.forEach((t, i) => {
    const x = M + (i % 3) * (cw + gap), y = top + Math.floor(i / 3) * (h + gap);
    const sent = show.lit.get(t.effect);
    const flash = sent !== undefined ? Math.max(0, 1 - (show.now - sent) / 0.9) : 0;
    let on: { side: Team; left: number } | null = null;
    if (t.effect === "rage" || t.effect === "shield") {
      const until = t.effect === "rage" ? w.rage : w.shield;
      for (const s of [0, 1] as Team[]) if (until[s] > w.clock) on = { side: s, left: until[s] - w.clock };
    } else if (t.effect === "meteor" && w.meteors[0]) on = { side: w.meteors[0].team, left: 0 };

    roundRect(ctx, x, y, cw, h, 14, "#161618");
    if (flash > 0 || on) {
      ctx.save();
      ctx.globalAlpha = on ? 0.22 : 0.35 * flash;
      roundRect(ctx, x, y, cw, h, 14, t.color);
      ctx.restore();
    }
    outline(ctx, x, y, cw, h, 14, on || flash > 0.3 ? t.color : "rgba(244,241,234,0.16)", on ? 4 : 2);

    icon(ctx, t.effect, x + 42, y + h / 2, 44);
    text(ctx, t.name.toUpperCase(), x + 82, y + 44, { size: 36, color: t.color, spacing: 1, max: cw - 96 });
    if (on && t.effect !== "meteor") {
      text(ctx, `${TEAMS[on.side].name.toUpperCase()} · ${Math.ceil(on.left)}S LEFT`, x + 82, y + 72, { size: 22, color: color(on.side), spacing: 2 });
    } else {
      const g = t.gift.toUpperCase();
      const gw = measure(ctx, g, 22, 1.5);
      text(ctx, g, x + 82, y + 72, { size: 22, color: PAPER, spacing: 1.5, alpha: 0.8 });
      coin(ctx, x + 82 + gw + 14, y + 64, 7);
      text(ctx, String(t.min), x + 82 + gw + 26, y + 72, { size: 22, color: DIM, spacing: 1 });
    }
  });
}

/** Likes, and the crown, under the arena: who has it right now, or how to get it. */
function drawRules(ctx: Ctx, show: Show) {
  const y = AY + SIDE + 62;
  const line = (s: string, ly: number, size: number, col: string, pic: (x: number, y: number) => void) => {
    const w = measure(ctx, s, size, 2);
    pic(W / 2 - w / 2 - size * 0.5, ly - size * 0.36);
    text(ctx, s, W / 2 + size * 0.36, ly, { size, color: col, align: "center", spacing: 2 });
  };
  line("LIKES HEAL YOUR TEAM", y, 40, PAPER, (x, iy) => heart(ctx, x, iy + 2, 36, tier("heal").color));
  const king = show.crown ? show.members.get(show.crown) : undefined;
  const coins = show.crown ? show.roundCoins.get(show.crown) ?? 0 : 0;
  if (king) line(`${king.viewer.name.toUpperCase()} HAS THE CROWN · ${coins.toLocaleString("en-US")} COINS · OUTGIVE THEM`, y + 52, 32, GOLD, (x, iy) => crown(ctx, x, iy, 34));
  else line("BIGGEST GIFTER WEARS THE CROWN", y + 52, 34, DIM, (x, iy) => crown(ctx, x, iy, 34));
}

// ── the moments ──

const BLAST = 2;

/** when each big gift's moment on screen starts; a backlog is skipped, not replayed */
function blastTimes(show: Show): { b: Show["blasts"][number]; start: number }[] {
  let end = -Infinity;
  const out: { b: Show["blasts"][number]; start: number }[] = [];
  for (const b of show.blasts) {
    const start = Math.max(b.at, end);
    if (start - b.at > 3) continue;
    end = start + BLAST;
    out.push({ b, start });
  }
  return out;
}

/** Rage, a shield or a meteor: who sent it and what it does, big, over the arena. */
function drawBlast(ctx: Ctx, show: Show, view: View): boolean {
  for (const { b, start } of blastTimes(show)) {
    const age = show.now - start;
    if (age < 0 || age >= BLAST) continue;
    const k = Math.min(ease(age / 0.15), ease((BLAST - age) / 0.2));
    const t = b.tier;
    const us = TEAMS[b.side].name.toUpperCase(), them = TEAMS[1 - b.side].name.toUpperCase();
    const what = t.effect === "rage" ? `${us} HITS TWICE AS HARD` : t.effect === "shield" ? `${us} CAN'T BE HURT` : `ON ${them}'S BIGGEST BALL`;
    const x = AX + 26, y = AY + 22, bw = SIDE - 52, h = 196;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate(W / 2, y + h / 2);
    const s = 0.85 + 0.15 * pop(age * 4);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -(y + h / 2));
    roundRect(ctx, x, y, bw, h, 24, INK);
    outline(ctx, x, y, bw, h, 24, t.color, 6);
    face(ctx, view, b.viewer.name, b.viewer.avatar, x + 96, y + h / 2, 62, color(b.side), 7);
    text(ctx, `${b.viewer.name} sent ${b.count > 1 ? `${b.count}x ` : ""}${t.gift}`, x + 188, y + 54, { size: 32, max: bw - 340 });
    text(ctx, `${t.name.toUpperCase()}!`, x + 188, y + 144, { size: 84, color: t.color, spacing: 3, max: bw - 340 });
    text(ctx, what, x + 188, y + 180, { size: 26, color: DIM, spacing: 2, max: bw - 340 });
    icon(ctx, t.effect, x + bw - 86, y + h / 2, 92);
    ctx.restore();
    return true;
  }
  return false;
}

/** One line at a time over the top of the arena: who just sent what, and what it did. */
function drawToast(ctx: Ctx, show: Show, view: View) {
  const SHOW = 1.7;
  let end = -Infinity;
  for (const t of show.toasts) {
    const start = Math.max(t.at, end);
    // a backlog isn't worth replaying: the fight already shows it
    if (start - t.at > 2.5) continue;
    end = start + SHOW;
    const age = show.now - start;
    if (age < 0 || age >= SHOW) continue;
    const k = Math.min(ease(age / 0.18), ease((SHOW - age) / 0.18));
    const msg = `${t.viewer.name}  ${t.text}`;
    const tw = Math.min(720, measure(ctx, msg, 34, 1));
    const pw = tw + 106;
    const x = W / 2 - pw / 2, y = AY + 20 - (1 - k) * 20;
    ctx.save();
    ctx.globalAlpha = k;
    roundRect(ctx, x, y, pw, 66, 33, color(t.side));
    face(ctx, view, t.viewer.name, t.viewer.avatar, x + 34, y + 33, 24, "#fff", 3);
    text(ctx, msg, x + 70, y + 45, { size: 34, color: "#fff", spacing: 1, max: 720 });
    ctx.restore();
  }
}

function drawIntro(ctx: Ctx, show: Show) {
  const t = show.elapsed;
  const cx = W / 2, cy = AY + SIDE / 2;
  if (show.phase === "intro") {
    ctx.fillStyle = "rgba(11,11,12,0.82)";
    ctx.fillRect(AX, AY, SIDE, SIDE);
    text(ctx, `ROUND ${show.round}`, cx, AY + 140, { size: 54, color: DIM, align: "center", spacing: 6 });
    const left = Math.ceil(INTRO - t);
    if (left <= 3) {
      const k = 1 - (INTRO - t - (left - 1));
      const s = 1.4 - 0.4 * ease(k * 3);
      ctx.save();
      ctx.translate(cx, cy + 110);
      ctx.scale(s, s);
      text(ctx, String(left), 0, 0, { size: 320, align: "center", stroke: 14 });
      ctx.restore();
    } else {
      text(ctx, "PICK YOUR TEAM", cx, cy - 60, { size: 100, align: "center", spacing: 3 });
      ([0, 1] as Team[]).forEach((side) => {
        const pw = 340, ph = 124, px = cx + (side === 0 ? -pw - 18 : 18), py = cy;
        roundRect(ctx, px, py, pw, ph, 20, color(side));
        text(ctx, `TYPE ${side + 1}`, px + pw / 2, py + 92, { size: 80, color: "#fff", align: "center", spacing: 1 });
      });
    }
    text(ctx, "GIFTS SENT NOW LAND WHEN IT STARTS", cx, AY + SIDE - 80, { size: 34, color: DIM, align: "center", spacing: 2 });
  } else if (show.phase === "fight" && t < 0.9) {
    const k = t / 0.9;
    ctx.save();
    ctx.globalAlpha = 1 - ease(Math.max(0, k - 0.5) * 2);
    ctx.translate(cx, cy + 70);
    const s = 0.6 + 0.4 * pop(k * 2.2);
    ctx.scale(s, s);
    text(ctx, "FIGHT!", 0, 0, { size: 230, color: PAPER, align: "center", stroke: 16, spacing: 4 });
    ctx.restore();
  }
}

function drawKo(ctx: Ctx, show: Show) {
  if (show.phase !== "ko") return;
  const k = show.elapsed / KO_HOLD;
  ctx.save();
  ctx.translate(W / 2, AY + SIDE / 2 + 80);
  const s = 0.5 + 0.5 * pop(k * 3);
  ctx.scale(s, s);
  ctx.rotate(-0.05);
  text(ctx, show.byTime ? "TIME!" : "K.O.", 0, 0, { size: 270, color: show.winner === null ? PAPER : color(show.winner), align: "center", stroke: 18, spacing: 6 });
  ctx.restore();
}

function drawWin(ctx: Ctx, show: Show, view: View) {
  if (show.phase !== "win") return;
  const t = show.elapsed;
  const k = ease(t / 0.35);
  ctx.fillStyle = `rgba(11,11,12,${0.92 * k})`;
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  const win = show.winner;

  ctx.save();
  ctx.translate(cx, 720);
  const s = 0.6 + 0.4 * pop(t * 2);
  ctx.scale(s, s);
  if (win === null) text(ctx, "DRAW", 0, 0, { size: 260, align: "center", spacing: 4 });
  else {
    text(ctx, TEAMS[win].name.toUpperCase(), 0, 0, { size: 280, color: color(win), align: "center", spacing: 6 });
    text(ctx, "WINS", 0, 190, { size: 170, align: "center", spacing: 6 });
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = k;
  const s0 = String(show.series[0]), s1 = String(show.series[1]);
  const wd = measure(ctx, "  –  ", 60, 2);
  text(ctx, s0, cx - wd / 2, 1040, { size: 60, color: color(0), align: "right" });
  text(ctx, "  –  ", cx, 1040, { size: 60, color: DIM, align: "center", spacing: 2 });
  text(ctx, s1, cx + wd / 2, 1040, { size: 60, color: color(1) });

  if (show.mvp) {
    const m = show.mvp;
    crown(ctx, cx, 1170, 60);
    face(ctx, view, m.viewer.name, m.viewer.avatar, cx, 1275, 64, GOLD, 6);
    text(ctx, m.viewer.name, cx, 1400, { size: 60, align: "center", max: 900 });
  }
  text(ctx, `NEXT ROUND IN ${Math.max(1, Math.ceil(WIN - t))}`, cx, 1560, { size: 56, align: "center", spacing: 4 });
  text(ctx, "TYPE 1 OR 2 TO PICK YOUR TEAM", cx, 1630, { size: 38, color: DIM, align: "center", spacing: 3 });
  ctx.restore();
}

/** Draw the whole screen for this moment of the show. */
export function draw(ctx: Ctx, show: Show, view: View) {
  const turn = show.world.clock * 1.5;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  drawTop(ctx, show, view);
  drawTeams(ctx, show);
  drawMenu(ctx, show);
  drawArena(ctx, show, view, turn);
  if (!drawBlast(ctx, show, view)) drawToast(ctx, show, view);
  drawRules(ctx, show);
  drawIntro(ctx, show);
  drawKo(ctx, show);
  drawWin(ctx, show, view);
}
