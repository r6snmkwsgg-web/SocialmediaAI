import type { BridgeStatus } from "./bridge";

/**
 * Whether the game can actually hear the streamer's LIVE, and what to say
 * when it can't. A gift that lands while the game isn't hearing anything
 * does nothing, so this has to be plain on the stream itself:
 *
 * - TikFinity or the bridge isn't running on the computer (the WebSocket
 *   is closed): a moment's grace, then NOT CONNECTED.
 * - The bridge is running but isn't connected to TikTok (no username yet,
 *   not live yet, a wrong username, TikTok refusing): NOT CONNECTED.
 * - Everything looks connected, but nothing (no chat, likes or gifts) has
 *   come in for a while. That can be a quiet LIVE, or TikFinity open but
 *   not signed in, so it's a small grey line rather than the orange bar:
 *   the streamer sees it in their preview and viewers aren't alarmed.
 *
 * `notice` goes in the orange bar at the top, `status` in the small grey
 * line, and `hint` beside the game for the streamer, off the stream.
 */

export type SocketState = "connecting" | "open" | "closed";

export type Hearing = {
  /** the tool it listens to, as people know it: TikFinity, or Hookline Bridge */
  name: string;
  socket: SocketState;
  /** when the socket last opened or dropped, or the game started listening, epoch ms (see `sinceAfter`) */
  since: number;
  /** what the bridge last said about itself; null for a tool that doesn't say (TikFinity) */
  bridge: BridgeStatus | null;
  /** when it last heard anything from the LIVE, or became ready to, epoch ms */
  heardAt: number;
  /** Hookline has switched the bridge off, so the game moved to TikFinity */
  bridgeOff?: boolean;
  now: number;
};

export type ConnectionView = { status?: string; notice?: string; hint: string };

/** how long the tool can be missing before the game says NOT CONNECTED: long enough for a reload, or the tool starting up */
export const GRACE_MS = 20_000;
/** how long with nothing at all from the LIVE before the game says so */
export const QUIET_MS = 5 * 60_000;

export const NOT_CONNECTED = "NOT CONNECTED TO YOUR LIVE";

/**
 * `since` after the socket goes from one state to the next. Only opening
 * and dropping count: while the tool isn't running the socket keeps trying
 * (connecting, closed, connecting...), and if every try started the grace
 * over, NOT CONNECTED would never show.
 */
export function sinceAfter(from: SocketState, to: SocketState, since: number, at: number): number {
  return from === "open" || to === "open" ? at : since;
}

export function connectionView(h: Hearing): ConnectionView {
  const NAME = h.name.toUpperCase();
  const off = h.bridgeOff ? "Hookline Bridge is switched off for now, so the game listens to TikFinity instead. " : "";
  if (h.socket !== "open") {
    if (h.now - h.since < GRACE_MS) return { status: `WAITING FOR ${NAME}…`, hint: `${off}Looking for ${h.name} on this computer…` };
    return { notice: `${NOT_CONNECTED} · OPEN ${NAME}`, hint: `${off}${h.name} isn't running on this computer. Open it and the game connects by itself.` };
  }
  const b = h.bridge;
  if (b && b.state !== "live") {
    const who = b.user ? `@${b.user}` : "your account";
    if (b.state === "off") return { notice: "HOOKLINE BRIDGE IS OFF · USE TIKFINITY", hint: b.error ?? "Hookline has switched the bridge off for now. Use TikFinity instead." };
    if (b.state === "connecting") return { status: "CONNECTING TO YOUR LIVE…", hint: `The bridge is connecting to ${who}'s LIVE…` };
    const why =
      b.state === "idle"
        ? "The bridge is running but doesn't know your username yet. Set it on Hookline's setup page."
        : b.state === "waiting"
          ? `The bridge is running, but TikTok says ${who} isn't live. If you are, check the username on the setup page.`
          : `The bridge is running but couldn't connect to ${who}'s LIVE${b.error ? `: ${b.error}` : "."}`;
    return { notice: NOT_CONNECTED, hint: why };
  }
  const quiet = h.now - h.heardAt;
  if (quiet >= QUIET_MS) {
    const min = Math.floor(quiet / 60_000);
    const check = b ? "the bridge is connected to your LIVE" : `${h.name} is signed in and connected to your LIVE`;
    return { status: `NOTHING HEARD IN ${min} MIN`, hint: `${off}No chat, likes or gifts in ${min} minutes. If people are chatting, check ${check}.` };
  }
  return { hint: `${off}${b ? `Connected to ${b.user ? `@${b.user}'s` : "your"} LIVE through the bridge.` : `${h.name} is connected.`}` };
}
