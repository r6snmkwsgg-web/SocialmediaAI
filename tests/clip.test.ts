import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AbilityId } from "@/lib/battle/abilities";
import { ARENA, FPS, rng, World, type BattleEvent, type Team } from "@/lib/battle/sim";
import { timeline } from "@/lib/battle/timeline";
import { PLANS } from "@/lib/billing/plans";
import {
  CLIP_BYTES, CLIP_INPUTS, CLIP_LENGTHS, CLIP_MIN_SCORE, CLIP_PEOPLE, CLIP_V, clipDrama, clipOutro, clipWindow, lastStep, packClip, playsFrom, replay, replaysExactly, withoutNames,
  type ClipDrama, type ClipInput, type ClipLog, type LiveFrame, type Replay, type RoundAround,
} from "@/lib/live/clip";
import { scriptedShow } from "@/lib/live/clip-demo";
import { canTryAgain, clipRules, showable, unmakeable } from "@/lib/live/clip-rules";
import type { BattleGame } from "@/lib/live/games/battle";
import { liveHp, liveOptions, liveResult, liveWorld } from "@/lib/live/games/battle";
import type { Viewer } from "@/lib/live/events";
import { Show } from "@/lib/live/show";
import type { LiveSettings } from "@/lib/live/settings";
import { fingerprint, RecordedWorld, type RoundTape, type TapeInput } from "@/lib/live/tape";
import { FORMATS, formatName, formatPlural } from "@/lib/shorts/formats";
import { clipCandidate, withNames } from "@/lib/shorts/formats/clip";
import { chooseFormats, formatsFor, odds, type Weight } from "@/lib/shorts/learn";
import { ENDS } from "@/lib/shorts/timing";
import { ENDINGS, FORMAT_IDS, SHORT_FORMATS, type Spec } from "@/lib/shorts/types";

/** the pinned round, a fresh copy each time, since a replay is kept per record */
const fixture = (): ClipLog => JSON.parse(readFileSync(new URL("./fixtures/clip-rivals.json", import.meta.url), "utf8"));
/** its fingerprint as it was when the fixture was recorded */
const PINNED = "b5c627cd";

/** the same events, with the names a live ball's drop-in carries and a replayed one doesn't */
const unnamed = (events: BattleEvent[]) => events.map((e) => (e.type === "summon" ? { ...e, name: undefined } : e));

/** what jsonb does to an object: its own key order, shortest first */
function jsonb(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonb);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)).map(([k, x]) => [k, jsonb(x)]));
  return v;
}

/** A round played straight into a recorded arena, with `act` reaching in before each step as viewers would, and its record as the game would send it. */
function recordRound(a: AbilityId, b: AbilityId, seed: number, fightMax: number, act: (w: World) => void): ClipLog {
  const world = liveOptions(fightMax), hp = liveHp(a, b);
  const w = liveWorld(a, b, seed, world, hp, true) as RecordedWorld;
  act(w);
  let result = null;
  while (!result) {
    w.tick();
    result = liveResult(w, fightMax);
    if (!result) act(w);
  }
  const inputs = w.inputs.map((x): ClipInput => (x[1] === "s" ? [x[0], x[1], x[2], x[3], x[4], x[5], -1] : x));
  const teams: ClipLog["teams"] = [{ name: "Red", color: "#FF3B30" }, { name: "Blue", color: "#0A84FF" }];
  return { v: CLIP_V, game: "battle", session: "7b6d1f9c-2f3e-4a5b-8c7d-1e2f3a4b5c6d", round: 1, at: Date.now(), seed, a, b, hp, world, fightMax, teams, inputs, moments: [], people: [], end: w.sub, result, check: fingerprint(w) };
}

const fan = (id: string, name: string): Viewer => ({ id: `tiktok-${id}`, name, avatar: `https://p16.example/${id}.jpg` });

/** One round of a show: `act` runs as the fight starts, then it plays to the knockout. What it kept, and the show. */
function oneRound(seed: number, settings: Partial<LiveSettings>, act: (s: Show) => void, hideNames = false): { show: Show; kept: ClipLog[] } {
  const show = new Show({ seed, settings: { vote: false, roundSeconds: 30, ...settings } });
  while (show.phase === "intro") show.update(0.1);
  act(show);
  for (let i = 0; i < 60 * 400 && show.phase === "play"; i++) show.update(1 / 60);
  return { show, kept: show.takeClips({ hideNames }) };
}

describe("recording a round", () => {
  it("plays a recorded arena exactly like a plain one, with the champions where the battle always put them", () => {
    const rules = liveOptions(90), hp = liveHp("spike", "sword");
    // the arena as the battle made it before rounds were recorded
    const before = new World(77, rules);
    before.add(0, "spike", ARENA * 0.27, ARENA * (0.42 + before.rand() * 0.16), { hp: hp[0], maxHp: hp[0] });
    before.add(1, "sword", ARENA * 0.73, ARENA * (0.42 + before.rand() * 0.16), { hp: hp[1], maxHp: hp[1] });
    const plain = liveWorld("spike", "sword", 77, rules, hp);
    const recorded = liveWorld("spike", "sword", 77, rules, hp, true);
    expect(plain).not.toBeInstanceOf(RecordedWorld);
    expect(recorded).toBeInstanceOf(RecordedWorld);
    const r = rng(5);
    for (let s = 0; s < 60 * 30; s++) {
      // the same viewers' doings on the same steps, in all three
      const x = r(), t = (s % 2) as Team;
      for (const w of [before, plain, recorded]) {
        if (x < 0.02) w.heal(t, 9);
        else if (x < 0.03) w.summon(t, t ? "sword" : "spike", { small: s % 3 === 0, hp: 40, tag: { id: "kai", name: "Kai" } });
        else if (x < 0.035) w.enrage(t, 8);
        else if (x < 0.04) w.protect(t, 6);
        else if (x < 0.045) w.meteor(t, 0, 0.3, 60);
        w.tick();
      }
    }
    expect(fingerprint(plain)).toBe(fingerprint(before));
    expect(fingerprint(recorded)).toBe(fingerprint(before));
    expect(recorded.frame()).toEqual(before.frame());
    // what it wrote down: the step each landed on, and whose ball, never a name or picture
    const inputs = (recorded as RecordedWorld).inputs;
    expect(inputs.length).toBeGreaterThan(50);
    expect(inputs.find((x) => x[1] === "s")).toEqual([expect.any(Number), "s", expect.any(Number), expect.any(String), expect.any(Number), 40, "kai"]);
    expect(JSON.stringify(inputs)).not.toContain("Kai");
  });

  it("plays a Ball Battle round from a real show back exactly: the same fingerprint, the same events and the same winner on the same step", () => {
    let rounds = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { show, kept } = scriptedShow("battle", seed);
      // five rounds of real viewers sending everything on the menu
      expect(["heal", "small", "ball", "rage", "shield", "meteor"].every((e) => show.lit.has(e))).toBe(true);
      for (const { log, events, step } of kept) {
        const back = replay(JSON.parse(JSON.stringify(log)));
        expect(back.exact).toBe(true);
        expect([back.steps, back.check, back.battle.winner]).toEqual([step, log.check, log.result.team]);
        expect(back.result).toEqual(log.result);
        expect(unnamed(back.battle.events)).toEqual(unnamed(events));
        rounds++;
      }
    }
    expect(rounds).toBeGreaterThanOrEqual(5);
  });

  it("plays Rivals rounds back exactly too, with each side's own gifts, other gifts by price and the vote picking the next rivalry", () => {
    const { show, kept } = scriptedShow("rivals", 1);
    expect(show.settings.vote).toBe(true);
    expect(["0:ball", "0:rage", "0:meteor", "1:ball", "1:rage", "1:meteor", "heal"].every((e) => show.lit.has(e))).toBe(true);
    expect(kept.length).toBeGreaterThanOrEqual(4);
    expect(new Set(kept.map((k) => k.log.rivalry?.id)).size).toBe(kept.length);
    for (const { log, events, step } of kept) {
      expect(log.a).toBe(log.b);
      const back = replay(JSON.parse(JSON.stringify(log)));
      expect([back.exact, back.steps, back.check]).toEqual([true, step, log.check]);
      expect(unnamed(back.battle.events)).toEqual(unnamed(events));
    }
  });

  it("still plays back after JSON and a jsonb-style round trip", () => {
    const log = fixture();
    const back = JSON.parse(JSON.stringify(jsonb(JSON.parse(JSON.stringify(log))))) as ClipLog;
    expect(Object.keys(back)).not.toEqual(Object.keys(log));
    expect(replay(back).exact).toBe(true);
    expect(replay(back).check).toBe(log.check);
  });

  it("holds no viewer ids, pictures, coin totals or gift names, and names only the people who sent gifts", () => {
    const [ann, bo, cy] = [fan("1001", "Ann"), fan("1002", "Bo"), fan("1003", "Cy")];
    let log: ClipLog | undefined;
    for (let seed = 1; seed <= 5 && !log; seed++) {
      log = oneRound(seed, {}, (s) => {
        s.join(ann, 0);
        s.join(bo, 1);
        s.join(cy, 1);
        // Cy only shares; Bo shares and gives
        s.handle({ kind: "share", viewer: cy });
        s.handle({ kind: "share", viewer: bo });
        s.handle({ kind: "gift", viewer: ann, gift: "Perfume", coins: 20, count: 2 });
        s.handle({ kind: "gift", viewer: bo, gift: "Finger Heart", coins: 5, count: 1 });
        s.handle({ kind: "gift", viewer: ann, gift: "Hand Hearts", coins: 100, count: 1 });
        s.handle({ kind: "gift", viewer: bo, gift: "Corgi", coins: 299, count: 1 });
      }).kept[0];
    }
    if (!log) throw new Error("no round was kept");
    expect(log.people).toEqual(["Ann", "Bo"]);
    const balls = log.inputs.filter((x) => x[1] === "s");
    // both shares' mini balls are nobody's, even Bo's; the gifts' balls are their gifters'
    expect(balls.map((x) => [x[5], x[6]])).toEqual([[0, -1], [0, -1], [20, 0], [20, 0], [5, 1]]);
    expect(log.moments.map((m) => m.slice(1))).toEqual([["rage", 0, 0, 1, 0], ["shield", 1, 1, 1, 0]]);
    const json = JSON.stringify(log);
    for (const never of ["tiktok-", "p16.example", "avatar", "coins", "Perfume", "Finger Heart", "Hand Hearts", "Corgi", "Cy"]) expect(json).not.toContain(never);
  });

  it("keeps no round a pretend viewer touched, one nothing real reached, one under 15 seconds, or one with the setting off", () => {
    const ann = fan("1001", "Ann"), bo = fan("1002", "Bo");
    const both = (s: Show) => {
      s.join(ann, 0);
      s.join(bo, 1);
      s.handle({ kind: "gift", viewer: ann, gift: "Hand Hearts", coins: 100, count: 1 });
      s.handle({ kind: "gift", viewer: bo, gift: "Hand Hearts", coins: 100, count: 1 });
    };
    // the same round with real viewers only is kept
    expect(oneRound(3, {}, both).kept).toHaveLength(1);
    // a pretend viewer's like in it
    const touched = oneRound(3, {}, (s) => {
      both(s);
      s.handle({ kind: "like", viewer: { id: "demo-1", name: "demo", pretend: true }, count: 60 });
    });
    expect(touched.kept).toHaveLength(0);
    expect(touched.show.stats.rounds).toBe(1);
    // a real viewer who only picked a side: the round counts, but nothing they did reached the arena
    const quiet = oneRound(3, {}, (s) => s.handle({ kind: "chat", viewer: ann, text: "1" }));
    expect([quiet.kept.length, quiet.show.stats.rounds]).toEqual([0, 1]);
    // a Universe ends it in seconds
    const short = oneRound(3, {}, (s) => {
      s.join(ann, 0);
      s.handle({ kind: "gift", viewer: ann, gift: "Universe", coins: 44_999, count: 3 });
    });
    expect(short.show.game.clock).toBeLessThan(15);
    expect([short.kept.length, short.show.stats.rounds]).toEqual([0, 1]);
    // clips off: nothing's even written down
    const off = oneRound(3, { clips: false }, both);
    expect(off.kept).toHaveLength(0);
    expect((off.show.game as BattleGame).tape()).toBeNull();
  });

  it("never keeps a Politics round, or a Ball Race or Last One Standing one", () => {
    const ann = fan("1001", "Ann"), bo = fan("1002", "Bo");
    // with Politics and one rivalry of their own, the rounds take turns
    const show = new Show({ seed: 8, settings: { game: "rivals", vote: false, roundSeconds: 30, rivals: { groups: ["politics"], own: [{ red: "Tacos", blue: "Burritos" }], gifts: null } } });
    const kept: ClipLog[] = [];
    let politics = 0;
    for (let round = 1; round <= 4; round++) {
      while (show.phase === "intro") show.update(0.1);
      if (show.teams[0].name === "Republicans") politics++;
      show.handle({ kind: "gift", viewer: ann, gift: "Sunglasses", coins: 199, count: 2 });
      show.handle({ kind: "gift", viewer: bo, gift: "Hearts", coins: 199, count: 2 });
      // played out, to the next round's countdown
      while (show.round === round) show.update(1 / 30);
      kept.push(...show.takeClips({ hideNames: false }));
    }
    expect(politics).toBe(2);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((l) => l.rivalry?.group === "own" && l.teams[0].name === "Tacos")).toBe(true);
    // the everyone-for-themselves games can't be played again exactly, so they're never written down
    for (const game of ["race", "royale"] as const) {
      const s = new Show({ seed: 4, settings: { game, vote: false } });
      for (let i = 0; i < 60 * 120; i++) {
        if (i % 60 === 0) s.handle({ kind: "gift", viewer: ann, gift: "Perfume", coins: 20, count: 1 });
        s.update(1 / 60);
      }
      expect(s.stats.rounds).toBeGreaterThan(0);
      expect(s.takeClips({ hideNames: false })).toHaveLength(0);
      expect(s.game.tape).toBeUndefined();
    }
  });

  it("keeps a round of 5,000 Roses under 128 KB, and doesn't keep one too busy to send", () => {
    const ann = fan("1001", "Ann"), bo = fan("1002", "Bo");
    const roses = (n: number) => (s: Show) => {
      s.join(ann, 0);
      s.join(bo, 1);
      for (let i = 0; i < n; i++) s.handle({ kind: "gift", viewer: i % 2 ? bo : ann, gift: "Rose", coins: 1, count: 1 });
    };
    const busy = oneRound(2, {}, roses(5000)).kept[0];
    expect(busy.inputs.length).toBeGreaterThanOrEqual(5000);
    expect(new TextEncoder().encode(JSON.stringify(busy)).length).toBeLessThanOrEqual(CLIP_BYTES);
    expect(replaysExactly(busy)).toBe(true);
    const over = oneRound(2, {}, roses(CLIP_INPUTS + 500));
    expect(over.show.stats.rounds).toBe(1);
    expect(over.kept).toHaveLength(0);
  });

  it("names at most 40 gifters, and the rest are nobody", () => {
    const log = fixture();
    const tape: RoundTape = { ...log, inputs: log.inputs.map((x): TapeInput => (x[1] === "s" ? [x[0], x[1], x[2], x[3], x[4], x[5], x[6] >= 0 ? `g${x[6]}` : null] : x)) };
    const many = Array.from({ length: 45 }, (_, i) => ({ id: `g${i}`, name: `Gifter ${i}` }));
    const around: RoundAround = { game: "rivals", session: log.session, round: 1, at: log.at, teams: log.teams, gifters: [...many.slice(10), ...many.slice(0, 10)], moments: [], result: log.result };
    const packed = packClip(tape, around)!;
    expect(packed.people).toHaveLength(CLIP_PEOPLE);
    // gifters 0 to 9 came last, so past the 40 named
    expect(packed.inputs.filter((x) => x[1] === "s" && x[6] >= 0).every((x) => x[1] === "s" && packed.people[x[6]].startsWith("Gifter "))).toBe(true);
    expect(packed.inputs.filter((x) => x[1] === "s").some((x) => x[1] === "s" && x[6] === -1)).toBe(true);
    expect(replaysExactly(packed)).toBe(true);
  });

  it("takes names out of a round with viewers' names hidden, and it still plays back exactly", () => {
    const log = fixture();
    const hidden = withoutNames(log);
    expect(hidden.people).toEqual([]);
    expect(hidden.inputs.every((x) => x[1] !== "s" || x[6] === -1)).toBe(true);
    expect(hidden.moments.every((m) => m[3] === -1)).toBe(true);
    expect(replay(hidden).check).toBe(log.check);
    expect(replaysExactly(hidden)).toBe(true);
    // the original is untouched
    expect(log.people.length).toBeGreaterThan(0);
  });

  it("hands each kept round over once, naming nobody in one taken while viewers' names are hidden", () => {
    const [ann, bo] = [fan("1001", "Ann"), fan("1002", "Bo")];
    const gifts = (s: Show) => {
      s.join(ann, 0);
      s.join(bo, 1);
      s.handle({ kind: "gift", viewer: ann, gift: "Perfume", coins: 20, count: 2 });
      s.handle({ kind: "gift", viewer: bo, gift: "Corgi", coins: 299, count: 1 });
    };
    let seed = 1;
    while (seed < 6 && !oneRound(seed, {}, gifts).kept.length) seed++;
    // the same round, taken with names shown and with them hidden
    const [named] = oneRound(seed, {}, gifts).kept;
    const { show, kept } = oneRound(seed, {}, gifts, true);
    const [hidden] = kept;
    expect(named.people).toEqual(["Ann", "Bo"]);
    expect(named.inputs.some((x) => x[1] === "s" && x[6] >= 0) && named.moments.some((m) => m[3] >= 0)).toBe(true);
    expect(hidden.people).toEqual([]);
    expect(hidden.inputs.every((x) => x[1] !== "s" || x[6] === -1)).toBe(true);
    expect(hidden.moments.every((m) => m[3] === -1)).toBe(true);
    // nothing else about the round changes, so it plays back the same
    expect([hidden.inputs, hidden.moments, hidden.check]).toEqual([withoutNames(named).inputs, withoutNames(named).moments, named.check]);
    expect(replaysExactly(hidden)).toBe(true);
    // and it's gone once taken
    expect(show.takeClips({ hideNames: false })).toEqual([]);
  });
});

describe("playing a round back", () => {
  it("still plays the pinned round back to its fingerprint, so a change to how rounds play shows here first", () => {
    const log = fixture();
    expect(log.check).toBe(PINNED);
    const r = replay(log);
    expect(r.exact).toBe(true);
    expect([r.check, r.steps, r.result]).toEqual([PINNED, log.end, log.result]);
    // asked again, it's the same replay, not another run
    expect(replay(log)).toBe(r);
  });

  it("notices one input changed, moved a step or left out", () => {
    const log = fixture();
    // heals and meteors spread through the round
    const picks = log.inputs.map((x, i) => ({ x, i })).filter(({ x, i }) => (x[1] === "h" || x[1] === "m") && i % 40 === 0);
    expect(picks.length).toBeGreaterThanOrEqual(8);
    const broken = (change: (l: ClipLog) => void) => {
      const l = fixture();
      change(l);
      const r = replay(l);
      return !r.exact && (r.check !== log.check || r.steps !== log.end);
    };
    for (const { x, i } of picks) {
      expect(broken((l) => ((l.inputs[i] as unknown as number[])[x[1] === "h" ? 3 : 5] += 1)), `amount ${i}`).toBe(true);
      expect(broken((l) => l.inputs.splice(i, 1)), `drop ${i}`).toBe(true);
      // moved a step, keeping the record in order
      const next = log.inputs[i + 1];
      if (!next || next[0] > x[0] + 1) expect(broken((l) => (l.inputs[i][0] += 1)), `move ${i}`).toBe(true);
    }
  });

  it("stops at the first decision, never past the round's time limit, whatever the record says", () => {
    // kept alive to the end of a 30-second round, so time decides it
    const timed = recordRound("heal", "grow", 9, 30, (w) => {
      if (w.sub % 60 === 0) for (const t of [0, 1] as Team[]) w.heal(t, 30);
    });
    expect([timed.end, timed.result.byTime]).toEqual([lastStep(30), true]);
    expect(replaysExactly(timed)).toBe(true);
    const late = { ...timed, end: timed.end + 500 };
    expect(replay(late)).toMatchObject({ exact: false, steps: lastStep(30) });
    // a record claiming a round far longer than any can run
    const endless = { ...timed, fightMax: 300, world: liveOptions(300), inputs: [], end: 10 ** 9 };
    expect(replay(endless).steps).toBeLessThanOrEqual(lastStep(300));
    expect(lastStep(300)).toBe(18_001);
    // and one the game would never send can't break it
    expect(replaysExactly({ ...timed, a: "laser" as AbilityId })).toBe(false);
  });

  it("plays a 300-second round with both sides full back within 18,001 steps", async ({ annotate }) => {
    const longest = recordRound("sword", "sword", 42, 300, (w) => {
      if (w.sub % 60 === 0) for (const t of [0, 1] as Team[]) while (w.count(t) < w.maxTeam) w.summon(t, "sword", { small: false, hp: 5000 });
    });
    const t0 = performance.now();
    const r = replay(longest);
    const ms = Math.round(performance.now() - t0);
    expect([r.exact, r.steps]).toEqual([true, 18_001]);
    await annotate(`replayed a 300-second round with both sides full in ${ms} ms`);
  });
});

describe("what's worth a Short", () => {
  /** A replay made by hand: each frame's health for red and blue, and how it ended. */
  const score = (hp: [number, number][], o: { team: Team | null; byTime?: boolean; saved?: number; big?: number[] }): ClipDrama => {
    const frames = hp.map((h) => ({ hp: h, owed: [0, 0] }) as unknown as LiveFrame);
    const events: BattleEvent[] = o.saved === undefined ? [] : [{ f: o.saved, type: "saved", x: 0, y: 0, team: 1 }];
    const r = { battle: { endFrame: hp.length - 1, events }, frames, result: { team: o.team, byTime: o.byTime ?? false }, hp: hp.at(-1), exact: true } as unknown as Replay;
    const log = { moments: (o.big ?? []).map((f) => [f * 2, "meteor", 0, -1, 1, 1]) } as unknown as ClipLog;
    return clipDrama(r, log, 0);
  };
  /** 20 seconds where red's and blue's health go from one value to the next in straight lines */
  const curve = (...points: [number, number][]): [number, number][] => {
    const n = 20 * FPS, out: [number, number][] = [];
    for (let f = 0; f < n; f++) {
      const p = (f / (n - 1)) * (points.length - 1), i = Math.min(points.length - 2, Math.floor(p)), k = p - i;
      out.push([points[i][0] + (points[i + 1][0] - points[i][0]) * k, points[i][1] + (points[i + 1][1] - points[i][1]) * k]);
    }
    return out;
  };

  it("scores a comeback, a save, a big gift and a close finish, and draws and time-outs lower", () => {
    // red stays strong while blue melts away
    const oneSided = curve([100, 100], [100, 0]);
    const plain = score(oneSided, { team: 0 });
    expect(plain).toMatchObject({ score: 0, leads: 0, comeback: false, save: false, big: 0, close: false });
    // one big gift in a one-sided round isn't enough
    const gift = score(oneSided, { team: 0, big: [300] });
    expect([gift.big, gift.score]).toEqual([1, 1]);
    expect(gift.score).toBeLessThan(CLIP_MIN_SCORE);
    // red falls under a third of the arena's health, then wins: a comeback, and the lead changed on the way
    const back = score(curve([100, 100], [20, 70], [100, 0]), { team: 0 });
    expect(back).toMatchObject({ comeback: true, leads: 1 });
    expect(back.score).toBeGreaterThan(plain.score);
    // with one big gift, it's worth a Short
    expect(score(curve([100, 100], [20, 70], [100, 0]), { team: 0, big: [300] }).score).toBeGreaterThanOrEqual(CLIP_MIN_SCORE);
    // a side hanging on, paid off
    expect(score(oneSided, { team: 0, saved: 200 })).toMatchObject({ save: true, score: 3 });
    // red wins on a quarter of the most it had
    const close = score(curve([100, 100], [20, 0]), { team: 0 });
    expect(close).toMatchObject({ close: true, comeback: false, leads: 0, score: 2 });
    // a save with a close finish is worth a Short, and so are two lead changes
    expect(score(curve([100, 100], [20, 0]), { team: 0, saved: 200 }).score).toBeGreaterThanOrEqual(CLIP_MIN_SCORE);
    const swings = score(curve([100, 60], [60, 100], [100, 0]), { team: 0 });
    expect(swings).toMatchObject({ leads: 2, score: 4 });
    // decided on time, even close to even, scores lower; called a draw, lower still
    const time = score(curve([100, 60], [60, 100], [100, 70]), { team: 0, byTime: true });
    expect(time).toMatchObject({ leads: 2, close: true });
    expect(time.score).toBe(swings.score + 2 - 3);
    expect(score(curve([100, 60], [60, 100], [100, 0]), { team: null }).score).toBe(swings.score - 6);
  });

  it("shows the whole fight at 15 to 40 seconds, otherwise the best 20 to 40 seconds ending on the result, 18.2 to 45.2 seconds in all", () => {
    const logs = [fixture(), ...scriptedShow("battle", 1).kept.map((k) => k.log), ...scriptedShow("rivals", 3).kept.map((k) => k.log)];
    let whole = 0, cut = 0;
    for (const log of logs) {
      const r = replay(log);
      const w = clipWindow(r, log)!;
      const frames = r.battle.endFrame + 1;
      if (frames <= 40 * FPS) {
        expect(w.from).toBe(0);
        whole++;
      } else {
        const starts = CLIP_LENGTHS.map((s) => frames - s * FPS);
        expect(starts).toContain(w.from);
        // no other cut scores higher, and a tie goes to the shorter one
        for (const from of starts) {
          const d = clipDrama(r, log, from);
          expect(d.score).toBeLessThanOrEqual(w.drama.score);
          if (d.score === w.drama.score) expect(from).toBeLessThanOrEqual(w.from);
        }
        expect(w.from).toBeGreaterThanOrEqual(r.first);
        cut++;
      }
      for (const ending of ENDINGS) {
        const seconds = (clipOutro(log.end, w.from, log.result.byTime) + ENDS.clip[ending]) / FPS;
        expect(seconds).toBeGreaterThanOrEqual(18.2);
        expect(seconds).toBeLessThanOrEqual(45.2);
      }
      // from the start, the outro lands where the battle video's own timeline puts it
      expect(clipOutro(log.end, 0, log.result.byTime)).toBe(timeline(r.battle).outroFrom);
    }
    expect([whole, cut].every((n) => n > 0)).toBe(true);
    // a fight under 15 seconds is never a clip
    const short = recordRound("spike", "sword", 4, 90, (w) => {
      if (w.sub === 0) w.meteor(0, 0, 0, 500);
    });
    expect(short.end).toBeLessThan(15 * 60);
    expect(replaysExactly(short)).toBe(true);
    expect(clipWindow(replay(short), short)).toBeNull();
  });
});

describe("Hookline's rules for a round", () => {
  const battle = () => scriptedShow("battle", 3).kept[0].log;

  it("turns away sides that set people against each other, rivalries it doesn't have, Politics, and arenas the game wouldn't use", () => {
    const at = fixture().at;
    const rivals = (change: (l: ClipLog) => void) => {
      const l = fixture();
      change(l);
      return clipRules(l, at);
    };
    expect(rivals(() => {})).toBeNull();
    expect(clipRules(battle())).toBeNull();
    // a rivalry renamed, made up, or Politics
    expect(rivals((l) => (l.teams[1].name = "Atletico"))).toContain("Hookline's rivalries");
    expect(rivals((l) => (l.rivalry = { id: "real-atletico", group: "sports" }))).toContain("Hookline's rivalries");
    expect(rivals((l) => (l.rivalry = { id: "madrid-barca", group: "cars" }))).toContain("Hookline's rivalries");
    expect(rivals((l) => {
      l.rivalry = { id: "republicans-democrats", group: "politics" };
      l.teams = [{ name: "Republicans", color: "#FF3B30" }, { name: "Democrats", color: "#0A84FF" }];
    })).toContain("Politics");
    // a streamer's own passes the same check as their saved settings
    const own = (red: string, blue: string) => rivals((l) => {
      l.rivalry = { id: "own-0", group: "own" };
      l.teams = [{ name: red, color: "#FF3B30" }, { name: blue, color: "#0A84FF" }];
    });
    expect(own("Tacos", "Burritos")).toBeNull();
    expect(own("Christians", "Muslims")).toContain("religion");
    expect(rivals((l) => {
      l.b = "spike";
      l.hp = liveHp(l.a, l.b);
    })).toContain("same champion");
    // Ball Battle's own team names, the same way
    const named = battle();
    named.teams[0].name = "Israel";
    named.teams[1].name = "Palestine";
    expect(clipRules(named)).toContain("religion");
    // an arena or champions the live game wouldn't give a round
    expect(rivals((l) => (l.world.hangOn = 0))).toContain("arena");
    expect(rivals((l) => (l.world.suddenDeath += 1))).toContain("arena");
    expect(rivals((l) => (l.fightMax = 120))).toContain("arena");
    expect(rivals((l) => (l.hp[1] += 1))).toContain("health");
  });

  it("wants a round from the game played in the last day, and lets a clip made from it days later through", () => {
    const log = fixture();
    expect(clipRules(log, log.at + 23 * 3600_000)).toBeNull();
    expect(clipRules(log, log.at + 25 * 3600_000)).toContain("last day");
    expect(clipRules(log, log.at - 4 * 60_000)).toBeNull();
    expect(clipRules(log, log.at - 6 * 60_000)).toContain("last day");
    // checked again before it's rendered, which can be days after the LIVE
    expect(clipRules(log)).toBeNull();
  });

  it("shows only names it can read that don't name people for who they are", () => {
    for (const n of ["Kai", "mia.plays", "Sofi B", "lucas_0", "Zoë", "Big Ben", "Real Madrid fan"]) expect(showable(n), n).toBe(true);
    for (const n of ["Россия", "ミア", "الهند", "🔥🔥", "💕", "Kai 🔥", "", "   "]) expect(showable(n), n).toBe(false);
    for (const n of ["Muslims", "Team Israel", "the Jews", "Mexicans"]) expect(showable(n), n).toBe(false);
  });
});

describe("what the server takes", () => {
  it("takes a round just as the game keeps it, and nothing outside what the game could send", async () => {
    const { clipSchema, clipUpload } = await import("@/lib/server/clips");
    const log = fixture();
    const back = clipSchema.safeParse(log);
    expect(back.success && back.data).toEqual(log);
    for (const { log: kept } of scriptedShow("battle", 3).kept) expect(clipSchema.safeParse(JSON.parse(JSON.stringify(kept))).success).toBe(true);
    // with names hidden it names nobody, and a name can be as long as a record keeps one, in any letters
    expect(clipSchema.safeParse(withoutNames(log)).success).toBe(true);
    expect(clipSchema.safeParse({ ...log, people: log.people.map(() => "🔥".repeat(32)) }).success).toBe(true);
    const takes = (change: (l: ClipLog) => void) => {
      const l = fixture();
      change(l);
      return clipSchema.safeParse(l).success;
    };
    const ball = log.inputs.findIndex((x) => x[1] === "s");
    const heal = log.inputs.findIndex((x) => x[1] === "h");
    expect(ball >= 0 && heal >= 0 && log.moments.length > 0).toBe(true);
    const never: [string, (l: ClipLog) => void][] = [
      ["an end past its time limit", (l) => (l.end = lastStep(l.fightMax) + 1)],
      ["a fight under 15 seconds", (l) => (l.end = 899)],
      ["a round longer than the settings allow", (l) => (l.fightMax = 301)],
      ["another record version", (l) => ((l as { v: number }).v = 2)],
      ["a game that can't be played back", (l) => ((l as { game: string }).game = "race")],
      ["a session that isn't one", (l) => (l.session = "session-1")],
      ["round 0", (l) => (l.round = 0)],
      ["a time no date can hold", (l) => (l.at = 9e15)],
      ["a time after the year 9999", (l) => (l.at = 253_402_300_800_000)],
      ["a seed out of range", (l) => (l.seed = 2 ** 31)],
      ["a champion the LIVE games don't use", (l) => (l.a = "fibonacci")],
      ["a champion with no health", (l) => (l.hp = [0, l.hp[1]])],
      ["a side with no name", (l) => (l.teams[0].name = "")],
      ["a side's name too long for the screen", (l) => (l.teams[1].name = "Thirteen chrs")],
      ["a colour that isn't one", (l) => (l.teams[0].color = "red")],
      ["inputs out of order", (l) => (l.inputs[heal + 1][0] = l.inputs[heal][0] - 1)],
      ["an input after the end", (l) => (l.inputs[l.inputs.length - 1][0] = l.end + 1)],
      ["a ball for someone it doesn't name", (l) => ((l.inputs[ball] as unknown as number[])[6] = l.people.length)],
      ["a heal of nothing", (l) => ((l.inputs[heal] as unknown as number[])[3] = 0)],
      ["a heal past any gift", (l) => ((l.inputs[heal] as unknown as number[])[3] = 10_000_001)],
      ["an input with more in it", (l) => (l.inputs[heal] as unknown as number[]).push(1)],
      ["an input the arena doesn't take", (l) => ((l.inputs[heal] as unknown as string[])[1] = "x")],
      ["a big gift from someone it doesn't name", (l) => (l.moments[0][3] = l.people.length)],
      ["a big gift bigger than any", (l) => ((l.moments[0] as unknown as number[])[5] = 3)],
      ["more than 40 people", (l) => (l.people = Array.from({ length: 41 }, (_, i) => `fan${i}`))],
      ["a name longer than a record keeps", (l) => (l.people[0] = "x".repeat(33))],
      ["more than 6,000 inputs", (l) => (l.inputs = Array.from({ length: CLIP_INPUTS + 1 }, (): ClipInput => [0, "h", 0, 1]))],
      ["a fingerprint that isn't one", (l) => (l.check = "b5c627c")],
    ];
    for (const [what, change] of never) expect(takes(change), what).toBe(false);
    // the game's key, as its address carries it
    expect(clipUpload.safeParse({ key: "k".repeat(32), clip: log }).success).toBe(true);
    for (const key of ["short", "k".repeat(65), "has spaces in it....."]) expect(clipUpload.safeParse({ key, clip: log }).success, key).toBe(false);
  });

  it("keeps no rounds in a game opened without a streamer's own settings, which could never send them", async () => {
    const { default: LivePlay } = await import("@/app/live/play/page");
    for (const q of [{}, { demo: "1" }, { game: "rivals", demo: "1" }, { src: "bridge" }]) {
      const page = await LivePlay({ searchParams: Promise.resolve(q) });
      expect(page.props.settings.clips, JSON.stringify(q)).toBe(false);
      expect(page.props.overlayKey).toBeUndefined();
    }
  });
});

describe("a round as a Short", () => {
  it("is never drawn by the format picker, however well clips do", () => {
    expect(FORMAT_IDS).not.toContain("clip");
    expect(SHORT_FORMATS).toEqual([...FORMAT_IDS, "clip"]);
    expect(Object.keys(FORMATS)).not.toContain("clip");
    expect(formatsFor({ textStories: true })).not.toContain("clip");
    const weights: Weight[] = [{ kind: "format", name: "clip", score: 20, samples: 40 }];
    const o = odds(weights);
    expect(Object.keys(o).sort()).toEqual([...FORMAT_IDS].sort());
    for (let seed = 1; seed < 40; seed++) expect(chooseFormats(5, o, rng(seed))).not.toContain("clip");
  });

  it("is called From your LIVE wherever the app names a Short's kind", () => {
    expect(formatName({ format: "clip" })).toBe("From your LIVE");
    expect(formatPlural({ format: "clip" })).toBe("rounds from your LIVEs");
    for (const f of FORMAT_IDS) expect([formatName({ format: f }), formatPlural({ format: f })]).toEqual([FORMATS[f].name, FORMATS[f].plural]);
  });

  it("says which round of which LIVE it is, what happened in it, and what it counts as", () => {
    const log = fixture();
    const r = replay(log);
    // played on a Saturday evening in London, when it's already Sunday in Tokyo
    const played_at = new Date("2026-10-17T19:30:00Z");
    const pro = clipCandidate({ log, played_at }, r, { tz: "Europe/London", per: PLANS.pro.shorts, rand: rng(1) })!;
    const cut = clipWindow(r, log)!;
    expect(pro).toMatchObject({ format: "clip", key: "clip:rivals", score: cut.drama.score });
    expect(pro.params).toMatchObject({ log, from: cut.from });
    if (pro.format !== "clip") throw new Error();
    // the same record, not a copy, so the replay already made is the one the player uses
    expect(pro.params.log).toBe(log);
    expect(pro.why[0]).toBe(`Round ${log.round} of your LIVE on Saturday`);
    expect(pro.why[1]).toMatch(/^(\d+ lead changes?|A comeback|A save|\d+ big gifts?|A close finish)/);
    expect(pro.why[2]).toBe("It counts as one of today's Shorts");
    const free = clipCandidate({ log, played_at }, r, { tz: "Asia/Tokyo", per: PLANS.free.shorts, rand: rng(1) })!;
    expect(free.why[0]).toBe(`Round ${log.round} of your LIVE on Sunday`);
    expect(free.why[2]).toBe("It counts as one of this week's 3 Shorts");
    // a record that doesn't play back exactly is never a Short
    const broken = fixture();
    broken.inputs.splice(10, 1);
    expect(clipCandidate({ log: broken, played_at }, replay(broken), { tz: "UTC", per: PLANS.pro.shorts, rand: rng(1) })).toBeNull();
  });

  it("shows gifters' names or not, keeping the same record so the round isn't played again", () => {
    const log = fixture();
    const spec: Spec = { format: "clip", params: { log, from: 0 } };
    const on = withNames(spec, true);
    if (on.format !== "clip") throw new Error();
    expect(on.params.names).toBe(true);
    expect(on.params.log).toBe(log);
    expect(withNames(on, false)).toMatchObject({ params: { names: false } });
    const quiz: Spec = { format: "quiz", params: { questions: [] } };
    expect(withNames(quiz, true)).toBe(quiz);
  });

  it("starts only where its replay kept frames, at most 40 seconds before the result", () => {
    const log = fixture();
    const r = replay(log);
    const cut = clipWindow(r, log)!;
    expect(playsFrom(r, cut.from)).toBe(true);
    expect(playsFrom(r, r.first)).toBe(true);
    expect(playsFrom(r, r.first - 1)).toBe(false);
    expect(playsFrom(r, r.battle.endFrame + 1)).toBe(false);
    expect(playsFrom(r, cut.from + 0.5)).toBe(false);
    expect(r.battle.endFrame + 1 - r.first).toBeLessThanOrEqual(40 * FPS);
    const broken = fixture();
    broken.check = "00000000";
    expect(playsFrom(replay(broken), cut.from)).toBe(false);
  });

  it("is made into a video only while it keeps the rules, plays back exactly from its cut, and names nobody unless names are on", () => {
    const log = fixture();
    const r = replay(log);
    const cut = clipWindow(r, log)!;
    const rules = "This LIVE round breaks Hookline's rules, so it can't be made.";
    const exact = "This LIVE round no longer plays back exactly as it happened, so it can't be made.";
    // as approved with names on, and with names off once they've been let go of
    expect(unmakeable({ log, from: cut.from, names: true })).toBeNull();
    expect(unmakeable({ log: { ...log, people: [] }, from: cut.from })).toBeNull();
    // names still in a round that doesn't show them, and a round Hookline wouldn't run
    expect(unmakeable({ log, from: cut.from })).toBe(rules);
    expect(unmakeable({ log: { ...log, rivalry: { id: "republicans-democrats", group: "politics" } }, from: cut.from, names: true })).toBe(rules);
    // a cut that starts before the frames its replay kept, after the result, or between frames
    for (const from of [r.first - 1, r.battle.endFrame + 1, cut.from + 0.5]) expect(unmakeable({ log, from, names: true }), String(from)).toBe(exact);
    // a record that no longer plays back the way it went, or one from before a change to how rounds play
    const off = fixture();
    off.inputs.splice(10, 1);
    expect(unmakeable({ log: off, from: cut.from, names: true })).toBe(exact);
    expect(unmakeable({ log: { ...fixture(), v: 2 } as unknown as ClipLog, from: cut.from, names: true })).toBe(exact);
  });

  it("is offered another try after failing only while it can still be made", () => {
    const log = fixture();
    const from = clipWindow(replay(log), log)!.from;
    const never: Spec = { format: "clip", params: { log: { ...fixture(), v: 2 } as unknown as ClipLog, from, names: true } };
    expect(canTryAgain({ format: "clip", params: { log, from, names: true } }, false)).toBe(true);
    // one that would only fail again isn't, unless it was made and only has to go up again
    expect(canTryAgain(never, false)).toBe(false);
    expect(canTryAgain(never, true)).toBe(true);
    // any other Short always is
    expect(canTryAgain({ format: "quiz", params: { questions: [] } }, false)).toBe(true);
  });
});

describe.skipIf(!process.env.CHROME_PATH)("in a browser", () => {
  it("plays the pinned round and fresh ones back in headless Chromium exactly as Node does, both ways", async () => {
    const { replayCheck } = await import("../scripts/replay-check");
    const { checks } = await replayCheck();
    expect(checks.length).toBeGreaterThan(5);
    for (const c of checks) expect(c.same, c.what).toBe(true);
  }, 180_000);
});
