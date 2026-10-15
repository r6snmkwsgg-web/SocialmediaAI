import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow, Wordmark } from "@/components/brand";
import { Setup } from "@/components/live/setup";
import { Phone } from "@/components/phone";
import { BATTLE_MENU as TIERS } from "@/lib/live/games/battle";
import { DEFAULT_SETTINGS } from "@/lib/live/settings";
import { FOLLOW_HP, LIKES_PER_HP } from "@/lib/live/show";

const TEAMS = DEFAULT_SETTINGS.teams;

export const metadata: Metadata = {
  title: "Live ball battles for TikTok LIVE · Hookline",
  description: "Red against blue on your TikTok LIVE. Viewers type 1 or 2 to pick a team, and every gift does something in the fight, from a heal to a meteor.",
};

const RULES = [
  { n: "1", title: "Type 1 or 2", body: "Joins RED or BLUE. You stay on your team round after round.", color: TEAMS[0].color },
  { n: "2", title: "Send a gift", body: "Every gift does something, from a heal to a meteor. The menu is on screen the whole time.", color: "#FFD60A" },
  { n: "3", title: "Tap to like", body: `Every ${LIKES_PER_HP} likes heals your team 1 HP. A follow is worth ${FOLLOW_HP}.`, color: "#FF6FB5" },
];

const WHY = [
  { title: "Anyone gets it in two seconds", body: "Two colours, two numbers, one arena. Someone scrolling past sees RED vs BLUE and TYPE 1 OR 2, and that's all they need." },
  { title: "Six things to spend on", body: "From a rose that heals to a Galaxy that calls down a meteor, every price does something different, and the menu shows it by gift name. Big ones get the gifter's face and name across the arena, and the biggest gifter wears the crown." },
  { title: "Rounds are short", body: "Most fights last under a minute, then the next round starts. The score carries over, so there's always a reason to stay for one more." },
];

const TIPS = [
  "Say it every round: type 1 for red, 2 for blue.",
  "When a face drops in, say their name. That's what makes the next person gift.",
  "Hype the team that's losing. Comebacks are where the gifts come from.",
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
              Red against blue, live on your stream. Viewers type 1 or 2 to pick a team, and every gift does something in the fight: a rose heals, a Perfume drops in a fighter with the gifter&rsquo;s face, a Galaxy calls down a meteor.
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

      {/* the rules */}
      <section id="gifts" className="scroll-mt-16 bg-paper text-ink">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow dark>The whole game</Eyebrow>
          <h2 className="mt-4 max-w-4xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Pick a side. Then spend.</h2>
          <ol className="mt-12 grid gap-px border-2 border-ink bg-ink md:grid-cols-3">
            {RULES.map((r) => (
              <li key={r.n} className="flex flex-col gap-3 bg-paper p-6 sm:p-7">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink font-display text-3xl" style={{ background: r.color }}>{r.n}</span>
                <h3 className="font-display text-4xl uppercase tracking-wide">{r.title}</h3>
                <p className="text-[16px] leading-relaxed text-ink/75">{r.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-16 border-t-2 border-ink pt-10">
            <h3 className="font-display text-[clamp(2.2rem,4vw,3.4rem)] uppercase leading-[0.95]">The gift menu.</h3>
            <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink/75">
              Six items, always on screen, by the gift viewers know. Any gift worth at least that many coins does the same thing. When one lands, its item lights up and the same picture shows up in the fight, so viewers learn the menu by watching. Gifts from someone who hasn&rsquo;t picked a team go to whichever one is losing.
            </p>
            <ul className="mt-8 grid gap-px border-2 border-ink bg-ink sm:grid-cols-2 lg:grid-cols-3">
              {TIERS.map((t) => (
                <li key={t.effect} className="flex flex-col gap-2 bg-ink p-6 text-paper">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
                    {t.gift} · {t.min.toLocaleString("en-US")} {t.min === 1 ? "coin" : "coins"}
                  </span>
                  <span className="font-display text-4xl uppercase tracking-wide" style={{ color: t.color }}>{t.name}</span>
                  <span className="text-[15px] leading-snug text-paper/75">{t.line}.</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 flex items-start gap-3 text-[16px] leading-relaxed text-ink/80">
              <span className="font-display text-2xl uppercase text-[#B8860B]">The crown.</span>
              <span className="pt-1">Whoever has given the most this round wears it on their ball, until someone gives more and takes it.</span>
            </p>
          </div>
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
          <div className="tokens-dark mt-12">
            <Setup locked={["race", "royale"]} />
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
