import type { LivePlatform } from "../events";
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

/** How a game plays differently on YouTube: nothing sent there says which side it's for, so Rivals' sides take the same Super Chats and the chat picks the side. */
const ON_YOUTUBE: Partial<Record<GameId, { line: string; join: string }>> = {
  rivals: { line: "A new rivalry every round, red against blue. Both sides take the same Super Chats. Type 1 or 2 to pick yours.", join: "Type 1 or 2" },
};

/** The games as a streamer going live on this platform reads about them. */
export function gamesFor(platform: LivePlatform): typeof GAMES {
  return platform === "youtube" ? GAMES.map((g) => ({ ...g, ...ON_YOUTUBE[g.id] })) : GAMES;
}

/** The game the settings pick, for a LIVE on TikTok or YouTube: each platform has its own menu. */
export function makeGame(s: LiveSettings, platform: LivePlatform = "tiktok"): Game {
  if (s.game === "race") return new RaceGame(s, platform);
  if (s.game === "royale") return new RoyaleGame(s, platform);
  if (s.game === "rivals") return new RivalsGame(s, platform);
  return new BattleGame(s, platform);
}
