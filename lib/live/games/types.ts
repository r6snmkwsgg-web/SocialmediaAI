import type { BattleEvent, Team } from "../../battle/sim";
import type { Viewer } from "../events";
import type { Tier } from "../menu";
import type { GameId, LiveSettings } from "../settings";

/**
 * What every live game is to the show around it. The show owns the
 * stream: who's watching, who's on which team, coins, the crown, the
 * vote and the round's rhythm. A game owns its arena: what's in it, what
 * a gift does there, and who won.
 */

/** something the vote can pick for the next round: a matchup, a board, an arena */
export type VoteOption = { key: string; label: string };

/** someone in the arena, for the podium and the win screen */
export type Entrant = { id: string; name: string; avatar?: string; cpu?: boolean };

export type Result = {
  /** decided on what was left when time ran out, not by a knockout or a finish */
  byTime: boolean;
  /** team games: the winning team, or null for a draw */
  team?: Team | null;
  /** everyone-for-themselves games: who won, or null for nobody */
  champion?: Entrant | null;
  /** the top few, best first */
  podium?: Entrant[];
};

export type GiftAct = {
  viewer: Viewer;
  /** their team, in team games */
  side: Team | null;
  tier: Tier;
  /** how many of the gift */
  count: number;
  /** what one of them costs */
  each: number;
  /** everything they've given this round, this gift included */
  total: number;
  /** "Perfume" or "3x Perfume" */
  gift: string;
};

/** What the screen should say about something a viewer did. */
export type Said = {
  /** one line over the arena */
  toast?: string;
  /** the big banner, for the menu's big items */
  blast?: boolean;
};

export type RoundStart = {
  round: number;
  /** what the vote picked, if there was a vote */
  option: VoteOption | null;
  rand: () => number;
};

export interface Game {
  readonly id: GameId;
  /** RED against BLUE, or everyone for themselves */
  readonly teams: boolean;
  readonly menu: Tier[];
  /** what's happened in the arena, for the effects and the sound */
  readonly events: BattleEvent[];
  /** seconds of play this round */
  readonly clock: number;
  /**
   * Whether viewers' gifts and entries land during the countdown (lining
   * up for a race) or wait until play starts (a battle's fight).
   */
  readonly liveInIntro: boolean;

  start(o: RoundStart): void;
  /** one physics step */
  tick(): void;
  /** who won, once it's decided */
  result(): Result | null;
  /** how fast play runs: below 1 for slow motion at the clutch moment */
  tension(): number;

  /** someone typed their way in, free: everyone-for-themselves games only */
  enter(viewer: Viewer): Said | null;
  gift(a: GiftAct): Said;
  /** likes and follows, turned into health */
  heal(viewer: Viewer, side: Team | null, hp: number): void;
  share(viewer: Viewer, side: Team | null): Said | null;

  /** choices for the vote on the next round */
  options(rand: () => number): VoteOption[];
  /** team games: each team's health, to find the team that's behind */
  teamHp?(t: Team): number;
  /** how many are in the arena right now */
  count(): number;
}

export type GameMaker = (s: LiveSettings) => Game;
