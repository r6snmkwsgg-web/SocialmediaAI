"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { score } from "@/lib/app/search";
import { Icons } from "./icons";
import { applyTheme } from "./theme";
import { toast } from "./toast";

type Command = {
  id: string;
  label: string;
  group: "Go to" | "Do";
  icon: (p: { className?: string }) => React.JSX.Element;
  /** other words people might type for it */
  words?: string;
  href?: string;
  run?: () => void;
};

const signOut = () => {
  const f = document.createElement("form");
  f.method = "post";
  f.action = "/auth/signout";
  document.body.appendChild(f);
  f.submit();
};

function commands(theme: (t: "light" | "dark" | "system") => void): Command[] {
  return [
    { id: "home", group: "Go to", label: "Home", icon: Icons.home, href: "/app", words: "today dashboard setup" },
    { id: "queue", group: "Go to", label: "Shorts: your queue", icon: Icons.shorts, href: "/app/shorts", words: "swipe approve videos" },
    { id: "live", group: "Go to", label: "Live: your game", icon: Icons.live, href: "/app/live", words: "tiktok live game gifts obs overlay stream" },
    { id: "trends", group: "Go to", label: "Trends", icon: Icons.trends, href: "/app/trends", words: "rising niches best times what's working" },
    { id: "earnings", group: "Go to", label: "Earnings", icon: Icons.earnings, href: "/app/earnings", words: "money revenue stripe goals views" },
    { id: "notes", group: "Go to", label: "Notifications", icon: Icons.bell, href: "/app/notifications", words: "alerts news" },
    { id: "settings", group: "Go to", label: "Settings", icon: Icons.settings, href: "/app/settings", words: "profile timezone account connect delete" },
    { id: "billing", group: "Go to", label: "Plan & billing", icon: Icons.card, href: "/app/settings/billing", words: "upgrade pro creator subscription cancel invoice" },
    { id: "yt", group: "Do", label: "Connect YouTube", icon: Icons.plug, href: `/api/connect/youtube?next=${encodeURIComponent("/app/settings")}`, words: "channel google" },
    { id: "tt", group: "Do", label: "Connect TikTok", icon: Icons.plug, href: `/api/connect/tiktok?next=${encodeURIComponent("/app/settings")}`, words: "account" },
    { id: "light", group: "Do", label: "Theme: light", icon: Icons.sun, run: () => theme("light"), words: "mode appearance" },
    { id: "dark", group: "Do", label: "Theme: dark", icon: Icons.moon, run: () => theme("dark"), words: "mode appearance night" },
    { id: "auto", group: "Do", label: "Theme: match my device", icon: Icons.settings, run: () => theme("system"), words: "mode appearance auto system" },
    { id: "out", group: "Do", label: "Sign out", icon: Icons.x, run: signOut, words: "log out logout" },
  ];
}

/**
 * Jump anywhere or do something without hunting for it: Ctrl K (⌘K on a
 * Mac) from any screen, or the search button in the top bar. Arrows move,
 * Enter goes, Escape closes.
 */
export function Palette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [mac, setMac] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const list = useId();

  const all = useMemo(
    () =>
      commands((t) => {
        applyTheme(t);
        toast(t === "system" ? "Following your device's theme" : `${t === "dark" ? "Dark" : "Light"} theme`, "good");
      }),
    [],
  );
  const shown = useMemo(
    () => all.map((c) => ({ c, s: score(c, query) })).filter((x) => x.s > 0).sort((a, b) => (query ? b.s - a.s : 0)).map((x) => x.c),
    [all, query],
  );

  const show = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setAt(0);
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    opener.current?.focus?.();
  }, []);

  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) hide();
        else show();
      }
    };
    const fromButton = () => show();
    window.addEventListener("keydown", key);
    window.addEventListener("hl:palette", fromButton);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("hl:palette", fromButton);
    };
  }, [open, show, hide]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => setAt(0), [query]);

  const go = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    if (c.run) c.run();
    else if (c.href?.startsWith("/api/")) window.location.href = c.href;
    else if (c.href) router.push(c.href);
  };

  if (!open) return null;
  let group = "";
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/55 px-3 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && hide()}>
      <div role="dialog" aria-modal="true" aria-label="Search or jump to" className="w-full max-w-xl border-2 border-fg bg-card shadow-[8px_8px_0_0_var(--color-signal)]">
        <div className="flex items-center gap-3 border-b-2 border-edge px-4">
          <Icons.search className="h-5 w-5 shrink-0 text-muted" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((i) => Math.min(shown.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(shown[at]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                hide();
              }
            }}
            placeholder="Search or jump to…"
            role="combobox"
            aria-expanded="true"
            aria-controls={list}
            aria-activedescendant={shown[at] ? `${list}-${shown[at].id}` : undefined}
            aria-autocomplete="list"
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-fg placeholder:text-muted focus:outline-none focus-visible:outline-none"
          />
          <kbd className="hidden border border-edge-strong px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">ESC</kbd>
        </div>
        <ul id={list} role="listbox" aria-label="Commands" className="max-h-[min(24rem,55dvh)] overflow-y-auto py-2">
          {shown.length === 0 && <li className="px-4 py-6 text-[14px] text-muted">Nothing matches &ldquo;{query}&rdquo;.</li>}
          {shown.map((c, i) => {
            const head = !query && c.group !== group ? (group = c.group) : null;
            return (
              <li key={c.id} role="presentation">
                {head && <p className="px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted first:pt-1">{head}</p>}
                <div
                  id={`${list}-${c.id}`}
                  role="option"
                  aria-selected={i === at}
                  onMouseMove={() => setAt(i)}
                  onClick={() => go(c)}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[15px] ${i === at ? "bg-fg text-surface" : "text-fg"}`}
                >
                  <c.icon className={`h-[18px] w-[18px] shrink-0 ${i === at ? "text-signal" : "text-muted"}`} />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {i === at && <span className="font-mono text-[10px] uppercase tracking-[0.14em]">Enter</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="hidden items-center justify-between border-t-2 border-edge px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted sm:flex">
          <span>↑ ↓ to move · Enter to go</span>
          <span>{mac ? "⌘K" : "Ctrl K"} anywhere</span>
        </div>
      </div>
    </div>
  );
}

/** The way into the palette from the top bar: a search box on wide screens, an icon on phones. */
export function PaletteButton() {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  const open = () => window.dispatchEvent(new Event("hl:palette"));
  return (
    <>
      <button
        type="button"
        onClick={open}
        className="hidden h-9 w-60 items-center gap-2.5 border-2 border-edge px-3 text-left text-[14px] text-muted transition hover:border-fg hover:text-fg md:flex"
      >
        <Icons.search className="h-4 w-4 shrink-0" />
        <span className="flex-1">Jump to…</span>
        <kbd className="font-mono text-[10px]">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <button type="button" onClick={open} aria-label="Search or jump to" className="flex h-9 w-9 items-center justify-center border-2 border-edge text-fg transition hover:border-fg md:hidden">
        <Icons.search className="h-[18px] w-[18px]" />
      </button>
    </>
  );
}
