import type { Metadata } from "next";
import { Wordmark } from "@/components/brand";
import { ConnectList } from "@/components/app/connect";
import { button } from "@/components/app/ui";
import { account } from "@/lib/server/account";
import { channelsOf, type Platform } from "@/lib/server/channels";
import { configured } from "@/lib/server/env";
import { finish, pickGoal } from "./actions";

export const metadata: Metadata = { title: "Welcome" };

const GOALS = [
  { id: "shorts", title: "Make Shorts for me", body: "A few videos a day, made for you. Swipe yes or no; it posts the yeses at your best times.", n: "01" },
  { id: "live", title: "Games for my LIVE", body: "Your chat plays a game on your TikTok LIVE, and every gift does something in it.", n: "02" },
  { id: "both", title: "Both", body: "Shorts to grow, LIVEs to get paid.", n: "03" },
] as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Two taps from signing up to the first useful screen. */
export default async function Welcome({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const step = (await searchParams).step === "connect" && me.profile.goal ? 2 : 1;
  const goal = me.profile.goal;

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-8 sm:py-10">
      <header className="mb-10 flex items-center justify-between sm:mb-14">
        <span className="text-[26px] leading-none"><Wordmark /></span>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted" aria-label={`Step ${step} of 2`}>
          <span className="text-fg">{step}</span> / 2
        </p>
      </header>

      {step === 1 ? (
        <section aria-labelledby="goal">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Takes under a minute</p>
          <h1 id="goal" className="font-display text-[clamp(2.6rem,7vw,4.4rem)] uppercase leading-[0.92]">What do you want Hookline to do?</h1>
          <form action={pickGoal} className="mt-8 flex flex-col gap-3">
            {GOALS.map((g) => (
              <button
                key={g.id}
                type="submit"
                name="goal"
                value={g.id}
                className={`group flex items-start gap-5 border-2 px-5 py-5 text-left transition hover:border-fg hover:bg-card ${goal === g.id ? "border-fg bg-card" : "border-edge"}`}
              >
                <span className="font-mono text-[12px] text-signal">{g.n}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="font-display text-2xl uppercase tracking-wide sm:text-3xl">{g.title}</span>
                  <span className="text-[15px] leading-snug text-muted">{g.body}</span>
                </span>
                <span aria-hidden="true" className="self-center font-display text-2xl text-muted transition group-hover:translate-x-1 group-hover:text-signal">→</span>
              </button>
            ))}
          </form>
        </section>
      ) : (
        <Connect goal={goal ?? "both"} userId={me.id} />
      )}
    </div>
  );
}

async function Connect({ goal, userId }: { goal: "shorts" | "live" | "both"; userId: string }) {
  const channels = await channelsOf(userId);
  const c = configured();
  const platforms: Platform[] = goal === "live" ? ["tiktok"] : ["youtube", "tiktok"];
  return (
    <section aria-labelledby="connect" className="flex flex-col gap-8">
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Optional</p>
        <h1 id="connect" className="font-display text-[clamp(2.6rem,7vw,4.4rem)] uppercase leading-[0.92]">Connect where you post</h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">
          {goal === "live"
            ? "The LIVE game doesn't need this: it reads your LIVE through the Hookline Bridge. Connecting TikTok adds your views to Earnings."
            : "So Hookline can post the Shorts you approve, and show you what they earn. Nothing posts without your yes. You can do this later in Settings."}
        </p>
      </div>
      <ConnectList platforms={platforms} channels={channels} ready={{ youtube: c.youtube, tiktok: c.tiktok }} next="/app/welcome?step=connect" />
      <form action={finish} className="flex flex-wrap items-center gap-5">
        <button type="submit" className={button.primary}>
          {channels.length ? "Done" : "Skip for now"} <span aria-hidden="true">→</span>
        </button>
        <a href="/app/welcome" className={button.quiet}>← Change what I picked</a>
      </form>
    </section>
  );
}
