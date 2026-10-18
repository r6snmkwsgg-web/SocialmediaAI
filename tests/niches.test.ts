import { describe, expect, it, vi } from "vitest";
import { rng } from "@/lib/battle/sim";
import { freshPairs, freshQuestions, type Ask } from "@/lib/server/shorts/fresh";
import { plainDescription } from "@/lib/server/shorts/titles";
import { avoided, pairProblem } from "@/lib/shorts/checks";
import { FORMATS } from "@/lib/shorts/formats";
import { CAPITALS, dataCapitals, FACTS, proposeQuiz } from "@/lib/shorts/formats/quiz";
import { proposeRace } from "@/lib/shorts/formats/race";
import { proposeRanking } from "@/lib/shorts/formats/ranking";
import { PAIRS, proposeWyr } from "@/lib/shorts/formats/wyr";
import { kindName } from "@/lib/shorts/insights";
import { chooseFormats, formatCap, formatsFor, odds } from "@/lib/shorts/learn";
import { canPick, CHANNEL_NICHES, NICHE_IDS, nicheById, nicheFrom, nicheTopics, OFFERED, SUGGESTED, suggestedOf, writerNote, type NicheId } from "@/lib/shorts/niches";
import { FORMAT_IDS, type Candidate, type Context, type Fact, type Pair } from "@/lib/shorts/types";
import { NICHES } from "@/lib/trends/niches";

// coming back from Google with a YouTube channel, for the callback's test: someone signed in, with a code to swap, whose
// channel is as each test says. Everything else the callback does is the real thing
const back = vi.hoisted(() => ({ channel: { id: "w2n-channel", madeForKids: false as boolean | null, niche: null as string | null } }));
vi.mock("@/lib/server/auth", () => ({ currentUser: async () => ({ id: "w2-niches", email: "w2-niches@test.local" }) }));
vi.mock("@/lib/server/http", () => ({ origin: async () => "https://hookline.test" }));
// where connecting began, which the state Google sends back stands for
vi.mock("@/lib/server/oauth", () => ({ finishOAuth: async (_platform: string, state: string | null) => (state ? { next: state } : null) }));
vi.mock("@/lib/server/billing", () => ({ billingFor: async () => ({ plan: null }) }));
vi.mock("@/lib/server/channels", () => ({ channelsOf: async () => [back.channel], connectChannel: async () => ({ id: back.channel.id, already: false, moved: 0 }) }));
vi.mock("@/lib/server/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/youtube")>()),
  youtubeExchange: async () => ({ access: "ya29.w2n", refresh: null, expiresAt: null, scopes: null }),
  youtubeChannel: async () => ({ externalId: "UCw2niback", title: "Back", handle: null, avatarUrl: null }),
}));

/**
 * One niche per channel: each niche only ever makes its own formats, from
 * its own kinds, banks and chart figure, and Claude writes for it under its
 * own rules. Nothing is picked for anyone, and the catalog promises nothing.
 */

const niche = (id: NicheId) => nicheById(id)!;
const ctx = (seed: number, id: NicheId, fresh: Context["fresh"] = {}, used: string[] = []): Context => ({ rand: rng(seed), used: new Set(used), fresh, niche: id });
const form = (pairs: [string, string][]) => ({ get: (k: string) => pairs.find(([n]) => n === k)?.[1] ?? null });

/** Questions as Claude might write them for a channel, on one topic. */
const written = (topic: string, n: number): Fact[] =>
  Array.from({ length: n }, (_, i) => ({ id: `q-${topic}-${i}`, q: `Written question ${i + 1} about ${topic}?`, a: `Right ${i}`, decoys: [`Wrong ${i}`, `Other ${i}`], level: ((i % 3) + 1) as 1 | 2 | 3, topic }));

const pairsOf = (n: number, theme = "matchday"): Pair[] =>
  Array.from({ length: n }, (_, i) => ({ id: `wyr-w${i}`, a: `Choice one number ${i}`, b: `Choice two number ${i}`, theme, pull: ((i % 3) + 1) as 1 | 2 | 3 }));

describe("the catalog", () => {
  it("has every niche once, each making only formats Hookline makes, and offers text stories in none", () => {
    expect(CHANNEL_NICHES.map((n) => n.id)).toEqual([...NICHE_IDS]);
    for (const n of CHANNEL_NICHES) {
      expect(n.formats.length, n.id).toBeGreaterThan(0);
      for (const f of n.formats) expect(FORMAT_IDS, n.id).toContain(f);
      expect(n.formats, n.id).not.toContain("texts");
      expect(formatsFor({ textStories: true, niche: n }), n.id).toEqual(n.formats);
      // a niche with quizzes or would-you-rathers says what they're about
      if (n.formats.includes("quiz")) expect(n.quiz, n.id).toBeDefined();
      if (n.formats.includes("wyr")) expect(n.wyr, n.id).toBeDefined();
      if (n.formats.includes("ranking") || n.formats.includes("race")) expect(n.charts, n.id).toBeDefined();
    }
    expect(formatsFor({ textStories: true, niche: null })).toContain("texts");
    expect(nicheById("nonsense")).toBeNull();
    expect(nicheById(null)).toBeNull();
  });

  it("ties every niche to Trends niches that exist, and only Claude-written ones need Claude", () => {
    const trends = new Set(NICHES.map((n) => n.id));
    for (const n of CHANNEL_NICHES) for (const t of n.trends) expect(trends.has(t), `${n.id} ${t}`).toBe(true);
    // Formula 1, NBA and cars are watched in Trends now too
    for (const id of ["f1", "nba", "cars"]) expect(NICHES.find((n) => n.id === id)?.format).toBeNull();
    expect(CHANNEL_NICHES.filter((n) => n.claude === "needs").map((n) => n.id)).toEqual(["football", "f1", "nba", "cars", "gaming"]);
    expect(CHANNEL_NICHES.filter((n) => n.claude === "steady").map((n) => n.id)).toEqual(["money", "places"]);
    expect(niche("league").claude).toBe("never");
  });

  it("says nothing that promises money and has no em dashes", () => {
    for (const n of CHANNEL_NICHES) {
      const said = [n.name, n.line, n.names ?? "", n.facts ?? ""].join(" ");
      expect(said, n.id).not.toMatch(/[—–]/);
      expect(`${n.name} ${n.line}`, n.id).not.toMatch(/\b(earn\w*|income|profit\w*|paid|pays|get rich|make money)\b/i);
    }
    // what money's channels may never do
    expect(niche("money").names).toMatch(/never promise money/i);
    expect(niche("money").names).toMatch(/never give advice about saving, investing or earning/i);
  });

  it("suggests Football clubs when Claude is set up and Geography and history otherwise, never the Ball League", () => {
    expect(SUGGESTED).toEqual(["football", "places"]);
    expect(suggestedOf(true)).toBe("football");
    expect(suggestedOf(false)).toBe("places");
    for (const claude of [true, false]) expect(suggestedOf(claude)).not.toBe("league");
    // the niches only Claude writes can't be picked without it; the rest can
    for (const id of OFFERED) expect(canPick(niche(id), false), id).toBe(niche(id).claude !== "needs");
    for (const id of OFFERED) expect(canPick(niche(id), true), id).toBe(true);
  });

  it("reads a picked niche from a form: none picked leaves it, and one that can't be picked here is refused", () => {
    expect(nicheFrom(form([["id", "x"]]), true)).toEqual({});
    expect(nicheFrom(form([["niche", ""]]), true)).toEqual({});
    expect(nicheFrom(form([["niche", "places"]]), false)).toEqual({ niche: "places" });
    expect(nicheFrom(form([["niche", "football"]]), true)).toEqual({ niche: "football" });
    expect(nicheFrom(form([["niche", "football"]]), false)).toBeNull();
    expect(nicheFrom(form([["niche", "politics"]]), true)).toBeNull();
  });

  it("gives Claude each niche's own subjects, each in an era of its own unless it's timeless, from at least six eras", () => {
    for (const n of CHANNEL_NICHES.filter((x) => x.quiz)) {
      const q = n.quiz!;
      expect(q.eras.length, n.id).toBeGreaterThanOrEqual(6);
      for (const t of q.timeless ?? []) expect(q.topics, n.id).toContain(t);
      for (let seed = 1; seed < 30; seed++) {
        const topics = nicheTopics(q, rng(seed));
        expect(topics, n.id).toHaveLength(3);
        const bare = topics.map((t) => q.topics.find((x) => t === x || t.startsWith(`${x}, `)));
        expect(new Set(bare).size, n.id).toBe(3);
        for (const [i, t] of topics.entries()) {
          const of = bare[i]!;
          if (q.timeless?.includes(of)) expect(t).toBe(of);
          else expect(q.eras.map((e) => `${of}, ${e}`)).toContain(t);
        }
      }
    }
    // "World Cup history, the 1970s"
    const seen = new Set(Array.from({ length: 200 }, (_, s) => nicheTopics(niche("football").quiz!, rng(s + 1))).flat());
    expect(seen).toContain("World Cup history, the 1970s");
    expect(seen).toContain("laws of the game");
  });

  it("names every niche's quiz kinds the way What's working says them", () => {
    for (const n of CHANNEL_NICHES) for (const k of n.quiz?.kinds ?? []) expect(kindName(`quiz:${k.id}`), `${n.id} ${k.id}`).not.toBeNull();
    expect(kindName("quiz:football")).toBe("Football quizzes");
    expect(kindName("quiz:places")).toBe("Geography and history quizzes");
    expect(kindName("quiz:capitals")).toBe("Capital city quizzes");
    expect(kindName("quiz:nonsense")).toBeNull();
  });

  it("says plainly when Claude wrote nothing for a niche only it writes, and only promises a try in an hour when none were made", () => {
    expect(writerNote(["quizzes", "would-you-rathers"], { setUp: true, made: 0, wanted: 5 })).toBe(
      "Claude didn't answer, so no new quizzes or would-you-rathers could be written. Hookline tries again in an hour.",
    );
    expect(writerNote(["would-you-rathers"], { setUp: true, made: 3, wanted: 5 })).toBe("Only 3 of 5 could be made: Claude didn't answer, so no new would-you-rathers could be written.");
    expect(writerNote(["quizzes"], { setUp: false, made: 0, wanted: 3 })).toBe("No new quizzes can be written until Claude is set up on this Hookline.");
    expect(writerNote(["quizzes"], { setUp: false, made: 1, wanted: 3 })).toBe("Only 1 of 3 could be made: no new quizzes can be written until Claude is set up on this Hookline.");
  });
});

describe("a channel's Shorts are only about its niche", () => {
  it("draws only the niche's formats, and fills Creator's day from two of them, never more than three of one", () => {
    for (const n of CHANNEL_NICHES) {
      const on = formatsFor({ textStories: true, niche: n });
      for (let seed = 1; seed < 60; seed++) {
        const day = chooseFormats(5, odds([], on), rng(seed), formatCap(5, on.length));
        expect(day, n.id).toHaveLength(5);
        for (const f of day) expect(on, n.id).toContain(f);
        for (const f of on) expect(day.filter((x) => x === f).length, n.id).toBeLessThanOrEqual(formatCap(5, on.length));
      }
    }
    // two of a format a day, and more only when there are too few formats to fill it
    expect(formatCap(5, 2)).toBe(3);
    expect(formatCap(5, 4)).toBe(2);
    expect(formatCap(5, 1)).toBe(5);
    expect(formatCap(3, 2)).toBe(2);
    expect(formatCap(3, 5)).toBe(2);
    // with the old cap, a two-format day of five comes up short; the mix is exactly as it was
    expect(chooseFormats(5, odds([], ["quiz", "wyr"]), rng(1))).toHaveLength(4);
    const mix = formatsFor({ textStories: false });
    for (let seed = 1; seed < 40; seed++) expect(chooseFormats(5, odds([], mix), rng(seed), formatCap(5, mix.length))).toEqual(chooseFormats(5, odds([], mix), rng(seed)));
  });

  it("makes money's charts of GDP and geography's of population, and none for a niche without charts", () => {
    for (let seed = 1; seed < 6; seed++) {
      for (const [id, metric] of [["money", "gdp"], ["places", "population"]] as const) {
        const r = proposeRanking(ctx(seed, id))!;
        const c = proposeRace(ctx(seed, id))!;
        if (r.format !== "ranking" || c.format !== "race") throw new Error();
        expect(r.params.metric).toBe(metric);
        expect(c.params.metric).toBe(metric);
        expect(r.key).toMatch(new RegExp(`^ranking:${metric}:`));
      }
    }
    expect(proposeRanking(ctx(1, "football"))).toBeNull();
    expect(proposeRace(ctx(1, "league"))).toBeNull();
  });

  it("asks geography's quizzes from the capitals, or from what was written with the bank's geography, history and earth questions", () => {
    const bank = new Set(FACTS.filter((f) => ["geography", "history", "earth"].includes(f.topic)).map((f) => f.id));
    const capitals = new Set([...CAPITALS.map((c) => c.id), ...dataCapitals().map((f) => f.id)]);
    const kinds = new Set<string>();
    for (let seed = 1; seed < 30; seed++) {
      const q = proposeQuiz(ctx(seed, "places"))!;
      if (q.format !== "quiz") throw new Error();
      kinds.add(q.key);
      for (const x of q.params.questions) expect(q.key === "quiz:capitals" ? capitals.has(x.id) : bank.has(x.id), `${q.key} ${x.id}`).toBe(true);
      if (q.key === "quiz:places") expect(q.title).toBe("5 geography and history questions, 3 seconds each");
    }
    expect(kinds).toEqual(new Set(["quiz:capitals", "quiz:places"]));
    // never a sum or the general bank, even once what was written runs short
    const q = proposeQuiz(ctx(3, "places", { questions: written("rivers", 2) }), "places")!;
    if (q.format !== "quiz") throw new Error();
    expect(q.params.questions.every((x) => bank.has(x.id) || x.id.startsWith("q-rivers"))).toBe(true);
    expect(q.params.questions.some((x) => x.id.startsWith("math-"))).toBe(false);
  });

  it("asks a sports niche only what was written for it, never the banks or sums, and runs out without it", () => {
    for (const id of ["football", "f1", "nba", "cars", "gaming"] as const) {
      expect(proposeQuiz(ctx(1, id)), id).toBeNull();
      expect(proposeWyr(ctx(1, id)), id).toBeNull();
    }
    const q = proposeQuiz(ctx(2, "football", { questions: written("World Cup history, the 1970s", 8) }))!;
    if (q.format !== "quiz") throw new Error();
    expect(q.key).toBe("quiz:football");
    expect(q.title).toBe("5 football questions, 3 seconds each");
    expect(q.params.questions.every((x) => x.id.startsWith("q-World Cup"))).toBe(true);
    expect(q.facts[0]).toMatch(/5 multiple-choice football questions/);
    // and money's quizzes are its own written ones with the bank's one money question, never the rest of the bank
    expect(proposeQuiz(ctx(1, "money"))).toBeNull();
    const m = proposeQuiz(ctx(4, "money", { questions: written("currencies", 4) }))!;
    if (m.format !== "quiz") throw new Error();
    expect(m.params.questions.map((x) => x.id).sort()).toEqual(["geo-yen", ...written("currencies", 4).map((f) => f.id)].sort());
  });

  it("chooses would-you-rathers from the niche's own bank themes, with what was written for it first", () => {
    const themeOf = new Map(PAIRS.map((p) => [p.id, p.theme]));
    for (let seed = 1; seed < 20; seed++) {
      const money = proposeWyr(ctx(seed, "money"))!;
      const places = proposeWyr(ctx(seed, "places"))!;
      if (money.format !== "wyr" || places.format !== "wyr") throw new Error();
      for (const p of money.params.pairs) expect(["money", "work"]).toContain(themeOf.get(p.id));
      for (const p of places.params.pairs) expect(["adventure", "home"]).toContain(themeOf.get(p.id));
    }
    const w = proposeWyr(ctx(1, "football", { pairs: pairsOf(8) }))!;
    if (w.format !== "wyr") throw new Error();
    expect(w.params.pairs.every((p) => p.id.startsWith("wyr-w"))).toBe(true);
    // the Ball League makes neither
    expect(proposeQuiz(ctx(1, "league"))).toBeNull();
    expect(proposeWyr(ctx(1, "league"))).toBeNull();
  });

  it("gives the plain description the niche's own hashtags after #shorts", () => {
    const quiz = proposeQuiz(ctx(2, "football", { questions: written("title races", 8) }))!;
    expect(plainDescription(quiz, niche("football"))).toMatch(/\n\n#shorts #football #quiz #trivia$/);
    const race = proposeRace(ctx(1, "money"))!;
    expect(plainDescription(race, niche("money"))).toMatch(/\n\n#shorts #money #economy #barchartrace #data$/);
    expect(plainDescription(race)).toMatch(/\n\n#shorts #barchartrace #data$/);
    for (const n of CHANNEL_NICHES) expect(plainDescription(FORMATS[n.formats[0]].propose({ ...ctx(1, n.id), niche: undefined }) as Candidate, n).match(/#\w+/g)!.length, n.id).toBeLessThanOrEqual(5);
  });
});

describe("choices and words a niche keeps out", () => {
  it("refuses a choice whose two sides both name countries or peoples, and allows a place on one side", () => {
    expect(pairProblem({ a: "Support Brazil at a World Cup", b: "Support Argentina at a World Cup" })).toBe("people");
    expect(pairProblem({ a: "Visit every country in Africa", b: "Visit every country in Europe" })).toBe("people");
    expect(pairProblem({ a: "Travel around Japan by train", b: "Spend a month on a beach" })).toBeNull();
    expect(pairProblem({ a: "Win the Champions League with Real Madrid", b: "Win the World Cup with Brazil" })).toBeNull();
    expect(pairProblem({ a: "Play for Manchester United", b: "Play for Liverpool" })).toBeNull();
    for (const p of PAIRS) expect(pairProblem(p), p.id).toBeNull();
  });

  it("matches a niche's words to avoid whole, or as the start of one, in the ways they're written", () => {
    expect(avoided("Which Pokémon came first?", niche("gaming").avoid!)).toBe(true);
    expect(avoided("Who made Animal Crossing?", niche("gaming").avoid!)).toBe(true);
    expect(avoided("Which studio made Halo?", niche("gaming").avoid!)).toBe(false);
    expect(avoided("Which car passed the first crash test?", niche("cars").avoid!)).toBe(true);
    expect(avoided("Invest in a start-up", niche("money").avoid!)).toBe(true);
    expect(avoided("Retire at 40 with just enough", niche("money").avoid!)).toBe(false);
    expect(avoided("anything", [])).toBe(false);
  });
});

describe("Claude writing for a niche", () => {
  // a pretend Claude: writes what it's given, checks by knowing the answers, and keeps every prompt it's sent
  const fake = (out: unknown, answers: Record<string, string> = {}) => {
    const prompts: { system: string; user: string }[] = [];
    const ask = (async (system: string, user: string) => {
      prompts.push({ system, user });
      if (!system.startsWith("You check")) return out;
      return {
        answers: user.split("\n\n").map((b, i) => {
          const [q, ...opts] = b.split("\n");
          const options = opts.map((o) => o.slice(3));
          return { n: i + 1, pick: "ABC"[options.indexOf(answers[q.replace(/^\d+\. /, "")])], sure: true, changes: false };
        }),
      };
    }) as Ask;
    return { ask, prompts };
  };
  const q = (text: string, answer: string, answers: Record<string, string>) => {
    answers[text] = answer;
    return { q: text, answer, wrong: [`Not ${answer}`, `Also not ${answer}`], level: 2, topic: "x" };
  };

  it("asks for football's subjects in eras, lets it name clubs from the record books, and swaps the rule against champions for the fact rule", async () => {
    const { ask, prompts } = fake({ questions: [] });
    await freshQuestions(ask, [], rng(5), 12, niche("football"));
    const [{ system, user }] = prompts;
    expect(system).toMatch(/You may name clubs, competitions, grounds and players, but only for facts in the record books/);
    expect(system).toMatch(/Never set national teams or their fans against each other/);
    expect(system).toMatch(/Winners and results of finished seasons, finals and races are fine\. Nothing current or still running, no records that can still be broken, and no fees, salaries or prices\./);
    expect(system).not.toMatch(/never name a living person or a brand/);
    expect(system).not.toMatch(/champions or anything counted/);
    expect(user).toMatch(/^Write 12 questions for a channel about Football clubs, on these subjects: /);
    const subjects = user.match(/on these subjects: (.*?)\. Use those/)![1].split("; ");
    expect(subjects).toHaveLength(3);
    for (const s of subjects) expect(niche("football").quiz!.topics.some((t) => s === t || s.startsWith(`${t}, the `))).toBe(true);
  });

  it("keeps geography's rule against naming a living person or a brand, and the general prompts as they were", async () => {
    for (const n of [niche("places"), null]) {
      const { ask, prompts } = fake({ questions: [] });
      await freshQuestions(ask, [], rng(2), 12, n);
      expect(prompts[0].system).toMatch(/and never name a living person or a brand\./);
      expect(prompts[0].system).toMatch(/Nothing about records, rankings, "current", "latest", populations, prices, champions or anything counted that could change\./);
    }
    const { ask, prompts } = fake({ questions: [] });
    await freshQuestions(ask, [], rng(2));
    expect(prompts[0].user).toMatch(/^Write 12 questions about [^;]+\. Use those as the topic\./);
    const pairs = fake({ pairs: [] });
    await freshPairs(pairs.ask, [], rng(2), 12, niche("money"));
    expect(pairs.prompts[0].system).toMatch(/Never name a living person\. Never give advice about saving, investing or earning, and never promise money\./);
    expect(pairs.prompts[0].user).toMatch(/^Write 12 choices for a channel about Money and economies, about /);
  });

  it("drops gaming questions and choices that name games made for young children", async () => {
    const answers: Record<string, string> = {};
    const written = {
      questions: [
        q("Which studio first made Minecraft?", "Mojang", answers),
        q("Which console first had the game Halo?", "Xbox", answers),
        q("In which decade did Roblox first come out?", "2000s", answers),
      ],
    };
    const got = await freshQuestions(fake(written, answers).ask, [], rng(1), 12, niche("gaming"));
    expect(got.map((f) => f.q)).toEqual(["Which console first had the game Halo?"]);
    const pairs = await freshPairs(
      fake({ pairs: [{ a: "Only play Fortnite", b: "Only play racing games", theme: "games", pull: 2 }, { a: "Only play on a console", b: "Only play on a PC", theme: "consoles", pull: 3 }] }).ask,
      [], rng(1), 12, niche("gaming"),
    );
    expect(pairs.map((p) => p.a)).toEqual(["Only play on a console"]);
    // without a niche, nothing is dropped for the words a niche avoids
    expect((await freshQuestions(fake(written, answers).ask, [], rng(1))).map((f) => f.q)).toContain("Which studio first made Minecraft?");
  });
});

describe("coming back from connecting a YouTube channel", () => {
  /** Where coming back from Google goes for a connect that began at `next`, with the channel as given. */
  const land = async (next: string, channel: { madeForKids: boolean | null; niche: string | null }) => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/connect/[platform]/callback/route");
    Object.assign(back.channel, channel);
    const res = await GET(new NextRequest(`https://hookline.test/api/connect/youtube/callback?code=w2n&state=${encodeURIComponent(next)}`), {
      params: Promise.resolve({ platform: "youtube" }),
    });
    return res.headers.get("location");
  };
  const said = `connected=youtube&channel=${back.channel.id}`;

  it("goes to a channel's Shorts block to pick what it's about only when the connect began in Settings, and back where it began otherwise", async () => {
    // answered, about nothing yet, and connected again from Earnings: back to Earnings, which asked for it
    expect(await land("/app/earnings", { madeForKids: false, niche: null })).toBe(`https://hookline.test/app/earnings?${said}`);
    // begun in Settings: to its own block, where it picks
    expect(await land("/app/settings", { madeForKids: false, niche: null })).toBe(`https://hookline.test/app/settings?${said}#channel-${back.channel.id}`);
    // about something already: Settings as it was
    expect(await land("/app/settings", { madeForKids: false, niche: "places" })).toBe(`https://hookline.test/app/settings?${said}`);
    // getting started: back to its step
    expect(await land("/app/welcome?step=connect", { madeForKids: false, niche: null })).toBe(`https://hookline.test/app/welcome?step=connect&${said}`);
    // a channel with its made-for-kids question to answer still goes to that first, from anywhere but getting started
    expect(await land("/app/earnings", { madeForKids: null, niche: null })).toBe(`https://hookline.test/app/settings?${said}#audience-${back.channel.id}`);
  });
});
