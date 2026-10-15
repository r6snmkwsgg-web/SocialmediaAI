import Link from "next/link";
import { Wordmark } from "@/components/brand";

/**
 * The website's top and bottom: the four parts of Hookline, and the way
 * in. Always dark, like the videos.
 */

const LINKS = [
  { href: "/shorts", label: "Shorts" },
  { href: "/live", label: "Live", live: true },
  { href: "/trends", label: "Trends" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ink/85 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8" aria-label="Hookline">
        <Link href="/" className="text-[26px] leading-none" aria-label="Hookline home">
          <Wordmark />
        </Link>
        <div className="hidden items-center gap-7 font-mono text-[11px] uppercase tracking-[0.18em] text-paper/70 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined} className={`flex items-center gap-1.5 transition hover:text-paper ${current === l.href ? "text-paper" : ""}`}>
              {l.live && <span className="h-1.5 w-1.5 animate-blink rounded-full bg-signal" aria-hidden="true" />}
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-paper/70 transition hover:text-paper sm:inline">Sign in</Link>
          <Link href="/login" className="border border-paper/30 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition hover:border-paper">Start free</Link>
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-3">
          <Wordmark className="text-2xl text-paper" />
          <p className="max-w-md text-[14px] leading-relaxed text-dim">
            Shorts made and posted for you, games for your TikTok LIVE, what&rsquo;s rising, and what you earned. Not affiliated with YouTube, Google, TikTok or TikFinity.
          </p>
        </div>
        <nav aria-label="More" className="grid grid-cols-2 gap-x-10 gap-y-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-paper/70 sm:grid-cols-3">
          <Link href="/shorts" className="hover:text-paper">Shorts</Link>
          <Link href="/live" className="hover:text-paper">Live</Link>
          <Link href="/trends" className="hover:text-paper">Trends</Link>
          <Link href="/#pricing" className="hover:text-paper">Pricing</Link>
          <Link href="/terms" className="hover:text-paper">Terms</Link>
          <Link href="/privacy" className="hover:text-paper">Privacy</Link>
        </nav>
      </div>
      <p className="mx-auto max-w-7xl px-4 pb-10 font-mono text-[10px] uppercase tracking-[0.16em] text-dim sm:px-8">© 2026 Hookline</p>
    </footer>
  );
}

/** For anything on the website that isn't real data: said on it, plainly. */
export function DemoLabel({ children = "Demo" }: { children?: React.ReactNode }) {
  return <span className="inline-block border border-signal px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-signal">{children}</span>;
}
