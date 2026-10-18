import type { Show } from "@/lib/live/show";
import { LETTERS } from "@/lib/live/show";
import { KO_HOLD, WELCOME_FOR } from "@/lib/live/show";
import { giftLevel as blastLevel, type Tier } from "@/lib/live/menu";
import { words } from "@/lib/live/words";
import { battleDraw } from "./battle";
import {
  AX, AY, chip, coin, crown, DIM, ease, face, GOLD, H, icon, INK, jewel, M, measure, MENU_Y, nameOf, outline, PAPER, pop, roundRect, SIDE, SIGNAL, text, TOP3, W,
  type Ctx, type View,
} from "./kit";
import { raceDraw } from "./race";
import { rivalsDraw } from "./rivals";
import { royaleDraw } from "./royale";
import { drawTop3, WIN_TOP3_Y } from "./top3";
import type { GameDraw } from "./types";

/**
 * The live show, drawn onto a 1080 × 1920 canvas every frame. Every game
 * reads the same way top to bottom: how to join and who's ahead, the LIVE's
 * top 3 gifters, the gift menu (by gift name, with a picture for each), the
 * arena, then the rules.
 * Whatever a gift does shows up in the arena with the same picture the
 * menu used, and its menu item lights up, so the menu teaches itself.
 */

export { W, H };
export type { View };

const DRAWS: Record<Show["game"]["id"], GameDraw> = { battle: battleDraw, race: raceDraw, royale: royaleDraw, rivals: rivalsDraw };
/** the game's name, top right, where a battle has the score */
const TITLES: Record<Show["game"]["id"], string> = { battle: "BALL BATTLE", race: "BALL RACE", royale: "LAST ONE STANDING", rivals: "RIVALS" };
/** what the vote between rounds picks */
const NEXT: Record<Show["game"]["id"], string> = { battle: "MATCHUP", race: "BOARD", royale: "ARENA", rivals: "RIVALRY" };

function drawTop(ctx: Ctx, show: Show, view: View) {
  const y = 150;
  const round = `ROUND ${show.round}`;
  text(ctx, round, M, y, { size: 32, color: DIM, spacing: 3 });
  let right: number;
  // a score only means something while the sides stay the same
  if (show.game.teams && !show.game.names) {
    const s0 = String(show.series[0]), s1 = String(show.series[1]);
    const w1 = measure(ctx, s1, 32, 2), wd = measure(ctx, "  –  ", 32, 2);
    text(ctx, s1, W - M, y, { size: 32, color: show.teams[1].color, align: "right", spacing: 2 });
    text(ctx, "  –  ", W - M - w1, y, { size: 32, color: DIM, align: "right", spacing: 2 });
    text(ctx, s0, W - M - w1 - wd, y, { size: 32, color: show.teams[0].color, align: "right", spacing: 2 });
    right = w1 + wd + measure(ctx, s0, 32, 2);
  } else {
    text(ctx, TITLES[show.game.id], W - M, y, { size: 32, color: DIM, align: "right", spacing: 3 });
    right = measure(ctx, TITLES[show.game.id], 32, 3);
  }
  // the middle line shrinks to fit between the round and the score, so it never runs into them
  const max = 2 * Math.min(W / 2 - M - measure(ctx, round, 32, 3), W / 2 - M - right) - 48;
  if (view.demo) text(ctx, "DEMO · PRETEND VIEWERS", W / 2, y, { size: 26, color: SIGNAL, align: "center", spacing: 3, max });
  else if (view.status) text(ctx, view.status, W / 2, y, { size: 24, color: DIM, align: "center", spacing: 3, max });
  if (view.notice) {
    roundRect(ctx, M, 40, SIDE, 64, 12, SIGNAL);
    text(ctx, view.notice, W / 2, 84, { size: 28, color: INK, align: "center", spacing: 2, max: SIDE - 40 });
  }
}

/**
 * What sets a menu item off, under its name, from `x` with `room` to go:
 * the gift and what it costs on TikTok. On YouTube, a Super Chat's chip in
 * its own colour, never an amount, or a jewel and the Jewels from which
 * any gifts do it, since no one gift is claimed to cost that.
 */
function drawCost(ctx: Ctx, t: Tier, x: number, y: number, room: number) {
  const g = t.gift.toUpperCase();
  if (t.unit === "super") {
    chip(ctx, g, x, y, t.chip ?? PAPER, { size: 20, max: room - 28 });
    return;
  }
  const gw = Math.min(room - 68, measure(ctx, g, 22, 1.5));
  text(ctx, g, x, y, { size: 22, color: PAPER, spacing: 1.5, alpha: 0.8, max: room - 68 });
  if (t.unit === "jewels") {
    jewel(ctx, x + gw + 15, y - 8, 9);
    text(ctx, `${t.min.toLocaleString("en-US")}+`, x + gw + 29, y, { size: 22, color: DIM, spacing: 1 });
    return;
  }
  coin(ctx, x + gw + 14, y - 8, 7);
  text(ctx, (t.price ?? t.min).toLocaleString("en-US"), x + gw + 26, y, { size: 22, color: DIM, spacing: 1 });
}

/**
 * The gift menu: six things a gift can do, by the gift viewers know. An
 * item lights up when someone sends it, and the ones that last show who
 * has them and for how long.
 */
function drawMenu(ctx: Ctx, show: Show, view: View, d: GameDraw) {
  const top = MENU_Y, h = 80, gap = 10, rowGap = 8;
  const cw = (SIDE - gap * 2) / 3;
  show.game.menu.forEach((t, i) => {
    const x = M + (i % 3) * (cw + gap), y = top + Math.floor(i / 3) * (h + rowGap);
    const sent = show.lit.get(t.effect);
    const flash = sent !== undefined ? Math.max(0, 1 - (show.now - sent) / 0.9) : 0;
    const on = d.active(show, t.effect, view);
    roundRect(ctx, x, y, cw, h, 14, "#161618");
    if (flash > 0 || on) {
      ctx.save();
      ctx.globalAlpha = on ? 0.22 : 0.35 * flash;
      roundRect(ctx, x, y, cw, h, 14, t.color);
      ctx.restore();
    }
    outline(ctx, x, y, cw, h, 14, on || flash > 0.3 ? t.color : "rgba(244,241,234,0.16)", on ? 4 : 2);
    icon(ctx, t.icon, x + 42, y + h / 2, 44, t.color);
    text(ctx, t.name.toUpperCase(), x + 82, y + 41, { size: 36, color: t.color, spacing: 1, max: cw - 96 });
    if (on) text(ctx, on.text, x + 82, y + 67, { size: 22, color: on.color, spacing: 2, max: cw - 96 });
    else drawCost(ctx, t, x + 82, y + 67, cw - 82);
  });
}

// ── the moments ──

const BLAST = 2;

/** how big a gift's moment is: 0 for most, 1 for a Galaxy's worth, 2 for ten times that and more, the same level a clip keeps */
export { blastLevel };

/** how long a gift's moment stays up: the bigger the gift, the longer */
const blastFor = (coins: number) => BLAST + blastLevel(coins);

/** when each big gift's moment on screen starts; a backlog is skipped, not replayed */
function blastTimes(show: Show): { b: Show["blasts"][number]; start: number }[] {
  let end = -Infinity;
  const out: { b: Show["blasts"][number]; start: number }[] = [];
  for (const b of show.blasts) {
    const start = Math.max(b.at, end);
    if (start - b.at > 3) continue;
    end = start + blastFor(b.coins);
    out.push({ b, start });
  }
  return out;
}

/** A big gift: who sent it and what it does, big, over the arena, and bigger and longer for a bigger gift. */
function drawBlast(ctx: Ctx, show: Show, view: View, d: GameDraw): boolean {
  for (const { b, start } of blastTimes(show)) {
    const age = show.now - start;
    const long = blastFor(b.coins);
    if (age < 0 || age >= long) continue;
    const k = Math.min(ease(age / 0.15), ease((long - age) / 0.2));
    const t = b.tier;
    const level = blastLevel(b.coins);
    const x = AX + 26, y = AY + 22, bw = SIDE - 52, h = 196;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate(W / 2, y + h / 2);
    const s = (0.85 + 0.15 * pop(age * 4)) * (1 + 0.06 * level) + (level > 0 ? 0.02 * level * Math.sin(age * 18) : 0);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -(y + h / 2));
    roundRect(ctx, x, y, bw, h, 24, INK);
    outline(ctx, x, y, bw, h, 24, t.color, 6);
    const ring = b.side === null ? GOLD : show.teams[b.side].color;
    face(ctx, view, b.viewer.name, b.viewer.avatar, x + 96, y + h / 2, 62, ring, 7);
    // what they sent, as it came: a gift bigger than the menu's top item, or another colour of Super Chat, is named for what it is
    text(ctx, `${nameOf(view, b.viewer.name)} sent ${b.gift}`, x + 188, y + 54, { size: 32, max: bw - 340 });
    text(ctx, `${t.name.toUpperCase()}${b.many ? ` ×${b.many}` : ""}!`, x + 188, y + 144, { size: 84, color: t.color, spacing: 3, max: bw - 340 });
    text(ctx, d.blastLine(show, b, view), x + 188, y + 180, { size: 26, color: DIM, spacing: 2, max: bw - 340 });
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
    const msg = `${nameOf(view, t.viewer.name)}  ${t.text}`;
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

/**
 * One of the last LIVE's top gifters, back: a gold line where the toasts go,
 * the way a toast comes and goes. True while it's up, so toasts wait.
 */
function drawWelcome(ctx: Ctx, show: Show, view: View): boolean {
  const w = show.welcomes.at(-1);
  const age = w ? show.now - w.at : -1;
  if (!w || age < 0 || age >= WELCOME_FOR) return false;
  const k = Math.min(ease(age / 0.18), ease((WELCOME_FOR - age) / 0.18));
  const msg = `WELCOME BACK, ${nameOf(view, w.viewer.name).toUpperCase()}: ${words(show.platform).welcome(w.rank)}`;
  const pw = Math.min(760, measure(ctx, msg, 32, 1)) + 106;
  const x = W / 2 - pw / 2, y = AY + 20 - (1 - k) * 20;
  ctx.save();
  ctx.globalAlpha = k;
  roundRect(ctx, x, y, pw, 66, 33, GOLD);
  face(ctx, view, w.viewer.name, w.viewer.avatar, x + 34, y + 33, 24, INK, 3);
  text(ctx, msg, x + 70, y + 44, { size: 32, color: INK, spacing: 1, max: 760 });
  ctx.restore();
  return true;
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
    const intro = show.introFor;
    const left = Math.ceil(intro - t);
    if (left <= 3) {
      const k = 1 - (intro - t - (left - 1));
      const s = 1.4 - 0.4 * ease(k * 3);
      ctx.save();
      ctx.translate(cx, cy + 110);
      ctx.scale(s, s);
      text(ctx, String(left), 0, 0, { size: 320, align: "center", stroke: 14 });
      ctx.restore();
    } else d.prompt(ctx, show, cx, cy + gate * 0.4);
    const say = words(show.platform);
    const foot = show.game.liveInIntro ? say.footNow : say.footLater;
    text(ctx, foot, cx, AY + SIDE - 80, { size: 34, color: DIM, align: "center", spacing: 2 });
  } else if (show.phase === "play" && t < 0.9) {
    const k = t / 0.9;
    ctx.save();
    ctx.globalAlpha = 1 - ease(Math.max(0, k - 0.5) * 2);
    ctx.translate(cx, cy + 70);
    const s = 0.6 + 0.4 * pop(k * 2.2);
    ctx.scale(s, s);
    text(ctx, show.game.teams ? "FIGHT!" : "GO!", 0, 0, { size: 230, color: PAPER, align: "center", stroke: 16, spacing: 4 });
    ctx.restore();
  }
}

function drawKo(ctx: Ctx, show: Show, view: View, d: GameDraw) {
  if (show.phase !== "ko") return;
  const k = show.elapsed / KO_HOLD;
  const r = show.result;
  const word = r?.byTime ? "TIME!" : show.game.id === "race" ? "FINISH!" : "K.O.";
  ctx.save();
  ctx.translate(W / 2, AY + SIDE / 2 + 80);
  const s = 0.5 + 0.5 * pop(k * 3);
  ctx.scale(s, s);
  ctx.rotate(-0.05);
  text(ctx, word, 0, 0, { size: word.length > 5 ? 220 : 270, color: d.winner(show, view).color, align: "center", stroke: 18, spacing: 6 });
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
  const win = d.winner(show, view);
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
  // the LIVE's top 3 stay up: under the winner when there's a vote, where they always are when there isn't
  drawTop3(ctx, show, view, WIN_TOP3_Y[vote ? "vote" : "plain"]);
  if (win.series) {
    const s0 = String(show.series[0]), s1 = String(show.series[1]);
    const wd = measure(ctx, "  –  ", 56, 2);
    const y = top + 400;
    text(ctx, s0, cx - wd / 2, y, { size: 56, color: show.teams[0].color, align: "right" });
    text(ctx, "  –  ", cx, y, { size: 56, color: DIM, align: "center", spacing: 2 });
    text(ctx, s1, cx + wd / 2, y, { size: 56, color: show.teams[1].color });
  } else if (show.result?.podium && show.result.podium.length > 1) {
    const rest = show.result.podium.slice(1).map((p, i) => `${i === 0 ? "2ND" : "3RD"} ${nameOf(view, p.name, p.cpu).toUpperCase()}`).join("   ·   ");
    text(ctx, rest, cx, top + 400, { size: 36, color: DIM, align: "center", spacing: 2, max: SIDE });
  }

  const left = Math.max(1, Math.ceil(show.winFor - t));
  if (vote) {
    text(ctx, `VOTE THE NEXT ${NEXT[show.game.id]}`, cx, 860, { size: 60, align: "center", spacing: 3 });
    text(ctx, words(show.platform).vote, cx, 916, { size: 34, color: GOLD, align: "center", spacing: 2 });
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
    const next = show.game.names ? "A NEW RIVALRY IS UP NEXT" : show.game.teams ? "TYPE 1 OR 2 TO PICK YOUR TEAM" : "TYPE GO TO GET IN";
    text(ctx, next, cx, 1530, { size: 38, color: DIM, align: "center", spacing: 3 });
  }

  if (show.mvp) {
    const m = show.mvp;
    const y = vote ? 1560 : 1250;
    const label = `${nameOf(view, m.viewer.name)}  ·  ${m.coins.toLocaleString("en-US")} ${words(show.platform).worth}`;
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
  drawTop3(ctx, show, view, TOP3.y);
  if (d.menu) d.menu(ctx, show);
  else drawMenu(ctx, show, view, d);
  d.arena(ctx, show, view, turn);
  // one thing at a time over the top of the arena: a big gift, then a welcome back, then the toasts
  if (!drawBlast(ctx, show, view, d) && !drawWelcome(ctx, show, view)) drawToast(ctx, show, view);
  d.rules(ctx, show, view);
  drawIntro(ctx, show, d);
  drawKo(ctx, show, view, d);
  drawWin(ctx, show, view, d);
  if (view.tag) text(ctx, "MADE WITH HOOKLINE", W / 2, H - 40, { size: 28, color: DIM, align: "center", spacing: 4 });
}
