import { ARENA, FPS, type Ball, type Team } from "@/lib/battle/sim";
import type { BattleGame } from "@/lib/live/games/battle";
import type { Blast, Show } from "@/lib/live/show";
import {
  AX, AY, blade, circle, crown, face, flame, FX, heart, INK, M, PAPER, roundRect, SCALE, shakeFrom, SIDE, spikeRing, text, W,
  type Ctx, type View, ease, measure, meteorFall, meteorSize,
} from "./kit";
import type { GameDraw } from "./types";

/**
 * Ball Battle's screen: the two team cards (how to join, and their
 * health), the arena with each team's champion and its viewers' balls,
 * and the rules underneath.
 */

const game = (show: Show) => show.game as BattleGame;
const teamColor = (show: Show, t: Team) => show.teams[t].color;

function drawBall(ctx: Ctx, show: Show, view: View, b: Ball, turn: number, crowned: boolean) {
  const w = game(show).world;
  const c = teamColor(show, b.team);
  const k = b.born > 0 ? ease((w.clock - b.born) / 0.35) : 1;
  const r = b.r * (0.55 + 0.45 * k);
  const fresh = b.fresh > w.clock;
  const raging = w.rage[b.team] > w.clock;

  if (raging) {
    // flames round it: the menu's rage picture, on every ball of the team
    for (let i = 0; i < 8; i++) {
      const a = turn * 1.5 + (i / 8) * Math.PI * 2;
      const flick = 0.75 + 0.25 * Math.sin(turn * 14 + i * 2);
      flame(ctx, b.x + Math.cos(a) * (r + 10), b.y + Math.sin(a) * (r + 10), 30 * flick, i % 2 ? "#FF9F0A" : "#FF3B30");
    }
  }
  if (!b.plain && b.kind === "spike") spikeRing(ctx, b.x, b.y, r, turn, c, 22 / r);
  if (!b.plain && b.kind === "sword") blade(ctx, b.x, b.y, r, b.angle, b.blade);

  ctx.save();
  if (fresh) ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(turn * 10));
  if (b.tag) {
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
  if (w.hanging[b.team] > w.clock) {
    // hanging on: a ring that beats fast, until the team's paid off what it owes or goes down
    const beat = 0.5 + 0.5 * Math.sin(turn * 14);
    circle(ctx, b.x, b.y, r + 12 + beat * 10, undefined, "#FF3B30", 6 + beat * 4);
  }
  if (crowned) crown(ctx, b.x, b.y - r - 26, Math.min(76, Math.max(40, r * 0.8)));
}

/** Sparks, knockouts, heals and drop-ins, from the newest events back. */
export function drawEffects(ctx: Ctx, show: Show, events: Show["game"]["events"], clock: number, color: (e: { team?: Team; color?: string }) => string) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const age = clock - e.f / FPS;
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
          circle(ctx, e.x + Math.cos(ang) * 170 * ease(kk), e.y + Math.sin(ang) * 170 * ease(kk), 14 * (1 - kk) + 2, color(e));
        }
        break;
      }
      case "heal":
        if (fade <= 0) break;
        ctx.globalAlpha = fade;
        heart(ctx, e.x - 26, e.y - 62 - 40 * k, 30, "#FF6FB5");
        text(ctx, `+${e.n ?? 1}`, e.x + 12, e.y - 50 - 40 * k, { size: 44, align: "center", color: "#FF6FB5", stroke: 7 });
        break;
      case "summon": {
        const kk = age / (FX * 2);
        ctx.globalAlpha = Math.max(0, 1 - kk);
        circle(ctx, e.x, e.y, 50 + 160 * ease(kk), undefined, color(e), 12 * (1 - kk));
        break;
      }
      case "boom": {
        const kk = age / (FX * 2);
        const big = meteorSize(e.hit ?? 0);
        ctx.globalAlpha = Math.max(0, 1 - kk);
        circle(ctx, e.x, e.y, (40 + 200 * kk) * big, "rgba(255,159,10,0.3)", "#FF9F0A", 12 * (1 - kk) * big);
        // what a meteor took off the ball it landed on, in big numbers; a mine's little blast doesn't need one
        if (e.hit && e.dmg > 0) text(ctx, `-${e.dmg.toLocaleString("en-US")}`, e.x, e.y - 40 - 70 * kk, { size: Math.round(64 * big), align: "center", color: "#FF9F0A", stroke: 9 });
        break;
      }
      case "saved":
        if (fade <= 0) break;
        ctx.globalAlpha = fade;
        text(ctx, "SAVED!", e.x, e.y - 70 - 50 * k, { size: 72, align: "center", color: color(e), stroke: 9 });
        break;
      default:
        break;
    }
    ctx.restore();
  }
}

/** The arena's floor and walls, closing in once sudden death starts. */
export function drawFloor(ctx: Ctx, lo: number, size: number, sudden: boolean, halves?: [string, string]) {
  ctx.fillStyle = "#111113";
  ctx.fillRect(0, 0, ARENA, ARENA);
  if (halves) {
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = halves[0];
    ctx.fillRect(0, 0, ARENA / 2, ARENA);
    ctx.fillStyle = halves[1];
    ctx.fillRect(ARENA / 2, 0, ARENA / 2, ARENA);
    ctx.restore();
  }
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
}

/** Two lines under the arena, each with its picture. */
export function ruleLines(ctx: Ctx, lines: { s: string; size: number; color: string; pic: (x: number, y: number) => void }[]) {
  let y = AY + SIDE + 62;
  for (const l of lines) {
    const w = measure(ctx, l.s, l.size, 2);
    l.pic(W / 2 - w / 2 - l.size * 0.5, y - l.size * 0.36);
    text(ctx, l.s, W / 2 + l.size * 0.36, y, { size: l.size, color: l.color, align: "center", spacing: 2 });
    y += l.size + 14;
  }
}

/** The crown's line: who has it and what it takes, or how to get it. */
export function crownLine(show: Show): { s: string; size: number; color: string; pic: (x: number, y: number) => void } {
  const king = show.crown ? show.members.get(show.crown) : undefined;
  const coins = show.crown ? (show.roundCoins.get(show.crown) ?? 0) : 0;
  return king
    ? { s: `${king.viewer.name.toUpperCase()} HAS THE CROWN · ${coins.toLocaleString("en-US")} COINS · OUTGIVE THEM`, size: 32, color: "#FFD60A", pic: () => {} }
    : { s: "BIGGEST GIFTER WEARS THE CROWN", size: 34, color: "#8D8A83", pic: () => {} };
}

export const battleDraw: GameDraw = {
  header(ctx, show) {
    const g = game(show);
    const y = 172, h = 168, gap = 20;
    const cw = (SIDE - gap) / 2;
    ([0, 1] as Team[]).forEach((t) => {
      const x = M + t * (cw + gap);
      const right = t === 1;
      roundRect(ctx, x, y, cw, h, 18, teamColor(show, t));
      const inner = right ? x + cw - 26 : x + 26;
      const outer = right ? x + 26 : x + cw - 26;
      const a: CanvasTextAlign = right ? "right" : "left";
      const b: CanvasTextAlign = right ? "left" : "right";
      text(ctx, `TYPE ${t + 1}`, inner, y + 82, { size: 78, color: "#fff", align: a, spacing: 1 });
      text(ctx, `${show.teams[t].name.toUpperCase()} · ${g.ability(t).toUpperCase()}`, inner, y + 122, { size: 30, color: "#fff", align: a, spacing: 2, alpha: 0.85, max: cw - 200 });
      const m = show.memberCount(t);
      if (m > 0) text(ctx, `${m} ${m === 1 ? "PLAYER" : "PLAYERS"}`, inner, y + 152, { size: 22, color: "#fff", align: a, spacing: 2, alpha: 0.7 });
      // a big gift can take health into the thousands: it shrinks to fit rather than run into the team's name
      text(ctx, String(Math.ceil(g.world.hp(t))), outer, y + 104, { size: 96, color: "#fff", align: b, max: 190 });
      text(ctx, "HP", outer, y + 142, { size: 26, color: "#fff", align: b, spacing: 3, alpha: 0.75 });
    });
    // who's ahead, as one bar
    const h0 = g.world.hp(0), h1 = g.world.hp(1);
    const share = h0 + h1 > 0 ? h0 / (h0 + h1) : 0.5;
    const by = y + h + 12;
    const split = M + SIDE * share;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(M, by, SIDE, 18, 9);
    ctx.clip();
    ctx.fillStyle = teamColor(show, 0);
    ctx.fillRect(M, by, split - M, 18);
    ctx.fillStyle = teamColor(show, 1);
    ctx.fillRect(split, by, M + SIDE - split, 18);
    ctx.restore();
    ctx.fillStyle = PAPER;
    ctx.fillRect(split - 3, by - 6, 6, 30);
  },

  arena(ctx, show, view, turn) {
    const w = game(show).world;
    const { lo, size } = w.arena();
    const sudden = w.clock >= w.suddenDeath;
    const shake = shakeFrom(w.events, w.clock, FPS);
    ctx.save();
    ctx.translate(AX + Math.sin(turn * 37) * shake, AY + Math.cos(turn * 29) * shake);
    ctx.scale(SCALE, SCALE);
    drawFloor(ctx, lo, size, sudden, [teamColor(show, 0), teamColor(show, 1)]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-4, -4, ARENA + 8, ARENA + 8);
    ctx.clip();
    // the crown sits on the biggest ball of whoever's given the most
    let king: Ball | undefined;
    for (const b of w.balls) if (b.alive && show.crown && b.tag?.id === show.crown && (!king || b.r > king.r)) king = b;
    // champions under viewers' balls, so faces and names stay readable
    for (const b of w.balls) if (b.alive && !b.tag) drawBall(ctx, show, view, b, turn, false);
    for (const b of w.balls) if (b.alive && b.tag) drawBall(ctx, show, view, b, turn, b === king);
    drawEffects(ctx, show, w.events, w.clock, (e) => e.color ?? teamColor(show, (e.team ?? 0) as Team));
    for (const m of w.meteors) {
      if (w.clock < m.from) continue;
      // where it'll really land: the next strongest ball, once the one it was aimed at is gone
      const t = w.landsOn(m);
      meteorFall(ctx, t ? t.x : m.x, t ? t.y : m.y, t ? t.r : 60, Math.min(1, (w.clock - m.from) / (m.at - m.from)), turn, meteorSize(m.hit));
    }
    ctx.restore();
    ctx.restore();
    if (sudden && show.phase === "play") text(ctx, "THE WALLS ARE CLOSING IN", W / 2, AY + SIDE - 28, { size: 40, align: "center", color: "#FF3B30", spacing: 3, stroke: 8 });
    // a team hanging on: what it takes to save it, and how long is left
    const hung = ([0, 1] as Team[]).filter((t) => w.hanging[t] > w.clock);
    hung.forEach((t, i) => {
      const line = `${show.teams[t].name.toUpperCase()} NEEDS ${Math.ceil(w.owed[t]).toLocaleString("en-US")} HP · ${Math.ceil(w.hanging[t] - w.clock)}S`;
      text(ctx, line, W / 2, AY + SIDE - (sudden ? 84 : 28) - i * 56, { size: 44, align: "center", color: teamColor(show, t), spacing: 2, stroke: 9, max: SIDE - 60 });
    });
  },

  rules(ctx, show) {
    const c = crownLine(show);
    ruleLines(ctx, [
      { s: "LIKES HEAL YOUR TEAM", size: 40, color: PAPER, pic: (x, y) => heart(ctx, x, y + 2, 36, "#FF6FB5") },
      { ...c, pic: (x, y) => crown(ctx, x, y, 34) },
    ]);
  },

  active(show, effect) {
    const w = game(show).world;
    if (effect === "rage" || effect === "shield") {
      const until = effect === "rage" ? w.rage : w.shield;
      for (const s of [0, 1] as Team[]) if (until[s] > w.clock) return { text: `${show.teams[s].name.toUpperCase()} · ${Math.ceil(until[s] - w.clock)}S LEFT`, color: teamColor(show, s) };
    }
    if (effect === "meteor" && w.meteors[0]) return { text: "INCOMING", color: "#FF9F0A" };
    return null;
  },

  prompt(ctx, show, cx, cy) {
    text(ctx, "PICK YOUR TEAM", cx, cy - 60, { size: 100, align: "center", spacing: 3 });
    ([0, 1] as Team[]).forEach((side) => {
      const pw = 340, ph = 124, px = cx + (side === 0 ? -pw - 18 : 18), py = cy;
      roundRect(ctx, px, py, pw, ph, 20, teamColor(show, side));
      text(ctx, `TYPE ${side + 1}`, px + pw / 2, py + 92, { size: 80, color: "#fff", align: "center", spacing: 1 });
    });
  },

  winner(show) {
    const r = show.result;
    if (!r || r.team === null || r.team === undefined) return { title: "DRAW", color: PAPER };
    return { title: show.teams[r.team].name.toUpperCase(), color: teamColor(show, r.team), line: `${show.series[0]} – ${show.series[1]}`, series: true };
  },

  blastLine(show, b: Blast) {
    const us = b.side === null ? "" : show.teams[b.side].name.toUpperCase();
    const them = b.side === null ? "" : show.teams[1 - b.side].name.toUpperCase();
    // a side named for many (CELTICS, DOGS) reads as plural: CELTICS HIT, CELTICS' BALL
    const many = (name: string) => /[^S]S$/.test(name);
    if (b.tier.effect === "rage") return `${us} ${many(us) ? "HIT" : "HITS"} TWICE AS HARD`;
    // a meteor still gets through, so it's shielded, not unhurtable
    if (b.tier.effect === "shield") return `${us} ${many(us) ? "ARE" : "IS"} SHIELDED`;
    if (b.many) return `${b.many} METEORS ON ${them}`;
    return `ON ${many(them) ? `${them}'` : `${them}'S`} BIGGEST BALL`;
  },
};
