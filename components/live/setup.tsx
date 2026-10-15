"use client";
import { useEffect, useMemo, useState } from "react";
import type { LiveEvent } from "@/lib/live/events";
import { tierFor } from "@/lib/live/rules";
import { LiveSource, SOURCES, type SourceId, type SourceState } from "./source";

type Heard = { at: number; e: LiveEvent };

function describe(e: LiveEvent): string {
  switch (e.kind) {
    case "gift":
      return `${e.count > 1 ? `${e.count}× ` : ""}${e.gift} (${e.coins} ${e.coins === 1 ? "coin" : "coins"}): ${tierFor(e.coins).label}`;
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

const dot: Record<SourceState, string> = { open: "bg-[#34C759]", connecting: "bg-[#FFD60A] animate-blink", closed: "bg-dim" };
const word: Record<SourceState, string> = { open: "Connected", connecting: "Looking…", closed: "Not running" };

/**
 * The setup page's working parts: it listens for TikFinity and the bridge
 * on this computer and says which it can hear, shows the last few things
 * it heard, and builds the address to put in OBS or LIVE Studio.
 */
export function Setup() {
  const [pick, setPick] = useState<SourceId>("tikfinity");
  const [states, setStates] = useState<Record<SourceId, SourceState>>({ tikfinity: "closed", bridge: "closed" });
  const [heard, setHeard] = useState<Heard[]>([]);
  const [raw, setRaw] = useState<string[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [clean, setClean] = useState(true);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    const sources = (Object.keys(SOURCES) as SourceId[]).map((id) => {
      const s = new LiveSource(
        SOURCES[id].url,
        (e) => setHeard((h) => [{ at: Date.now(), e }, ...h].slice(0, 12)),
        (st) => setStates((x) => ({ ...x, [id]: st })),
        (text) => setRaw((r) => [text.length > 400 ? `${text.slice(0, 400)}…` : text, ...r].slice(0, 12)),
      );
      s.start();
      return s;
    });
    return () => sources.forEach((s) => s.stop());
  }, []);

  const url = useMemo(() => `${origin}/live/play?src=${pick}${clean ? "&clean=1" : ""}`, [origin, pick, clean]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid gap-px bg-line lg:grid-cols-3">
      {/* 1: hear the live */}
      <div className="flex flex-col gap-5 bg-ink p-6 sm:p-7">
        <span className="outline-num font-display text-6xl leading-none">01</span>
        <h3 className="font-display text-3xl uppercase tracking-wide">Hear your LIVE</h3>
        <p className="text-[15px] leading-relaxed text-paper/70">
          Something on your computer has to be connected to your LIVE and pass its events on. Pick one, start it, and it turns green here.
        </p>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Where the events come from">
          {(Object.keys(SOURCES) as SourceId[]).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={pick === id}
              onClick={() => setPick(id)}
              className={`flex items-center justify-between gap-3 border-2 px-4 py-3 text-left transition ${pick === id ? "border-paper bg-paper/5" : "border-line hover:border-paper/50"}`}
            >
              <span>
                <span className="block font-display text-xl uppercase tracking-wide">{SOURCES[id].name}</span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                  {id === "tikfinity" ? "Free app most streamers already use" : "One command, for the techy route"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper/70">
                <span className={`h-2.5 w-2.5 rounded-full ${dot[states[id]]}`} />
                {word[states[id]]}
              </span>
            </button>
          ))}
        </div>
        {pick === "tikfinity" ? (
          <p className="text-[14px] leading-relaxed text-paper/65">
            Open TikFinity on this computer and connect it to your TikTok account. Hookline listens on its local event connection, port 21213. If it doesn&rsquo;t turn green, look in TikFinity&rsquo;s settings for its WebSocket or Event API and switch it on.
          </p>
        ) : (
          <div className="flex flex-col gap-2 text-[14px] leading-relaxed text-paper/65">
            <p>In the Hookline folder, run this with your TikTok name, while you&rsquo;re live:</p>
            <code className="block overflow-x-auto border border-line bg-ink-2 px-3 py-2 font-mono text-[12px] text-paper">pnpm live:bridge yourname</code>
          </div>
        )}
      </div>

      {/* 2: put it on the stream */}
      <div className="flex flex-col gap-5 bg-ink p-6 sm:p-7">
        <span className="outline-num font-display text-6xl leading-none">02</span>
        <h3 className="font-display text-3xl uppercase tracking-wide">Put it on stream</h3>
        <p className="text-[15px] leading-relaxed text-paper/70">
          In OBS, add a Browser source with this address, 1080 wide and 1920 tall. In TikTok LIVE Studio, add it the same way you&rsquo;d add a TikFinity overlay.
        </p>
        <div className="flex flex-col gap-2">
          <code className="block break-all border border-line bg-ink-2 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-paper">{url || "…"}</code>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={copy} className="press bg-paper px-4 py-2 font-display text-lg uppercase tracking-wider text-ink [--press:var(--color-signal)]">
              {copied ? "Copied" : "Copy address"}
            </button>
            <a href={url || "#"} target="_blank" rel="noreferrer" className="font-display text-lg uppercase tracking-wider underline decoration-signal decoration-2 underline-offset-4 hover:text-signal">
              Open it
            </a>
          </div>
          <label className="mt-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper/70">
            <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} className="accent-[var(--color-signal)]" />
            Hide the hints around the game
          </label>
        </div>
        <p className="text-[13px] leading-relaxed text-dim">
          If your browser asks to let the page use apps on this device, allow it. That&rsquo;s how it hears {SOURCES[pick].name}.
        </p>
      </div>

      {/* 3: try it */}
      <div className="flex flex-col gap-5 bg-ink p-6 sm:p-7">
        <span className="outline-num font-display text-6xl leading-none">03</span>
        <h3 className="font-display text-3xl uppercase tracking-wide">Try it first</h3>
        <p className="text-[15px] leading-relaxed text-paper/70">
          On the game, press <kbd className="border border-line px-1.5 font-mono text-[12px]">T</kbd> for the test panel: every gift, likes and joins, without spending a coin. <kbd className="border border-line px-1.5 font-mono text-[12px]">D</kbd> fills it with pretend viewers, labeled DEMO.
        </p>
        <div className="flex min-h-[220px] flex-col border border-line bg-ink-2">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
            <span>What it&rsquo;s hearing</span>
            <button type="button" onClick={() => setShowRaw((r) => !r)} className="hover:text-paper">{showRaw ? "Readable" : "Raw"}</button>
          </div>
          <ol className="flex flex-1 flex-col gap-1.5 overflow-hidden p-3 font-mono text-[11px] leading-snug">
            {showRaw
              ? raw.map((r, i) => <li key={`${raw.length - i}${r.slice(0, 20)}`} className="truncate text-paper/70">{r}</li>)
              : heard.map((h) => (
                  <li key={h.at + h.e.viewer.id + h.e.kind} className="truncate text-paper/80">
                    <span className="text-paper">{h.e.viewer.name}</span> {describe(h.e)}
                  </li>
                ))}
            {(showRaw ? raw.length : heard.length) === 0 && (
              <li className="text-dim">Nothing yet. Once TikFinity or the bridge is connected and you&rsquo;re live, chats and gifts show up here.</li>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}
