import { TOP_SHOWN } from "@/lib/live/supporters";
import { circle, coin, DIM, face, GOLD, INK, measure, nameOf, PAPER, text, type Ctx, type View } from "./kit";
import { cut, MEDALS } from "./top3";

/**
 * A LIVE's recap card: a picture to post once a LIVE verified as the
 * streamer's own is over, drawn in their browser. It says whose LIVE and
 * when, the gift coins seen (what viewers sent, never money), rounds, the
 * most playing at once and the top supporters, as initials when the
 * streamer hides their names.
 */

/** the size of a TikTok photo or a story */
export const RECAP = { w: 1080, h: 1920 };
/**
 * Roughly what TikTok's app covers on a photo post: its top bar, the
 * buttons down the right and the caption along the bottom (estimates for
 * ordinary videos, like TIKTOK_PHONE). Everything but the tag stays inside
 * the rest, as far in from the left as from the right, so it sits centred.
 */
export const RECAP_CLEAR = { top: 220, bottom: 1440, side: 140 };

export type RecapData = {
  /** the TikTok it was on, without the @ */
  username: string | null;
  /** the day it was, as the streamer's own device writes it */
  day: string;
  /** the game's name */
  game: string;
  rounds: number;
  peakPlayers: number;
  /** gift coins seen: what viewers sent */
  coins: number;
  /** the top gifters, most coins first */
  top: { name: string; coins: number }[];
};

const L = RECAP_CLEAR.side, R = RECAP.w - RECAP_CLEAR.side, CX = RECAP.w / 2;
/** the coin before the gift coins seen, and the gap after it */
const COIN = 34, GAP = 22;
/** where each of the top supporters' rows goes down the card */
const ROW = { y: 1196, step: 98 };
/** longer names are cut to this many characters, then shrunk to fit */
const NAME_CUT = 18;

const n = (v: number) => v.toLocaleString("en-US");

/** The ones the card shows: up to 3 who gave something, most first. */
function supportersOf(d: RecapData): RecapData["top"] {
  return d.top.filter((g) => g.coins > 0).slice(0, TOP_SHOWN);
}

/** The card, top to bottom: whose LIVE and when, the gift coins seen, two numbers, then the top supporters. */
export function drawRecap(ctx: Ctx, d: RecapData, { hideNames, tag }: { hideNames: boolean; tag: boolean }) {
  // nobody's picture is kept, so every supporter is a letter
  const view: View = { demo: false, image: () => null, hideNames };
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, RECAP.w, RECAP.h);
  text(ctx, "LIVE RECAP", CX, 300, { size: 56, color: DIM, align: "center", spacing: 8 });
  if (d.username) text(ctx, `@${d.username}`, CX, 410, { size: 88, align: "center", max: R - L });
  text(ctx, `${d.day} · ${d.game}`.toUpperCase(), CX, 480, { size: 34, color: DIM, align: "center", spacing: 2, max: R - L });
  drawCoinsSeen(ctx, d.coins, 700);
  text(ctx, "GIFT COINS SEEN", CX, 774, { size: 48, align: "center", spacing: 3 });
  text(ctx, "WHAT VIEWERS SENT", CX, 818, { size: 28, color: DIM, align: "center", spacing: 3 });
  drawNumber(ctx, d.rounds, "ROUNDS", CX - 230);
  drawNumber(ctx, d.peakPlayers, "MOST PLAYING AT ONCE", CX + 230);
  const top = supportersOf(d);
  if (top.length) {
    text(ctx, "TOP SUPPORTERS", CX, 1120, { size: 48, align: "center", spacing: 3 });
    top.forEach((g, i) => drawSupporter(ctx, view, g, i, ROW.y + i * ROW.step));
  }
  if (tag) text(ctx, "MADE WITH HOOKLINE", CX, 1720, { size: 30, color: DIM, align: "center", spacing: 4 });
}

/** The gift coins seen, big and gold, with a coin before them, centred together. */
function drawCoinsSeen(ctx: Ctx, coins: number, y: number) {
  const s = n(coins);
  const max = R - L - COIN * 2 - GAP;
  const w = Math.min(max, measure(ctx, s, 200, 2));
  const x = CX - (COIN * 2 + GAP + w) / 2;
  // level with the middle of the figures, which stand about 0.86 of their size tall
  coin(ctx, x + COIN, y - 86, COIN);
  text(ctx, s, x + COIN * 2 + GAP, y, { size: 200, color: GOLD, spacing: 2, max });
}

/** One of the two numbers side by side, with what it is under it. */
function drawNumber(ctx: Ctx, v: number, label: string, x: number) {
  text(ctx, n(v), x, 976, { size: 130, align: "center", max: 300 });
  text(ctx, label, x, 1030, { size: 32, color: DIM, align: "center", spacing: 2, max: 330 });
}

/** A top supporter's row: their place, their letter, their name (or initials) and their coins. */
function drawSupporter(ctx: Ctx, view: View, g: { name: string; coins: number }, i: number, y: number) {
  circle(ctx, L + 30, y, 30, MEDALS[i]);
  text(ctx, String(i + 1), L + 30, y + 12, { size: 34, color: INK, align: "center" });
  face(ctx, view, g.name, undefined, L + 110, y, 36, i === 0 ? GOLD : PAPER);
  const s = n(g.coins);
  const w = measure(ctx, s, 40, 1);
  text(ctx, s, R, y + 14, { size: 40, color: DIM, align: "right", spacing: 1 });
  coin(ctx, R - w - 18, y, 10);
  // the name gets whatever room the coins leave
  const x = L + 164;
  text(ctx, cut(nameOf(view, g.name), NAME_CUT).toUpperCase(), x, y + 20, { size: 56, color: i === 0 ? GOLD : PAPER, spacing: 1, max: R - w - 46 - x });
}

/** What the card says, in words, for a screen reader: the names, or initials, as the card shows them. */
export function recapWords(d: RecapData, hideNames: boolean): string {
  const view: View = { demo: false, image: () => null, hideNames };
  const top = supportersOf(d);
  return [
    `LIVE recap${d.username ? ` for @${d.username}` : ""}, ${d.day}, ${d.game}.`,
    `${n(d.coins)} gift coins seen, what viewers sent.`,
    `${n(d.rounds)} round${d.rounds === 1 ? "" : "s"}, and at most ${n(d.peakPlayers)} playing at once.`,
    ...(top.length ? [`Top supporters: ${top.map((g) => `${nameOf(view, g.name)} with ${n(g.coins)}`).join(", ")}.`] : []),
  ].join(" ");
}
