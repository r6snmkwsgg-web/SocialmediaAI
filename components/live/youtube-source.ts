import type { LiveEvent } from "@/lib/live/events";
import type { YouTubeLiveReply, YouTubeState, YouTubeStatus } from "@/lib/live/youtube";
import type { SourceState } from "./source";

/**
 * A YouTube LIVE, heard through Hookline. The game runs signed out (an OBS
 * browser source), so it asks Hookline with the streamer's overlay key,
 * and Hookline reads the chat of their own stream through the channel
 * they connected. Each answer says what Hookline knows about the stream,
 * what happened since the last ask, and when to ask again, so the game
 * asks about once for each read of the chat. While the game counts down
 * or votes it says so, and Hookline keeps reading at its fastest.
 */

/** after Hookline couldn't be reached: again in 1, 2 and 4 seconds, then every 10 */
const RETRY_MS = [1000, 2000, 4000];
const RETRY_EVERY_MS = 10_000;
/** what an answer's wait is held to, whatever it says */
const WAIT_MIN_MS = 1000;
const WAIT_MAX_MS = 60_000;
/** while it waits, how often it looks whether the game has started counting down or voting, so Hookline hears that from the start */
const HURRY_CHECK_MS = 1000;
/** an ask that takes longer than this is given up on, and tried again */
const ASK_LIMIT_MS = 20_000;
/** what OBS's browser source says when the streamer starts streaming */
const OBS_STARTED = "obsStreamingStarted";

const STATES: readonly string[] = ["off", "setup", "reconnect", "not_live", "live", "chat_off", "ended", "paused", "error"] satisfies YouTubeState[];
const KINDS: readonly string[] = ["gift", "chat", "like", "follow", "share", "join"] satisfies LiveEvent["kind"][];

type Handlers = {
  onEvent: (e: LiveEvent) => void;
  /** whether Hookline answers: open while it does, closed while it can't be reached */
  onState?: (s: SourceState) => void;
  /** what Hookline says about the stream, before the events that came with it; `gone` once the key has been replaced */
  onStatus?: (s: YouTubeStatus) => void;
  /** the game is counting down or voting */
  hurry?: () => boolean;
};

const text = (v: unknown) => (typeof v === "string" ? v : null);

/** One of the events in an answer, as Hookline wrote it: something a viewer did. */
function isEvent(v: unknown): v is LiveEvent {
  const e = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  const viewer = e?.viewer && typeof e.viewer === "object" ? (e.viewer as Record<string, unknown>) : null;
  if (!e || !viewer || !KINDS.includes(String(e.kind)) || typeof viewer.id !== "string" || typeof viewer.name !== "string") return false;
  return e.kind !== "gift" || (Number.isFinite(e.coins) && Number.isFinite(e.count));
}

/** Hookline's answer, if it is one. */
export function readReply(json: unknown): YouTubeLiveReply | null {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (!o || !STATES.includes(String(o.state)) || !Array.isArray(o.events) || !Number.isFinite(o.seq) || !Number.isFinite(o.wait)) return null;
  return {
    state: o.state as YouTubeState,
    channel: text(o.channel),
    title: text(o.title),
    broadcast: text(o.broadcast),
    until: text(o.until),
    who: o.who === "account" || o.who === "everyone" ? o.who : null,
    detail: text(o.detail),
    kids: o.kids === true,
    events: o.events.filter(isEvent),
    seq: o.seq as number,
    wait: o.wait as number,
  };
}

export class YouTubeSource {
  /** open while Hookline answers, closed while it can't be reached */
  state: SourceState = "closed";
  /** where the last answer left off, to pass back as `after`; none before the first, so a new game starts from now */
  private seq: number | null = null;
  /** look for the stream now: the first ask, Check now and OBS starting the stream */
  private go = true;
  /** an ask is on its way, and another was wanted meanwhile */
  private asking = false;
  private again = false;
  /** at the last answer: whether the game was hurrying when it asked, and whether Hookline was reading a chat */
  private hurried = false;
  private live = false;
  private fails = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  /** `setup` when it's the LIVE page listening, not a game */
  constructor(
    private readonly key: string,
    private readonly on: Handlers,
    private readonly o: { setup?: boolean } = {},
  ) {}

  start() {
    this.stopped = false;
    if (typeof window !== "undefined") window.addEventListener(OBS_STARTED, this.started);
    this.set("connecting");
    void this.ask();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (typeof window !== "undefined") window.removeEventListener(OBS_STARTED, this.started);
    this.set("closed");
  }

  /** Look for the stream now: Check now on the setup page, or OBS starting the stream. */
  check() {
    this.go = true;
    if (this.asking) this.again = true;
    else void this.ask();
  }

  private readonly started = () => this.check();

  private set(s: SourceState) {
    if (s === this.state) return;
    this.state = s;
    this.on.onState?.(s);
  }

  private async ask() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.asking = true;
    const go = this.go;
    const hurry = !!this.on.hurry?.();
    const q = new URLSearchParams({ key: this.key });
    if (this.seq !== null) q.set("after", String(this.seq));
    if (go) q.set("go", "1");
    if (hurry) q.set("hurry", "1");
    if (this.o.setup) q.set("setup", "1");
    const res = await fetch(`/api/live/youtube?${q}`, { cache: "no-store", signal: AbortSignal.timeout(ASK_LIMIT_MS) }).catch(() => null);
    const reply = res?.ok ? readReply(await res.json().catch(() => null)) : null;
    this.asking = false;
    if (this.stopped) return;
    if (res?.status === 404) {
      // the key was replaced: this address is gone for good
      this.on.onStatus?.({ state: "gone" });
      this.stop();
      return;
    }
    if (!reply) return this.later();
    if (go && !this.again) this.go = false;
    this.fails = 0;
    this.seq = reply.seq;
    this.hurried = hurry;
    this.live = reply.state === "live";
    this.set("open");
    const { state, channel, title, broadcast, until, who, detail, kids } = reply;
    this.on.onStatus?.({ state, channel, title, broadcast, until, who, detail, kids });
    for (const e of reply.events) this.on.onEvent(e);
    this.wait(this.again ? 0 : Math.min(WAIT_MAX_MS, Math.max(WAIT_MIN_MS, reply.wait)));
    this.again = false;
  }

  /**
   * Asks again after `ms`, or as soon as the game starts counting down or
   * voting while Hookline is reading the chat: what's typed then has to
   * reach the game before it's over, so Hookline hears about it at once.
   */
  private wait(ms: number) {
    const at = Date.now() + ms;
    const tick = () => {
      if (this.stopped) return;
      const left = at - Date.now();
      if (left <= 0 || (this.live && !this.hurried && this.on.hurry?.())) return void this.ask();
      this.timer = setTimeout(tick, Math.min(left, HURRY_CHECK_MS));
    };
    this.timer = setTimeout(tick, Math.min(ms, HURRY_CHECK_MS));
  }

  /** Hookline couldn't be reached, or didn't answer: closed, and again in a moment, then every 10 seconds. */
  private later() {
    this.set("closed");
    const ms = RETRY_MS[this.fails] ?? RETRY_EVERY_MS;
    this.fails++;
    this.timer = setTimeout(() => void this.ask(), ms);
  }
}
