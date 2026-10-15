import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@/components/brand";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { GAMES } from "@/lib/live/games";
import { RACE_MENU } from "@/lib/live/games/race";
import { ROYALE_MENU } from "@/lib/live/games/royale";
import { Setup } from "@/components/live/setup";
import { Phone } from "@/components/phone";
import { BATTLE_MENU as TIERS } from "@/lib/live/games/battle";
import { DEFAULT_SIDE_GIFTS, RIVAL_POWERS } from "@/lib/live/rivals";
import { DEFAULT_SETTINGS } from "@/lib/live/settings";
import { FOLLOW_HP, LIKES_PER_HP } from "@/lib/live/show";

const TEAMS = DEFAULT_SETTINGS.teams;

export const metadata: Metadata = {
  title: "Games for TikTok LIVE",
  description: "Ball Battle, Rivals, Ball Race and Last One Standing: games your TikTok LIVE chat joins with a word, where every gift does something on screen. Free to start.",
  openGraph: { images: ["/og/live.png"] },
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
      <SiteHeader current="/live" />

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
              Four games for your stream. In Ball Battle it&rsquo;s red against blue: viewers type 1 or 2 to pick a team, and every gift does something in the fight. A rose heals, a Perfume drops in a fighter with the gifter&rsquo;s face, a Galaxy calls down a meteor.
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
          <h2 className="mt-4 max-w-4xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Ball Battle: pick a side, then spend.</h2>
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
                    {t.gift} · {(t.price ?? t.min).toLocaleString("en-US")} {(t.price ?? t.min) === 1 ? "coin" : "coins"}
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

      {/* rivals */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:py-28">
          <div className="flex flex-col gap-6">
            <Eyebrow>Rivals · with Pro</Eyebrow>
            <h2 className="max-w-4xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">A new rivalry every round.</h2>
            <p className="max-w-2xl text-lg leading-relaxed text-paper/75">
              Messi or Ronaldo. PlayStation or Xbox. Pizza or burgers. Red against blue, with the same champion on both sides, so the gifts decide it. Each side has its own three gifts for the same three powers, so the gift someone sends is the side they&rsquo;re on. Between rounds, chat votes the next rivalry.
            </p>
            <div className="max-w-2xl border-2 border-line">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px bg-line font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                <span className="bg-ink px-4 py-2.5">Power</span>
                <span className="flex items-center gap-2 bg-ink px-4 py-2.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#FF3B30]" />Red side</span>
                <span className="flex items-center gap-2 bg-ink px-4 py-2.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#0A84FF]" />Blue side</span>
              </div>
              <ul className="grid gap-px bg-line">
                {RIVAL_POWERS.map((t, i) => (
                  <li key={t.effect} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px">
                    <span className="bg-ink px-4 py-3 font-display text-xl uppercase leading-tight tracking-wide sm:text-2xl" style={{ color: t.color }}>{t.name}</span>
                    {[DEFAULT_SIDE_GIFTS.red[i], DEFAULT_SIDE_GIFTS.blue[i]].map((g) => (
                      <span key={g.name} className="flex flex-col justify-center bg-ink px-4 py-3">
                        <span className="text-[15px] leading-tight">{g.name}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{g.coins.toLocaleString("en-US")} coins</span>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
            <p className="max-w-2xl text-[14px] leading-relaxed text-paper/60">
              Any other gift helps the side its sender is on. The rivalries come from sports, games, food and places, plus your own. Politics is there too, switched off until you turn it on. Matchups about religion, race, where people are from or who they love never come up, and can&rsquo;t be added.
            </p>
            <a href="/live/play?demo=1&game=rivals" className="w-fit font-display text-xl uppercase tracking-wider underline decoration-signal decoration-[3px] underline-offset-[6px] hover:text-signal">Try Rivals →</a>
          </div>
          <div className="relative mx-auto w-full max-w-[340px]">
            <Phone className="relative w-full -rotate-2">
              <iframe src="/live/play?demo=1&clean=1&game=rivals" title="Rivals, with pretend viewers" className="block aspect-[9/16] w-full border-0" loading="lazy" />
            </Phone>
          </div>
        </div>
      </section>

      {/* the other games */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
          <Eyebrow>Two more games</Eyebrow>
          <h2 className="mt-4 max-w-4xl font-display text-[clamp(3rem,7vw,6rem)] uppercase leading-[0.9]">Everyone for themselves.</h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-paper/75">
            In these, every viewer gets their own ball with their face on it. Between rounds, chat votes for the next board or arena. Ball Battle is free; these two come with Pro.
          </p>
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {[
              { game: GAMES.find((g) => g.id === "race")!, menu: RACE_MENU, src: "/live/play?demo=1&clean=1&game=race" },
              { game: GAMES.find((g) => g.id === "royale")!, menu: ROYALE_MENU, src: "/live/play?demo=1&clean=1&game=royale" },
            ].map(({ game, menu, src }) => (
              <div key={game.id} className="flex flex-col gap-5 border-2 border-line p-6 sm:p-7">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-display text-4xl uppercase tracking-wide">{game.name}</h3>
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal">{game.join} to join</span>
                </div>
                <p className="text-[15px] leading-relaxed text-paper/70">{game.line}</p>
                <ul className="grid gap-px bg-line sm:grid-cols-2">
                  {menu.map((t) => (
                    <li key={t.effect} className="flex flex-col gap-1 bg-ink p-4">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{t.gift} · {(t.price ?? t.min).toLocaleString("en-US")} {(t.price ?? t.min) === 1 ? "coin" : "coins"}</span>
                      <span className="font-display text-2xl uppercase tracking-wide" style={{ color: t.color }}>{t.name}</span>
                      <span className="text-[13px] leading-snug text-paper/65">{t.line}</span>
                    </li>
                  ))}
                </ul>
                <a href={src} className="w-fit font-display text-xl uppercase tracking-wider underline decoration-signal decoration-[3px] underline-offset-[6px] hover:text-signal">Try {game.name} →</a>
              </div>
            ))}
          </div>
          <div className="mt-14 flex flex-col items-start gap-5 border-t border-line pt-10 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-lg leading-relaxed text-paper/80">
              Sign up to keep your game set up: your teams, round length, your own gift prices on Creator, and every LIVE&rsquo;s rounds, coins and top gifters.
            </p>
            <Link href="/login" className="press shrink-0 bg-signal px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-ink">Start free →</Link>
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
            <Setup locked={["race", "royale", "rivals"]} />
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

      <SiteFooter />
    </main>
  );
}
