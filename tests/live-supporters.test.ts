import { afterEach, describe, expect, it, vi } from "vitest";
import { PLANS } from "@/lib/billing/plans";
import type { LiveEvent, Viewer } from "@/lib/live/events";
import { HeardLog, heardIn, notesHeard } from "@/lib/live/proof";
import { over, sessionPayload, SESSION_IDLE } from "@/lib/live/session";
import { allowedBy, DEFAULT_SETTINGS, liveSettingsSchema, parseSettings } from "@/lib/live/settings";
import { INTRO, SESSION_IDLE as SHOW_IDLE, Show, WELCOME_AFTER_BLAST, WELCOME_FOR, type Phase } from "@/lib/live/show";
import { initials, overlayUpdate, supportersFrom, welcomeLine } from "@/lib/live/supporters";

/**
 * The LIVE's supporters: its top 3 gifters on screen, welcome backs for
 * the last LIVE's, and names cut down to initials when they're hidden.
 */

const viewer = (id: string, name = id): Viewer => ({ id, name });
const tester: Viewer = { id: "test-1", name: "tester one", pretend: true };
const KEY = "k".repeat(32);

const gift = (s: Show, v: Viewer, coins: number, count = 1) => s.handle({ kind: "gift", viewer: v, gift: "Gift", coins, count });
/** the top 3 as [id, coins] */
const top = (s: Show) => s.top3().map((g) => [g.viewer.id, g.coins]);
const toPlay = (s: Show) => {
  for (let t = 0; t <= INTRO; t += 0.25) s.update(0.25);
  expect(s.phase).toBe("play");
};
/** run until the next round has started */
const nextRound = (s: Show) => {
  const r = s.round;
  for (let i = 0; i < 60 * 600 && s.round === r; i++) s.update(1 / 60);
  expect(s.round).toBe(r + 1);
};
/** run the show for a while, noting each welcome back as it goes up and the part of the round it went up in */
const watch = (s: Show, seconds: number) => {
  const seen: { name: string; rank: number; at: number; phase: Phase }[] = [];
  let last = s.welcomes.at(-1)?.id;
  for (let t = 0; t < seconds; t += 0.05) {
    s.update(0.05);
    const w = s.welcomes.at(-1);
    if (w && w.id !== last) seen.push({ name: w.viewer.name, rank: w.rank, at: w.at, phase: s.phase });
    last = w?.id;
  }
  return seen;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("the LIVE's top 3 gifters", () => {
  it("keeps the LIVE's top 3 real gifters across rounds, most coins first, with ties to whoever gave first", () => {
    const s = new Show({ seed: 70, settings: { game: "royale", vote: false } });
    gift(s, viewer("a"), 20);
    gift(s, viewer("b"), 100);
    gift(s, viewer("c"), 20);
    gift(s, viewer("d"), 5);
    expect(top(s)).toEqual([["b", 100], ["a", 20], ["c", 20]]);
    // round 1's gifters are still there in round 2, though the round's own coins and crown start over
    nextRound(s);
    expect(s.crown).toBeNull();
    expect(top(s)).toEqual([["b", 100], ["a", 20], ["c", 20]]);
    // combos count every gift in them
    gift(s, viewer("d"), 100, 2);
    gift(s, viewer("c"), 1, 15);
    expect(top(s)).toEqual([["d", 205], ["b", 100], ["c", 35]]);
    // two viewers with the same name are two gifters
    const s2 = new Show({ seed: 71, settings: { vote: false } });
    gift(s2, viewer("7001", "mia"), 5);
    gift(s2, viewer("7002", "mia"), 1);
    expect(top(s2)).toEqual([["7001", 5], ["7002", 1]]);
  });

  it("starts over after 20 quiet minutes, so a game left open never shows the last LIVE's gifters as this one's", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T18:00:00Z"));
    const s = new Show({ seed: 72, settings: { vote: false } });
    gift(s, viewer("a"), 50);
    vi.setSystemTime(Date.now() + SESSION_IDLE - 60_000);
    expect(top(s)).toEqual([["a", 50]]);
    vi.setSystemTime(Date.now() + 2 * 60_000);
    expect(top(s)).toEqual([]);
    // the next LIVE's first viewer only says hello, which doesn't start a session: still nothing of the last one's
    s.handle({ kind: "chat", viewer: viewer("z"), text: "hello" });
    expect(top(s)).toEqual([]);
    gift(s, viewer("b"), 5);
    expect(top(s)).toEqual([["b", 5]]);
  });

  it("shows test-panel gifts only while no LIVE is going, and never counts them", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T18:00:00Z"));
    const s = new Show({ seed: 73, settings: { vote: false } });
    gift(s, tester, 1000);
    expect(top(s)).toEqual([["test-1", 1000]]);
    // a real viewer arriving is a LIVE going, before anyone real has given anything or even picked a side
    s.handle({ kind: "join", viewer: viewer("a") });
    expect(top(s)).toEqual([]);
    // tried again during the LIVE, it doesn't show, and never counts
    gift(s, tester, 1, 5);
    expect(top(s)).toEqual([]);
    gift(s, viewer("a"), 1);
    gift(s, tester, 1, 2);
    expect(top(s)).toEqual([["a", 1]]);
    expect(s.topGifters().map((g) => g.viewer.id)).toEqual(["a"]);
    expect(sessionPayload(s, KEY)).toMatchObject({ coins: 1, topGifters: [{ id: "a", coins: 1 }] });
    // once nobody real has done anything for 20 minutes, what was tried during the LIVE doesn't come back as its top gifters
    vi.setSystemTime(Date.now() + SESSION_IDLE + 1000);
    expect(top(s)).toEqual([]);
    // what's tried now shows, until the next LIVE's first real viewer
    gift(s, tester, 3);
    expect(top(s)).toEqual([["test-1", 3]]);
    s.handle({ kind: "chat", viewer: viewer("b"), text: "hi" });
    expect(top(s)).toEqual([]);
  });

  it("shows the name a gifter has now, after they rename mid-LIVE", () => {
    const s = new Show({ seed: 74, settings: { vote: false } });
    gift(s, viewer("7001", "kai"), 1, 3);
    s.handle({ kind: "chat", viewer: viewer("7001", "Kai the Great"), text: "1" });
    gift(s, viewer("7001", "Kai the Great"), 1, 2);
    expect(s.top3()).toMatchObject([{ viewer: { id: "7001", name: "Kai the Great" }, coins: 5 }]);
    expect(sessionPayload(s, KEY)!.topGifters).toEqual([{ id: "7001", name: "Kai the Great", coins: 5 }]);
  });
});

describe("welcome backs", () => {
  it("welcomes each of the last LIVE's top gifters back once a LIVE, whatever they do first", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T18:00:00Z"));
    const s = new Show({ seed: 60, settings: { vote: false } });
    s.setSupporters(["a", "b"]);
    toPlay(s);
    // a LIVE, then 20 quiet minutes
    s.handle({ kind: "chat", viewer: viewer("x"), text: "1" });
    vi.setSystemTime(Date.now() + SESSION_IDLE + 60_000);
    // the next LIVE: a joins, and is welcomed for that alone
    s.handle({ kind: "join", viewer: viewer("a") });
    expect(watch(s, 1).map((w) => w.name)).toEqual(["a"]);
    // then chats, likes and gives, and isn't welcomed again
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    s.handle({ kind: "like", viewer: viewer("a"), count: 5 });
    s.handle({ kind: "gift", viewer: viewer("a"), gift: "Rose", coins: 1, count: 1 });
    expect(watch(s, 60)).toEqual([]);
    // the LIVE after that, someone else's chat starts it between a's join and a's chat: still once
    vi.setSystemTime(Date.now() + SESSION_IDLE + 60_000);
    s.handle({ kind: "join", viewer: viewer("a") });
    s.handle({ kind: "chat", viewer: viewer("x"), text: "2" });
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    s.handle({ kind: "like", viewer: viewer("a"), count: 5 });
    expect(watch(s, 60).map((w) => w.name)).toEqual(["a"]);
    // b never came back, and nobody else is a supporter
    expect(s.welcomes.map((w) => w.viewer.id)).toEqual(["a", "a"]);
  });

  it("puts welcomes up only during play, one at a time, and never for a pretend viewer", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T18:00:00Z"));
    const s = new Show({ seed: 61, settings: { vote: false } });
    s.setSupporters(["a", "b", "test-1"]);
    // they come back during the countdown, and are welcomed once the fight is on
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    s.handle({ kind: "chat", viewer: viewer("b"), text: "2" });
    s.handle({ kind: "chat", viewer: { ...tester, name: "pretend" }, text: "1" });
    const seen = watch(s, 120);
    expect(seen.map((w) => [w.name, w.rank, w.phase])).toEqual([["a", 1, "play"], ["b", 2, "play"]]);
    expect(seen[0].at).toBeGreaterThanOrEqual(INTRO);
    expect(seen[1].at - seen[0].at).toBeGreaterThanOrEqual(WELCOME_FOR);
    expect(s.cues.some((c) => c.kind === "join" && c.at === seen[0].at)).toBe(true);
    // at the next LIVE, one queued as the round ends waits for the next round's fight
    vi.setSystemTime(Date.now() + SESSION_IDLE + 60_000);
    s.setSupporters(["c"]);
    while (s.phase !== "ko") s.update(0.05);
    s.handle({ kind: "chat", viewer: viewer("c"), text: "1" });
    const later = watch(s, 60);
    expect(later.map((w) => [w.name, w.phase])).toEqual([["c", "play"]]);
    expect(welcomeLine(1)).toBe("TOP SUPPORTER LAST LIVE");
    expect([2, 3].map(welcomeLine)).toEqual(["IN THE TOP 3 LAST LIVE", "IN THE TOP 3 LAST LIVE"]);
  });

  it("waits until a big gift's moment is over, even with another queued behind it", () => {
    const s = new Show({ seed: 62, settings: { vote: false } });
    s.setSupporters(["a"]);
    toPlay(s);
    s.join(viewer("x"), 0);
    gift(s, viewer("x"), 1000);
    const galaxy = s.blasts.at(-1)!;
    s.update(0.5);
    gift(s, viewer("x"), 44999);
    const universe = s.blasts.at(-1)!;
    expect(universe.id).not.toBe(galaxy.id);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    const [w] = watch(s, 60);
    // the Galaxy's moment runs 3 s, then the Universe's 4 s: both are over 7 s in, and the welcome goes up 8 s after the newest
    expect(w.phase).toBe("play");
    expect(w.at).toBeGreaterThanOrEqual(galaxy.at + 7);
    expect(w.at - universe.at).toBeGreaterThanOrEqual(WELCOME_AFTER_BLAST);
    expect(w.at - universe.at).toBeLessThan(WELCOME_AFTER_BLAST + 0.2);
  });

  it("never welcomes someone back to the LIVE they're giving in, when the list changes in the middle of it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T18:00:00Z"));
    const s = new Show({ seed: 64, settings: { vote: false } });
    s.setSupporters(["a"]);
    toPlay(s);
    gift(s, viewer("kai"), 50);
    // the list again, and then one from earlier in this LIVE: a reload split it, or it went on 20 minutes with only hellos, which the server can't hear
    vi.setSystemTime(Date.now() + 5 * 60_000);
    s.setSupporters(["a"]);
    s.setSupporters(["kai", "a"]);
    s.handle({ kind: "like", viewer: viewer("kai"), count: 5 });
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    // a was on the list all along, so a is welcomed; kai gave in this LIVE, so kai isn't
    expect(watch(s, 60).map((w) => [w.name, w.rank])).toEqual([["a", 2]]);
    // the next LIVE, kai is welcomed back once
    vi.setSystemTime(Date.now() + SESSION_IDLE + 60_000);
    s.handle({ kind: "like", viewer: viewer("kai"), count: 5 });
    s.handle({ kind: "chat", viewer: viewer("kai"), text: "2" });
    expect(watch(s, 60).map((w) => [w.name, w.rank])).toEqual([["kai", 1]]);
  });

  it("puts a welcome back up again when a big gift lands while it's showing, so the gift's moment never hides it", () => {
    const s = new Show({ seed: 65, settings: { vote: false } });
    s.setSupporters(["a"]);
    toPlay(s);
    s.join(viewer("x"), 0);
    s.handle({ kind: "chat", viewer: viewer("a"), text: "1" });
    const [first] = watch(s, 0.3);
    expect(first).toMatchObject({ name: "a", rank: 1, phase: "play" });
    gift(s, viewer("x"), 1000);
    const galaxy = s.blasts.at(-1)!;
    expect(galaxy.at - first.at).toBeLessThan(WELCOME_FOR);
    // taken down for the Galaxy's moment, and up again once nothing big can still be on screen
    expect(s.welcomes).toEqual([]);
    const again = watch(s, 60);
    expect(again.map((w) => [w.name, w.rank, w.phase])).toEqual([["a", 1, "play"]]);
    expect(again[0].at - galaxy.at).toBeGreaterThanOrEqual(WELCOME_AFTER_BLAST);
    // one that's had its time stays down
    gift(s, viewer("x"), 1000);
    expect(watch(s, 60)).toEqual([]);
  });

  it("lets the test panel try a welcome back with a pretend viewer", () => {
    const s = new Show({ seed: 63, settings: { vote: false } });
    toPlay(s);
    s.welcome(tester, 1);
    expect(watch(s, 1)).toMatchObject([{ name: "tester one", rank: 1, phase: "play" }]);
  });
});

describe("the last LIVE's supporters", () => {
  it("welcomes back only a verified LIVE's top 3 who gave something, best first", () => {
    const top5 = [
      { id: "a", name: "A", coins: 5 },
      { id: "b", name: "B", coins: 50 },
      { id: "c", name: "C", coins: 0 },
      { id: "d", name: "D", coins: 20 },
      { id: "e", name: "E", coins: 10 },
    ];
    expect(supportersFrom({ verified: true, top_gifters: top5 })).toEqual(["b", "d", "e"]);
    expect(supportersFrom({ verified: false, top_gifters: top5 })).toEqual([]);
    expect(supportersFrom(null)).toEqual([]);
    expect(supportersFrom({ verified: true, top_gifters: [] })).toEqual([]);
    expect(supportersFrom({ verified: true, top_gifters: "nothing like it" as never })).toEqual([]);
  });

  it("reads the game's poll: whether names are hidden and up to 3 ids, and nothing from a bad answer", () => {
    expect(overlayUpdate({ settings: { ...DEFAULT_SETTINGS, hideNames: true }, tag: false, supporters: ["7001", "7002", "7003", "7004"] })).toEqual({ hideNames: true, supporters: ["7001", "7002", "7003"] });
    expect(overlayUpdate({ settings: { game: "race" }, tag: true, supporters: [] })).toEqual({ hideNames: false, supporters: [] });
    expect(overlayUpdate({ settings: { hideNames: "yes" }, supporters: [7001, "", "x".repeat(65), "7002", null] })).toEqual({ hideNames: false, supporters: ["7002"] });
    for (const junk of [null, "nope", 42, [], {}, { settings: null, supporters: [] }, { settings: "x", supporters: [] }, { settings: {} }, { settings: {}, supporters: "7001" }]) {
      expect(overlayUpdate(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it("calls a LIVE over after 20 quiet minutes, by one rule everywhere", () => {
    const now = Date.UTC(2026, 9, 16, 18);
    expect(SESSION_IDLE).toBe(20 * 60_000);
    expect(SHOW_IDLE).toBe(SESSION_IDLE);
    expect(over(now - SESSION_IDLE, now)).toBe(false);
    expect(over(now - SESSION_IDLE - 1, now)).toBe(true);
    expect(over(new Date(now - 2 * 60_000), new Date(now))).toBe(false);
    expect(over(new Date(now - 3600_000), now)).toBe(true);
  });
});

describe("hiding viewers' names", () => {
  it("cuts a name down to initials, in any alphabet", () => {
    expect(initials("Kayla Smith")).toBe("K.S.");
    expect(initials("xX_gamer_Xx")).toBe("X.G.");
    expect(initials("kai")).toBe("K.");
    expect(initials("Élodie")).toBe("É.");
    expect(initials("Élodie")).toBe("É.");
    expect(initials("дмитрий иванов")).toBe("Д.И.");
    expect(initials("नमस्ते दोस्त")).toBe("न.द.");
    // fancy-text letters come down to plain ones
    expect(initials("𝓚𝓪𝔂𝓵𝓪 𝓢𝓶𝓲𝓽𝓱")).toBe("K.S.");
    expect(initials("ＫＡＩ")).toBe("K.");
    expect(initials("🔥🔥🔥")).toBe("a viewer");
    expect(initials("")).toBe("a viewer");
  });

  it("shows names unless the streamer hides them, on every plan", () => {
    expect(DEFAULT_SETTINGS.hideNames).toBe(false);
    expect(parseSettings({}).hideNames).toBe(false);
    expect(parseSettings({ hideNames: true }).hideNames).toBe(true);
    expect(parseSettings({ hideNames: "true" }).hideNames).toBe(false);
    expect(parseSettings({ hideNames: 1 }).hideNames).toBe(false);
    for (const plan of Object.values(PLANS)) expect(allowedBy(parseSettings({ hideNames: true }), plan).hideNames, plan.id).toBe(true);
    // a settings form opened before there was a switch still saves
    const old: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    delete old.hideNames;
    expect(liveSettingsSchema.safeParse(old)).toMatchObject({ success: true, data: { hideNames: false } });
  });
});

describe("whose LIVE a session heard", () => {
  it("notes every real event in a session's heard list except joins, which never start a session", () => {
    const real = viewer("7001"), fake: Viewer = { id: "demo-1", name: "demo", pretend: true };
    const events: LiveEvent[] = [
      { kind: "chat", viewer: real, text: "hi" },
      { kind: "like", viewer: real, count: 3 },
      { kind: "gift", viewer: real, gift: "Rose", coins: 1, count: 1 },
      { kind: "follow", viewer: real },
      { kind: "share", viewer: real },
    ];
    expect(events.map(notesHeard)).toEqual([true, true, true, true, true]);
    expect(notesHeard({ kind: "join", viewer: real })).toBe(false);
    expect(events.map((e) => notesHeard({ ...e, viewer: fake }))).toEqual([false, false, false, false, false]);
  });

  it("notes nothing heard after 20 quiet minutes under the last session, so another LIVE can't unverify it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T18:00:00Z"));
    const s = new Show({ seed: 76, settings: { vote: false } });
    const log = new HeardLog();
    // as the game does it: the show takes the event first, then it's noted where it went
    const hear = (e: LiveEvent, user: string | null) => {
      s.handle(e);
      const id = heardIn(s, e);
      if (id) log.note(id, user);
    };
    const kai = viewer("7001", "kai");
    // a LIVE on the streamer's own TikTok, through the bridge
    hear({ kind: "like", viewer: kai, count: 5 }, "k.streams");
    hear({ kind: "follow", viewer: kai }, "k.streams");
    hear({ kind: "share", viewer: kai }, "k.streams");
    const last = s.stats.id;
    const sent = JSON.stringify(sessionPayload(s, KEY, log.of(last)));
    // 20 quiet minutes on, the game hears another LIVE through a source that doesn't say whose: a hello, a second follow and share, a join
    vi.setSystemTime(Date.now() + SESSION_IDLE + 60_000);
    const quiet: LiveEvent[] = [
      { kind: "chat", viewer: viewer("8001"), text: "hi" },
      { kind: "follow", viewer: kai },
      { kind: "share", viewer: kai },
      { kind: "join", viewer: viewer("8002") },
    ];
    for (const e of quiet) hear(e, null);
    // none of it started a session, and none of it went on the last one, so the game has nothing new to send for it
    expect(s.stats.id).toBe(last);
    expect(log.of(last)).toEqual({ heard: ["k.streams"], unknown: false, broadcasts: [] });
    expect(JSON.stringify(sessionPayload(s, KEY, log.of(last)))).toBe(sent);
    // the first thing that takes part starts the next session, and is noted there, and so is a hello while it's going
    hear({ kind: "like", viewer: viewer("8001"), count: 3 }, null);
    expect(s.stats.id).not.toBe(last);
    hear({ kind: "chat", viewer: viewer("8003"), text: "hi" }, "friend.live");
    expect(log.of(s.stats.id)).toEqual({ heard: ["friend.live"], unknown: true, broadcasts: [] });
    expect(log.of(last)).toEqual({ heard: ["k.streams"], unknown: false, broadcasts: [] });
  });
});
