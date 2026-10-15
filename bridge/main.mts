/**
 * Hookline Bridge: connects to a streamer's TikTok LIVE and passes every
 * chat, like, gift, follow and share to the live game, over a WebSocket on
 * this computer. It's built into a single program streamers download and
 * double-click, so nobody needs a terminal: the game's setup page finds it
 * and tells it which account to connect to, and it remembers.
 *
 * Run it from source with `pnpm live:bridge [username] [--port 21214]
 * [--key <Euler Stream key>]`. TikTok makes outside apps sign their
 * connection; the connector does that through Euler Stream, which works
 * without a key at low volume. If it starts refusing, get a free key at
 * eulerstream.com and pass it with --key or set EULER_API_KEY.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const VERSION = "1.0.0";
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(flag("port") ?? 21214);
const key = flag("key") ?? process.env.EULER_API_KEY;
const CONFIG = join(homedir(), ".hookline-bridge.json");

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

/** a TikTok username as people type it: with or without the @, any case */
export function cleanUser(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{2,24}$/.test(u) ? u : null;
}

// proto messages carry 64-bit ids and raw bytes; JSON can't hold either as they are
function stringify(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === "bigint") return x.toString();
    if (x instanceof Uint8Array) return undefined;
    return x;
  });
}

type State = "idle" | "connecting" | "live" | "waiting" | "error";

let state: State = "idle";
let user: string | null = cleanUser(args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")))) ?? cleanUser(load().user);
let problem: string | null = null;
let conn: TikTokLiveConnection | null = null;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const server = createServer(page);
const wss = new WebSocketServer({ server });

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
  const line = s === "live" ? `Connected to @${user}'s LIVE.` : s === "connecting" ? `Connecting to @${user}…` : s === "waiting" ? `@${user} isn't live yet. Trying again soon.` : s === "error" ? `Problem: ${error}` : "Waiting for a username.";
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
      set("idle");
    } else if (msg.cmd === "status") ws.send(stringify({ event: "bridge", data: status() }));
  });
});

/** The bridge's own page, for anyone who opens it in a browser. */
function page(req: IncomingMessage, res: ServerResponse) {
  if (req.url === "/status") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(stringify(status()));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hookline Bridge</title>
<style>body{margin:0;background:#0b0b0c;color:#f4f1ea;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}main{width:min(420px,90vw)}h1{font-size:28px;margin:0 0 4px;letter-spacing:.02em;text-transform:uppercase}p{color:#8d8a83;margin:0 0 20px}form{display:flex;gap:8px}input{flex:1;padding:12px;border:2px solid #333;background:#151517;color:#f4f1ea;font:inherit}button{padding:12px 18px;border:0;background:#ff4a1c;color:#0b0b0c;font-weight:700;text-transform:uppercase;cursor:pointer}#s{margin-top:16px;font-family:ui-monospace,monospace;font-size:13px;text-transform:uppercase;letter-spacing:.08em}</style></head>
<body><main><h1>Hookline Bridge</h1><p>Keep this running while you're live. Your game's setup page can set the account for you, or type it here.</p>
<form id="f"><input id="u" placeholder="your TikTok username" autocomplete="off"><button>Connect</button></form><div id="s">Starting…</div></main>
<script>const ws=new WebSocket("ws://"+location.host);const s=document.getElementById("s");const words={idle:"Waiting for a username",connecting:"Connecting…",live:"Connected to your LIVE",waiting:"Not live yet, trying again soon",error:"Problem"};
ws.onmessage=(m)=>{const e=JSON.parse(m.data);if(e.event!=="bridge")return;const d=e.data;s.textContent=(words[d.state]||d.state)+(d.user?" · @"+d.user:"")+(d.error&&d.state==="error"?" · "+d.error:"");if(d.user)document.getElementById("u").value=d.user};
document.getElementById("f").onsubmit=(ev)=>{ev.preventDefault();ws.send(JSON.stringify({cmd:"connect",user:document.getElementById("u").value}))};</script></body></html>`);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Hookline Bridge ${VERSION} is running on this computer (port ${port}).`);
  console.log(`Open your game's setup page, or http://localhost:${port} to pick your account.`);
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
