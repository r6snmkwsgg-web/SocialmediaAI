import type { Entrant } from "@/lib/live/games/types";
import type { Blast, Show } from "@/lib/live/show";
import type { Ctx, View } from "./kit";

/** What each game draws for itself; the frame around it is the same for all. */
export type GameDraw = {
  /** the strip under the round line: how to join, and who's ahead */
  header(ctx: Ctx, show: Show, view: View): void;
  /** a game whose menu isn't the usual six (Rivals, a menu for each side) draws its own */
  menu?(ctx: Ctx, show: Show): void;
  arena(ctx: Ctx, show: Show, view: View, turn: number): void;
  /** the lines under the arena */
  rules(ctx: Ctx, show: Show): void;
  /** a menu item that's going right now: who has it, and for how long */
  active(show: Show, effect: string): { text: string; color: string } | null;
  /** the countdown's prompt: pick a team, or type GO */
  prompt(ctx: Ctx, show: Show, cx: number, cy: number): void;
  /** who won, for the knockout and the win screen */
  winner(show: Show): { title: string; color: string; entrant?: Entrant | null; line?: string; series?: boolean };
  /** the banner's last line, for a big gift */
  blastLine(show: Show, b: Blast): string;
};
