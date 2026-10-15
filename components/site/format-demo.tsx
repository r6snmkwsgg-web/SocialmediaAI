"use client";
import { useState } from "react";
import { Phone } from "@/components/phone";
import { ShortPlayer } from "@/components/shorts/player";
import type { Spec } from "@/lib/shorts/types";

/**
 * The six formats, each a real Short playing live in the page: the same
 * drawing the renderer posts. Pick one to see it.
 */
export function FormatDemo({ demos, dark = true }: { demos: { name: string; line: string; spec: Spec }[]; dark?: boolean }) {
  const [i, setI] = useState(0);
  const d = demos[i];
  return (
    <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-2" role="tablist" aria-label="Formats">
        {demos.map((x, k) => (
          <button
            key={x.name}
            type="button"
            role="tab"
            aria-selected={k === i}
            onClick={() => setI(k)}
            className={`flex flex-col gap-1 border-2 px-4 py-3 text-left transition ${k === i ? (dark ? "border-paper bg-paper/5" : "border-ink bg-ink/5") : dark ? "border-line hover:border-paper/50" : "border-ink/15 hover:border-ink/50"}`}
          >
            <span className="font-display text-2xl uppercase tracking-wide">{x.name}</span>
            <span className={`text-[14px] leading-snug ${dark ? "text-paper/65" : "text-ink/65"}`}>{x.line}</span>
          </button>
        ))}
      </div>
      <Phone className="relative mx-auto w-full max-w-[320px]">
        <ShortPlayer key={d.name} spec={d.spec} tag={false} />
      </Phone>
    </div>
  );
}
