import type { Metadata } from "next";
import Link from "next/link";
import { Icons } from "@/components/app/icons";
import { Eyebrow } from "@/components/brand";
import { Phone } from "@/components/phone";
import { ShortPlayer } from "@/components/shorts/player";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { ExampleEarnings, ExampleTrends } from "@/components/site/examples";
import { Faq, FAQ_ALL } from "@/components/site/faq";
import { FormatDemo } from "@/components/site/format-demo";
import { Pricing } from "@/components/site/pricing";
import { GAMES } from "@/lib/live/games";
import { demoShorts } from "@/lib/shorts/demos";

export const metadata: Metadata = {
  title: { absolute: "Hookline: content that makes itself, lives that pay" },
  description: "Shorts made and posted for you, games your TikTok LIVE chat plays with gifts, what's rising on Shorts, and what you earned, in one place. Start free.",
  openGraph: { images: ["/og/home.png"] },
};

const TOOLS = [
  { icon: Icons.calendar, title: "A calendar", body: "Every Short on the day and hour it goes out, in your timezone, and every one that already did." },
  { icon: Icons.grid, title: "A library", body: "Everything you've posted, with its views at an hour, a day and three days, and how it did against your usual." },
  { icon: Icons.trends, title: "What's working", body: "Which formats beat your usual Short. Hookline makes more of those and fewer of the rest, and shows you why." },
  { icon: Icons.bell, title: "Told when it matters", body: "When a Short goes live, a LIVE ends, a video takes off, or an account needs you. Nothing else." },
  { icon: Icons.search, title: "Ctrl K", body: "Jump to any screen or do the common things with a few letters, from anywhere in the app." },
  { icon: Icons.shorts, title: "On your phone", body: "Add it to your home screen and it opens like an app. Swipe your queue on the bus." },
];

const STEPS = [
  { n: "01", title: "Swipe", body: "Each morning your Shorts are waiting. Right to post, left for a different one. Nothing goes out without your yes.", you: true },
  { n: "02", title: "It posts", body: "At the hour your Shorts do best, then it reads how each one did and makes more of what worked." },
  { n: "03", title: "Go live", body: "Add the game to TikTok LIVE Studio once. Your chat joins with a word, and every gift does something on screen." },
  { n: "04", title: "Watch it add up", body: "Views, subscribers, gift coins and sales, from your real accounts, day by day." },
];

export default function Home() {
  const demos = demoShorts();
  return (
    <main className="overflow-x-clip">
      <SiteHeader />

      {/* hero */}
      <section>
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-14 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:pb-28 lg:pt-20">
          <div className="flex flex-col gap-7">
            <Eyebrow>
              <span className="mr-2 inline-block h-2 w-2 translate-y-[-1px] animate-blink rounded-full bg-signal align-middle" />
              For creators who&rsquo;d rather not edit
            </Eyebrow>
            <h1 className="font-display text-[clamp(3.4rem,7vw,6.6rem)] uppercase leading-[0.9] tracking-[0.01em]">
              Content that makes itself.
              <br />
              <span className="text-signal">Lives that pay.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-paper/80 sm:text-xl">
              Hookline makes your Shorts and posts the ones you approve, runs games your TikTok LIVE chat plays with gifts, shows what&rsquo;s rising, and adds up what you made. No face, no voice, no editing.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pt-1">
              <Link href="/login" className="press bg-signal px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-ink">Start free →</Link>
              <a href="#shorts" className="font-display text-2xl uppercase tracking-wider text-paper underline decoration-signal decoration-[3px] underline-offset-[6px] transition hover:text-signal">See it work</a>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">3 Shorts a week free · The LIVE game free · No card</p>
          </div>

          <div className="relative mx-auto h-[600px] w-full max-w-[460px] sm:h-[680px]">
            <Phone className="absolute right-0 top-12 w-[56%] rotate-[6deg]">
              <iframe src="/live/play?demo=1&clean=1" title="The LIVE game, with pretend viewers" className="block aspect-[9/16] w-full border-0" loading="lazy" />
            </Phone>
            <Phone className="absolute left-0 top-0 w-[62%] -rotate-[3deg]">
              <ShortPlayer spec={demos[0].spec} tag={false} />
            </Phone>
            <span className="absolute bottom-8 left-4 -rotate-[3deg] border-2 border-ink bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink shadow-[4px_4px_0_0_var(--color-signal)]">
              Both running right here, live
            </span>
          </div>
        </div>
      </section>

      {/* 01 shorts */}
      <section id="shorts" className="scroll-mt-16 border-t border-line bg-ink-2">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>01 · Shorts</Eyebrow>
          <div className="mb-12 mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
            <h2 className="font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">You swipe. It posts.</h2>
            <p className="max-w-lg text-lg leading-relaxed text-paper/75">
              Six formats, every frame drawn by code. Each Short is the best of many runs, titled from what&rsquo;s really in it, and posted at your best time once you say yes.
            </p>
          </div>
          <FormatDemo demos={demos} />
          <Link href="/shorts" className="mt-10 inline-block font-display text-2xl uppercase tracking-wider underline decoration-signal decoration-[3px] underline-offset-[6px] hover:text-signal">More on Shorts →</Link>
        </div>
      </section>

      {/* 02 live */}
      <section className="border-t border-line">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-28">
          <div className="flex flex-col gap-6">
            <Eyebrow>
              <span className="mr-2 inline-block h-2 w-2 translate-y-[-1px] animate-blink rounded-full bg-signal align-middle" />
              02 · For TikTok LIVE
            </Eyebrow>
            <h2 className="max-w-3xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Your chat plays. Every gift does something.</h2>
            <p className="max-w-xl text-lg leading-relaxed text-paper/75">
              Four games your viewers join with a word. Gifts heal, drop in fighters with the gifter&rsquo;s face, call down meteors. Between rounds, chat votes for what&rsquo;s next.
            </p>
            <ul className="grid max-w-2xl gap-px bg-line sm:grid-cols-2">
              {GAMES.map((g) => (
                <li key={g.id} className="flex flex-col gap-1.5 bg-ink p-4">
                  <span className="font-display text-2xl uppercase tracking-wide">{g.name}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal">{g.join}</span>
                  <span className="text-[13px] leading-snug text-paper/65">{g.line}</span>
                </li>
              ))}
            </ul>
            <Link href="/live" className="press mt-2 w-fit bg-signal px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-ink">See the LIVE games →</Link>
          </div>
          <Phone className="relative mx-auto w-full max-w-[320px] -rotate-2">
            <iframe src="/live/play?demo=1&clean=1&game=race" title="Ball Race, with pretend viewers" className="block aspect-[9/16] w-full border-0" loading="lazy" />
          </Phone>
        </div>
      </section>

      {/* 03 trends */}
      <section className="border-t border-line bg-ink-2">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:py-28">
          <div className="flex flex-col gap-6">
            <Eyebrow>03 · Trends</Eyebrow>
            <h2 className="font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Catch it while it&rsquo;s rising.</h2>
            <p className="max-w-xl text-lg leading-relaxed text-paper/75">
              The Shorts growing fastest in your niches right now, by views per hour, straight from YouTube. See one you like? Make one like it in a tap.
            </p>
            <Link href="/trends" className="w-fit font-display text-2xl uppercase tracking-wider underline decoration-signal decoration-[3px] underline-offset-[6px] hover:text-signal">More on Trends →</Link>
          </div>
          <ExampleTrends />
        </div>
      </section>

      {/* 04 earnings */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>04 · Earnings</Eyebrow>
          <div className="mb-10 mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
            <h2 className="font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Every number, from where it really is.</h2>
            <p className="max-w-lg text-lg leading-relaxed text-paper/75">
              YouTube, TikTok, your LIVE game&rsquo;s gift coins and your Stripe sales, day by day, with goals to aim for. Real figures only. Coins stay coins, never dressed up as cash.
            </p>
          </div>
          <ExampleEarnings />
        </div>
      </section>

      {/* how */}
      <section className="border-t border-line bg-ink-2">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-4 max-w-4xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Four parts. One job is yours.</h2>
          <ol className="mt-14 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className={`flex flex-col gap-4 p-6 sm:p-7 ${s.you ? "bg-signal text-ink" : "bg-ink"}`}>
                <span className="outline-num font-display text-7xl leading-none" style={s.you ? ({ "--stroke": "var(--color-ink)" } as React.CSSProperties) : undefined}>{s.n}</span>
                <h3 className="font-display text-4xl uppercase tracking-wide">{s.title}</h3>
                <p className={`text-[15px] leading-relaxed ${s.you ? "text-ink/85" : "text-paper/70"}`}>{s.body}</p>
                {s.you && <span className="mt-auto w-fit border-2 border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">This one&rsquo;s you</span>}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* the tools around it */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>Every day</Eyebrow>
          <h2 className="mt-4 max-w-4xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Built to run your channel, not just make a video.</h2>
          <ul className="mt-14 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((t) => (
              <li key={t.title} className="flex flex-col gap-3 bg-ink p-6 sm:p-7">
                <t.icon className="h-7 w-7 text-signal" />
                <h3 className="font-display text-3xl uppercase tracking-wide">{t.title}</h3>
                <p className="text-[15px] leading-relaxed text-paper/70">{t.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" className="scroll-mt-16 bg-paper text-ink">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow dark>Pricing</Eyebrow>
          <h2 className="mb-10 mt-4 font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Start free. Stay if it works.</h2>
          <Pricing />
        </div>
      </section>

      {/* faq */}
      <section id="faq" className="scroll-mt-16">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:py-28">
          <div>
            <Eyebrow>Questions</Eyebrow>
            <h2 className="mt-4 font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Straight answers.</h2>
          </div>
          <Faq items={FAQ_ALL} />
        </div>
      </section>

      <section className="border-t border-line bg-signal text-ink">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 px-4 py-20 sm:px-8 lg:py-24">
          <h2 className="font-display text-[clamp(3.4rem,10vw,9rem)] uppercase leading-[0.92]">Stop editing.<br />Start posting.</h2>
          <Link href="/login" className="press bg-ink px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-paper">Start free →</Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
