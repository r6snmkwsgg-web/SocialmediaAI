"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icons } from "./icons";
import { applyTheme, type Theme } from "./theme";

/** The theme as picked here or anywhere else (the command palette can change it too). */
function useTheme(initial: Theme): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    const heard = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("hl:theme", heard);
    return () => window.removeEventListener("hl:theme", heard);
  }, []);
  return [theme, applyTheme];
}

/**
 * The account corner of the top bar: the plan, and a menu with the
 * theme, settings and signing out.
 */
export function AccountMenu({ email, plan, theme: initial }: { email: string; plan: string; theme: Theme }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme(initial);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative flex items-center gap-3">
      <Link href="/app/settings/billing" className={`hidden border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] sm:inline-block ${plan === "Free" ? "border-edge-strong text-muted hover:text-fg" : "border-signal text-signal"}`}>
        {plan}
      </Link>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 w-9 items-center justify-center bg-fg font-display text-lg uppercase text-surface"
        aria-label="Your account"
      >
        {(email[0] ?? "?").toUpperCase()}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-50 w-64 border-2 border-fg bg-card shadow-[6px_6px_0_0_var(--color-signal)]">
          <p className="truncate border-b-2 border-edge px-4 py-3 font-mono text-[11px] text-muted">{email}</p>
          <div className="flex gap-1 border-b-2 border-edge p-2" role="group" aria-label="Theme">
            {(["light", "system", "dark"] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                className={`flex flex-1 items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] ${theme === t ? "bg-fg text-surface" : "text-muted hover:text-fg"}`}
              >
                {t === "light" ? <Icons.sun className="h-3.5 w-3.5" /> : t === "dark" ? <Icons.moon className="h-3.5 w-3.5" /> : null}
                {t === "system" ? "Auto" : t}
              </button>
            ))}
          </div>
          <Link role="menuitem" href="/app/settings" onClick={() => setOpen(false)} className="block px-4 py-2.5 font-display text-base uppercase tracking-wide hover:bg-card-2">
            Settings
          </Link>
          <Link role="menuitem" href="/app/settings/billing" onClick={() => setOpen(false)} className="block px-4 py-2.5 font-display text-base uppercase tracking-wide hover:bg-card-2">
            Plan &amp; billing
          </Link>
          <form action="/auth/signout" method="post">
            <button role="menuitem" type="submit" className="block w-full px-4 py-2.5 text-left font-display text-base uppercase tracking-wide text-signal hover:bg-card-2">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
