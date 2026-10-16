import type { Icon } from "@/lib/live/menu";

/**
 * What every live game's screen is drawn with: the layout, the type, the
 * shapes, and the little pictures the gift menu and the fight share. A
 * stream covers the very top with the streamer's name and the bottom with
 * chat, so everything a viewer has to read sits in the middle.
 */

export const W = 1080;
export const H = 1920;
/** the margin each side, and the arena's square, which every game shares */
export const M = 80;
export const SIDE = W - 2 * M;
export const AX = M;
export const AY = 592;
/** every game's arena is 800 units across, drawn 920 pixels wide */
export const UNITS = 800;
export const SCALE = SIDE / UNITS;
export const PAPER = "#F4F1EA";
export const INK = "#0B0B0C";
export const DIM = "#8D8A83";
export const SIGNAL = "#FF4A1C";
export const GOLD = "#FFD60A";
export const CPU = "#5E5C58";
const FONT = "Anton";
/** how long a hit's spark stays up, in seconds of play */
export const FX = 0.5;

export type View = {
  /** pretend viewers are on: say so */
  demo: boolean;
  /** a viewer's picture, once it's loaded */
  image: (url: string) => HTMLImageElement | null;
  /** the connection's state, when it isn't connected */
  status?: string;
  /** the free plan's line at the bottom */
  tag?: boolean;
  /** something the streamer has to fix, in a bar across the top */
  notice?: string;
};

export type Ctx = CanvasRenderingContext2D;

export const ease = (k: number) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
/** a springy pop from 0 to 1 and a touch past it */
export const pop = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 + Math.sin(k * Math.PI * 1.5) * Math.exp(-k * 4) * 0.35 - (1 - k) ** 4);

export type TextOpts = { size: number; color?: string; align?: CanvasTextAlign; stroke?: number; spacing?: number; alpha?: number; max?: number };

export function text(ctx: Ctx, s: string, x: number, y: number, o: TextOpts) {
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

export function measure(ctx: Ctx, s: string, size: number, spacing = 0): number {
  ctx.save();
  ctx.font = `${size}px ${FONT}`;
  if ("letterSpacing" in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${spacing}px`;
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

export function circle(ctx: Ctx, x: number, y: number, r: number, fill?: string, stroke?: string, lw = 0) {
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

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function outline(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, stroke: string, lw: number) {
  ctx.beginPath();
  ctx.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, r);
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/** Dark text on light colours, white on dark ones. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? INK : "#fff";
}

/** A viewer's face in a circle, or their first letter when there's no picture. */
export function face(ctx: Ctx, view: View, name: string, avatar: string | undefined, x: number, y: number, r: number, ring: string, lw = Math.max(3, r * 0.12)) {
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

export function coin(ctx: Ctx, x: number, y: number, r: number) {
  circle(ctx, x, y, r, GOLD, INK, Math.max(1.5, r * 0.25));
}

// ── the pictures: one for each kind of thing on a menu, used the same way in the fight ──

export function heart(ctx: Ctx, x: number, y: number, s: number, fill: string) {
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

export function person(ctx: Ctx, x: number, y: number, r: number, fill: string) {
  circle(ctx, x, y, r, "#26262A", fill, Math.max(2, r * 0.16));
  circle(ctx, x, y - r * 0.18, r * 0.3, fill);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.84, 0, Math.PI * 2);
  ctx.clip();
  circle(ctx, x, y + r * 0.72, r * 0.52, fill);
  ctx.restore();
}

export function flame(ctx: Ctx, x: number, y: number, s: number, fill: string) {
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

export function shieldShape(ctx: Ctx, x: number, y: number, s: number, fill: string) {
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

export function meteorShape(ctx: Ctx, x: number, y: number, s: number, fill: string) {
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

export function crown(ctx: Ctx, x: number, y: number, s: number) {
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

function plus(ctx: Ctx, x: number, y: number, s: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.fillRect(x - s * 0.14, y - s * 0.42, s * 0.28, s * 0.84);
  ctx.fillRect(x - s * 0.42, y - s * 0.14, s * 0.84, s * 0.28);
}

function weight(ctx: Ctx, x: number, y: number, s: number, fill: string) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - s * 0.28, y - s * 0.2);
  ctx.lineTo(x + s * 0.28, y - s * 0.2);
  ctx.lineTo(x + s * 0.46, y + s * 0.42);
  ctx.lineTo(x - s * 0.46, y + s * 0.42);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  circle(ctx, x, y - s * 0.32, s * 0.14, undefined, fill, s * 0.08);
  ctx.restore();
}

function boost(ctx: Ctx, x: number, y: number, s: number, fill: string) {
  ctx.save();
  ctx.fillStyle = fill;
  for (const dx of [-0.22, 0.18]) {
    ctx.beginPath();
    ctx.moveTo(x + s * (dx - 0.2), y - s * 0.4);
    ctx.lineTo(x + s * (dx + 0.22), y);
    ctx.lineTo(x + s * (dx - 0.2), y + s * 0.4);
    ctx.lineTo(x + s * (dx - 0.06), y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function ghost(ctx: Ctx, x: number, y: number, s: number, fill: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y - s * 0.08, s * 0.36, Math.PI, 0);
  ctx.lineTo(x + s * 0.36, y + s * 0.42);
  for (let i = 0; i < 4; i++) ctx.lineTo(x + s * (0.36 - 0.18 * (i + 0.5)), y + s * (i % 2 ? 0.42 : 0.28));
  ctx.lineTo(x - s * 0.36, y + s * 0.42);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  circle(ctx, x - s * 0.13, y - s * 0.08, s * 0.07, INK);
  circle(ctx, x + s * 0.13, y - s * 0.08, s * 0.07, INK);
  ctx.restore();
}

function wave(ctx: Ctx, x: number, y: number, s: number, fill: string) {
  ctx.save();
  circle(ctx, x, y, s * 0.12, fill);
  for (const k of [0.26, 0.42]) {
    ctx.beginPath();
    ctx.arc(x, y, s * k, 0, Math.PI * 2);
    ctx.lineWidth = s * 0.08;
    ctx.strokeStyle = fill;
    ctx.stroke();
  }
  ctx.restore();
}

function rocket(ctx: Ctx, x: number, y: number, s: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.48);
  ctx.quadraticCurveTo(s * 0.2, -s * 0.2, s * 0.16, s * 0.24);
  ctx.lineTo(-s * 0.16, s * 0.24);
  ctx.quadraticCurveTo(-s * 0.2, -s * 0.2, 0, -s * 0.48);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = "#FF3B30";
  ctx.beginPath();
  ctx.moveTo(-s * 0.12, s * 0.26);
  ctx.lineTo(0, s * 0.5);
  ctx.lineTo(s * 0.12, s * 0.26);
  ctx.fill();
  ctx.restore();
}

/** A ball with spikes round it: the picture for spikes, and how a spiky ball looks. */
export function spikeRing(ctx: Ctx, x: number, y: number, r: number, turn: number, fill: string, len = 0.36) {
  const n = 12;
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const ang = turn + (i / (n * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? r * (1 + len) : r * 0.96;
    const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.06);
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** A blade from a ball's edge, the picture for a sword and the sword itself. */
export function blade(ctx: Ctx, x: number, y: number, r: number, angle: number, len: number) {
  const x0 = x + Math.cos(angle) * r, y0 = y + Math.sin(angle) * r;
  const x1 = x + Math.cos(angle) * (r + len), y1 = y + Math.sin(angle) * (r + len);
  ctx.save();
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
  ctx.restore();
}

export function icon(ctx: Ctx, kind: Icon, x: number, y: number, s: number, c: string) {
  if (kind === "heart") heart(ctx, x, y + s * 0.05, s * 0.95, c);
  else if (kind === "person-small") person(ctx, x, y, s * 0.3, c);
  else if (kind === "person") person(ctx, x, y, s * 0.46, c);
  else if (kind === "flame") flame(ctx, x, y, s, c);
  else if (kind === "shield") shieldShape(ctx, x, y, s, c);
  else if (kind === "meteor") meteorShape(ctx, x, y, s, c);
  else if (kind === "plus") plus(ctx, x, y, s, c);
  else if (kind === "weight") weight(ctx, x, y, s, c);
  else if (kind === "boost") boost(ctx, x, y, s, c);
  else if (kind === "ghost") ghost(ctx, x, y, s, c);
  else if (kind === "wave") wave(ctx, x, y, s, c);
  else if (kind === "rocket") rocket(ctx, x, y, s, c);
  else if (kind === "spikes") spikeRing(ctx, x, y, s * 0.3, 0, c, 0.5);
  else {
    circle(ctx, x - s * 0.2, y + s * 0.2, s * 0.18, c);
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.12;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.05, y + s * 0.05);
    ctx.lineTo(x + s * 0.42, y - s * 0.42);
    ctx.stroke();
    ctx.restore();
  }
}

/** how much bigger to draw a meteor that hits for `hit`: the old 30-damage one is 1, a Universe's about 2 */
export function meteorSize(hit: number): number {
  return Math.min(2.2, 1 + 0.4 * Math.log10(Math.max(1, hit / 30)));
}

/** A falling meteor onto (x, y), `k` of the way down, with the target ring over what it's aimed at; `size` draws a bigger one. */
export function meteorFall(ctx: Ctx, x: number, y: number, ring: number, k: number, turn: number, size = 1) {
  ctx.save();
  const rr = ring + 40 - 24 * k;
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
  ctx.lineWidth = 46 * size;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + 170, sy - 300);
  ctx.stroke();
  circle(ctx, sx, sy, 38 * size, "#FF9F0A", INK, 6);
  circle(ctx, sx - 9 * size, sy - 9 * size, 13 * size, GOLD);
  ctx.restore();
}

/** how hard to shake the arena, from the newest knockouts and blasts: a meteor that hits harder shakes harder */
export function shakeFrom(events: { f: number; type: string; dmg?: number; hit?: number }[], clock: number, fps: number): number {
  let shake = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const age = clock - e.f / fps;
    if (age > 0.4) break;
    const hard = e.type === "boom" ? 16 * meteorSize(e.hit ?? 0) : 10;
    if ((e.type === "ko" || e.type === "boom") && age >= 0) shake = Math.max(shake, hard * (1 - age / 0.4));
  }
  return shake;
}
