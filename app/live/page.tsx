import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow, Wordmark } from "@/components/brand";
import { Setup } from "@/components/live/setup";
import { Phone } from "@/components/phone";
import { LIKES_PER_HP, RAGE_SECONDS, SHIELD_SECONDS, TIERS } from "@/lib/live/rules";

export const metadata: Metadata = {
  title: "Live ball battles for TikTok LIVE · Hookline",
  description: "A ball battle your TikTok LIVE plays. Viewers pick a side in chat, and every gift lands in the fight.",
};

const LADDER = [
  ...TIERS.map((t) => ({
    what: `${t.min.toLocaleString("en-US")} ${t.min === 1 ? "coin" : "coins"}`,
    example: `${t.example} and up`,
    does:
      t.effect === "heal" ? "+1 HP for your side, per coin. Ten roses, ten HP."
      : t.effect === "small" ? "A small ball joins your side, with your name and face on it."
      : t.effect === "ball" ? "A full ball with your side's ability joins the fight, with your face on it."
      : t.effect === "rage" ? `Your whole side hits twice as hard for ${RAGE_SECONDS} seconds.`
      : t.effect === "shield" ? `Your side takes no damage for ${SHIELD_SECONDS} seconds, and gets 10 HP.`
      : "A meteor lands on the other side's strongest ball. 5,000 coins and up brings three.",
    gold: t.min >= 99,
  })),
];

const FREE = [
  { what: "Type 1 or 2", does: "Joins that side. You stay on it round after round until you switch." },
  { what: `${LIKES_PER_HP} likes`, does: "+1 HP for your side. Everyone tapping adds up." },
  { what: "Share the LIVE", does: "A small ball with your name, once a round." },
  { what: "Follow", does: "+3 HP for your side." },
];

const WHY = [
  { title: "Every gift does something", body: "A rose is a heal you can see land. A Galaxy is a meteor with a countdown. Gifters get their face on a ball and their name on a banner, so the gift is the show." },
  { title: "Two sides, one rivalry", body: "Viewers pick a side and stay on it. The series score carries from round to round, and the side that's behind is where unpicked gifts go, so nobody is ever out of it." },
  { title: "Rounds are short", body: "Most fights last under a minute, then there's a new matchup. There's always a reason to stay for one more." },
];

const TIPS = [
  "Say it every round: type 1 or type 2.",
  "Read out every banner. The name on it is your cue to thank them.",
  "Hype the side that's losing. Comebacks are where the gifts come from.",
  "Let the countdown breathe. The moment before FIGHT is when people pick.",
];

export default function Live() {
  return (
    <main className="overflow-x-clip">
      <header className="sticky top-0 z-50 border-b border-line bg-ink/85 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-8">
          <Link href="/" className="text-[26px] leading-none"><Wordmark /></Link>
          <div className="hidden items-center gap-8 font-mono text-[11px] uppercase tracking-[0.18em] text-paper/70 md:flex">
            <Link href="/" className="transition hover:text-paper">Shorts</Link>
            <a href="#gifts" className="transition hover:text-paper">Gifts</a>
            <a href="#setup" className="transition hover:text-paper">Set it up</a>
          </div>
          <a href="/live/play?demo=1" className="border border-paper/30 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition hover:border-paper">Try it</a>
        </nav>
      </header>

      {/* hero */}
      <section>
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-14 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:pb-28 lg:pt-20">
          <div className="flex flex-col gap-7">
            <Eyebrow>
              <span className="mr-2 inline-block h-2 w-2 translate-y-[-1px] animate-blink rounded-full bg-signal align-middle" />
              For TikTok LIVE
            </Eyebrow>
            <h1 className="font-display text-[clamp(3.8rem,9.4vw,8.2rem)] uppercase leading-[0.92] tracking-[0.01em]">
              Your chat
              <br />
              <span className="text-signal">picks the winner.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-paper/80 sm:text-xl">
              A ball battle that runs on your stream. Viewers type 1 or 2 to pick a side, and every gift lands in the fight: a rose heals, a Perfume drops in a ball with the gifter&rsquo;s face on it, a Galaxy calls down a meteor.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pt-1">
              <a href="/live/play?demo=1" className="press bg-signal px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-ink">Try it now →</a>
              <a href="#setup" className="font-display text-2xl uppercase tracking-wider text-paper underline decoration-signal decoration-[3px] underline-offset-[6px] transition hover:text-signal">Set it up</a>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">Works with TikFinity · Runs in OBS and LIVE Studio</p>
          </div>

          <div className="relative mx-auto w-full max-w-[380px]">
            <Phone className="relative w-full rotate-[2deg]">
              <iframe src="/live/play?demo=1&clean=1" title="A live ball battle with pretend viewers" className="block aspect-[9/16] w-full border-0" loading="lazy" />
            </Phone>
            <span className="absolute -right-3 -top-4 rotate-[6deg] border-2 border-ink bg-[#FF3B30] px-3 py-1 font-display text-xl uppercase tracking-wider text-paper shadow-[4px_4px_0_0_var(--color-ink)]">
              Live
            </span>
            <span className="absolute -right-2 bottom-10 rotate-[4deg] border-2 border-ink bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink shadow-[4px_4px_0_0_var(--color-signal)]">
              Running right here, pretend viewers
            </span>
          </div>
        </div>
      </section>

      {/* why */}
      <section className="border-y border-line bg-ink-2">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-24">
          <Eyebrow>Why it works on a LIVE</Eyebrow>
          <h2 className="mt-4 max-w-4xl font-display text-[clamp(2.8rem,6vw,5rem)] uppercase leading-[0.92]">Gifts with a reason to send them.</h2>
          <ul className="mt-12 grid gap-px bg-line md:grid-cols-3">
            {WHY.map((w) => (
              <li key={w.title} className="flex flex-col gap-3 bg-ink-2 p-6 sm:p-7">
                <h3 className="font-display text-3xl uppercase tracking-wide">{w.title}</h3>
                <p className="text-[15px] leading-relaxed text-paper/70">{w.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* gifts */}
      <section id="gifts" className="scroll-mt-16 bg-paper text-ink">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:py-28">
          <div className="flex flex-col gap-5">
            <Eyebrow dark>The gift ladder</Eyebrow>
            <h2 className="font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">The more it costs, the bigger it hits.</h2>
            <p className="max-w-md text-lg leading-relaxed text-ink/75">
              The same ladder runs along the top of the game, so viewers can read it mid-fight. Gifts from someone who hasn&rsquo;t picked a side go to whoever&rsquo;s losing.
            </p>
            <div className="mt-4 border-t-2 border-ink">
              <p className="pt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/55">Free, for everyone</p>
              <ul className="mt-3 flex flex-col">
                {FREE.map((f) => (
                  <li key={f.what} className="grid grid-cols-[130px_minmax(0,1fr)] gap-4 border-b border-rule py-3 text-[15px]">
                    <span className="font-display text-xl uppercase">{f.what}</span>
                    <span className="text-ink/75">{f.does}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <ol className="flex flex-col border-t-2 border-ink">
            {LADDER.map((l) => (
              <li key={l.what} className="grid grid-cols-[120px_minmax(0,1fr)] gap-5 border-b-2 border-ink py-5 sm:grid-cols-[170px_minmax(0,1fr)]">
                <span className="flex flex-col">
                  <span className={`font-display text-3xl uppercase sm:text-4xl ${l.gold ? "text-[#B8860B]" : ""}`}>{l.what}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/55">{l.example}</span>
                </span>
                <span className="self-center text-[16px] leading-snug text-ink/85">{l.does}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* setup */}
      <section id="setup" className="scroll-mt-16">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>Set it up</Eyebrow>
          <h2 className="mt-4 max-w-4xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Ten minutes before you go live.</h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-paper/75">
            It never asks for your TikTok password. It only reads your LIVE&rsquo;s public events, the same chats, likes and gifts anyone watching can see.
          </p>
          <div className="mt-12">
            <Setup />
          </div>
        </div>
      </section>

      {/* hosting */}
      <section className="border-t border-line bg-ink-2">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:py-24">
          <div>
            <Eyebrow>Hosting it</Eyebrow>
            <h2 className="mt-4 font-display text-[clamp(2.6rem,5.5vw,4.6rem)] uppercase leading-[0.92]">The game does the fighting. You do the hype.</h2>
          </div>
          <ol className="border-t border-line">
            {TIPS.map((t, i) => (
              <li key={t} className="flex gap-5 border-b border-line py-5 text-lg leading-snug text-paper/85">
                <span className="font-mono text-[12px] text-signal">0{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 font-mono text-[11px] uppercase tracking-[0.16em] text-dim sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Wordmark className="text-xl text-paper" />
          <span>Not affiliated with TikTok or TikFinity.</span>
          <span>© 2026 Hookline</span>
        </div>
      </footer>
    </main>
  );
}
