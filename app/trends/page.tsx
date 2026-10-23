import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@/components/brand";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { ExampleTrends } from "@/components/site/examples";
import { NICHES } from "@/lib/trends/niches";

export const metadata: Metadata = {
  title: "Trends: what's rising on Shorts",
  description: "The Shorts growing fastest in your niches right now, measured in views per hour from YouTube, with one tap to make one like it.",
  openGraph: { images: ["/og/trends.png"] },
};

const HOW = [
  { title: "Views per hour", body: "Total views tell you what already happened. Views per hour since upload tell you what's taking off now, while there's still time to ride it." },
  { title: "Straight from YouTube", body: "Every figure comes from YouTube's official API, checked once a day. Nothing scraped, nothing guessed." },
  { title: "Make one like this", body: "Rising Shorts in a format Hookline makes come with a button: a Short in the same format goes straight into your queue." },
];

export default function TrendsSite() {
  return (
    <main className="overflow-x-clip">
      <SiteHeader current="/trends" />
      <section>
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pb-20 pt-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pb-28 lg:pt-20">
          <div className="flex flex-col gap-7">
            <Eyebrow>Trends</Eyebrow>
            <h1 className="font-display text-[clamp(3.6rem,9vw,7.6rem)] uppercase leading-[0.9]">
              Catch it while it&rsquo;s <span className="text-signal">rising.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-paper/80 sm:text-xl">
              See which Shorts are growing fastest in your niches right now, how each format is doing this week, and when your own posts do best.
            </p>
            <Link href="/login" className="press w-fit bg-signal px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-ink">Start free →</Link>
          </div>
          <ExampleTrends />
        </div>
      </section>

      <section className="border-y border-line bg-ink-2">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-24">
          <Eyebrow>How it&rsquo;s measured</Eyebrow>
          <ul className="mt-10 grid gap-px bg-line md:grid-cols-3">
            {HOW.map((h) => (
              <li key={h.title} className="flex flex-col gap-3 bg-ink-2 p-6 sm:p-7">
                <h2 className="font-display text-3xl uppercase tracking-wide">{h.title}</h2>
                <p className="text-[15px] leading-relaxed text-paper/70">{h.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:py-24">
          <div>
            <Eyebrow>Niches</Eyebrow>
            <h2 className="mt-4 font-display text-[clamp(2.6rem,5.5vw,4.6rem)] uppercase leading-[0.92]">Follow the ones you post in.</h2>
          </div>
          <div className="flex flex-col gap-6">
            <ul className="flex flex-wrap gap-2">
              {NICHES.map((n) => (
                <li key={n.id} className={`border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] ${n.format ? "border-paper text-paper" : "border-line text-paper/60"}`}>{n.name}</li>
              ))}
            </ul>
            <p className="max-w-xl text-[16px] leading-relaxed text-paper/75">
              The ones in white are formats Hookline makes, so you can make one like any rising Short in them. The rest are there to watch. Your best posting times come from your own Shorts&rsquo; results, by day and hour, once you&rsquo;ve posted a few.
            </p>
            <p className="max-w-xl text-[14px] leading-relaxed text-dim">
              TikTok doesn&rsquo;t share trending data with apps like this one, so Trends covers YouTube Shorts.
            </p>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
