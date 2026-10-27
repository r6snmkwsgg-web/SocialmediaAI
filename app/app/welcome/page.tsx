import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { TimezoneField } from "@/components/app/client-bits";
import { ConnectList } from "@/components/app/connect";
import { button } from "@/components/app/ui";
import type { Plan } from "@/lib/billing/plans";
import { CONNECT_WAIT } from "@/lib/shorts/quota";
import { account } from "@/lib/server/account";
import { channelsOf, type Platform } from "@/lib/server/channels";
import { configured } from "@/lib/server/env";
import { TERMS_VERSION } from "@/lib/legal";
import { saveAudience } from "../(shell)/settings/actions";
import { agreeToTerms, finish, pickGoal } from "./actions";

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
  const termsOk = me.profile.termsVersion === TERMS_VERSION;
  // set up before, but these terms haven't been agreed to: only that to do
  if (me.profile.onboardedAt && !termsOk) return <AgainTerms needed={q.terms === "needed"} />;

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
            <AgreeBox checked={termsOk} needed={q.terms === "needed"} />
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

/** The agreement picking a goal needs: the browser won't send the form without it, and the server checks again. */
function AgreeBox({ checked = false, needed }: { checked?: boolean; needed: boolean }) {
  return (
    <div className="mb-2">
      <label className="flex items-start gap-3 text-[15px] leading-snug">
        <input type="checkbox" name="terms" required defaultChecked={checked} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-signal)]" />
        <span>
          I agree to the <Link href="/terms" target="_blank" className="underline underline-offset-2">Terms</Link> and the{" "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-2">Privacy Policy</Link>.
        </span>
      </label>
      {needed && <p role="alert" className="mt-2 text-[14px] text-signal">Tick the box to agree to the terms first.</p>}
    </div>
  );
}

/** Someone set up before these terms: agree to them, then straight back to the app. */
function AgainTerms({ needed }: { needed: boolean }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-8 sm:py-10">
      <header className="mb-10 sm:mb-14">
        <span className="text-[26px] leading-none"><Wordmark /></span>
      </header>
      <section aria-labelledby="terms">
        <h1 id="terms" className="font-display text-[clamp(2.4rem,6vw,3.8rem)] uppercase leading-[0.92]">Our terms have changed</h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">Read what&rsquo;s new, then agree to keep using Hookline.</p>
        <form action={agreeToTerms} className="mt-8 flex flex-col gap-5">
          <AgreeBox needed={needed} />
          <button type="submit" className={`${button.primary} w-fit`}>Agree and continue</button>
        </form>
      </section>
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
  // with YouTube Live on, the LIVE game also plays on YouTube, through the channel it's on
  const platforms: Platform[] = goal === "live" && !c.youtubeLive ? ["tiktok"] : goal === "live" ? ["tiktok", "youtube"] : ["youtube", "tiktok"];
  // what connecting does for someone here for the LIVE games
  const forLive = [
    c.tiktokProfile
      ? "Connecting TikTok shows Hookline which LIVEs are yours, so the gift coins seen on them count in Earnings, and adds your views."
      : "Connecting TikTok adds your views to Earnings.",
    c.youtubeLive && "Connecting YouTube lets the game play on your YouTube Live.",
    !c.tiktokProfile && "You can do this later in Settings.",
  ].filter(Boolean).join(" ");
  return (
    <section aria-labelledby="connect" className="flex flex-col gap-8">
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Optional</p>
        <h1 id="connect" className="font-display text-[clamp(2.6rem,7vw,4.4rem)] uppercase leading-[0.92]">Connect where you post</h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">
          {goal === "live"
            ? forLive
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
        live={c.youtubeLive}
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
