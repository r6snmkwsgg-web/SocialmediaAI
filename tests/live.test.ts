import { describe, expect, it } from "vitest";
import { normalize, parseMessage, type Streaks } from "@/lib/live/events";
import { giftSteps, LIKES_PER_HP, MAX_SIDE, sideFromChat, tierFor } from "@/lib/live/rules";
import { INTRO, Show } from "@/lib/live/round";
import { METEOR_HIT, World } from "@/lib/battle/sim";

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

describe("the rules", () => {
  it("reads a pick from chat, and nothing else", () => {
    expect(["1", "red", "Team 1", "#1", "RED!", "left"].map(sideFromChat)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(["2", "blue", "Blue", "team 2"].map(sideFromChat)).toEqual([1, 1, 1, 1]);
    expect(["12", "lol 1", "who wins", ""].map(sideFromChat)).toEqual([null, null, null, null]);
  });

  it("goes up the menu by the price of one gift", () => {
    expect([1, 4, 5, 19, 20, 98, 99, 298, 299, 998, 999, 30000].map((c) => tierFor(c).effect)).toEqual(["heal", "heal", "small", "small", "ball", "ball", "rage", "rage", "shield", "shield", "meteor", "meteor"]);
  });

  it("adds up a streak of cheap gifts, and keeps a streak of balls readable", () => {
    expect(giftSteps(1, 10)).toEqual([{ effect: "heal", n: 10 }]);
    expect(giftSteps(5, 8)).toEqual([{ effect: "small", n: 5 }, { effect: "heal", n: 3 }]);
    expect(giftSteps(299, 1)).toEqual([{ effect: "shield", n: 1 }, { effect: "heal", n: 10 }]);
    expect(giftSteps(5000, 1)).toEqual([{ effect: "meteor", n: 3 }]);
  });
});

describe("the arena, live", () => {
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

  it("gives a mini ball no ability: a mini sword ball never cuts", () => {
    const w = new World(4, { suddenDeath: 999 });
    for (let i = 0; i < 3; i++) w.summon(0, "sword", { small: true });
    for (let i = 0; i < 3; i++) w.summon(1, "grow", { small: true });
    run(w, 10);
    expect(w.events.some((e) => e.type === "cut")).toBe(false);
  });

  const duel = () => {
    const w = new World(9, { suddenDeath: 999 });
    w.add(0, "spike", 300, 400, { hp: 300, maxHp: 300 });
    w.add(1, "speed", 500, 400, { hp: 300, maxHp: 300 });
    return w;
  };

  it("lets rage double everything a team hits for", () => {
    const plain = duel();
    run(plain, 8);
    const raging = duel();
    raging.enrage(0, 60);
    run(raging, 8);
    expect(300 - plain.balls[1].hp).toBeGreaterThan(0);
    expect(300 - raging.balls[1].hp).toBe((300 - plain.balls[1].hp) * 2);
  });

  it("lets nothing hurt a shielded team", () => {
    const w = duel();
    w.protect(1, 60);
    run(w, 8);
    expect(w.balls[1].hp).toBe(300);
    expect(w.balls[0].hp).toBeLessThan(300);
  });

  it("drops a meteor on the other team's strongest ball", () => {
    const w = new World(1, { suddenDeath: 999 });
    w.add(0, "heal", 100, 100);
    const big = w.add(1, "speed", 600, 600, { hp: 80, maxHp: 80 });
    w.add(1, "speed", 650, 150, { hp: 5, maxHp: 5 });
    expect(w.meteor(0)).toBe(true);
    expect(w.meteors[0].target).toBe(big.id);
    run(w, 2);
    expect(w.meteors).toHaveLength(0);
    expect(big.maxHp - big.hp).toBeGreaterThanOrEqual(METEOR_HIT);
  });
});

describe("a show", () => {
  const viewer = (id: string) => ({ id, name: id });
  const toFight = (s: Show) => {
    for (let t = 0; t <= INTRO; t += 0.25) s.update(0.25);
    expect(s.phase).toBe("fight");
  };

  it("counts down, fights, crowns a winner and starts the next round", () => {
    const s = new Show(3);
    expect(s.phase).toBe("intro");
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 300 && s.round < 3; i++) {
      s.update(1 / 60);
      seen.add(s.phase);
    }
    expect([...seen].sort()).toEqual(["fight", "intro", "ko", "win"]);
    expect(s.round).toBe(3);
    expect(s.series[0] + s.series[1]).toBeGreaterThanOrEqual(1);
    expect(s.cues.some((c) => c.kind === "count")).toBe(true);
  });

  it("puts people on the team they type, and gifts from the undecided on the team that's behind", () => {
    const s = new Show(4);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    s.handle({ kind: "chat", viewer: viewer("b"), text: "nice" });
    expect(s.sideOf("a")).toBe(0);
    expect(s.sideOf("b")).toBeNull();
    s.world.balls.filter((b) => b.team === 1).forEach((b) => (b.hp = 1));
    s.handle({ kind: "gift", viewer: viewer("c"), gift: "Rose", coins: 1, count: 3 });
    expect(s.sideOf("c")).toBe(1);
  });

  it("holds a gift sent before the fight, then lands it when the fight starts", () => {
    const s = new Show(5);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "2" });
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Perfume", coins: 20, count: 1 });
    expect(s.world.count(1)).toBe(1);
    toFight(s);
    expect(s.world.count(1)).toBe(2);
    expect(s.world.balls.find((b) => b.tag?.id === "a")).toMatchObject({ team: 1, kind: s.kind(1) });
  });

  it("does what the menu says for each gift", () => {
    const s = new Show(6);
    toFight(s);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    const hp = s.world.hp(0);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Rose", coins: 1, count: 3 });
    expect(s.world.hp(0)).toBe(hp + 3);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Finger Heart", coins: 5, count: 1 });
    expect(s.world.balls.filter((b) => b.tag?.id === "a" && b.plain)).toHaveLength(1);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Hand Hearts", coins: 100, count: 1 });
    expect(s.world.rage[0]).toBeGreaterThan(s.world.clock);
    expect(s.blasts.at(-1)).toMatchObject({ side: 0, tier: { effect: "rage" } });
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Corgi", coins: 299, count: 2 });
    expect(s.world.shield[0] - s.world.clock).toBeCloseTo(12, 0);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Galaxy", coins: 1000, count: 1 });
    expect(s.world.meteors).toHaveLength(1);
    expect(s.lit.has("heal") && s.lit.has("small") && s.lit.has("meteor")).toBe(true);
  });

  it("heals the team instead once it's full", () => {
    const s = new Show(7);
    toFight(s);
    for (let i = 0; i < MAX_SIDE + 2; i++) {
      s.handle({ kind: "chat", viewer: viewer(`v${i}`), text: "1" });
      s.handle({ kind: "gift", viewer: viewer(`v${i}`), gift: "Finger Heart", coins: 5, count: 1 });
    }
    expect(s.world.count(0)).toBe(MAX_SIDE);
    expect(s.toasts.some((t) => t.text.includes("FULL"))).toBe(true);
  });

  it("puts the crown on whoever's given the most, until someone gives more", () => {
    const s = new Show(11);
    toFight(s);
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
    const s = new Show(8);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    toFight(s);
    const hp = s.world.hp(0);
    s.handle({ kind: "like", viewer: viewer("a"), count: LIKES_PER_HP * 2 + 5 });
    expect(s.world.hp(0)).toBe(hp + 2);
    expect(s.likes[0]).toBe(5);
  });
});
