import { FPS } from "@/lib/battle/sim";
import { BOARD, FINISH, type Racer, type RaceGame } from "@/lib/live/games/race";
import type { Show } from "@/lib/live/show";
import { crownLine, drawEffects, ruleLines } from "./battle";
import {
  AX, AY, circle, CPU, crown, ease, face, GOLD, icon, INK, M, PAPER, roundRect, SCALE, shakeFrom, SIDE, text,
  type Ctx, type View,
} from "./kit";
import type { GameDraw } from "./types";

/**
 * Ball Race's screen: a card that says how to get in and how many are
 * racing, a strip that shows where everyone is, the marble run itself,
 * and the rules underneath.
 */

const game = (show: Show) => show.game as RaceGame;
const ringOf = (r: Racer) => (r.cpu ? CPU : r.free ? PAPER : GOLD);

function drawBoard(ctx: Ctx, g: RaceGame) {
  ctx.fillStyle = "#111113";
  ctx.fillRect(0, 0, BOARD, BOARD);
  // the finish: a checkered band right across
  const sq = 20;
  for (let x = 0; x < BOARD; x += sq) {
    for (let row = 0; row < 2; row++) {
      ctx.fillStyle = ((x / sq + row) % 2 === 0) ? PAPER : INK;
      ctx.fillRect(x, FINISH + row * sq * 0.5, sq, sq * 0.5);
    }
  }
  ctx.lineCap = "round";
  for (const s of g.segs) {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 10;
    ctx.stroke();
  }
  for (const p of g.pegs) circle(ctx, p.x, p.y, p.r, PAPER, INK, 3);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, BOARD, BOARD);
}

function drawRacer(ctx: Ctx, show: Show, view: View, g: RaceGame, r: Racer, turn: number, leader: boolean, crowned: boolean) {
  const k = ease((g.clock - r.born) / 0.35);
  const rad = r.r * (0.55 + 0.45 * Math.min(1, g.running ? k : 1));
  const ghost = r.ghostUntil > g.clock;
  const sp = Math.hypot(r.vx, r.vy);
  // a streak behind a ball going flat out
  if (sp > 420 && r.finishedAt === null) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = GOLD;
    ctx.lineCap = "round";
    ctx.lineWidth = rad * 1.2;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x - (r.vx / sp) * rad * 3, r.y - (r.vy / sp) * rad * 3);
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.45 + 0.15 * Math.sin(turn * 12);
  if (r.cpu) {
    circle(ctx, r.x, r.y, rad, "#26262A", CPU, Math.max(4, rad * 0.14));
    text(ctx, "CPU", r.x, r.y + rad * 0.3, { size: rad * 0.8, align: "center", color: "#B9B6AE" });
  } else face(ctx, view, r.name, r.avatar, r.x, r.y, rad, ringOf(r), Math.max(4, rad * 0.14));
  ctx.restore();
  if (ghost) {
    ctx.save();
    ctx.setLineDash([8, 8]);
    circle(ctx, r.x, r.y, rad + 8, undefined, "#BF5AF2", 4);
    ctx.restore();
  }
  if (r.stunUntil > g.clock) {
    for (let i = 0; i < 3; i++) {
      const a = turn * 6 + (i / 3) * Math.PI * 2;
      circle(ctx, r.x + Math.cos(a) * (rad + 6), r.y - rad - 4 + Math.sin(a) * 6, 5, GOLD);
    }
  }
  // its weight: the number gifts make bigger
  const label = `${Math.round(r.weight)}KG`;
  const bw = Math.max(44, label.length * 15 + 12);
  roundRect(ctx, r.x + rad * 0.45, r.y - rad - 6, bw, 28, 8, INK);
  text(ctx, label, r.x + rad * 0.45 + bw / 2, r.y - rad + 15, { size: 22, align: "center", color: r.cpu ? "#B9B6AE" : GOLD });
  if (!r.cpu) text(ctx, r.name, r.x, r.y + rad + 24, { size: 22, align: "center", stroke: 7, max: 180 });
  if (r.finishedAt !== null) {
    const medal = ["", GOLD, "#C9CED6", "#D08A4E"][r.place] ?? DIM_MEDAL;
    circle(ctx, r.x - rad * 0.8, r.y - rad * 0.8, 20, medal, INK, 4);
    text(ctx, String(r.place), r.x - rad * 0.8, r.y - rad * 0.8 + 10, { size: 28, align: "center", color: INK });
  } else if (leader) {
    roundRect(ctx, r.x - 34, r.y - rad - 46, 68, 32, 8, GOLD);
    text(ctx, "1ST", r.x, r.y - rad - 21, { size: 26, align: "center", color: INK });
  }
  if (crowned) crown(ctx, r.x, r.y - rad - (leader ? 70 : 30), Math.min(60, Math.max(36, rad)));
}

const DIM_MEDAL = "#5E5C58";

export const raceDraw: GameDraw = {
  header(ctx, show) {
    const g = game(show);
    const y = 172, h = 168;
    roundRect(ctx, M, y, SIDE, h, 18, GOLD);
    text(ctx, "TYPE GO", M + 28, y + 82, { size: 78, color: INK, spacing: 1 });
    text(ctx, "TO RACE FOR FREE · GIFTS MAKE YOUR BALL HEAVIER", M + 28, y + 124, { size: 28, color: INK, spacing: 1.5, alpha: 0.8, max: SIDE - 260 });
    const n = g.racers.filter((r) => !r.cpu).length;
    text(ctx, String(n), M + SIDE - 28, y + 104, { size: 96, color: INK, align: "right" });
    text(ctx, n === 1 ? "RACER" : "RACERS", M + SIDE - 28, y + 142, { size: 26, color: INK, align: "right", spacing: 3, alpha: 0.75 });
    // where everyone is: a strip from the start to the finish line
    const by = y + h + 12;
    roundRect(ctx, M, by, SIDE, 18, 9, "#1A1A1C");
    for (const r of g.racers) {
      const k = r.finishedAt !== null ? 1 : Math.max(0, Math.min(1, r.y / FINISH));
      circle(ctx, M + 9 + (SIDE - 18) * k, by + 9, r.cpu ? 6 : 8, r.cpu ? CPU : r.free ? PAPER : GOLD);
    }
  },

  arena(ctx, show, view, turn) {
    const g = game(show);
    const shake = shakeFrom(g.events, g.clock, FPS);
    ctx.save();
    ctx.translate(AX + Math.sin(turn * 37) * shake, AY + Math.cos(turn * 29) * shake);
    ctx.scale(SCALE, SCALE);
    drawBoard(ctx, g);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-4, -4, BOARD + 8, BOARD + 8);
    ctx.clip();
    if (!g.running) {
      // the gate, holding everyone at the top until the start
      ctx.save();
      ctx.setLineDash([16, 10]);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, g.racers.length > 12 ? 128 : 76);
      ctx.lineTo(BOARD, g.racers.length > 12 ? 128 : 76);
      ctx.stroke();
      ctx.restore();
    }
    const standings = g.standings();
    const leader = g.running ? standings.find((r) => r.finishedAt === null && !standings.some((x) => x.finishedAt !== null)) : undefined;
    const king = show.crown ? g.racers.find((r) => r.id === show.crown) : undefined;
    // CPUs and free entries under gifters, so gifters' faces stay on top
    const order = [...g.racers].sort((a, b) => Number(!a.cpu) - Number(!b.cpu) || Number(!a.free) - Number(!b.free));
    for (const r of order) drawRacer(ctx, show, view, g, r, turn, r === leader, r === king);
    drawEffects(ctx, show, g.events, g.clock, (e) => e.color ?? GOLD);
    ctx.restore();
    ctx.restore();
  },

  rules(ctx, show) {
    ruleLines(ctx, [
      { s: "LIKES MAKE YOUR BALL HEAVIER", size: 40, color: PAPER, pic: (x, y) => icon(ctx, "weight", x, y, 38, PAPER) },
      { ...crownLine(show), pic: (x, y) => crown(ctx, x, y, 34) },
    ]);
  },

  active(show, effect) {
    const g = game(show);
    if (effect === "ghost") {
      const r = g.racers.find((x) => x.ghostUntil > g.clock);
      if (r) return { text: `${r.name.toUpperCase()} · ${Math.ceil(r.ghostUntil - g.clock)}S`, color: "#BF5AF2" };
    }
    return null;
  },

  prompt(ctx, show, cx, cy) {
    const g = game(show);
    text(ctx, "TYPE GO TO RACE", cx, cy - 40, { size: 100, align: "center", spacing: 3 });
    text(ctx, "FIRST TO THE BOTTOM WINS", cx, cy + 40, { size: 48, color: GOLD, align: "center", spacing: 3 });
    const n = g.racers.filter((r) => !r.cpu).length;
    text(ctx, `${n} IN THE GATE`, cx, cy + 110, { size: 40, align: "center", spacing: 3, alpha: 0.8 });
  },

  winner(show) {
    const c = show.result?.champion;
    if (!c) return { title: "NOBODY", color: PAPER };
    const wins = show.winsOf(c);
    return { title: c.name.toUpperCase(), color: c.cpu ? "#B9B6AE" : GOLD, entrant: c, line: c.cpu ? "THE CPU WON THIS ONE" : wins > 1 ? `${wins} WINS TODAY` : "WINS THE RACE" };
  },

  blastLine(show, b) {
    const name = b.viewer.name.toUpperCase();
    if (b.tier.effect === "ghost") return `${name} SLIPS THROUGH EVERYTHING`;
    if (b.tier.effect === "shock") return `EVERYONE NEAR ${name} GETS KNOCKED BACK`;
    return `${name} BLASTS DOWN TO THE LAST STRETCH`;
  },
};
