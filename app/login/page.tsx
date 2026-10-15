import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { currentUser } from "@/lib/server/auth";
import { configured, devLoginOn } from "@/lib/server/env";
import { devLogin, google, sendLink } from "./actions";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  email: "That email doesn't look right. Check it and try again.",
  send: "The email didn't send. Try again in a minute.",
  slow: "Too many tries in a row. Wait a minute, then send it again.",
  google: "Google sign-in didn't work. Try again, or use your email.",
  link: "That link has expired or was already used. Send yourself a new one.",
  setup: "Signing in isn't set up on this Hookline yet.",
};

const input = "w-full border-2 border-ink bg-paper px-4 py-3 text-base text-ink placeholder:text-ink/40 focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Login({ searchParams }: { searchParams: Search }) {
  if (await currentUser()) redirect("/app");
  const q = await searchParams;
  const error = typeof q.error === "string" ? ERRORS[q.error] : undefined;
  const sent = q.sent === "1";
  const ready = configured().supabase;
  const dev = devLoginOn();

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="flex flex-col justify-between gap-10 px-5 py-8 sm:px-10 lg:px-14 lg:py-12">
        <Link href="/" className="text-[28px] leading-none" aria-label="Hookline home">
          <Wordmark />
        </Link>
        <div className="flex flex-col gap-6">
          <h1 className="font-display text-[clamp(3.2rem,7vw,6.4rem)] uppercase leading-[0.9] tracking-[0.01em]">
            Content that makes itself.<br />
            <span className="text-signal">Lives that pay.</span>
          </h1>
          <ul className="grid max-w-md grid-cols-2 gap-x-6 gap-y-3 font-mono text-[11px] uppercase tracking-[0.16em] text-paper/70">
            <li><span className="text-signal">01</span> Shorts made for you</li>
            <li><span className="text-signal">02</span> Games for your LIVE</li>
            <li><span className="text-signal">03</span> What&rsquo;s taking off</li>
            <li><span className="text-signal">04</span> What you earned</li>
          </ul>
        </div>
        <p className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-dim lg:block">You approve everything before it posts.</p>
      </section>

      <section className="flex items-center justify-center bg-paper px-5 py-12 text-ink sm:px-10">
        <div className="w-full max-w-sm">
          {sent ? (
            <div className="flex flex-col gap-4" role="status">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/55">Check your email</p>
              <h2 className="font-display text-5xl uppercase leading-[0.92]">The link is on its way.</h2>
              <p className="text-[15px] leading-relaxed text-ink/70">
                Open it on this device to sign in. It works once and expires in an hour. Nothing there? Check spam, or{" "}
                <Link href="/login" className="underline decoration-signal decoration-2 underline-offset-4">send another</Link>.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/55">Sign in or sign up</p>
                <h2 className="mt-2 font-display text-5xl uppercase leading-[0.92]">Start free.</h2>
                <p className="mt-2 text-[15px] text-ink/65">No card. No password. One account for all of it.</p>
              </div>

              {error && (
                <p role="alert" className="border-2 border-signal px-4 py-3 text-[14px] leading-snug">
                  {error}
                </p>
              )}

              {ready && (
                <>
                  <form action={google}>
                    <button type="submit" className="flex w-full items-center justify-center gap-3 border-2 border-ink px-4 py-3 font-display text-lg uppercase tracking-wider transition hover:bg-ink hover:text-paper">
                      <GoogleMark />
                      Continue with Google
                    </button>
                  </form>
                  <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45" aria-hidden="true">
                    <span className="h-px flex-1 bg-ink/20" />or<span className="h-px flex-1 bg-ink/20" />
                  </div>
                  <form action={sendLink} className="flex flex-col gap-3">
                    <label htmlFor="email" className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink/60">Email</label>
                    <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" className={input} />
                    <button type="submit" className="press mt-1 bg-signal px-5 py-3 font-display text-xl uppercase tracking-wider text-ink [--press:var(--color-ink)]">
                      Email me a link
                    </button>
                  </form>
                </>
              )}

              {dev && (
                <form action={devLogin} className="flex flex-col gap-3 border-2 border-dashed border-ink/30 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/55">Local development: no email needed</p>
                  <label htmlFor="dev-email" className="sr-only">Email</label>
                  <input id="dev-email" name="email" type="email" required defaultValue="dev@hookline.local" className={input} />
                  <button type="submit" className={ready ? "border-2 border-ink px-4 py-2.5 font-display text-lg uppercase tracking-wider transition hover:bg-ink hover:text-paper" : "press bg-signal px-5 py-3 font-display text-xl uppercase tracking-wider text-ink [--press:var(--color-ink)]"}>
                    Sign in here
                  </button>
                </form>
              )}

              {!ready && !dev && (
                <p className="border-2 border-dashed border-ink/30 px-4 py-3 text-[14px] leading-relaxed text-ink/70">
                  Signing in needs Supabase. Set <code className="font-mono text-[12px]">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
                  <code className="font-mono text-[12px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
                </p>
              )}

              <p className="text-[12px] leading-relaxed text-ink/55">
                By signing in you agree to the <Link href="/terms" className="underline underline-offset-2">terms</Link> and{" "}
                <Link href="/privacy" className="underline underline-offset-2">privacy policy</Link>.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

/** Google's "G", in its own colours, as Google asks sign-in buttons to show it. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
