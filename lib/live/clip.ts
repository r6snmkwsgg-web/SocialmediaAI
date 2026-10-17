import type { AbilityId } from "../battle/abilities";
import { FPS, type Battle, type Frame, type Team, type World } from "../battle/sim";
import { SLOW, SLOW_FRAMES } from "../battle/timeline";
import { liveResult, liveWorld, type LiveOptions } from "./games/battle";
import { fingerprint, type RoundTape } from "./tape";

/**
 * LIVE clips: a Ball Battle or Rivals round worth watching again, kept as
 * the small record of what reached its arena, so the server, the worker and
 * the player can each play it back exactly, step for step. Plain logic, used
 * by the game, the server, the worker and the player alike.
 *
 * A record holds the arena's seed and rules, the champions, every heal,
 * ball, rage, shield and meteor with the step it landed on, the round's big
 * gifts, and the names of the people who sent gifts. Never a viewer id, a
 * picture, a gift's name, a price or a coin total: the health in it is the
 * arena's own number, shown as health, as it was on the LIVE.
 */

export const CLIP_V = 1;
/** the most inputs and bytes a round's record can be; a busier round isn't sent */
export const CLIP_INPUTS = 6_000;
export const CLIP_BYTES = 128_000;
/** the most gifters a record names, and how much of each name it keeps */
export const CLIP_PEOPLE = 40;
export const CLIP_NAME = 32;
/** the most big gifts a record keeps, the last ones */
export const CLIP_MOMENTS = 200;
/** a fight shorter than this, in seconds, is never a clip */
export const CLIP_MIN_FIGHT = 15;
/** how much of a longer fight a clip can show, in seconds, always ending on the result */
export const CLIP_LENGTHS = [20, 25, 30, 35, 40] as const;
/** the drama a round needs to be worth a Short */
export const CLIP_MIN_SCORE = 4;
/** the best rounds of one LIVE that wait for a morning's Shorts, and for how many days */
export const CLIPS_PER_SESSION = 3;
export const CLIP_DAYS = 3;
/** the most rounds an account can send in an hour: each takes 30 seconds or more */
export const CLIP_RATE = 120;

/** physics steps a second, two to each video frame */
const STEPS = 2 * FPS;
/** the longest a clip shows, in seconds */
const LONGEST = CLIP_LENGTHS[CLIP_LENGTHS.length - 1];
/** the longest a LIVE round can run, in seconds, as the settings allow */
const MAX_FIGHT = 300;
/** room for the overlay key and the braces around a record, when it's sent */
const ROOM = 100;

/** The step a round that runs out of time is decided on: the World's clock runs a step behind its count. */
export const lastStep = (fightMax: number) => STEPS * fightMax + 1;

/** what reached the arena, at the physics step it landed on, in the order it happened */
export type ClipInput =
  /** health: gifts, likes and follows (paying off a side hanging on first) */
  | [step: number, op: "h", team: Team, hp: number]
  /** a viewer's ball: hp 0 is the default health; who is an index into people, or -1 for nobody named */
  | [step: number, op: "s", team: Team, kind: AbilityId, small: 0 | 1, hp: number, who: number]
  /** rage and a shield, for this many seconds */
  | [step: number, op: "r" | "p", team: Team, seconds: number]
  /** one meteor */
  | [step: number, op: "m", team: Team, nth: number, delay: number, hit: number];

export type ClipPower = "rage" | "shield" | "meteor";

/** a big gift going off, for its banner: which power, which side, from whom (-1 for nobody named), how many of it, and how big (0 to 2) */
export type ClipMoment = [step: number, effect: ClipPower, team: Team, who: number, many: number, level: 0 | 1 | 2];

export type ClipSide = { name: string; color: string };

export type ClipLog = {
  v: typeof CLIP_V;
  game: "battle" | "rivals";
  /** the LIVE session it's from */
  session: string;
  /** the session's own count of rounds real viewers played, never the show's count, which runs on across LIVEs */
  round: number;
  /** when it was decided, epoch ms */
  at: number;
  /** the World's seed, each side's champion and its health, and the arena's rules */
  seed: number;
  a: AbilityId;
  b: AbilityId;
  hp: [number, number];
  world: LiveOptions;
  /** the round's time limit, in seconds */
  fightMax: number;
  teams: [ClipSide, ClipSide];
  rivalry?: { id: string; group: string };
  inputs: ClipInput[];
  moments: ClipMoment[];
  /** the names of the round's gifters, by index; nobody else is named */
  people: string[];
  /** the step the round was decided on */
  end: number;
  result: { team: Team | null; byTime: boolean };
  /** the world's fingerprint at `end`, 8 hex digits */
  check: string;
};

/** What the show knows about a round that the arena doesn't. */
export type RoundAround = {
  game: "battle" | "rivals";
  session: string;
  round: number;
  at: number;
  teams: [ClipSide, ClipSide];
  /** the round's gifters, in the order they first gave, under the names they have now */
  gifters: { id: string; name: string }[];
  /** its big gifts going off, by who sent them */
  moments: { step: number; effect: ClipPower; team: Team; viewer: string; many: number; level: 0 | 1 | 2 }[];
  result: { team: Team | null; byTime: boolean };
};

/** a name cut to CLIP_NAME letters, never through the middle of one */
const cut = (name: string) => [...name].slice(0, CLIP_NAME).join("");

/** how many bytes a record is, as it's sent */
const bytes = (log: ClipLog) => new TextEncoder().encode(JSON.stringify(log)).length;

/**
 * A round as a clip's record, or null when it can't be one: a fight under
 * 15 seconds, a round nothing reached the arena in, a Politics rivalry, or
 * one too busy to send. Gifters are named in the order they first gave, up
 * to CLIP_PEOPLE; a ball carrying a gift's health is its gifter's, and
 * anyone else's (the mini ball a share drops in) is nobody's.
 */
export function packClip(tape: RoundTape, r: RoundAround): ClipLog | null {
  if (tape.end < CLIP_MIN_FIGHT * STEPS || tape.inputs.length === 0 || tape.inputs.length > CLIP_INPUTS) return null;
  if (tape.rivalry?.group === "politics") return null;
  const named = r.gifters.slice(0, CLIP_PEOPLE);
  const who = new Map(named.map((g, i) => [g.id, i]));
  const inputs = tape.inputs.map((x): ClipInput => (x[1] === "s" ? [x[0], x[1], x[2], x[3], x[4], x[5], x[5] > 0 && x[6] !== null ? (who.get(x[6]) ?? -1) : -1] : x));
  const moments = r.moments.slice(-CLIP_MOMENTS).map((m): ClipMoment => [m.step, m.effect, m.team, who.get(m.viewer) ?? -1, m.many, m.level]);
  const log: ClipLog = {
    v: CLIP_V,
    game: r.game,
    session: r.session,
    round: r.round,
    at: r.at,
    seed: tape.seed,
    a: tape.a,
    b: tape.b,
    hp: [tape.hp[0], tape.hp[1]],
    world: { ...tape.world },
    fightMax: tape.fightMax,
    teams: [{ ...r.teams[0] }, { ...r.teams[1] }],
    ...(tape.rivalry ? { rivalry: { ...tape.rivalry } } : {}),
    inputs,
    moments,
    people: named.map((g) => cut(g.name)),
    end: tape.end,
    result: { ...r.result },
    check: tape.check,
  };
  return bytes(log) + ROOM <= CLIP_BYTES ? log : null;
}

/** The same round naming nobody, for a game with viewers' names hidden: no people, and every ball and big gift is just a viewer's. */
export function withoutNames(log: ClipLog): ClipLog {
  return {
    ...log,
    inputs: log.inputs.map((x): ClipInput => (x[1] === "s" ? [x[0], x[1], x[2], x[3], x[4], x[5], -1] : x)),
    moments: log.moments.map(([step, effect, team, , many, level]): ClipMoment => [step, effect, team, -1, many, level]),
    people: [],
  };
}

// ── playing it back ──

/** A moment of a LIVE round as a clip draws it: a video battle's frame, plus what only a LIVE has. */
export type LiveFrame = Frame & {
  /** seconds each side has left of rage, a shield and hanging on */
  rage: [number, number];
  shield: [number, number];
  hanging: [number, number];
  /** what a side hanging on still owes */
  owed: [number, number];
  /** meteors on their way down: where each will land, the size of the ball there, how hard it hits, and how far it's fallen, 0 to 1 */
  meteors: { x: number; y: number; r: number; hit: number; k: number }[];
};

/** A ball as a clip draws it: a viewer's mini ball or not, whose (an index into people, -1 for a viewer nobody's named for, null for a champion's own), and when it came in and could first fight, in seconds. */
export type BallMeta = { plain: boolean; who: number | null; born: number; fresh: number };

export type Replay = {
  /**
   * The round as a video battle, so timeline() and soundtrack() read it like
   * any other. Its frames are kept from `first` on, at their own index: no
   * cut starts before it, since a clip shows at most the last 40 seconds.
   */
  battle: Battle;
  /** the same frames, with what only a LIVE has */
  frames: LiveFrame[];
  first: number;
  /** every ball that was ever in the arena, by id */
  meta: Map<number, BallMeta>;
  /** the result and the world's fingerprint where it stopped */
  result: { team: Team | null; byTime: boolean } | null;
  check: string;
  /** each side's health where it stopped, less what it owes, never below 0 */
  hp: [number, number];
  /** physics steps it ran */
  steps: number;
  /** decided first on the record's own step, with its result and its fingerprint, and every input used */
  exact: boolean;
};

/** Seconds left of something that runs until `until`. */
const left = (until: number, w: World) => Math.max(0, until - w.clock);

function liveFrame(w: World): LiveFrame {
  const meteors: LiveFrame["meteors"] = [];
  for (const m of w.meteors) {
    if (w.clock < m.from) continue;
    // where it'll really land: the next strongest ball, once the one it was aimed at is gone
    const t = w.landsOn(m);
    meteors.push({ x: t ? t.x : m.x, y: t ? t.y : m.y, r: t ? t.r : 60, hit: m.hit, k: Math.min(1, (w.clock - m.from) / (m.at - m.from)) });
  }
  return {
    ...w.frame(),
    rage: [left(w.rage[0], w), left(w.rage[1], w)],
    shield: [left(w.shield[0], w), left(w.shield[1], w)],
    hanging: [left(w.hanging[0], w), left(w.hanging[1], w)],
    owed: [w.owed[0], w.owed[1]],
    meteors,
  };
}

/** One input, as the game made it. A ball's tag only says whose it is; names never change how a round plays. */
function apply(w: World, x: ClipInput): boolean {
  switch (x[1]) {
    case "h":
      w.heal(x[2], x[3]);
      return true;
    case "s":
      w.summon(x[2], x[3], { small: x[4] === 1, hp: x[5] || undefined, tag: { id: `v${x[6]}`, name: "" } });
      return true;
    case "r":
      w.enrage(x[2], x[3]);
      return true;
    case "p":
      w.protect(x[2], x[3]);
      return true;
    case "m":
      w.meteor(x[2], x[3], x[4], x[5]);
      return true;
    default:
      return false;
  }
}

/** Everything in the record that landed on this step, in the order it came; the index of the next. */
function take(w: World, inputs: ClipInput[], i: number): number {
  while (i < inputs.length && inputs[i][0] === w.sub && apply(w, inputs[i])) i++;
  return i;
}

/** whose ball a replayed tag says it is */
const whoOf = (id: string | undefined) => (id === undefined ? null : Number(id.slice(1)));

function play(log: ClipLog): Replay {
  const w = liveWorld(log.a, log.b, log.seed, log.world, log.hp);
  const endFrame = Math.ceil(log.end / 2) - 1;
  const first = Math.max(0, endFrame + 1 - LONGEST * FPS);
  // never past the round's own time limit, or the longest any round runs, whatever the record says
  const stop = Math.min(log.end, lastStep(Math.min(log.fightMax, MAX_FIGHT)));
  const frames: LiveFrame[] = new Array(Math.max(0, Math.ceil(stop / 2)));
  let result: Replay["result"] = null;
  let i = take(w, log.inputs, 0);
  // as the show does it: a step, then whether that decided it, then what viewers did before the next
  while (w.sub < stop) {
    w.tick();
    const f = Math.ceil(w.sub / 2) - 1;
    if (f >= first && (w.sub % 2 === 0 || w.sub === log.end)) frames[f] = liveFrame(w);
    result = liveResult(w, log.fightMax);
    if (result) break;
    i = take(w, log.inputs, i);
  }
  const check = fingerprint(w);
  const exact = result !== null && w.sub === log.end && i === log.inputs.length && result.team === log.result.team && result.byTime === log.result.byTime && check === log.check;
  const meta = new Map<number, BallMeta>();
  for (const b of w.balls) meta.set(b.id, { plain: !!b.plain, who: whoOf(b.tag?.id), born: b.born, fresh: b.fresh });
  const battle: Battle = { a: log.a, b: log.b, seed: log.seed, frames, events: w.events, winner: result?.team ?? null, endFrame, byTimeout: result?.byTime ?? false, start: [log.hp[0], log.hp[1]] };
  const hp: [number, number] = [Math.max(0, w.hp(0) - w.owed[0]), Math.max(0, w.hp(1) - w.owed[1])];
  return { battle, frames, first, meta, result, check, hp, steps: w.sub, exact };
}

/** A record that can't be played at all, such as one with a champion the game doesn't have. */
function unplayable(log: ClipLog): Replay {
  const battle: Battle = { a: log.a, b: log.b, seed: log.seed, frames: [], events: [], winner: null, endFrame: -1, byTimeout: false, start: [0, 0] };
  return { battle, frames: [], first: 0, meta: new Map(), result: null, check: "", hp: [0, 0], steps: 0, exact: false };
}

const played = new WeakMap<ClipLog, Replay>();

/**
 * The round played again from its record alone, once per record: the
 * player, the soundtrack and each render tab ask for the same one. It stops
 * at the first decision, so it never runs past the round's time limit
 * (18,001 steps at most), whatever the record says.
 */
export function replay(log: ClipLog): Replay {
  let r = played.get(log);
  if (!r) {
    try {
      r = play(log);
    } catch {
      r = unplayable(log);
    }
    played.set(log, r);
  }
  return r;
}

/** The record plays back to the same result, on the same step, with the same fingerprint. */
export function replaysExactly(log: ClipLog): boolean {
  return replay(log).exact;
}

/** A clip of this round can start on sim frame `from`: it plays back exactly, and the cut starts on a frame it kept, at most 40 seconds before the result. */
export function playsFrom(r: Replay, from: number): boolean {
  return r.exact && Number.isInteger(from) && from >= r.first && from <= r.battle.endFrame;
}

// ── what's worth a Short, and the cut ──

/** What makes a round worth watching again, over the part a clip shows. */
export type ClipDrama = {
  score: number;
  /** times the side ahead changed */
  leads: number;
  /** the winner came back from under a third of the arena's health */
  comeback: boolean;
  /** a side hanging on was paid off in time */
  save: boolean;
  /** big gifts going off */
  big: number;
  /** a knockout winner ended on a quarter or less of the most it had, or time ran out close to even */
  close: boolean;
};

/** a side's health in a frame, less what it owes, never below 0 */
const health = (fr: LiveFrame, t: Team) => Math.max(0, fr.hp[t] - fr.owed[t]);

/** red's share of all the health in the arena */
function share(fr: LiveFrame): number {
  const h0 = health(fr, 0), h1 = health(fr, 1);
  return h0 + h1 > 0 ? h0 / (h0 + h1) : 0.5;
}

/**
 * How good the round is to watch from frame `from` to the end: lead
 * changes (with drama()'s give of 44% to 56%), a comeback after the clip's
 * first second, a save, big gifts, and a close finish, less for a round
 * decided on time and more less for a draw. A round needs CLIP_MIN_SCORE to
 * be a Short: a comeback and a big gift, two lead changes, or a save with a
 * close finish; a lone gift in a one-sided round doesn't. It reads the
 * frames of a replay that played back exactly, from `from` on.
 */
export function clipDrama(r: Replay, log: ClipLog, from: number): ClipDrama {
  const end = r.battle.endFrame;
  const shares: number[] = [];
  for (let f = from; f <= end; f++) shares.push(share(r.frames[f]));
  let leader: Team | null = null;
  let leads = 0;
  for (const v of shares) {
    const now: Team | null = v > 0.56 ? 0 : v < 0.44 ? 1 : leader;
    if (now !== null && leader !== null && now !== leader) leads++;
    if (now !== null) leader = now;
  }
  const won = r.result?.team ?? null;
  const byTime = r.result?.byTime ?? false;
  const comeback = won !== null && shares.slice(FPS).some((v) => (won === 0 ? v : 1 - v) < 1 / 3);
  const save = r.battle.events.some((e) => e.type === "saved" && e.f >= from && e.f <= end);
  const big = log.moments.filter((m) => Math.floor(m[0] / 2) >= from && Math.floor(m[0] / 2) <= end).length;
  let close = false;
  if (byTime) {
    const [h0, h1] = r.hp;
    close = h0 + h1 > 0 && Math.abs(h0 / (h0 + h1) - 0.5) <= 0.1;
  } else if (won !== null) {
    let most = 0;
    for (let f = from; f <= end; f++) most = Math.max(most, health(r.frames[f], won));
    close = health(r.frames[end], won) <= most / 4;
  }
  const score = 2 * Math.min(leads, 4) + (comeback ? 3 : 0) + (save ? 3 : 0) + Math.min(big, 3) + (close ? 2 : 0) - (byTime ? 3 : 0) - (won === null ? 6 : 0);
  return { score, leads, comeback, save, big, close };
}

/**
 * The cut a clip shows, always ending on the result: the whole fight when
 * it runs 15 to 40 seconds, otherwise the most dramatic of its last 20, 25,
 * 30, 35 or 40 seconds, the shorter on a tie. `from` is the sim frame it
 * starts on. Null for a fight too short to be a clip, or a record that
 * doesn't play back exactly.
 */
export function clipWindow(r: Replay, log: ClipLog): { from: number; drama: ClipDrama } | null {
  if (!r.exact || log.end < CLIP_MIN_FIGHT * STEPS) return null;
  const frames = r.battle.endFrame + 1;
  if (frames <= LONGEST * FPS) return { from: 0, drama: clipDrama(r, log, 0) };
  let best: { from: number; drama: ClipDrama } | null = null;
  for (const seconds of CLIP_LENGTHS) {
    const from = frames - seconds * FPS;
    const drama = clipDrama(r, log, from);
    if (!best || drama.score > best.drama.score) best = { from, drama };
  }
  return best;
}

/**
 * The video frame a clip's outro starts on, from its record alone, so a
 * Short's length never needs a replay: the fight from sim frame `from`, with
 * the last SLOW_FRAMES before a knockout at a quarter of the speed. It's the
 * arithmetic of timeline(), started later.
 */
export function clipOutro(end: number, from: number, byTime: boolean): number {
  const endFrame = Math.ceil(end / 2) - 1;
  const slow = byTime ? 0 : Math.max(0, Math.min(SLOW_FRAMES, endFrame - from));
  return endFrame + 1 - from + slow * (SLOW - 1);
}
