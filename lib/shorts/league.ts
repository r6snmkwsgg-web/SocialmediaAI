import { FINAL, ROUND_MATCHES, type CastBall, type Game, type Health, type Result, type Row, type Stage } from "../battle/league";

/**
 * A channel's Ball League in words, for the app's pages: where its season
 * is, how each match went and where its Short is, as the league page and
 * the queue say them. All of it comes from matches that were played,
 * never from one that hasn't been.
 */

/** Where a match's Short is: waiting for a swipe, on its way, posted, swiped away, failed, gone, or not made because the match isn't played yet. */
export type ShortState = "waiting" | "coming" | "posted" | "skipped" | "failed" | "none" | "unplayed";

/** Each state as the league page says it. */
export const SHORT_STATE: Record<ShortState, string> = {
  waiting: "Waiting for your swipe",
  coming: "On its way",
  posted: "Posted",
  skipped: "Skipped",
  failed: "Failed",
  none: "No Short",
  unplayed: "Not played yet",
};

/** A match's Short as the league page says it: one of a stopped season that was never played won't be. */
export const shortWords = (state: ShortState, stopped: boolean) => (state === "unplayed" && stopped ? "Not played" : SHORT_STATE[state]);

export type ViewMatch = {
  number: number; stage: Stage; round: number | null; a: number | null; b: number | null;
  games: Game[] | null; winner: number | null; playedAt: Date | null; short: ShortState; videoId: string | null;
};

export type ViewSeason = {
  number: number; status: "running" | "done" | "stopped"; champion: number | null; startedAt: Date; endedAt: Date | null; stoppedReason: "niche" | null;
  health: Health; lots: number[]; played: number;
};

/** A ball's record over every match it's played, all seasons long, and how many seasons it won. */
export type AllTime = { slot: number; won: number; drawn: number; lost: number; titles: number };

/** A season's final once it's played: the season it ended, its sides, its games, and its winner, that season's champion. */
export type ViewFinal = { season: number; a: number; b: number; games: Game[]; winner: number };

/**
 * A unit's league as its page shows it: the cast; every season, newest
 * first; the newest season's table and matches with where each one's
 * Short is; each ball's record over every match it's played, with its
 * titles, best first; and every final played, in season order. Never a
 * seed of a match that hasn't been played: a played match's seeds are in
 * its games.
 */
export type LeagueView = {
  cast: CastBall[];
  seasons: ViewSeason[];
  table: Row[];
  matches: ViewMatch[];
  records: AllTime[];
  finals: ViewFinal[];
};

/**
 * Each ball's record over every match it's played, in every season,
 * stopped ones too, and the seasons it won. A semi-final or the final
 * counts as one match, however many games it took. Best first: most
 * titles, then most wins, then most draws, then fewest defeats, then the
 * cast's order.
 */
export function allTime(cast: readonly CastBall[], played: readonly Pick<Result, "a" | "b" | "winner">[], champions: readonly (number | null)[]): AllTime[] {
  const rows = cast.map((b) => ({ slot: b.slot, won: 0, drawn: 0, lost: 0, titles: champions.filter((c) => c === b.slot).length }));
  for (const m of played) {
    for (const slot of [m.a, m.b]) {
      const r = rows[slot];
      if (m.winner === null) r.drawn++;
      else if (m.winner === slot) r.won++;
      else r.lost++;
    }
  }
  return rows.sort((p, q) => q.titles - p.titles || q.won - p.won || q.drawn - p.drawn || p.lost - q.lost || p.slot - q.slot);
}

/** A season that's over, for the league page's champions: who won it and how its final went, or how far it got before it stopped. */
export type SeasonOver = { number: number; champion: number | null; line: string };

/** Every season that's over, newest first: played to the end with its champion, or stopped with none. */
export function seasonsOver(view: LeagueView): SeasonOver[] {
  return view.seasons.filter((s) => s.status !== "running").map((s) => {
    if (s.status === "stopped") {
      const why = s.stoppedReason === "niche" ? " when the niche changed" : "";
      return { number: s.number, champion: null, line: `Stopped after ${s.played} ${s.played === 1 ? "match" : "matches"}${why}` };
    }
    const f = view.finals.find((x) => x.season === s.number);
    if (!f) return { number: s.number, champion: s.champion, line: "Won the final" };
    const lost = f.winner === f.a ? f.b : f.a;
    const won = (slot: number) => f.games.filter((g) => g.winner === slot).length;
    return { number: s.number, champion: f.winner, line: `Beat ${view.cast[lost].name} ${won(f.winner)}-${won(lost)} in the final` };
  });
}

/** Whose league it is, as a sentence says it: a channel by name, or the account's own Shorts while it has no channel. */
export type Whose = { name: string | null };

const points = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

/** When a new season starts, for a channel or for the account's own Shorts. */
const starts = (who: Whose) => `starts with ${who.name ? "this channel's" : "your"} next Shorts`;

/**
 * Where a league's season is, for the top of its page: playing, waiting
 * while its channel gets no new Shorts, over with its champion, stopped
 * when the channel changed what it's about, or not begun yet. `getting`
 * is whether the unit gets new Shorts now, and `inLeague` whether it's
 * still about the Ball League.
 */
export function seasonLine(view: LeagueView | null, o: { getting: boolean; inLeague: boolean; who: Whose }): string {
  const s = view?.seasons[0];
  if (!s) return `Season 1 ${starts(o.who)}.`;
  const next = o.inLeague ? ` Season ${s.number + 1} ${starts(o.who)}.` : "";
  if (s.status === "done") return `Season ${s.number} is over. ${view.cast[s.champion!].name} is the champion.${next}`;
  if (s.status === "stopped") {
    const when = o.who.name ? "this channel changed niche" : "you changed what your Shorts are about";
    return `Season ${s.number} stopped after ${s.played} ${s.played === 1 ? "match" : "matches"} when ${when}. Its results stay.${next}`;
  }
  if (!o.getting) return `Paused. ${o.who.name ?? "Your account"} gets no new Shorts right now, so the season waits.`;
  return `Season ${s.number}. ${s.played} of ${FINAL} matches played.`;
}

/** What the queue's line on a league goes by: its cast, its newest season (the only one in `seasons`) and that season's table. */
export type Standing = Pick<LeagueView, "cast" | "seasons" | "table">;

/** The league in one line for the queue: how far its season has got and who's top, or its champion. Null for a league that's stopped and not coming back. */
export function standingLine(view: Standing | null, o: { inLeague: boolean; who: Whose }): string | null {
  const s = view?.seasons[0];
  if (!s || s.status === "stopped") return o.inLeague ? `Ball League: season ${s ? s.number + 1 : 1} ${starts(o.who)}.` : null;
  if (s.status === "done") return `Ball League, season ${s.number} is over. ${view.cast[s.champion!].name} is the champion.`;
  if (!s.played) return `Ball League, season ${s.number}: no matches played yet.`;
  const [top, next] = view.table;
  const name = view.cast[top.slot].name;
  // the round robin's over: whoever finished top stays top; until then, top on points or on the tiebreaks
  const who = s.played >= ROUND_MATCHES ? `${name} finished top on ${points(top.points)}.` : top.points > next.points ? `${name} leads on ${points(top.points)}.` : `${name} is top on ${points(top.points)}.`;
  return `Ball League, season ${s.number}: ${s.played} of ${FINAL} played. ${who}`;
}

/** "Match 12", "Semi-final 1", "The final". */
export function matchName(number: number): string {
  return number <= ROUND_MATCHES ? `Match ${number}` : number < FINAL ? `Semi-final ${number - ROUND_MATCHES}` : "The final";
}

/** The same inside a sentence: "match 12", "semi-final 1", "the final". */
const matchWords = (number: number) => (number <= ROUND_MATCHES ? `match ${number}` : number < FINAL ? `semi-final ${number - ROUND_MATCHES}` : "the final");

/**
 * How a match went, in a line: who beat whom, or a draw, and a final's
 * score; or before it's played, who plays it, which for the knockouts
 * is only known by place.
 */
export function matchLine(m: Pick<ViewMatch, "number" | "a" | "b" | "games" | "winner" | "playedAt">, cast: readonly CastBall[]): string {
  if (!m.playedAt || m.a === null || m.b === null) {
    if (m.number === FINAL) return "The semi-final winners";
    if (m.number > ROUND_MATCHES) return m.number === ROUND_MATCHES + 1 ? "1st v 4th" : "2nd v 3rd";
    return m.a !== null && m.b !== null ? `${cast[m.a].name} v ${cast[m.b].name}` : matchName(m.number);
  }
  if (m.winner === null) return `${cast[m.a].name} and ${cast[m.b].name} drew`;
  const [w, l] = m.winner === m.a ? [cast[m.a], cast[m.b]] : [cast[m.b], cast[m.a]];
  const games = m.games ?? [];
  const won = (slot: number) => games.filter((g) => g.winner === slot).length;
  if (m.number === FINAL) return `${w.name} beat ${l.name} ${won(w.slot)}-${won(l.slot)}`;
  if (m.number > ROUND_MATCHES && !won(w.slot)) return `${w.name} went through on its table place after ${games.length} draws with ${l.name}`;
  return `${w.name} beat ${l.name}`;
}

/** Each game of a knockout that took more than one, in a line: who took it, a draw, or one the higher-placed ball took when the seeds ran out. */
export function gameLines(games: readonly Game[], cast: readonly CastBall[]): string[] {
  return games.map((g, i) => {
    const who = g.winner === null ? "a draw" : cast[g.winner].name;
    return `Game ${i + 1}: ${who}${g.seed === null ? ", on its table place when the seeds ran out" : ""}`;
  });
}

/**
 * For Ball League Shorts the creator posts themselves: which to post
 * first, so viewers see the matches in order. Only when more than one is
 * kept to post; null otherwise.
 */
export function orderHint(kept: readonly { season: number; number: number }[]): string | null {
  if (kept.length < 2) return null;
  const first = [...kept].sort((x, y) => x.season - y.season || x.number - y.number)[0];
  // with another season's matches kept too, it says which season's
  const what = kept.some((k) => k.season !== first.season) ? `season ${first.season}, ${matchWords(first.number)}` : matchWords(first.number);
  return `Post Ball League matches in order: ${what} first.`;
}

/** The queue's note while a league's new matches wait for the ones already made. */
export const WAITING_NOTE = "The next Ball League matches come once you've swiped the ones waiting.";

/** What the league page says about every match, under its title: a knockout's drawn game is played again as a new fight, never the same one. */
export const LEAGUE_NOTE =
  "Every game is one real fight, from seeds drawn when the season began and used in order. No fight is run twice or picked, and the table is only real results. A match counts whether or not you post it.";

/** What `?channel=` says on the league page for the account's own Shorts' league, beside its channels' ids. */
export const OWN_LEAGUE = "own";
