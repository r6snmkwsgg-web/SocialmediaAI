/**
 * Hookline Bridge: connects to a streamer's TikTok LIVE and passes every
 * chat, like, gift, follow and share to the live game, over a WebSocket on
 * this computer. It's built into a single program streamers download and
 * double-click, so nobody needs a terminal: the game's setup page finds it
 * and tells it which account to connect to, and it remembers.
 *
 * Run it from source with `pnpm live:bridge [username] [--port 21214]
 * [--key <Euler Stream key>] [--site https://<site>]`. TikTok makes outside
 * apps sign their connection; the connector does that through Euler
 * Stream, which works without a key at low volume. If it starts refusing,
 * get a free key at eulerstream.com and pass it with --key or set
 * EULER_API_KEY.
 *
 * Only Hookline's own site and pages on this computer can talk to it, so
 * no other website open in the streamer's browser can disconnect their
 * game or point it at someone else's LIVE. The site is baked in when it's
 * built (HOOKLINE_SITE), or given with --site. It asks that site now and
 * then whether bridges should be running: when Hookline switches them
 * off, it stops and tells the game to use TikFinity.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";
import { allowedOrigin, cleanUser, localHost, siteList, SWITCH_PATH, switchOf, type BridgeState } from "../lib/live/bridge";

const VERSION = "1.1.0";
// the site it belongs to, baked in by the build; empty when run from source
declare const __HOOKLINE_SITE__: string | undefined;
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(flag("port") ?? 21214);
const key = flag("key") ?? process.env.EULER_API_KEY;
const CONFIG = join(homedir(), ".hookline-bridge.json");
/** the Hookline site (or sites, comma-separated) whose pages may use it; the first is the one it asks whether to run */
const SITES = siteList(flag("site") ?? process.env.HOOKLINE_SITE ?? (typeof __HOOKLINE_SITE__ === "string" ? __HOOKLINE_SITE__ : ""));
const CHECK_EVERY = 10 * 60_000;

type Config = { user?: string };
function load(): Config {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8")) as Config;
  } catch {
    return {};
  }
}
function save(c: Config) {
  try {
    writeFileSync(CONFIG, JSON.stringify(c, null, 2));
  } catch {
    // not being able to remember isn't worth stopping for
  }
}

// proto messages carry 64-bit ids and raw bytes; JSON can't hold either as they are
function stringify(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === "bigint") return x.toString();
    if (x instanceof Uint8Array) return undefined;
    return x;
  });
}

type State = BridgeState;

let state: State = "idle";
let user: string | null = cleanUser(args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")))) ?? cleanUser(load().user);
let problem: string | null = null;
let conn: TikTokLiveConnection | null = null;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const server = createServer(page);
const wss = new WebSocketServer({
  server,
  // only Hookline's site and pages on this computer, addressed to this computer
  verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => localHost(req.headers.host, port) && allowedOrigin(origin || undefined, SITES),
});

function broadcast(event: string, data: unknown) {
  const text = stringify({ event, data });
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(text);
}

function status() {
  return { state, user, error: problem, version: VERSION };
}

function set(s: State, error: string | null = null) {
  state = s;
  problem = error;
  broadcast("bridge", status());
  const line =
    s === "live" ? `Connected to @${user}'s LIVE.`
    : s === "connecting" ? `Connecting to @${user}…`
    : s === "waiting" ? `@${user} isn't live yet. Trying again soon.`
    : s === "error" ? `Problem: ${error}`
    : s === "off" ? (error ?? "Switched off by Hookline. Use TikFinity instead.")
    : "Waiting for a username.";
  console.log(line);
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (conn) {
    conn.removeAllListeners();
    void conn.disconnect().catch(() => {});
  }
  conn = null;
}

function later() {
  if (!user) return;
  const wait = Math.min(60, 5 * 2 ** retry++);
  timer = setTimeout(() => void connect(), wait * 1000);
}

async function connect() {
  stop();
  if (state === "off") return;
  if (!user) return set("idle");
  set("connecting");
  const c = new TikTokLiveConnection(user, { signApiKey: key, enableExtendedGiftInfo: true, processInitialData: false });
  conn = c;
  c.on(WebcastEvent.CHAT, (d) => broadcast("chat", d));
  c.on(WebcastEvent.LIKE, (d) => broadcast("like", d));
  c.on(WebcastEvent.GIFT, (d) => broadcast("gift", d));
  c.on(WebcastEvent.FOLLOW, (d) => broadcast("follow", d));
  c.on(WebcastEvent.SHARE, (d) => broadcast("share", d));
  c.on(WebcastEvent.MEMBER, (d) => broadcast("member", d));
  c.on(WebcastEvent.STREAM_END, () => {
    set("waiting");
    later();
  });
  c.on(ControlEvent.DISCONNECTED, () => {
    if (conn !== c || state !== "live") return;
    set("waiting");
    later();
  });
  try {
    await c.connect();
    if (conn !== c) return;
    retry = 0;
    set("live");
  } catch (err) {
    if (conn !== c) return;
    const msg = err instanceof Error ? err.message : String(err);
    // not live is the usual reason; keep trying quietly
    set(/offline|not live|room id/i.test(msg) ? "waiting" : "error", msg);
    later();
  }
}

/** Point it at an account, from the setup page or the bridge's own page. */
function use(raw: unknown) {
  if (state === "off") return set("off", problem);
  const u = cleanUser(raw);
  if (!u) return set("error", "That doesn't look like a TikTok username.");
  user = u;
  retry = 0;
  save({ user });
  void connect();
}

wss.on("connection", (ws) => {
  ws.send(stringify({ event: "bridge", data: status() }));
  ws.on("message", (buf) => {
    let msg: { cmd?: string; user?: unknown };
    try {
      msg = JSON.parse(String(buf));
    } catch {
      return;
    }
    if (msg.cmd === "connect") use(msg.user);
    else if (msg.cmd === "disconnect") {
      stop();
      user = null;
      save({});
      if (state !== "off") set("idle");
    } else if (msg.cmd === "status") ws.send(stringify({ event: "bridge", data: status() }));
  });
});

/**
 * Whether Hookline wants bridges running. Switched off, it lets go of the
 * LIVE and says so to the game, which moves to TikFinity; switched back on,
 * it picks up where it was. When the site can't be reached it keeps going.
 */
async function checkSwitch() {
  if (!SITES[0]) return;
  try {
    const res = await fetch(`${SITES[0]}${SWITCH_PATH}`, { headers: { "user-agent": `HooklineBridge/${VERSION}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const sw = switchOf(await res.json());
    if (!sw.on && state !== "off") {
      stop();
      set("off", sw.message);
    } else if (sw.on && state === "off") {
      set("idle");
      if (user) void connect();
    }
  } catch {
    // can't reach Hookline: keep going
  }
}

/** The bridge's own page, for anyone who opens it in a browser. */
function page(req: IncomingMessage, res: ServerResponse) {
  // a page on another site that's made its own name point here gets nothing
  if (!localHost(req.headers.host, port)) {
    res.writeHead(403).end();
    return;
  }
  if (req.url === "/status") {
    const origin = req.headers.origin;
    const cors: Record<string, string> = origin && allowedOrigin(origin, SITES) ? { "access-control-allow-origin": origin, vary: "origin" } : {};
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(stringify(status()));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hookline Bridge</title>
<style>body{margin:0;background:#0b0b0c;color:#f4f1ea;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}main{width:min(420px,90vw)}h1{font-size:28px;margin:0 0 4px;letter-spacing:.02em;text-transform:uppercase}p{color:#8d8a83;margin:0 0 20px}form{display:flex;gap:8px}input{flex:1;padding:12px;border:2px solid #333;background:#151517;color:#f4f1ea;font:inherit}button{padding:12px 18px;border:0;background:#ff4a1c;color:#0b0b0c;font-weight:700;text-transform:uppercase;cursor:pointer}#s{margin-top:16px;font-family:ui-monospace,monospace;font-size:13px;text-transform:uppercase;letter-spacing:.08em}</style></head>
<body><main><h1>Hookline Bridge</h1><p>Keep this running while you're live. Your game's setup page can set the account for you, or type it here.</p>
<form id="f"><input id="u" placeholder="your TikTok username" autocomplete="off"><button>Connect</button></form><div id="s">Starting…</div></main>
<script>const ws=new WebSocket("ws://"+location.host);const s=document.getElementById("s");const words={idle:"Waiting for a username",connecting:"Connecting…",live:"Connected to your LIVE",waiting:"Not live yet, trying again soon",error:"Problem",off:"Switched off by Hookline. Use TikFinity instead"};
ws.onmessage=(m)=>{const e=JSON.parse(m.data);if(e.event!=="bridge")return;const d=e.data;s.textContent=(words[d.state]||d.state)+(d.user?" · @"+d.user:"")+(d.error&&d.state==="error"?" · "+d.error:"");if(d.user)document.getElementById("u").value=d.user};
document.getElementById("f").onsubmit=(ev)=>{ev.preventDefault();ws.send(JSON.stringify({cmd:"connect",user:document.getElementById("u").value}))};</script></body></html>`);
}

server.listen(port, "127.0.0.1", async () => {
  console.log(`Hookline Bridge ${VERSION} is running on this computer (port ${port}).`);
  console.log(`Open your game's setup page, or http://localhost:${port} to pick your account.`);
  if (!SITES.length) console.log("No Hookline site set, so only pages on this computer can use it. Pass --site https://<site> to change that.");
  await checkSwitch();
  setInterval(() => void checkSwitch(), CHECK_EVERY).unref();
  if (state === "off") return;
  if (user) void connect();
  else set("idle");
});
server.on("error", (err: NodeJS.ErrnoException) => {
  console.log(err.code === "EADDRINUSE" ? `Port ${port} is busy: is the bridge already running?` : `Couldn't start: ${err.message}`);
  process.exit(1);
});

process.on("SIGINT", () => {
  stop();
  wss.close();
  server.close();
  process.exit(0);
});
