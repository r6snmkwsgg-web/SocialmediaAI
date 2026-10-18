import type { Team } from "@/lib/battle/sim";
import type { RivalsGame } from "@/lib/live/games/rivals";
import type { Show } from "@/lib/live/show";
import { words } from "@/lib/live/words";
import { battleDraw, crownLine, helpPic, ruleLines } from "./battle";
import { chip, circle, coin, crown, DIM, HEAD, icon, INK, M, measure, MENU_Y, outline, PAPER, roundRect, SIDE, STRIP, text, W } from "./kit";
import type { GameDraw } from "./types";

/**
 * Rivals' screen: the battle's arena under two named sides, red against
 * blue, with VS between them, and each side's own three gifts in a column
 * under its card, so a viewer reads straight down from the side they like
 * to the gift that backs it. On YouTube both columns are the same Super
 * Chats, by colour, and the chat picks the side.
 */

const game = (show: Show) => show.game as RivalsGame;
const SIDES = [0, 1] as Team[];

/** what one side's power is doing right now, if anything */
function going(show: Show, side: Team, effect: string): { text: string; color: string } | null {
  const w = game(show).world;
  if (effect === "rage" && w.rage[side] > w.clock) return { text: `${Math.ceil(w.rage[side] - w.clock)}S LEFT`, color: "#FF3B30" };
  if (effect === "meteor" && w.meteors.some((m) => m.team === side)) return { text: "INCOMING", color: "#FF9F0A" };
  return null;
}

export const rivalsDraw: GameDraw = {
  header(ctx, show) {
    const g = game(show);
    const { y, h } = HEAD, gap = 20;
    const cw = (SIDE - gap) / 2;
    SIDES.forEach((t) => {
      const x = M + t * (cw + gap);
      const right = t === 1;
      roundRect(ctx, x, y, cw, h, 18, show.teams[t].color);
      // the name along the screen's edge, the health toward the middle, clear of the VS
      const edge = right ? x + cw - 26 : x + 26;
      const mid = right ? x + 62 : x + cw - 62;
      const a: CanvasTextAlign = right ? "right" : "left";
      const b: CanvasTextAlign = right ? "left" : "right";
      text(ctx, show.teams[t].name.toUpperCase(), edge, y + 72, { size: 64, color: "#fff", align: a, spacing: 1, max: cw - 96 });
      text(ctx, `TYPE ${t + 1} · ${g.ability(t).toUpperCase()}`, edge, y + 114, { size: 28, color: "#fff", align: a, spacing: 2, alpha: 0.85, max: cw - 200 });
      const m = show.memberCount(t);
      if (m > 0) text(ctx, `${m} ${m === 1 ? "PLAYER" : "PLAYERS"}`, edge, y + 148, { size: 22, color: "#fff", align: a, spacing: 2, alpha: 0.7 });
      const hp = String(Math.ceil(g.world.hp(t)));
      text(ctx, hp, mid - (right ? 0 : 52), y + 150, { size: 60, color: "#fff", align: b, max: 140 });
      text(ctx, "HP", mid + (right ? Math.min(140, measure(ctx, hp, 60)) + 8 : -44), y + 150, { size: 26, color: "#fff", align: "left", spacing: 3, alpha: 0.75 });
    });
    circle(ctx, W / 2, y + h / 2 - 20, 48, INK, PAPER, 5);
    text(ctx, "VS", W / 2, y + h / 2 - 4, { size: 44, color: PAPER, align: "center", spacing: 1 });
    // who's ahead, as one bar
    const h0 = g.world.hp(0), h1 = g.world.hp(1);
    const share = h0 + h1 > 0 ? h0 / (h0 + h1) : 0.5;
    const { y: by, h: bh } = STRIP;
    const split = M + SIDE * share;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(M, by, SIDE, bh, bh / 2);
    ctx.clip();
    ctx.fillStyle = show.teams[0].color;
    ctx.fillRect(M, by, split - M, bh);
    ctx.fillStyle = show.teams[1].color;
    ctx.fillRect(split, by, M + SIDE - split, bh);
    ctx.restore();
    ctx.fillStyle = PAPER;
    ctx.fillRect(split - 3, by - 4, 6, bh + 8);
  },

  /** each side's three gifts, under its card: the same powers, the side's own gifts */
  menu(ctx, show) {
    const g = game(show);
    const top = MENU_Y, rh = 50, rg = 8, gap = 16;
    const cw = (SIDE - gap) / 2;
    SIDES.forEach((side) => {
      const x = M + side * (cw + gap);
      const color = show.teams[side].color;
      g.sideMenu(side)
        .filter((t) => t.effect !== "heal")
        .forEach((t, i) => {
          const y = top + i * (rh + rg);
          const sent = show.lit.get(`${side}:${t.effect}`);
          const flash = sent !== undefined ? Math.max(0, 1 - (show.now - sent) / 0.9) : 0;
          const on = going(show, side, t.effect);
          roundRect(ctx, x, y, cw, rh, 12, "#161618");
          ctx.save();
          ctx.globalAlpha = on ? 0.3 : 0.16 + 0.3 * flash;
          roundRect(ctx, x, y, cw, rh, 12, flash > 0 || on ? t.color : color);
          ctx.restore();
          if (on || flash > 0.3) outline(ctx, x, y, cw, rh, 12, t.color, on ? 4 : 3);
          icon(ctx, t.icon, x + 34, y + rh / 2, 32, t.color);
          text(ctx, t.name.toUpperCase(), x + 64, y + 35, { size: 28, color: t.color, spacing: 1, max: 150 });
          const r = x + cw - 18;
          if (on) {
            text(ctx, on.text, r, y + 34, { size: 24, color: on.color, align: "right", spacing: 2 });
            return;
          }
          // a Super Chat by its colour, never an amount
          if (t.unit === "super") {
            chip(ctx, t.gift.toUpperCase(), r, y + 34, t.chip ?? PAPER, { size: 22, max: cw - 260, right: true });
            return;
          }
          const price = (t.price ?? t.min).toLocaleString("en-US");
          const pw = measure(ctx, price, 24, 1);
          text(ctx, price, r, y + 34, { size: 24, color: DIM, align: "right", spacing: 1 });
          coin(ctx, r - pw - 14, y + 26, 7);
          text(ctx, t.gift.toUpperCase(), r - pw - 30, y + 34, { size: 24, color: PAPER, align: "right", spacing: 1, max: cw - 260 - pw });
        });
    });
  },

  arena: battleDraw.arena,

  rules(ctx, show, view) {
    const c = crownLine(show, view);
    ruleLines(ctx, [
      { s: words(show.platform).rivalsRules, size: 36, color: PAPER, pic: helpPic(ctx, show, 32) },
      { ...c, pic: (x, y) => crown(ctx, x, y, 34) },
    ]);
  },

  active(show, effect) {
    for (const s of SIDES) {
      const on = going(show, s, effect);
      if (on) return { ...on, text: `${show.teams[s].name.toUpperCase()} · ${on.text}` };
    }
    return null;
  },

  prompt(ctx, show, cx, cy) {
    text(ctx, "PICK YOUR SIDE", cx, cy - 60, { size: 100, align: "center", spacing: 3 });
    SIDES.forEach((side) => {
      const pw = 400, ph = 160, px = cx + (side === 0 ? -pw - 16 : 16), py = cy;
      roundRect(ctx, px, py, pw, ph, 20, show.teams[side].color);
      text(ctx, show.teams[side].name.toUpperCase(), px + pw / 2, py + 72, { size: 58, color: "#fff", align: "center", spacing: 1, max: pw - 40 });
      text(ctx, `TYPE ${side + 1}`, px + pw / 2, py + 132, { size: 46, color: "#fff", align: "center", spacing: 2, alpha: 0.9 });
    });
    text(ctx, words(show.platform).rivalsPick, cx, cy + 236, { size: 40, color: PAPER, align: "center", spacing: 3 });
  },

  winner(show) {
    const r = show.result;
    if (!r || r.team === null || r.team === undefined) return { title: "DRAW", color: PAPER };
    // no series: the sides were different ones last round
    return { title: show.teams[r.team].name.toUpperCase(), color: show.teams[r.team].color };
  },

  blastLine: battleDraw.blastLine,
};
