import { describe, expect, it } from "vitest";
import { ABILITY_IDS } from "@/lib/battle/abilities";
import { rng } from "@/lib/battle/sim";
import { MELODIES } from "@/lib/battle/sound";
import { timeline } from "@/lib/battle/timeline";
import { PLANS } from "@/lib/billing/plans";
import { replay } from "@/lib/live/clip";
import { demoClip } from "@/lib/live/clip-demo";
import { clipCandidate } from "@/lib/shorts/formats/clip";
import { doubleCheck, freshPairs, freshQuestions, freshStories, type Ask } from "@/lib/server/shorts/fresh";
import { plainDescription } from "@/lib/server/shorts/titles";
import { isSum, kidCoded, normal, pairProblem, questionProblem, sameThing, storyProblem, textId, unsafe, words, wordsId } from "@/lib/shorts/checks";
import { bankIds, contentIds, finish, FORMATS, ledgerClaims, ledgerIds } from "@/lib/shorts/formats";
import { fightId, matchupId, MELODY_IDS, proposeBattle } from "@/lib/shorts/formats/battle";
import { bankQuestions, CAPITALS, dataCapitals, FACTS, proposeQuiz, sum, sumIds } from "@/lib/shorts/formats/quiz";
import { raceOutcomeId } from "@/lib/shorts/formats/race";
import { rankingOrderId } from "@/lib/shorts/formats/ranking";
import { STORIES } from "@/lib/shorts/formats/texts";
import { bankPairs, PAIRS, proposeWyr } from "@/lib/shorts/formats/wyr";
import { chooseFormats, dryNote, formatsFor, odds } from "@/lib/shorts/learn";
import { backdropLayer, BACKDROPS, BASE_LOOKS, contrast, DIFFERENT_LOOKS, HOOKLINE, lookNumber, PALETTES, ROUNDS, textOn, TYPES, type Look } from "@/lib/shorts/look";
import { soundFor } from "@/lib/shorts/sound";
import { BACK, endFrom, endingOf, ENDS, FPS, frames, QUIZ, RACE, RANKING, TITLE, WYR } from "@/lib/shorts/timing";
import { ENDINGS, FORMAT_IDS, type Candidate, type Fact, type Spec } from "@/lib/shorts/types";

/**
 * The content engine: nothing goes to two channels, what's written is
 * checked, nothing's aimed at young kids, every channel has its own look,
 * and every Short opens on the action and ends one of a few ways.
 */

const ctx = (seed: number, used: string[] = []) => ({ rand: rng(seed), used: new Set(used) });
const spec = (c: Candidate) => ({ format: c.format, params: c.params }) as Spec;

describe("each channel's look", () => {
  it("reads well in every palette: text, answers, choices and labels", () => {
    for (const [i, p] of PALETTES.entries()) {
      expect(contrast(p.text, p.bg), `${i} text`).toBeGreaterThanOrEqual(7);
      expect(contrast(p.text, p.panel), `${i} text on a box`).toBeGreaterThanOrEqual(7);
      expect(contrast(p.text, p.raised), `${i} messages`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.dim, p.bg), `${i} small print`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.dim, p.panel), `${i} small print on a box`).toBeGreaterThanOrEqual(4.5);
      for (const c of [p.accent, p.good, p.gold]) expect(contrast(c, p.bg), `${i} ${c}`).toBeGreaterThanOrEqual(3);
      for (const c of [p.a, p.b, p.good, p.accent]) expect(contrast(textOn(c), c), `${i} text on ${c}`).toBeGreaterThanOrEqual(3);
      expect(contrast(p.line, p.bg), `${i} lines`).toBeGreaterThan(1.2);
    }
  });

  it("gives every number its own look: neighbours differ in everything, and nothing drawn repeats", () => {
    expect(lookNumber(0)).toEqual(HOOKLINE);
    expect(BASE_LOOKS).toBe(PALETTES.length * TYPES.length * BACKDROPS.length * ROUNDS.length);
    // what's drawn: the colours, the type, the corners and what's behind it all, not the look's number or its tilt
    const drawn = (l: Look) => JSON.stringify([l.bg, l.panel, l.raised, l.line, l.text, l.dim, l.accent, l.good, l.gold, l.a, l.b, l.face, l.caps, l.round, backdropLayer(l)]);
    const seen = new Map<string, number>();
    for (let n = 0; n < DIFFERENT_LOOKS; n++) {
      const key = drawn(lookNumber(n));
      expect(seen.get(key), `look ${n}`).toBeUndefined();
      seen.set(key, n);
    }
    // past the first 330, even a plain backdrop turns: Hookline's own look is never handed out again
    expect(lookNumber(BASE_LOOKS).backdrop).toBe("plain");
    expect(backdropLayer(HOOKLINE)).toBeNull();
    expect(backdropLayer(lookNumber(BASE_LOOKS))).not.toBeNull();
    // and a grid turned a quarter of the way round is drawn as the same grid, so it can't pass for a new one
    const grid = lookNumber(1);
    expect(backdropLayer({ ...grid, tilt: 127 })).toEqual(backdropLayer({ ...grid, tilt: 37 }));
    const [a, b] = [lookNumber(41), lookNumber(42)];
    expect(a.bg).not.toBe(b.bg);
    expect(`${a.face}${a.caps}`).not.toBe(`${b.face}${b.caps}`);
    expect(a.backdrop).not.toBe(b.backdrop);
    expect(a.round).not.toBe(b.round);
  });

  it("goes in the Short, so it renders the way it was approved", () => {
    const look = lookNumber(7);
    const c = finish(FORMATS.wyr.propose(ctx(3))!, { look, ending: "loop" });
    expect(c.params.look).toEqual(look);
    expect(c.params.ending).toBe("loop");
  });
});

describe("openings and endings", () => {
  it("starts four formats on the action, with the title over it rather than before it", () => {
    for (const intro of [QUIZ.intro, WYR.intro, RANKING.intro, RACE.intro]) expect(intro / FPS).toBeLessThanOrEqual(0.5);
    expect(TITLE / FPS).toBeGreaterThan(1);
    expect(TITLE / FPS).toBeLessThanOrEqual(2);
  });

  it.each(FORMAT_IDS)("%s can end on a comment, loop back to the start, or end quietly, each a Short's length", (f) => {
    const base = FORMATS[f].propose(ctx(4))!;
    const lengths = ENDINGS.map((ending) => {
      const s = spec(finish(base, { ending }));
      const secs = frames(s) / FPS;
      expect(secs).toBeGreaterThan(15);
      expect(secs).toBeLessThan(60);
      expect(frames(s) - endFrom(s)).toBe(ENDS[f][ending]);
      // the soundtrack runs exactly as long as the picture
      expect(soundFor(s).length).toBe(Math.ceil((frames(s) / FPS) * 22050));
      return frames(s);
    });
    expect(lengths[1]).toBeLessThan(lengths[0]);
    for (const e of ENDINGS) expect(ENDS[f][e]).toBeGreaterThan(BACK);
    expect(ENDS[f].comment / FPS).toBeGreaterThanOrEqual(2.6);
    expect(ENDS[f].comment / FPS).toBeLessThanOrEqual(3.4);
  });

  it("never asks for a comment where comments are off", () => {
    expect(endingOf({})).toBe("comment");
    expect(endingOf({ ending: "comment", allowComments: false })).toBe("quiet");
    expect(endingOf({ ending: "loop", allowComments: false })).toBe("loop");
    const c = finish(FORMATS.quiz.propose(ctx(2))!, { ending: "comment", allowComments: false });
    expect(c.params.ending).toBe("quiet");
    expect(c.params.allowComments).toBe(false);
    expect(c.facts.join(" ")).toMatch(/doesn't ask viewers to comment/);
    expect(plainDescription(c)).not.toMatch(/comment/i);
    expect(plainDescription(finish(FORMATS.quiz.propose(ctx(2))!, { ending: "comment" }))).toMatch(/comment/i);
  });

  it("tells the title writer how it ends", () => {
    const base = FORMATS.ranking.propose(ctx(2))!;
    expect(finish(base, { ending: "loop" }).facts.at(-1)).toMatch(/loops/);
    expect(finish(base, { ending: "comment" }).facts.at(-1)).toMatch(/comment/);
  });
});

describe("battles", () => {
  it("play every tune there is, not just one", () => {
    expect(MELODY_IDS).toEqual(Object.keys(MELODIES));
    const tunes = new Set(Array.from({ length: 12 }, (_, i) => (proposeBattle(ctx(i), 1, 2)!.params as { melody: string }).melody));
    expect(tunes.size).toBeGreaterThan(1);
    // the same fight to a different tune sounds different
    const fight = { format: "battle", params: { a: "spike", b: "sword", seed: 3 } } as const;
    const ode = soundFor({ ...fight, params: { ...fight.params, melody: "ode" } });
    const king = soundFor({ ...fight, params: { ...fight.params, melody: "king" } });
    expect(ode.length).toBe(king.length);
    expect(ode.some((v, i) => Math.abs(v - king[i]) > 1e-3)).toBe(true);
    // a Short saved before tunes varied still plays the one it had
    expect(soundFor(fight)).toEqual(ode);
  });

  it("come round to a matchup again once the channel has had them all, as a different fight", () => {
    const all: string[] = [];
    for (let i = 0; i < ABILITY_IDS.length; i++) for (let j = i + 1; j < ABILITY_IDS.length; j++) all.push(matchupId(ABILITY_IDS[i], ABILITY_IDS[j]));
    const times = new Map(all.map((id) => [id, id === matchupId("spike", "sword") ? 1 : 2]));
    const b = proposeBattle({ rand: rng(5), used: new Set(all), times }, 2, 4)!;
    if (b.format !== "battle") throw new Error();
    expect(matchupId(b.params.a, b.params.b)).toBe(matchupId("spike", "sword"));
    expect(ledgerIds(spec(b))).toEqual([fightId(b.params.a, b.params.b, b.params.seed)]);
    expect(b.why.join(" ")).toMatch(/comes round again/);
  });
});

describe("the ledger's ids", () => {
  it("names what each Short takes from everyone, and what it uses up on its channel", () => {
    for (const f of FORMAT_IDS) {
      const c = FORMATS[f].propose(ctx(6))!;
      expect(ledgerIds(spec(c)).length, f).toBeGreaterThan(0);
      expect(contentIds(spec(c)).length, f).toBeGreaterThan(0);
    }
    const r = FORMATS.ranking.propose(ctx(6))!;
    if (r.format !== "ranking") throw new Error();
    // a countdown is claimed by how it comes out, not its year
    expect(ledgerIds(spec(r))).toEqual([`ranking:${r.params.metric}:${r.params.region}:${r.params.items.map((x) => x.iso).join(",")}`]);
    expect(ledgerIds(spec(r))).toEqual([rankingOrderId(r.params)]);
    expect(contentIds(spec(r))[0]).toMatch(/:\d{4}s$/);
    const race = FORMATS.race.propose(ctx(6))!;
    if (race.format !== "race") throw new Error();
    expect(ledgerIds(spec(race))).toEqual([raceOutcomeId(race.params)]);
    expect(ledgerIds(spec(race))[0]).toMatch(/^race:\w+:[\w ]+:[A-Z,]+>[A-Z,]+$/);
  });

  it("claims questions and choices with the words that carry their meaning", () => {
    const q = FORMATS.quiz.propose(ctx(6))!;
    if (q.format !== "quiz") throw new Error();
    expect(ledgerClaims(spec(q))).toEqual(q.params.questions.map((x) => ({ item: x.id, words: [...words(x.q)] })));
    const w = FORMATS.wyr.propose(ctx(6))!;
    if (w.format !== "wyr") throw new Error();
    expect(ledgerClaims(spec(w))[0]).toEqual({ item: w.params.pairs[0].id, words: [...words(`${w.params.pairs[0].a} or ${w.params.pairs[0].b}`)] });
    expect(ledgerClaims(spec(FORMATS.battle.propose(ctx(6))!))[0].words).toBeUndefined();
  });

  it("copes with Shorts saved with odd parameters", () => {
    expect(contentIds({ format: "quiz", params: {} } as Spec)).toEqual([]);
    expect(ledgerIds({ format: "race", params: {} } as Spec)).toEqual([]);
    expect(contentIds({ format: "battle", params: {} } as Spec)).toEqual([]);
  });

  it("knows every item in the banks, each once, and every sum the code can ask", () => {
    const ids = bankIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(PAIRS[0].id);
    expect(ids).toContain(STORIES[0].id);
    expect(ids).toContain(dataCapitals()[0].id);
    const sums = new Set(sumIds());
    const rand = rng(8);
    for (let i = 0; i < 3000; i++) expect(sums.has(sum(rand).id)).toBe(true);
    for (const id of sums) expect(ids).toContain(id);
  });

  it("leaves out sums another channel has before claiming, rather than losing the claim", () => {
    for (let seed = 1; seed < 30; seed++) {
      const q = proposeQuiz(ctx(seed, sumIds()), "mixed")!;
      if (q.format !== "quiz") throw new Error();
      expect(q.params.questions.some((x) => x.id.startsWith("math-")), `seed ${seed}`).toBe(false);
    }
  });

  it("keeps the ids choices had before the ledger, so a channel that had one never gets it again", () => {
    // choices the bank had then and still has word for word, with the ids they had
    const before: Record<string, string> = {
      "wyr-wifi-coffee": "Free Wi-Fi everywhere you go or Free food everywhere you go",
      "wyr-no-sugar-no-salt": "Give up dessert forever or Give up fries forever",
      "wyr-one-color": "Wear one colour forever or Never wear the same outfit twice",
      "wyr-no-internet-friends": "No internet for a month or No talking to friends for a month",
      "wyr-know-everything": "Know the ending of every movie or Never be able to finish one",
      "wyr-fly-invisible": "Be able to fly or Be able to turn invisible",
    };
    for (const [id, text] of Object.entries(before)) {
      const p = PAIRS.find((x) => x.id === id);
      expect(p, id).toBeDefined();
      expect(normal(`${p!.a} or ${p!.b}`), id).toBe(normal(text));
    }
    // and two that changed a word or two but are the same choice
    expect(PAIRS.find((x) => x.id === "wyr-ads-lines")?.b).toBe("Skip every queue forever");
    expect(PAIRS.find((x) => x.id === "wyr-social-games")?.a).toBe("Give up social media for a year");
    // and no choice is in the bank twice under two ids
    const said = PAIRS.map((p) => `${p.a} or ${p.b}`);
    for (const [i, x] of said.entries()) for (const y of said.slice(i + 1)) expect(sameThing(x, y), `${x} / ${y}`).toBe(false);
  });
});

describe("for teens and adults", () => {
  it("has nothing in the banks a young child would be asked, or that's unsafe", () => {
    const capitals = [...CAPITALS.map((c) => ({ ...c, q: `What's the capital of ${c.country}?`, topic: "capitals" })), ...dataCapitals()];
    for (const f of [...FACTS, ...capitals]) expect(questionProblem(f), f.q).toBeNull();
    for (const p of PAIRS) expect(pairProblem(p), p.id).toBeNull();
    expect(FACTS.some((f) => /spider|legs/i.test(f.q))).toBe(false);
    expect(PAIRS.some((p) => /dragon|unicorn/i.test(`${p.a} ${p.b}`))).toBe(false);
    expect(FACTS.filter((f) => f.level === 1).length).toBeLessThan(FACTS.length / 4);
  });

  it("turns away what's for kids, unsafe, a sum, or asked before in other words", () => {
    const f = (q: string, a = "One", d: [string, string] = ["Two", "Three"]): Fact => ({ id: "x", q, a, decoys: d, level: 2, topic: "t" });
    expect(questionProblem(f("How many legs does a spider have?", "8", ["6", "10"]))).toBe("for kids");
    expect(questionProblem(f("What's 17 x 8?", "136", ["126", "146"]))).toBe("sum");
    expect(questionProblem(f("Which religion has the most followers?"))).toBe("unsafe");
    expect(questionProblem(f("Which planet is called the red planet?", "Mars", ["Venus", "Mars"]))).toBe("same answers");
    expect(questionProblem(f("What is France's capital?"), ["What's the capital of France?"])).toBe("asked before");
    expect(questionProblem(f("Which river flows through Cairo?", "Nile", ["Congo", "Niger"]))).toBeNull();
    expect(questionProblem(f("Which river is the Nile?", "Nile", ["Congo", "Niger"]))).toBe("gives it away");
    expect(pairProblem({ a: "Have a pet dragon", b: "Have a pet unicorn" })).toBe("for kids");
    expect(pairProblem({ a: "Get drunk every night", b: "Never sleep" })).toBe("unsafe");
    expect(pairProblem({ a: "Work from home", b: "Work from home" })).toBe("same both sides");
    expect(kidCoded("Islamabad")).toBe(false);
    expect(unsafe("What's the capital of Pakistan? Islamabad")).toBe(false);
    expect(isSum("What's 15% of 80?")).toBe(true);
    expect(isSum("In which year did the Berlin Wall fall?")).toBe(false);
  });

  it("knows the same words when it sees them, and gives the same text the same id", () => {
    expect(normal("What's the Capital of Japan?")).toBe("what is the capital of japan");
    expect(sameThing("What is the capital of Japan", "What's Japan's capital?")).toBe(true);
    expect(sameThing("What's the capital of Japan?", "What's the capital of Peru?")).toBe(false);
    expect(textId("q", "What's the capital of Japan?")).toBe(textId("q", "what is the capital of japan"));
    expect(textId("q", "What's the capital of Japan?")).not.toBe(textId("q", "What's the capital of Peru?"));
  });

  it("checks a story fits and has both sides talking", () => {
    const m = (me: boolean, text: string) => ({ me, text });
    const ok = { title: "The landlord", contact: "Landlord", messages: [m(false, "hi, quick one about the flat"), m(true, "sure what's up"), m(false, "the heating's being fixed tomorrow"), m(true, "great, what time"), m(false, "around 9"), m(true, "i'll be at work"), m(false, "no problem, i have a key"), m(true, "perfect, thanks")] };
    expect(storyProblem(ok)).toBeNull();
    expect(storyProblem({ ...ok, messages: ok.messages.map((x) => ({ ...x, me: true })) })).toBe("one-sided");
    expect(storyProblem({ ...ok, messages: ok.messages.slice(0, 3) })).toBe("length");
    expect(storyProblem({ ...ok, contact: "Mommy" })).toBe("for kids");
  });
});

describe("new material from Claude", () => {
  const answers: Record<string, string> = {};
  // a pretend Claude: writes what it's given, and checks by looking the answer up
  const fake = (written: unknown, checker?: (q: string, options: string[]) => { pick: "A" | "B" | "C"; sure: boolean; changes: boolean }): Ask =>
    (async (system: string, user: string) => {
      if (!system.startsWith("You check")) return written;
      const blocks = user.split("\n\n");
      return {
        answers: blocks.map((b, i) => {
          const [q, ...opts] = b.split("\n");
          const options = opts.map((o) => o.slice(3));
          const text = q.replace(/^\d+\. /, "");
          const got = checker ? checker(text, options) : { pick: "ABC"[options.indexOf(answers[text])] as "A" | "B" | "C", sure: true, changes: false };
          return { n: i + 1, ...got };
        }),
      };
    }) as Ask;

  const q = (text: string, answer: string, wrong: string[], topic = "space", level = 2) => {
    answers[text] = answer;
    return { q: text, answer, wrong, level, topic };
  };

  it("keeps only questions that pass the checks and that a second look gets right", async () => {
    const written = {
      questions: [
        q("Which planet has the most moons known?", "Saturn", ["Jupiter", "Uranus"]),
        q("Which gas gives the Sun most of its mass?", "Hydrogen", ["Helium", "Neon"]),
        q("What's 12 x 14?", "168", ["158", "178"]),
        q("How many legs does a spider have?", "8", ["6", "10"]),
        q("Which painter cut off part of his own ear?", "Van Gogh", ["Monet", "Dali"], "painting"),
        q("Which metal has the chemical symbol Fe?", "Iron", ["Lead", "Iron"]),
      ],
    };
    // the checker isn't sure about the moons (it changes as more are found)
    const checker = (text: string, options: string[]) => ({ pick: "ABC"[options.indexOf(answers[text])] as "A" | "B" | "C", sure: true, changes: /moons/.test(text) });
    const got = await freshQuestions(fake(written, checker), [], rng(1));
    expect(got.map((f) => f.q)).toEqual(["Which gas gives the Sun most of its mass?", "Which painter cut off part of his own ear?"]);
    expect(got[0].topic).toBe("science");
    expect(got[0].id).toBe(wordsId("q", got[0].q));
    // and they make a quiz of their own, before the bank
    const rivers = ["Nile", "Amazon", "Yangtze", "Danube", "Volga", "Mekong", "Rhine", "Ganges"];
    const eight = rivers.map((r, i) => q(`Which river did the explorer in story ${["one", "two", "three", "four", "five", "six", "seven", "eight"][i]} follow?`, r, [`${r} Lake`, `${r} Sea`], "geography", 1 + (i % 3)));
    const many = await freshQuestions(fake({ questions: eight }), [], rng(2));
    const quiz = proposeQuiz({ ...ctx(3), fresh: { questions: many } }, "mixed")!;
    if (quiz.format !== "quiz") throw new Error();
    expect(quiz.params.questions.filter((x) => x.id.startsWith("q-")).length).toBeGreaterThanOrEqual(3);
  });

  it("never writes a question the banks ask, capitals included, nor one already written in other words", async () => {
    const written = {
      questions: [
        q("What is the capital of Peru?", "Lima", ["Cusco", "Arequipa"], "geography"),
        q("Lima is the capital city of which country?", "Peru", ["Chile", "Bolivia"], "geography"),
        q("Which planet's day is the shortest?", "Jupiter", ["Mercury", "Mars"]),
        q("Which painter's ear was partly cut off by himself?", "Van Gogh", ["Monet", "Dali"], "painting"),
      ],
    };
    const got = await freshQuestions(fake(written), bankQuestions(), rng(1));
    // capitals are the data's to ask, and the shortest day is in the bank already, in other words
    expect(got.map((f) => f.q)).toEqual(["Which painter's ear was partly cut off by himself?"]);
    expect(bankQuestions()).toContain("What's the capital of Peru?");
    // the same words in another order are the same question, and get the same id whoever writes them
    expect(wordsId("q", "Which planet's day is the shortest?")).toBe(wordsId("q", "Which planet has the shortest day?"));
    expect(wordsId("q", "Which planet has the shortest day?")).not.toBe(wordsId("q", "Which planet has the longest day?"));
    expect(bankPairs()).toContain("Have a pet dragon or Have a pet unicorn");
  });

  it("drops a question when the second look picks another answer, isn't sure, or says it could change", async () => {
    const fact = (id: string, a: string): Fact => ({ id, q: `Question ${id}?`, a, decoys: [`${a} no`, `${a} nope`], level: 2, topic: "t" });
    const facts = [fact("a", "Right"), fact("b", "Unsure"), fact("c", "Missed"), fact("d", "Changes")];
    const ask = (async (_system: string, user: string) => ({
      answers: user.split("\n\n").map((block, i) => {
        const options = block.split("\n").slice(1).map((o) => o.slice(3));
        const at = options.indexOf(facts[i].a);
        return { n: i + 1, pick: "ABC"[i === 2 ? (at + 1) % 3 : at], sure: i !== 1, changes: i === 3 };
      }),
    })) as Ask;
    expect((await doubleCheck(ask, facts, rng(1))).map((f) => f.id)).toEqual(["a"]);
    expect(await freshQuestions(null, [], rng(1))).toEqual([]);
  });

  it("keeps would-you-rathers that are safe, grown-up and new", async () => {
    const ask = (async () => ({
      pairs: [
        { a: "Free flights for a year", b: "Free groceries for a year", theme: "money", pull: 3 },
        { a: "Have a pet dragon", b: "Have a pet unicorn", theme: "silly", pull: 1 },
        { a: "Be famous and broke", b: "Be rich and unknown", theme: "money", pull: 2 },
        { a: "Never use a phone again", b: "Never use a laptop again", theme: "tech", pull: 9 },
      ],
    })) as Ask;
    const got = await freshPairs(ask, PAIRS.map((p) => `${p.a} or ${p.b}`), rng(1));
    expect(got.map((p) => p.a)).toEqual(["Free flights for a year", "Never use a phone again"]);
    expect(got[1].pull).toBe(3);
    expect(got[0].id).toMatch(/^wyr-/);
    const w = proposeWyr({ ...ctx(1), fresh: { pairs: [...got, ...got.map((p) => ({ ...p, id: `${p.id}x`, a: `${p.a} twice` }))] } })!;
    expect(w).not.toBeNull();
  });

  it("keeps stories that fit and are safe", async () => {
    const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ me: i % 2 === 1, text: `message number ${i + 1} about the flat` }));
    const ask = (async () => ({
      stories: [
        { title: "The flat", contact: "Flatmate", tone: "funny", messages: msgs(9) },
        { title: "Too short", contact: "Boss", tone: "twist", messages: msgs(3) },
      ],
    })) as Ask;
    const got = await freshStories(ask, []);
    expect(got).toHaveLength(1);
    expect(got[0].id).toMatch(/^story-/);
  });
});

describe("what gets made", () => {
  it("leaves text stories out unless the creator turns them on", () => {
    expect(formatsFor({ textStories: false })).not.toContain("texts");
    expect(formatsFor({ textStories: true })).toContain("texts");
    const o = odds([], formatsFor({ textStories: false }));
    expect(Object.keys(o)).not.toContain("texts");
    for (let seed = 1; seed < 20; seed++) expect(chooseFormats(5, o, rng(seed))).not.toContain("texts");
  });

  it("says plainly why there's nothing new, never just nothing", () => {
    expect(dryNote(["quizzes", "would-you-rathers"], 0, 3)).toBe("There are no new quizzes and would-you-rathers left to make for you right now. Hookline never makes the same thing twice, for your channel or anyone else's.");
    expect(dryNote(["quizzes"], 2, 3)).toMatch(/^Only 2 of 3 could be made: there are no new quizzes left/);
    for (const s of [dryNote(["a", "b", "c"], 1, 3), dryNote([], 0, 1)]) expect(s).not.toMatch(/—/);
  });
});

describe("a round from a LIVE", () => {
  const rounds = (["battle", "rivals"] as const).map((game) => {
    const log = demoClip(game);
    return { log, c: clipCandidate({ log, played_at: new Date(log.at) }, replay(log), { tz: "UTC", per: PLANS.pro.shorts, rand: rng(2) })! };
  });

  it("can end on a comment, loop back or end quietly, 18.2 to 45.2 seconds each, with a soundtrack exactly as long", () => {
    for (const { log, c } of rounds) {
      const lengths = ENDINGS.map((ending) => {
        const s = spec(finish(c, { ending }));
        const secs = frames(s) / FPS;
        expect(secs).toBeGreaterThanOrEqual(18.2);
        expect(secs).toBeLessThanOrEqual(45.2);
        expect(frames(s) - endFrom(s)).toBe(ENDS.clip[ending]);
        expect(soundFor(s).length).toBe(Math.ceil((frames(s) / FPS) * 22050));
        // worked out from the record alone, it's where the round's own video gets to the winner
        if (s.format !== "clip") throw new Error();
        expect(endFrom(s)).toBe(timeline(replay(log).battle, { from: s.params.from }).outroFrom);
        return frames(s);
      });
      expect(lengths[1]).toBeLessThan(lengths[0]);
    }
    expect(ENDS.clip).toEqual(ENDS.battle);
  });

  it("claims nothing from anyone and uses nothing up, so it can go to any channel of the creator's", () => {
    for (const { c } of rounds) {
      expect(ledgerClaims(spec(c))).toEqual([]);
      expect(ledgerIds(spec(c))).toEqual([]);
      expect(contentIds(spec(c))).toEqual([]);
    }
  });

  it("tells the title writer how it ends, and plays a tune of its own", () => {
    const { c } = rounds[0];
    expect(finish(c, { ending: "loop" }).facts.at(-1)).toMatch(/loops/);
    expect(finish(c, { ending: "comment" }).facts.at(-1)).toMatch(/comment who they'd back/);
    expect(finish(c, { ending: "comment", allowComments: false }).facts.at(-1)).toMatch(/doesn't ask viewers to comment/);
    if (c.format !== "clip") throw new Error();
    expect(MELODY_IDS).toContain(c.params.melody);
    const ode = soundFor({ format: "clip", params: { ...c.params, melody: "ode" } });
    const king = soundFor({ format: "clip", params: { ...c.params, melody: "king" } });
    expect(ode.length).toBe(king.length);
    expect(ode.some((v, i) => Math.abs(v - king[i]) > 1e-3)).toBe(true);
    expect(ode.some((v) => Math.abs(v) > 0.1)).toBe(true);
  });
});
