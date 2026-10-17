import { rng, type BattleEvent } from "../battle/sim";
import { clipWindow, replay, type ClipLog } from "./clip";
import type { LiveEvent, Viewer } from "./events";
import type { BattleGame } from "./games/battle";
import { DEFAULT_GIFTS, type MenuGift } from "./menu";
import { DEFAULT_SIDE_GIFTS } from "./rivals";
import { LETTERS, Show } from "./show";

/**
 * Rounds recorded from a scripted show, for the tests, the stills script
 * and the replay check. Its viewers are made up but play the way real ones
 * do, so the show keeps their rounds. Nothing here is ever shown in the
 * app, and none of it is anyone's LIVE.
 */

/** the made-up viewers' display names */
const NAMES = ["Kai", "mia.plays", "noahhh", "Sofi B", "lucas_0", "ellie", "theo.v", "Nina", "zara_x", "omar", "Jess", "Big Ben"];

/** A round the show kept, and its arena as it was decided, to check a replay against. */
export type Kept = { log: ClipLog; events: BattleEvent[]; step: number };

/** every gift a game's viewers send, cheapest first: the menu's, and in Rivals each side's and some on neither */
function giftsOf(game: "battle" | "rivals"): MenuGift[] {
  if (game === "battle") return [...DEFAULT_GIFTS, { name: "Universe", coins: 44_999 }];
  return [{ name: "Rose", coins: 1 }, { name: "Doughnut", coins: 30 }, ...DEFAULT_SIDE_GIFTS.red, ...DEFAULT_SIDE_GIFTS.blue, { name: "Galaxy", coins: 1000 }];
}

/**
 * A show of made-up viewers acting as real ones: they pick sides, like,
 * follow, share, vote and send every gift on the menu, now and then a big
 * one, at frame times that wobble and hitch the way a browser's do. It runs
 * `rounds` rounds and returns every round it kept, in order. The same game
 * and seed always play the same rounds.
 */
export function scriptedShow(game: "battle" | "rivals", seed: number, o: { rounds?: number; roundSeconds?: number; vote?: boolean } = {}): { show: Show; kept: Kept[] } {
  const show = new Show({ seed, settings: { game, roundSeconds: o.roundSeconds ?? 90, vote: o.vote ?? true, clips: true } });
  const r = rng(seed * 7 + 3);
  const viewers: Viewer[] = Array.from({ length: 24 }, (_, i) => ({ id: `fan-${i + 1}`, name: NAMES[i % NAMES.length] }));
  const gifts = giftsOf(game);
  const kept: Kept[] = [];
  const rounds = o.rounds ?? 5;
  // half an hour of show at most, whatever the seed
  for (let frame = 0; frame < 60 * 60 * 30 && show.round <= rounds; frame++) {
    for (const e of crowd(show, r, viewers, gifts)) show.handle(e);
    show.update(r() < 0.01 ? 0.25 : (1 / 60) * (0.4 + r() * 1.8));
    const w = (show.game as BattleGame).world;
    for (const log of show.takeClips({ hideNames: false })) kept.push({ log, events: w.events.slice(), step: w.sub });
  }
  return { show, kept };
}

/** What the crowd does in one frame. */
function crowd(show: Show, r: () => number, viewers: Viewer[], gifts: MenuGift[]): LiveEvent[] {
  const out: LiveEvent[] = [];
  const v = () => viewers[Math.floor(r() * viewers.length)];
  if (r() < 0.3) {
    const voting = show.phase === "win" && show.vote;
    const names = show.teams.map((t) => t.name);
    out.push({ kind: "chat", viewer: v(), text: voting ? LETTERS[Math.floor(r() * 3)] : r() < 0.7 ? String(1 + Math.floor(r() * 2)) : names[Math.floor(r() * 2)] });
  }
  if (r() < 0.5) out.push({ kind: "like", viewer: v(), count: 1 + Math.floor(r() * 40) });
  if (r() < 0.04) {
    // mostly the cheaper gifts, a big one now and then
    const big = r() < 0.15;
    const g = big ? gifts[gifts.length - 1 - Math.floor(r() * 3)] : gifts[Math.floor(r() * (gifts.length - 2))];
    out.push({ kind: "gift", viewer: v(), gift: g.name, coins: g.coins, count: 1 + Math.floor(r() * (big ? 2 : 6)) });
  }
  if (r() < 0.01) out.push({ kind: "follow", viewer: v() });
  if (r() < 0.01) out.push({ kind: "share", viewer: v() });
  return out;
}

/** The most dramatic round a scripted show kept: a clip's record to draw and test with. */
export function demoClip(game: "battle" | "rivals" = "battle", seed = 1): ClipLog {
  let best: { log: ClipLog; score: number } | null = null;
  for (const { log } of scriptedShow(game, seed).kept) {
    const cut = clipWindow(replay(log), log);
    if (cut && (!best || cut.drama.score > best.score)) best = { log, score: cut.drama.score };
  }
  if (!best) throw new Error(`no ${game} round from seed ${seed} could be a clip`);
  return best.log;
}
