import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";

export const metadata: Metadata = { title: "Not here", robots: { index: false } };

/** A page that doesn't exist: say so, and offer the ways back. */
export default function NotFound() {
  return (
    <main className="overflow-x-clip">
      <SiteHeader />
      <section className="mx-auto flex min-h-[60dvh] max-w-3xl flex-col justify-center px-4 py-20 sm:px-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">404</p>
        <h1 className="mt-3 font-display text-[clamp(3.4rem,9vw,7rem)] uppercase leading-[0.9]">
          Nothing <span className="text-signal">here</span>
        </h1>
        <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-paper/75">The link might be old, or the page moved. Everything Hookline does is one of these:</p>
        <div className="mt-8 flex flex-wrap gap-3 font-mono text-[11px] uppercase tracking-[0.16em]">
          <Link href="/" className="press bg-signal px-5 py-3 font-display text-lg uppercase tracking-wider text-ink [--press:var(--color-paper)]">Home</Link>
          {[["/shorts", "Shorts"], ["/live", "Live"], ["/trends", "Trends"], ["/app", "Your account"]].map(([href, label]) => (
            <Link key={href} href={href} className="border border-paper/30 px-4 py-3.5 transition hover:border-paper">{label}</Link>
          ))}
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
