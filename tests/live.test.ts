import { describe, expect, it } from "vitest";
import { normalize, parseMessage, type Streaks } from "@/lib/live/events";
import { giftSteps, sideFromChat, tierFor, LIKES_PER_HP } from "@/lib/live/rules";
import { INTRO, Show } from "@/lib/live/round";
import { World } from "@/lib/battle/sim";

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
    const names: [string, string] = ["Spike", "Fibonacci"];
    expect(["1", "L", "left", "Team 1", "#1", "spike!"].map((t) => sideFromChat(t, names))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(["2", "r", "RIGHT", "fibonacci"].map((t) => sideFromChat(t, names))).toEqual([1, 1, 1, 1]);
    expect(["12", "lol 1", "who wins", ""].map((t) => sideFromChat(t, names))).toEqual([null, null, null, null]);
  });

  it("climbs the ladder by coins, and keeps a streak of summons readable", () => {
    expect([1, 4, 5, 19, 20, 99, 298, 299, 999, 30000].map((c) => tierFor(c).effect)).toEqual(["heal", "heal", "small", "small", "ball", "rage", "rage", "shield", "meteor", "meteor"]);
    expect(giftSteps(1, 10)).toEqual([{ effect: "heal", n: 10 }]);
    expect(giftSteps(5, 20)).toEqual([{ effect: "small", n: 6 }, { effect: "heal", n: 14 }]);
    expect(giftSteps(5000, 1)).toEqual([{ effect: "meteor", n: 3 }]);
  });
});

describe("the arena, live", () => {
  it("lets a shield block everything and rage double it", () => {
    const run = (setup: (w: World) => void) => {
      const w = new World(5, { suddenDeath: 999 });
      w.add(0, "spike", 300, 400, { hp: 200, maxHp: 200 });
      w.add(1, "grow", 500, 400, { hp: 200, maxHp: 200 });
      setup(w);
      for (let i = 0; i < 60 * 8; i++) w.tick();
      return w.balls[1].maxHp - w.balls[1].hp;
    };
    const plain = run(() => {});
    expect(plain).toBeGreaterThan(0);
    expect(run((w) => w.buff(1, "shield", 60))).toBe(0);
    expect(run((w) => w.buff(0, "rage", 60))).toBe(plain * 2);
  });

  it("drops a meteor on the strongest enemy a moment later", () => {
    const w = new World(1, { suddenDeath: 999 });
    w.add(0, "heal", 100, 100);
    const big = w.add(1, "grow", 600, 600, { hp: 40, maxHp: 40 });
    w.add(1, "grow", 600, 200, { hp: 5, maxHp: 5 });
    expect(w.meteor(0)).toBe(true);
    expect(w.meteors[0].target).toBe(big.id);
    for (let i = 0; i < 60 * 2; i++) w.tick();
    expect(w.meteors).toHaveLength(0);
    expect(big.hp).toBeLessThan(big.maxHp);
    expect(w.events.some((e) => e.type === "meteor")).toBe(true);
  });

  it("puts a summoned ball on its side, with the viewer's name, until the side is full", () => {
    const w = new World(2, { maxTeam: 3 });
    w.add(1, "spike", 600, 400);
    const b = w.summon(1, "spike", { small: true, tag: { name: "kayla" } });
    expect(b?.x).toBeGreaterThan(400);
    expect(b?.tag?.name).toBe("kayla");
    expect(w.summon(1, "spike")).not.toBeNull();
    expect(w.summon(1, "spike")).toBeNull();
  });
});

describe("a show", () => {
  const viewer = (id: string) => ({ id, name: id });

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

  it("puts people on the side they type, and gifts from the undecided on the side that's behind", () => {
    const s = new Show(4);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    s.handle({ kind: "chat", viewer: viewer("b"), text: "nice" });
    expect(s.sideOf("a")).toBe(0);
    expect(s.sideOf("b")).toBeNull();
    // make side 2 the one that's behind
    s.world.balls.filter((b) => b.team === 1).forEach((b) => (b.hp = 1));
    s.handle({ kind: "gift", viewer: viewer("c"), gift: "Rose", coins: 1, count: 3 });
    expect(s.sideOf("c")).toBe(1);
    expect(s.top(1)[0]).toMatchObject({ coins: 3 });
  });

  it("holds gifts sent before the fight and lands them when it starts", () => {
    const s = new Show(5);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "2" });
    const before = s.world.count(1);
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Perfume", coins: 20, count: 1 });
    expect(s.world.count(1)).toBe(before);
    s.update(0.25);
    for (let t = 0.25; t <= INTRO; t += 0.25) s.update(0.25);
    expect(s.phase).toBe("fight");
    expect(s.world.count(1)).toBe(before + 1);
    expect(s.world.balls.find((b) => b.tag?.name === "a")).toBeTruthy();
  });

  it("turns likes into health", () => {
    const s = new Show(6);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    for (let t = 0; t <= INTRO; t += 0.25) s.update(0.25);
    expect(s.phase).toBe("fight");
    const hp = s.world.hp(0);
    s.handle({ kind: "like", viewer: viewer("a"), count: LIKES_PER_HP * 2 + 5 });
    expect(s.world.hp(0)).toBe(hp + 2);
    expect(s.likes[0]).toBe(5);
  });
});
