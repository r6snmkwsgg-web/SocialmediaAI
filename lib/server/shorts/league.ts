import "server-only";
import { randomInt } from "node:crypto";
import {
  cardFor, castItem, drawNames, FINAL, finishOf, LEAGUE_HEALTH, makeCast, play, roundRobin, ROUND_MATCHES, SEEDS, sidesOf, stageOf, table,
  type CastBall, type Finish, type Game, type Health, type Result, type Season, type Stage, type Words,
} from "../../battle/league";
import { rng, simulate } from "../../battle/sim";
import type { Melody } from "../../battle/sound";
import { fightId, MELODY_IDS } from "../../shorts/formats/battle";
import { leagueCandidate } from "../../shorts/formats/league";
import { nicheById } from "../../shorts/niches";
import { allTime, type LeagueView, type ShortState, type Standing, type ViewSeason } from "../../shorts/league";
import type { Candidate } from "../../shorts/types";
import { admin, asUser, type Tx } from "../db";
import type { Unit } from "./generate";
import { claim, claimFight } from "./ledger";

/**
 * A channel's Ball League as the database keeps it: its eight balls for
 * good, its seasons, and every match with how it was played. Only the
 * server writes any of it. A season's seeds are drawn and stored the
 * moment it begins, before any fight is run, and only the server reads
 * them, so nobody can know a result before it's played. Matches are played
 * in number order and each is saved with its Short in one go; a retry
 * after a save that went wrong plays the same seeds and gets the same
 * results, since the account's own claimed fights are still its own.
 *
 * Each unit (a YouTube channel, or an account's own Shorts while it has
 * none) has at most one league. One that's disconnected, switched off or
 * past the plan's room makes nothing, so its season waits as it stands.
 */

/** A seed for a fight, drawn so nothing about it can be known beforehand. */
const seed = () => randomInt(1, 2 ** 31 - 1);

/** The unit's own rows: its channel's, or the account's own with no channel. */
const ofUnit = (tx: Tx, unit: Unit) => (unit.channelId ? tx`l.channel_id = ${unit.channelId}` : tx`l.channel_id is null`);

/**
 * Whether a unit is about the Ball League now: its channel's niche, or the
 * account's own while it has no channel. With `hold`, the row stays as it
 * is until the transaction ends, so a change of niche made meanwhile waits
 * for it.
 */
async function inLeague(tx: Tx, unit: Unit, hold = false): Promise<boolean> {
  const lock = hold ? tx`for share` : tx``;
  const [about] = unit.channelId
    ? await tx<{ niche: string | null }[]>`select niche from public.channels where id = ${unit.channelId} and user_id = ${unit.userId} ${lock}`
    : await tx<{ niche: string | null }[]>`select niche from public.profiles where id = ${unit.userId} ${lock}`;
  return nicheById(about?.niche)?.id === "league";
}

/**
 * The season stopped, or a match was saved, while a make was playing
 * them, or the unit left the league before its next season could begin:
 * nothing of it is saved.
 */
export class SeasonGone extends Error {}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type League = { id: string; userId: string; channelId: string | null; cast: CastBall[] };
type LeagueDb = { id: string; user_id: string; channel_id: string | null; balls: CastBall[] };
const leagueRow = (r: LeagueDb): League => ({ id: r.id, userId: r.user_id, channelId: r.channel_id, cast: r.balls });

export type SeasonStatus = "running" | "done" | "stopped";
export type SeasonRow = {
  id: string; number: number; status: SeasonStatus; health: Health; lots: number[]; tune: Melody;
  startedAt: Date; endedAt: Date | null; champion: number | null; stoppedReason: "niche" | null;
};
type SeasonDb = {
  id: string; number: number; status: SeasonStatus; health: Health; lots: number[]; tune: string;
  started_at: Date; ended_at: Date | null; champion: number | null; stopped_reason: "niche" | null;
};
const seasonColumns = (tx: Tx) => tx`id, number, status, health, lots, tune, started_at, ended_at, champion, stopped_reason`;
const seasonRow = (s: SeasonDb): SeasonRow => ({
  id: s.id, number: s.number, status: s.status, health: s.health, lots: s.lots, tune: (MELODY_IDS as string[]).includes(s.tune) ? (s.tune as Melody) : "ode",
  startedAt: s.started_at, endedAt: s.ended_at, champion: s.champion, stoppedReason: s.stopped_reason,
});

/** A match as the server reads it, seeds and all. */
export type MatchRow = {
  id: string; number: number; stage: Stage; round: number | null; a: number | null; b: number | null;
  seeds: number[]; games: Game[] | null; winner: number | null; playedAt: Date | null; videoId: string | null;
};
type MatchDb = Omit<MatchRow, "playedAt" | "videoId"> & { played_at: Date | null; video_id: string | null };
const matchRow = ({ played_at, video_id, ...m }: MatchDb): MatchRow => ({ ...m, playedAt: played_at, videoId: video_id });

/** A unit's league, if it has one yet. */
export async function leagueOf(unit: Unit): Promise<League | null> {
  const [l] = await admin((tx) => tx<LeagueDb[]>`
    select l.id, l.user_id, l.channel_id, l.balls from public.leagues l where l.user_id = ${unit.userId} and ${ofUnit(tx, unit)}`);
  return l ? leagueRow(l) : null;
}

/**
 * A unit's league, made the first time it's needed: eight balls, one of
 * each power, with names no other league has while there are new ones to
 * draw. `words` is only for the tests.
 */
export async function leagueFor(unit: Unit, words?: Words): Promise<League> {
  const had = await leagueOf(unit);
  if (had) return had;
  const balls = await castFor(unit.userId, words);
  const [made] = await admin((tx) => tx<LeagueDb[]>`
    insert into public.leagues (user_id, channel_id, balls) values (${unit.userId}, ${unit.channelId}, ${tx.json(balls)})
    on conflict (user_id, channel_id) do nothing
    returning id, user_id, channel_id, balls`);
  return made ? leagueRow(made) : (await leagueOf(unit))!;
}

/**
 * A new cast's balls, their names claimed in the ledger eight at a time.
 * When another league has any of them, all eight are drawn again keeping
 * clear of every name found taken, for up to 20 rounds; after that a name
 * another league has may be used, never one twice in the cast, so a cast
 * is always made.
 */
async function castFor(userId: string, words?: Words): Promise<CastBall[]> {
  const rand = rng(seed());
  const theirs = new Set<string>();
  const claims = (names: string[]) => names.map((name) => ({ item: castItem(name), kind: "cast" as const }));
  let names = drawNames(rand, { words });
  for (let round = 0; round < 20; round++) {
    const lost = new Set(await claim(userId, claims(names)));
    if (!lost.size) return makeCast(names, rand);
    for (const n of names) if (lost.has(castItem(n))) theirs.add(n);
    names = drawNames(rand, { not: theirs, words });
  }
  // the ones nobody has are still this cast's alone
  await claim(userId, claims(names.filter((n) => !theirs.has(n))));
  return makeCast(names, rand);
}

/** The league's season that's running, if one is. */
async function runningOf(leagueId: string): Promise<SeasonRow | null> {
  const [s] = await admin((tx) => tx<SeasonDb[]>`select ${seasonColumns(tx)} from public.league_seasons where league_id = ${leagueId} and status = 'running'`);
  return s ? seasonRow(s) : null;
}

/**
 * The league's running season, or a new one: the next number, the
 * league's health table as it is now, an order for breaking ties, a tune,
 * and all 31 matches with their seeds (three for each round robin match,
 * six for each semi-final, twelve for the final), in one go. All of it is
 * drawn before any of its fights is run. A new one only begins while the
 * unit is about the Ball League: a change of niche saved at the same
 * moment waits for it, then stops it.
 */
export async function seasonFor(league: League): Promise<SeasonRow> {
  const running = await runningOf(league.id);
  if (running) return running;
  const rand = rng(seed());
  const slots = league.cast.map((b) => b.slot);
  const fixtures = roundRobin(shuffle(slots, rand));
  const lots = shuffle(slots, rand);
  const tune = MELODY_IDS[randomInt(MELODY_IDS.length)];
  const seeds = (stage: Stage) => Array.from({ length: SEEDS[stage] }, seed);
  const matches = [
    ...fixtures.map((f) => ({ number: f.number, stage: "round", round: f.round, a: f.a, b: f.b, seeds: seeds("round") })),
    ...[ROUND_MATCHES + 1, ROUND_MATCHES + 2, FINAL].map((number) => ({ number, stage: stageOf(number), round: null, a: null, b: null, seeds: seeds(stageOf(number)) })),
  ];
  try {
    return await admin(async (tx) => {
      if (!(await inLeague(tx, { userId: league.userId, channelId: league.channelId }, true))) throw new SeasonGone("it left the Ball League before a new season could begin");
      const [s] = await tx<SeasonDb[]>`
        insert into public.league_seasons (league_id, user_id, number, health, lots, tune)
        select ${league.id}, ${league.userId}, coalesce(max(number), 0) + 1, ${tx.json(LEAGUE_HEALTH)}, ${lots}::int[], ${tune}
        from public.league_seasons where league_id = ${league.id}
        returning ${seasonColumns(tx)}`;
      await tx`
        insert into public.league_matches (season_id, user_id, number, stage, round, a, b, seeds)
        select ${s.id}, ${league.userId}, number, stage, round, a, b, seeds
        from jsonb_to_recordset(${tx.json(matches)}::jsonb) as t (number int, stage text, round int, a int, b int, seeds int[])`;
      return seasonRow(s);
    });
  } catch (err) {
    // another make began one at the same moment: that's the season
    if ((err as { code?: string } | null)?.code === "23505") {
      const again = await runningOf(league.id);
      if (again) return again;
    }
    throw err;
  }
}

/** How each ball finished the season before this one, when it was played to the end; a stopped season is never quoted. */
async function lastFinish(leagueId: string, number: number): Promise<Map<number, Finish> | null> {
  if (number <= 1) return null;
  const [s] = await admin((tx) => tx<{ id: string; status: string; lots: number[] }[]>`
    select id, status, lots from public.league_seasons where league_id = ${leagueId} and number = ${number - 1}`);
  if (s?.status !== "done") return null;
  const rows = await admin((tx) => tx<Result[]>`
    select number, a, b, games, winner from public.league_matches where season_id = ${s.id} and played_at is not null order by number`);
  return finishOf(rows, s.lots);
}

/** The season as its matches stand: the schedule, every result in match order, and how the season before ended. */
function seasonState(season: SeasonRow, matches: MatchRow[], last: Map<number, Finish> | null): Season {
  return {
    number: season.number,
    lots: season.lots,
    fixtures: matches.filter((m) => m.stage === "round").map((m) => ({ number: m.number, round: m.round!, a: m.a!, b: m.b! })),
    results: matches.filter((m) => m.playedAt).map((m) => ({ number: m.number, a: m.a!, b: m.b!, games: m.games!, winner: m.winner })),
    last,
  };
}

/** What's next for a unit's league: its season, as it stands, and its next matches. */
export type Next = { league: League; season: SeasonRow; state: Season; next: MatchRow[] };

/**
 * A unit's next matches to play: the lowest-numbered ones not played yet,
 * up to `n`, from its running season (one is begun when none is). They're
 * all one season's, so a batch always stops after a final, and the next
 * season only begins once that final is saved.
 */
export async function nextMatches(unit: Unit, n: number, words?: Words): Promise<Next> {
  const league = await leagueFor(unit, words);
  const season = await seasonFor(league);
  const matches = (await admin((tx) => tx<MatchDb[]>`
    select id, number, stage, round, a, b, seeds, games, winner, played_at, video_id from public.league_matches where season_id = ${season.id} order by number`)).map(matchRow);
  const state = seasonState(season, matches, await lastFinish(league.id, season.number));
  return { league, season, state, next: matches.filter((m) => !m.playedAt).slice(0, n) };
}

/** A match played, not saved yet: its sides, how its games went, and its Short. */
export type Played = { match: MatchRow; a: number; b: number; games: Game[]; winner: number | null; c: Candidate };

/** Another seed for a match whose every seed is another account's fight, kept with the match before it's used. */
async function freshSeed(matchId: string): Promise<number> {
  const s = seed();
  await admin((tx) => tx`update public.league_matches set seeds = seeds || ${s}::int where id = ${matchId} and played_at is null`);
  return s;
}

/**
 * Plays the next matches in order: each one's sides from the season so
 * far (a knockout's from the table and the semi-finals as they come out,
 * earlier matches of the batch included), its fights claimed in the ledger
 * before they're run, at its season's health, and its Short made from
 * what happened. Nothing is saved here; saveMatches saves each with its
 * Short.
 */
export async function playMatches(unit: Unit, { league, season, state, next }: Next): Promise<Played[]> {
  const results = [...state.results];
  const out: Played[] = [];
  for (const m of next) {
    const sides = sidesOf(m.number, state.fixtures, results, state.lots);
    if (!sides) throw new Error(`match ${m.number} can't be played before the ones before it`);
    const [A, B] = [league.cast[sides[0]], league.cast[sides[1]]];
    const hp = [season.health[A.power], season.health[B.power]] as const;
    const before: Season = { ...state, results: [...results] };
    const r = await play(stageOf(m.number), A, B, m.seeds, season.health, (s) => claimFight(unit.userId, fightId(A.power, B.power, s, hp)), simulate, () => freshSeed(m.id));
    const card = cardFor(before, league.cast, m.number, [A, B], r);
    const c = leagueCandidate({ card, sides: [A, B], games: r.games, health: season.health, tune: season.tune, fresh: r.fresh });
    out.push({ match: m, a: A.slot, b: B.slot, games: r.games, winner: r.winner, c });
    results.push({ number: m.number, a: A.slot, b: B.slot, games: r.games, winner: r.winner });
  }
  return out;
}

/** A played match's Short, ready to go in the queue. */
export type ToSave = Played & { title: string; description: string; why: string[]; origin: "daily" | "replacement"; suggestedFor: Date | null };

/**
 * A batch of played matches saved in one go, each with its Short: only
 * into a season still running (so a change of niche meanwhile saves none
 * of it) and only into matches nobody saved meanwhile. The final crowns
 * its champion and ends the season. If anything goes wrong nothing is
 * saved, and the next try plays the same seeds. Returns the Shorts' ids.
 */
export async function saveMatches(unit: Unit, seasonId: string, played: ToSave[]): Promise<string[]> {
  return admin(async (tx) => {
    const [s] = await tx<{ status: string }[]>`select status from public.league_seasons where id = ${seasonId} and user_id = ${unit.userId} for update`;
    if (s?.status !== "running") throw new SeasonGone("the season stopped before its matches were saved");
    const ids: string[] = [];
    for (const p of played) {
      const [m] = await tx`
        update public.league_matches set a = ${p.a}, b = ${p.b}, games = ${tx.json(p.games)}, winner = ${p.winner}, played_at = now()
        where id = ${p.match.id} and season_id = ${seasonId} and played_at is null returning id`;
      if (!m) throw new SeasonGone(`match ${p.match.number} was saved already`);
      const [v] = await tx<{ id: string }[]>`
        insert into public.videos (user_id, channel_id, format, params, key, title, description, why, status, origin, suggested_for)
        values (${unit.userId}, ${unit.channelId}, ${p.c.format}, ${tx.json(p.c.params as never)}, ${p.c.key}, ${p.title}, ${p.description},
          ${tx.json(p.why)}, 'review', ${p.origin}, ${p.suggestedFor})
        returning id`;
      await tx`update public.league_matches set video_id = ${v.id} where id = ${p.match.id}`;
      if (p.match.number === FINAL) await tx`update public.league_seasons set status = 'done', champion = ${p.winner}, ended_at = now() where id = ${seasonId}`;
      ids.push(v.id);
    }
    return ids;
  });
}

/** How many of a unit's Ball League Shorts are waiting for a swipe. */
export async function waitingFor(unit: Unit): Promise<number> {
  const [r] = await asUser(unit.userId, (tx) => tx<{ n: number }[]>`
    select count(*)::int as n from public.videos
    where status = 'review' and format = 'battle' and params ? 'league'
      and ${unit.channelId ? tx`channel_id = ${unit.channelId}` : tx`channel_id is null`}`);
  return r?.n ?? 0;
}

/**
 * A unit that isn't about the Ball League any more stops the season it
 * had running: its results stay, no champion is crowned and its unplayed
 * seeds are never used. Coming back starts a new season with the same
 * balls. Read from what the unit is about now, so a change made any way at
 * all is caught by its next make. Returns how many matches the season had
 * played, or null when nothing was running. Runs in the transaction it's
 * handed, if it's handed one.
 */
export async function stopIfLeft(unit: Unit, tx?: Tx): Promise<number | null> {
  const run = async (tx: Tx) => {
    if (await inLeague(tx, unit)) return null;
    const [s] = await tx<{ id: string }[]>`
      update public.league_seasons s set status = 'stopped', stopped_reason = 'niche', ended_at = now()
      from public.leagues l
      where l.id = s.league_id and l.user_id = ${unit.userId} and ${ofUnit(tx, unit)} and s.status = 'running'
      returning s.id`;
    if (!s) return null;
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.league_matches where season_id = ${s.id} and played_at is not null`;
    return n;
  };
  return tx ? run(tx) : admin(run);
}

/** A unit's running season, if it has one: its number and how many of its matches have been played. */
export async function seasonOn(unit: Unit): Promise<{ number: number; played: number } | null> {
  const [s] = await asUser(unit.userId, (tx) => tx<{ number: number; played: number }[]>`
    select s.number, (select count(*)::int from public.league_matches m where m.season_id = s.id and m.played_at is not null) as played
    from public.league_seasons s join public.leagues l on l.id = s.league_id
    where l.user_id = ${unit.userId} and ${ofUnit(tx, unit)} and s.status = 'running'`);
  return s ?? null;
}

/** A season as the pages show it, with how many of its matches have been played. */
const viewSeason = (s: SeasonDb, played: number): ViewSeason => ({
  number: s.number, status: s.status, champion: s.champion, startedAt: s.started_at, endedAt: s.ended_at, stoppedReason: s.stopped_reason,
  health: s.health, lots: s.lots, played,
});

/**
 * A unit's league as the queue gives it in a line: its cast, and its
 * newest season with that season's table, from who played and won its
 * matches and nothing else. Read as the creator; null when the unit has
 * never had a league.
 */
export async function standingOf(unit: Unit): Promise<Standing | null> {
  return asUser(unit.userId, async (tx) => {
    const [l] = await tx<{ id: string; balls: CastBall[] }[]>`select l.id, l.balls from public.leagues l where l.user_id = ${unit.userId} and ${ofUnit(tx, unit)}`;
    if (!l) return null;
    const [s] = await tx<SeasonDb[]>`select ${seasonColumns(tx)} from public.league_seasons where league_id = ${l.id} order by number desc limit 1`;
    if (!s) return { cast: l.balls, seasons: [], table: [] };
    const played = await tx<Pick<Result, "number" | "a" | "b" | "winner">[]>`
      select number, a, b, winner from public.league_matches where season_id = ${s.id} and played_at is not null`;
    return { cast: l.balls, seasons: [viewSeason(s, played.length)], table: table(played, s.lots) };
  });
}

/**
 * A unit's league as its page shows it (see LeagueView). Read as the
 * creator, and never a seed of a match that hasn't been played: a played
 * match's seeds are in its games. Null when the unit has never had a
 * league.
 */
export async function leagueView(unit: Unit): Promise<LeagueView | null> {
  return asUser(unit.userId, async (tx) => {
    const [l] = await tx<{ id: string; balls: CastBall[] }[]>`select l.id, l.balls from public.leagues l where l.user_id = ${unit.userId} and ${ofUnit(tx, unit)}`;
    if (!l) return null;
    const seasons = await tx<(SeasonDb & { played: number })[]>`
      select ${seasonColumns(tx)}, (select count(*)::int from public.league_matches m where m.season_id = league_seasons.id and m.played_at is not null) as played
      from public.league_seasons where league_id = ${l.id} order by number desc`;
    const matches = await tx<(Omit<MatchDb, "seeds"> & { season: number; video_status: string | null })[]>`
      select s.number as season, m.id, m.number, m.stage, m.round, m.a, m.b, m.games, m.winner, m.played_at, m.video_id, v.status as video_status
      from public.league_matches m join public.league_seasons s on s.id = m.season_id
      left join public.videos v on v.id = m.video_id
      where s.league_id = ${l.id} order by s.number, m.number`;
    const shortOf = (m: (typeof matches)[number]): ShortState =>
      !m.played_at ? "unplayed"
      : !m.video_status ? "none"
      : m.video_status === "review" ? "waiting"
      : m.video_status === "posted" ? "posted"
      : m.video_status === "rejected" ? "skipped"
      : m.video_status === "failed" ? "failed"
      : "coming";
    const newest = seasons[0];
    const shown = newest ? matches.filter((m) => m.season === newest.number) : [];
    const results: Result[] = shown.filter((m) => m.played_at).map((m) => ({ number: m.number, a: m.a!, b: m.b!, games: m.games!, winner: m.winner }));
    const played = matches.filter((m) => m.played_at);
    return {
      cast: l.balls,
      seasons: seasons.map((s) => viewSeason(s, s.played)),
      table: newest ? table(results, newest.lots) : [],
      matches: shown.map((m) => ({
        number: m.number, stage: m.stage, round: m.round, a: m.a, b: m.b, games: m.games, winner: m.winner, playedAt: m.played_at, short: shortOf(m),
        videoId: m.video_status ? m.video_id : null,
      })),
      // every match each ball has played, all seasons long, and each season's final
      records: allTime(l.balls, played.map((m) => ({ a: m.a!, b: m.b!, winner: m.winner })), seasons.map((s) => s.champion)),
      finals: played.filter((m) => m.number === FINAL).map((m) => ({ season: m.season, a: m.a!, b: m.b!, games: m.games!, winner: m.winner! })),
    };
  });
}

/**
 * Whether any of an account's Shorts are about the Ball League now: one of
 * its YouTube channels that's still its own, or its own Shorts while it
 * has none. The Shorts tabs show the league's page when one is.
 */
export async function inLeagueNow(userId: string): Promise<boolean> {
  const [r] = await asUser(userId, (tx) => tx<{ yes: boolean }[]>`
    select exists (select 1 from public.channels where user_id = ${userId} and platform = 'youtube' and status <> 'revoked' and niche = 'league')
      or (not exists (select 1 from public.channels where user_id = ${userId} and platform = 'youtube' and status <> 'revoked')
        and exists (select 1 from public.profiles where id = ${userId} and niche = 'league')) as yes`);
  return r?.yes ?? false;
}

/** The units an account has had a Ball League for: its channels' ids, and null for its own Shorts'. */
export async function leaguesOf(userId: string): Promise<(string | null)[]> {
  const rows = await asUser(userId, (tx) => tx<{ channel_id: string | null }[]>`select channel_id from public.leagues where user_id = ${userId}`);
  return rows.map((r) => r.channel_id);
}
