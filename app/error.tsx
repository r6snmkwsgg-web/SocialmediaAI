"use client";
import Link from "next/link";
import { useEffect } from "react";

/** Something on a page broke: say so plainly, and let them try again. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-20 sm:px-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">Something broke</p>
      <h1 className="mt-3 font-display text-[clamp(3rem,8vw,6rem)] uppercase leading-[0.9]">That didn&rsquo;t load</h1>
      <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-paper/75">
        It&rsquo;s on our side, not yours. Try again; if it keeps happening, tell us the code below and we&rsquo;ll look.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button type="button" onClick={reset} className="press bg-signal px-5 py-3 font-display text-lg uppercase tracking-wider text-ink [--press:var(--color-paper)]">Try again</button>
        <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/70 hover:text-paper">Home</Link>
      </div>
      {error.digest && <p className="mt-10 font-mono text-[11px] text-dim">Code: {error.digest}</p>}
    </main>
  );
}
