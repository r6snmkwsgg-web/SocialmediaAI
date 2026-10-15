import Link from "next/link";

/** Where signing in will land. The app itself comes next; the video engine is already live on the homepage. */
export default function AppHome() {
  return (
    <main className="flex min-h-dvh flex-col items-start justify-center gap-7 px-6 sm:px-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
        <span className="mr-2 inline-block h-2 w-2 animate-blink rounded-full bg-signal align-middle" />
        Hookline
      </p>
      <h1 className="max-w-4xl font-display text-[clamp(3.4rem,9vw,8rem)] uppercase leading-[0.88]">
        The app opens <span className="text-signal">soon.</span>
      </h1>
      <p className="max-w-lg text-lg leading-relaxed text-paper/75">
        Accounts, your daily swipe queue and posting to YouTube are on the way. The video engine is already running: go make a battle.
      </p>
      <Link href="/#make" className="press bg-signal px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-ink">Make a battle →</Link>
    </main>
  );
}
