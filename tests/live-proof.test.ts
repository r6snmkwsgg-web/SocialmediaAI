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
    expect(log.of("s1")).toEqual({ heard: ["kayla.live"], unknown: false });
    log.note("s1", "famous.one");
    expect(log.of("s1")).toEqual({ heard: ["kayla.live", "famous.one"], unknown: false });
    // the bridge, then TikFinity (after the bridge was switched off), then the bridge again: still unknown
    log.note("s2", "kayla.live");
    log.note("s2", null);
    log.note("s2", "kayla.live");
    expect(log.of("s2")).toEqual({ heard: ["kayla.live"], unknown: true });
    expect(log.of("never")).toEqual({ heard: [], unknown: false });
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
    const p = sessionPayload(s, "k".repeat(32), { heard: ["kayla.live"], unknown: false })!;
    expect(p.heard).toEqual(["kayla.live"]);
    expect(sessionSchema.parse(p)).toMatchObject({ heard: ["kayla.live"], unknown: false });
    expect(sessionPayload(s, "k".repeat(32), { heard: ["kayla.live"], unknown: true })!.unknown).toBe(true);
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
  it("is ready only with all three", () => {
    expect(liveFit(null)).toEqual({ asked: false });
    expect(liveFit({ adult: true, canGoLive: true, computer: true })).toEqual({ asked: true, ok: true, reasons: [] });
    const teen = liveFit({ adult: false, canGoLive: false, computer: true });
    expect(teen).toMatchObject({ asked: true, ok: false });
    expect(teen.asked && teen.reasons).toHaveLength(2);
    expect(teen.asked && teen.reasons[0]).toMatch(/18/);
    expect(liveFit({ adult: true, canGoLive: true, computer: false })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/computer/)] });
  });

  it("offers the paid LIVE games only to someone who can earn with them, or hasn't said", () => {
    expect(sellLive(null)).toBe(true);
    expect(sellLive({ adult: true, canGoLive: true, computer: true })).toBe(true);
    expect(sellLive({ adult: false, canGoLive: true, computer: true })).toBe(false);
  });

  it("says what TikTok needs for gifts, and never what anything will earn", () => {
    const answers = [null, { adult: true, canGoLive: true, computer: true }, { adult: false, canGoLive: false, computer: true }];
    for (const c of answers) expect(giftsLine(c)).not.toMatch(/\bwill\b|earn|income|money|—/i);
    expect(giftsLine(null)).toMatch(/18 or older/);
    expect(giftsLine(answers[2])).toMatch(/can't get gifts on a TikTok LIVE yet/);
  });

  it("reads saved answers, and nothing else", () => {
    expect(parseLiveCheck({ adult: true, canGoLive: false, computer: true })).toEqual({ adult: true, canGoLive: false, computer: true });
    expect(parseLiveCheck({ adult: "yes" })).toBeNull();
    expect(parseLiveCheck(null)).toBeNull();
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
