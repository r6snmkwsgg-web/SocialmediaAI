"use client";
import { useState } from "react";
import type { LiveEvent } from "@/lib/live/events";

/**
 * What the TikTok and YouTube setups share: the game's address to copy
 * into OBS or LIVE Studio, and the list of what the page is hearing.
 */

/** Something the page heard, and when. */
export type Heard = { at: number; e: LiveEvent };

/** A viewer's event in a few words: a gift with its coins on TikTok, or on YouTube with the power the game gives it. */
export function describe(e: LiveEvent, unit: "coins" | "power" = "coins"): string {
  switch (e.kind) {
    case "gift": {
      const worth = e.coins * e.count;
      const word = unit === "power" ? "power" : worth === 1 ? "coin" : "coins";
      return `sent ${e.count > 1 ? `${e.count}× ` : ""}${e.gift} (${worth.toLocaleString("en-US")} ${word})`;
    }
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

/** Everything the page heard, as a file the browser saves: what to send if the game misreads something. */
export function saveLog(items: unknown[]) {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `hookline-live-events-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The game's address, to copy or open, and whether the hints around the game show. `keyed` when it carries the streamer's private key. */
export function AddressBox({ url, clean, onClean, keyed }: { url: string; clean: boolean; onClean: (on: boolean) => void; keyed: boolean }) {
  const [copied, setCopied] = useState(false);
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
        <input type="checkbox" checked={clean} onChange={(e) => onClean(e.target.checked)} className="accent-[var(--color-signal)]" />
        Hide the hints around the game
      </label>
      {keyed && <p className="text-[12px] leading-relaxed text-muted">This address has your private key in it, so the game uses your settings and saves your stats. Don&rsquo;t share it.</p>}
    </div>
  );
}

/**
 * What the page is hearing, newest first: readable, or with `raw`, as it
 * came if the streamer asks. Save log keeps everything heard as a file.
 */
export function HearingLog({ heard, raw, unit, empty, onSave }: { heard: Heard[]; raw?: string[]; unit?: "coins" | "power"; empty: string; onSave: () => void }) {
  const [showRaw, setShowRaw] = useState(false);
  const rows = showRaw && raw ? raw.length : heard.length;
  return (
    <div className="flex min-h-[220px] flex-col border border-edge bg-card">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        <span>What it&rsquo;s hearing</span>
        <span className="flex gap-3">
          <button type="button" onClick={onSave} className="hover:text-fg">Save log</button>
          {raw && <button type="button" onClick={() => setShowRaw((r) => !r)} className="hover:text-fg">{showRaw ? "Readable" : "Raw"}</button>}
        </span>
      </div>
      <ol className="flex flex-1 flex-col gap-1.5 overflow-hidden p-3 font-mono text-[11px] leading-snug">
        {showRaw && raw
          ? raw.map((r, i) => <li key={`${raw.length - i}${r.slice(0, 20)}`} className="truncate text-fg/70">{r}</li>)
          : heard.map((h) => (
              <li key={h.at + h.e.viewer.id + h.e.kind} className="truncate text-fg/80">
                <span className="text-fg">{h.e.viewer.name}</span> {describe(h.e, unit)}
              </li>
            ))}
        {rows === 0 && <li className="text-muted">{empty}</li>}
      </ol>
    </div>
  );
}
