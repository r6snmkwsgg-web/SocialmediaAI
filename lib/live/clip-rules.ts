import { isAbility } from "../battle/abilities";
import type { Spec } from "../shorts/types";
import { CLIP_V, playsFrom, replay, type ClipLog } from "./clip";
import { liveHp, liveOptions } from "./games/battle";
import { namesPeople, plainLetters } from "./offlimits";
import { ownRivalryProblem, RIVALRIES, sidesProblem } from "./rivals";

/**
 * The server's checks on a round's record, past its shape: it was played
 * in the live game's own arena, with sides Hookline would run, and never
 * a Politics rivalry. The upload route asks, and so does the worker before
 * it renders, so a round still keeps the rules when it's made into a video.
 */

const DAY = 24 * 3600_000;
/** a streamer's clock can be a little ahead */
const AHEAD = 5 * 60_000;

/**
 * The rule a round's record breaks, in plain words, or null when it keeps
 * them all. With `now`, it also has to have been played in the last day,
 * as a round arriving from the game is; a clip made days later is checked
 * without it.
 */
export function clipRules(log: ClipLog, now?: number): string | null {
  if (!isAbility(log.a) || !isAbility(log.b)) return "It has a champion the game doesn't.";
  const want = liveOptions(log.fightMax);
  const w = log.world;
  if (w.suddenDeath !== want.suddenDeath || w.maxTeam !== want.maxTeam || w.wallShare !== want.wallShare || w.hangOn !== want.hangOn) return "Its arena isn't the one the game plays.";
  const hp = liveHp(log.a, log.b);
  if (log.hp[0] !== hp[0] || log.hp[1] !== hp[1]) return "Its champions' health isn't what the game gives them.";
  const why = log.game === "battle" ? battleProblem(log) : rivalsProblem(log);
  if (why) return why;
  if (now !== undefined && (log.at < now - DAY || log.at > now + AHEAD)) return "It wasn't played in the last day.";
  return null;
}

/** Ball Battle: two different champions, and team names that pass the same check as saved settings. */
function battleProblem(log: ClipLog): string | null {
  if (log.a === log.b) return "Ball Battle's two champions are always different.";
  if (log.rivalry) return "A Ball Battle round has no rivalry.";
  return sidesProblem(log.teams[0].name, log.teams[1].name);
}

/** Rivals: the same champion on both sides, and one of Hookline's rivalries as it is, or a streamer's own that passes the check. Never Politics. */
function rivalsProblem(log: ClipLog): string | null {
  if (log.a !== log.b) return "Rivals fields the same champion on both sides.";
  const r = log.rivalry;
  if (!r) return "A Rivals round needs its rivalry.";
  if (r.group === "politics") return "Politics rounds never become Shorts.";
  const [red, blue] = [log.teams[0].name, log.teams[1].name];
  if (r.group === "own") return /^own-\d+$/.test(r.id) ? ownRivalryProblem(red, blue) : "That isn't a streamer's own rivalry.";
  const known = RIVALRIES.find((x) => x.id === r.id);
  if (!known || known.red !== red || known.blue !== blue || known.group !== r.group) return "That isn't one of Hookline's rivalries as it is.";
  return null;
}

/**
 * Why a clip Short can't be made into a video, in plain words, or null
 * when it can: the worker asks once more before it renders one. Its round
 * must keep Hookline's rules and name nobody unless the creator chose to
 * show gifters' names, and it must still play back exactly as it
 * happened, from a cut that starts where its replay kept frames, at most
 * 40 seconds before the result.
 */
export function unmakeable(p: { log: ClipLog; from: number; names?: boolean }): string | null {
  if (clipRules(p.log) || (p.names !== true && p.log.people.length > 0)) return "This LIVE round breaks Hookline's rules, so it can't be made.";
  if (p.log.v !== CLIP_V || !playsFrom(replay(p.log), p.from)) return "This LIVE round no longer plays back exactly as it happened, so it can't be made.";
  return null;
}

/**
 * Whether a Short that failed is worth trying again: any but a LIVE round
 * that never became a video and still can't, which would only fail again.
 * One that was made only goes up again, and its round doesn't come into it.
 */
export function canTryAgain(spec: Spec, made: boolean): boolean {
  return made || spec.format !== "clip" || unmakeable(spec.params) === null;
}

/**
 * A gifter's name a clip can show: in letters Hookline can read (an
 * underscore reads as a space, as display names use it), and not naming
 * people for who they are. Any other name is blanked, so the clip says
 * "A viewer's gift" even with names on.
 */
export function showable(name: string): boolean {
  const n = name.replace(/_/g, " ");
  return n.trim().length > 0 && plainLetters(n) && !namesPeople(n);
}
