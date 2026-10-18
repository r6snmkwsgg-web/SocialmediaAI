import { bridgeStatusOf, type BridgeStatus } from "@/lib/live/bridge";
import type { SocketState } from "@/lib/live/connection";
import { parseMessage, type LiveEvent, type Streaks } from "@/lib/live/events";

/**
 * Where a live's events come from. Both are programs running on the
 * streamer's own computer that are already connected to their TikTok LIVE
 * and pass every event on over a local WebSocket:
 *
 * - TikFinity, the desktop app most TikTok streamers already use for
 *   alerts. Its Event API is on port 21213.
 * - Hookline Bridge, the small app streamers download (or `pnpm
 *   live:bridge`), on port 21214. The setup page can tell it which
 *   account to connect to, and it says how it's doing: whether it's
 *   really connected to TikTok, and to whose LIVE.
 *
 * A YouTube LIVE needs neither: Hookline reads its chat itself, and the
 * game asks Hookline for it (YouTubeSource, in youtube-source.ts).
 */
export const SOURCES = {
  tikfinity: { name: "TikFinity", url: "ws://localhost:21213/" },
  bridge: { name: "Hookline Bridge", url: "ws://localhost:21214/" },
} as const;
export type SourceId = keyof typeof SOURCES;
/** where a game can hear a LIVE from: one of the tools on the computer, or Hookline itself for YouTube */
export type GameSource = SourceId | "youtube";

export type SourceState = SocketState;

type Handlers = {
  onEvent: (e: LiveEvent) => void;
  onState?: (s: SourceState) => void;
  /** every message as it came, even ones it couldn't read */
  onRaw?: (text: string) => void;
  /** the bridge saying how it's doing */
  onStatus?: (s: BridgeStatus) => void;
};

/** A WebSocket to one of them that keeps trying when it drops. */
export class LiveSource {
  state: SourceState = "closed";
  /** the last few raw messages, for the setup page's log */
  readonly raw: string[] = [];
  received = 0;
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly streaks: Streaks = new Map();

  constructor(
    readonly url: string,
    private readonly on: Handlers,
  ) {}

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.set("closed");
  }

  /** Send something back, like a command to the bridge. False if it isn't open. */
  send(msg: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private set(s: SourceState) {
    this.state = s;
    this.on.onState?.(s);
  }

  private open() {
    if (this.stopped) return;
    this.set("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.later();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set("open");
    };
    ws.onmessage = (m) => {
      const text = typeof m.data === "string" ? m.data : "";
      if (!text) return;
      this.received++;
      this.raw.push(text.length > 600 ? `${text.slice(0, 600)}…` : text);
      if (this.raw.length > 40) this.raw.shift();
      this.on.onRaw?.(text);
      const status = bridgeStatusOf(text);
      if (status) {
        this.on.onStatus?.(status);
        return;
      }
      const e = parseMessage(text, this.streaks);
      if (e) this.on.onEvent(e);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.set("closed");
      this.later();
    };
    ws.onerror = () => ws.close();
  }

  private later() {
    if (this.stopped) return;
    const wait = Math.min(10_000, 800 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.open(), wait);
  }
}
