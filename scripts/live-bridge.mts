/**
 * Hookline's bridge: connects to a TikTok LIVE and passes every chat,
 * like, gift, follow and share on to the live battle screen, over a
 * WebSocket on this computer. Use it instead of TikFinity, or to test.
 *
 *   pnpm live:bridge <tiktok username> [--port 21214] [--key <Euler Stream key>]
 *
 * The username is the one after the @, and they have to be live. TikTok
 * makes outside apps sign their connection; the connector does that through
 * Euler Stream, which works without a key at low volume. If it starts
 * refusing, get a free key at eulerstream.com and pass it with --key or
 * set EULER_API_KEY.
 *
 * Open /live/play?src=bridge to see it.
 */
import { WebSocket, WebSocketServer } from "ws";
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const user = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")))?.replace(/^@/, "");
const port = Number(flag("port") ?? 21214);
const key = flag("key") ?? process.env.EULER_API_KEY;

if (!user) {
  console.error("Which TikTok account? Run: pnpm live:bridge <username>");
  process.exit(1);
}

// proto messages carry 64-bit ids and raw bytes; JSON can't hold either as they are
function stringify(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === "bigint") return x.toString();
    if (x instanceof Uint8Array) return undefined;
    return x;
  });
}

const wss = new WebSocketServer({ host: "127.0.0.1", port });
wss.on("listening", () => console.log(`Bridge on ws://localhost:${port}. Open /live/play?src=bridge`));
wss.on("connection", (ws) => {
  console.log("A battle screen connected.");
  ws.send(stringify({ event: "hello", data: { user, live: connected } }));
});

function send(event: string, data: unknown) {
  const text = stringify({ event, data });
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(text);
}

let connected = false;
let retry = 0;
const conn = new TikTokLiveConnection(user, { signApiKey: key, enableExtendedGiftInfo: true, processInitialData: false });

conn.on(WebcastEvent.CHAT, (d) => send("chat", d));
conn.on(WebcastEvent.LIKE, (d) => send("like", d));
conn.on(WebcastEvent.GIFT, (d) => send("gift", d));
conn.on(WebcastEvent.FOLLOW, (d) => send("follow", d));
conn.on(WebcastEvent.SHARE, (d) => send("share", d));
conn.on(WebcastEvent.MEMBER, (d) => send("member", d));
conn.on(WebcastEvent.STREAM_END, () => {
  console.log("The LIVE ended.");
  connected = false;
});
conn.on(ControlEvent.DISCONNECTED, () => {
  if (!connected) return;
  connected = false;
  console.log("Lost the LIVE. Trying again…");
  later();
});

async function connect() {
  try {
    const state = await conn.connect();
    connected = true;
    retry = 0;
    console.log(`Connected to @${user}'s LIVE (room ${state.roomId}).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`Couldn't connect to @${user}: ${msg}`);
    later();
  }
}

function later() {
  const wait = Math.min(60, 5 * 2 ** retry++);
  console.log(`Trying again in ${wait}s. Make sure @${user} is live.`);
  setTimeout(connect, wait * 1000);
}

void connect();

process.on("SIGINT", () => {
  void conn.disconnect();
  wss.close();
  process.exit(0);
});
