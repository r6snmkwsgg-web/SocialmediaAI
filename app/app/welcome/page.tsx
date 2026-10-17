import type { Metadata } from "next";
import { Wordmark } from "@/components/brand";
import { TimezoneField } from "@/components/app/client-bits";
import { ConnectList } from "@/components/app/connect";
import { button } from "@/components/app/ui";
import type { Plan } from "@/lib/billing/plans";
import { CONNECT_WAIT } from "@/lib/shorts/quota";
import { account } from "@/lib/server/account";
import { channelsOf, type Platform } from "@/lib/server/channels";
import { configured } from "@/lib/server/env";
import { saveAudience } from "../(shell)/settings/actions";
import { finish, pickGoal } from "./actions";

export const metadata: Metadata = { title: "Welcome" };

const GOALS = [
  { id: "shorts", title: "Make Shorts for me", body: "A few videos a day, made for you. Swipe yes or no, and the yeses are made for your best times.", n: "01" },
  { id: "live", title: "Games for my LIVE", body: "Your chat plays a game on your TikTok LIVE, and every gift does something in it. For streamers 18 and over who go LIVE from a computer.", n: "02" },
  { id: "both", title: "Both", body: "Shorts to grow, LIVE games for your gifts once TikTok lets you have them.", n: "03" },
] as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Two taps from signing up to the first useful screen. */
export default async function Welcome({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const step = q.step === "connect" && me.profile.goal ? 2 : 1;
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
            <TimezoneField />
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
        <Connect goal={goal ?? "both"} userId={me.id} plan={me.plan} quota={q.error === "quota"} />
      )}
    </div>
  );
}

/**
 * Their plan says whether Hookline posts Shorts for them, and how many
 * YouTube channels it has room for. `quota` when connecting came back with
 * no quota left today to read the channel with.
 */
async function Connect({ goal, userId, plan, quota }: { goal: "shorts" | "live" | "both"; userId: string; plan: Plan; quota: boolean }) {
  const channels = await channelsOf(userId);
  const c = configured();
  const posts = plan.scheduling;
  const platforms: Platform[] = goal === "live" ? ["tiktok"] : ["youtube", "tiktok"];
  return (
    <section aria-labelledby="connect" className="flex flex-col gap-8">
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Optional</p>
        <h1 id="connect" className="font-display text-[clamp(2.6rem,7vw,4.4rem)] uppercase leading-[0.92]">Connect where you post</h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">
          {goal === "live"
            ? c.tiktokProfile
              ? "Connecting TikTok shows Hookline which LIVEs are yours, so the gift coins seen on them count in Earnings, and adds your views."
              : "Connecting TikTok adds your views to Earnings. You can do this later in Settings."
            : c.youtubeAudited && posts
              ? "So Hookline can post the Shorts you approve, and show you what they earn. Nothing posts without your yes. You can do this later in Settings."
              : "So Hookline can check the Shorts you post, and show you what they earn. You can do this later in Settings."}
        </p>
      </div>
      {quota && <p role="alert" className="border-2 border-signal px-4 py-3 text-[15px]">{CONNECT_WAIT}</p>}
      <ConnectList
        platforms={platforms}
        channels={channels}
        ready={{ youtube: c.youtube, tiktok: c.tiktok }}
        next="/app/welcome?step=connect"
        room={plan.channels}
        plan={plan.name}
        audience={saveAudience}
        youtubeApi={c.youtubeAudited}
        tiktokProfile={c.tiktokProfile}
        posts={posts}
      />
      <form action={finish} className="flex flex-wrap items-center gap-5">
        <button type="submit" className={button.primary}>
          {channels.length ? "Done" : "Skip for now"} <span aria-hidden="true">→</span>
        </button>
        <a href="/app/welcome" className={button.quiet}>← Change what I picked</a>
      </form>
    </section>
  );
}
