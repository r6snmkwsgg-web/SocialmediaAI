import type { GameId, LiveSettings } from "../settings";
import { BattleGame } from "./battle";
import { RaceGame } from "./race";
import { RivalsGame } from "./rivals";
import { RoyaleGame } from "./royale";
import type { Game } from "./types";

/** The games, as the setup page and the website list them. */
export const GAMES: { id: GameId; name: string; line: string; join: string }[] = [
  { id: "battle", name: "Ball Battle", line: "RED against BLUE. Viewers pick a team, and every gift lands in the fight.", join: "Type 1 or 2" },
  { id: "race", name: "Ball Race", line: "Everyone's ball races down a marble run. Gifts make yours heavier, faster, and give it power-ups.", join: "Type GO" },
  { id: "royale", name: "Last One Standing", line: "Everyone's ball in one arena, all against all. The last one alive wins.", join: "Type GO" },
  { id: "rivals", name: "Rivals", line: "A new rivalry every round, red against blue. Each side has its own gifts, so the gift you send is the side you're on.", join: "Type 1 or 2, or send a side's gift" },
];

export function makeGame(s: LiveSettings): Game {
  if (s.game === "race") return new RaceGame(s);
  if (s.game === "royale") return new RoyaleGame(s);
  if (s.game === "rivals") return new RivalsGame(s);
  return new BattleGame(s);
}
