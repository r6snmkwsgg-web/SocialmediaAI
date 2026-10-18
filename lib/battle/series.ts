import type { BattleParams } from "../shorts/types";
import { FPS, simulate, type Battle, type Team } from "./sim";
import { OUTRO, timeline, type Timeline } from "./timeline";

/**
 * A Ball League knockout's games in one Short, one after another: each
 * fight in full, with a short gap between them that says how it stands,
 * and the winner at the end. A match of one game is exactly the battle
 * Short it always was. The rare final too long for a Short plays its
 * fights faster, decided when it's made and labelled on screen, up to
 * twice as fast; past that, drawn games after the first show as a card,
 * and every game that decided something still plays in full.
 */

/** Frames between two games: the last frame of one, dimmed under how it stands, before the next starts. */
export const GAP = 60;
/** Frames a game shown as a card takes. */
export const CARD = 90;
/** The longest a Short can run here, in seconds: inside YouTube's three minutes, with room to spare. */
export const LONGEST = 175;
/** The fastest the fights ever play. */
export const FASTEST = 2;

/** What a series is made from: a battle Short's fight, and for a knockout, its games, speed and cards. */
export type SeriesOf = Pick<BattleParams, "a" | "b" | "seed" | "hp" | "games" | "speed" | "cards">;

/** How a fight is run: simulate(), unless a test says otherwise. */
export type Run = (a: BattleParams["a"], b: BattleParams["b"], seed: number, hp?: readonly [number, number]) => Battle;

export type SeriesGame = {
  /** the game's seed, or null for one the higher-placed ball took when the seeds ran out */
  seed: number | null;
  /** the fight and how it plays, or null for a game shown as a card */
  battle: Battle | null;
  tl: Timeline | null;
  /** the video frame it starts on */
  from: number;
  /** who took it: 0 on the left, 1 on the right, null for a draw */
  winner: Team | null;
};

export type Series = { games: SeriesGame[]; endFrom: number; speed: number };

/** A Short's games by seed: a knockout's in turn, or a match's one fight. */
export const seedsOf = (p: Pick<SeriesOf, "seed" | "games">): (number | null)[] => (p.games?.length ? p.games : [p.seed]);

/** Each game's fight, or null for one nobody fought. */
function fightsOf(p: SeriesOf, run: Run): (Battle | null)[] {
  return seedsOf(p).map((seed) => (seed === null ? null : run(p.a, p.b, seed, p.hp)));
}

/** The games laid out end to end at a speed, with these shown as cards. */
function lay(p: SeriesOf, fights: (Battle | null)[], speed: number, cards: readonly number[]): Series {
  const seeds = seedsOf(p);
  const games: SeriesGame[] = [];
  let at = 0;
  fights.forEach((battle, i) => {
    if (!battle || cards.includes(i)) {
      // a draw played again, or a game the higher-placed ball (on the left) took
      games.push({ seed: seeds[i], battle: null, tl: null, from: at, winner: battle ? battle.winner : 0 });
      at += CARD;
      return;
    }
    const tl = timeline(battle, { speed });
    games.push({ seed: seeds[i], battle, tl, from: at, winner: battle.winner });
    at += tl.outroFrom + (i < fights.length - 1 ? GAP : 0);
  });
  return { games, endFrom: at, speed };
}

/** A battle Short's games in order, where each starts, and the frame its ending starts on. */
export function series(p: SeriesOf, run: Run = simulate): Series {
  return lay(p, fightsOf(p, run), p.speed ?? 1, p.cards ?? []);
}

/**
 * Where a video frame falls among a Short's games: in a game's fight, in
 * the gap after one, on a game shown as a card, or in the ending. `game`
 * is the game it falls in, `shown` the fought game on screen (a card and
 * the ending hold the last one fought before them, as it finished) and
 * `local` the frame of that fight's own video to draw.
 */
export type Moment = { kind: "fight" | "gap" | "card" | "end"; game: number; shown: number; local: number };

export function momentOf(s: Series, frame: number): Moment {
  const last = s.games.length - 1;
  // the first game is always fought, so there's always one to hold
  const fought = (i: number) => {
    let j = i;
    while (j > 0 && !s.games[j].battle) j--;
    return j;
  };
  const held = (j: number, since: number) => s.games[j].tl!.outroFrom + since;
  if (frame >= s.endFrom) {
    const j = fought(last);
    return { kind: "end", game: last, shown: j, local: held(j, frame - s.endFrom) };
  }
  let i = last;
  while (i > 0 && s.games[i].from > frame) i--;
  const g = s.games[i];
  if (!g.battle) {
    const j = fought(i);
    return { kind: "card", game: i, shown: j, local: held(j, GAP + frame - g.from) };
  }
  const local = frame - g.from;
  return { kind: local < g.tl!.outroFrom ? "fight" : "gap", game: i, shown: i, local };
}

/**
 * Who a Short's games say won: its one game's winner (null for a draw),
 * or for a knockout the last game's, since a semi-final stops at its first
 * win and a final at its second. A semi-final still level after its draws
 * goes to the higher-placed ball, always on the left.
 */
export function winnerOf(s: Series): Team | null {
  const last = s.games[s.games.length - 1];
  return s.games.length > 1 ? (last.winner ?? 0) : last.winner;
}

/**
 * How a Short's games fit in one: as they are when they already do, or
 * the lowest speed in steps of 0.05 up to twice as fast that does, and
 * failing that, drawn games after the first as cards too. Only what
 * changes is given, to be kept in the Short's params.
 */
export function fitSpeed(p: SeriesOf, run: Run = simulate): { speed?: number; cards?: number[] } {
  const fights = fightsOf(p, run);
  // every battle ending is at most the winner's screen
  const fits = (speed: number, cards: number[]) => lay(p, fights, speed, cards).endFrom + OUTRO <= LONGEST * FPS;
  const lowest = (cards: number[]) => {
    for (let k = 20; k <= FASTEST * 20; k++) if (fits(k / 20, cards)) return k / 20;
    return null;
  };
  const speed = lowest([]);
  if (speed !== null) return speed === 1 ? {} : { speed };
  const cards = fights.flatMap((b, i) => (i > 0 && b && b.winner === null ? [i] : []));
  const carded = lowest(cards) ?? FASTEST;
  return { ...(carded === 1 ? {} : { speed: carded }), cards };
}
