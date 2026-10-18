import { FPS } from "@/lib/battle/sim";
import { ARENA, type Fighter, type RoyaleGame } from "@/lib/live/games/royale";
import type { Show } from "@/lib/live/show";
import { words } from "@/lib/live/words";
import { crownLine, drawEffects, drawFloor, helpPic, ruleLines } from "./battle";
import {
  AX, AY, blade, circle, CPU, crown, ease, face, GOLD, HEAD, INK, M, meteorFall, nameOf, PAPER, roundRect, SCALE, shakeFrom, SIDE, SIGNAL, spikeRing, STRIP, text, W,
  type Ctx, type View,
} from "./kit";
import type { GameDraw } from "./types";

/**
 * Last One Standing's screen: a card that says how to get in and how
 * many are still alive, a strip of who's left, the arena, and the rules.
 */

const game = (show: Show) => show.game as RoyaleGame;

function drawFighter(ctx: Ctx, view: View, g: RoyaleGame, f: Fighter, turn: number, crowned: boolean) {
  // a new ball pops in, once play's begun; in the countdown everyone's already there
  const k = g.clock > 0 ? ease((g.clock - f.born) / 0.35) : 1;
  const r = f.r * (0.55 + 0.45 * k);
  const ring = f.cpu ? CPU : GOLD;
  if (f.spikesUntil > g.clock) spikeRing(ctx, f.x, f.y, r, turn, "#FF3B30", 0.34);
  if (f.swordUntil > g.clock) blade(ctx, f.x, f.y, r, f.angle, 100);
  ctx.save();
  if (f.fresh > g.clock) ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(turn * 10));
  if (f.cpu) {
    circle(ctx, f.x, f.y, r, "#26262A", CPU, Math.max(4, r * 0.14));
    text(ctx, "CPU", f.x, f.y + r * 0.3, { size: r * 0.8, align: "center", color: "#B9B6AE" });
  } else face(ctx, view, f.name, f.avatar, f.x, f.y, r, ring, Math.max(5, r * 0.14));
  ctx.restore();
  const hr = Math.max(15, r * 0.34);
  const hx = f.x + r * 0.74, hy = f.y - r * 0.74;
  circle(ctx, hx, hy, hr, f.cpu ? CPU : SIGNAL, INK, 4);
  text(ctx, String(Math.ceil(f.hp)), hx, hy + hr * 0.4, { size: hr * 1.1, align: "center", color: "#fff" });
  if (!f.cpu) text(ctx, nameOf(view, f.name), f.x, f.y + r + 26, { size: 24, align: "center", stroke: 7, max: 190 });
  if (f.shieldUntil > g.clock) {
    const pulse = 0.5 + 0.5 * Math.sin(turn * 6);
    circle(ctx, f.x, f.y, r + 14 + pulse * 4, "rgba(100,210,255,0.14)", "#64D2FF", 5);
  }
  if (crowned) crown(ctx, f.x, f.y - r - 26, Math.min(70, Math.max(38, r * 0.8)));
}

export const royaleDraw: GameDraw = {
  header(ctx, show) {
    const g = game(show);
    const { y, h } = HEAD;
    roundRect(ctx, M, y, SIDE, h, 18, SIGNAL);
    text(ctx, "TYPE GO", M + 28, y + 82, { size: 78, color: "#fff", spacing: 1 });
    text(ctx, "TO JOIN THE FIGHT · LAST ONE ALIVE WINS", M + 28, y + 124, { size: 28, color: "#fff", spacing: 1.5, alpha: 0.85, max: SIDE - 260 });
    const n = g.alive().length;
    text(ctx, String(n), M + SIDE - 28, y + 104, { size: 96, color: "#fff", align: "right" });
    text(ctx, "ALIVE", M + SIDE - 28, y + 142, { size: 26, color: "#fff", align: "right", spacing: 3, alpha: 0.8 });
    // who's left: a dot each, out ones faded
    const { y: by, h: bh } = STRIP;
    roundRect(ctx, M, by, SIDE, bh, bh / 2, "#1A1A1C");
    const all = g.fighters;
    const step = Math.min(34, (SIDE - 20) / Math.max(1, all.length));
    all.forEach((f, i) => circle(ctx, M + 14 + i * step, by + bh / 2, 6, f.alive ? (f.cpu ? CPU : GOLD) : "#2A2A2E"));
  },

  arena(ctx, show, view, turn) {
    const g = game(show);
    const { lo, size } = g.bounds();
    const sudden = g.sudden;
    const shake = shakeFrom(g.events, g.clock, FPS);
    ctx.save();
    ctx.translate(AX + Math.sin(turn * 37) * shake, AY + Math.cos(turn * 29) * shake);
    ctx.scale(SCALE, SCALE);
    drawFloor(ctx, lo, size, sudden);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-4, -4, ARENA + 8, ARENA + 8);
    ctx.clip();
    const king = show.crown ? g.fighters.find((f) => f.alive && f.id === show.crown) : undefined;
    const live = g.alive().sort((a, b) => Number(!a.cpu) - Number(!b.cpu));
    for (const f of live) drawFighter(ctx, view, g, f, turn, f === king);
    drawEffects(ctx, show, g.events, g.clock, (e) => e.color ?? GOLD);
    for (const m of g.meteors) {
      if (g.clock < m.from) continue;
      const t = g.fighters.find((f) => f.id === m.target && f.alive);
      meteorFall(ctx, t ? t.x : m.x, t ? t.y : m.y, t ? t.r : 60, Math.min(1, (g.clock - m.from) / (m.at - m.from)), turn);
    }
    ctx.restore();
    ctx.restore();
    if (sudden && show.phase === "play") text(ctx, "THE WALLS ARE CLOSING IN", W / 2, AY + SIDE - 28, { size: 40, align: "center", color: "#FF3B30", spacing: 3, stroke: 8 });
  },

  rules(ctx, show, view) {
    ruleLines(ctx, [
      { s: words(show.platform).royaleRules, size: 40, color: PAPER, pic: helpPic(ctx, show, 36) },
      { ...crownLine(show, view), pic: (x, y) => crown(ctx, x, y, 34) },
    ]);
  },

  active(show, effect, view) {
    const g = game(show);
    const key = effect === "shield" ? "shieldUntil" : effect === "sword" ? "swordUntil" : effect === "spikes" ? "spikesUntil" : null;
    if (key) {
      const f = g.alive().find((x) => x[key] > g.clock);
      if (f) return { text: `${nameOf(view, f.name).toUpperCase()} · ${Math.ceil(f[key] - g.clock)}S`, color: GOLD };
    }
    if (effect === "meteor" && g.meteors[0]) return { text: "INCOMING", color: "#FF9F0A" };
    return null;
  },

  prompt(ctx, show, cx, cy) {
    const g = game(show);
    text(ctx, "TYPE GO TO JOIN", cx, cy - 40, { size: 100, align: "center", spacing: 3 });
    text(ctx, "LAST ONE ALIVE WINS", cx, cy + 40, { size: 48, color: SIGNAL, align: "center", spacing: 3 });
    const n = g.alive().filter((f) => !f.cpu).length;
    text(ctx, `${n} IN SO FAR`, cx, cy + 110, { size: 40, align: "center", spacing: 3, alpha: 0.8 });
  },

  winner(show, view) {
    const c = show.result?.champion;
    if (!c) return { title: "NOBODY", color: PAPER, line: "EVERYONE WENT OUT" };
    const wins = show.winsOf(c);
    return { title: nameOf(view, c.name, c.cpu).toUpperCase(), color: c.cpu ? "#B9B6AE" : GOLD, entrant: c, line: c.cpu ? "THE CPU OUTLASTED EVERYONE" : wins > 1 ? `${wins} WINS TODAY` : "IS THE LAST ONE STANDING" };
  },

  blastLine(show, b, view) {
    const name = nameOf(view, b.viewer.name).toUpperCase();
    if (b.tier.effect === "shield") return `${name} CAN'T BE HURT`;
    if (b.tier.effect === "sword") return `${name} GETS A SPINNING SWORD`;
    if (b.many) return `ON ${name}'S ${b.many} BIGGEST RIVALS`;
    return `ON ${name}'S BIGGEST RIVAL`;
  },
};
