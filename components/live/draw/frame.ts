import type { Show } from "@/lib/live/show";
import { LETTERS } from "@/lib/live/show";
import { INTRO, KO_HOLD } from "@/lib/live/show";
import { battleDraw } from "./battle";
import {
  AX, AY, coin, crown, DIM, ease, face, GOLD, H, icon, INK, M, measure, outline, PAPER, pop, roundRect, SIDE, SIGNAL, text, W,
  type Ctx, type View,
} from "./kit";
import { raceDraw } from "./race";
import { royaleDraw } from "./royale";
import type { GameDraw } from "./types";

/**
 * The live show, drawn onto a 1080 × 1920 canvas every frame. Every game
 * reads the same way top to bottom: how to join and who's ahead, the gift
 * menu (by gift name, with a picture for each), the arena, then the rules.
 * Whatever a gift does shows up in the arena with the same picture the
 * menu used, and its menu item lights up, so the menu teaches itself.
 */

export { W, H };
export type { View };

const DRAWS: Record<Show["game"]["id"], GameDraw> = { battle: battleDraw, race: raceDraw, royale: royaleDraw };

function drawTop(ctx: Ctx, show: Show, view: View) {
  const y = 150;
  text(ctx, `ROUND ${show.round}`, M, y, { size: 32, color: DIM, spacing: 3 });
  if (show.game.teams) {
    const s0 = String(show.series[0]), s1 = String(show.series[1]);
    const w1 = measure(ctx, s1, 32, 2), wd = measure(ctx, "  –  ", 32, 2);
    text(ctx, s1, W - M, y, { size: 32, color: show.teams[1].color, align: "right", spacing: 2 });
    text(ctx, "  –  ", W - M - w1, y, { size: 32, color: DIM, align: "right", spacing: 2 });
    text(ctx, s0, W - M - w1 - wd, y, { size: 32, color: show.teams[0].color, align: "right", spacing: 2 });
  } else {
    text(ctx, show.game.id === "race" ? "BALL RACE" : "LAST ONE STANDING", W - M, y, { size: 32, color: DIM, align: "right", spacing: 3 });
  }
  if (view.demo) text(ctx, "DEMO · PRETEND VIEWERS", W / 2, y, { size: 26, color: SIGNAL, align: "center", spacing: 3 });
  else if (view.status) text(ctx, view.status, W / 2, y, { size: 24, color: DIM, align: "center", spacing: 3 });
}

/**
 * The gift menu: six things a gift can do, by the gift viewers know. An
 * item lights up when someone sends it, and the ones that last show who
 * has them and for how long.
 */
function drawMenu(ctx: Ctx, show: Show, d: GameDraw) {
  const top = 392, h = 86, gap = 10;
  const cw = (SIDE - gap * 2) / 3;
  show.game.menu.forEach((t, i) => {
    const x = M + (i % 3) * (cw + gap), y = top + Math.floor(i / 3) * (h + gap);
    const sent = show.lit.get(t.effect);
    const flash = sent !== undefined ? Math.max(0, 1 - (show.now - sent) / 0.9) : 0;
    const on = d.active(show, t.effect);
    roundRect(ctx, x, y, cw, h, 14, "#161618");
    if (flash > 0 || on) {
      ctx.save();
      ctx.globalAlpha = on ? 0.22 : 0.35 * flash;
      roundRect(ctx, x, y, cw, h, 14, t.color);
      ctx.restore();
    }
    outline(ctx, x, y, cw, h, 14, on || flash > 0.3 ? t.color : "rgba(244,241,234,0.16)", on ? 4 : 2);
    icon(ctx, t.icon, x + 42, y + h / 2, 44, t.color);
    text(ctx, t.name.toUpperCase(), x + 82, y + 44, { size: 36, color: t.color, spacing: 1, max: cw - 96 });
    if (on) text(ctx, on.text, x + 82, y + 72, { size: 22, color: on.color, spacing: 2, max: cw - 96 });
    else {
      const g = t.gift.toUpperCase();
      const gw = Math.min(cw - 150, measure(ctx, g, 22, 1.5));
      text(ctx, g, x + 82, y + 72, { size: 22, color: PAPER, spacing: 1.5, alpha: 0.8, max: cw - 150 });
      coin(ctx, x + 82 + gw + 14, y + 64, 7);
      text(ctx, t.min.toLocaleString("en-US"), x + 82 + gw + 26, y + 72, { size: 22, color: DIM, spacing: 1 });
    }
  });
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

/** A big gift: who sent it and what it does, big, over the arena. */
function drawBlast(ctx: Ctx, show: Show, view: View, d: GameDraw): boolean {
  for (const { b, start } of blastTimes(show)) {
    const age = show.now - start;
    if (age < 0 || age >= BLAST) continue;
    const k = Math.min(ease(age / 0.15), ease((BLAST - age) / 0.2));
    const t = b.tier;
    const x = AX + 26, y = AY + 22, bw = SIDE - 52, h = 196;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate(W / 2, y + h / 2);
    const s = 0.85 + 0.15 * pop(age * 4);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -(y + h / 2));
    roundRect(ctx, x, y, bw, h, 24, INK);
    outline(ctx, x, y, bw, h, 24, t.color, 6);
    const ring = b.side === null ? GOLD : show.teams[b.side].color;
    face(ctx, view, b.viewer.name, b.viewer.avatar, x + 96, y + h / 2, 62, ring, 7);
    text(ctx, `${b.viewer.name} sent ${b.count > 1 ? `${b.count}x ` : ""}${t.gift}`, x + 188, y + 54, { size: 32, max: bw - 340 });
    text(ctx, `${t.name.toUpperCase()}!`, x + 188, y + 144, { size: 84, color: t.color, spacing: 3, max: bw - 340 });
    text(ctx, d.blastLine(show, b), x + 188, y + 180, { size: 26, color: DIM, spacing: 2, max: bw - 340 });
    icon(ctx, t.icon, x + bw - 86, y + h / 2, 92, t.color);
    ctx.restore();
    return true;
  }
  return false;
}

/** One line at a time over the top of the arena: who just did what. */
function drawToast(ctx: Ctx, show: Show, view: View) {
  const SHOW = 1.7;
  let end = -Infinity;
  for (const t of show.toasts) {
    const start = Math.max(t.at, end);
    // a backlog isn't worth replaying: the arena already shows it
    if (start - t.at > 2.5) continue;
    end = start + SHOW;
    const age = show.now - start;
    if (age < 0 || age >= SHOW) continue;
    const k = Math.min(ease(age / 0.18), ease((SHOW - age) / 0.18));
    const msg = `${t.viewer.name}  ${t.text}`;
    const tw = Math.min(720, measure(ctx, msg, 34, 1));
    const pw = tw + 106;
    const x = W / 2 - pw / 2, y = AY + 20 - (1 - k) * 20;
    const bg = t.side === null ? SIGNAL : show.teams[t.side].color;
    ctx.save();
    ctx.globalAlpha = k;
    roundRect(ctx, x, y, pw, 66, 33, bg);
    face(ctx, view, t.viewer.name, t.viewer.avatar, x + 34, y + 33, 24, "#fff", 3);
    text(ctx, msg, x + 70, y + 45, { size: 34, color: "#fff", spacing: 1, max: 720 });
    ctx.restore();
  }
}

function drawIntro(ctx: Ctx, show: Show, d: GameDraw) {
  const t = show.elapsed;
  const cx = W / 2, cy = AY + SIDE / 2;
  if (show.phase === "intro") {
    // a race keeps its starting gate in view, so everyone can watch it fill
    const gate = show.game.id === "race" ? 150 : 0;
    ctx.fillStyle = show.game.liveInIntro ? "rgba(11,11,12,0.7)" : "rgba(11,11,12,0.82)";
    ctx.fillRect(AX, AY + gate, SIDE, SIDE - gate);
    text(ctx, `ROUND ${show.round}`, cx, AY + gate + 110, { size: 54, color: DIM, align: "center", spacing: 6 });
    // what the vote picked, if there was one
    if (show.voted && show.round > 1) {
      const s = `${show.voted.option.label.toUpperCase()} WON THE VOTE`;
      const w = measure(ctx, s, 38, 2) + 60;
      roundRect(ctx, cx - w / 2, AY + gate + 138, w, 58, 29, GOLD);
      text(ctx, s, cx, AY + gate + 180, { size: 38, color: INK, align: "center", spacing: 2 });
    }
    const left = Math.ceil(INTRO - t);
    if (left <= 3) {
      const k = 1 - (INTRO - t - (left - 1));
      const s = 1.4 - 0.4 * ease(k * 3);
      ctx.save();
      ctx.translate(cx, cy + 110);
      ctx.scale(s, s);
      text(ctx, String(left), 0, 0, { size: 320, align: "center", stroke: 14 });
      ctx.restore();
    } else d.prompt(ctx, show, cx, cy + gate * 0.4);
    const foot = show.game.liveInIntro ? "GIFT NOW TO START AHEAD" : "GIFTS SENT NOW LAND WHEN IT STARTS";
    text(ctx, foot, cx, AY + SIDE - 80, { size: 34, color: DIM, align: "center", spacing: 2 });
  } else if (show.phase === "play" && t < 0.9) {
    const k = t / 0.9;
    ctx.save();
    ctx.globalAlpha = 1 - ease(Math.max(0, k - 0.5) * 2);
    ctx.translate(cx, cy + 70);
    const s = 0.6 + 0.4 * pop(k * 2.2);
    ctx.scale(s, s);
    text(ctx, show.game.id === "battle" ? "FIGHT!" : "GO!", 0, 0, { size: 230, color: PAPER, align: "center", stroke: 16, spacing: 4 });
    ctx.restore();
  }
}

function drawKo(ctx: Ctx, show: Show, d: GameDraw) {
  if (show.phase !== "ko") return;
  const k = show.elapsed / KO_HOLD;
  const r = show.result;
  const word = r?.byTime ? "TIME!" : show.game.id === "race" ? "FINISH!" : "K.O.";
  ctx.save();
  ctx.translate(W / 2, AY + SIDE / 2 + 80);
  const s = 0.5 + 0.5 * pop(k * 3);
  ctx.scale(s, s);
  ctx.rotate(-0.05);
  text(ctx, word, 0, 0, { size: word.length > 5 ? 220 : 270, color: d.winner(show).color, align: "center", stroke: 18, spacing: 6 });
  ctx.restore();
}

/** The win screen, and the vote for what's next on it. */
function drawWin(ctx: Ctx, show: Show, view: View, d: GameDraw) {
  if (show.phase !== "win") return;
  const t = show.elapsed;
  const k = ease(t / 0.35);
  ctx.fillStyle = `rgba(11,11,12,${0.93 * k})`;
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  const win = d.winner(show);
  const vote = show.vote;
  const top = vote ? 300 : 520;

  ctx.save();
  ctx.globalAlpha = k;
  ctx.translate(cx, top);
  const s = 0.6 + 0.4 * pop(t * 2);
  ctx.scale(s, s);
  if (win.entrant) {
    face(ctx, view, win.entrant.name, win.entrant.avatar, 0, 0, 96, win.color, 8);
    text(ctx, win.title, 0, 240, { size: Math.min(150, 1600 / Math.max(5, win.title.length)), color: win.color, align: "center", spacing: 3, max: 900 });
    if (win.line) text(ctx, win.line, 0, 310, { size: 50, align: "center", spacing: 3 });
  } else {
    text(ctx, win.title, 0, 160, { size: Math.min(240, 1500 / Math.max(4, win.title.length)), color: win.color, align: "center", spacing: 6 });
    if (win.title !== "DRAW") text(ctx, "WINS", 0, 300, { size: 130, align: "center", spacing: 6 });
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = k;
  if (win.series) {
    const s0 = String(show.series[0]), s1 = String(show.series[1]);
    const wd = measure(ctx, "  –  ", 56, 2);
    const y = top + 400;
    text(ctx, s0, cx - wd / 2, y, { size: 56, color: show.teams[0].color, align: "right" });
    text(ctx, "  –  ", cx, y, { size: 56, color: DIM, align: "center", spacing: 2 });
    text(ctx, s1, cx + wd / 2, y, { size: 56, color: show.teams[1].color });
  } else if (show.result?.podium && show.result.podium.length > 1) {
    const rest = show.result.podium.slice(1).map((p, i) => `${i === 0 ? "2ND" : "3RD"} ${p.name.toUpperCase()}`).join("   ·   ");
    text(ctx, rest, cx, top + 400, { size: 36, color: DIM, align: "center", spacing: 2, max: SIDE });
  }

  const left = Math.max(1, Math.ceil(show.winFor - t));
  if (vote) {
    const what = show.game.id === "battle" ? "MATCHUP" : show.game.id === "race" ? "BOARD" : "ARENA";
    text(ctx, `VOTE THE NEXT ${what}`, cx, 860, { size: 60, align: "center", spacing: 3 });
    text(ctx, "TYPE A, B OR C · GIFTS ADD VOTES", cx, 916, { size: 34, color: GOLD, align: "center", spacing: 2 });
    const tally = show.tally();
    const total = tally.reduce((a, b) => a + b, 0);
    const best = Math.max(...tally);
    vote.options.forEach((o, i) => {
      const y = 960 + i * 150, h = 128;
      const share = total > 0 ? tally[i] / total : 0;
      const lead = total > 0 && tally[i] === best;
      roundRect(ctx, M, y, SIDE, h, 20, "#161618");
      if (share > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(M, y, SIDE, h, 20);
        ctx.clip();
        ctx.fillStyle = lead ? "rgba(255,214,10,0.28)" : "rgba(244,241,234,0.12)";
        ctx.fillRect(M, y, SIDE * share, h);
        ctx.restore();
      }
      outline(ctx, M, y, SIDE, h, 20, lead ? GOLD : "rgba(244,241,234,0.16)", lead ? 5 : 2);
      const lx = M + 70;
      ctx.beginPath();
      ctx.arc(lx, y + h / 2, 44, 0, Math.PI * 2);
      ctx.fillStyle = lead ? GOLD : PAPER;
      ctx.fill();
      text(ctx, LETTERS[i], lx, y + h / 2 + 22, { size: 62, color: INK, align: "center" });
      text(ctx, o.label.toUpperCase(), M + 140, y + h / 2 + 20, { size: 56, align: "left", spacing: 2, max: SIDE - 360 });
      text(ctx, `${tally[i]} ${tally[i] === 1 ? "VOTE" : "VOTES"}`, M + SIDE - 32, y + h / 2 + 14, { size: 38, color: lead ? GOLD : DIM, align: "right", spacing: 2 });
    });
    text(ctx, `NEXT ROUND IN ${left}`, cx, 1462, { size: 50, align: "center", spacing: 4 });
  } else {
    text(ctx, `NEXT ROUND IN ${left}`, cx, 1460, { size: 56, align: "center", spacing: 4 });
    text(ctx, show.game.teams ? "TYPE 1 OR 2 TO PICK YOUR TEAM" : "TYPE GO TO GET IN", cx, 1530, { size: 38, color: DIM, align: "center", spacing: 3 });
  }

  if (show.mvp) {
    const m = show.mvp;
    const y = vote ? 1560 : 1250;
    const label = `${m.viewer.name}  ·  ${m.coins.toLocaleString("en-US")} COINS`;
    const w = measure(ctx, label, 40, 2);
    crown(ctx, cx - w / 2 - 82, y - 14, 44);
    face(ctx, view, m.viewer.name, m.viewer.avatar, cx - w / 2 - 34, y - 14, 26, GOLD, 4);
    text(ctx, label, cx + 10, y, { size: 40, color: GOLD, align: "center", spacing: 2 });
  }
  ctx.restore();
}

/** Draw the whole screen for this moment of the show. */
export function draw(ctx: Ctx, show: Show, view: View) {
  const d = DRAWS[show.game.id];
  const turn = show.game.clock * 1.5;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  drawTop(ctx, show, view);
  d.header(ctx, show, view);
  drawMenu(ctx, show, d);
  d.arena(ctx, show, view, turn);
  if (!drawBlast(ctx, show, view, d)) drawToast(ctx, show, view);
  d.rules(ctx, show);
  drawIntro(ctx, show, d);
  drawKo(ctx, show, d);
  drawWin(ctx, show, view, d);
  if (view.tag) text(ctx, "MADE WITH HOOKLINE", W / 2, H - 40, { size: 28, color: DIM, align: "center", spacing: 4 });
}
