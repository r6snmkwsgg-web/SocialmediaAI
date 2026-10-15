import type { Metadata } from "next";
import Link from "next/link";
import { ConnectList } from "@/components/app/connect";
import { DailyBars, say } from "@/components/app/daily-bars";
import { button, Card, CardHead, Empty, PageHead } from "@/components/app/ui";
import { account } from "@/lib/server/account";
import { channelsOf } from "@/lib/server/channels";
import { earningsOf, hasStripe } from "@/lib/server/earnings";
import { configured } from "@/lib/server/env";
import { addGoal, removeGoal, stripeConnect, stripeDisconnect } from "./actions";

export const metadata: Metadata = { title: "Earnings" };

const NOTES: Record<string, { text: string; bad?: boolean }> = {
  goal: { text: "That goal didn't save. Pick what to count and a number above zero.", bad: true },
  "stripe-format": { text: "That isn't a restricted key. It starts with rk_live_. Never paste your secret key (sk_live_).", bad: true },
  "stripe-rejected": { text: "Stripe didn't accept that key. Make sure it can read balance transactions.", bad: true },
};

const field = "border-2 border-edge-strong bg-surface px-3 py-2 text-[15px] text-fg focus:border-fg focus:outline-none";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Earnings({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const days = q.days === "90" ? 90 : 30;
  const [{ series, goals, latest }, channels, stripe] = await Promise.all([earningsOf(me.id, days), channelsOf(me.id), hasStripe(me.id)]);
  const c = configured();
  const has = (p: "youtube" | "tiktok") => channels.some((x) => x.platform === p && x.status === "connected");
  const note = typeof q.error === "string" ? NOTES[q.error] : q.stripe === "1" ? { text: "Stripe is connected. Your sales show up below once they've synced." } : undefined;

  return (
    <>
      <PageHead
        eyebrow="Earnings"
        title="What you made"
        line={<>Real numbers from your own accounts. Nothing is estimated or made up here.{latest && <> Figures up to {latest.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.</>}</>}
        action={
          <div role="group" aria-label="Period" className="flex border-2 border-fg">
            {[30, 90].map((d) => (
              <Link key={d} href={`/app/earnings?days=${d}`} aria-current={days === d ? "true" : undefined} className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] ${days === d ? "bg-fg text-surface" : "text-muted hover:text-fg"}`}>
                {d} days
              </Link>
            ))}
          </div>
        }
      />
      {note && <p role={note.bad ? "alert" : "status"} className={`mb-6 border-2 px-4 py-3 text-[15px] ${note.bad ? "border-signal" : "border-fg bg-card"}`}>{note.text}</p>}

      <Card className="mb-8">
        <CardHead title="Goals" />
        <div className="flex flex-col gap-5 px-5 py-5">
          {goals.length === 0 && <p className="text-[14px] text-muted">A number to aim for, tracked from your real figures. Set one below.</p>}
          {goals.map((g) => {
            const share = Math.min(1, g.progress / g.target);
            return (
              <div key={g.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{g.label}</span>
                  <span className="font-mono text-[12px] tabular-nums text-muted">
                    {say(g.progress, g.unit, g.currency)} of {say(g.target, g.unit, g.currency)} · {Math.floor(share * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-3 flex-1 bg-card-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(share * 100)} aria-label={g.label}>
                    <div className="h-full bg-signal" style={{ width: `${share * 100}%` }} />
                  </div>
                  <form action={removeGoal}>
                    <input type="hidden" name="id" value={g.id} />
                    <button type="submit" className={button.quiet} aria-label={`Remove the goal: ${g.label}`}>Remove</button>
                  </form>
                </div>
              </div>
            );
          })}
          {series.length > 0 && (
            <form action={addGoal} className="flex flex-wrap items-end gap-3 border-t-2 border-edge pt-5">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Count</span>
                <select name="series" className={field}>
                  {series.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Target</span>
                <input name="target" type="number" min={1} step="any" required className={`${field} w-36`} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Over</span>
                <select name="period" className={field}>
                  <option value="month">This month</option>
                  <option value="all">All time</option>
                </select>
              </label>
              <button type="submit" className={button.primary}>Set goal</button>
            </form>
          )}
        </div>
      </Card>

      {series.length === 0 ? (
        <Empty
          title="Nothing connected yet"
          body="Connect YouTube or TikTok, play the LIVE game, or add a Stripe key if you sell something, and your real figures show up here, day by day."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {series.map((s) => (
            <li key={s.id} className="flex min-w-0 flex-col gap-3 border-2 border-edge bg-card px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{s.label}</p>
                <p className="mt-1 font-display text-4xl leading-none tabular-nums">{say(s.total, s.unit, s.currency)}</p>
                <p className="mt-1 text-[12px] text-muted">Last {days} days{s.note ? ` · ${s.note}` : ""}</p>
              </div>
              <DailyBars points={s.points} unit={s.unit} currency={s.currency} label={s.label} />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {(!has("youtube") || !has("tiktok")) && (
          <Card>
            <CardHead title="Add your channels" />
            <div className="px-5 py-5">
              <ConnectList platforms={(["youtube", "tiktok"] as const).filter((p) => !has(p))} channels={channels} ready={{ youtube: c.youtube, tiktok: c.tiktok }} next="/app/earnings" />
              <p className="mt-3 text-[12px] leading-relaxed text-muted">YouTube gives views, subscribers and, for channels in the Partner Program, YouTube&rsquo;s estimate of revenue. TikTok gives views; it doesn&rsquo;t share earnings with apps.</p>
            </div>
          </Card>
        )}
        <Card>
          <CardHead title="Sales through Stripe" />
          <div className="flex flex-col gap-3 px-5 py-5 text-[14px]">
            {stripe ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>Connected with a read-only key.</span>
                <form action={stripeDisconnect}><button type="submit" className={button.quiet}>Disconnect</button></form>
              </div>
            ) : (
              <>
                <p className="leading-relaxed text-muted">
                  Sell something? Add a Stripe <b className="text-fg">restricted key</b> that can only read balance transactions, and your sales show up here. In Stripe: Developers, API keys, Create restricted key.
                </p>
                <form action={stripeConnect} className="flex flex-wrap gap-2">
                  <label className="sr-only" htmlFor="rk">Restricted key</label>
                  <input id="rk" name="key" placeholder="rk_live_…" autoComplete="off" spellCheck={false} className={`${field} min-w-0 flex-1 font-mono text-[13px]`} />
                  <button type="submit" className={button.secondary}>Connect</button>
                </form>
                <p className="text-[12px] text-muted">It&rsquo;s stored encrypted and only ever used to read.</p>
              </>
            )}
          </div>
        </Card>
        {!series.some((s) => s.source === "live") && (
          <Card>
            <CardHead title="Gift coins from your LIVEs" />
            <p className="px-5 py-5 text-[14px] leading-relaxed text-muted">
              Play the game on a LIVE through your own game address and the coins it sees show up here. <Link href="/app/live" className="text-fg underline decoration-signal decoration-2 underline-offset-4">Set it up</Link>
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
