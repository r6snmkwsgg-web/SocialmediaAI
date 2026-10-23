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
import { CHANNEL_NICHES } from "@/lib/shorts/niches";

export const metadata: Metadata = {
  title: { absolute: "Hookline: your channel runs itself" },
  description: "Hookline watches what's rising on YouTube Shorts, makes Shorts in your niche that ride it, posts the ones you say yes to at your best hours, and learns from every one. Your TikTok LIVE runs itself too. Start free.",
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

const LOOP = [
  { n: "01", title: "Spots what's rising", body: "Every day it reads the Shorts growing fastest on YouTube in your niche, by views per hour." },
  { n: "02", title: "Makes Shorts that ride it", body: "Each morning your Shorts are made for you. When a format is taking off, you get more of it while it lasts." },
  { n: "03", title: "Posts at your best hours", body: "Swipe right and it's booked for the hours your own Shorts do best. Left, and a different one takes its place.", you: true },
  { n: "04", title: "Learns from every one", body: "It reads each Short's views at an hour, a day and three days, then makes more of what beat your usual." },
];

// what the picker offers, with the Ball League last: it's one niche of eight, not the point
const NICHES = [...CHANNEL_NICHES.filter((n) => n.id !== "league"), ...CHANNEL_NICHES.filter((n) => n.id === "league")];

export default function Home() {
  const demos = demoShorts(["quiz", "ranking", "race", "wyr", "texts", "battle"]);
  const [quiz, , race] = demos;
  return (
    <main className="overflow-x-clip">
      <SiteHeader />

      {/* hero */}
      <section>
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-14 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:pb-28 lg:pt-20">
          <div className="flex flex-col gap-7">
            <Eyebrow>
              <span className="mr-2 inline-block h-2 w-2 translate-y-[-1px] animate-blink rounded-full bg-signal align-middle" />
              Shorts and LIVEs on autopilot
            </Eyebrow>
            <h1 className="font-display text-[clamp(3.4rem,7vw,6.6rem)] uppercase leading-[0.9] tracking-[0.01em]">
              Your channel
              <br />
              <span className="text-signal">runs itself.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-paper/80 sm:text-xl">
              Hookline watches what&rsquo;s rising on YouTube Shorts every day, makes Shorts in your niche that ride it, posts the ones you say yes to at your best hours, and learns from every one. Your TikTok LIVE runs itself too. No face, no voice, no editing.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pt-1">
              <Link href="/login" className="press bg-signal px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-ink">Start free →</Link>
              <a href="#how" className="font-display text-2xl uppercase tracking-wider text-paper underline decoration-signal decoration-[3px] underline-offset-[6px] transition hover:text-signal">See how</a>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">3 Shorts a week free · The LIVE game free · No card</p>
          </div>

          <div className="relative mx-auto h-[600px] w-full max-w-[460px] sm:h-[680px]">
            <Phone className="absolute right-0 top-12 w-[56%] rotate-[6deg]">
              <ShortPlayer spec={race.spec} tag={false} />
            </Phone>
            <Phone className="absolute left-0 top-0 w-[62%] -rotate-[3deg]">
              <ShortPlayer spec={quiz.spec} tag={false} />
            </Phone>
            <span className="absolute bottom-8 left-4 -rotate-[3deg] border-2 border-ink bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink shadow-[4px_4px_0_0_var(--color-signal)]">
              Real Shorts it made, playing live
            </span>
          </div>
        </div>
      </section>

      {/* the loop */}
      <section id="how" className="scroll-mt-16 border-t border-line bg-ink-2">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>Every day, by itself</Eyebrow>
          <h2 className="mt-4 max-w-5xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">It watches. It makes. It posts. It learns.</h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-paper/75">
            The same loop runs every day for every channel you connect. Your part is one swipe: nothing goes out without your yes.
          </p>
          <ol className="mt-14 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {LOOP.map((s) => (
              <li key={s.n} className={`flex flex-col gap-4 p-6 sm:p-7 ${s.you ? "bg-signal text-ink" : "bg-ink"}`}>
                <span className="outline-num font-display text-7xl leading-none" style={s.you ? ({ "--stroke": "var(--color-ink)" } as React.CSSProperties) : undefined}>{s.n}</span>
                <h3 className="font-display text-4xl uppercase tracking-wide">{s.title}</h3>
                <p className={`text-[15px] leading-relaxed ${s.you ? "text-ink/85" : "text-paper/70"}`}>{s.body}</p>
                {s.you && <span className="mt-auto w-fit border-2 border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">Your one job</span>}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* trends */}
      <section className="border-t border-line">
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:py-28">
          <div className="flex flex-col gap-6">
            <Eyebrow>01 · Trends</Eyebrow>
            <h2 className="font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">It follows the trends for you.</h2>
            <p className="max-w-xl text-lg leading-relaxed text-paper/75">
              Hookline reads the Shorts growing fastest in your niches every day, straight from YouTube. When a format is taking off, your next Shorts lean into it, and each one tells you why it was made. See one you like? Make one like it in a tap.
            </p>
            <Link href="/trends" className="w-fit font-display text-2xl uppercase tracking-wider underline decoration-signal decoration-[3px] underline-offset-[6px] hover:text-signal">More on Trends →</Link>
          </div>
          <ExampleTrends />
        </div>
      </section>

      {/* shorts */}
      <section id="shorts" className="scroll-mt-16 border-t border-line bg-ink-2">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>02 · Shorts</Eyebrow>
          <div className="mb-12 mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
            <h2 className="font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Made for you. Every frame.</h2>
            <p className="max-w-lg text-lg leading-relaxed text-paper/75">
              Six formats, every frame drawn by code. Each Short is the best of many runs, titled from what&rsquo;s really in it, and only ever made once: no other channel gets it.
            </p>
          </div>
          <FormatDemo demos={demos} />
          <Link href="/shorts" className="mt-10 inline-block font-display text-2xl uppercase tracking-wider underline decoration-signal decoration-[3px] underline-offset-[6px] hover:text-signal">More on Shorts →</Link>
        </div>
      </section>

      {/* niches */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>Setup</Eyebrow>
          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
            <h2 className="font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Pick what your channel is about.</h2>
            <p className="max-w-lg text-lg leading-relaxed text-paper/75">
              That&rsquo;s the whole setup. A channel only ever gets Shorts about its niche, and each YouTube channel you connect can have its own.
            </p>
          </div>
          <ul className="mt-14 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {NICHES.map((n) => (
              <li key={n.id} className="flex flex-col gap-2 bg-ink p-6">
                <h3 className="font-display text-3xl uppercase tracking-wide">{n.name}</h3>
                <p className="text-[14px] leading-relaxed text-paper/65">{n.line}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* live */}
      <section className="border-t border-line bg-ink-2">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-28">
          <div className="flex flex-col gap-6">
            <Eyebrow>
              <span className="mr-2 inline-block h-2 w-2 translate-y-[-1px] animate-blink rounded-full bg-signal align-middle" />
              03 · For TikTok LIVE
            </Eyebrow>
            <h2 className="max-w-3xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Your LIVE runs itself too.</h2>
            <p className="max-w-xl text-lg leading-relaxed text-paper/75">
              Add the game to TikTok LIVE Studio once. Your chat joins with a word, every gift does something on screen, and between rounds chat votes for what&rsquo;s next. The best rounds come back as Shorts.
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

      {/* earnings */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>04 · Earnings</Eyebrow>
          <div className="mb-10 mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
            <h2 className="font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Watch it add up.</h2>
            <p className="max-w-lg text-lg leading-relaxed text-paper/75">
              YouTube, TikTok, the gift coins seen on your own LIVEs and your Stripe sales, day by day, with goals to aim for. Real figures only. Coins stay coins, never dressed up as cash.
            </p>
          </div>
          <ExampleEarnings />
        </div>
      </section>

      {/* the tools around it */}
      <section className="border-t border-line bg-ink-2">
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
          <h2 className="font-display text-[clamp(3.4rem,10vw,9rem)] uppercase leading-[0.92]">Set it up once.<br />Let it run.</h2>
          <Link href="/login" className="press bg-ink px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-paper">Start free →</Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
