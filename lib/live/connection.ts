import type { BridgeStatus } from "./bridge";
import { OLD_ADDRESS } from "./last-good";
import type { YouTubeStatus } from "./youtube";

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
 * On YouTube the game asks Hookline instead, which reads the stream's
 * chat itself, and says what Hookline says about it (youtubeView).
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
  /** on YouTube, what Hookline last said about the stream's chat, or null before it has answered; `socket` is whether Hookline answers */
  youtube?: YouTubeStatus | null;
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
  if (h.youtube !== undefined) return youtubeView(h);
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

/** A time as the browser shows it in its own time zone, such as 12:05 AM: when a pause ends. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * What the game says on YouTube, where Hookline reads the stream's chat
 * itself: a moment's grace while Hookline can't be reached, then NOT
 * CONNECTED, and otherwise what Hookline says about the stream. Anything
 * that stops chat reaching the game goes in the orange bar; waiting for the
 * stream, a stream that ended and a quiet chat get the grey line.
 */
export function youtubeView(h: Hearing): ConnectionView {
  const y = h.youtube;
  if (y?.state === "gone") return { notice: OLD_ADDRESS, hint: "This game address was replaced. Copy the new one from Hookline's Live page." };
  if (h.socket !== "open" || !y) {
    if (h.now - h.since < GRACE_MS) return { status: "WAITING FOR HOOKLINE…", hint: "Asking Hookline for your YouTube chat…" };
    return { notice: `${NOT_CONNECTED} · RECONNECTING`, hint: "Hookline can't be reached right now. The game keeps trying by itself." };
  }
  const channel = y.channel ?? "your YouTube channel";
  switch (y.state) {
    case "off":
      return { notice: `${NOT_CONNECTED} · YOUTUBE IS OFF ON HOOKLINE`, hint: "Hookline has switched YouTube Live off for now. The game checks every minute and comes back by itself." };
    case "setup":
      return { notice: `${NOT_CONNECTED} · CONNECT YOUTUBE ON HOOKLINE`, hint: "Connect your YouTube channel on Hookline's Live page. The game finds your stream by itself after that." };
    case "reconnect":
      return { notice: `${NOT_CONNECTED} · RECONNECT YOUTUBE`, hint: `Hookline lost access to ${channel}. Connect it again in Hookline's Settings, and allow it to see your YouTube account.` };
    case "not_live":
      return {
        status: "WAITING FOR YOUR YOUTUBE LIVE…",
        hint: `Go live on ${channel}. The game looks for your stream every minute for 10 minutes, then every 5, then every 30 after 3 hours. Going live from OBS, Check now on Hookline's Live page, or reloading the game looks straight away.`,
      };
    case "live": {
      const quiet = h.now - h.heardAt;
      if (quiet < QUIET_MS) return { hint: `Hearing the chat on ${y.title ? `"${y.title}"` : "your stream"}.` };
      const min = Math.floor(quiet / 60_000);
      return { status: `NOTHING HEARD IN ${min} MIN`, hint: `No chat in ${min} minutes. If people are chatting, check live chat is on for this stream.` };
    }
    case "chat_off":
      // made for kids is the creator's call: said only as what YouTube says, with nothing to do about it
      return y.kids
        ? { notice: "YOUTUBE CHAT IS OFF ON THIS STREAM", hint: "YouTube has this stream as made for kids, so it has no live chat, and the game can't hear anyone." }
        : { notice: "YOUTUBE CHAT IS OFF ON THIS STREAM", hint: "The game plays with your chat. Turn on live chat for this stream in YouTube Studio." };
    case "ended":
      return { status: "YOUR YOUTUBE LIVE ENDED", hint: "Go live again and the game finds the new stream." };
    case "paused": {
      const time = y.until ? clockTime(y.until) : null;
      const why = y.who === "account" ? "You've used today's YouTube LIVE time on Hookline." : "Hookline has asked YouTube as often as it can today.";
      return {
        notice: time ? `YOUTUBE CHAT PAUSED UNTIL ${time.toUpperCase()}` : "YOUTUBE CHAT PAUSED",
        hint: `${why} Chat, Super Chats and gifts reach the game again ${time ? `at ${time}` : "after midnight Pacific time"}.`,
      };
    }
    default:
      return { status: "YOUTUBE ISN'T ANSWERING · TRYING AGAIN", hint: y.detail ?? "YouTube isn't answering." };
  }
}

/** The LIVE page's line about the YouTube stream: how its dot looks, and the words beside it. */
export type SetupLine = { tone: "good" | "wait" | "bad" | "none"; text: string };

/**
 * What the LIVE page says about the YouTube stream, from what Hookline
 * knows: the reader as it was when the page loaded (idle before anything
 * has looked), or Hookline's latest answer once Check now has asked. A
 * pause ends at the browser's own time, which the server doesn't know, so
 * until the page runs on the device (`local`) it says when without a time.
 * While Check now listens and Hookline can't be reached (`reached` false),
 * that's what it says, since what it last knew may no longer be so.
 */
export function youtubeSetupLine(
  y: { state: YouTubeStatus["state"] | "idle"; channel?: string | null; title?: string | null; until?: string | null; who?: "account" | "everyone" | null; detail?: string | null; kids?: boolean },
  o: { local?: boolean; reached?: boolean } = {},
): SetupLine {
  if (o.reached === false) return { tone: "bad", text: "Hookline can't be reached right now. It keeps trying." };
  switch (y.state) {
    case "idle":
      return { tone: "none", text: "Not checked yet" };
    case "gone":
      return { tone: "bad", text: "Your game address changed. Reload this page." };
    case "off":
      return { tone: "none", text: "YouTube Live is switched off on Hookline for now" };
    case "setup":
      return { tone: "bad", text: "No YouTube channel connected" };
    case "reconnect":
      return { tone: "bad", text: "Needs connecting again" };
    case "not_live":
    case "ended":
      return { tone: "wait", text: `Not live on ${y.channel ?? "your channel"} right now` };
    case "live":
      return { tone: "good", text: `Live: ${y.title ?? "your stream"}` };
    case "chat_off":
      return { tone: "bad", text: y.kids ? "Live, but YouTube has this stream as made for kids, so it has no chat" : "Live, but chat is off on this stream" };
    case "paused": {
      const until = y.until && o.local !== false ? `Paused until ${clockTime(y.until)}` : "Paused until after midnight Pacific time";
      return { tone: "bad", text: `${until}: ${y.who === "account" ? "today's YouTube LIVE time is used" : "Hookline's YouTube allowance for today is used"}` };
    }
    default:
      return { tone: "bad", text: `${y.detail ?? "YouTube isn't answering."} Hookline tries again by itself.` };
  }
}
