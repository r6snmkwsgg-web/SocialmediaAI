"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icons } from "./icons";
import { NoteRow, type NoteView } from "./notes";

/**
 * The bell in the top bar: how many things are new, and the latest few.
 * Opening it counts them as seen; they stay marked new in the list until
 * it's closed, so it's clear which ones they were.
 */
export function Bell({ items, unread: initial, seen }: { items: NoteView[]; unread: number; seen: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initial);
  const [shown, setShown] = useState(items);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setUnread(initial), [initial]);
  // the notifications page marks them seen too
  useEffect(() => {
    const clear = () => setUnread(0);
    window.addEventListener("hl:seen", clear);
    return () => window.removeEventListener("hl:seen", clear);
  }, []);
  useEffect(() => {
    if (!open) setShown(items);
  }, [items, open]);

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

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      void seen();
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center border-2 border-edge text-fg transition hover:border-fg"
      >
        <Icons.bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center bg-signal px-1 font-mono text-[10px] font-bold text-ink" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="fixed inset-x-3 top-[4.5rem] z-50 border-2 border-fg bg-card shadow-[6px_6px_0_0_var(--color-signal)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[24rem]">
          <div className="flex items-center justify-between border-b-2 border-edge px-4 py-3">
            <p className="font-display text-lg uppercase tracking-wide">Notifications</p>
            <Link href="/app/notifications" onClick={() => setOpen(false)} className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted hover:text-fg">
              See all
            </Link>
          </div>
          {shown.length ? (
            <ul className="max-h-[min(28rem,70dvh)] divide-y-2 divide-edge overflow-y-auto">
              {shown.map((n) => (
                <li key={n.id}>
                  <NoteRow n={n} compact onGo={() => setOpen(false)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-[14px] leading-relaxed text-muted">Nothing yet. This is where you hear when a Short posts, a LIVE ends, or something needs you.</p>
          )}
        </div>
      )}
    </div>
  );
}
