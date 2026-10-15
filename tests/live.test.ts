import { describe, expect, it } from "vitest";
import { normalize, parseMessage, type Streaks } from "@/lib/live/events";
import { battleSteps, BATTLE_MENU, MAX_SIDE } from "@/lib/live/games/battle";
import { buildBoard, FINISH, RaceGame, radiusOf as raceRadius, speedOf } from "@/lib/live/games/race";
import { RivalsGame } from "@/lib/live/games/rivals";
import { RoyaleGame } from "@/lib/live/games/royale";
import { DEFAULT_GIFTS, DEFAULT_PRICES, tierIn, withGifts } from "@/lib/live/menu";
import { DEFAULT_SIDE_GIFTS, giftKey, NAME_MAX, namesPeople, ownRivalryProblem, priceGaps, RIVALRIES, rotation, routeGift, validSideGifts } from "@/lib/live/rivals";
import { plausible, sessionPayload, sessionSchema } from "@/lib/live/session";
import { PLANS } from "@/lib/billing/plans";
import { allowedBy, DEFAULT_SETTINGS, parseSettings } from "@/lib/live/settings";
import { GIFT_VOTES_MAX, INTRO, joinFromChat, KO_HOLD, LIKES_PER_HP, Show, sideFromChat, VOTE, voteFromChat } from "@/lib/live/show";
import { METEOR_HIT, rng, World } from "@/lib/battle/sim";

const v2Gift = (repeatCount: number, repeatEnd: number, giftType = 1, diamondCount = 1) => ({
  giftId: 5655,
  repeatCount,
  repeatEnd,
  user: { userId: "7001", uniqueId: "kayla", nickname: "Kayla", profilePicture: { urls: ["https://p.example/k.jpg"] } },
  giftDetails: { giftName: "Rose", giftType, diamondCount },
});

describe("reading a LIVE's events", () => {
  it("reads the 2.x connector's nested gifts and pays a streak out once", () => {
    const s: Streaks = new Map();
    const got = [v2Gift(1, 0), v2Gift(3, 0), v2Gift(3, 0), v2Gift(7, 1)].map((g) => normalize("gift", g, s));
    expect(got.map((e) => (e?.kind === "gift" ? e.count : 0))).toEqual([1, 2, 0, 4]);
    expect(got[0]?.viewer).toEqual({ id: "7001", name: "Kayla", avatar: "https://p.example/k.jpg" });
    // the streak is over, so the next one starts from nothing
    expect(normalize("gift", v2Gift(2, 0), s)).toMatchObject({ count: 2 });
  });

  it("takes a gift that can't streak as it comes", () => {
    expect(normalize("gift", v2Gift(1, 1, 2, 1000), new Map())).toMatchObject({ kind: "gift", coins: 1000, count: 1 });
  });

  it("reads TikFinity's flat messages", () => {
    const s: Streaks = new Map();
    const flat = { uniqueId: "drew", nickname: "DREW", userId: "88", profilePictureUrl: "https://p.example/d.jpg", giftId: 1, giftName: "Rose", diamondCount: 1, giftType: 1, repeatCount: 5, repeatEnd: true };
    expect(parseMessage(JSON.stringify({ event: "gift", data: flat }), s)).toMatchObject({ kind: "gift", gift: "Rose", coins: 1, count: 5, viewer: { id: "88", name: "DREW", avatar: "https://p.example/d.jpg" } });
    expect(parseMessage(JSON.stringify({ event: "chat", data: { uniqueId: "drew", comment: "2" } }), s)).toMatchObject({ kind: "chat", text: "2" });
    expect(parseMessage(JSON.stringify({ event: "like", data: { uniqueId: "drew", likeCount: 15 } }), s)).toMatchObject({ kind: "like", count: 15 });
    expect(parseMessage(JSON.stringify({ event: "social", data: { uniqueId: "drew", displayType: "pm_mt_msg_viewer_share" } }), s)).toMatchObject({ kind: "share" });
    expect(parseMessage("not json", s)).toBeNull();
    expect(parseMessage(JSON.stringify({ event: "roomUser", data: { viewerCount: 9 } }), s)).toBeNull();
  });
});

describe("reading chat", () => {
  it("reads a team pick, and nothing else", () => {
    expect(["1", "red", "Team 1", "#1", "RED!", "left"].map((t) => sideFromChat(t))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(["2", "blue", "Blue", "team 2"].map((t) => sideFromChat(t))).toEqual([1, 1, 1, 1]);
    expect(["12", "lol 1", "who wins", ""].map((t) => sideFromChat(t))).toEqual([null, null, null, null]);
    // a streamer's own team names work too
    expect(sideFromChat("sharks", ["Sharks", "Jets"])).toBe(0);
  });

  it("reads a vote and a join", () => {
    expect(["a", "B", "vote c", "c!"].map(voteFromChat)).toEqual([0, 1, 2, 2]);
    expect(["d", "abc", "a b"].map(voteFromChat)).toEqual([null, null, null]);
    expect(["go", "GO!", "join", "!go"].map(joinFromChat)).toEqual([true, true, true, true]);
    expect(joinFromChat("going to bed")).toBe(false);
  });
});

describe("gift menus", () => {
  it("goes up the menu by the price of one gift", () => {
    expect([1, 4, 5, 19, 20, 98, 99, 298, 299, 998, 999, 30000].map((c) => tierIn(BATTLE_MENU, c).effect)).toEqual(["heal", "heal", "small", "small", "ball", "ball", "rage", "rage", "shield", "shield", "meteor", "meteor"]);
  });

  it("shows each gift at its own price, while gifts a coin under still count", () => {
    expect(BATTLE_MENU.map((t) => t.gift)).toEqual(DEFAULT_GIFTS.map((g) => g.name));
    expect(BATTLE_MENU[3]).toMatchObject({ gift: "Hand Hearts", min: 99, price: 100 });
  });

  it("takes a streamer's own gifts, if they start at 1 coin and climb", () => {
    const mine = [
      { name: "Rose", coins: 1 },
      { name: "Rosa", coins: 10 },
      { name: "Doughnut", coins: 30 },
      { name: "Hand Hearts", coins: 100 },
      { name: "Money Gun", coins: 500 },
      { name: "Galaxy", coins: 1000 },
    ];
    const m = withGifts(BATTLE_MENU, mine);
    expect(m.map((t) => t.gift)).toEqual(mine.map((g) => g.name));
    expect(tierIn(m, 20).effect).toBe("small");
    expect(tierIn(m, 30).effect).toBe("ball");
    expect(m[4]).toMatchObject({ effect: "shield", min: 500, price: 500 });
    expect(withGifts(BATTLE_MENU, mine.map((g, i) => (i === 0 ? { ...g, coins: 2 } : g)))).toBe(BATTLE_MENU);
    expect(withGifts(BATTLE_MENU, mine.map((g, i) => (i === 2 ? { ...g, coins: 5 } : g)))).toBe(BATTLE_MENU);
    expect(withGifts(BATTLE_MENU, mine.map((g, i) => (i === 1 ? { ...g, name: "  " } : g))).map((t) => t.min)).toEqual(DEFAULT_PRICES);
  });

  it("adds up a streak of cheap gifts, and keeps a streak of balls readable", () => {
    expect(battleSteps("heal", 1, 10)).toEqual([{ effect: "heal", n: 10 }]);
    expect(battleSteps("small", 5, 8)).toEqual([{ effect: "small", n: 5 }, { effect: "heal", n: 3 }]);
    expect(battleSteps("shield", 299, 1)).toEqual([{ effect: "shield", n: 1 }, { effect: "heal", n: 10 }]);
    expect(battleSteps("meteor", 5000, 1)).toEqual([{ effect: "meteor", n: 3 }]);
  });

  it("reads settings from anywhere, keeping what's valid", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    const gifts = DEFAULT_GIFTS.map((g) => ({ ...g }));
    const s = parseSettings({ game: "race", roundSeconds: 9999, vote: false, gifts, teams: "nope" });
    expect(s.game).toBe("race");
    expect(s.roundSeconds).toBe(DEFAULT_SETTINGS.roundSeconds);
    expect(s.vote).toBe(false);
    expect(s.gifts).toEqual(gifts);
    expect(s.teams).toEqual(DEFAULT_SETTINGS.teams);
    expect(parseSettings({ gifts: gifts.map((g) => ({ ...g, coins: g.coins + 1 })) }).gifts).toBeNull();
  });

  it("keeps to what the plan allows", () => {
    const mine = parseSettings({ game: "royale", gifts: DEFAULT_GIFTS });
    const free = allowedBy(mine, { games: ["battle"], customMenus: false });
    expect(free.game).toBe("battle");
    expect(free.gifts).toBeNull();
    const creator = allowedBy(mine, { games: ["battle", "race", "royale"], customMenus: true });
    expect(creator.game).toBe("royale");
    expect(creator.gifts).toEqual(DEFAULT_GIFTS);
  });
});

describe("the battle arena, live", () => {
  const run = (w: World, s: number) => {
    for (let i = 0; i < 60 * s; i++) w.tick();
  };

  it("drops a viewer's ball in on their side, with their name, until the side is full", () => {
    const w = new World(2, { maxTeam: 3 });
    w.add(1, "spike", 600, 400);
    const small = w.summon(1, "spike", { small: true, tag: { id: "k", name: "kayla" } });
    expect(small?.x).toBeGreaterThan(400);
    expect(small).toMatchObject({ plain: true, hp: 5, tag: { name: "kayla" } });
    const big = w.summon(1, "spike", { small: false, tag: { id: "k", name: "kayla" } });
    expect(big).toMatchObject({ kind: "spike", hp: 22, touch: 3 });
    expect(big?.plain).toBeFalsy();
    expect(w.summon(1, "spike", { small: true })).toBeNull();
  });

  const duel = () => {
    const w = new World(9, { suddenDeath: 999 });
    w.add(0, "spike", 300, 400, { hp: 300, maxHp: 300 });
    w.add(1, "speed", 500, 400, { hp: 300, maxHp: 300 });
    return w;
  };

  it("lets rage double everything a team hits for, and nothing hurt a shielded team", () => {
    const plain = duel();
    run(plain, 8);
    const raging = duel();
    raging.enrage(0, 60);
    run(raging, 8);
    expect(300 - plain.balls[1].hp).toBeGreaterThan(0);
    expect(300 - raging.balls[1].hp).toBe((300 - plain.balls[1].hp) * 2);
    const shielded = duel();
    shielded.protect(1, 60);
    run(shielded, 8);
    expect(shielded.balls[1].hp).toBe(300);
  });

  it("drops a meteor on the other team's strongest ball", () => {
    const w = new World(1, { suddenDeath: 999 });
    w.add(0, "heal", 100, 100);
    const big = w.add(1, "speed", 600, 600, { hp: 80, maxHp: 80 });
    w.add(1, "speed", 650, 150, { hp: 5, maxHp: 5 });
    expect(w.meteor(0)).toBe(true);
    expect(w.meteors[0].target).toBe(big.id);
    run(w, 2);
    expect(big.maxHp - big.hp).toBeGreaterThanOrEqual(METEOR_HIT);
  });
});

const viewer = (id: string) => ({ id, name: id });
const toPlay = (s: Show) => {
  for (let t = 0; t <= INTRO; t += 0.25) s.update(0.25);
  expect(s.phase).toBe("play");
};
/** run until the win screen is up */
const toWin = (s: Show) => {
  for (let i = 0; i < 60 * 400 && s.phase !== "win"; i++) s.update(1 / 60);
  expect(s.phase).toBe("win");
};

describe("a battle show", () => {
  it("counts down, fights, crowns a winner and starts the next round", () => {
    const s = new Show({ seed: 3, settings: { vote: false } });
    expect(s.phase).toBe("intro");
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 300 && s.round < 3; i++) {
      s.update(1 / 60);
      seen.add(s.phase);
    }
    expect([...seen].sort()).toEqual(["intro", "ko", "play", "win"]);
    expect(s.round).toBe(3);
    expect(s.series[0] + s.series[1]).toBeGreaterThanOrEqual(1);
    expect(s.cues.some((c) => c.kind === "count")).toBe(true);
  });

  it("puts people on the team they type, and gifts from the undecided on the team that's behind", () => {
    const s = new Show({ seed: 4 });
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    s.handle({ kind: "chat", viewer: viewer("b"), text: "nice" });
    expect(s.sideOf("a")).toBe(0);
    expect(s.sideOf("b")).toBeNull();
    const g = s.game as unknown as { world: World };
    g.world.balls.filter((b) => b.team === 1).forEach((b) => (b.hp = 1));
    s.handle({ kind: "gift", viewer: viewer("c"), gift: "Rose", coins: 1, count: 3 });
    expect(s.sideOf("c")).toBe(1);
  });

  it("holds a gift sent before the fight, then lands it when the fight starts", () => {
    const s = new Show({ seed: 5 });
    const w = () => (s.game as unknown as { world: World }).world;
    s.handle({ kind: "chat", viewer: viewer("a"), text: "2" });
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Perfume", coins: 20, count: 1 });
    expect(w().count(1)).toBe(1);
    toPlay(s);
    expect(w().count(1)).toBe(2);
    expect(w().balls.find((b) => b.tag?.id === "a")).toMatchObject({ team: 1 });
  });

  it("does what the menu says for each gift", () => {
    const s = new Show({ seed: 6 });
    const w = () => (s.game as unknown as { world: World }).world;
    toPlay(s);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    const hp = w().hp(0);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Rose", coins: 1, count: 3 });
    expect(w().hp(0)).toBe(hp + 3);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Finger Heart", coins: 5, count: 1 });
    expect(w().balls.filter((b) => b.tag?.id === "a" && b.plain)).toHaveLength(1);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Hand Hearts", coins: 100, count: 1 });
    expect(w().rage[0]).toBeGreaterThan(w().clock);
    expect(s.blasts.at(-1)).toMatchObject({ side: 0, tier: { effect: "rage" } });
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Corgi", coins: 299, count: 2 });
    expect(w().shield[0] - w().clock).toBeCloseTo(12, 0);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Galaxy", coins: 1000, count: 1 });
    expect(w().meteors).toHaveLength(1);
    expect(s.lit.has("heal") && s.lit.has("small") && s.lit.has("meteor")).toBe(true);
    expect(s.stats.coins).toBe(3 + 5 + 100 + 598 + 1000);
  });

  it("heals the team instead once it's full", () => {
    const s = new Show({ seed: 7 });
    const w = () => (s.game as unknown as { world: World }).world;
    toPlay(s);
    for (let i = 0; i < MAX_SIDE + 2; i++) {
      s.handle({ kind: "chat", viewer: viewer(`v${i}`), text: "1" });
      s.handle({ kind: "gift", viewer: viewer(`v${i}`), gift: "Finger Heart", coins: 5, count: 1 });
    }
    expect(w().count(0)).toBe(MAX_SIDE);
    expect(s.toasts.some((t) => t.text.includes("FULL"))).toBe(true);
  });

  it("puts the crown on whoever's given the most, until someone gives more", () => {
    const s = new Show({ seed: 11 });
    toPlay(s);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    s.handle({ kind: "chat", viewer: viewer("b"), text: "2" });
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Perfume", coins: 20, count: 1 });
    expect(s.crown).toBe("a");
    s.handle({ kind: "gift", viewer: viewer("b"), gift: "Rose", coins: 1, count: 5 });
    expect(s.crown).toBe("a");
    s.handle({ kind: "gift", viewer: viewer("b"), gift: "Perfume", coins: 20, count: 1 });
    expect(s.crown).toBe("b");
    expect(s.toasts.at(-1)?.text).toBe("took the crown · Perfume");
  });

  it("turns likes into health", () => {
    const s = new Show({ seed: 8 });
    const w = () => (s.game as unknown as { world: World }).world;
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    toPlay(s);
    const hp = w().hp(0);
    s.handle({ kind: "like", viewer: viewer("a"), count: LIKES_PER_HP * 2 + 5 });
    expect(w().hp(0)).toBe(hp + 2);
    expect(s.likes[0]).toBe(5);
  });
});

describe("the vote between rounds", () => {
  it("shows three matchups, counts one vote each, and plays the winner next", () => {
    const s = new Show({ seed: 21 });
    toWin(s);
    const v = s.vote!;
    expect(v.options).toHaveLength(3);
    expect(new Set(v.options.map((o) => o.key)).size).toBe(3);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "B" });
    s.handle({ kind: "chat", viewer: viewer("b"), text: "b" });
    s.handle({ kind: "chat", viewer: viewer("c"), text: "a" });
    // changing your mind moves your vote
    s.handle({ kind: "chat", viewer: viewer("c"), text: "b" });
    expect(s.tally()).toEqual([0, 3, 0]);
    const picked = v.options[1];
    for (let t = 0; t < VOTE + 0.5; t += 0.25) s.update(0.25);
    expect(s.phase).toBe("intro");
    expect(s.voted?.option).toEqual(picked);
    const [a, b] = picked.key.split(":");
    expect([(s.game as unknown as { a: string }).a, (s.game as unknown as { b: string }).b]).toEqual([a, b]);
  });

  it("counts gifts as votes, up to a cap per gift, for whatever the gifter picked", () => {
    const s = new Show({ seed: 22 });
    toWin(s);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "a" });
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Perfume", coins: 20, count: 1 });
    expect(s.tally()[0]).toBe(21);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Galaxy", coins: 1000, count: 1 });
    expect(s.tally()[0]).toBe(21 + GIFT_VOTES_MAX);
    // gifts before picking wait for a pick
    s.handle({ kind: "gift", viewer: viewer("z"), gift: "Rose", coins: 1, count: 5 });
    expect(s.tally().reduce((x, y) => x + y, 0)).toBe(21 + GIFT_VOTES_MAX);
    expect(s.toasts.at(-1)?.text).toContain("TYPE A, B OR C");
    s.handle({ kind: "chat", viewer: viewer("z"), text: "c" });
    expect(s.tally()[2]).toBe(6);
  });

  it("picks at random when nobody votes, and says nothing about a vote", () => {
    const s = new Show({ seed: 23 });
    toWin(s);
    for (let t = 0; t < VOTE + 0.5; t += 0.25) s.update(0.25);
    expect(s.phase).toBe("intro");
    expect(s.voted).toBeNull();
  });

  it("skips the vote when the streamer turns it off", () => {
    const s = new Show({ seed: 24, settings: { vote: false } });
    toWin(s);
    expect(s.vote).toBeNull();
    expect(s.winFor).toBeLessThan(VOTE);
  });
});

describe("Rivals", () => {
  const rivals = (seed: number) => {
    const s = new Show({ seed, settings: { game: "rivals" } });
    const g = s.game as RivalsGame;
    return { s, g, w: () => g.world };
  };

  it("knows each side's gifts by name, however TikTok spells them", () => {
    expect(routeGift(DEFAULT_SIDE_GIFTS, "Perfume")).toMatchObject({ side: 0, tier: { effect: "ball", price: 20 } });
    expect(routeGift(DEFAULT_SIDE_GIFTS, "money gun")).toMatchObject({ side: 0, tier: { effect: "meteor" } });
    expect(routeGift(DEFAULT_SIDE_GIFTS, "Gem-Gun")).toMatchObject({ side: 1, tier: { effect: "meteor", gift: "Gem Gun" } });
    expect(routeGift(DEFAULT_SIDE_GIFTS, "Donut")).toMatchObject({ side: 1, tier: { effect: "ball" } });
    expect(routeGift(DEFAULT_SIDE_GIFTS, "Rose")).toBeNull();
    expect(giftKey(" Hand-Hearts! ")).toBe("handhearts");
  });

  it("keeps religion, race, where people are from and who they love out of it", () => {
    for (const [a, b] of [["Christians", "Muslims"], ["Jews", "Muslims"], ["Black people", "White people"], ["Mexicans", "Americans"], ["Gays", "Straight people"], ["catholic", "protestant"]]) {
      expect(ownRivalryProblem(a, b)).toContain("religion");
    }
    expect(namesPeople("Team Islam")).toBe(true);
    // choices are fine, even ones with a team's colour in them
    for (const [a, b] of [["Messi", "Ronaldo"], ["Cats", "Dogs"], ["Black Ops", "Halo"], ["Tacos", "Burritos"]]) expect(ownRivalryProblem(a, b)).toBeNull();
    expect(ownRivalryProblem("Pizza", "pizza")).toContain("different");
    expect(ownRivalryProblem("A very long name", "B")).toContain(`${NAME_MAX} letters`);
    expect(ownRivalryProblem(" ", "Dogs")).toContain("both sides");
    // Hookline's own pass its own rules
    expect(RIVALRIES.every((r) => ownRivalryProblem(r.red, r.blue) === null)).toBe(true);
  });

  it("checks each side's gifts make a fair game", () => {
    expect(validSideGifts(DEFAULT_SIDE_GIFTS)).toBe(true);
    const red = DEFAULT_SIDE_GIFTS.red;
    expect(validSideGifts({ red, blue: [{ name: "Perfume", coins: 20 }, ...DEFAULT_SIDE_GIFTS.blue.slice(1)] })).toBe(false);
    expect(validSideGifts({ red: [red[1], red[0], red[2]], blue: DEFAULT_SIDE_GIFTS.blue })).toBe(false);
    expect(validSideGifts({ red: red.slice(0, 2), blue: DEFAULT_SIDE_GIFTS.blue })).toBe(false);
    // the one power that costs one side more, with Hookline's gifts
    expect(priceGaps(DEFAULT_SIDE_GIFTS)).toEqual([{ power: "Your ball", red: 20, blue: 30 }]);
  });

  it("starts with politics off, drops rivalries it won't run, and keeps a rotation going", () => {
    expect(DEFAULT_SETTINGS.rivals.groups).not.toContain("politics");
    const s = parseSettings({
      game: "rivals",
      rivals: {
        groups: ["sports", "politics"],
        own: [{ red: "Christians", blue: "Muslims" }, { red: "Tacos", blue: "Burritos" }],
        gifts: { red: DEFAULT_SIDE_GIFTS.red, blue: DEFAULT_SIDE_GIFTS.red },
      },
    });
    expect(s.rivals.own).toEqual([{ red: "Tacos", blue: "Burritos" }]);
    expect(s.rivals.gifts).toBeNull();
    const r = rotation(s.rivals.groups, s.rivals.own);
    expect(r.some((x) => x.id === "republicans-democrats") && r.some((x) => x.red === "Tacos")).toBe(true);
    expect(r.every((x) => x.group === "sports" || x.group === "politics" || x.group === "own")).toBe(true);
    // one isn't a rotation: the everyday ones join in
    expect(rotation(["politics"], []).length).toBeGreaterThan(2);
    expect(rotation([], []).every((x) => x.group !== "politics")).toBe(true);
    // Pro plays Rivals with Hookline's gifts; Creator can pick its own
    const own = { ...s, rivals: { ...s.rivals, gifts: { red: DEFAULT_SIDE_GIFTS.blue, blue: DEFAULT_SIDE_GIFTS.red } } };
    expect(allowedBy(own, PLANS.free).game).toBe("battle");
    expect(allowedBy(own, PLANS.pro)).toMatchObject({ game: "rivals", rivals: { gifts: null } });
    expect(allowedBy(own, PLANS.creator).rivals.gifts).toEqual(own.rivals.gifts);
  });

  it("puts a gifter on the side their gift is for, and sets off that side's power", () => {
    const { s, w } = rivals(31);
    toPlay(s);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "2" });
    // Perfume is red's: it moves them to red and drops their ball in there
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Perfume", coins: 20, count: 1 });
    expect(s.sideOf("a")).toBe(0);
    expect(w().balls.find((b) => b.tag?.id === "a")).toMatchObject({ team: 0 });
    // Hearts is blue's rage, at the same price as red's Sunglasses
    s.handle({ kind: "gift", viewer: viewer("b"), gift: "Hearts", coins: 199, count: 1 });
    expect(s.sideOf("b")).toBe(1);
    expect(w().rage[1]).toBeGreaterThan(w().clock);
    expect(w().rage[0]).toBeLessThanOrEqual(w().clock);
    expect(s.blasts.at(-1)).toMatchObject({ side: 1, tier: { effect: "rage", gift: "Hearts" } });
    // and the Gem Gun is blue's meteor, onto red
    s.handle({ kind: "gift", viewer: viewer("b"), gift: "Gem Gun", coins: 500, count: 1 });
    expect(w().meteors.at(-1)).toMatchObject({ team: 1 });
    expect(["0:ball", "1:rage", "1:meteor"].every((k) => s.lit.has(k))).toBe(true);
  });

  it("lets any other gift help the giver's side, by what it costs", () => {
    const { s, w } = rivals(32);
    toPlay(s);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    const hp = w().hp(0);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Rose", coins: 1, count: 5 });
    expect(w().hp(0)).toBe(hp + 5);
    expect(s.sideOf("a")).toBe(0);
    // a Galaxy is on neither side, and costs more than a meteor: a meteor for red
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Galaxy", coins: 1000, count: 1 });
    expect(w().meteors.at(-1)).toMatchObject({ team: 0 });
    expect(s.sideOf("a")).toBe(0);
  });

  it("plays a new rivalry every round, the one chat votes for, and everyone picks again", () => {
    const { s, g } = rivals(33);
    const first = g.rivalry;
    expect(s.teams).toEqual([{ name: first.red, color: "#FF3B30" }, { name: first.blue, color: "#0A84FF" }]);
    // the same champion on both sides, and a new one next round
    expect(g.a).toBe(g.b);
    const champion = g.a;
    // a side's name picks it, and so do red and blue
    s.handle({ kind: "chat", viewer: viewer("a"), text: first.blue.toLowerCase() });
    s.handle({ kind: "chat", viewer: viewer("b"), text: "red" });
    expect([s.sideOf("a"), s.sideOf("b")]).toEqual([1, 0]);
    toWin(s);
    const v = s.vote!;
    expect(v.options).toHaveLength(3);
    expect(v.options.some((o) => o.key === first.id)).toBe(false);
    s.handle({ kind: "chat", viewer: viewer("c"), text: "c" });
    for (let t = 0; t < VOTE + 0.5; t += 0.25) s.update(0.25);
    expect(s.phase).toBe("intro");
    expect(g.rivalry.id).toBe(v.options[2].key);
    expect(s.teams[0].name).toBe(g.rivalry.red);
    expect(g.a).toBe(g.b);
    expect(g.a).not.toBe(champion);
    expect([s.sideOf("a"), s.sideOf("b")]).toEqual([null, null]);
  });
});

describe("Ball Race", () => {
  const race = (layout = "zigzag") => {
    const g = new RaceGame(DEFAULT_SETTINGS);
    g.start({ round: 1, option: { key: layout, label: layout }, rand: rng(3) });
    return g;
  };

  it("lines everyone up in the gate, CPUs included, and lets GO in free", () => {
    const g = race();
    expect(g.racers.filter((r) => r.cpu)).toHaveLength(3);
    expect(g.enter(viewer("a"))).toMatchObject({ toast: "joined the race" });
    expect(g.enter(viewer("a"))).toBeNull();
    const a = g.racers.find((r) => r.id === "a")!;
    expect(a).toMatchObject({ free: true, weight: 1 });
    expect(a.y).toBeLessThan(140);
  });

  it("makes a gifter's ball heavier, bigger and faster, coin by coin", () => {
    const g = race();
    g.gift({ viewer: viewer("a"), side: null, tier: g.menu[0], count: 10, each: 1, total: 10, gift: "10x Rose" });
    const a = g.racers.find((r) => r.id === "a")!;
    expect(a.weight).toBe(11);
    g.gift({ viewer: viewer("a"), side: null, tier: g.menu[1], count: 1, each: 5, total: 15, gift: "Finger Heart" });
    expect(a.weight).toBe(1 + 15 + 10);
    expect(raceRadius(a.weight)).toBeGreaterThan(raceRadius(1));
    expect(speedOf(a.weight)).toBeGreaterThan(speedOf(1));
  });

  it("runs every board to a finish, with a podium, in a sensible time", () => {
    for (const layout of ["zigzag", "pegs", "funnels"]) {
      const g = race(layout);
      for (let i = 0; i < 6; i++) g.enter(viewer(`v${i}`));
      let r = null;
      while (!(r = g.result())) g.tick();
      expect(r.byTime).toBe(false);
      expect(r.podium!.length).toBe(3);
      expect(g.clock).toBeGreaterThan(5);
      expect(g.clock).toBeLessThan(40);
      expect(g.racers.find((x) => x.id === r!.champion!.id)?.place).toBe(1);
    }
  });

  it("fires a power-up bought in the gate the moment the race starts", () => {
    const g = race();
    g.gift({ viewer: viewer("a"), side: null, tier: g.menu[5], count: 1, each: 999, total: 999, gift: "Galaxy" });
    const a = g.racers.find((r) => r.id === "a")!;
    expect(a.queued).toEqual(["rocket"]);
    g.tick();
    expect(a.queued).toEqual([]);
    expect(a.y).toBeGreaterThan(FINISH - 300);
  });

  it("knocks nearby balls back with a shockwave, and lets a ghost through pegs", () => {
    const g = race("pegs");
    for (let i = 0; i < 4; i++) g.enter(viewer(`v${i}`));
    g.tick();
    const a = g.racers.find((r) => r.id === "v0")!;
    const near = g.racers.filter((r) => r !== a && Math.hypot(r.x - a.x, r.y - a.y) < 200);
    g.gift({ viewer: viewer("v0"), side: null, tier: g.menu[4], count: 1, each: 299, total: 299, gift: "Corgi" });
    for (const r of near) expect(r.stunUntil).toBeGreaterThan(g.clock);
    g.gift({ viewer: viewer("v0"), side: null, tier: g.menu[3], count: 1, each: 99, total: 398, gift: "Hand Hearts" });
    expect(a.ghostUntil).toBeGreaterThan(g.clock + 3);
    expect(buildBoard("pegs", rng(1)).pegs.length).toBeGreaterThan(20);
  });

  it("makes room for a gifter in a full race, CPUs first", () => {
    const g = race();
    for (let i = 0; i < 21; i++) g.enter(viewer(`v${i}`));
    expect(g.racers).toHaveLength(24);
    expect(g.enter(viewer("late"))).toMatchObject({ toast: expect.stringContaining("full") });
    g.gift({ viewer: viewer("rich"), side: null, tier: g.menu[2], count: 1, each: 20, total: 20, gift: "Perfume" });
    expect(g.racers.find((r) => r.id === "rich")).toBeTruthy();
    expect(g.racers.filter((r) => r.cpu)).toHaveLength(2);
  });
});

describe("Last One Standing", () => {
  const fight = () => {
    const g = new RoyaleGame(DEFAULT_SETTINGS);
    g.start({ round: 1, option: null, rand: rng(5) });
    return g;
  };

  it("lets people in free early, then holds them for the next round; gifters always get in", () => {
    const g = fight();
    expect(g.enter(viewer("a"))).toMatchObject({ toast: "joined the fight" });
    for (let i = 0; i < 60 * 16; i++) g.tick();
    expect(g.enter(viewer("late"))).toMatchObject({ toast: "is in the next round" });
    g.gift({ viewer: viewer("rich"), side: null, tier: g.menu[0], count: 5, each: 1, total: 5, gift: "5x Rose" });
    expect(g.alive().find((f) => f.id === "rich")?.hp).toBe(3 + 5);
    g.start({ round: 2, option: null, rand: rng(6) });
    expect(g.alive().some((f) => f.id === "late")).toBe(true);
  });

  it("fights down to the last one standing", () => {
    const g = fight();
    for (let i = 0; i < 6; i++) g.enter(viewer(`v${i}`));
    let r = null;
    while (!(r = g.result())) g.tick();
    expect(g.alive().length).toBeLessThanOrEqual(1);
    expect(r.champion).toBeTruthy();
    expect(r.podium!.length).toBe(3);
  });

  it("protects a shielded ball and arms a sword", () => {
    const g = fight();
    g.gift({ viewer: viewer("a"), side: null, tier: g.menu[3], count: 1, each: 99, total: 99, gift: "Hand Hearts" });
    g.gift({ viewer: viewer("a"), side: null, tier: g.menu[4], count: 1, each: 299, total: 398, gift: "Corgi" });
    const a = g.alive().find((f) => f.id === "a")!;
    const hp = a.hp;
    for (let i = 0; i < 60 * 5; i++) g.tick();
    expect(a.hp).toBe(hp);
    expect(g.events.some((e) => e.type === "cut")).toBe(true);
  });
});

describe("the session's numbers", () => {
  it("counts rounds, coins, top gifters and the busiest round", () => {
    const s = new Show({ seed: 31, settings: { game: "royale", vote: false } });
    s.handle({ kind: "chat", viewer: viewer("a"), text: "go" });
    s.handle({ kind: "chat", viewer: viewer("b"), text: "go" });
    s.handle({ kind: "gift", viewer: viewer("b"), gift: "Perfume", coins: 20, count: 2 });
    toWin(s);
    for (let t = 0; t < KO_HOLD; t += 0.25) s.update(0.25);
    expect(s.stats.rounds).toBe(1);
    expect(s.stats.coins).toBe(40);
    expect(s.stats.peakPlayers).toBe(2);
    expect(s.topGifters()[0]).toMatchObject({ viewer: { id: "b" }, coins: 40 });
    expect(s.stats.firstAt).not.toBeNull();
  });

  it("never counts pretend viewers, or rounds before anyone real shows up", () => {
    const s = new Show({ seed: 32, settings: { game: "royale", vote: false } });
    const fake = { id: "demo-1", name: "demo", pretend: true };
    s.handle({ kind: "chat", viewer: fake, text: "go" });
    s.handle({ kind: "gift", viewer: fake, gift: "Galaxy", coins: 1000, count: 1 });
    toWin(s);
    for (let t = 0; t <= 10; t += 0.25) s.update(0.25);
    expect(s.round).toBe(2);
    expect(s.stats).toMatchObject({ rounds: 0, coins: 0, peakPlayers: 0, firstAt: null });
    expect(s.topGifters()).toEqual([]);
    s.handle({ kind: "like", viewer: viewer("real"), count: 5 });
    toWin(s);
    expect(s.stats.rounds).toBe(1);
    expect(s.stats.peakPlayers).toBe(1);
    expect(s.stats.coins).toBe(0);
  });
});

describe("saving a session", () => {
  const KEY = "k".repeat(32);

  it("sends nothing until a real viewer does something, then the whole session so far", () => {
    const s = new Show({ seed: 40, settings: { game: "royale", vote: false } });
    s.handle({ kind: "chat", viewer: { id: "demo-1", name: "demo", pretend: true }, text: "go" });
    expect(sessionPayload(s, KEY)).toBeNull();
    s.handle({ kind: "chat", viewer: viewer("a"), text: "go" });
    s.handle({ kind: "gift", viewer: { id: "b", name: "b".repeat(80) }, gift: "Rose", coins: 1, count: 7 });
    const p = sessionPayload(s, KEY)!;
    expect(sessionSchema.safeParse(p).success).toBe(true);
    expect(p).toMatchObject({ key: KEY, game: "royale", coins: 7, peakPlayers: 2 });
    expect(p.topGifters[0].name).toHaveLength(64);
    expect(plausible(p)).toBe(true);
  });

  it("turns away sessions from the future, from long ago, or out of order", () => {
    const now = Date.now();
    const base = { key: KEY, id: "6f1c1c1e-6a7b-4c1d-9e3f-0a1b2c3d4e5f", game: "battle" as const, rounds: 1, coins: 1, peakPlayers: 1, topGifters: [] };
    expect(plausible({ ...base, startedAt: now - 60_000, lastAt: now }, now)).toBe(true);
    expect(plausible({ ...base, startedAt: now - 60_000, lastAt: now + 3600_000 }, now)).toBe(false);
    expect(plausible({ ...base, startedAt: now - 30 * 24 * 3600_000, lastAt: now }, now)).toBe(false);
    expect(plausible({ ...base, startedAt: now, lastAt: now - 60_000 }, now)).toBe(false);
    expect(sessionSchema.safeParse({ ...base, startedAt: now, lastAt: now, key: "short" }).success).toBe(false);
  });
});
