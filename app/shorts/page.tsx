import type { Metadata } from "next";
import Link from "next/link";
import { BattlePlayer } from "@/components/battle-player";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { Faq, FAQ_ALL } from "@/components/site/faq";
import { FormatDemo } from "@/components/site/format-demo";
import { Pricing } from "@/components/site/pricing";
import { demoShorts } from "@/lib/shorts/demos";
import { Maker } from "@/components/maker";
import { Phone } from "@/components/phone";
import { Eyebrow } from "@/components/brand";
import { ABILITIES } from "@/lib/battle/abilities";
import { SHOWCASE } from "@/lib/battle/showcase";

/** The matchups scrolling past like a scoreboard. */
function Ticker() {
  const items = [...SHOWCASE, ...SHOWCASE];
  return (
    <div className="overflow-hidden border-y border-line bg-ink-2 py-3" aria-hidden="true">
      <div className="flex w-max animate-ticker gap-10 whitespace-nowrap pr-10 font-mono text-[12px] uppercase tracking-[0.2em]">
        {[...items, ...items].map((m, i) => (
          <span key={i} className="flex items-center gap-3">
            <span style={{ color: ABILITIES[m.a].color }}>{ABILITIES[m.a].name}</span>
            <span className="text-dim">vs</span>
            <span style={{ color: ABILITIES[m.b].color }}>{ABILITIES[m.b].name}</span>
            <span className="ml-7 text-dim">/</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  { n: "01", title: "Make", body: "Each morning it makes the day's Shorts in the formats doing best on your channel, each the best of many runs, and nothing your channel has had before." },
  { n: "02", title: "Title", body: "Each gets a title written from what's really in it, the reasons it was picked, and a time to post: your best hour, once it knows it." },
  { n: "03", title: "Swipe", body: "You watch each one. Swipe right to post it, left for a different one. That's the whole job, and it's the one step that's yours.", you: true },
  { n: "04", title: "Post and learn", body: "It posts at that time, checks how each did at 1 hour, 24 hours and 3 days, and makes more of what worked on your channel." },
];

const FAQ = [
  { q: "Are the fights rigged?", a: "No. Every fight is a real physics simulation with a random start. Hookline runs each matchup many times and shows you the most exciting one, but it never decides who wins." },
  ...FAQ_ALL.filter((f) => ["Does it post without me?", "Is it allowed on YouTube?", "Is any of it AI video?", "Are the numbers real?", "Is the music copyrighted?", "Will this make me money?"].includes(f.q)),
  { q: "Where does it post?", a: "YouTube Shorts, at your best time. With TikTok connected it goes to TikTok too (straight to your profile once TikTok approves Hookline for that; until then to your TikTok drafts). Any Short can be downloaded with its caption to post anywhere." },
];

export const metadata: Metadata = {
  title: "Shorts that make themselves",
  description: "Ball battles, quizzes, would-you-rathers, text stories, rankings and bar-chart races, made for your channel every day. Swipe right to post. Start free.",
  openGraph: { images: ["/og/shorts.png"] },
};

export default function Shorts() {
  const demos = demoShorts(["quiz", "battle", "race", "texts", "wyr", "ranking"]);
  const [hero, side, maker] = [SHOWCASE[0], SHOWCASE[1], SHOWCASE[2]];
  return (
    <main className="overflow-x-clip">
      <SiteHeader current="/shorts" />

      {/* hero */}
      <section className="relative">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-14 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:pb-28 lg:pt-20">
          <div className="flex flex-col gap-7">
            <Eyebrow>
              <span className="mr-2 inline-block h-2 w-2 translate-y-[-1px] animate-blink rounded-full bg-signal align-middle" />
              Shorts that make themselves
            </Eyebrow>
            <h1 className="font-display text-[clamp(4rem,10vw,8.6rem)] uppercase leading-[0.92] tracking-[0.01em]">
              You swipe.
              <br />
              <span className="text-signal">It posts.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-paper/80 sm:text-xl">
              Hookline makes a few Shorts for your channel every day. You swipe yes or no, and it posts the yeses at your best times.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pt-1">
              <a href="#make" className="press bg-signal px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-ink">Make a battle →</a>
              <Link href="/login" className="font-display text-2xl uppercase tracking-wider text-paper underline decoration-signal decoration-[3px] underline-offset-[6px] transition hover:text-signal">Start free</Link>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">3 free Shorts a week · No card</p>
          </div>

          <div className="relative mx-auto h-[640px] w-full max-w-[460px] sm:h-[720px]">
            <Phone className="absolute right-0 top-10 w-[58%] rotate-[7deg] opacity-90 sm:top-14">
              <BattlePlayer a={side.a} b={side.b} seed={side.seed} />
            </Phone>
            <Phone className="absolute left-0 top-0 w-[66%] -rotate-[3deg]">
              <BattlePlayer a={hero.a} b={hero.b} seed={hero.seed} priority />
            </Phone>
            <span className="absolute bottom-6 right-2 rotate-[4deg] border-2 border-ink bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink shadow-[4px_4px_0_0_var(--color-signal)] sm:bottom-10">
              Live simulation, not a recording
            </span>
          </div>
        </div>
        <Ticker />
      </section>

      {/* make a battle */}
      <section id="make" className="scroll-mt-16 bg-paper text-ink">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <div className="mb-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
            <h2 className="font-display text-[clamp(3.4rem,8vw,7rem)] uppercase leading-[0.88]">Pick a fight.</h2>
            <p className="max-w-lg text-lg leading-relaxed text-ink/75">
              Every battle is a real physics simulation. Hookline runs each matchup a few dozen times and keeps the closest one, so every video ends on a knife edge.
            </p>
          </div>
          <Maker start={maker} />
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="scroll-mt-16">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-4 max-w-4xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Four steps. You do one.</h2>
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

      {/* formats */}
      <section className="border-y border-line bg-ink-2">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>Formats</Eyebrow>
          <h2 className="mt-4 max-w-3xl font-display text-[clamp(2.6rem,5.5vw,4.6rem)] uppercase leading-[0.92]">No face. No voice. No AI video.</h2>
          <p className="mb-12 mt-5 max-w-xl text-lg leading-relaxed text-paper/75">
            Every frame is drawn by code, the way many of the most-watched faceless Shorts are made. That&rsquo;s why a video costs cents to make, and why there can be a free plan.
          </p>
          <FormatDemo demos={demos} />
        </div>
      </section>

      {/* live */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-28">
          <div className="flex flex-col gap-6">
            <Eyebrow>
              <span className="mr-2 inline-block h-2 w-2 translate-y-[-1px] animate-blink rounded-full bg-signal align-middle" />
              New · For TikTok LIVE
            </Eyebrow>
            <h2 className="max-w-3xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Now your chat picks the winner.</h2>
            <p className="max-w-xl text-lg leading-relaxed text-paper/75">
              Red against blue on your LIVE. Viewers type 1 or 2 to pick a team, and every gift does something in the fight, from a rose that heals to a Galaxy that calls down meteors.
            </p>
            <ul className="grid max-w-xl gap-px bg-line sm:grid-cols-3">
              {[["Rose", "Heals your team"], ["Perfume", "Your face joins the fight"], ["Galaxy", "Calls down meteors"]].map(([g, d]) => (
                <li key={g} className="flex flex-col gap-1 bg-ink p-4">
                  <span className="font-display text-2xl uppercase tracking-wide">{g}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{d}</span>
                </li>
              ))}
            </ul>
            <Link href="/live" className="press mt-2 w-fit bg-signal px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-ink">See the LIVE games →</Link>
          </div>
          <Phone className="relative mx-auto w-full max-w-[320px] -rotate-2">
            <iframe src="/live/play?demo=1&clean=1" title="A live ball battle with pretend viewers" className="block aspect-[9/16] w-full border-0" loading="lazy" />
          </Phone>
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
          <Faq items={FAQ} />
        </div>
      </section>

      {/* last word */}
      <section className="border-t border-line bg-signal text-ink">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 px-4 py-20 sm:px-8 lg:py-24">
          <h2 className="font-display text-[clamp(3.4rem,10vw,9rem)] uppercase leading-[0.92]">Stop editing.<br />Start posting.</h2>
          <a href="#make" className="press bg-ink px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-paper">Make your first battle →</a>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
