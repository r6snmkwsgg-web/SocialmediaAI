import { ABILITIES } from "@/lib/battle/abilities";
import { ARENA, FPS, type Ball, type BattleEvent, type Team } from "@/lib/battle/sim";
import { INTRO, KO_HOLD, LIVE_SUDDEN, WIN, type Show } from "@/lib/live/round";
import { LIKES_PER_HP, TIERS, type Effect } from "@/lib/live/rules";

/**
 * The live show, drawn onto a 1080 × 1920 canvas every frame: the same
 * look as the videos, plus what a live needs. A stream covers the top of
 * the picture with the streamer's name and the bottom with chat, so the
 * things a viewer has to read (how to join, what gifts do, who's winning)
 * sit in the middle.
 */

export const W = 1080;
export const H = 1920;
const AX = 60;
const AY = 560;
const SCALE = 960 / ARENA;
const PAPER = "#F4F1EA";
const INK = "#0B0B0C";
const DIM = "#8D8A83";
const SIGNAL = "#FF4A1C";
const COIN = "#FFD60A";
const FONT = "Anton";
/** how long a hit's spark and number stay up, in seconds of fight */
const FX = 0.6;

export type View = {
  /** pretend viewers are on: say so */
  demo: boolean;
  /** a viewer's picture, once it's loaded */
  image: (url: string) => HTMLImageElement | null;
  /** the connection's state, shown small at the top */
  status?: string;
};

type Ctx = CanvasRenderingContext2D;

const ease = (k: number) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
/** a springy pop from 0 to 1 and a touch past it */
const pop = (k: number) => {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  return 1 + Math.sin(k * Math.PI * 1.5) * Math.exp(-k * 4) * 0.35 - (1 - k) ** 4;
};

function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? INK : "#fff";
}

type TextOpts = { size: number; color?: string; align?: CanvasTextAlign; stroke?: number; spacing?: number; alpha?: number; max?: number; base?: CanvasTextBaseline };

/** Anton text, with an ink outline when it sits on top of things. */
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
  ctx.textBaseline = o.base ?? "alphabetic";
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

function coin(ctx: Ctx, x: number, y: number, r: number) {
  circle(ctx, x, y, r, COIN, INK, Math.max(2, r * 0.22));
  circle(ctx, x, y, r * 0.45, undefined, "#C9A400", Math.max(1.5, r * 0.16));
}

/** A viewer's face in a circle, or their first letter when there's no picture. */
function face(ctx: Ctx, view: View, name: string, avatar: string | undefined, x: number, y: number, r: number, ring: string) {
  const img = avatar ? view.image(avatar) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  else {
    ctx.fillStyle = "#2A2A2E";
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    text(ctx, (name.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase(), x, y + r * 0.42, { size: r * 1.15, align: "center" });
  }
  ctx.restore();
  circle(ctx, x, y, r, undefined, ring, Math.max(3, r * 0.12));
}

const colorOf = (show: Show, t: Team) => ABILITIES[show.kind(t)].color;

// ── the arena ──

function drawBall(ctx: Ctx, show: Show, view: View, b: Ball, turn: number) {
  const color = colorOf(show, b.team);
  const w = show.world;
  const age = w.clock - b.born;
  // a summoned ball drops in
  const grow = b.born > 0 ? ease(age / 0.35) : 1;
  const r = b.r * (0.4 + 0.6 * grow);

  if (w.raging(b.team)) {
    const flick = 0.5 + 0.5 * Math.sin(turn * 9 + b.id);
    circle(ctx, b.x, b.y, r + 14 + flick * 6, "rgba(255,59,48,0.22)");
    circle(ctx, b.x, b.y, r + 10, undefined, "#FF3B30", 4);
  }
  if (b.kind === "spike") {
    const n = 12;
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const ang = turn + (i / (n * 2)) * Math.PI * 2;
      const rad = i % 2 === 0 ? r + 22 * (r / b.r) : r - 2;
      const px = b.x + Math.cos(ang) * rad, py = b.y + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  if (b.kind === "sword") {
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

  const fresh = b.fresh > w.clock;
  ctx.save();
  if (fresh) ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(turn * 12));
  if (b.tag) {
    // a viewer's ball: their face, in their side's colour
    circle(ctx, b.x, b.y, r, color);
    face(ctx, view, b.tag.name, b.tag.avatar, b.x, b.y, Math.max(8, r - 7), color);
    circle(ctx, b.x, b.y, r, undefined, PAPER, 4);
    const hpR = Math.max(15, r * 0.42);
    circle(ctx, b.x + r * 0.72, b.y - r * 0.72, hpR, color, INK, 4);
    text(ctx, String(Math.ceil(b.hp)), b.x + r * 0.72, b.y - r * 0.72 + hpR * 0.42, { size: hpR * 1.15, align: "center", color: textOn(color) });
    text(ctx, b.tag.name, b.x, b.y + r + 28, { size: 26, align: "center", stroke: 7, max: 180 });
  } else {
    circle(ctx, b.x, b.y, r, color, b.child ? INK : PAPER, b.child ? 4 : 6);
    const size = Math.max(24, r * 0.95);
    text(ctx, String(Math.ceil(b.hp)), b.x, b.y + size * 0.36, { size, align: "center", color: textOn(color) });
  }
  ctx.restore();

  if (w.shielded(b.team)) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    circle(ctx, b.x, b.y, r + 12, "rgba(100,210,255,0.16)", "#64D2FF", 5);
    ctx.restore();
  }
}

function drawEffects(ctx: Ctx, show: Show, events: BattleEvent[], from: number) {
  const w = show.world;
  for (let i = from; i < events.length; i++) {
    const e = events[i];
    const age = w.clock - e.f / FPS;
    if (age < 0 || age > FX * 1.6) continue;
    const k = age / FX;
    const fade = Math.max(0, 1 - k);
    if (fade <= 0 && e.type !== "summon" && e.type !== "boom") continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    switch (e.type) {
      case "hit":
      case "cut": {
        const big = e.dmg >= 3;
        if (e.type === "hit") circle(ctx, e.cx, e.cy, 10 + 50 * k, undefined, PAPER, 6 * fade);
        text(ctx, `-${e.dmg}`, e.x, e.y - 14 - 70 * k, { size: big ? 64 : 48, align: "center", color: e.type === "cut" ? "#64D2FF" : big ? "#FF3B30" : PAPER, stroke: 8 });
        break;
      }
      case "block":
        text(ctx, "BLOCK", e.x, e.y - 20 - 50 * k, { size: 40, align: "center", color: "#64D2FF", stroke: 8 });
        break;
      case "boom": {
        const kk = age / (FX * 1.4);
        ctx.globalAlpha = Math.max(0, 1 - kk);
        circle(ctx, e.x, e.y, 30 + 160 * kk, "rgba(255,159,10,0.35)", "#FF9F0A", 10 * (1 - kk));
        break;
      }
      case "ko": {
        const c = colorOf(show, e.team);
        for (let p = 0; p < 12; p++) {
          const ang = (p / 12) * Math.PI * 2 + i;
          circle(ctx, e.x + Math.cos(ang) * 140 * k, e.y + Math.sin(ang) * 140 * k, 12 * fade + 2, c);
        }
        break;
      }
      case "spawn":
        text(ctx, `+${e.n}`, e.x, e.y - 60 - 50 * k, { size: 52, align: "center", color: colorOf(show, e.team), stroke: 8 });
        break;
      case "heal":
        text(ctx, `+${e.n ?? 1}`, e.x, e.y - 50 - 40 * k, { size: e.n && e.n >= 5 ? 56 : 40, align: "center", color: "#FF6FB5", stroke: 7 });
        break;
      case "summon": {
        const kk = age / (FX * 1.6);
        ctx.globalAlpha = Math.max(0, 1 - kk);
        circle(ctx, e.x, e.y, 40 + 140 * ease(kk), undefined, colorOf(show, e.team), 10 * (1 - kk));
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }
}

function drawMeteors(ctx: Ctx, show: Show, turn: number) {
  const w = show.world;
  for (const m of w.meteors) {
    const t = w.balls.find((b) => b.id === m.target && b.alive);
    const x = t ? t.x : m.x, y = t ? t.y : m.y;
    const k = Math.min(1, Math.max(0, (w.clock - m.from) / (m.at - m.from)));
    if (w.clock < m.from) continue;
    // a target on the ball it's coming for
    ctx.save();
    const rr = 90 - 30 * k;
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
      ctx.moveTo(rr - 22, 0);
      ctx.lineTo(rr + 22, 0);
      ctx.stroke();
    }
    ctx.restore();
    // and the meteor, falling in from the top corner
    const sx = x + 520 * (1 - k), sy = y - 900 * (1 - k);
    ctx.save();
    const g = ctx.createLinearGradient(sx, sy, sx + 160, sy - 280);
    g.addColorStop(0, "rgba(255,159,10,0.9)");
    g.addColorStop(1, "rgba(255,159,10,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 40;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + 160, sy - 280);
    ctx.stroke();
    circle(ctx, sx, sy, 34, "#FF9F0A", INK, 6);
    circle(ctx, sx - 8, sy - 8, 12, "#FFD60A");
    ctx.restore();
  }
}

function drawArena(ctx: Ctx, show: Show, view: View, turn: number) {
  const w = show.world;
  const { lo, size } = w.arena();
  const sudden = w.clock >= LIVE_SUDDEN;

  // a shake when something big goes off
  let shake = 0;
  const ev = w.events;
  let from = ev.length;
  while (from > 0 && w.clock - ev[from - 1].f / FPS < FX * 1.6) from--;
  for (let i = from; i < ev.length; i++) {
    const e = ev[i];
    const age = w.clock - e.f / FPS;
    if (age >= 0 && age < 0.27 && (e.type === "boom" || e.type === "ko")) shake = Math.max(shake, (e.type === "boom" ? 12 : 7) * (1 - age / 0.27));
  }
  const sx = Math.sin(turn * 37) * shake, sy = Math.cos(turn * 29) * shake;

  ctx.save();
  ctx.translate(AX + sx, AY + sy);
  ctx.scale(SCALE, SCALE);

  // the floor
  ctx.fillStyle = "#101012";
  ctx.fillRect(0, 0, ARENA, ARENA);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let g = 50; g < ARENA; g += 50) {
    ctx.moveTo(g, 0);
    ctx.lineTo(g, ARENA);
    ctx.moveTo(0, g);
    ctx.lineTo(ARENA, g);
  }
  ctx.stroke();

  if (sudden) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ARENA, ARENA);
    ctx.rect(lo + size, lo, -size, size);
    ctx.clip("evenodd");
    ctx.strokeStyle = "rgba(255,59,48,0.28)";
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

  for (const m of w.mines) {
    if (!m.alive) continue;
    circle(ctx, m.x, m.y, 16, INK, colorOf(show, m.team), 5);
    if (w.clock - m.born >= 0.6 && Math.floor(w.clock * 4) % 2 === 0) circle(ctx, m.x, m.y, 6, "#FF3B30");
  }
  // plain balls under viewers' balls, so names stay readable; nothing pokes out past the walls
  ctx.save();
  ctx.beginPath();
  ctx.rect(-4, -4, ARENA + 8, ARENA + 8);
  ctx.clip();
  for (const b of w.balls) if (b.alive && !b.tag) drawBall(ctx, show, view, b, turn);
  for (const b of w.balls) if (b.alive && b.tag) drawBall(ctx, show, view, b, turn);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ARENA, ARENA);
  ctx.clip();
  drawEffects(ctx, show, ev, from);
  drawMeteors(ctx, show, turn);
  ctx.restore();
  ctx.restore();

  // what's going on, along the bottom of the arena
  const note = show.phase !== "fight" ? null : show.speed < 1 ? "CLUTCH: SLOW MOTION" : sudden ? "SUDDEN DEATH: THE WALLS ARE CLOSING" : null;
  if (note) text(ctx, note, W / 2, AY + 960 - 26, { size: 38, align: "center", color: note.startsWith("SUDDEN") ? "#FF3B30" : PAPER, spacing: 3, stroke: 8 });
}

// ── around the arena ──

function drawTop(ctx: Ctx, show: Show, view: View) {
  text(ctx, `ROUND ${show.round}`, AX, 168, { size: 34, color: DIM, spacing: 3 });
  const s = `${show.series[0]} – ${show.series[1]}`;
  text(ctx, "SERIES", W - AX - measure(ctx, s, 34, 3) - 16, 168, { size: 22, color: DIM, align: "right", spacing: 3 });
  const s0 = String(show.series[0]), s1 = String(show.series[1]);
  const w1 = measure(ctx, s1, 34, 3), wd = measure(ctx, " – ", 34, 3);
  text(ctx, s1, W - AX, 168, { size: 34, color: colorOf(show, 1), align: "right", spacing: 3 });
  text(ctx, " – ", W - AX - w1, 168, { size: 34, color: DIM, align: "right", spacing: 3 });
  text(ctx, s0, W - AX - w1 - wd, 168, { size: 34, color: colorOf(show, 0), align: "right", spacing: 3 });
  if (view.demo) text(ctx, "DEMO · PRETEND VIEWERS", W / 2, 168, { size: 28, color: SIGNAL, align: "center", spacing: 3 });
  else if (view.status) text(ctx, view.status, W / 2, 168, { size: 24, color: DIM, align: "center", spacing: 3 });
}

/** The gift guide: what each price of gift does, in one row of chips. */
function drawGuide(ctx: Ctx, show: Show) {
  const y = 200, h = 108, gap = 10;
  const cw = (W - 2 * AX - gap * (TIERS.length - 1)) / TIERS.length;
  // light up the chip for a gift that just landed
  const lit = new Map<Effect, number>();
  for (const c of show.callouts) {
    const age = show.now - c.at;
    if (age >= 0 && age < 1.2) lit.set(c.effect, Math.max(lit.get(c.effect) ?? 0, 1 - age / 1.2));
  }
  TIERS.forEach((t, i) => {
    const x = AX + i * (cw + gap);
    const glow = lit.get(t.effect) ?? 0;
    ctx.fillStyle = glow > 0 ? `rgba(255,214,10,${0.15 + 0.35 * glow})` : "#151517";
    ctx.fillRect(x, y, cw, h);
    ctx.strokeStyle = glow > 0 ? COIN : "rgba(244,241,234,0.22)";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, h - 3);
    const n = String(t.min);
    const nw = measure(ctx, n, 46);
    coin(ctx, x + (cw - nw) / 2 - 8, y + 40, 12);
    text(ctx, n, x + (cw - nw) / 2 + 12, y + 57, { size: 46 });
    text(ctx, t.short.toUpperCase(), x + cw / 2, y + 92, { size: 24, color: i >= 3 ? COIN : DIM, align: "center", spacing: 2, max: cw - 14 });
  });
}

function drawMatchup(ctx: Ctx, show: Show) {
  const A = ABILITIES[show.a], B = ABILITIES[show.b];
  const size = Math.min(104, 1500 / (A.name.length + B.name.length + 4));
  const vs = measure(ctx, "VS", size * 0.6);
  const wa = measure(ctx, A.name.toUpperCase(), size, 2), wb = measure(ctx, B.name.toUpperCase(), size, 2);
  const total = wa + vs + wb + 60;
  let x = W / 2 - total / 2;
  const y = 420;
  text(ctx, A.name.toUpperCase(), x, y, { size, color: A.color, spacing: 2 });
  const ca = x + wa / 2;
  x += wa + 30;
  text(ctx, "VS", x, y - size * 0.12, { size: size * 0.6, color: PAPER });
  x += vs + 30;
  text(ctx, B.name.toUpperCase(), x, y, { size, color: B.color, spacing: 2 });
  const cb = x + wb / 2;
  // how to join, under each name
  const pill = (cx: number, n: string, side: Team) => {
    const label = `TYPE ${n}`;
    const lw = measure(ctx, label, 30, 2) + 30;
    ctx.fillStyle = PAPER;
    ctx.fillRect(cx - lw / 2, y + 16, lw, 44);
    text(ctx, label, cx, y + 50, { size: 30, color: INK, align: "center", spacing: 2 });
    // how many are on the side, beside the pill on the outside
    const m = show.memberCount(side);
    if (m > 0) {
      const s = `${m} ${m === 1 ? "PLAYER" : "PLAYERS"}`;
      if (side === 0) text(ctx, s, cx - lw / 2 - 14, y + 48, { size: 24, color: DIM, align: "right", spacing: 2 });
      else text(ctx, s, cx + lw / 2 + 14, y + 48, { size: 24, color: DIM, spacing: 2 });
    }
  };
  pill(ca, "1", 0);
  pill(cb, "2", 1);
}

function drawTug(ctx: Ctx, show: Show) {
  const w = show.world;
  const hp: [number, number] = [w.hp(0), w.hp(1)];
  const total = hp[0] + hp[1];
  const share = total > 0 ? hp[0] / total : 0.5;
  const y = 506, h = 40;
  const bw = W - 2 * AX;
  const split = AX + bw * share;
  const A = colorOf(show, 0), B = colorOf(show, 1);
  ctx.fillStyle = "#1A1A1C";
  ctx.fillRect(AX, y, bw, h);
  ctx.fillStyle = A;
  ctx.fillRect(AX, y, split - AX, h);
  ctx.fillStyle = B;
  ctx.fillRect(split, y, AX + bw - split, h);
  ctx.fillStyle = PAPER;
  ctx.fillRect(split - 4, y - 8, 8, h + 16);
  text(ctx, `${Math.ceil(hp[0])} HP`, AX + 14, y + 32, { size: 32, color: textOn(A) });
  text(ctx, `${Math.ceil(hp[1])} HP`, AX + bw - 14, y + 32, { size: 32, color: textOn(B), align: "right" });
  // what each side has going for it right now
  const buffs = (t: Team) => {
    const out: string[] = [];
    if (w.raging(t)) out.push(`RAGE ${Math.ceil(w.rage[t] - w.clock)}S`);
    if (w.shielded(t)) out.push(`SHIELD ${Math.ceil(w.shield[t] - w.clock)}S`);
    return out.join("  ");
  };
  const b0 = buffs(0), b1 = buffs(1);
  if (b0) text(ctx, b0, AX + 150, y + 32, { size: 26, color: textOn(A), spacing: 2 });
  if (b1) text(ctx, b1, AX + bw - 150, y + 32, { size: 26, color: textOn(B), align: "right", spacing: 2 });
}

/** Each side's corner: likes, this round's top gifters, and what just happened. */
function drawSides(ctx: Ctx, show: Show, view: View) {
  const top = AY + 960 + 26;
  const cw = (W - 2 * AX - 30) / 2;
  ([0, 1] as Team[]).forEach((t) => {
    const x = AX + t * (cw + 30);
    const color = colorOf(show, t);
    const right = t === 1;
    const ax = right ? x + cw : x;
    const align: CanvasTextAlign = right ? "right" : "left";
    text(ctx, `${t + 1} · ${ABILITIES[show.kind(t)].name.toUpperCase()}`, ax, top + 38, { size: 40, color, align, spacing: 2 });

    // likes toward the next HP
    const ly = top + 58;
    ctx.fillStyle = "#1A1A1C";
    ctx.fillRect(x, ly, cw, 22);
    ctx.fillStyle = "#FF6FB5";
    const k = show.likes[t] / LIKES_PER_HP;
    if (right) ctx.fillRect(x + cw - cw * k, ly, cw * k, 22);
    else ctx.fillRect(x, ly, cw * k, 22);
    text(ctx, `${show.roundLikes[t].toLocaleString("en-US")} LIKES · EVERY ${LIKES_PER_HP} = +1 HP`, ax, ly + 50, { size: 22, color: DIM, align, spacing: 2 });

    // this round's biggest gifters on the side
    show.top(t, 3).forEach((g, i) => {
      const gy = ly + 92 + i * 52;
      const fx = right ? x + cw - 22 : x + 22;
      face(ctx, view, g.viewer.name, g.viewer.avatar, fx, gy, 20, i === 0 ? COIN : color);
      const nx = right ? fx - 34 : fx + 34;
      text(ctx, g.viewer.name, nx, gy + 10, { size: 28, align, max: cw - 170 });
      const cs = g.coins.toLocaleString("en-US");
      const cwid = measure(ctx, cs, 28);
      const cx = right ? x + 8 : x + cw - 8;
      text(ctx, cs, cx, gy + 10, { size: 28, color: COIN, align: right ? "left" : "right" });
      coin(ctx, right ? cx + cwid + 16 : cx - cwid - 16, gy, 10);
    });

    // the last couple of things that happened on this side
    const recent = show.feed.filter((f) => f.side === t).slice(-2);
    recent.forEach((f, i) => {
      const fy = top + 330 + i * 34;
      const age = show.now - f.at;
      const s = `${f.viewer.name} ${f.text}`;
      text(ctx, s, ax, fy, { size: 24, color: i === recent.length - 1 && age < 1.5 ? PAPER : DIM, align, max: cw, alpha: Math.min(1, 0.4 + (show.now - f.at < 20 ? 0.6 : 0)) });
    });
  });
}

// ── the moments ──

/** The countdown before a fight, and FIGHT! as it starts. */
function drawIntro(ctx: Ctx, show: Show) {
  const t = show.elapsed;
  const cx = W / 2, cy = AY + 480;
  if (show.phase === "intro") {
    ctx.fillStyle = "rgba(11,11,12,0.72)";
    ctx.fillRect(AX, AY, 960, 960);
    text(ctx, `ROUND ${show.round}`, cx, cy - 250, { size: 56, color: DIM, align: "center", spacing: 6 });
    const left = Math.ceil(INTRO - t);
    if (left <= 3) {
      const k = 1 - (INTRO - t - (left - 1));
      const s = 1.4 - 0.4 * ease(k * 3);
      ctx.save();
      ctx.translate(cx, cy + 90);
      ctx.scale(s, s);
      text(ctx, String(left), 0, 0, { size: 300, align: "center", stroke: 14 });
      ctx.restore();
    } else {
      text(ctx, "PICK A SIDE", cx, cy + 10, { size: 120, align: "center", spacing: 4 });
      text(ctx, "TYPE 1 OR 2 IN CHAT", cx, cy + 100, { size: 56, color: COIN, align: "center", spacing: 4 });
    }
    text(ctx, "GIFTS SENT NOW LAND WHEN IT STARTS", cx, cy + 300, { size: 32, color: DIM, align: "center", spacing: 3 });
  } else if (show.phase === "fight" && t < 0.9) {
    const k = t / 0.9;
    ctx.save();
    ctx.globalAlpha = 1 - ease(Math.max(0, k - 0.5) * 2);
    ctx.translate(cx, cy + 60);
    const s = 0.6 + 0.4 * pop(k * 2.2);
    ctx.scale(s, s);
    text(ctx, "FIGHT!", 0, 0, { size: 220, color: SIGNAL, align: "center", stroke: 16, spacing: 4 });
    ctx.restore();
  }
}

function drawKo(ctx: Ctx, show: Show) {
  if (show.phase !== "ko") return;
  const k = show.elapsed / KO_HOLD;
  ctx.save();
  ctx.translate(W / 2, AY + 540);
  const s = 0.5 + 0.5 * pop(k * 3);
  ctx.scale(s, s);
  ctx.rotate(-0.06);
  text(ctx, show.byTime ? "TIME!" : "K.O.", 0, 0, { size: 260, color: show.winner === null ? PAPER : colorOf(show, show.winner), align: "center", stroke: 18, spacing: 6 });
  ctx.restore();
}

function drawWin(ctx: Ctx, show: Show, view: View) {
  if (show.phase !== "win") return;
  const t = show.elapsed;
  const k = ease(t / 0.35);
  ctx.fillStyle = `rgba(11,11,12,${0.9 * k})`;
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  const win = show.winner;
  const name = win === null ? "DRAW" : ABILITIES[show.kind(win)].name.toUpperCase();
  const color = win === null ? PAPER : colorOf(show, win);
  ctx.save();
  ctx.translate(cx, 700);
  const s = 0.6 + 0.4 * pop(t * 2);
  ctx.scale(s, s);
  text(ctx, name, 0, 0, { size: Math.min(220, 1400 / Math.max(4, name.length)), color, align: "center", spacing: 4 });
  if (win !== null) text(ctx, "WINS", 0, 170, { size: 160, align: "center", spacing: 4 });
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = k;
  const w = show.world;
  const sub = win === null ? "NOBODY LEFT STANDING" : show.byTime ? `ON HEALTH, ${Math.ceil(w.hp(win))} TO ${Math.ceil(w.hp((1 - win) as Team))}` : `TEAM ${win + 1} TAKES ROUND ${show.round}`;
  text(ctx, sub, cx, 960, { size: 50, color: DIM, align: "center", spacing: 3 });
  text(ctx, `SERIES ${show.series[0]} – ${show.series[1]}`, cx, 1040, { size: 50, align: "center", spacing: 3 });
  if (show.streak && show.streak.n >= 2 && win !== null) text(ctx, `${show.streak.n} IN A ROW`, cx, 1110, { size: 44, color, align: "center", spacing: 4 });

  if (show.mvp) {
    const m = show.mvp;
    text(ctx, "MVP", cx, 1230, { size: 40, color: COIN, align: "center", spacing: 8 });
    face(ctx, view, m.viewer.name, m.viewer.avatar, cx, 1320, 62, COIN);
    text(ctx, m.viewer.name, cx, 1440, { size: 60, align: "center", max: 900 });
    const cs = `${m.coins.toLocaleString("en-US")} COINS`;
    const cw = measure(ctx, cs, 40, 2);
    coin(ctx, cx - cw / 2 - 22, 1484, 14);
    text(ctx, cs, cx + 14, 1498, { size: 40, color: COIN, align: "center", spacing: 2 });
  }
  const next = Math.max(0, Math.ceil(WIN - t));
  text(ctx, `NEXT ROUND IN ${next}`, cx, 1640, { size: 56, align: "center", spacing: 4 });
  text(ctx, "TYPE 1 OR 2 TO PICK YOUR SIDE", cx, 1710, { size: 38, color: DIM, align: "center", spacing: 3 });
  ctx.restore();
}

/** Big gifts get their moment: one banner at a time, over the arena. */
function drawCallouts(ctx: Ctx, show: Show, view: View) {
  const SHOW = 2.2;
  let end = -Infinity;
  for (const c of show.callouts) {
    const start = Math.max(c.at, end);
    end = start + SHOW;
    const age = show.now - start;
    if (age < 0 || age >= SHOW) continue;
    const inK = ease(age / 0.25), outK = ease((SHOW - age) / 0.25);
    const k = Math.min(inK, outK);
    const color = colorOf(show, c.side);
    const y = AY + 24;
    const h = 124;
    const x = AX + 30 + (1 - k) * (c.side === 0 ? -200 : 200);
    const bw = 960 - 60;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = INK;
    ctx.fillRect(x + 8, y + 8, bw, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, bw, h);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.strokeRect(x, y, bw, h);
    face(ctx, view, c.viewer.name, c.viewer.avatar, x + 72, y + h / 2, 44, INK);
    const ink = textOn(color);
    text(ctx, c.viewer.name, x + 136, y + 52, { size: 42, color: ink, max: bw - 170 });
    text(ctx, `${c.count > 1 ? `${c.count}× ` : ""}${c.gift.toUpperCase()} → ${c.label.toUpperCase()}`, x + 136, y + 98, { size: 32, color: ink, spacing: 2, max: bw - 170 });
    ctx.restore();
  }
}

/** Draw the whole screen for this moment of the show. */
export function draw(ctx: Ctx, show: Show, view: View) {
  const turn = show.world.clock * 1.5;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  drawTop(ctx, show, view);
  drawGuide(ctx, show);
  drawMatchup(ctx, show);
  drawTug(ctx, show);
  drawArena(ctx, show, view, turn);
  drawIntro(ctx, show);
  drawKo(ctx, show);
  drawCallouts(ctx, show, view);
  drawSides(ctx, show, view);
  drawWin(ctx, show, view);
}
