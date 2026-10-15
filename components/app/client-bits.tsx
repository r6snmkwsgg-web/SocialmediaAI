"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/** Copies text, and says so. */
export function CopyButton({ text, label = "Copy caption", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** Keeps a page fresh while something on it is still working (a render, say). */
export function AutoRefresh({ active, every = 4000 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [active, every, router]);
  return null;
}

/** A button that runs a server action and refreshes, showing it's busy meanwhile. */
export function ActionButton({ action, children, className = "", busy = "Working…" }: { action: () => Promise<unknown>; children: React.ReactNode; className?: string; busy?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={className}
      onClick={() =>
        start(async () => {
          await action();
          router.refresh();
        })
      }
    >
      {pending ? busy : children}
    </button>
  );
}

/** The device's timezone, sent along with a form so times are right from day one. */
export function TimezoneField({ name = "tz" }: { name?: string }) {
  const [tz, setTz] = useState("");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""), []);
  return <input type="hidden" name={name} value={tz} />;
}

/** Marks everything seen once the page showing it is open, and tells the bell. */
export function MarkSeen({ action, when }: { action: () => Promise<void>; when: boolean }) {
  useEffect(() => {
    if (!when) return;
    void action().then(() => window.dispatchEvent(new Event("hl:seen")));
  }, [action, when]);
  return null;
}
