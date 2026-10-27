import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSource } from "@/components/live/source";
import { allowedOrigin, bridgeStatusOf, cleanUser, localHost, newer, siteList, switchOf, versionOf } from "@/lib/live/bridge";
import { connectionView, GRACE_MS, NOT_CONNECTED, QUIET_MS, sinceAfter, type Hearing, type SocketState } from "@/lib/live/connection";
import { giftsLine, liveFit, parseLiveCheck, sellLive } from "@/lib/live/eligibility";
import { lastGoodKey, readLastGood, writeLastGood } from "@/lib/live/last-good";
import { HeardLog, NO_USERNAMES, ownLive, recapNote, whyNotCounted } from "@/lib/live/proof";
import { sessionPayload, sessionSchema } from "@/lib/live/session";
import { DEFAULT_SETTINGS } from "@/lib/live/settings";
import { Show } from "@/lib/live/show";
import { lookUp } from "@/lib/server/live";
import { clockTime } from "@/lib/live/connection";
import { heardIn } from "@/lib/live/proof";
import { OLD_ADDRESS } from "@/lib/live/last-good";
import type { YouTubeStatus } from "@/lib/live/youtube";
import { parseYtLiveCheck, ytLiveFit, type YtLiveCheck } from "@/lib/live/eligibility";
import { NOT_HEARD_ON_YOUTUBE } from "@/lib/live/proof";
import { youtubeSetupLine } from "@/lib/live/connection";

const bridge = (state: string, user: string | null = "kayla.live", extra: Record<string, unknown> = {}) => JSON.stringify({ event: "bridge", data: { state, user, error: null, version: "1.1.0", ...extra } });

describe("the bridge's side of things", () => {
  it("reads a username however it's typed", () => {
    expect(cleanUser(" @Kayla.Live ")).toBe("kayla.live");
    expect(cleanUser("no spaces please")).toBeNull();
    expect(cleanUser("x")).toBeNull();
    expect(cleanUser(42)).toBeNull();
  });

  it("reads the bridge's status, and nothing else", () => {
    expect(bridgeStatusOf(bridge("live"))).toEqual({ state: "live", user: "kayla.live", error: null, version: "1.1.0" });
    expect(bridgeStatusOf({ event: "bridge", data: { state: "off", user: null, error: "Switched off" } })).toMatchObject({ state: "off", error: "Switched off" });
    expect(bridgeStatusOf(bridge("dancing"))).toBeNull();
    expect(bridgeStatusOf(JSON.stringify({ event: "gift", data: { state: "live" } }))).toBeNull();
    expect(bridgeStatusOf("not json about the bridge")).toBeNull();
  });

  it("lets in Hookline's own site and pages on this computer, and no other website", () => {
    const sites = siteList("https://hookline.example, not a url ,https://www.hookline.example/");
    expect(sites).toEqual(["https://hookline.example", "https://www.hookline.example"]);
    expect(allowedOrigin("https://hookline.example", sites)).toBe(true);
    expect(allowedOrigin("https://www.hookline.example", sites)).toBe(true);
    expect(allowedOrigin("http://localhost:3000", sites)).toBe(true);
    expect(allowedOrigin("http://127.0.0.1:21214", sites)).toBe(true);
    expect(allowedOrigin("https://evil.example", sites)).toBe(false);
    expect(allowedOrigin("https://hookline.example.evil.example", sites)).toBe(false);
    expect(allowedOrigin("http://hookline.example", sites)).toBe(false);
    expect(allowedOrigin("null", sites)).toBe(false);
    expect(allowedOrigin("file://", sites)).toBe(false);
    // programs that aren't browsers don't say where they're from
    expect(allowedOrigin(undefined, sites)).toBe(true);
    // without a site, only this computer
    expect(allowedOrigin("https://hookline.example", [])).toBe(false);
  });

  it("only answers requests addressed to this computer", () => {
    expect(localHost("localhost:21214", 21214)).toBe(true);
    expect(localHost("127.0.0.1:21214", 21214)).toBe(true);
    expect(localHost("evil.example:21214", 21214)).toBe(false);
    expect(localHost("localhost:9999", 21214)).toBe(false);
    expect(localHost(undefined, 21214)).toBe(false);
  });

  it("stays on unless Hookline clearly says off", () => {
    expect(switchOf({ on: false, message: "Use TikFinity" })).toEqual({ on: false, message: "Use TikFinity" });
    expect(switchOf({ on: true, message: null })).toEqual({ on: true, message: null });
    expect(switchOf(null).on).toBe(true);
    expect(switchOf("<html>error</html>").on).toBe(true);
    expect(switchOf({}).on).toBe(true);
  });

  it("knows when a newer bridge is out", () => {
    expect(versionOf("bridge-v1.2.3")).toEqual([1, 2, 3]);
    expect(versionOf("bridge-latest")).toBeNull();
    expect(newer("bridge-v1.1.0", "1.0.0")).toBe(true);
    expect(newer("bridge-v1.10.0", "1.9.9")).toBe(true);
    expect(newer("bridge-v1.0.0", "1.0.0")).toBe(false);
    expect(newer("bridge-v1.0.0", "1.1.0")).toBe(false);
    expect(newer("bridge-latest", "1.0.0")).toBe(false);
  });
});

describe("whether the game can hear the LIVE", () => {
  const now = 10_000_000;
  const at = (h: Partial<Hearing>): Hearing => ({ name: "TikFinity", socket: "open", since: now - 60_000, bridge: null, heardAt: now - 1000, now, ...h });
  const b = (state: string, user: string | null = "kayla.live") => bridgeStatusOf(bridge(state, user))!;
  /** what shows on the stream: the grey line and the orange bar */
  const top = (h: Partial<Hearing>) => {
    const v = connectionView(at(h));
    return { status: v.status, notice: v.notice };
  };

  it("waits a moment for the tool, then says plainly it isn't connected", () => {
    expect(top({ socket: "closed", since: now - 5000 })).toEqual({ status: "WAITING FOR TIKFINITY…", notice: undefined });
    expect(top({ socket: "connecting", since: now - GRACE_MS })).toEqual({ status: undefined, notice: `${NOT_CONNECTED} · OPEN TIKFINITY` });
  });

  it("says NOT CONNECTED when the bridge is running but not on the LIVE", () => {
    for (const state of ["idle", "waiting", "error"]) {
      const v = connectionView(at({ name: "Hookline Bridge", bridge: b(state) }));
      expect(v.notice, state).toBe(NOT_CONNECTED);
      expect(v.hint, state).not.toBe("");
    }
    expect(connectionView(at({ name: "Hookline Bridge", bridge: b("waiting") })).hint).toMatch(/@kayla\.live isn't live/);
    expect(top({ name: "Hookline Bridge", bridge: b("connecting") })).toEqual({ status: "CONNECTING TO YOUR LIVE…", notice: undefined });
    expect(connectionView(at({ name: "Hookline Bridge", bridge: b("off") })).notice).toBe("HOOKLINE BRIDGE IS OFF · USE TIKFINITY");
  });

  it("looks healthy while it's hearing the LIVE", () => {
    expect(top({ name: "Hookline Bridge", bridge: b("live") })).toEqual({ status: undefined, notice: undefined });
    expect(connectionView(at({ name: "Hookline Bridge", bridge: b("live") })).hint).toBe("Connected to @kayla.live's LIVE through the bridge.");
    expect(top({})).toEqual({ status: undefined, notice: undefined });
  });

  it("mentions a long silence quietly, without the alarm bar", () => {
    const v = connectionView(at({ heardAt: now - QUIET_MS - 60_000 }));
    expect(v.notice).toBeUndefined();
    expect(v.status).toBe("NOTHING HEARD IN 6 MIN");
    expect(v.hint).toMatch(/TikFinity is signed in/);
    expect(connectionView(at({ heardAt: now - QUIET_MS + 1000 })).status).toBeUndefined();
  });

  it("says why it's on TikFinity once the bridge has been switched off", () => {
    expect(connectionView(at({ bridgeOff: true })).hint).toMatch(/switched off/);
  });
});

describe("the live source", () => {
  class FakeSocket {
    static last: FakeSocket;
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    onmessage?: (m: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    constructor(readonly url: string) {
      FakeSocket.last = this;
    }
    send() {}
    close() {}
  }
  afterEach(() => vi.unstubAllGlobals());

  it("passes on the bridge's status apart from what viewers do", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const events: string[] = [];
    const statuses: string[] = [];
    const s = new LiveSource("ws://localhost:21214/", { onEvent: (e) => events.push(e.kind), onStatus: (b) => statuses.push(`${b.state}:${b.user}`) });
    s.start();
    FakeSocket.last.onopen!();
    FakeSocket.last.onmessage!({ data: bridge("waiting") });
    FakeSocket.last.onmessage!({ data: JSON.stringify({ event: "chat", data: { comment: "1", user: { userId: "7", uniqueId: "mia" } } }) });
    FakeSocket.last.onmessage!({ data: bridge("live") });
    expect(statuses).toEqual(["waiting:kayla.live", "live:kayla.live"]);
    expect(events).toEqual(["chat"]);
    s.stop();
  });
});

describe("what the game says over time, with the real retrying socket", () => {
  /**
   * A socket to a tool that's running while `up` is true: it opens, or
   * fails as a socket to nothing on that port does.
   */
  class ToolSocket {
    static up = false;
    static last: ToolSocket;
    static OPEN = 1;
    readyState = 0;
    onopen?: () => void;
    onmessage?: (m: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    constructor(readonly url: string) {
      ToolSocket.last = this;
      const up = ToolSocket.up;
      setTimeout(() => (up ? ((this.readyState = 1), this.onopen?.()) : this.onerror?.()), 5);
    }
    send() {}
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }

  /** The game's own bookkeeping (components/live/game.tsx), driven by a real LiveSource, read back as what the top of the game says. */
  function listen() {
    const h = { socket: "closed" as SocketState, since: Date.now(), bridge: null, heardAt: Date.now() };
    const s = new LiveSource("ws://localhost:21213/", {
      onEvent: () => {},
      onState: (st) => {
        h.since = sinceAfter(h.socket, st, h.since, Date.now());
        h.socket = st;
        if (st === "open") h.heardAt = Date.now();
      },
    });
    s.start();
    const top = () => {
      const v = connectionView({ ...h, name: "TikFinity", now: Date.now() });
      return v.notice ?? v.status ?? "ok";
    };
    return { s, top };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("only starts the grace over when the socket opens or drops, not on every retry", () => {
    expect(sinceAfter("connecting", "closed", 5, 99)).toBe(5);
    expect(sinceAfter("closed", "connecting", 5, 99)).toBe(5);
    expect(sinceAfter("connecting", "open", 5, 99)).toBe(99);
    expect(sinceAfter("open", "closed", 5, 99)).toBe(99);
  });

  it("says NOT CONNECTED once TikFinity has been missing a while, and keeps saying it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubGlobal("WebSocket", ToolSocket);
    ToolSocket.up = false;
    const { s, top } = listen();
    vi.advanceTimersByTime(GRACE_MS - 1000);
    expect(top()).toBe("WAITING FOR TIKFINITY…");
    vi.advanceTimersByTime(2000);
    expect(top()).toBe(`${NOT_CONNECTED} · OPEN TIKFINITY`);
    for (let t = 0; t < 180_000; t += 1000) {
      vi.advanceTimersByTime(1000);
      expect(top()).toBe(`${NOT_CONNECTED} · OPEN TIKFINITY`);
    }
    // opening TikFinity fixes it by itself, within one retry
    ToolSocket.up = true;
    vi.advanceTimersByTime(10_100);
    expect(top()).toBe("ok");
    s.stop();
  });

  it("gives a dropped connection the same grace, then says so", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubGlobal("WebSocket", ToolSocket);
    ToolSocket.up = true;
    const { s, top } = listen();
    vi.advanceTimersByTime(60_000);
    expect(top()).toBe("ok");
    ToolSocket.up = false;
    ToolSocket.last.close();
    vi.advanceTimersByTime(GRACE_MS - 1000);
    expect(top()).toBe("WAITING FOR TIKFINITY…");
    vi.advanceTimersByTime(2000);
    expect(top()).toBe(`${NOT_CONNECTED} · OPEN TIKFINITY`);
    s.stop();
  });
});

describe("whose LIVE a session heard", () => {
  it("reports the LIVEs it heard, and says when any of it came from a source that didn't say whose it was", () => {
    const log = new HeardLog();
    log.note("s1", "kayla.live");
    log.note("s1", "kayla.live");
    expect(log.of("s1")).toEqual({ heard: ["kayla.live"], unknown: false, broadcasts: [] });
    log.note("s1", "famous.one");
    expect(log.of("s1")).toEqual({ heard: ["kayla.live", "famous.one"], unknown: false, broadcasts: [] });
    // the bridge, then TikFinity (after the bridge was switched off), then the bridge again: still unknown
    log.note("s2", "kayla.live");
    log.note("s2", null);
    log.note("s2", "kayla.live");
    expect(log.of("s2")).toEqual({ heard: ["kayla.live"], unknown: true, broadcasts: [] });
    expect(log.of("never")).toEqual({ heard: [], unknown: false, broadcasts: [] });
  });

  it("counts a session only when every LIVE it heard is theirs", () => {
    expect(ownLive(["kayla.live"], ["kayla.live"])).toBe(true);
    expect(ownLive(["kayla.live", "famous.one"], ["kayla.live"])).toBe(false);
    expect(ownLive([], ["kayla.live"])).toBe(false);
    expect(ownLive(["kayla.live"], [])).toBe(false);
  });

  it("says plainly why one doesn't count", () => {
    expect(whyNotCounted({ verified: true, heard: ["kayla.live"] }, ["kayla.live"])).toBeNull();
    expect(whyNotCounted({ verified: false, heard: [] }, ["kayla.live"])).toMatch(/couldn't tell whose LIVE/);
    expect(whyNotCounted({ verified: false, heard: ["famous.one"] }, [])).toMatch(/Connect that TikTok/);
    expect(whyNotCounted({ verified: false, heard: ["famous.one", "kayla.live"] }, ["kayla.live"])).toBe("The game heard @famous.one, not your connected TikTok (@kayla.live).");
    // their own LIVE, but part of it through TikFinity
    expect(whyNotCounted({ verified: false, heard: ["kayla.live"], unknown: true }, ["kayla.live"])).toMatch(/^Part of it came through TikFinity/);
    expect(whyNotCounted({ verified: false, heard: ["famous.one"], unknown: true }, ["kayla.live"])).toMatch(/@famous\.one/);
    // connecting TikTok wouldn't help a session that can't be checked, so it doesn't say to
    expect(whyNotCounted({ verified: false, heard: ["kayla.live"], unknown: true }, [])).not.toMatch(/Connect/);
  });

  it("doesn't send anyone to connect TikTok while Hookline can't read usernames", () => {
    expect(whyNotCounted({ verified: false, heard: ["kayla.live"] }, [], false)).toBe("The game heard @kayla.live, but Hookline can't check TikTok usernames yet.");
    expect(whyNotCounted({ verified: false, heard: [] }, [], false)).toBe("Hookline can't check TikTok usernames yet.");
    expect(NO_USERNAMES).not.toMatch(/Connect|—/);
    // usernames read before it was switched off still count
    expect(whyNotCounted({ verified: true, heard: ["kayla.live"] }, ["kayla.live"], false)).toBeNull();
    expect(whyNotCounted({ verified: false, heard: ["famous.one"] }, ["kayla.live"], false)).toMatch(/@famous\.one/);
    const note = recapNote({ rounds: 1, coins: 10, peakPlayers: 2, verified: false, heard: ["kayla.live"] }, [], false);
    expect(note.body).toMatch(/can't check TikTok usernames yet/);
    expect(note.body).not.toMatch(/Connect/);
  });

  it("recaps a verified LIVE's coins as coins seen, and an unverified one as not counted", () => {
    const base = { rounds: 9, coins: 1234, peakPlayers: 17 };
    expect(recapNote({ ...base, verified: true, heard: ["kayla.live"] }, ["kayla.live"])).toEqual({
      title: "LIVE recap: 9 rounds, 1,234 gift coins seen",
      body: "17 playing at once. Your recap card is ready.",
    });
    const no = recapNote({ ...base, verified: false, heard: ["famous.one"] }, ["kayla.live"]);
    expect(no.title).toBe("LIVE recap: 9 rounds, not verified");
    expect(no.body).toMatch(/@famous\.one.*1,234 gift coins seen don't count in Earnings/);
    expect(`${no.title} ${no.body}`).not.toMatch(/earn(ed|ings? of)|\$|—/);
  });

  it("sends the LIVEs it heard with the session's numbers", () => {
    const s = new Show({ seed: 41, settings: { game: "royale", vote: false } });
    s.handle({ kind: "chat", viewer: { id: "a", name: "a" }, text: "go" });
    const p = sessionPayload(s, "k".repeat(32), { heard: ["kayla.live"], unknown: false, broadcasts: [] })!;
    expect(p.heard).toEqual(["kayla.live"]);
    expect(sessionSchema.parse(p)).toMatchObject({ heard: ["kayla.live"], unknown: false });
    expect(sessionPayload(s, "k".repeat(32), { heard: ["kayla.live"], unknown: true, broadcasts: [] })!.unknown).toBe(true);
    // an older game sends no LIVEs at all: it just doesn't count
    const { heard: _, unknown: __, ...old } = p;
    void _;
    void __;
    expect(sessionSchema.parse(old)).toMatchObject({ heard: [], unknown: false });
    expect(sessionSchema.safeParse({ ...p, heard: ["Not A Username!"] }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...p, heard: Array.from({ length: 11 }, (_, i) => `user${i}`) }).success).toBe(false);
  });
});

describe("who can earn from the LIVE games", () => {
  it("is ready only with both: a TikTok that can go LIVE, and a computer. Age is the terms' to say, not a question here", () => {
    expect(liveFit(null)).toEqual({ asked: false });
    expect(liveFit({ canGoLive: true, computer: true })).toEqual({ asked: true, ok: true, reasons: [] });
    const neither = liveFit({ canGoLive: false, computer: false });
    expect(neither).toMatchObject({ asked: true, ok: false });
    expect(neither.asked && neither.reasons).toHaveLength(2);
    expect(neither.asked && neither.reasons.join(" ")).not.toMatch(/18/);
    expect(liveFit({ canGoLive: true, computer: false })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/computer/)] });
  });

  it("offers the paid LIVE games only to someone who can earn with them, or hasn't said", () => {
    expect(sellLive(null)).toBe(true);
    expect(sellLive({ canGoLive: true, computer: true })).toBe(true);
    expect(sellLive({ canGoLive: false, computer: true })).toBe(false);
  });

  it("says what TikTok needs for gifts, and never what anything will earn", () => {
    const answers = [null, { canGoLive: true, computer: true }, { canGoLive: false, computer: true }];
    for (const c of answers) expect(giftsLine(c)).not.toMatch(/\bwill\b|earn|income|money|—/i);
    expect(giftsLine(null)).toMatch(/18 or older/);
    expect(giftsLine(answers[2])).toMatch(/can't get gifts on a TikTok LIVE yet/);
  });

  it("reads saved answers, and nothing else", () => {
    expect(parseLiveCheck({ canGoLive: false, computer: true })).toEqual({ canGoLive: false, computer: true });
    // an answer saved when age was still asked reads without it
    expect(parseLiveCheck({ adult: false, canGoLive: true, computer: true })).toEqual({ canGoLive: true, computer: true });
    expect(parseLiveCheck({ canGoLive: "yes" })).toBeNull();
    expect(parseLiveCheck(null)).toBeNull();
  });
});

describe("who can play on YouTube Live", () => {
  const all: YtLiveCheck = { canGoLive: true, computer: true, superChat: true };

  it("lets everyone with all three play, and says why not, in order: a channel that can't go live, no computer, no Super Chat", () => {
    expect(ytLiveFit(null)).toEqual({ asked: false });
    expect(ytLiveFit(all)).toEqual({ asked: true, ok: true, reasons: [] });
    const starts = (f: ReturnType<typeof ytLiveFit>) => f.asked && f.reasons.map((r) => r.split(" ").slice(0, 3).join(" "));
    expect(starts(ytLiveFit({ canGoLive: false, computer: false, superChat: false }))).toEqual(["Your channel needs", "The games go", "The games run"]);
    expect(ytLiveFit({ ...all, canGoLive: false })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/verified channel/)] });
    expect(ytLiveFit({ ...all, computer: false })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/OBS/)] });
    expect(ytLiveFit({ ...all, superChat: false })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/Partner Program/)] });
  });

  it("offers the paid games to someone who can get TikTok gifts or YouTube Super Chats, or hasn't answered TikTok's questions, and only reads YouTube's while YouTube Live is on", () => {
    const tiktokYes = { canGoLive: true, computer: true };
    const tiktokNo = { canGoLive: false, computer: true };
    const youtubeNo = { ...all, superChat: false };
    expect(sellLive(null, null, true)).toBe(true);
    expect(sellLive(tiktokYes, youtubeNo, true)).toBe(true);
    expect(sellLive(tiktokNo, all, true)).toBe(true);
    expect(sellLive(tiktokNo, youtubeNo, true)).toBe(false);
    expect(sellLive(tiktokNo, null, true)).toBe(false);
    // while YouTube Live is off, only TikTok's answers count
    expect(sellLive(tiktokNo, all, false)).toBe(false);
    expect(sellLive(tiktokNo, all)).toBe(false);
  });

  it("says what YouTube needs for Super Chats under the plans while YouTube Live is on, and never promises anything", () => {
    expect(giftsLine(null, null, false)).toBe(giftsLine(null));
    expect(giftsLine(null, null, true)).toMatch(/Super Chats on YouTube Live need you to be 18 or older and in the YouTube Partner Program\.$/);
    expect(giftsLine(null, { ...all, superChat: false }, true)).toMatch(/You told us you can't get Super Chats on YouTube yet, so the LIVE games can't bring you any there for now\.$/);
    expect(giftsLine(null, { ...all, superChat: false }, false)).not.toMatch(/Super Chat/);
    const lines = [
      giftsLine(null, all, true), giftsLine(null, { ...all, superChat: false }, true),
      ...(["canGoLive", "computer", "superChat"] as const).flatMap((k) => (ytLiveFit({ ...all, [k]: false }) as { reasons: string[] }).reasons),
    ];
    for (const l of lines) expect(l).not.toMatch(/\$|\bwill\b|earn|income|money|—/i);
  });

  it("reads saved YouTube answers, and nothing else", () => {
    expect(parseYtLiveCheck(all)).toEqual(all);
    expect(parseYtLiveCheck({ canGoLive: true, computer: true })).toBeNull();
    expect(parseYtLiveCheck("yes")).toBeNull();
  });

  it("says why a YouTube LIVE isn't theirs in a sentence of its own, and nothing for one that is", () => {
    expect(whyNotCounted({ verified: false, heard: [], platform: "youtube" }, [], false)).toBe(NOT_HEARD_ON_YOUTUBE);
    expect(whyNotCounted({ verified: true, heard: [], platform: "youtube" }, [])).toBeNull();
    // a TikTok one still says what it always did
    expect(whyNotCounted({ verified: false, heard: [], platform: "tiktok" }, [])).toMatch(/TikFinity/);
  });

  it("puts the LIVE page's line about the stream in plain words, with a pause ending at the browser's own time", () => {
    const at = "2037-04-11T07:05:00.000Z";
    const line = (y: Parameters<typeof youtubeSetupLine>[0]) => youtubeSetupLine(y);
    expect(line({ state: "idle" })).toEqual({ tone: "none", text: "Not checked yet" });
    expect(line({ state: "not_live", channel: "Ball Battle TV" })).toEqual({ tone: "wait", text: "Not live on Ball Battle TV right now" });
    expect(line({ state: "ended", channel: null })).toEqual({ tone: "wait", text: "Not live on your channel right now" });
    expect(line({ state: "live", title: "Friday fights" })).toEqual({ tone: "good", text: "Live: Friday fights" });
    expect(line({ state: "chat_off" })).toEqual({ tone: "bad", text: "Live, but chat is off on this stream" });
    expect(line({ state: "paused", until: at, who: "account" })).toEqual({ tone: "bad", text: `Paused until ${clockTime(at)}: today's YouTube LIVE time is used` });
    expect(line({ state: "paused", until: at, who: "everyone" }).text).toBe(`Paused until ${clockTime(at)}: Hookline's YouTube allowance for today is used`);
    expect(line({ state: "reconnect" })).toEqual({ tone: "bad", text: "Needs connecting again" });
    expect(line({ state: "error", detail: "YouTube isn't answering." }).text).toBe("YouTube isn't answering. Hookline tries again by itself.");
    expect(line({ state: "gone" }).tone).toBe("bad");
    for (const state of ["idle", "off", "setup", "reconnect", "not_live", "live", "chat_off", "ended", "paused", "error", "gone"] as const) {
      expect(line({ state }).text).not.toMatch(/—|\$/);
    }
  });

  it("says the server's first paint of a pause without a time, since only the browser knows its own", () => {
    const at = "2037-04-11T07:05:00.000Z";
    // what the server renders, and the browser's first render must match it
    expect(youtubeSetupLine({ state: "paused", until: at, who: "account" }, { local: false })).toEqual({ tone: "bad", text: "Paused until after midnight Pacific time: today's YouTube LIVE time is used" });
    expect(youtubeSetupLine({ state: "paused", until: at, who: "account" }, { local: false }).text).not.toContain(clockTime(at));
    // then the browser fills in its own time
    expect(youtubeSetupLine({ state: "paused", until: at, who: "account" }, { local: true }).text).toBe(`Paused until ${clockTime(at)}: today's YouTube LIVE time is used`);
  });

  it("says Hookline can't be reached while Check now listens and gets no answer, rather than what it last knew", () => {
    expect(youtubeSetupLine({ state: "idle" }, { reached: false })).toEqual({ tone: "bad", text: "Hookline can't be reached right now. It keeps trying." });
    expect(youtubeSetupLine({ state: "live", title: "Friday fights" }, { reached: false }).text).toBe("Hookline can't be reached right now. It keeps trying.");
    expect(youtubeSetupLine({ state: "live", title: "Friday fights" }, { reached: true }).text).toBe("Live: Friday fights");
  });

  it("says a stream YouTube has as made for kids has no chat, as YouTube's fact, with nothing to change", () => {
    const kids = youtubeSetupLine({ state: "chat_off", kids: true });
    expect(kids).toEqual({ tone: "bad", text: "Live, but YouTube has this stream as made for kids, so it has no chat" });
    expect(kids.text).not.toMatch(/turn on|switch|change|set|studio/i);
  });
});

describe("a game whose settings can't be loaded", () => {
  it("tells a key that's gone from a database that's down, after trying again", async () => {
    expect(await lookUp(async () => ({ a: 1 }), [0])).toEqual({ state: "ok", value: { a: 1 } });
    expect(await lookUp(async () => null, [0])).toEqual({ state: "gone" });
    let tries = 0;
    const flaky = async () => {
      if (++tries < 3) throw new Error("pooler timeout");
      return { a: 2 };
    };
    expect(await lookUp(flaky, [0, 0])).toEqual({ state: "ok", value: { a: 2 } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    tries = 0;
    const down = async () => {
      tries++;
      throw new Error("no database");
    };
    expect(await lookUp(down, [0, 0])).toEqual({ state: "unsure" });
    expect(tries).toBe(3);
    // a database that never answers is the same as one that's down
    expect(await lookUp(() => new Promise(() => {}), [0], 20)).toEqual({ state: "unsure" });
    vi.restoreAllMocks();
  });

  it("keeps the last settings that loaded, in the browser source", () => {
    const g = { settings: { ...DEFAULT_SETTINGS, game: "rivals" as const, roundSeconds: 120 }, tag: false };
    expect(readLastGood(writeLastGood(g))).toEqual(g);
    expect(readLastGood(null)).toBeNull();
    expect(readLastGood("{oops")).toBeNull();
    expect(readLastGood(JSON.stringify({ settings: { game: "not-a-game" }, tag: false }))?.settings.game).toBe("battle");
    expect(lastGoodKey("abc")).toBe("hookline:game:abc");
  });
});

describe("asking TikTok for usernames", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** the TikTok module with these settings, read fresh */
  async function withEnv(vars: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
    return import("@/lib/server/tiktok");
  }

  it("asks for the username only once the TikTok app has the scope, so connecting keeps working until then", async () => {
    const off = await withEnv({ TIKTOK_PROFILE: "", TIKTOK_DIRECT_POST: "" });
    expect(off.tiktokScopes()).toEqual(["user.info.basic", "video.list", "video.upload"]);
    const on = await withEnv({ TIKTOK_PROFILE: "1", TIKTOK_DIRECT_POST: "" });
    expect(on.tiktokScopes()).toEqual(["user.info.basic", "user.info.profile", "video.list", "video.upload"]);
  });

  it("reads the username only when TikTok granted it", async () => {
    const t = await withEnv({});
    const asked: string[] = [];
    // TikTok answers only the fields it was asked for
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      const user = { open_id: "o1", display_name: "Kayla", ...(url.includes("username") ? { username: "Kayla.Live" } : {}) };
      return Response.json({ data: { user }, error: { code: "ok" } });
    });
    expect((await t.tiktokUser("tok", "user.info.basic,video.list")).handle).toBeNull();
    expect(asked[0]).not.toMatch(/username/);
    expect((await t.tiktokUser("tok", "user.info.basic,user.info.profile")).handle).toBe("kayla.live");
    expect(asked[1]).toMatch(/fields=.*,username/);
  });
});

describe("whether the game can hear a YouTube LIVE", () => {
  const now = 10_000_000;
  const until = "2037-04-07T07:05:00.000Z";
  const status = (o: Partial<Exclude<YouTubeStatus, { state: "gone" }>> = {}): YouTubeStatus => ({
    state: "live", channel: "Ball Battle TV", title: "Ball Battle all night", broadcast: "w2ytBcast01", until: null, who: null, detail: null, kids: false, ...o,
  });
  const at = (h: Partial<Hearing>): Hearing => ({ name: "Hookline", socket: "open", since: now - 60_000, bridge: null, heardAt: now - 1000, now, youtube: status(), ...h });
  /** what shows on the stream: the grey line and the orange bar */
  const top = (h: Partial<Hearing>) => {
    const v = connectionView(at(h));
    return { status: v.status, notice: v.notice };
  };
  const hint = (h: Partial<Hearing>) => connectionView(at(h)).hint;

  it("waits a moment for Hookline, then says plainly it can't be reached, and keeps trying", () => {
    expect(top({ socket: "connecting", youtube: null, since: now - 5000 })).toEqual({ status: "WAITING FOR HOOKLINE…", notice: undefined });
    expect(hint({ socket: "connecting", youtube: null, since: now - 5000 })).toBe("Asking Hookline for your YouTube chat…");
    // a stream it heard a moment ago doesn't count once Hookline stops answering
    expect(top({ socket: "closed", since: now - GRACE_MS })).toEqual({ status: undefined, notice: `${NOT_CONNECTED} · RECONNECTING` });
    expect(hint({ socket: "closed", since: now - GRACE_MS })).toMatch(/keeps trying by itself/);
  });

  it("puts anything that stops chat reaching the game in the orange bar", () => {
    expect(top({ youtube: status({ state: "off" }) })).toEqual({ status: undefined, notice: `${NOT_CONNECTED} · YOUTUBE IS OFF ON HOOKLINE` });
    expect(top({ youtube: status({ state: "setup", channel: null }) })).toEqual({ status: undefined, notice: `${NOT_CONNECTED} · CONNECT YOUTUBE ON HOOKLINE` });
    expect(top({ youtube: status({ state: "reconnect" }) })).toEqual({ status: undefined, notice: `${NOT_CONNECTED} · RECONNECT YOUTUBE` });
    expect(top({ youtube: status({ state: "chat_off" }) })).toEqual({ status: undefined, notice: "YOUTUBE CHAT IS OFF ON THIS STREAM" });
    expect(top({ youtube: { state: "gone" } })).toEqual({ status: undefined, notice: OLD_ADDRESS });
    // paused until the reset, in the browser's own time, whoever's YouTube LIVE time ran out
    const time = clockTime(until);
    expect(time).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    for (const who of ["account", "everyone"] as const) {
      expect(top({ youtube: status({ state: "paused", until, who }) })).toEqual({ status: undefined, notice: `YOUTUBE CHAT PAUSED UNTIL ${time}` });
      expect(hint({ youtube: status({ state: "paused", until, who }) })).toMatch(new RegExp(`reach the game again at ${time}\\.$`));
    }
    expect(hint({ youtube: status({ state: "paused", until, who: "account" }) })).toMatch(/^You've used today's YouTube LIVE time on Hookline\./);
    expect(hint({ youtube: status({ state: "paused", until, who: "everyone" }) })).toMatch(/^Hookline has asked YouTube as often as it can today\./);
  });

  it("keeps waiting for the stream, a stream that ended, a quiet chat and YouTube's own trouble to the grey line", () => {
    expect(top({ youtube: status({ state: "not_live", title: null, broadcast: null }) })).toEqual({ status: "WAITING FOR YOUR YOUTUBE LIVE…", notice: undefined });
    expect(top({ youtube: status({ state: "ended" }) })).toEqual({ status: "YOUR YOUTUBE LIVE ENDED", notice: undefined });
    expect(top({ youtube: status({ state: "error", detail: "YouTube isn't answering." }) })).toEqual({ status: "YOUTUBE ISN'T ANSWERING · TRYING AGAIN", notice: undefined });
    expect(top({})).toEqual({ status: undefined, notice: undefined });
    expect(top({ heardAt: now - QUIET_MS - 60_000 })).toEqual({ status: "NOTHING HEARD IN 6 MIN", notice: undefined });
  });

  it("tells the streamer beside the game what's happening and what to do, by name", () => {
    expect(hint({})).toBe('Hearing the chat on "Ball Battle all night".');
    expect(hint({ youtube: status({ title: null }) })).toBe("Hearing the chat on your stream.");
    expect(hint({ youtube: status({ state: "not_live" }) })).toMatch(/^Go live on Ball Battle TV\. The game looks for your stream every minute for 10 minutes, then every 5, then every 30 after 3 hours\./);
    expect(hint({ youtube: status({ state: "reconnect", channel: null }) })).toMatch(/^Hookline lost access to your YouTube channel\. Connect it again in Hookline's Settings/);
    expect(hint({ heardAt: now - QUIET_MS })).toBe("No chat in 5 minutes. If people are chatting, check live chat is on for this stream.");
    expect(hint({ youtube: status({ state: "error", detail: "YouTube didn't let Hookline read this chat." }) })).toBe("YouTube didn't let Hookline read this chat.");
    // chat that's off can be turned on; a stream YouTube has as made for kids is only said to be so, with nothing to change about it
    expect(hint({ youtube: status({ state: "chat_off", detail: "Live chat is off on this stream." }) })).toBe("The game plays with your chat. Turn on live chat for this stream in YouTube Studio.");
    const kids = connectionView(at({ youtube: status({ state: "chat_off", kids: true, detail: "YouTube has this stream as made for kids, so it has no live chat." }) }));
    expect(kids).toEqual({ notice: "YOUTUBE CHAT IS OFF ON THIS STREAM", hint: "YouTube has this stream as made for kids, so it has no live chat, and the game can't hear anyone." });
    expect(kids.hint).not.toMatch(/turn on|switch|change|set|studio/i);
    // nothing on YouTube's side talks of TikTok's tools, likes or gifts' prices, and none of it uses a dash for a pause
    const all = (["off", "setup", "reconnect", "not_live", "live", "chat_off", "ended", "paused", "error"] as const).flatMap((state) => {
      const v = connectionView(at({ youtube: status({ state, until }) }));
      return [v.hint, v.status ?? "", v.notice ?? ""];
    });
    for (const s of all) expect(s).not.toMatch(/TikFinity|bridge|like|coin|—/i);
  });

  it("leaves TikTok's sources as they were", () => {
    expect(connectionView(at({ name: "TikFinity", youtube: undefined })).hint).toBe("TikFinity is connected.");
  });
});

describe("whose YouTube LIVE a session heard", () => {
  const KEY = "k".repeat(32);

  it("sends the streams it heard, with no gift coins and nothing about TikTok, and never makes a session unknown", () => {
    const s = new Show({ seed: 41, settings: { game: "battle", vote: false }, platform: "youtube" });
    const log = new HeardLog();
    const marco = { id: "yt:UCmarco00000000000000001", name: "Marco" };
    // as the game does it: the show takes the event first, then it's noted under the stream Hookline named
    const hear = (e: Parameters<Show["handle"]>[0], stream: string | null) => {
      s.handle(e);
      const id = heardIn(s, e);
      if (id) log.noteYouTube(id, stream);
    };
    hear({ kind: "chat", viewer: marco, text: "2" }, "w2ytBcast01");
    hear({ kind: "gift", viewer: marco, gift: "Yellow Super Chat", coins: 1000, count: 1 }, "w2ytBcast01");
    // a stream not known yet, or something that isn't a video id, isn't noted, and makes nothing unknown
    hear({ kind: "chat", viewer: marco, text: "hi" }, null);
    hear({ kind: "chat", viewer: marco, text: "hi" }, "not a stream");
    hear({ kind: "chat", viewer: marco, text: "again" }, "w2ytBcast02");
    expect(log.of(s.stats.id)).toEqual({ heard: [], unknown: false, broadcasts: ["w2ytBcast01", "w2ytBcast02"] });
    const p = sessionPayload(s, KEY, log.of(s.stats.id))!;
    expect(p).toMatchObject({ platform: "youtube", broadcasts: ["w2ytBcast01", "w2ytBcast02"], heard: [], unknown: false, coins: 0, topGifters: [{ id: marco.id, name: "Marco", coins: 0 }] });
    expect(sessionSchema.parse(p)).toMatchObject({ platform: "youtube", broadcasts: ["w2ytBcast01", "w2ytBcast02"] });
    // the game's power never leaves the game
    expect(s.stats.coins).toBe(1000);
    expect(sessionSchema.safeParse({ ...p, broadcasts: ["not a stream"] }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...p, broadcasts: Array.from({ length: 11 }, () => "w2ytBcast01") }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...p, platform: "twitch" }).success).toBe(false);
    // a game from before YouTube sends neither, and was on TikTok
    const { platform: _p, broadcasts: _b, ...old } = p;
    void _p;
    void _b;
    expect(sessionSchema.parse(old)).toMatchObject({ platform: "tiktok", broadcasts: [] });
    // and a TikTok session still sends its coins and its LIVEs
    const tt = new Show({ seed: 41, settings: { game: "battle", vote: false } });
    tt.handle({ kind: "gift", viewer: { id: "7001", name: "kai" }, gift: "Rose", coins: 1, count: 3 });
    expect(sessionPayload(tt, KEY, { heard: ["kayla.live"], unknown: false, broadcasts: [] })).toMatchObject({ platform: "tiktok", coins: 3, heard: ["kayla.live"], broadcasts: [], topGifters: [{ coins: 3 }] });
  });
});
