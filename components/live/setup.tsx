"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveEvent } from "@/lib/live/events";
import { GAMES } from "@/lib/live/games";
import type { GameId } from "@/lib/live/settings";
import { LiveSource, SOURCES, type SourceId, type SourceState } from "./source";

type Heard = { at: number; e: LiveEvent };
type BridgeStatus = { state: "idle" | "connecting" | "live" | "waiting" | "error"; user: string | null; error: string | null; version?: string };

/** where the bridge's downloads live: the latest GitHub release */
const BRIDGE_REPO = process.env.NEXT_PUBLIC_BRIDGE_REPO || "r6snmkwsgg-web/hookline";
const download = (file: string) => `https://github.com/${BRIDGE_REPO}/releases/latest/download/${file}`;
const DOWNLOADS = [
  { label: "Windows", file: "hookline-bridge-win-x64.exe" },
  { label: "Mac (Apple chip)", file: "hookline-bridge-mac-arm64" },
  { label: "Mac (Intel)", file: "hookline-bridge-mac-x64" },
  { label: "Linux", file: "hookline-bridge-linux-x64" },
];

function describe(e: LiveEvent): string {
  switch (e.kind) {
    case "gift":
      return `sent ${e.count > 1 ? `${e.count}× ` : ""}${e.gift} (${(e.coins * e.count).toLocaleString("en-US")} ${e.coins * e.count === 1 ? "coin" : "coins"})`;
    case "chat":
      return `said “${e.text}”`;
    case "like":
      return `liked ×${e.count}`;
    case "follow":
      return "followed";
    case "share":
      return "shared";
    case "join":
      return "came in";
  }
}

const dot: Record<SourceState, string> = { open: "bg-[#34C759]", connecting: "bg-[#FFD60A] animate-blink", closed: "bg-muted" };
const word: Record<SourceState, string> = { open: "Connected", connecting: "Looking…", closed: "Not running" };
const bridgeWord: Record<BridgeStatus["state"], string> = {
  idle: "Running, waiting for your username",
  connecting: "Connecting to your LIVE…",
  live: "Connected to your LIVE",
  waiting: "You're not live yet: it'll connect when you are",
  error: "Problem",
};

/**
 * The setup page's working parts: pick a game, hear the LIVE (TikFinity
 * or Hookline Bridge, which it can point at the streamer's account), get
 * the address for OBS or LIVE Studio, and see what's coming in.
 */
export function Setup({ overlayKey, game: initial = "battle", locked = [] }: { overlayKey?: string; game?: GameId; locked?: GameId[] } = {}) {
  const [game, setGame] = useState<GameId>(initial);
  const [pick, setPick] = useState<SourceId>("tikfinity");
  const [states, setStates] = useState<Record<SourceId, SourceState>>({ tikfinity: "closed", bridge: "closed" });
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [username, setUsername] = useState("");
  const [heard, setHeard] = useState<Heard[]>([]);
  const [raw, setRaw] = useState<string[]>([]);
  const allRaw = useRef<{ at: string; text: string }[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [clean, setClean] = useState(true);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const sources = useRef<Partial<Record<SourceId, LiveSource>>>({});

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    const made = (Object.keys(SOURCES) as SourceId[]).map((id) => {
      const s = new LiveSource(
        SOURCES[id].url,
        (e) => setHeard((h) => [{ at: Date.now(), e }, ...h].slice(0, 12)),
        (st) => {
          setStates((x) => ({ ...x, [id]: st }));
          if (id === "bridge" && st !== "open") setBridge(null);
        },
        (text) => {
          allRaw.current.push({ at: new Date().toISOString(), text });
          if (allRaw.current.length > 500) allRaw.current.shift();
          // the bridge's own status messages say how it's doing
          if (id === "bridge" && text.includes('"bridge"')) {
            try {
              const m = JSON.parse(text) as { event?: string; data?: BridgeStatus };
              if (m.event === "bridge" && m.data) {
                setBridge(m.data);
                if (m.data.user) setUsername((u) => u || m.data!.user!);
                return;
              }
            } catch {
              // not the bridge's; carry on
            }
          }
          setRaw((r) => [text.length > 400 ? `${text.slice(0, 400)}…` : text, ...r].slice(0, 12));
        },
      );
      sources.current[id] = s;
      s.start();
      return s;
    });
    return () => made.forEach((s) => s.stop());
  }, []);

  const url = useMemo(() => {
    // with a key, the game and everything else come from the streamer's saved settings
    const q = new URLSearchParams(overlayKey ? { src: pick, key: overlayKey } : { src: pick, game });
    if (clean) q.set("clean", "1");
    return `${origin}/live/play?${q}`;
  }, [origin, pick, game, clean, overlayKey]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    sources.current.bridge?.send({ cmd: "connect", user: username });
  };

  /** Everything it's heard, as a file: what to send if the game misreads something. */
  const saveRaw = () => {
    const blob = new Blob([JSON.stringify(allRaw.current, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hookline-live-events-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="grid gap-px bg-edge lg:grid-cols-3">
      {/* 1: hear the live */}
      <div className="flex flex-col gap-5 bg-surface p-6 sm:p-7">
        <span className="outline-num font-display [--stroke:var(--fg)] text-6xl leading-none">01</span>
        <h3 className="font-display text-3xl uppercase tracking-wide">Hear your LIVE</h3>
        <p className="text-[15px] leading-relaxed text-fg/70">
          Something on your computer connects to your LIVE and passes its events on. Pick one, start it, and it turns green here.
        </p>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Where the events come from">
          {(Object.keys(SOURCES) as SourceId[]).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={pick === id}
              onClick={() => setPick(id)}
              className={`flex items-center justify-between gap-3 border-2 px-4 py-3 text-left transition ${pick === id ? "border-fg bg-fg/5" : "border-edge hover:border-fg/50"}`}
            >
              <span>
                <span className="block font-display text-xl uppercase tracking-wide">{id === "bridge" ? "Hookline Bridge" : SOURCES[id].name}</span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                  {id === "tikfinity" ? "If you already use TikFinity" : "Our free app: download, open, done"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg/70">
                <span className={`h-2.5 w-2.5 rounded-full ${dot[states[id]]}`} />
                {word[states[id]]}
              </span>
            </button>
          ))}
        </div>
        {pick === "tikfinity" ? (
          <p className="text-[14px] leading-relaxed text-fg/65">
            Open TikFinity on this computer and connect it to your TikTok account. Hookline listens on its local event connection, port 21213. If it doesn&rsquo;t turn green, look in TikFinity&rsquo;s settings for its WebSocket or Event API and switch it on.
          </p>
        ) : states.bridge === "open" ? (
          <div className="flex flex-col gap-3">
            <form onSubmit={connect} className="flex gap-2">
              <label className="sr-only" htmlFor="tt-user">Your TikTok username</label>
              <input
                id="tt-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your TikTok username"
                autoComplete="off"
                className="min-w-0 flex-1 border-2 border-edge bg-card px-3 py-2 font-mono text-[13px] text-fg outline-none focus:border-fg"
              />
              <button type="submit" className="press bg-signal px-4 py-2 font-display text-lg uppercase tracking-wider text-ink [--press:var(--fg)]">Connect</button>
            </form>
            {bridge && (
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg/75">
                <span className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${bridge.state === "live" ? "bg-[#34C759]" : bridge.state === "error" ? "bg-signal" : "bg-[#FFD60A]"}`} />
                {bridgeWord[bridge.state]}
                {bridge.user ? ` · @${bridge.user}` : ""}
                {bridge.state === "error" && bridge.error ? ` · ${bridge.error}` : ""}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-[14px] leading-relaxed text-fg/65">
            <p>Download Hookline Bridge and open it. It runs in the background; this page finds it and asks for your TikTok username.</p>
            <div className="grid grid-cols-2 gap-1.5">
              {DOWNLOADS.map((d) => (
                <a key={d.file} href={download(d.file)} className="border border-edge px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg transition hover:border-fg">
                  {d.label}
                </a>
              ))}
            </div>
            <p className="text-[12px] text-muted">On a Mac, the first time: right-click it and pick Open. Windows may ask if you trust it: More info, then Run anyway.</p>
          </div>
        )}
      </div>

      {/* 2: put it on the stream */}
      <div className="flex flex-col gap-5 bg-surface p-6 sm:p-7">
        <span className="outline-num font-display [--stroke:var(--fg)] text-6xl leading-none">02</span>
        <h3 className="font-display text-3xl uppercase tracking-wide">{overlayKey ? "Put it on your LIVE" : "Pick a game, put it on"}</h3>
        {overlayKey ? (
          <p className="border-2 border-edge px-3 py-2.5 text-[14px] leading-snug">
            <span className="block font-display text-lg uppercase tracking-wide">{GAMES.find((g) => g.id === initial)?.name}</span>
            <span className="text-fg/60">The game, gifts and everything else come from your settings, so you set this up once.</span>
          </p>
        ) : (
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Which game">
            {GAMES.map((g) => {
              const off = locked.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={game === g.id}
                  disabled={off}
                  onClick={() => setGame(g.id)}
                  className={`border-2 px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${game === g.id ? "border-fg bg-fg/5" : "border-edge hover:border-fg/50"}`}
                >
                  <span className="flex items-center justify-between gap-2 font-display text-lg uppercase tracking-wide">
                    {g.name}
                    {off && <span className="border border-signal px-1.5 font-mono text-[9px] tracking-[0.14em] text-signal">Pro</span>}
                  </span>
                  <span className="block text-[13px] leading-snug text-fg/60">{g.line}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[14px] leading-relaxed text-fg/70">
          In OBS, add a Browser source with this address, 1080 wide and 1920 tall. In TikTok LIVE Studio, add it the same way you&rsquo;d add a TikFinity overlay.
        </p>
        <div className="flex flex-col gap-2">
          <code className="block break-all border border-edge bg-card px-3 py-2.5 font-mono text-[12px] leading-relaxed text-fg">{url || "…"}</code>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={copy} className="press bg-fg px-4 py-2 font-display text-lg uppercase tracking-wider text-surface [--press:var(--color-signal)]">
              {copied ? "Copied" : "Copy address"}
            </button>
            <a href={url || "#"} target="_blank" rel="noreferrer" className="font-display text-lg uppercase tracking-wider underline decoration-signal decoration-2 underline-offset-4 hover:text-signal">
              Open it
            </a>
          </div>
          <label className="mt-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg/70">
            <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} className="accent-[var(--color-signal)]" />
            Hide the hints around the game
          </label>
          {overlayKey && <p className="text-[12px] leading-relaxed text-muted">This address has your private key in it, so the game uses your settings and saves your stats. Don&rsquo;t share it.</p>}
        </div>
        <p className="text-[13px] leading-relaxed text-muted">
          If your browser asks to let the page use apps on this device, allow it. That&rsquo;s how it hears your LIVE.
        </p>
      </div>

      {/* 3: try it */}
      <div className="flex flex-col gap-5 bg-surface p-6 sm:p-7">
        <span className="outline-num font-display [--stroke:var(--fg)] text-6xl leading-none">03</span>
        <h3 className="font-display text-3xl uppercase tracking-wide">Try it first</h3>
        <p className="text-[15px] leading-relaxed text-fg/70">
          On the game, press <kbd className="border border-edge px-1.5 font-mono text-[12px]">T</kbd> for the test panel: every gift, likes and joins, without spending a coin. <kbd className="border border-edge px-1.5 font-mono text-[12px]">D</kbd> fills it with pretend viewers, labeled DEMO.
        </p>
        <div className="flex min-h-[220px] flex-col border border-edge bg-card">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            <span>What it&rsquo;s hearing</span>
            <span className="flex gap-3">
              <button type="button" onClick={saveRaw} className="hover:text-fg">Save log</button>
              <button type="button" onClick={() => setShowRaw((r) => !r)} className="hover:text-fg">{showRaw ? "Readable" : "Raw"}</button>
            </span>
          </div>
          <ol className="flex flex-1 flex-col gap-1.5 overflow-hidden p-3 font-mono text-[11px] leading-snug">
            {showRaw
              ? raw.map((r, i) => <li key={`${raw.length - i}${r.slice(0, 20)}`} className="truncate text-fg/70">{r}</li>)
              : heard.map((h) => (
                  <li key={h.at + h.e.viewer.id + h.e.kind} className="truncate text-fg/80">
                    <span className="text-fg">{h.e.viewer.name}</span> {describe(h.e)}
                  </li>
                ))}
            {(showRaw ? raw.length : heard.length) === 0 && (
              <li className="text-muted">Nothing yet. Once TikFinity or the bridge is connected and you&rsquo;re live, chats and gifts show up here.</li>
            )}
          </ol>
        </div>
        <p className="text-[12px] leading-relaxed text-muted">If a gift or a chat doesn&rsquo;t do what it should, Save log and send us the file.</p>
      </div>
    </div>
  );
}
