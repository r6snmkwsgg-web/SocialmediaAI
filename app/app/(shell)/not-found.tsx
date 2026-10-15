import Link from "next/link";
import { button } from "@/components/app/ui";

/** Something in the app that isn't there (an old link to a Short, say), inside the app. */
export default function AppNotFound() {
  return (
    <div className="flex flex-col items-start gap-4 border-2 border-dashed border-edge-strong px-6 py-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Not found</p>
      <h1 className="font-display text-4xl uppercase leading-none tracking-wide">That&rsquo;s not here</h1>
      <p className="max-w-xl text-[15px] leading-relaxed text-muted">It may have been deleted, or the link belongs to another account.</p>
      <Link href="/app" className={button.primary}>Home</Link>
    </div>
  );
}
