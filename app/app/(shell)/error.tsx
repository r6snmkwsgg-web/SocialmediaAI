"use client";
import Link from "next/link";
import { useEffect } from "react";
import { button } from "@/components/app/ui";

/** A section of the app broke: keep everything around it, and offer a way out. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="flex flex-col items-start gap-4 border-2 border-dashed border-edge-strong px-6 py-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Something broke</p>
      <h1 className="font-display text-4xl uppercase leading-none tracking-wide">This part didn&rsquo;t load</h1>
      <p className="max-w-xl text-[15px] leading-relaxed text-muted">
        It&rsquo;s on our side, and nothing of yours is lost. Try again; if it keeps happening, send us the code below.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={reset} className={button.primary}>Try again</button>
        <Link href="/app" className={button.quiet}>Home</Link>
      </div>
      {error.digest && <p className="font-mono text-[11px] text-muted">Code: {error.digest}</p>}
    </div>
  );
}
