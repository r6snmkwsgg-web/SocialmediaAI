import { afterEach, describe, expect, it, vi } from "vitest";
import { normalize, parseMessage, type Streaks } from "@/lib/live/events";
import { BattleGame, battleSteps, BATTLE_MENU, HANG_ON, MAX_SIDE, meteorShower, METEORS_MAX, POWER_STACK, RAGE_SECONDS } from "@/lib/live/games/battle";
import { buildBoard, FINISH, RaceGame, radiusOf as raceRadius, speedOf } from "@/lib/live/games/race";
import { RivalsGame } from "@/lib/live/games/rivals";
import { METEORS_MAX as ROYALE_METEORS, RoyaleGame } from "@/lib/live/games/royale";
import { DEFAULT_GIFTS, DEFAULT_PRICES, tierIn, withGifts, worth } from "@/lib/live/menu";
import { DEFAULT_SIDE_GIFTS, giftKey, NAME_MAX, namesPeople, ownRivalryProblem, priceGaps, RIVAL_GROUPS, RIVALRIES, rotation, routeGift, sidesProblem, validSideGifts } from "@/lib/live/rivals";
import { plainLetters, rot13 } from "@/lib/live/offlimits";
import { plausible, sessionPayload, sessionSchema } from "@/lib/live/session";
import { PLANS } from "@/lib/billing/plans";
import { COUNTRIES } from "@/lib/shorts/data";
import { battleDraw } from "@/components/live/draw/battle";
import { raceDraw } from "@/components/live/draw/race";
import { royaleDraw } from "@/components/live/draw/royale";
import { blastLevel } from "@/components/live/draw/frame";
import { meteorSize } from "@/components/live/draw/kit";
import { allowedBy, DEFAULT_SETTINGS, parseSettings } from "@/lib/live/settings";
import { INTRO, joinFromChat, KO_HOLD, LIKES_FREE, LIKES_PER_HP, likesToHp, SESSION_IDLE, Show, sideFromChat, VOTE, voteFromChat } from "@/lib/live/show";
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

  it("reads a side's first letter: r is red and b is blue, and a letter both could mean is neither", () => {
    expect(["r", "R", "r!", "team r"].map((t) => sideFromChat(t))).toEqual([0, 0, 0, 0]);
    expect(["b", "B", "#b"].map((t) => sideFromChat(t))).toEqual([1, 1, 1]);
    // left and right are words, not letters
    expect(["left", "right", "l", "x"].map((t) => sideFromChat(t))).toEqual([0, 1, null, null]);
    // a streamer's own names: their first letters
    expect(["s", "j", "r", "b"].map((t) => sideFromChat(t, ["Sharks", "Jets"]))).toEqual([0, 1, null, null]);
    expect(["b", "bulls"].map((t) => sideFromChat(t, ["Bulls", "Bears"]))).toEqual([null, 0]);
    // Rivals: the rivalry's names and red and blue; Ronaldo and red share an r, so r means neither
    expect(["m", "messi", "red", "b", "blue", "ronaldo", "r"].map((t) => sideFromChat(t, ["Messi", "Ronaldo"], ["Red", "Blue"]))).toEqual([0, 0, 0, 1, 1, 1, null]);
    expect(["r", "b", "x"].map((t) => sideFromChat(t, ["Xbox", "PlayStation"], ["Red", "Blue"]))).toEqual([0, 1, 0]);
  });

  it("puts someone who types r on red in a real show", () => {
    const s = new Show({ seed: 2 });
    s.handle({ kind: "chat", viewer: viewer("a"), text: "r" });
    s.handle({ kind: "chat", viewer: viewer("b"), text: "b" });
    expect([s.sideOf("a"), s.sideOf("b")]).toEqual([0, 1]);
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

  it("counts every coin about the same: 1 HP a coin, with the powers on top", () => {
    expect(battleSteps("heal", 1, 10)).toEqual([{ effect: "heal", n: 10 }]);
    // each ball carries its gift's coins as health, and a streak past a handful heals the rest
    expect(battleSteps("small", 5, 8)).toEqual([{ effect: "small", n: 5, hp: 5 }, { effect: "heal", n: 15 }]);
    expect(battleSteps("ball", 20, 1)).toEqual([{ effect: "ball", n: 1, hp: 20 }]);
    expect(battleSteps("rage", 100, 1)).toEqual([{ effect: "rage", n: 1 }, { effect: "heal", n: 100 }]);
    expect(battleSteps("shield", 299, 1)).toEqual([{ effect: "shield", n: 1 }, { effect: "heal", n: 299 }]);
    // a meteor gift: half its worth heals the sender's team, half falls on the other one
    const galaxy = battleSteps("meteor", 1000, 1);
    expect(galaxy[1]).toEqual({ effect: "heal", n: worth(1000) / 2 });
    expect(galaxy[0].n * galaxy[0].hp!).toBeCloseTo(worth(1000) / 2, -1);
    expect(galaxy[0].n).toBeGreaterThan(1);
  });

  it("makes a gift's worth grow with its coins, a little faster for the big ones", () => {
    expect([1, 5, 20, 100].map(worth)).toEqual([1, 5, 20, 100]);
    for (const [small, big] of [[100, 299], [299, 1000], [1000, 5000], [5000, 44999]]) {
      expect(worth(big)).toBeGreaterThan(worth(small));
      expect(worth(big) / big).toBeGreaterThan(worth(small) / small);
    }
    // a bit better per coin, never a different game: a Universe is worth under 6% more per coin than a Rose
    expect(worth(44999) / 44999).toBeLessThan(1.06);
  });

  it("brings down more meteors for a bigger gift, then bigger ones", () => {
    const g = meteorShower(510), u = meteorShower(25_000);
    expect(g.n).toBe(5);
    expect(u.n).toBe(METEORS_MAX);
    expect(u.hit).toBeGreaterThan(g.hit * 10);
    expect(meteorShower(40)).toEqual({ n: 1, hit: 40 });
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

  it("keeps the battle's own team names off who people are, too", () => {
    expect(sidesProblem("Red", "Blue")).toBeNull();
    expect(sidesProblem("Sharks", "Jets")).toBeNull();
    for (const [a, b] of [["Israel", "Palestine"], ["Muslims", "Christians"], ["Black", "White"], ["Red", "Mexico"]]) expect(sidesProblem(a, b), `${a} vs ${b}`).toContain("religion");
    expect(sidesProblem("ᴊᴇᴡꜱ", "Blue")).toContain("religion");
    expect(sidesProblem("🔥", "Blue")).toContain("Other alphabets");
    // saved before there was a check, they go back to Red and Blue, in the streamer's own colours
    const s = parseSettings({ teams: [{ name: "Israel", color: "#00FF00" }, { name: "Palestine", color: "#FFFFFF" }] });
    expect(s.teams).toEqual([{ name: "Red", color: "#00FF00" }, { name: "Blue", color: "#FFFFFF" }]);
    expect(parseSettings({ teams: [{ name: "Sharks", color: "#00FF00" }, { name: "Jets", color: "#FFFFFF" }] }).teams.map((t) => t.name)).toEqual(["Sharks", "Jets"]);
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

  it("lands a bigger meteor harder, through a shield, and on the next strongest once its target's gone", () => {
    const w = new World(1, { suddenDeath: 999 });
    w.add(0, "heal", 100, 100);
    const big = w.add(1, "speed", 600, 600, { hp: 500, maxHp: 500 });
    const next = w.add(1, "speed", 650, 150, { hp: 300, maxHp: 300 });
    w.protect(1, 60);
    w.meteor(0, 0, 0, 250);
    w.meteor(0, 0, 0.3, 250);
    w.meteor(0, 0, 0.6, 250);
    run(w, 2);
    expect(big.alive).toBe(false);
    expect(next.hp).toBeLessThan(300);
    expect(w.events.filter((e) => e.type === "boom").map((e) => (e.type === "boom" ? e.dmg : 0))).toEqual([250, 250, 250]);
  });

  it("leaves a team's last ball hanging on after a meteor, owing the rest, until it's paid off or time's up", () => {
    const hang = () => {
      // walls that hurt from the start, and a shield until the meteor lands, so nothing but the meteor touches blue first
      const w = new World(1, { suddenDeath: 0, hangOn: 4 });
      w.add(0, "heal", 100, 100, { hp: 500, maxHp: 500 });
      const last = w.add(1, "speed", 600, 600, { hp: 30, maxHp: 30 });
      w.protect(1, 1.3);
      w.meteor(0, 0, 0, 102);
      run(w, 1.4);
      return { w, last };
    };
    // it doesn't go down on the spot: it's on 1 HP, owing the other 73 of the hit
    const { w, last } = hang();
    expect([last.alive, last.hp, w.owed[1]]).toEqual([true, 1, 73]);
    expect(w.hanging[1]).toBeGreaterThan(w.clock);
    // and the number over it says it took the whole hit
    expect(w.events.filter((e) => e.type === "boom").at(-1)).toMatchObject({ dmg: 102, hit: 102 });
    // the walls don't touch it while it hangs on, and another meteor adds to what it owes
    w.meteor(0, 0, 0, 50);
    run(w, 1.4);
    expect([last.alive, last.hp, w.owed[1]]).toEqual([true, 1, 123]);
    // health pays off what it owes first, then it's back in the fight
    w.heal(1, 200);
    expect([last.hp, w.owed[1], w.hanging[1]]).toEqual([78, 0, 0]);
    expect(w.events.some((e) => e.type === "saved" && e.team === 1)).toBe(true);
    // not paid off in time, it goes down
    const late = hang();
    late.w.heal(1, 10);
    expect(late.w.owed[1]).toBe(63);
    run(late.w, HANG_ON);
    expect(late.last.alive).toBe(false);
    expect(late.w.owed[1]).toBe(0);
  });

  it("puts what a meteor really took over the ball it lands on, and aims it where it'll land", () => {
    // a video's world has no hanging on: a meteor knocks out what it hits hard enough, as it always did
    const w = new World(1, { suddenDeath: 999 });
    w.add(0, "heal", 100, 100);
    const ball = w.add(1, "speed", 600, 600, { hp: 22, maxHp: 22 });
    w.meteor(0, 0, 0, 102);
    w.meteor(0, 0, 0.3, 102);
    expect(w.landsOn(w.meteors[1])).toBe(ball);
    run(w, 2);
    expect(ball.alive).toBe(false);
    // 22, all it had, then nothing: the second one fell on empty ground
    expect(w.events.filter((e) => e.type === "boom").map((e) => (e.type === "boom" ? e.dmg : -1))).toEqual([22, 0]);
    // once the ball a meteor's aimed at is gone, it's drawn falling on the one it'll hit instead
    const v = new World(1, { suddenDeath: 999 });
    v.add(0, "heal", 100, 100);
    const aimed = v.add(1, "speed", 600, 600, { hp: 80, maxHp: 80 });
    const next = v.add(1, "speed", 200, 650, { hp: 40, maxHp: 40 });
    v.meteor(0);
    aimed.alive = false;
    expect(v.landsOn(v.meteors[0])).toBe(next);
  });

  it("drops in a gifted ball carrying its gift's health", () => {
    const w = new World(2);
    w.add(1, "spike", 600, 400);
    expect(w.summon(1, "spike", { small: false, hp: 99 })).toMatchObject({ hp: 99, maxHp: 99, kind: "spike" });
    expect(w.summon(1, "spike", { small: true, hp: 12 })).toMatchObject({ hp: 12, plain: true });
  });

  it("wears a big ball down at the walls once they close in, live, and touches a video's walls as it always did", () => {
    const melt = (wallShare?: number) => {
      const w = new World(4, { suddenDeath: 0, wallShare });
      w.add(0, "speed", 200, 400, { hp: 1000, maxHp: 1000 });
      w.add(1, "speed", 600, 400, { hp: 1000, maxHp: 1000 });
      run(w, 10);
      return 1000 - w.balls[0].hp;
    };
    expect(melt()).toBeLessThan(60);
    expect(melt(0.04)).toBeGreaterThan(300);
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
    expect(s.blasts.at(-1)).toMatchObject({ side: 0, tier: { effect: "rage" }, coins: 100 });
    const before = w().hp(0);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Corgi", coins: 299, count: 2 });
    expect(w().shield[0] - w().clock).toBeCloseTo(12, 0);
    expect(w().hp(0)).toBe(before + 598);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Galaxy", coins: 1000, count: 1 });
    expect(w().meteors.length).toBe(meteorShower(worth(1000) / 2).n);
    expect(s.blasts.at(-1)).toMatchObject({ tier: { effect: "meteor" }, coins: 1000, many: w().meteors.length });
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
    // likes coming in no faster than LIKES_FREE a second: every LIKES_PER_HP is 1 HP, for the whole team
    s.handle({ kind: "like", viewer: viewer("a"), count: LIKES_PER_HP });
    s.handle({ kind: "like", viewer: viewer("a"), count: 20 });
    expect(w().hp(0)).toBe(hp + 1);
    expect(s.likes[0].left).toBeCloseTo(20, 6);
  });

  it("makes each like worth less as likes pour in, so a crowd tapping adds a little, never a gift's worth", () => {
    const hpFrom = (perSecond: number, seconds: number) => {
      const l = { left: 0, rate: 0, at: 0 };
      let hp = 0;
      for (let t = 1; t <= seconds * 10; t++) hp += likesToHp(l, perSecond / 10, t / 10);
      return hp;
    };
    // a trickle gets its full worth
    expect(hpFrom(3, 60)).toBe(Math.floor((3 * 60) / LIKES_PER_HP));
    // a flood gets about LIKES_FREE / LIKES_PER_HP HP a second, whatever the rate (a little more as it starts)
    const steady = (LIKES_FREE / LIKES_PER_HP) * 60;
    for (const rate of [30, 150, 1000]) {
      expect(hpFrom(rate, 60)).toBeLessThanOrEqual(steady * 2);
      expect(hpFrom(rate, 60)).toBeGreaterThanOrEqual(hpFrom(LIKES_FREE, 60));
    }
    // it was 300 HP a minute at 150 likes a second; now it's a sliver of a Galaxy
    expect(hpFrom(150, 60)).toBeLessThan(worth(1000) / 25);
    // and a whole round of the fastest tapping is less than one big gift, Hand Hearts, as /live says
    expect(hpFrom(1000, 90)).toBeLessThan(100);
  });

  it("keeps fights short and gifts deciding on a LIVE that's liking hard", () => {
    const fight = (seed: number, likes: [number, number], galaxy: boolean) => {
      const s = new Show({ seed, settings: { vote: false } });
      s.join(viewer("a"), 0);
      s.join(viewer("b"), 1);
      while (s.phase === "intro") s.update(0.1);
      const acc = [0, 0];
      for (let t = 0; s.phase === "play" && t < 300; t += 0.1) {
        for (const k of [0, 1] as const) {
          acc[k] += likes[k] * 0.1;
          const n = Math.floor(acc[k]);
          acc[k] -= n;
          if (n) s.handle({ kind: "like", viewer: viewer(k ? "b" : "a"), count: n });
        }
        if (galaxy && Math.abs(t - 10) < 0.05) s.handle({ kind: "gift", viewer: viewer("a"), gift: "Galaxy", coins: 1000, count: 1 });
        s.update(0.1);
      }
      return s;
    };
    const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
    // 150 likes a second for each team used to push half the fights to time-outs
    const busy = seeds.map((i) => fight(i, [150, 150], false));
    expect(busy.filter((s) => s.result?.byTime).length).toBeLessThanOrEqual(2);
    // and one side's likes can't out-heal the other side's Galaxy
    expect(seeds.filter((i) => fight(i, [0, 150], true).result?.team === 0).length).toBeGreaterThanOrEqual(19);
  });
});

describe("big gifts get the biggest moments", () => {
  type Gift = { side: 0 | 1; gift: string; coins: number; count: number };
  const gift = (side: 0 | 1, name: string, coins: number, count = 1): Gift => ({ side, gift: name, coins, count });
  /** a real show: ten seconds into the fight, both sides' gifts land at once, then it plays out */
  const fight = (seed: number, gifts: Gift[], game: "battle" | "rivals" = "battle") => {
    const s = new Show({ seed, settings: { game, vote: false } });
    while (s.phase === "intro") s.update(0.1);
    const fan = (side: 0 | 1) => viewer(side ? "blue-fan" : "red-fan");
    s.join(fan(0), 0);
    s.join(fan(1), 1);
    for (let t = 0; s.phase === "play" && t < 400; t += 0.1) {
      if (Math.abs(t - 10) < 0.05) for (const g of gifts) s.handle({ kind: "gift", viewer: fan(g.side), gift: g.gift, coins: g.coins, count: g.count });
      s.update(0.1);
    }
    return s;
  };
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
  const wins = (gifts: Gift[], game: "battle" | "rivals" = "battle") => {
    const out = { red: 0, blue: 0, draw: 0 };
    for (const seed of SEEDS) {
      const t = fight(seed, gifts, game).result?.team;
      out[t === 0 ? "red" : t === 1 ? "blue" : "draw"]++;
    }
    return out;
  };

  it("lets one Galaxy beat 60 Roses almost every time (it used to lose 59 of 60)", () => {
    for (const game of ["battle", "rivals"] as const) expect(wins([gift(0, "Galaxy", 1000), gift(1, "Rose", 1, 60)], game).red, game).toBeGreaterThanOrEqual(38);
  });

  it("makes the same coins come out about even, whatever they're spent on", () => {
    for (const blue of [gift(1, "Rose", 1, 1000), gift(1, "Hand Hearts", 100, 10)]) {
      const w = wins([gift(0, "Galaxy", 1000), blue]);
      expect(w.red, `Galaxy vs ${blue.count} ${blue.gift}`).toBeGreaterThanOrEqual(SEEDS.length * 0.2);
      expect(w.blue, `Galaxy vs ${blue.count} ${blue.gift}`).toBeGreaterThanOrEqual(SEEDS.length * 0.2);
    }
  });

  /** what a gift from red brings down on blue: the meteors it sets falling, and what they hit for in all */
  const shower = (name: string, coins: number, game: "battle" | "rivals" = "battle") => {
    const s = new Show({ seed: 1, settings: { game, vote: false } });
    toPlay(s);
    s.join(viewer("red-fan"), 0);
    s.handle({ kind: "gift", viewer: viewer("red-fan"), gift: name, coins, count: 1 });
    const falling = (s.game as unknown as { world: World }).world.meteors.filter((m) => m.team === 0);
    return { n: falling.length, hits: falling.reduce((n, m) => n + m.hit, 0), biggest: Math.max(...falling.map((m) => m.hit)) };
  };

  it("makes a Universe clearly bigger than a Galaxy", () => {
    expect(wins([gift(0, "Universe", 44999), gift(1, "Galaxy", 1000)]).red).toBe(SEEDS.length);
    const g = shower("Galaxy", 1000), u = shower("Universe", 44999);
    expect(u.hits).toBeGreaterThan(g.hits * 40);
    expect(u.n).toBeGreaterThan(g.n);
    expect(u.biggest).toBeGreaterThan(g.biggest * 10);
    // and it shows: the moment on screen says how many, and knows how big it was
    const gb = fight(2, [gift(0, "Galaxy", 1000)]).blasts.at(-1)!;
    const ub = fight(2, [gift(0, "Universe", 44999)]).blasts.at(-1)!;
    expect([gb.many, ub.many]).toEqual([g.n, u.n]);
    expect([gb.coins, ub.coins]).toEqual([1000, 44999]);
  });

  it("shows a bigger gift bigger: a longer moment, bigger meteors, and how many", () => {
    expect([100, 299, 1000, 44999].map(blastLevel)).toEqual([0, 0, 1, 2]);
    expect(meteorSize(30)).toBe(1);
    expect(meteorSize(1974)).toBeGreaterThan(meteorSize(102));
    const s = new Show({ seed: 6, settings: { vote: false } });
    toPlay(s);
    s.join(viewer("a"), 0);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Galaxy", coins: 1000, count: 1 });
    const b = s.blasts.at(-1)!;
    expect(battleDraw.blastLine(s, b)).toBe(`${b.many} METEORS ON BLUE`);
  });

  /** a real show with each gift at its own time, in seconds into the fight */
  const timed = (seed: number, gifts: (Gift & { at: number })[], game: "battle" | "rivals" = "battle", until = 400) => {
    const s = new Show({ seed, settings: { game, vote: false } });
    while (s.phase === "intro") s.update(0.1);
    const fan = (side: 0 | 1) => viewer(side ? "blue-fan" : "red-fan");
    s.join(fan(0), 0);
    s.join(fan(1), 1);
    for (let t = 0; s.phase === "play" && t < until; t += 0.1) {
      for (const g of gifts) if (Math.abs(t - g.at) < 0.05) s.handle({ kind: "gift", viewer: fan(g.side), gift: g.gift, coins: g.coins, count: g.count });
      s.update(0.1);
    }
    return s;
  };
  const at = (seconds: number, g: Gift) => ({ ...g, at: seconds });
  const timedWins = (gifts: (Gift & { at: number })[], game: "battle" | "rivals" = "battle") => {
    const out = { red: 0, blue: 0, draw: 0 };
    for (const seed of SEEDS) {
      const t = timed(seed, gifts, game).result?.team;
      out[t === 0 ? "red" : t === 1 ? "blue" : "draw"]++;
    }
    return out;
  };

  it("never lets one gift end a round on the spot: the side it would knock out hangs on, and can still answer", () => {
    // Rivals' own meteor (a 299-coin Corgi) and the battle's Galaxy, on a fresh round
    for (const [game, g] of [["rivals", gift(0, "Corgi", 299)], ["battle", gift(0, "Galaxy", 1000)]] as const) {
      for (const seed of [1, 2, 3, 4, 5]) {
        // a few seconds after it lands, blue is still in it, hanging on
        const s = timed(seed, [at(10, g)], game, 15);
        expect(s.phase, `${g.gift} ${seed}`).toBe("play");
        expect((s.game as BattleGame).hanging(1), `${g.gift} ${seed}`).toBe(true);
        // and when nobody answers, red wins it
        expect(timed(seed, [at(10, g)], game).result?.team).toBe(0);
      }
    }
    // the same coins sent back a few seconds later come out about even, whichever comes first
    const even = (w: { red: number; blue: number }, what: string) => {
      expect(w.red, what).toBeGreaterThanOrEqual(SEEDS.length * 0.2);
      expect(w.blue, what).toBeGreaterThanOrEqual(SEEDS.length * 0.2);
    };
    even(timedWins([at(10, gift(0, "Galaxy", 1000)), at(12, gift(1, "Rose", 1, 1000))]), "Galaxy, then 1,000 Roses");
    even(timedWins([at(10, gift(1, "Rose", 1, 1000)), at(12, gift(0, "Galaxy", 1000))]), "1,000 Roses, then a Galaxy");
    even(timedWins([at(10, gift(0, "Corgi", 299)), at(13, gift(1, "Boxing Gloves", 299))], "rivals"), "Corgi, then Boxing Gloves");
    even(timedWins([at(10, gift(1, "Boxing Gloves", 299)), at(13, gift(0, "Corgi", 299))], "rivals"), "Boxing Gloves, then a Corgi");
    // and a Galaxy still beats 60 Roses sent first
    expect(timedWins([at(9, gift(1, "Rose", 1, 60)), at(10, gift(0, "Galaxy", 1000))]).red).toBeGreaterThanOrEqual(38);
  });

  it("scales a Rivals gift that costs more than the meteor beyond it", () => {
    expect(tierIn(new RivalsGame(DEFAULT_SETTINGS).sideMenu(0), 1000).effect).toBe("meteor");
    const hits = (name: string, coins: number) => shower(name, coins, "rivals").hits;
    // red's own meteor gift, then a Galaxy and a Universe from someone on red
    const corgi = hits("Corgi", 299), galaxy = hits("Galaxy", 1000), universe = hits("Universe", 44999);
    expect(galaxy).toBeGreaterThan(corgi * 3);
    expect(universe).toBeGreaterThan(galaxy * 40);
  });

  it("stacks rage and a shield only so far; past that, a gift is its coins in HP", () => {
    const s = new Show({ seed: 5, settings: { vote: false } });
    const w = () => (s.game as unknown as { world: World }).world;
    toPlay(s);
    s.join(viewer("a"), 0);
    const hp = w().hp(0);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Hand Hearts", coins: 100, count: 10 });
    expect(w().rage[0] - w().clock).toBeCloseTo(RAGE_SECONDS * POWER_STACK, 5);
    expect(w().hp(0)).toBe(hp + 1000);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Hand Hearts", coins: 100, count: 1 });
    expect(w().rage[0] - w().clock).toBeCloseTo(RAGE_SECONDS * POWER_STACK, 5);
    expect(w().hp(0)).toBe(hp + 1100);
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

  it("counts a gift as a vote a coin, with no cap, for whatever the gifter picked", () => {
    const s = new Show({ seed: 22 });
    toWin(s);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "a" });
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Perfume", coins: 20, count: 1 });
    expect(s.tally()[0]).toBe(21);
    // a Galaxy is a thousand votes, as much as a thousand Roses, not 50
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Galaxy", coins: 1000, count: 1 });
    expect(s.tally()[0]).toBe(1021);
    expect(s.toasts.at(-1)?.text).toBe("+1,000 VOTES");
    // gifts before picking wait for a pick
    s.handle({ kind: "gift", viewer: viewer("z"), gift: "Rose", coins: 1, count: 5 });
    expect(s.tally().reduce((x, y) => x + y, 0)).toBe(1021);
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
    expect(routeGift(DEFAULT_SIDE_GIFTS, "Paper Crane")).toMatchObject({ side: 0, tier: { effect: "ball", price: 99 } });
    expect(routeGift(DEFAULT_SIDE_GIFTS, "corgi")).toMatchObject({ side: 0, tier: { effect: "meteor" } });
    expect(routeGift(DEFAULT_SIDE_GIFTS, "Boxing-Gloves")).toMatchObject({ side: 1, tier: { effect: "meteor", gift: "Boxing Gloves" } });
    expect(routeGift(DEFAULT_SIDE_GIFTS, "Boxing Glove")).toMatchObject({ side: 1, tier: { effect: "meteor" } });
    expect(routeGift(DEFAULT_SIDE_GIFTS, "LITTLE CROWN")).toMatchObject({ side: 1, tier: { effect: "ball" } });
    expect(routeGift(DEFAULT_SIDE_GIFTS, "Rose")).toBeNull();
    expect(giftKey(" Hand-Heart! ")).toBe("handhearts");
    expect(giftKey("Donut")).toBe("doughnut");
  });

  it("keeps religion, race, where people are from, gender and who they love out of it", () => {
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

  it("refuses every country, people, faith and identity matchup the last filter let through", () => {
    const pairs = [
      ["India", "Pakistan"], ["Israel", "Palestine"], ["Russia", "Ukraine"], ["USA", "Mexico"], ["Americans", "Russians"],
      ["Jesus", "Allah"], ["Bible", "Quran"], ["Christ", "Muhammad"], ["Black", "White"], ["Brazil", "Argentina"],
      // and the ways people type them
      ["U.S.A.", "China"], ["Team Israel", "Pizza"], ["the Jews", "Pizza"], ["Musl1ms", "Pizza"], ["SaudiArabia", "Pizza"], ["Israel's", "Pizza"],
      ["Frenchmen", "Pizza"], ["LGBTQ+", "Pizza"], ["Trans people", "Pizza"], ["Men", "Women"], ["Boys", "Girls"], ["Team Jesus", "Pizza"],
      ["Lord Krishna", "Pizza"], ["Jehovah's Witnesses", "Pizza"], ["Black Lives Matter", "Pizza"], ["Georgia", "Turkey"], ["Hamas", "IDF"],
      ["Christians", "Pizza"], ["French", "Pizza"], ["French people", "Pizza"], ["Shia", "Sunni"],
    ];
    for (const [a, b] of pairs) expect(ownRivalryProblem(a, b), `${a} vs ${b}`).toContain("religion");
  });

  it("turns away names in other alphabets, and emoji, until they can be checked", () => {
    for (const [a, b] of [["الهند", "Pizza"], ["भारत", "पाकिस्तान"], ["Россия", "Украина"], ["🇺🇸", "Pizza"], ["Pizza 🔥", "Tacos"]]) {
      expect(ownRivalryProblem(a, b), `${a} vs ${b}`).toContain("Other alphabets");
    }
  });

  it("reads look-alike letters as the letters they look like, and turns away ones it can't read", () => {
    const pairs = [
      ["ɪɴᴅɪᴀ", "ᴘᴀᴋɪꜱᴛᴀɴ"], ["ᴍᴜꜱʟɪᴍꜱ", "ᴄʜʀɪꜱᴛɪᴀɴꜱ"], ["ᴊᴇᴡꜱ", "Pizza"], ["Indıa", "Pakıstan"], ["ıslam", "Pizza"], ["Chına", "Pizza"],
      ["Ißrael", "Pizza"], ["Pøland", "Pizza"], ["Mexicø", "Pizza"],
    ];
    for (const [a, b] of pairs) expect(ownRivalryProblem(a, b), `${a} vs ${b}`).toContain("religion");
    // a letter that doesn't come down to one of A to Z can't pass as a blank
    for (const n of ["ʘ", "Indɐ", "ɹussia"]) {
      expect(plainLetters(n), n).toBe(false);
      expect(ownRivalryProblem(n, "Pizza"), n).toContain("Other alphabets");
    }
    // Europe's own letters are fine
    for (const n of ["Łódź", "Ørsted", "Æsir", "Weißbier", "Müller", "Þór"]) expect(plainLetters(n), n).toBe(true);
    // and so are names run together, or with letters doubled, read for what they say
    for (const n of ["teamisrael", "israelfans", "gojews", "Jewwws", "Isssrael"]) expect(namesPeople(n), n).toBe(true);
  });

  it("refuses the people a list of countries misses: incomers, slurs, and plurals in -ies", () => {
    const pairs = [["Immigrants", "Locals"], ["Migrants", "Natives"], ["Illegals", "Citizens"], ["Foreigners", "Locals"], ["Refugees", "Pizza"], ["Trannies", "Pizza"]];
    for (const [a, b] of pairs) expect(ownRivalryProblem(a, b), `${a} vs ${b}`).toContain("religion");
    // slurs for race, faith and who people love, kept here as offlimits.ts keeps them, in ROT13, so they aren't spelled out
    for (const slur of "fcvpf xvxrf puvaxf jrgonpxf ornaref tbbxf enturnqf gbjryurnqf artebrf snttbgf qlxrf erqfxvaf avttref".split(" ")) {
      expect(ownRivalryProblem(rot13(slur), "Pizza"), slur).toContain("religion");
    }
    // without catching words that only look like them
    for (const n of ["Spices", "Collie", "Guinness", "Pollen", "Cypress", "Japes", "Alas"]) expect(namesPeople(n), n).toBe(false);
  });

  it("reads the same matchups in Spanish, Portuguese and French, and countries by their names in the big languages", () => {
    const pairs = [
      ["Rusia", "Ucrania"], ["Negros", "Blancos"], ["Pretos", "Brancos"], ["Noirs", "Blancs"], ["Musulmanes", "Judíos"], ["Cristãos", "Muçulmanos"],
      ["Dios", "Alá"], ["Biblia", "Corán"], ["Cristo", "Mahoma"], ["Alemania", "Inglaterra"], ["Turquía", "Grecia"], ["Marruecos", "Argelia"],
      ["Mujeres", "Hombres"], ["Polska", "Sverige"], ["Brasileños", "Argentinos"], ["Mexicanos", "Gringos"], ["Français", "Algériens"],
      ["Deutschland", "Türkiye"], ["EEUU", "México"], ["India", "Pakistán"], ["Israel", "Palestina"],
    ];
    for (const [a, b] of pairs) expect(ownRivalryProblem(a, b), `${a} vs ${b}`).toContain("religion");
    // and leaves clubs, names and everyday words alone
    const fine = [
      ["Granada", "Sevilla"], ["Canadiens", "Bruins"], ["America", "Chivas"], ["Rojo", "Negro"], ["Cristiano", "Messi"], ["Checo", "Max"],
      ["Jesús Navas", "Isco"], ["Americano", "Latte"], ["Indie", "Pop"], ["Island", "Mountain"], ["All Blacks", "Wallabies"], ["U. de Chile", "Colo-Colo"],
    ];
    for (const [a, b] of fine) expect(ownRivalryProblem(a, b), `${a} vs ${b}`).toBeNull();
  });

  it("lets through rivalries that are choices, accents and all", () => {
    const pairs = [
      ["Real Madrid", "Barcelona"], ["Atlético", "Sevilla"], ["Ferrari", "McLaren"], ["Man United", "Man City"], ["LeBron", "Jordan"],
      ["White Sox", "Cubs"], ["Straight", "Curly"], ["God of War", "Halo"], ["Muhammad Ali", "Tyson"], ["Turkey", "Ham"],
      ["Spice Girls", "Pizza"], ["Browns", "Steelers"], ["Trans Am", "Camaro"], ["49ers", "Rams"], ["Pokémon", "Digimon"], ["Dunkin'", "Starbucks"],
      ["French Fries", "Tots"], ["Greek Yogurt", "Skyr"],
    ];
    for (const [a, b] of pairs) expect(ownRivalryProblem(a, b), `${a} vs ${b}`).toBeNull();
  });

  it("knows every country, by the names in Hookline's country data", () => {
    for (const { name } of Object.values(COUNTRIES)) {
      // a country refused against another; ones that share a name with everyday things (Jordan, Chad) only there
      expect(ownRivalryProblem(name, "Chad"), name).not.toBeNull();
      if (!["Chad", "Chile", "Fiji", "Georgia", "Guinea", "Jordan", "Monaco", "Panama"].includes(name)) expect(namesPeople(name), name).toBe(true);
    }
  });

  it("leans grown-up, keeps the young ones and politics off to start, and has no places", () => {
    expect(RIVAL_GROUPS.map((g) => g.id)).not.toContain("places");
    expect(DEFAULT_SETTINGS.rivals.groups).toEqual(["sports", "games", "food", "cars"]);
    const young = RIVALRIES.filter((r) => r.group === "young").map((r) => `${r.red} ${r.blue}`).join(" ");
    for (const w of ["Roblox", "Minecraft", "Fortnite", "Cats"]) expect(young).toContain(w);
    for (const g of ["sports", "games", "food", "cars"]) expect(RIVALRIES.filter((r) => r.group === g).length).toBeGreaterThanOrEqual(4);
    expect(rotation(DEFAULT_SETTINGS.rivals.groups, []).some((r) => r.group === "young" || r.group === "politics")).toBe(false);
  });

  it("reads settings saved when Places was a group: it's dropped, and the rest stays", () => {
    const s = parseSettings({ game: "rivals", rivals: { groups: ["sports", "places", "food", "nonsense"], own: [{ red: "Tacos", blue: "Burritos" }], gifts: null } });
    expect(s.rivals.groups).toEqual(["sports", "food"]);
    expect(s.rivals.own).toEqual([{ red: "Tacos", blue: "Burritos" }]);
    // and a rivalry the old filter let through is dropped too
    expect(parseSettings({ rivals: { groups: ["sports"], own: [{ red: "India", blue: "Pakistan" }, { red: "Cats", blue: "Dogs" }], gifts: null } }).rivals.own).toEqual([{ red: "Cats", blue: "Dogs" }]);
  });

  it("checks each side's gifts make a fair game", () => {
    expect(validSideGifts(DEFAULT_SIDE_GIFTS)).toBe(true);
    const { red, blue } = DEFAULT_SIDE_GIFTS;
    expect(validSideGifts({ red, blue: [{ name: "Paper Crane", coins: 99 }, ...blue.slice(1)] })).toBe(false);
    expect(validSideGifts({ red: [red[1], red[0], red[2]], blue })).toBe(false);
    expect(validSideGifts({ red: red.slice(0, 2), blue })).toBe(false);
    // Hookline's cost the same, pair by pair; a streamer's own may not
    expect(priceGaps(DEFAULT_SIDE_GIFTS)).toEqual([]);
    expect(priceGaps({ red, blue: [{ name: "Doughnut", coins: 30 }, ...blue.slice(1)] })).toEqual([{ power: "Your ball", red: 99, blue: 30 }]);
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
    // a Paper Crane is red's: it moves them to red and drops their ball in there
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Paper Crane", coins: 99, count: 1 });
    expect(s.sideOf("a")).toBe(0);
    expect(w().balls.find((b) => b.tag?.id === "a")).toMatchObject({ team: 0 });
    // Hearts is blue's rage, at the same price as red's Sunglasses
    s.handle({ kind: "gift", viewer: viewer("b"), gift: "Hearts", coins: 199, count: 1 });
    expect(s.sideOf("b")).toBe(1);
    expect(w().rage[1]).toBeGreaterThan(w().clock);
    expect(w().rage[0]).toBeLessThanOrEqual(w().clock);
    expect(s.blasts.at(-1)).toMatchObject({ side: 1, tier: { effect: "rage", gift: "Hearts" } });
    // and the Boxing Gloves are blue's meteor, onto red
    s.handle({ kind: "gift", viewer: viewer("b"), gift: "Boxing Gloves", coins: 299, count: 1 });
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
    // a Perfume costs less than any power: it heals
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Perfume", coins: 20, count: 1 });
    expect(w().hp(0)).toBe(hp + 25);
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

  it("adds a shockwave and a ghost to the rocket for a gift worth several Galaxies", () => {
    const g = race();
    const said = g.gift({ viewer: viewer("u"), side: null, tier: g.menu[5], count: 1, each: 44999, total: 44999, gift: "Universe" });
    expect(g.racers.find((r) => r.id === "u")!.queued).toEqual(["rocket", "shock", "ghost"]);
    // one rocket, so the banner doesn't say "ROCKET ×3": it names what else went off
    expect(said).toEqual({ blast: true, many: undefined, extra: ["shock", "ghost"] });
    const two = g.gift({ viewer: viewer("two"), side: null, tier: g.menu[5], count: 2, each: 1000, total: 2000, gift: "2x Galaxy" });
    expect(g.racers.find((r) => r.id === "two")!.queued).toEqual(["rocket", "shock"]);
    expect(two).toMatchObject({ many: undefined, extra: ["shock"] });
    expect(g.gift({ viewer: viewer("one"), side: null, tier: g.menu[5], count: 1, each: 1000, total: 1000, gift: "Galaxy" }).many).toBeUndefined();
    // three Hand Hearts really are three ghosts
    expect(g.gift({ viewer: viewer("g"), side: null, tier: g.menu[3], count: 3, each: 99, total: 297, gift: "3x Hand Hearts" })).toMatchObject({ many: 3, extra: undefined });
    // and in a real show, the moment says what happened
    const s = new Show({ seed: 4, settings: { game: "race", vote: false } });
    s.handle({ kind: "gift", viewer: viewer("u"), gift: "Universe", coins: 44999, count: 1 });
    const b = s.blasts.at(-1)!;
    expect(b.many).toBeUndefined();
    expect(raceDraw.blastLine(s, b)).toBe("U BLASTS DOWN, KNOCKS EVERYONE BACK AND SLIPS THROUGH");
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

  it("brings down a meteor on each of the biggest rivals for a gift worth several Galaxies", () => {
    const g = fight();
    for (let i = 0; i < 8; i++) g.enter(viewer(`v${i}`));
    g.gift({ viewer: viewer("one"), side: null, tier: g.menu[5], count: 1, each: 1000, total: 1000, gift: "Galaxy" });
    expect(g.meteors).toHaveLength(1);
    const said = g.gift({ viewer: viewer("big"), side: null, tier: g.menu[5], count: 1, each: 44999, total: 44999, gift: "Universe" });
    expect(said).toMatchObject({ blast: true, many: ROYALE_METEORS });
    expect(new Set(g.meteors.slice(1).map((m) => m.target)).size).toBe(ROYALE_METEORS);
  });

  it("never brings down more meteors than there are rivals, so the banner's count is true", () => {
    // the four CPUs and one gifter: a Universe's five meteors would wrap round onto the same rivals
    const s = new Show({ seed: 5, settings: { game: "royale", vote: false } });
    s.handle({ kind: "gift", viewer: viewer("u"), gift: "Universe", coins: 44999, count: 1 });
    const g = s.game as RoyaleGame;
    const rivals = g.alive().filter((f) => f.id !== "u").length;
    expect(rivals).toBe(4);
    expect(g.meteors).toHaveLength(rivals);
    expect(new Set(g.meteors.map((m) => m.target)).size).toBe(rivals);
    const b = s.blasts.at(-1)!;
    expect(b.many).toBe(rivals);
    expect(royaleDraw.blastLine(s, b)).toBe("ON U'S 4 BIGGEST RIVALS");
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

describe("a new session after a quiet spell", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a new session once nobody real has done anything for 20 minutes, so a game left open saves each LIVE as its own", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T18:00:00Z"));
    const s = new Show({ seed: 50, settings: { game: "royale", vote: false } });
    s.handle({ kind: "chat", viewer: viewer("a"), text: "go" });
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Rose", coins: 1, count: 9 });
    const first = s.stats.id;
    // a little quiet is still the same LIVE
    vi.setSystemTime(Date.now() + SESSION_IDLE - 60_000);
    s.handle({ kind: "like", viewer: viewer("b"), count: 1 });
    expect(s.stats.id).toBe(first);
    expect(s.stats.coins).toBe(9);
    // the next day's LIVE, with the same browser source still open
    vi.setSystemTime(Date.now() + 22 * 3600_000);
    toWin(s);
    // a round with nobody real around for hours doesn't count toward the old LIVE
    expect(s.stats.rounds).toBe(0);
    s.handle({ kind: "gift", viewer: viewer("c"), gift: "Perfume", coins: 20, count: 1 });
    expect(s.stats.id).not.toBe(first);
    expect(s.stats).toMatchObject({ coins: 20, peakPlayers: 1, firstAt: Date.now(), lastAt: Date.now() });
    expect(s.topGifters().map((g) => g.viewer.id)).toEqual(["c"]);
    const p = sessionPayload(s, "k".repeat(32))!;
    expect(p.id).toBe(s.stats.id);
    expect(plausible(p)).toBe(true);
  });

  it("never starts one for pretend viewers", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T18:00:00Z"));
    const s = new Show({ seed: 51, settings: { game: "royale", vote: false } });
    s.handle({ kind: "chat", viewer: viewer("a"), text: "go" });
    const first = s.stats.id;
    vi.setSystemTime(Date.now() + SESSION_IDLE * 3);
    s.handle({ kind: "gift", viewer: { id: "demo-1", name: "demo", pretend: true }, gift: "Galaxy", coins: 1000, count: 1 });
    expect(s.stats.id).toBe(first);
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
