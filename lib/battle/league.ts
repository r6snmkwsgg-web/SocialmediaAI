import type { LeagueCard, LeagueLine, LeagueSide } from "../shorts/types";
import { ABILITY_IDS, type AbilityId } from "./abilities";
import { simulate, type Battle } from "./sim";

/**
 * The Ball League: a channel's own eight named balls, one of each power,
 * playing seasons of real fights. A season is a round robin (every ball
 * plays every other once, 28 matches), then semi-finals for the top four
 * and a final, first to two wins: 31 matches, one to a Short. Every match
 * is one real fight from a seed drawn when the season began, nothing is
 * played again or picked, and the table is only real results.
 *
 * What a Short says about its match comes from results and the rules
 * alone, so it stays true whatever happens after: what happened before,
 * what's at stake when that's certain, and what the result means. Nothing
 * teases a match to come.
 *
 * This is the league's arithmetic. The fights are run, and their seeds
 * claimed, by whoever calls it (lib/server/shorts/league.ts), so a test
 * can watch every one.
 */

export type Health = Record<AbilityId, number>;

/**
 * Each power's starting health in the league, set so every power can win
 * a season (scripts/league-balance.ts checks it). A season keeps the
 * table it began with, so changing this only changes seasons to come.
 */
export const LEAGUE_HEALTH: Health = { spike: 20, fibonacci: 4, grow: 17, sword: 20, heal: 27, speed: 18, clone: 21, bomb: 27 };

/**
 * The balls' colours, fourteen hues, every two at least 80 apart and each
 * with an HP number that reads on it: red, orange, yellow, lime, green,
 * teal, sky, blue, indigo, purple, magenta, pink, sienna and steel.
 */
export const BALL_COLORS = ["#E5322D", "#F7891E", "#FDE047", "#9ED33A", "#2E8B2E", "#00968A", "#43BDF2", "#2C63E0", "#3A1F9E", "#9A2FC0", "#E0218C", "#F58CC0", "#8B4A26", "#5F7D8C"] as const;

/**
 * The words ball names are made from, a FIRST then a SECOND: "Havoc
 * Fang", "Nova Rush". At most 12 characters with the space. None is a
 * colour, a people, a place, a faith, a power's name or anything cute, and
 * the tests check every name they make against the off-limits list and
 * the words that read as being for young children.
 */
export const FIRST = [
  "Iron", "Storm", "Turbo", "Volt", "Blaze", "Frost", "Atomic", "Rocket", "Shadow", "Hyper", "Nitro", "Mega", "Ultra", "Rapid", "Wild", "Rogue",
  "Rebel", "Brute", "Grim", "Static", "Vortex", "Cyber", "Laser", "Solar", "Lunar", "Astro", "Cosmic", "Quark", "Plasma", "Magma", "Lava", "Flash",
  "Spark", "Surge", "Pulse", "Blast", "Fury", "Havoc", "Chaos", "Nova", "Zero", "Alpha", "Omega", "Sigma", "Apex", "Max", "Echo", "Ghost",
  "Phase", "Silent", "Swift", "Quick", "Mach", "Thrust", "Meteor", "Quasar", "Pulsar", "Zenith", "Vector", "Matrix", "Binary", "Fusion", "Ion", "Proton",
  "Photon", "Radar", "Sonar", "Torque", "Piston", "Engine", "Steam", "Gale", "Squall", "Rumble", "Quake", "Tremor", "Polar", "Mighty", "Heavy", "Stone",
  "Ember", "Pyro", "Scorch", "Flare", "Torch", "Fuse", "Dynamo", "Gear", "Venom", "Toxic", "Wraith", "Cosmo", "Galaxy", "Star", "Night", "Dusk",
  "Dawn", "Shock", "Jolt", "Neo", "Burst", "Strike", "Charge", "Frenzy", "Tempo", "Feral", "Primal", "Beta", "Gamma", "Zeta", "Theta", "Lambda",
  "Arc", "Watt", "Giga", "Nano", "Chill", "Brisk", "Sharp", "Bold", "Noble", "Grand", "Major",
] as const;
export const SECOND = [
  "Fang", "Comet", "Rush", "Titan", "Viper", "Ace", "Wolf", "Bolt", "Hawk", "Shark", "Orbit", "Blitz", "Claw", "Talon", "Bear", "Lion",
  "Tiger", "Eagle", "Raven", "Cobra", "Mamba", "Rhino", "Bison", "Ram", "Bull", "Boar", "Stag", "Elk", "Fox", "Hyena", "Orca", "Eel",
  "Pike", "Manta", "Gator", "Croc", "Rover", "Probe", "Dash", "Smash", "Slam", "Kick", "Swing", "Spin", "Twist", "Flip", "Roll", "Leap",
  "Drift", "Glide", "Zoom", "Whirl", "Rivet", "Anvil", "Forge", "Armor", "Helm", "Crown", "Brick", "Block", "Rock", "Crag", "Ridge", "Peak",
  "Cliff", "Edge", "Core", "Prism", "Atom", "Byte", "Code", "Flame", "Scout", "Pilot", "Racer", "Boss", "Hero", "Beast", "Hail", "Sleet",
  "Mist", "Fog", "Wave", "Tide", "Surf", "Blur", "Zed", "Jinx", "Vex", "Axis", "Pivot", "Gauge", "Valve", "Crank", "Spoke", "Ox",
  "Kite", "Hound", "Mako", "Drone", "Spur", "Baron", "Duke", "Rally", "Dart", "Reef", "Dune", "Clash", "Grit", "Brawl", "Thump", "Quill",
  "Crest", "Gust", "Joust", "Vault", "Spire", "Chase", "Track", "Trail", "Omen", "Glyph", "Gem", "Shard", "Swarm", "Pack", "Squad", "Crew",
  "Wing", "Fin", "Horn", "Tusk", "Shell", "Jaw", "Grip", "Glove", "Puck", "Goal", "Score", "Hoop", "Medal",
] as const;

export type Words = { first: readonly string[]; second: readonly string[] };

/** One of a cast's eight balls: its place in the cast, its name and colour, and its power. */
export type CastBall = { slot: number; name: string; color: string; power: AbilityId };

/** A ball name's claim in the content ledger, so no other league gets it while there are new ones to draw. */
export const castItem = (name: string) => `cast:${name.toLowerCase()}`;

export type Stage = LeagueCard["stage"];

/** 1 to 28 are the round robin, 29 and 30 the semi-finals, 31 the final. */
export const ROUND_MATCHES = 28;
export const FINAL = 31;
export const stageOf = (number: number): Stage => (number <= ROUND_MATCHES ? "round" : number < FINAL ? "semi" : "final");

/** Seeds drawn for each match when its season begins: one to play and spares, and more where drawn games are played again. */
export const SEEDS: Record<Stage, number> = { round: 3, semi: 6, final: 12 };

/** A semi-final still level after this many games sends the higher-placed ball through. */
export const SEMI_GAMES = 4;

/** The longest a line a Short shows can be. */
export const LINE = 32;

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 1st to 8th. */
export const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/**
 * Eight ball names, with no first word or second word twice, so no two
 * balls in a cast are easy to mix up. Names in `not` (ones another league
 * has) are only used when no eight without them turn up in a good few
 * tries.
 */
export function drawNames(rand: () => number, o: { not?: ReadonlySet<string>; words?: Words } = {}): string[] {
  const words = o.words ?? { first: FIRST, second: SECOND };
  for (let tries = 0; tries < 50; tries++) {
    const names = pairUp(words, rand, o.not);
    if (names) return names;
  }
  return pairUp(words, rand)!;
}

/** Eight names from the words in a random order, each first word with the next second word that makes one not in `not`; null if it can't. */
function pairUp(words: Words, rand: () => number, not?: ReadonlySet<string>): string[] | null {
  const seconds = shuffle(words.second, rand);
  const out: string[] = [];
  for (const f of shuffle(words.first, rand)) {
    if (out.length === 8) break;
    const j = seconds.findIndex((s) => !not?.has(`${f} ${s}`));
    if (j < 0) continue;
    out.push(`${f} ${seconds[j]}`);
    seconds.splice(j, 1);
  }
  return out.length === 8 ? out : null;
}

/** A league's cast: eight balls, one of each power, in shuffled slots 0 to 7, each with one of the names and a colour of its own. */
export function makeCast(names: readonly string[], rand: () => number): CastBall[] {
  if (names.length !== ABILITY_IDS.length || new Set(names).size !== names.length) throw new Error("a cast needs eight different names");
  const powers = shuffle(ABILITY_IDS, rand);
  const colors = shuffle(BALL_COLORS, rand);
  return powers.map((power, slot) => ({ slot, name: names[slot], color: colors[slot], power }));
}

/** A round robin match: its number (1 to 28), its round (1 to 7), and the two slots, a on the left. */
export type Fixture = { number: number; round: number; a: number; b: number };

/**
 * The round robin, by the circle method over the slots in `order` (drawn
 * when the season begins): 7 rounds of 4, every pair once, no ball twice
 * in a round. Which side a ball is on goes by how far apart the two are in
 * `order`, so each is on the left 3 or 4 times.
 */
export function roundRobin(order: readonly number[]): Fixture[] {
  const ring = order.slice(1);
  const out: Fixture[] = [];
  for (let r = 0; r < ring.length; r++) {
    // the first stays put and the rest turn one place a round
    const at = [order[0], ...ring.slice(r), ...ring.slice(0, r)];
    for (let i = 0; i < at.length / 2; i++) {
      const [x, y] = [at[i], at[at.length - 1 - i]];
      const [px, py] = [order.indexOf(x), order.indexOf(y)];
      const [lo, hi] = px < py ? [x, y] : [y, x];
      const left = Math.abs(px - py) % 2 === 1 ? lo : hi;
      out.push({ number: out.length + 1, round: r + 1, a: left, b: left === x ? y : x });
    }
  }
  return out;
}

/**
 * One game as it was run: its seed (null for one the higher-placed ball
 * took when the seeds ran out), the slot that won it (null for a draw),
 * the frame it ended on, whether it was decided on time, and each side's
 * health left.
 */
export type Game = { seed: number | null; winner: number | null; frame: number | null; byTimeout: boolean; hp: [number, number] | null };

/** A match that's been played: its two slots (a on the left), its games, and the slot that won it (null for a drawn round robin match). */
export type Result = { number: number; a: number; b: number; games: Game[]; winner: number | null };

/** A ball's line in the table, and its place. */
export type Row = { slot: number; place: number; played: number; won: number; drawn: number; lost: number; points: number };

/**
 * The table from the round robin's results: 3 points for a win and 1 for
 * a draw, ordered by points, then wins, then the matches between the balls
 * level on both, then the season's lots (an order of slots drawn when it
 * began). Only who played and who won count, never how the games went.
 */
export function table(results: readonly Pick<Result, "number" | "a" | "b" | "winner">[], lots: readonly number[]): Row[] {
  const rows: Row[] = Array.from({ length: 8 }, (_, slot) => ({ slot, place: 0, played: 0, won: 0, drawn: 0, lost: 0, points: 0 }));
  const round = results.filter((r) => r.number <= ROUND_MATCHES);
  for (const r of round) {
    const [x, y] = [rows[r.a], rows[r.b]];
    x.played++;
    y.played++;
    if (r.winner === null) {
      x.drawn++;
      y.drawn++;
      x.points++;
      y.points++;
      continue;
    }
    const [w, l] = r.winner === r.a ? [x, y] : [y, x];
    w.won++;
    w.points += 3;
    l.lost++;
  }
  const level = (p: Row, q: Row) => p.points === q.points && p.won === q.won;
  // what each ball took off the balls it's level with, in their matches with each other
  const between = new Map(rows.map((p) => [p.slot, round.reduce((n, r) => {
    const other = r.a === p.slot ? r.b : r.b === p.slot ? r.a : -1;
    if (other < 0 || !level(rows[other], p)) return n;
    return n + (r.winner === null ? 1 : r.winner === p.slot ? 3 : 0);
  }, 0)]));
  const lot = (slot: number) => lots.indexOf(slot);
  const sorted = [...rows].sort((p, q) => q.points - p.points || q.won - p.won || between.get(q.slot)! - between.get(p.slot)! || lot(p.slot) - lot(q.slot));
  sorted.forEach((r, i) => (r.place = i + 1));
  return sorted;
}

/** The semi-finals from the final table: 1st v 4th and 2nd v 3rd, the higher-placed ball on the left. */
export function semis(t: readonly Row[]): [[number, number], [number, number]] {
  return [[t[0].slot, t[3].slot], [t[1].slot, t[2].slot]];
}

/**
 * Who plays a match, a on the left: the schedule's two for the round
 * robin, the table's top four for the semi-finals once it's complete, and
 * the semi-finals' winners for the final, the higher-placed on the left.
 * Null until the results it needs are in.
 */
export function sidesOf(number: number, fixtures: readonly Fixture[], results: readonly Result[], lots: readonly number[]): [number, number] | null {
  if (number <= ROUND_MATCHES) {
    const f = fixtures.find((x) => x.number === number);
    return f ? [f.a, f.b] : null;
  }
  const round = results.filter((r) => r.number <= ROUND_MATCHES);
  if (round.length < ROUND_MATCHES) return null;
  const t = table(round, lots);
  if (number < FINAL) return semis(t)[number - ROUND_MATCHES - 1];
  const won = [ROUND_MATCHES + 1, ROUND_MATCHES + 2].map((n) => results.find((r) => r.number === n)?.winner);
  if (won.some((w) => w === undefined || w === null)) return null;
  const place = (slot: number) => t.find((r) => r.slot === slot)!.place;
  const [x, y] = won as [number, number];
  return place(x) < place(y) ? [x, y] : [y, x];
}

/** How a fight is run: simulate(), with each side's health. */
export type Run = (a: AbilityId, b: AbilityId, seed: number, hp: readonly [number, number]) => Battle;

/**
 * Plays a match: its seeds in order, each at most once, skipping one whose
 * fight another account already has (`usable` says, and claims it for this
 * one as it does). A round robin match is one game, drawn or not. A
 * semi-final plays again after a draw until a ball wins, and after four
 * draws the higher-placed one (always on the left) goes through. The final
 * is first to two wins, draws not counting. When another account holds
 * every seed the match has, `fresh` draws a new one, kept with the match
 * before it's used. When a knockout's seeds run out partway through, the
 * higher-placed ball takes what's left. Nothing here picks a fight: the
 * first usable seed is the one that's played.
 */
export async function play(
  stage: Stage, A: CastBall, B: CastBall, seeds: readonly number[], health: Health,
  usable: (seed: number) => Promise<boolean>, run: Run = simulate, fresh?: () => Promise<number>,
): Promise<{ games: Game[]; winner: number | null; fresh: boolean }> {
  const hp: [number, number] = [health[A.power], health[B.power]];
  const games: Game[] = [];
  const queue = [...seeds];
  let drew = false;
  const wins = (slot: number) => games.filter((g) => g.winner === slot).length;
  const done = () =>
    stage === "round" ? games.length === 1 : stage === "semi" ? games.some((g) => g.winner !== null) || games.length >= SEMI_GAMES : wins(A.slot) === 2 || wins(B.slot) === 2;
  while (!done()) {
    let seed = queue.shift();
    if (seed === undefined) {
      // every seed it has is another account's: a new one, kept with the match before it runs
      if (games.length || !fresh) break;
      seed = await fresh();
      drew = true;
    }
    if (!(await usable(seed))) continue;
    const b = run(A.power, B.power, seed, hp);
    const last = b.frames[b.endFrame];
    games.push({
      seed,
      winner: b.winner === null ? null : b.winner === 0 ? A.slot : B.slot,
      frame: b.endFrame,
      byTimeout: b.byTimeout,
      hp: [Math.ceil(last.hp[0]), Math.ceil(last.hp[1])],
    });
  }
  if (!games.length) throw new Error("a match needs a seed to play");
  if (stage === "round") return { games, winner: games[0].winner, fresh: drew };
  if (stage === "semi") return { games, winner: games.find((g) => g.winner !== null)?.winner ?? A.slot, fresh: drew };
  // the final's seeds ran out before anyone had two: the higher-placed ball takes each game left
  while (wins(A.slot) < 2 && wins(B.slot) < 2) games.push({ seed: null, winner: A.slot, frame: null, byTimeout: false, hp: null });
  return { games, winner: wins(A.slot) === 2 ? A.slot : B.slot, fresh: drew };
}

/** How a ball finished a season played to the end: champion, beaten in the final, beaten in a semi-final, or its place, 5th to 8th. */
export type Finish = "champion" | "final" | "semi" | number;

/** How each ball finished a season that was played to the end. */
export function finishOf(results: readonly Result[], lots: readonly number[]): Map<number, Finish> {
  const out = new Map<number, Finish>(table(results, lots).slice(4).map((r) => [r.slot, r.place]));
  for (const r of results.filter((x) => x.number > ROUND_MATCHES)) {
    const lost = r.winner === r.a ? r.b : r.a;
    if (r.number === FINAL) {
      out.set(r.winner!, "champion");
      out.set(lost, "final");
    } else out.set(lost, "semi");
  }
  return out;
}

/**
 * A season as it stands before a match: its number, its lots, the round
 * robin's schedule, every result so far in match order, and how each ball
 * finished the season before when that one was played to the end (a
 * stopped season is never quoted).
 */
export type Season = { number: number; lots: readonly number[]; fixtures: readonly Fixture[]; results: readonly Result[]; last: ReadonlyMap<number, Finish> | null };

/** Each slot's points, and how many round robin matches it has left, leaving out match `but`. */
function standing(results: readonly Result[], fixtures: readonly Fixture[], but?: number): { points: number[]; left: number[] } {
  const points = Array(8).fill(0);
  for (const r of results.filter((x) => x.number <= ROUND_MATCHES)) {
    if (r.winner === null) {
      points[r.a]++;
      points[r.b]++;
    } else points[r.winner] += 3;
  }
  const played = new Set(results.map((r) => r.number));
  const left = Array(8).fill(0);
  for (const f of fixtures) {
    if (played.has(f.number) || f.number === but) continue;
    left[f.a]++;
    left[f.b]++;
  }
  return { points, left };
}

/** Certainly in the top four: fewer than four others could still reach its points. */
function sureIn(slot: number, s: { points: number[]; left: number[] }): boolean {
  return s.points.filter((p, z) => z !== slot && p + 3 * s.left[z] >= s.points[slot]).length < 4;
}

/** Certainly out of the top four: at least four others already have more points than it could still reach. */
function sureOut(slot: number, s: { points: number[]; left: number[] }): boolean {
  const most = s.points[slot] + 3 * s.left[slot];
  return s.points.filter((p, z) => z !== slot && p > most).length >= 4;
}

/** A round robin result added to the results, for working out what would follow from it. */
const withResult = (results: readonly Result[], number: number, a: number, b: number, winner: number | null): Result[] => [
  ...results,
  { number, a, b, games: [], winner },
];

/** The two sides as they stand before a match: their places once they've played, and their round robin records. */
export function sidesBefore(s: Season, sides: readonly [CastBall, CastBall]): [LeagueSide, LeagueSide] {
  const t = table(s.results, s.lots);
  return sides.map((ball) => {
    const r = t.find((x) => x.slot === ball.slot)!;
    return { slot: ball.slot, name: ball.name, color: ball.color, place: r.played ? r.place : null, record: { won: r.won, drawn: r.drawn, lost: r.lost } };
  }) as [LeagueSide, LeagueSide];
}

/**
 * What happened before a match, at most two lines, from results only: the
 * league's first match says so; otherwise each side's streak this season,
 * or its last match this season, or how it finished last season when that
 * season was played to the end, or that it's its first match. The
 * semi-finals say where the balls finished, and the final how each got
 * there.
 */
export function previously(s: Season, cast: readonly CastBall[], number: number, sides: readonly [CastBall, CastBall]): LeagueLine[] {
  const stage = stageOf(number);
  if (stage === "semi") {
    const t = table(s.results, s.lots);
    return sides.map((b, i) => ({ side: i as 0 | 1, text: `Finished ${ordinal(t.find((r) => r.slot === b.slot)!.place)}` }));
  }
  if (stage === "final") {
    return sides.map((b, i) => {
      const semi = s.results.find((r) => r.number > ROUND_MATCHES && r.winner === b.slot)!;
      const beaten = cast[semi.a === b.slot ? semi.b : semi.a];
      return { side: i as 0 | 1, text: semi.games.some((g) => g.winner === b.slot) ? `Beat ${beaten.name} in the semi` : "Through on its table place" };
    });
  }
  if (s.number === 1 && number === 1) return [{ side: null, text: "The first Ball League match" }];
  const lines = sides.map((b, i) => ({ side: i as 0 | 1, text: pastOf(s, cast, b.slot) }));
  if (lines.every((l) => l.text === FIRST_MATCH)) return [{ side: null, text: "The first match for both" }];
  return lines;
}

/** The line for a ball with nothing before it to say. */
const FIRST_MATCH = "Its first match";

/** One side's "previously" in the round robin. */
function pastOf(s: Season, cast: readonly CastBall[], slot: number): string {
  const mine = s.results.filter((r) => r.number <= ROUND_MATCHES && (r.a === slot || r.b === slot));
  const outcome = (r: Result) => (r.winner === null ? "drew" : r.winner === slot ? "won" : "lost");
  const last = mine.at(-1);
  if (last) {
    // its run of wins or defeats this season, most recent first
    let run = 0;
    for (let i = mine.length - 1; i >= 0 && outcome(mine[i]) === outcome(last); i--) run++;
    if (run >= 2 && outcome(last) === "won") return `${run} wins in a row`;
    if (run >= 2 && outcome(last) === "lost") return `${run} defeats in a row`;
    const other = cast[last.a === slot ? last.b : last.a].name;
    return outcome(last) === "won" ? `Beat ${other} last time` : outcome(last) === "lost" ? `Lost to ${other} last time` : `Drew with ${other} last time`;
  }
  const f = s.last?.get(slot);
  if (f === "champion") return "Champion last season";
  if (f === "final") return "Lost the final last season";
  if (f === "semi") return "Semi-finalist last season";
  if (typeof f === "number") return `${ordinal(f)} last season`;
  return FIRST_MATCH;
}

/**
 * What's at stake, in one line, only when it's certain under the rules:
 * a win that puts a ball in the top four for good, a loss that keeps it
 * out, or a win that takes it top. Side a is checked first. The
 * semi-finals and the final say what the winner gets.
 */
export function stakes(s: Season, number: number, sides: readonly [CastBall, CastBall]): LeagueLine | null {
  const stage = stageOf(number);
  if (stage === "semi") return { side: null, text: "The winner is in the final" };
  if (stage === "final") return { side: null, text: "First to two wins is champion" };
  const now = standing(s.results, s.fixtures);
  // clear of everyone on points, by `more`
  const clear = (me: number, more: number) => now.points.every((p, z) => z === me || now.points[me] + more > p);
  for (const i of [0, 1] as const) {
    const [me, other] = [sides[i].slot, sides[1 - i].slot];
    const win = standing(withResult(s.results, number, me, other, me), s.fixtures, number);
    const loss = standing(withResult(s.results, number, me, other, other), s.fixtures, number);
    if (!sureIn(me, now) && sureIn(me, win)) return { side: i, text: "A win means top four for good" };
    if (!sureOut(me, now) && sureOut(me, loss)) return { side: i, text: "A loss means no top four" };
    if (!clear(me, 0) && clear(me, 3)) return { side: i, text: "A win takes it top" };
  }
  return null;
}

/**
 * Whether a win was an upset: the winner was at least three places and
 * three points below the ball it beat, and both had played at least three
 * matches. Places split only by the lots never count.
 */
export function isUpset(before: readonly Row[], winner: number, loser: number): boolean {
  const [w, l] = [before.find((r) => r.slot === winner)!, before.find((r) => r.slot === loser)!];
  return w.played >= 3 && l.played >= 3 && w.place - l.place >= 3 && l.points - w.points >= 3;
}

/**
 * What a result means, at most two lines, from the result itself: an
 * upset first, then where it leaves the winner (top, up a place, in the
 * top four for good) or the loser (out of the top four for good), or a
 * point each; into the final; and the champion with the final's score.
 * Only what's certain is said.
 */
export function after(s: Season, number: number, sides: readonly [CastBall, CastBall], result: Pick<Result, "games" | "winner">): LeagueLine[] {
  const stage = stageOf(number);
  const sideOf = (slot: number) => (sides[0].slot === slot ? 0 : 1) as 0 | 1;
  if (stage === "final") {
    const w = result.winner!;
    const wins = (slot: number) => result.games.filter((g) => g.winner === slot).length;
    const l = sides[1 - sideOf(w)].slot;
    return [{ side: sideOf(w), text: `Season ${s.number} champion` }, { side: sideOf(w), text: `Won the final ${wins(w)}-${wins(l)}` }];
  }
  const before = table(s.results, s.lots);
  if (result.winner === null) return [{ side: null, text: "A point each" }];
  const w = result.winner;
  const l = sides[1 - sideOf(w)].slot;
  const lines: LeagueLine[] = [];
  if (isUpset(before, w, l)) lines.push({ side: sideOf(w), text: `Upset: ${ordinal(before.find((r) => r.slot === w)!.place)} beat ${ordinal(before.find((r) => r.slot === l)!.place)}` });
  if (stage === "semi") {
    lines.push({ side: sideOf(w), text: "Into the final" });
    if (!result.games.some((g) => g.winner === w)) lines.push({ side: sideOf(w), text: "Through on its table place" });
    return lines.slice(0, 2);
  }
  const results = withResult(s.results, number, sides[0].slot, sides[1].slot, w);
  const was = standing(s.results, s.fixtures);
  const now = standing(results, s.fixtures);
  const [placeWas, placeNow] = [before.find((r) => r.slot === w)!.place, table(results, s.lots).find((r) => r.slot === w)!.place];
  const main: LeagueLine =
    !sureIn(w, was) && sureIn(w, now) ? { side: sideOf(w), text: "Top four for good" }
    : placeNow === 1 && placeWas !== 1 ? { side: sideOf(w), text: "Goes top" }
    : placeNow === 1 ? { side: sideOf(w), text: "Top of the table" }
    : !sureOut(l, was) && sureOut(l, now) ? { side: sideOf(l), text: "Can't make the top four" }
    : placeNow < placeWas ? { side: sideOf(w), text: `Up to ${ordinal(placeNow)}` }
    : { side: sideOf(w), text: `Stays ${ordinal(placeNow)}` };
  return [...lines, main];
}

/** "Match 12 of 31", "Semi-final 1", "The final: first to two". */
export function labelOf(number: number): string {
  const stage = stageOf(number);
  return stage === "round" ? `Match ${number} of ${FINAL}` : stage === "semi" ? `Semi-final ${number - ROUND_MATCHES}` : "The final: first to two";
}

/** Everything a match's Short says about it: from the season before it, and for the ending, its result. */
export function cardFor(s: Season, cast: readonly CastBall[], number: number, sides: readonly [CastBall, CastBall], result: Pick<Result, "games" | "winner">): LeagueCard {
  return {
    season: s.number,
    number,
    stage: stageOf(number),
    label: labelOf(number),
    sides: sidesBefore(s, sides),
    previously: previously(s, cast, number, sides),
    stakes: stakes(s, number, sides),
    after: after(s, number, sides, result),
  };
}

/**
 * A whole season played out, every match in order with seeds from `seed`
 * and every one usable: for checking the health table, in
 * scripts/league-balance.ts and the tests, and for the made-up league the
 * stills are drawn from. The real thing plays a few matches a day on the
 * server.
 */
export async function playOut(
  cast: readonly CastBall[], seed: () => number, rand: () => number, health: Health = LEAGUE_HEALTH, run: Run = simulate,
): Promise<{ results: Result[]; champion: number; lots: number[]; fixtures: Fixture[] }> {
  const order = shuffle(cast.map((b) => b.slot), rand);
  const lots = shuffle(cast.map((b) => b.slot), rand);
  const fixtures = roundRobin(order);
  const results: Result[] = [];
  for (let number = 1; number <= FINAL; number++) {
    const [a, b] = sidesOf(number, fixtures, results, lots)!;
    const seeds = Array.from({ length: SEEDS[stageOf(number)] }, seed);
    const r = await play(stageOf(number), cast[a], cast[b], seeds, health, async () => true, run);
    results.push({ number, a, b, games: r.games, winner: r.winner });
  }
  return { results, champion: results.at(-1)!.winner!, lots, fixtures };
}
