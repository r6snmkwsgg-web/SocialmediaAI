import type { Show } from "@/lib/live/show";
import { words } from "@/lib/live/words";
import { circle, coin, crown, DIM, face, GOLD, INK, M, measure, nameOf, outline, PAPER, roundRect, SIDE, text, TOP3, type Ctx, type View } from "./kit";

/**
 * The LIVE's top 3 gifters, in a strip under the cards: the same in every
 * game, round after round, and again on the win screen. It shows gift
 * coins seen, never money, and never asks anyone for a gift. On YouTube
 * it shows the game's power, with no coin, since YouTube has none.
 */

/** what the strip says on TikTok before anyone has given anything this LIVE; each platform's is in words() */
export const TOP3_EMPTY = words("tiktok").top3Empty;
/** first, second and third: the race podium's colours */
export const MEDALS = [GOLD, "#C9CED6", "#D08A4E"];
/** where the strip goes on the win screen: under the winner when there's a vote, and where it always is when there isn't */
export const WIN_TOP3_Y = { vote: 736, plain: TOP3.y };
/** longer names are cut to this many characters, then shrunk to fit */
const NAME_CUT = 12;

/** The LIVE's top 3 in the strip at `y`: a crown, then each gifter's place, face, name and coins. */
export function drawTop3(ctx: Ctx, show: Show, view: View, y: number) {
  roundRect(ctx, M, y, SIDE, TOP3.h, 12, "#161618");
  outline(ctx, M, y, SIDE, TOP3.h, 12, "rgba(244,241,234,0.16)", 2);
  crown(ctx, M + 30, y + 24, 30);
  const top = show.top3();
  if (!top.length) {
    text(ctx, words(show.platform).top3Empty, M + 58, y + 32, { size: 26, color: DIM, spacing: 2 });
    return;
  }
  const slot = (SIDE - 72) / 3;
  const coins = show.platform === "tiktok";
  top.forEach((g, i) => {
    const x = M + 58 + i * slot;
    circle(ctx, x + 16, y + 22, 14, MEDALS[i]);
    text(ctx, String(i + 1), x + 16, y + 30, { size: 22, color: INK, align: "center" });
    face(ctx, view, g.viewer.name, g.viewer.avatar, x + 48, y + 22, 15, i === 0 ? GOLD : PAPER);
    // the name gets whatever room the coins leave
    const room = drawCoins(ctx, g.coins, x + slot - 12, y, coins) - 10 - (x + 70);
    text(ctx, cut(nameOf(view, g.viewer.name)).toUpperCase(), x + 70, y + 32, { size: 26, color: i === 0 ? GOLD : PAPER, spacing: 1, max: room });
  });
}

/** A gifter's coins, right-aligned at `right`, with the coin before them, or on YouTube the game's power alone. Returns where it starts. */
function drawCoins(ctx: Ctx, coins: number, right: number, y: number, glyph: boolean): number {
  const s = coins.toLocaleString("en-US");
  const w = measure(ctx, s, 22, 1);
  text(ctx, s, right, y + 30, { size: 22, color: DIM, align: "right", spacing: 1 });
  if (!glyph) return right - w;
  coin(ctx, right - w - 12, y + 22, 6);
  return right - w - 18;
}

/** A long name cut down to `n` characters, so three fit across; the recap card has room for more. */
export function cut(name: string, n = NAME_CUT): string {
  const chars = Array.from(name);
  return chars.length > n ? `${chars.slice(0, n).join("")}…` : name;
}
