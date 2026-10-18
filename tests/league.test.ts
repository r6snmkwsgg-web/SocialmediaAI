import { describe, expect, it, vi } from "vitest";
import { ABILITIES, ABILITY_IDS } from "@/lib/battle/abilities";
import { pickBattle } from "@/lib/battle/drama";
import {
  after, BALL_COLORS, cardFor, castItem, drawNames, FINAL, finishOf, FIRST, isUpset, LEAGUE_HEALTH, LINE, makeCast, play, playOut, previously,
  roundRobin, ROUND_MATCHES, SECOND, semis, sidesOf, stakes, table, type Fixture, type Game, type Result, type Row, type Run, type Season,
} from "@/lib/battle/league";
import { CARD, fitSpeed, GAP, LONGEST, momentOf, series, winnerOf, type Run as SeriesRun, type SeriesOf } from "@/lib/battle/series";
import { FPS, rng, simulate, type Battle, type Team } from "@/lib/battle/sim";
import { OUTRO, timeline } from "@/lib/battle/timeline";
import { soundtrack } from "@/lib/battle/sound";
import { namesPeople } from "@/lib/live/offlimits";
import { kidCoded, unsafe } from "@/lib/shorts/checks";
import { formatName, ledgerClaims } from "@/lib/shorts/formats";
import { fightId, proposeBattle } from "@/lib/shorts/formats/battle";
import { leagueCandidate } from "@/lib/shorts/formats/league";
import {
  allTime, gameLines, LEAGUE_NOTE, matchLine, matchName, orderHint, seasonLine, seasonsOver, SHORT_STATE, shortWords, standingLine, WAITING_NOTE, type LeagueView, type ViewSeason,
} from "@/lib/shorts/league";
import { contrast } from "@/lib/shorts/look";
import { RATE, soundFor } from "@/lib/shorts/sound";
import { endFrom, frames } from "@/lib/shorts/timing";
import type { Spec } from "@/lib/shorts/types";
import { plainDescription } from "@/lib/server/shorts/titles";
import { textOn } from "@/remotion/Battle";

// the drama pick, watched: a league match must never use it
vi.mock("@/lib/battle/drama", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/battle/drama")>();
  return { ...real, pickBattle: vi.fn(real.pickBattle) };
});

/**
 * The Ball League's arithmetic: the cast, the schedule, the table and its
 * tiebreaks, how a match is played from its seeds, what each Short says
 * about its match, the health table's balance, and how a knockout's games
 * fit one Short.
 */

/** A cast whose every name is as long as a name can be, 12 characters, for checking lines' lengths. */
const LONG = ["Atomic Comet", "Rocket Viper", "Shadow Titan", "Plasma Shark", "Vortex Orbit", "Cosmic Blitz", "Static Talon", "Meteor Eagle"];
const cast = makeCast(LONG, rng(3));
const slots = [0, 1, 2, 3, 4, 5, 6, 7];

/** A made-up fight: who wins comes from the seed alone, so a test knows every result without running the physics. */
const fight = (winner: Team | null, length = 600, hp: readonly [number, number] = [20, 20]): Battle =>
  ({
    a: "spike", b: "sword", seed: 0, events: [], winner, endFrame: length, byTimeout: false, start: [hp[0], hp[1]],
    frames: Array.from({ length: length + 1 }, () => ({ balls: [], mines: [], lo: 0, size: 800, hp: [winner === 1 ? 0 : hp[0], winner === 0 ? 0 : hp[1]] as [number, number], count: [1, 1] as [number, number] })),
  }) as Battle;

/** A run whose winners are listed by seed: 0 the left, 1 the right, null a draw. */
const runOf = (by: Record<number, Team | null>, calls: string[] = []): Run => (_a, _b, seed, hp) => {
  calls.push(`run ${seed} ${hp.join("-")}`);
  return fight(seed in by ? by[seed] : 0, 600, hp);
};

const shuffled = (seed: number) => {
  const rand = rng(seed);
  return [...slots].sort(() => rand() - 0.5);
};

/** A round robin result, with the game it had. */
const res = (number: number, a: number, b: number, winner: number | null): Result => ({ number, a, b, winner, games: [{ seed: number, winner, frame: 600, byTimeout: false, hp: [1, 1] }] });

/** A made-up season's outcomes, the stronger (higher) slot winning most: so tables get decided before the end. */
function seasonOf(seed: number): { fixtures: Fixture[]; outcome: (f: Fixture) => number | null; lots: number[] } {
  const rand = rng(seed);
  const fixtures = roundRobin(shuffled(seed));
  const lots = shuffled(seed + 100);
  const picks = new Map(fixtures.map((f) => {
    const r = rand();
    const [hi, lo] = f.a > f.b ? [f.a, f.b] : [f.b, f.a];
    return [f.number, r < 0.1 ? null : r < 0.85 ? hi : lo];
  }));
  return { fixtures, outcome: (f) => picks.get(f.number)!, lots };
}

/** Every way the round robin matches in `rest` could go, with these results already in: each ending's table. */
function everyWay(results: Result[], rest: Fixture[], lots: number[], visit: (t: Row[]) => void) {
  const ways = 3 ** rest.length;
  for (let w = 0; w < ways; w++) {
    let k = w;
    const more = rest.map((f) => {
      const o = k % 3;
      k = Math.floor(k / 3);
      return res(f.number, f.a, f.b, o === 0 ? f.a : o === 1 ? f.b : null);
    });
    visit(table([...results, ...more], lots));
  }
}

const placeOf = (t: Row[], slot: number) => t.find((r) => r.slot === slot)!.place;

describe("a cast", () => {
  it("has eight balls, one of each power, each with its own name and colour", () => {
    for (let s = 1; s <= 40; s++) {
      const rand = rng(s);
      const c = makeCast(drawNames(rand), rand);
      expect(c.map((b) => b.slot)).toEqual(slots);
      expect(new Set(c.map((b) => b.power))).toEqual(new Set(ABILITY_IDS));
      expect(new Set(c.map((b) => b.name)).size).toBe(8);
      expect(new Set(c.map((b) => b.color)).size).toBe(8);
      for (const b of c) expect(BALL_COLORS).toContain(b.color);
      // no first word or second word twice, so no two balls are easy to mix up
      expect(new Set(c.map((b) => b.name.split(" ")[0])).size).toBe(8);
      expect(new Set(c.map((b) => b.name.split(" ")[1])).size).toBe(8);
    }
    expect(() => makeCast(LONG.slice(1), rng(1))).toThrow();
  });

  it("draws colours at least 80 apart, each with an HP number that reads on it as the video draws it", () => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    // the video writes white as #fff
    const ink = (h: string) => textOn(h).replace(/^#(\w)(\w)(\w)$/, "#$1$1$2$2$3$3");
    expect(BALL_COLORS).toHaveLength(14);
    for (let i = 0; i < BALL_COLORS.length; i++) {
      expect(contrast(BALL_COLORS[i], ink(BALL_COLORS[i])), BALL_COLORS[i]).toBeGreaterThanOrEqual(3);
      for (let j = i + 1; j < BALL_COLORS.length; j++) {
        const [x, y] = [rgb(BALL_COLORS[i]), rgb(BALL_COLORS[j])];
        expect(Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]), `${BALL_COLORS[i]} ${BALL_COLORS[j]}`).toBeGreaterThanOrEqual(80);
      }
    }
  });

  it("names balls from at least 100 words each, no colour words, every name at most 12 characters and fine to say", () => {
    expect(FIRST.length).toBeGreaterThanOrEqual(100);
    expect(SECOND.length).toBeGreaterThanOrEqual(100);
    expect(new Set([...FIRST, ...SECOND]).size).toBe(FIRST.length + SECOND.length);
    for (const w of FIRST) expect(w.length, w).toBeLessThanOrEqual(6);
    for (const w of SECOND) expect(w.length, w).toBeLessThanOrEqual(5);
    const colours = /^(red|orange|yellow|green|blue|purple|violet|indigo|pink|brown|black|white|grey|gray|gold|golden|silver|bronze|copper|crimson|scarlet|ruby|amber|jade|emerald|sapphire|onyx|cobalt|neon|teal|cyan|magenta|maroon|navy|olive|lime|lemon|mint|coral|peach|ivory|ebony|jet|charcoal|slate|steel|rust|sienna|ochre|khaki|tan|beige|cream|azure|turquoise|aqua|lilac|lavender|rose|plum|cherry|chrome)$/i;
    // and none is a power's name, which would mix a ball up with what it does
    const powers = new Set(ABILITY_IDS.map((p) => ABILITIES[p].name));
    for (const w of [...FIRST, ...SECOND]) {
      expect(w, w).not.toMatch(colours);
      expect(powers.has(w), w).toBe(false);
    }
    for (const a of FIRST) {
      for (const b of SECOND) {
        const n = `${a} ${b}`;
        expect(n.length, n).toBeLessThanOrEqual(12);
        expect(namesPeople(n) || unsafe(n) || kidCoded(n), n).toBe(false);
      }
    }
  }, 30_000);

  it("draws names nobody else has while there are any, and still makes a cast when there are none", () => {
    const words = { first: ["Ab", "Bc", "Cd", "De", "Ef", "Fg", "Gh", "Hi"], second: ["Jk", "Kl", "Lm", "Mn", "No", "Op", "Pq", "Qr"] };
    const all = words.first.flatMap((f) => words.second.map((s) => `${f} ${s}`));
    // the only eight free names, one with each word, are the ones drawn
    const free = words.first.map((f, i) => `${f} ${words.second[(i + 3) % 8]}`);
    const not = new Set(all.filter((n) => !free.includes(n)));
    for (let s = 1; s <= 10; s++) expect(new Set(drawNames(rng(s), { words, not }))).toEqual(new Set(free));
    // another league's eight taken, one with each word: eight others, every time
    const theirs = new Set(words.first.map((f, i) => `${f} ${words.second[i]}`));
    for (let s = 1; s <= 30; s++) expect(drawNames(rng(s), { words, not: theirs }).some((n) => theirs.has(n))).toBe(false);
    // with every one taken, eight anyway, none twice
    const anyway = drawNames(rng(4), { words, not: new Set(all) });
    expect(new Set(anyway).size).toBe(8);
    expect(new Set(anyway.map((n) => n.split(" ")[0])).size).toBe(8);
    expect(castItem("Havoc Fang")).toBe("cast:havoc fang");
  });
});

describe("a season's schedule and table", () => {
  it("plays every pair once in 7 rounds of 4, no ball twice in a round, each on the left 3 or 4 times", () => {
    for (let s = 1; s <= 60; s++) {
      const f = roundRobin(shuffled(s));
      expect(f.map((x) => x.number)).toEqual(Array.from({ length: ROUND_MATCHES }, (_, i) => i + 1));
      for (let r = 1; r <= 7; r++) {
        const round = f.filter((x) => x.round === r);
        expect(round).toHaveLength(4);
        expect(new Set(round.flatMap((m) => [m.a, m.b])).size).toBe(8);
      }
      expect(new Set(f.map((m) => [m.a, m.b].sort().join("-"))).size).toBe(28);
      for (const slot of slots) expect([3, 4]).toContain(f.filter((m) => m.a === slot).length);
    }
  });

  it("gives 3 points for a win and 1 for a draw, then splits ties by wins, by the matches between level balls, then by the lots", () => {
    // four balls level on points and wins, beating each other round in a circle, and a fifth level with them that never met them
    const circle = [res(1, 0, 1, 0), res(2, 2, 3, 2), res(3, 4, 5, null), res(4, 6, 7, 6), res(5, 1, 2, 1), res(6, 3, 0, 3), res(7, 5, 6, 5), res(8, 7, 4, null)];
    const t = table(circle, [3, 1, 0, 2, 7, 6, 5, 4]);
    expect(t.map((r) => [r.slot, r.points])).toEqual([[5, 4], [3, 3], [1, 3], [0, 3], [2, 3], [6, 3], [4, 2], [7, 1]]);
    expect(t.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(t[0]).toMatchObject({ played: 2, won: 1, drawn: 1, lost: 0 });
    // two level on points and wins: the one that won their match goes ahead, whatever the lots say
    expect(table([res(1, 0, 1, 0), res(2, 1, 2, 1)], [1, 0, 7, 6, 5, 4, 3, 2]).map((r) => r.slot)).toEqual([0, 1, 7, 6, 5, 4, 3, 2]);
    // level on points, but one has more wins
    expect(table([res(1, 0, 1, 0), res(2, 2, 3, null), res(3, 2, 4, null), res(4, 2, 5, null)], [2, 0, 1, 3, 4, 5, 6, 7]).slice(0, 2).map((r) => r.slot)).toEqual([0, 2]);
    // knockouts are never in the table
    expect(table([res(1, 0, 1, 0), res(29, 1, 2, 1)], slots).find((r) => r.slot === 1)).toMatchObject({ played: 1, points: 0 });
  });

  it("puts 1st against 4th and 2nd against 3rd in the semi-finals, and the higher-placed semi winner on the left in the final", () => {
    const { fixtures, outcome, lots } = seasonOf(7);
    const round = fixtures.map((f) => res(f.number, f.a, f.b, outcome(f)));
    expect(sidesOf(29, fixtures, round.slice(0, 27), lots)).toBeNull();
    const t = table(round, lots);
    expect(semis(t)).toEqual([[t[0].slot, t[3].slot], [t[1].slot, t[2].slot]]);
    expect(sidesOf(29, fixtures, round, lots)).toEqual([t[0].slot, t[3].slot]);
    expect(sidesOf(30, fixtures, round, lots)).toEqual([t[1].slot, t[2].slot]);
    expect(sidesOf(31, fixtures, round, lots)).toBeNull();
    // 4th and 2nd win: 2nd is higher, so on the left
    const ko = [...round, res(29, t[0].slot, t[3].slot, t[3].slot), res(30, t[1].slot, t[2].slot, t[1].slot)];
    expect(sidesOf(31, fixtures, ko, lots)).toEqual([t[1].slot, t[3].slot]);
    expect(sidesOf(12, fixtures, [], lots)).toEqual([fixtures[11].a, fixtures[11].b]);
  });
});

describe("playing a match", () => {
  const [A, B] = [cast[0], cast[1]];
  const hp = `${LEAGUE_HEALTH[A.power]}-${LEAGUE_HEALTH[B.power]}`;

  it("runs its seeds in order, each once, never one whose fight another account has, with the league's health, and never picks a fight", async () => {
    vi.mocked(pickBattle).mockClear();
    const calls: string[] = [];
    // the ledger: seeds 11 and 13 are another account's fights, 21 this account's already
    const theirs = new Set([11, 13]);
    const usable = async (seed: number) => {
      calls.push(`claim ${seed}`);
      return !theirs.has(seed);
    };
    const r = await play("round", A, B, [11, 12, 13], LEAGUE_HEALTH, usable, runOf({ 12: null }, calls));
    expect(calls).toEqual(["claim 11", "claim 12", `run 12 ${hp}`]);
    expect(r).toMatchObject({ winner: null, fresh: false });
    expect(r.games).toEqual([{ seed: 12, winner: null, frame: 600, byTimeout: false, hp: [LEAGUE_HEALTH[A.power], LEAGUE_HEALTH[B.power]] }]);
    // a seed this account already holds is its own: played, not skipped, so a retry gets the same fight
    calls.length = 0;
    const own = await play("round", A, B, [21, 22], LEAGUE_HEALTH, usable, runOf({ 21: 1 }, calls));
    expect(calls).toEqual(["claim 21", `run 21 ${hp}`]);
    expect(own.winner).toBe(B.slot);
    // the same real fights, run by simulate itself: the first usable seed is the one
    const real = await play("round", A, B, [11, 12], LEAGUE_HEALTH, usable);
    const expected = simulate(A.power, B.power, 12, [LEAGUE_HEALTH[A.power], LEAGUE_HEALTH[B.power]]);
    expect(real.games[0]).toMatchObject({ seed: 12, frame: expected.endFrame, winner: expected.winner === null ? null : [A.slot, B.slot][expected.winner] });
    expect(pickBattle).not.toHaveBeenCalled();
  });

  it("draws a fresh seed when another account has every one it had, keeping it with the match before it runs", async () => {
    const calls: string[] = [];
    const fresh = async () => {
      calls.push("keep 99");
      return 99;
    };
    const usable = async (seed: number) => {
      calls.push(`claim ${seed}`);
      return seed === 99;
    };
    const r = await play("round", A, B, [1, 2, 3], LEAGUE_HEALTH, usable, runOf({ 99: 0 }, calls), fresh);
    expect(calls).toEqual(["claim 1", "claim 2", "claim 3", "keep 99", "claim 99", `run 99 ${hp}`]);
    expect(r).toMatchObject({ winner: A.slot, fresh: true });
    await expect(play("round", A, B, [1], LEAGUE_HEALTH, async () => false, runOf({}))).rejects.toThrow();
  });

  it("plays a drawn semi-final game again with the next seed, and sends the higher-placed ball through after four draws", async () => {
    const calls: string[] = [];
    const r = await play("semi", A, B, [1, 2, 3, 4, 5, 6], LEAGUE_HEALTH, async () => true, runOf({ 1: null, 2: null, 3: 1 }, calls));
    expect(r.games.map((g) => [g.seed, g.winner])).toEqual([[1, null], [2, null], [3, B.slot]]);
    expect(r.winner).toBe(B.slot);
    expect(calls).toHaveLength(3);
    const level = await play("semi", A, B, [1, 2, 3, 4, 5, 6], LEAGUE_HEALTH, async () => true, runOf({ 1: null, 2: null, 3: null, 4: null, 5: 1 }));
    expect(level.games).toHaveLength(4);
    expect(level.winner).toBe(A.slot);
    // its seeds running out partway, with every game drawn: the higher-placed ball goes through too
    const out = await play("semi", A, B, [1, 2, 3], LEAGUE_HEALTH, async (s) => s < 3, runOf({ 1: null, 2: null }));
    expect([out.games.length, out.winner]).toEqual([2, A.slot]);
  });

  it("plays the final until one ball has two wins, draws not counting, and gives the higher-placed ball what's left if its seeds run out", async () => {
    const r = await play("final", A, B, [1, 2, 3, 4, 5, 6], LEAGUE_HEALTH, async () => true, runOf({ 1: 0, 2: null, 3: 1, 4: 1, 5: 0 }));
    expect(r.games.map((g) => g.winner)).toEqual([A.slot, null, B.slot, B.slot]);
    expect(r.winner).toBe(B.slot);
    const quick = await play("final", A, B, [1, 2, 3], LEAGUE_HEALTH, async () => true, runOf({ 1: 0, 2: 0, 3: 1 }));
    expect(quick.games).toHaveLength(2);
    expect(quick.winner).toBe(A.slot);
    // two seeds, both drawn: the higher-placed ball takes the two games left, each saying so with no seed
    const out = await play("final", A, B, [1, 2], LEAGUE_HEALTH, async () => true, runOf({ 1: null, 2: null }));
    expect(out.games.map((g) => [g.seed, g.winner])).toEqual([[1, null], [2, null], [null, A.slot], [null, A.slot]]);
    expect(out.winner).toBe(A.slot);
  });
});

describe("what a Short says about its match", () => {
  /** A whole made-up season, match by match, with every line its Shorts would show. */
  async function cardsOf(seed: number, number = 1, last: Season["last"] = null) {
    const { fixtures, outcome, lots } = seasonOf(seed);
    const results: Result[] = [];
    const cards = [];
    for (let n = 1; n <= FINAL; n++) {
      const [a, b] = sidesOf(n, fixtures, results, lots)!;
      const s: Season = { number, lots, fixtures, results: [...results], last };
      const by: Record<number, Team | null> = {};
      // knockouts: whoever the made-up season would have win, on the first game
      const w = n <= ROUND_MATCHES ? outcome(fixtures[n - 1]) : Math.max(a, b);
      by[n] = w === null ? null : w === a ? 0 : 1;
      const r = await play(n <= ROUND_MATCHES ? "round" : n < FINAL ? "semi" : "final", cast[a], cast[b], [n, 100 + n, 200 + n], LEAGUE_HEALTH, async () => true, runOf({ ...by, [100 + n]: by[n] }));
      cards.push({ s, card: cardFor(s, cast, n, [cast[a], cast[b]], r), r, a, b });
      results.push({ number: n, a, b, games: r.games, winner: r.winner });
    }
    return { cards, results, lots };
  }

  it("keeps every line to 32 characters with 12-letter names, and only ever quotes a season that was played to the end", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const first = await cardsOf(seed);
      const second = await cardsOf(seed + 10, 2, finishOf(first.results, first.lots));
      const stopped = await cardsOf(seed + 20, 3, null);
      for (const { card } of [...first.cards, ...second.cards, ...stopped.cards]) {
        const lines = [...card.previously, ...(card.stakes ? [card.stakes] : []), ...card.after];
        for (const l of lines) expect(l.text.length, l.text).toBeLessThanOrEqual(LINE);
        expect(card.previously.length).toBeLessThanOrEqual(2);
        expect(card.after.length).toBeLessThanOrEqual(2);
        expect(card.after.length).toBeGreaterThan(0);
      }
      // the season after one that stopped never says "last season"
      expect(stopped.cards.flatMap(({ card }) => card.previously).some((l) => /last season/.test(l.text))).toBe(false);
      expect(second.cards.slice(0, 4).flatMap(({ card }) => card.previously).some((l) => /last season/.test(l.text))).toBe(true);
    }
  });

  it("says only what's true of the results before it: the first match, streaks, last times and last season", async () => {
    const { cards, results } = await cardsOf(9);
    expect(cards[0].card.previously).toEqual([{ side: null, text: "The first Ball League match" }]);
    expect(cards[1].card.previously).toEqual([{ side: null, text: "The first match for both" }]);
    expect(cards[0].card).toMatchObject({ season: 1, number: 1, stage: "round", label: "Match 1 of 31" });
    for (const { s, card, a, b } of cards.filter((c) => c.card.stage === "round" && c.card.number > 4)) {
      for (const line of card.previously) {
        const slot = [a, b][line.side!];
        const mine = s.results.filter((r) => r.a === slot || r.b === slot);
        const last = mine.at(-1);
        const won = (r: Result) => r.winner === slot;
        const lost = (r: Result) => r.winner !== null && r.winner !== slot;
        const streak = /^(\d) (wins|defeats) in a row$/.exec(line.text);
        if (streak) {
          const n = Number(streak[1]);
          const is = streak[2] === "wins" ? won : lost;
          expect(mine.slice(-n).every(is), line.text).toBe(true);
          if (mine.length > n) expect(is(mine.at(-n - 1)!), line.text).toBe(false);
        } else if (last) {
          const other = cast[last.a === slot ? last.b : last.a].name;
          const said = won(last) ? `Beat ${other} last time` : lost(last) ? `Lost to ${other} last time` : `Drew with ${other} last time`;
          expect(line.text).toBe(said);
          // a streak would have been said instead
          expect(mine.length < 2 || won(last) !== won(mine.at(-2)!) || lost(last) !== lost(mine.at(-2)!) || last.winner === null).toBe(true);
        } else expect(line.text).toBe("Its first match");
      }
      // the record and place shown are the table's before the match
      const t = table(s.results, s.lots);
      for (const side of card.sides) {
        const r = t.find((x) => x.slot === side.slot)!;
        expect(side).toMatchObject({ name: cast[side.slot].name, color: cast[side.slot].color, place: r.played ? r.place : null, record: { won: r.won, drawn: r.drawn, lost: r.lost } });
      }
    }
    // the semi-finals say where the balls finished, the final how each got there, and the ending who's champion and by how much
    const t = table(results, cards[0].s.lots);
    expect(cards[28].card.previously).toEqual([{ side: 0, text: `Finished 1st` }, { side: 1, text: `Finished 4th` }]);
    expect(cards[28].card).toMatchObject({ stage: "semi", label: "Semi-final 1", stakes: { side: null, text: "The winner is in the final" } });
    expect(cards[28].card.sides.map((x) => x.slot)).toEqual([t[0].slot, t[3].slot]);
    const final = cards[30];
    expect(final.card).toMatchObject({ stage: "final", label: "The final: first to two", stakes: { side: null, text: "First to two wins is champion" } });
    for (const l of final.card.previously) expect(l.text).toMatch(/^Beat .+ in the semi$/);
    const w = final.r.winner!;
    const wins = (slot: number) => final.r.games.filter((g) => g.winner === slot).length;
    expect(final.card.after).toEqual([
      { side: w === final.a ? 0 : 1, text: "Season 1 champion" },
      { side: w === final.a ? 0 : 1, text: `Won the final ${wins(w)}-${wins(w === final.a ? final.b : final.a)}` },
    ]);
    // and the next season remembers how it ended
    const finish = finishOf(results, cards[0].s.lots);
    expect(finish.get(w)).toBe("champion");
    expect([...finish.values()].filter((f) => f === "semi")).toHaveLength(2);
    expect([...finish.values()].filter((f) => typeof f === "number").sort()).toEqual([5, 6, 7, 8]);
    const next: Season = { number: 2, lots: cards[0].s.lots, fixtures: roundRobin(slots), results: [], last: finish };
    expect(previously(next, cast, 1, [cast[w], cast[w === 0 ? 1 : 0]])[0]).toEqual({ side: 0, text: "Champion last season" });
  });

  it("only says a ball is in the top four for good, or can't make it, when every way the rest of the season could go agrees", async () => {
    let checked = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const { fixtures, outcome, lots } = seasonOf(seed);
      for (let m = 20; m <= ROUND_MATCHES; m++) {
        const results = fixtures.filter((f) => f.number < m).map((f) => res(f.number, f.a, f.b, outcome(f)));
        const f = fixtures[m - 1];
        const sides = [cast[f.a], cast[f.b]] as const;
        const s: Season = { number: 1, lots, fixtures, results, last: null };
        const rest = fixtures.filter((x) => x.number > m);
        const stake = stakes(s, m, sides);
        if (stake?.text === "A win means top four for good" || stake?.text === "A loss means no top four") {
          const me = sides[stake.side!].slot;
          const other = sides[1 - stake.side!].slot;
          const win = stake.text.startsWith("A win");
          everyWay([...results, res(m, f.a, f.b, win ? me : other)], rest, lots, (t) => expect(win ? placeOf(t, me) <= 4 : placeOf(t, me) >= 5, stake.text).toBe(true));
          checked++;
        }
        if (stake?.text === "A win takes it top") {
          const me = sides[stake.side!].slot;
          expect(placeOf(table([...results, res(m, f.a, f.b, me)], lots), me)).toBe(1);
        }
        const result = res(m, f.a, f.b, outcome(f));
        for (const line of after(s, m, sides, result)) {
          const slot = sides[line.side ?? 0].slot;
          if (line.text === "Top four for good" || line.text === "Can't make the top four") {
            everyWay([...results, result], rest, lots, (t) => expect(line.text === "Top four for good" ? placeOf(t, slot) <= 4 : placeOf(t, slot) >= 5, line.text).toBe(true));
            checked++;
          }
          const after_ = table([...results, result], lots);
          if (line.text === "Goes top" || line.text === "Top of the table") expect(placeOf(after_, slot)).toBe(1);
          const up = /^Up to (\d)/.exec(line.text);
          if (up) expect(placeOf(after_, slot)).toBe(Number(up[1]));
        }
      }
    }
    expect(checked).toBeGreaterThan(8);
  }, 60_000);

  it("calls an upset only when the winner was at least 3 places and 3 points below, both having played 3", () => {
    const row = (slot: number, place: number, played: number, points: number): Row => ({ slot, place, played, won: 0, drawn: 0, lost: 0, points });
    expect(isUpset([row(0, 7, 4, 3), row(1, 2, 4, 9)], 0, 1)).toBe(true);
    expect(isUpset([row(0, 7, 4, 3), row(1, 4, 4, 9)], 0, 1)).toBe(true);
    // two places, or two points, isn't enough
    expect(isUpset([row(0, 6, 4, 3), row(1, 4, 4, 9)], 0, 1)).toBe(false);
    expect(isUpset([row(0, 7, 4, 7), row(1, 2, 4, 9)], 0, 1)).toBe(false);
    // places split only by the lots never are
    expect(isUpset([row(0, 8, 4, 6), row(1, 1, 4, 6)], 0, 1)).toBe(false);
    // nor before both have played three
    expect(isUpset([row(0, 7, 2, 0), row(1, 2, 4, 9)], 0, 1)).toBe(false);
    // and the Short says so first, by places
    const fixtures = roundRobin(slots);
    const results = fixtures.slice(0, 16).map((f) => res(f.number, f.a, f.b, Math.min(f.a, f.b)));
    const before = table(results, slots);
    const m = fixtures.slice(16).find((f) => isUpset(before, Math.max(f.a, f.b), Math.min(f.a, f.b)))!;
    const s: Season = { number: 1, lots: slots, fixtures, results, last: null };
    const lines = after(s, m.number, [cast[m.a], cast[m.b]], res(m.number, m.a, m.b, Math.max(m.a, m.b)));
    expect(lines[0].text).toBe(`Upset: ${placeOf(before, Math.max(m.a, m.b))}${["st", "nd", "rd"][placeOf(before, Math.max(m.a, m.b)) - 1] ?? "th"} beat ${placeOf(before, Math.min(m.a, m.b))}${["st", "nd", "rd"][placeOf(before, Math.min(m.a, m.b)) - 1] ?? "th"}`);
    expect(lines).toHaveLength(2);
    // a draw is a point each, never an upset
    expect(after(s, m.number, [cast[m.a], cast[m.b]], res(m.number, m.a, m.b, null))).toEqual([{ side: null, text: "A point each" }]);
  });

  it("makes the Short a real fight at the league's health, says why without claiming anything was picked, and never tells the title writer who wins", async () => {
    const { cards } = await cardsOf(4);
    for (const { card, r, a, b } of [cards[11], cards[29], cards[30]]) {
      const c = leagueCandidate({ card, sides: [cast[a], cast[b]], games: r.games, health: LEAGUE_HEALTH, tune: "king", fresh: false });
      if (c.format !== "battle") throw new Error();
      expect(c.params).toMatchObject({ a: cast[a].power, b: cast[b].power, seed: r.games[0].seed, hp: [LEAGUE_HEALTH[cast[a].power], LEAGUE_HEALTH[cast[b].power]], melody: "king", league: card });
      expect(c.params.games).toEqual(r.games.length > 1 ? r.games.map((g) => g.seed) : undefined);
      expect(c.key).toBe(`battle:${[cast[a].power, cast[b].power].sort().join(":")}`);
      expect(formatName(c)).toBe("Ball League");
      // the title writer never hears the ending: nothing of the after lines, and never who wins
      const told = c.facts.join(" ");
      for (const l of card.after) expect(told).not.toContain(l.text);
      expect(told).toMatch(card.stage === "final" ? /Don't say who wins or the score\./ : /Don't say who wins\./);
      expect(told).toContain(`${cast[a].name} is the ${ABILITIES[cast[a].power].name} ball`);
      expect(told).not.toMatch(/most exciting|picked the winner|the best of/i);
      // a round robin match is one fight; a knockout's drawn games are played again, so it's never called one fight
      expect(told).toMatch(card.stage === "round" ? /This match is one real physics fight from a seed drawn when the season began\./ : /Every game it plays is one real physics fight from seeds drawn when the season began, and a drawn game is played again with the next seed\./);
      if (card.stage !== "round") expect(told).not.toMatch(/one real physics fight from a seed/);
      expect(c.why.join(" ")).toMatch(/Nothing is (played again or )?picked/);
      expect(c.why.at(-1)).toMatch(/counts .*whether or not you post it\.$/);
    }
    const round = leagueCandidate({ card: cards[11].card, sides: [cast[cards[11].a], cast[cards[11].b]], games: cards[11].r.games, health: LEAGUE_HEALTH, tune: "ode", fresh: false });
    expect(round.title).toBe(`${cast[cards[11].a].name} vs ${cast[cards[11].b].name}: Ball League, season 1, match 12`);
    const [sa, sb] = cards[11].card.sides;
    expect(round.why[0]).toBe(`Season 1, match 12 of 31: ${sa.name}, ${sa.place}${["st", "nd", "rd"][sa.place! - 1] ?? "th"}, against ${sb.name}, ${sb.place}${["st", "nd", "rd"][sb.place! - 1] ?? "th"}`);
    // before either has played, just their names
    const opener = leagueCandidate({ card: cards[0].card, sides: [cast[cards[0].a], cast[cards[0].b]], games: cards[0].r.games, health: LEAGUE_HEALTH, tune: "ode", fresh: false });
    expect(opener.why[0]).toBe(`Season 1, match 1 of 31: ${cast[cards[0].a].name} against ${cast[cards[0].b].name}`);
    expect(round.why).toContain("It counts in the table whether or not you post it.");
    expect(leagueCandidate({ card: cards[29].card, sides: [cast[cards[29].a], cast[cards[29].b]], games: cards[29].r.games, health: LEAGUE_HEALTH, tune: "ode", fresh: false }).title).toMatch(/^Ball League semi-final: /);
    expect(leagueCandidate({ card: cards[30].card, sides: [cast[cards[30].a], cast[cards[30].b]], games: cards[30].r.games, health: LEAGUE_HEALTH, tune: "ode", fresh: false }).title).toMatch(/^The Ball League final: /);
    // a match played from a fresh seed doesn't say it's from one drawn when the season began
    const fresh = leagueCandidate({ card: cards[11].card, sides: [cast[cards[11].a], cast[cards[11].b]], games: cards[11].r.games, health: LEAGUE_HEALTH, tune: "ode", fresh: true });
    expect(fresh.why[1]).toMatch(/new seed/);
    expect(fresh.facts[0]).not.toMatch(/seed drawn when the season began/);
    // its plain description says which season, and asks for a comment only where comments are on
    expect(plainDescription(round)).toBe("Season 1 of the Ball League. Every game is a real physics fight, and the table is real results. Who did you pick? Comment before the end.\n\n#shorts #ballleague #ballbattle");
    expect(plainDescription({ ...round, params: { ...round.params, allowComments: false } } as typeof round)).toBe("Season 1 of the Ball League. Every game is a real physics fight, and the table is real results.\n\n#shorts #ballleague #ballbattle");
  });

  it("no longer tells the title writer of an ordinary battle that nobody picks the winner", () => {
    const c = proposeBattle({ rand: rng(2), used: new Set() }, 1, 2)!;
    expect(c.facts[0]).toMatch(/Hookline ran 240 fights and this is the most exciting one\./);
    expect(c.facts.join(" ")).not.toMatch(/nobody picks/i);
    expect(formatName(c)).toBe("Ball battle");
  });
});

describe("the health table", () => {
  it("gives every power between 4% and 25% of the titles over 150 seasons", async () => {
    const rand = rng(31337);
    const seed = () => 1 + Math.floor(rand() * (2 ** 31 - 2));
    const titles = new Map<string, number>();
    for (let n = 0; n < 150; n++) {
      const c = makeCast(drawNames(rand), rand);
      const { champion } = await playOut(c, seed, rand);
      titles.set(c[champion].power, (titles.get(c[champion].power) ?? 0) + 1);
    }
    for (const p of ABILITY_IDS) {
      const share = (titles.get(p) ?? 0) / 150;
      expect(share, p).toBeGreaterThanOrEqual(0.04);
      expect(share, p).toBeLessThanOrEqual(0.25);
    }
  }, 180_000);
});

describe("a knockout's games in one Short", () => {
  const hp: [number, number] = [27, 27];
  const spec = (params: Partial<Extract<Spec, { format: "battle" }>["params"]>): Extract<Spec, { format: "battle" }> =>
    ({ format: "battle", params: { a: "heal", b: "bomb", seed: 5, hp, ending: "comment", ...params } });

  it("claims every game's fight, at the league's health, and gives a fight its health in its id only when it isn't the powers' own", () => {
    expect(fightId("spike", "sword", 4, [22, 20])).toBe("battle:spike:sword:4");
    expect(fightId("spike", "sword", 4)).toBe("battle:spike:sword:4");
    expect(fightId("spike", "sword", 4, [20, 20])).toBe("battle:spike:sword:4:20-20");
    expect(ledgerClaims(spec({ games: [5, 6, null, 8] }))).toEqual([5, 6, 8].map((s) => ({ item: fightId("heal", "bomb", s, hp) })));
    expect(ledgerClaims(spec({}))).toEqual([{ item: "battle:heal:bomb:5:27-27" }]);
  });

  it("lays its games end to end, gaps between them and cards in their place, then the ending, and sounds exactly as long", () => {
    const g = [5, 6, 7].map((s) => timeline(simulate("heal", "bomb", s, hp)).outroFrom);
    const three = spec({ games: [5, 6, 7] });
    expect(endFrom(three)).toBe(g[0] + GAP + g[1] + GAP + g[2]);
    expect(frames(three)).toBe(endFrom(three) + OUTRO);
    expect(series(three.params).games.map((x) => x.from)).toEqual([0, g[0] + GAP, g[0] + GAP + g[1] + GAP]);
    const carded = spec({ games: [5, 6, 7], cards: [1] });
    expect(endFrom(carded)).toBe(g[0] + GAP + CARD + g[2]);
    const fast = spec({ games: [5, 6, 7], speed: 1.5 });
    expect(endFrom(fast)).toBe([5, 6, 7].map((s) => timeline(simulate("heal", "bomb", s, hp), { speed: 1.5 }).outroFrom).reduce((x, y) => x + y) + 2 * GAP);
    for (const s of [three, carded, fast, spec({ games: [5, null] })]) expect(soundFor(s).length).toBe(Math.ceil((frames(s) / FPS) * RATE));
    // each game's own tune, from where it starts
    const sound = soundFor(three);
    const [first, second] = series(three.params).games;
    const tune = soundtrack(second.battle!, second.tl!, "ode");
    const at = (second.from / FPS) * RATE;
    expect(Array.from(sound.subarray(at, at + 2000))).toEqual(Array.from(tune.subarray(0, 2000)));
    expect(Array.from(sound.subarray(0, 2000))).toEqual(Array.from(soundtrack(first.battle!, first.tl!, "ode").subarray(0, 2000)));
    // one game is exactly the battle Short it always was, and its own health is the same fight
    const one = { format: "battle", params: { a: "heal", b: "bomb", seed: 5 } } as const;
    expect(endFrom(one)).toBe(timeline(simulate("heal", "bomb", 5)).outroFrom);
    expect(endFrom({ format: "battle", params: { ...one.params, hp: [18, 20] } })).toBe(endFrom(one));
    expect(soundFor({ format: "battle", params: { ...one.params, hp: [18, 20] } })).toEqual(soundFor(one));
  }, 30_000);

  it("knows where every frame falls: a game's fight, the gap after it, a card over the last game fought, or the ending", () => {
    const run = (winners: (Team | null)[]): SeriesRun => (_a, _b, seed) => fight(winners[seed - 1], 300);
    const r = run([1, null, 0, 0]);
    const p: SeriesOf = { a: "heal", b: "bomb", seed: 1, hp, games: [1, 2, 3, 4], cards: [1] };
    const s = series(p, r);
    const [g1, card, g3, g4] = s.games;
    const end1 = g1.tl!.outroFrom;
    expect(momentOf(s, 0)).toEqual({ kind: "fight", game: 0, shown: 0, local: 0 });
    expect(momentOf(s, end1 - 1)).toEqual({ kind: "fight", game: 0, shown: 0, local: end1 - 1 });
    expect(momentOf(s, end1)).toEqual({ kind: "gap", game: 0, shown: 0, local: end1 });
    // the card holds the first game as it finished, after its gap
    expect(card.from).toBe(end1 + GAP);
    expect(momentOf(s, card.from + 10)).toEqual({ kind: "card", game: 1, shown: 0, local: end1 + GAP + 10 });
    expect(momentOf(s, g3.from)).toEqual({ kind: "fight", game: 2, shown: 2, local: 0 });
    expect(momentOf(s, g4.from + 7)).toEqual({ kind: "fight", game: 3, shown: 3, local: 7 });
    expect(momentOf(s, s.endFrom)).toEqual({ kind: "end", game: 3, shown: 3, local: g4.tl!.outroFrom });
    expect(momentOf(s, s.endFrom + 20).local).toBe(g4.tl!.outroFrom + 20);
    // one game is the battle Short it always was: its fight, then its ending on its own frames
    const one = series({ a: "heal", b: "bomb", seed: 1, hp }, run([0]));
    expect(momentOf(one, 10)).toEqual({ kind: "fight", game: 0, shown: 0, local: 10 });
    expect(momentOf(one, one.endFrom + 5)).toEqual({ kind: "end", game: 0, shown: 0, local: one.endFrom + 5 });
  });

  it("says who won from the games: one game's winner or a draw, a knockout's last game, and the higher-placed ball after a semi-final of draws", () => {
    const run = (winners: (Team | null)[]): SeriesRun => (_a, _b, seed) => fight(winners[seed - 1], 300);
    const of = (winners: (Team | null)[]) => winnerOf(series({ a: "heal", b: "bomb", seed: 1, hp, ...(winners.length > 1 ? { games: winners.map((_, i) => i + 1) } : {}) }, run(winners)));
    expect(of([1])).toBe(1);
    expect(of([null])).toBeNull();
    expect(of([null, 1])).toBe(1);
    expect(of([1, null, 0, 0])).toBe(0);
    expect(of([null, null, null, null])).toBe(0);
    // a game the higher-placed ball took when the seeds ran out
    expect(winnerOf(series({ a: "heal", b: "bomb", seed: 1, hp, games: [1, 2, null] }, run([0, 1])))).toBe(0);
  });

  it("plays a long final faster, only as much as it needs, and past twice as fast shows drawn games after the first as cards", () => {
    // games of a minute each, the longest a fight runs
    const run = (winners: (Team | null)[]): SeriesRun => (_a, _b, seed) => fight(winners[seed - 1], 1739);
    const fits = (p: SeriesOf, r: SeriesRun) => series(p, r).endFrom + OUTRO <= LONGEST * FPS;
    expect(fitSpeed({ a: "heal", b: "bomb", seed: 1, hp }, run([0]))).toEqual({});
    // three decisive games: too long at real speed, so the lowest speed that fits
    const three: SeriesOf = { a: "heal", b: "bomb", seed: 1, hp, games: [1, 2, 3] };
    const r3 = run([0, 1, 0]);
    expect(fits(three, r3)).toBe(false);
    const fit = fitSpeed(three, r3);
    expect(fit.speed).toBeGreaterThan(1);
    expect(fit.speed).toBeLessThanOrEqual(2);
    expect(fit.cards).toBeUndefined();
    expect(fits({ ...three, speed: fit.speed }, r3)).toBe(true);
    expect(fits({ ...three, speed: Math.round((fit.speed! - 0.05) * 100) / 100 }, r3)).toBe(false);
    // nine games, seven of them drawn: even twice as fast is too long, so drawn games after the first are cards
    const nine: SeriesOf = { a: "heal", b: "bomb", seed: 1, hp, games: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
    const r9 = run([null, null, null, null, null, null, null, 0, 0]);
    expect(fits({ ...nine, speed: 2 }, r9)).toBe(false);
    const fit9 = fitSpeed(nine, r9);
    expect(fit9.cards).toEqual([1, 2, 3, 4, 5, 6]);
    expect(fits({ ...nine, ...fit9 }, r9)).toBe(true);
    // and every game that decided something still plays in full
    expect(series({ ...nine, ...fit9 }, r9).games.filter((g) => g.battle).map((g) => g.seed)).toEqual([1, 8, 9]);
  });
});

describe("the league in the app's words", () => {
  const at = new Date("2026-10-01T12:00:00Z");
  /** A league's view with its newest season as given, its table from `results`, and every match's Short waiting. */
  const viewOf = (season: Partial<ViewSeason>, results: Result[] = []): LeagueView => {
    const lots = slots;
    return {
      cast,
      seasons: [{ number: 2, status: "running", champion: null, startedAt: at, endedAt: null, stoppedReason: null, health: LEAGUE_HEALTH, lots, played: results.length, ...season }],
      table: table(results, lots),
      matches: results.map((r) => ({ number: r.number, stage: "round", round: 1, a: r.a, b: r.b, games: r.games, winner: r.winner, playedAt: at, short: "waiting", videoId: null })),
      records: [],
      finals: [],
    };
  };
  const channel = { name: "Volt Channel" };
  const own = { name: null };

  it("says where a season is: playing, paused, over, stopped, or about to begin", () => {
    const running = viewOf({}, [res(1, 0, 1, 0), res(2, 2, 3, null)]);
    expect(seasonLine(running, { getting: true, inLeague: true, who: channel })).toBe("Season 2. 2 of 31 matches played.");
    expect(seasonLine(running, { getting: false, inLeague: true, who: channel })).toBe("Paused. Volt Channel gets no new Shorts right now, so the season waits.");
    expect(seasonLine(viewOf({ status: "done", champion: 3, played: 31 }), { getting: true, inLeague: true, who: channel })).toBe(
      `Season 2 is over. ${cast[3].name} is the champion. Season 3 starts with this channel's next Shorts.`,
    );
    expect(seasonLine(viewOf({ status: "stopped", stoppedReason: "niche", played: 12 }), { getting: true, inLeague: false, who: channel })).toBe(
      "Season 2 stopped after 12 matches when this channel changed niche. Its results stay.",
    );
    expect(seasonLine(viewOf({ status: "stopped", stoppedReason: "niche", played: 1 }), { getting: true, inLeague: true, who: own })).toBe(
      "Season 2 stopped after 1 match when you changed what your Shorts are about. Its results stay. Season 3 starts with your next Shorts.",
    );
    expect(seasonLine(null, { getting: true, inLeague: true, who: channel })).toBe("Season 1 starts with this channel's next Shorts.");
  });

  it("puts a season in a line for the queue: who leads, who's top only on the tiebreaks, who finished top, and the champion", () => {
    expect(standingLine(viewOf({}), { inLeague: true, who: channel })).toBe("Ball League, season 2: no matches played yet.");
    const clear = viewOf({}, [res(1, 0, 1, 0), res(2, 2, 3, null)]);
    expect(standingLine(clear, { inLeague: true, who: channel })).toBe(`Ball League, season 2: 2 of 31 played. ${cast[0].name} leads on 3 points.`);
    // two level on points and wins: top on the tiebreaks, never said to lead
    const level = viewOf({}, [res(1, 0, 1, 0), res(2, 2, 3, 2)]);
    expect(standingLine(level, { inLeague: true, who: channel })).toBe(`Ball League, season 2: 2 of 31 played. ${cast[level.table[0].slot].name} is top on 3 points.`);
    const one = viewOf({}, [res(1, 0, 1, null)]);
    expect(standingLine(one, { inLeague: true, who: channel })).toMatch(/is top on 1 point\.$/);
    expect(standingLine(viewOf({ played: 29 }, [res(1, 0, 1, 0)]), { inLeague: true, who: channel })).toBe(`Ball League, season 2: 29 of 31 played. ${cast[0].name} finished top on 3 points.`);
    expect(standingLine(viewOf({ status: "done", champion: 5 }), { inLeague: true, who: channel })).toBe(`Ball League, season 2 is over. ${cast[5].name} is the champion.`);
    expect(standingLine(viewOf({ status: "stopped" }), { inLeague: true, who: own })).toBe("Ball League: season 3 starts with your next Shorts.");
    expect(standingLine(viewOf({ status: "stopped" }), { inLeague: false, who: channel })).toBeNull();
    expect(standingLine(null, { inLeague: true, who: channel })).toBe("Ball League: season 1 starts with this channel's next Shorts.");
  });

  it("says how each match went, a knockout's every game, and who plays a knockout before it's played only by place", () => {
    const m = (number: number, a: number | null, b: number | null, winner: number | null, games: Game[] | null) => ({ number, a, b, games, winner, playedAt: games ? at : null });
    const g = (winner: number | null, seed: number | null = 7): Game => ({ seed, winner, frame: 600, byTimeout: false, hp: [1, 1] });
    expect(matchLine(m(3, 0, 1, 1, [g(1)]), cast)).toBe(`${cast[1].name} beat ${cast[0].name}`);
    expect(matchLine(m(3, 0, 1, null, [g(null)]), cast)).toBe(`${cast[0].name} and ${cast[1].name} drew`);
    expect(matchLine(m(3, 0, 1, null, null), cast)).toBe(`${cast[0].name} v ${cast[1].name}`);
    expect([29, 30, 31].map((n) => matchLine(m(n, null, null, null, null), cast))).toEqual(["1st v 4th", "2nd v 3rd", "The semi-final winners"]);
    expect(matchLine(m(31, 2, 5, 2, [g(5), g(2), g(null), g(2)]), cast)).toBe(`${cast[2].name} beat ${cast[5].name} 2-1`);
    expect(matchLine(m(29, 2, 5, 2, [g(null), g(null), g(null), g(null)]), cast)).toBe(`${cast[2].name} went through on its table place after 4 draws with ${cast[5].name}`);
    expect(gameLines([g(5), g(null), g(2, null)], cast)).toEqual([`Game 1: ${cast[5].name}`, "Game 2: a draw", `Game 3: ${cast[2].name}, on its table place when the seeds ran out`]);
    expect([1, 28, 29, 30, 31].map(matchName)).toEqual(["Match 1", "Match 28", "Semi-final 1", "Semi-final 2", "The final"]);
  });

  it("gives each ball its record over every match of every season, stopped ones too, with its titles, the best first", () => {
    // season 1 played to the end (slot 0 beat 1, 2 and 3 drew, and 0 won the final against 2), season 2 stopped after 1 beat 0, season 3 playing
    const played = [{ a: 0, b: 1, winner: 0 }, { a: 2, b: 3, winner: null }, { a: 0, b: 2, winner: 0 }, { a: 1, b: 0, winner: 1 }, { a: 4, b: 5, winner: null }];
    const records = allTime(cast, played, [null, null, 0]);
    const of = (slot: number) => records.find((r) => r.slot === slot);
    expect(of(0)).toEqual({ slot: 0, won: 2, drawn: 0, lost: 1, titles: 1 });
    expect(of(1)).toEqual({ slot: 1, won: 1, drawn: 0, lost: 1, titles: 0 });
    expect(of(2)).toEqual({ slot: 2, won: 0, drawn: 1, lost: 1, titles: 0 });
    expect(of(7)).toEqual({ slot: 7, won: 0, drawn: 0, lost: 0, titles: 0 });
    // titles first, then wins, then draws, then the fewest defeats, then the cast's order
    expect(records.map((r) => r.slot)).toEqual([0, 1, 3, 4, 5, 2, 6, 7]);
    // every match counts once for each side
    expect(records.reduce((n, r) => n + r.won + r.drawn + r.lost, 0)).toBe(2 * played.length);
    expect(allTime(cast, [], [3, 3, null])[0]).toEqual({ slot: 3, won: 0, drawn: 0, lost: 0, titles: 2 });
  });

  it("lists every season that's over, newest first: its champion and how the final went, or how far it got before it stopped", () => {
    const g = (winner: number | null): Game => ({ seed: 7, winner, frame: 600, byTimeout: false, hp: [1, 1] });
    const season = (number: number, s: Partial<ViewSeason>) => ({ ...viewOf({}).seasons[0], number, ...s });
    const view: LeagueView = {
      ...viewOf({}),
      seasons: [
        season(4, { status: "running", played: 3 }),
        season(3, { status: "stopped", stoppedReason: "niche", played: 1 }),
        season(2, { status: "done", champion: 6, played: 31 }),
        season(1, { status: "stopped", stoppedReason: "niche", played: 12 }),
      ],
      finals: [{ season: 2, a: 5, b: 6, games: [g(5), g(null), g(6), g(6)], winner: 6 }],
    };
    const over = seasonsOver(view);
    expect(over).toEqual([
      { number: 3, champion: null, line: "Stopped after 1 match when the niche changed" },
      { number: 2, champion: 6, line: `Beat ${cast[5].name} 2-1 in the final` },
      { number: 1, champion: null, line: "Stopped after 12 matches when the niche changed" },
    ]);
    for (const s of over) expect(s.line).not.toMatch(/—/);
    // a league that has only ever had the season it's playing has no past to show yet
    expect(seasonsOver(viewOf({}))).toEqual([]);
  });

  it("says which match to post first only when the creator keeps more than one to post, across seasons too", () => {
    expect(orderHint([])).toBeNull();
    expect(orderHint([{ season: 2, number: 13 }])).toBeNull();
    expect(orderHint([{ season: 2, number: 13 }, { season: 2, number: 12 }])).toBe("Post Ball League matches in order: match 12 first.");
    expect(orderHint([{ season: 2, number: 31 }, { season: 2, number: 30 }])).toBe("Post Ball League matches in order: semi-final 2 first.");
    expect(orderHint([{ season: 3, number: 1 }, { season: 2, number: 31 }])).toBe("Post Ball League matches in order: season 2, the final first.");
  });

  it("never uses an em dash, never names money, and every state of a match's Short has its words", () => {
    const words = [LEAGUE_NOTE, WAITING_NOTE, ...Object.values(SHORT_STATE)];
    for (const w of words) {
      expect(w).not.toMatch(/—/);
      expect(w).not.toMatch(/\$|money|earn|coin/i);
    }
    // a knockout's drawn game is played again as a new fight, so the page never says nothing is played again
    expect(LEAGUE_NOTE).toMatch(/^Every game is one real fight, .* No fight is run twice or picked/);
    expect(LEAGUE_NOTE).not.toMatch(/Nothing is played again|Every match is one/);
    expect(Object.keys(SHORT_STATE).sort()).toEqual(["coming", "failed", "none", "posted", "skipped", "unplayed", "waiting"]);
    // a stopped season's matches that were never played won't be
    expect([shortWords("unplayed", false), shortWords("unplayed", true), shortWords("posted", true)]).toEqual(["Not played yet", "Not played", "Posted"]);
  });
});
