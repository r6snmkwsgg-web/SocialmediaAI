"use client";
import { useEffect, useState } from "react";
import { Icons } from "./icons";

type Tone = "plain" | "good" | "bad";
type Item = { id: number; text: string; tone: Tone };

let next = 1;

/** Says something briefly at the bottom of the screen: "Saved", "Posting Tue 4:00 PM". */
export function toast(text: string, tone: Tone = "plain") {
  window.dispatchEvent(new CustomEvent("hl:toast", { detail: { text, tone } }));
}

/** Where toasts show: above the tab bar on a phone, bottom centre otherwise. Read out by screen readers. */
export function Toaster() {
  const [list, setList] = useState<Item[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const { text, tone } = (e as CustomEvent<{ text: string; tone: Tone }>).detail;
      const id = next++;
      setList((l) => [...l.slice(-2), { id, text, tone }]);
      setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3600);
    };
    window.addEventListener("hl:toast", on);
    return () => window.removeEventListener("hl:toast", on);
  }, []);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[65] flex flex-col items-center gap-2 px-4 lg:bottom-8">
      {list.map((t) => (
        <div
          key={t.id}
          className={`toast-in flex max-w-md items-center gap-2.5 border-2 px-4 py-3 text-[14px] font-medium shadow-[5px_5px_0_0_var(--color-signal)] ${t.tone === "bad" ? "border-signal bg-card text-fg" : "border-fg bg-fg text-surface"}`}
        >
          {t.tone === "good" && <Icons.check className="h-4 w-4 shrink-0 text-signal" />}
          {t.tone === "bad" && <Icons.alert className="h-4 w-4 shrink-0 text-signal" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
