import type { Metadata } from "next";
import Link from "next/link";
import { ChannelFilter } from "@/components/app/channel-filter";
import { ConnectList } from "@/components/app/connect";
import { DailyBars, say } from "@/components/app/daily-bars";
import { Audience } from "@/components/app/audience";
import { PartnerMeter } from "@/components/app/partner-meter";
import { button, Card, CardHead, Empty, PageHead } from "@/components/app/ui";
import { account } from "@/lib/server/account";
import { channelsOf } from "@/lib/server/channels";
import { earningsOf, hasStripe, LIVE_COINS, type EarningsChannel, type Series } from "@/lib/server/earnings";
import { configured } from "@/lib/server/env";
import { proofOf, type ChannelProof } from "@/lib/server/shorts/proof";
import { connectAgain, pacificDay, pickedChannel, readLine, readState, reportedDay } from "@/lib/shorts/proof";
import { addGoal, removeGoal, stripeConnect, stripeDisconnect } from "./actions";

export const metadata: Metadata = { title: "Earnings" };

const NOTES: Record<string, { text: string; bad?: boolean }> = {
  goal: { text: "That goal didn't save. Pick what to count and a number above zero.", bad: true },
  "stripe-format": { text: "That isn't a restricted key. It starts with rk_live_. Never paste your secret key (sk_live_).", bad: true },
  "stripe-rejected": { text: "Stripe didn't accept that key. Make sure it can read balance transactions.", bad: true },
  // back from Google's or TikTok's screen, from a channel's Connect again or Add your channels
  connectedYoutube: { text: "YouTube is connected. Its YouTube Analytics show here once Hookline has read them." },
  connectedTiktok: { text: "TikTok is connected." },
  connect: { text: "That didn't connect. Try again, and allow everything Hookline asks for.", bad: true },
  denied: { text: "Nothing was connected: the permission was turned down.", bad: true },
  nochannel: { text: "That Google account has no YouTube channel yet. Make one on YouTube, then connect again.", bad: true },
  channels: { text: "Your plan has no room for another YouTube channel. To connect one of yours again, pick its own account when Google asks.", bad: true },
  tiktokOne: { text: "Hookline sends Shorts to one TikTok account. Disconnect yours in Settings to connect a different one.", bad: true },
};

const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const field = "border-2 border-edge-strong bg-surface px-3 py-2 text-[15px] text-fg focus:border-fg focus:outline-none";

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * What the totals of several channels leave out, said plainly: they're
 * added up only as far as every channel has reported, a channel added
 * later counts from its first report, and one that needs reconnecting
 * stops at its last.
 */
function channelNotes(channels: EarningsChannel[], series: Series[]): string[] {
  const shown = (["youtube", "tiktok"] as const).flatMap((p) => {
    const start = series.find((s) => s.source === p)?.points[0]?.day;
    return start ? [{ start, mine: channels.filter((c) => c.platform === p) }] : [];
  });
  const several = shown.some((x) => x.mine.length > 1);
  const notes = shown.flatMap(({ start, mine }) => {
    // later than the chart starts, and than the channel whose figures go back furthest
    const first = mine.map((c) => c.from ?? start).sort()[0];
    const later = mine.length > 1 ? mine.filter((c) => c.from && c.from > start && c.from > first).map((c) => `${c.name}'s figures start on ${shortDay(c.from!)}.`) : [];
    const stopped = mine.filter((c) => c.expired && c.through).map((c) => `${c.name} needs reconnecting: its figures stop on ${shortDay(c.through!)}.`);
    return [...later, ...stopped];
  });
  return several ? ["Adds up your channels. Each day shows once every channel Hookline was reading then has reported it.", ...notes] : notes;
}

/** What's the account's as a whole, so it shows only with all its channels. */
const ACCOUNT_WIDE: Partial<Record<Series["source"], string>> = { tiktok: "TikTok views", live: "gift coins seen on your LIVEs", stripe: "Stripe sales" };

const listed = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The channels engaged views across all of them can't count, for their card and a goal on them, since YouTube hasn't given them. */
const notCounted = (names: string[]) =>
  `${listed(names)} ${names.length === 1 ? "isn't" : "aren't"} counted: YouTube hasn't given Hookline ${names.length === 1 ? "its" : "their"} engaged views.`;

/**
 * One YouTube channel's YouTube Analytics: how far it is from the Partner
 * Program and who watches it, once they've been read, and its made-for-kids
 * answers either way. Where it can't be read, it says why, with Google's
 * screen again where that's the fix. `today` is the day the Partner
 * Program's bars are for.
 */
function ChannelCard({ c, today, canConnect }: { c: ChannelProof; today: string; canConnect: boolean }) {
  const state = readState(c);
  // only a channel read in full, or kept from its last full read, has numbers to show
  const shown = state === "read" || state === "stale";
  const line = readLine(state, c.through);
  const quiet = shown && c.through === null;
  const fix = canConnect && (state === "scope" || state === "access");
  return (
    <Card id={`channel-${c.id}`} className="scroll-mt-24">
      <CardHead
        title={c.title}
        action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{shown && c.through ? `From YouTube Analytics, up to ${reportedDay(c.through)}` : "From YouTube Analytics"}</span>}
      />
      {(line || quiet) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b-2 border-edge px-5 py-4">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1 text-[14px] leading-relaxed">
            {line && <p>{line}</p>}
            {quiet && <p className="text-muted">YouTube hasn&rsquo;t reported views on this channel in the last 90 days.</p>}
          </div>
          {fix && <a href={connectAgain(c.id)} className={button.secondary}>Connect again</a>}
        </div>
      )}
      <div className={`grid gap-px bg-edge ${shown ? "lg:grid-cols-2" : ""}`}>
        {shown && <div className="min-w-0 bg-card px-5 py-5"><PartnerMeter c={c} today={today} /></div>}
        <div className="min-w-0 bg-card px-5 py-5"><Audience c={c} shown={shown && c.through !== null} /></div>
      </div>
    </Card>
  );
}

export default async function Earnings({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const days = q.days === "90" ? 90 : 30;
  const [all, channels, stripe] = await Promise.all([earningsOf(me.id, days), channelsOf(me.id), hasStripe(me.id)]);
  // with more than one YouTube channel with figures, one can be picked to see its own (anything else means all of them,
  // and so does coming back from connecting one)
  const youtube = all.channels.filter((x) => x.platform === "youtube");
  const picked = youtube.length > 1 ? (youtube.find((x) => x.id === pickedChannel(q)) ?? null) : null;
  const { series, goals, unverified } = picked ? await earningsOf(me.id, days, picked.id) : all;
  // each YouTube channel's YouTube Analytics, under the figures: only the picked one's when one is picked
  const proofs = (await proofOf(me.id)).filter((x) => !picked || x.id === picked.id);
  const hasLive = series.some((s) => s.source === "live");
  const c = configured();
  const has = (p: "youtube" | "tiktok") => channels.some((x) => x.platform === p && x.status === "connected");
  // an account connected and not read yet has figures on the way, which isn't nothing connected
  const coming = has("youtube") || has("tiktok");
  const note =
    typeof q.error === "string"
      ? NOTES[q.error]
      : q.stripe === "1"
        ? { text: "Stripe is connected. Your sales show up below once they've synced." }
        : typeof q.connected === "string"
          ? NOTES[q.connected === "tiktok" ? "connectedTiktok" : "connectedYoutube"]
          : undefined;
  // the account's own figures, which one channel on its own leaves out
  const elsewhere = [...new Set(all.series.map((s) => ACCOUNT_WIDE[s.source]).filter((s): s is string => !!s))];
  // all the channels added up: how, and where one's figures start later or stop; or one channel's, and where it stops
  const notes = picked
    ? [
        ...(picked.expired && picked.through ? [`${picked.name} needs reconnecting: its figures stop on ${shortDay(picked.through)}.`] : []),
        ...(elsewhere.length ? [`Your ${listed(elsewhere)} show under All channels.`] : []),
      ]
    : channelNotes(all.channels, series);
  const allHref = `/app/earnings${days === 90 ? "?days=90" : ""}`;

  return (
    <>
      <PageHead
        eyebrow="Earnings"
        title="What you made"
        line="Real numbers from your own accounts, as each one reports them. Nothing is made up, and any figure that's an estimate says so."
        action={
          <div role="group" aria-label="Period" className="flex border-2 border-fg">
            {[30, 90].map((d) => (
              <Link
                key={d}
                href={`/app/earnings?days=${d}${picked ? `&channel=${picked.id}` : ""}`}
                aria-current={days === d ? "true" : undefined}
                className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] ${days === d ? "bg-fg text-surface" : "text-muted hover:text-fg"}`}
              >
                {d} days
              </Link>
            ))}
          </div>
        }
      />
      {youtube.length > 1 && (
        <ChannelFilter
          channels={youtube.map((x) => ({ id: x.id, name: x.name, status: x.expired ? "expired" : "connected" }))}
          picked={picked?.id ?? null}
          path="/app/earnings"
          keep={{ days: days === 90 ? "90" : null }}
        />
      )}
      {note && <p role={note.bad ? "alert" : "status"} className={`mb-6 border-2 px-4 py-3 text-[15px] ${note.bad ? "border-signal" : "border-fg bg-card"}`}>{note.text}</p>}

      <Card className="mb-8">
        <CardHead title="Goals" />
        <div className="flex flex-col gap-5 px-5 py-5">
          {goals.length === 0 && !picked && <p className="text-[14px] text-muted">A number to aim for, tracked from your real figures. Set one below.</p>}
          {goals.map((g) => {
            const share = Math.min(1, g.progress / g.target);
            // a goal adds up every channel, so it leaves out what all of them added up do
            const leftOut = all.series.find((s) => s.id === `${g.source}:${g.metric}`)?.leftOut;
            return (
              <div key={g.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{g.label}</span>
                  <span className="font-mono text-[12px] tabular-nums text-muted">
                    {say(g.progress, g.unit, g.currency)} of {say(g.target, g.unit, g.currency)} · {Math.floor(share * 100)}%
                  </span>
                </div>
                {leftOut && <p className="-mt-1 text-[12px] text-muted">{notCounted(leftOut)}</p>}
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
          {/* goals count every channel, so they're set with all of them shown */}
          {picked && (
            <p className={`text-[14px] text-muted ${goals.length ? "border-t-2 border-edge pt-5" : ""}`}>
              Goals count all your channels. <Link href={allHref} className="text-fg underline decoration-signal decoration-2 underline-offset-4">Pick All channels</Link> to set one.
            </p>
          )}
          {series.length > 0 && !picked && (
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

      {notes.length > 0 && (
        <div className="mb-6 flex flex-col gap-1 border-l-4 border-edge-strong pl-3 text-[13px] leading-relaxed text-muted">
          {notes.map((t) => <p key={t}>{t}</p>)}
        </div>
      )}

      {series.length === 0 ? (
        <Empty
          title={coming ? "No figures yet" : "Nothing connected yet"}
          body={coming ? "Your figures show up here once Hookline has read them. It reads them every 6 hours." : "Connect YouTube or TikTok, play the LIVE game, or add a Stripe key if you sell something, and your real figures show up here, day by day."}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {series.map((s) => (
            <li key={s.id} className="flex min-w-0 flex-col gap-3 border-2 border-edge bg-card px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{s.label}</p>
                <p className="mt-1 font-display text-4xl leading-none tabular-nums">{say(s.total, s.unit, s.currency)}</p>
                <p className="mt-1 text-[12px] text-muted">Last {days} days{s.note ? ` · ${s.note}` : ""}</p>
                {s.leftOut && <p className="mt-0.5 text-[12px] text-muted">{notCounted(s.leftOut)}</p>}
                {s.through && s.through < s.points[s.points.length - 1].day && (
                  <p className="mt-0.5 text-[12px] text-muted">
                    Reported up to {shortDay(s.through)}. {picked?.expired ? "Nothing more comes until it's reconnected." : "YouTube adds the days after that later."}
                  </p>
                )}
                {s.from && s.from > s.points[0].day && (
                  <p className="mt-0.5 text-[12px] text-muted">Figures start {shortDay(s.from)}, as far back as Stripe was read when you connected it.</p>
                )}
              </div>
              <DailyBars points={s.points} unit={s.unit} currency={s.currency} label={s.label} through={s.through} />
            </li>
          ))}
        </ul>
      )}

      {proofs.length > 0 && (
        <section aria-labelledby="youtube-channels" className="mt-10">
          <h2 id="youtube-channels" className="mb-4 font-display text-2xl uppercase tracking-wide">{proofs.length > 1 ? "Your YouTube channels" : "Your YouTube channel"}</h2>
          <div className="flex flex-col gap-6">
            {proofs.map((p) => <ChannelCard key={p.id} c={p} today={pacificDay(new Date())} canConnect={c.youtube} />)}
          </div>
        </section>
      )}

      {/* connecting, Stripe and the LIVE coins are the account's as a whole, so they show with all its channels */}
      {!picked && (
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {(!has("youtube") || !has("tiktok")) && (
            <Card>
              <CardHead title="Add your channels" />
              <div className="px-5 py-5">
                <ConnectList
                  platforms={(["youtube", "tiktok"] as const).filter((p) => !has(p))}
                  channels={channels}
                  ready={{ youtube: c.youtube, tiktok: c.tiktok }}
                  next="/app/earnings"
                  room={me.plan.channels}
                  plan={me.plan.name}
                  youtubeApi={c.youtubeAudited}
                  posts={me.plan.scheduling}
                  tiktokProfile={c.tiktokProfile}
                />
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
          {(!hasLive || unverified.lives > 0) && (
            <Card>
              <CardHead title={LIVE_COINS} />
              <div className="flex flex-col gap-3 px-5 py-5 text-[14px] leading-relaxed text-muted">
                {unverified.lives > 0 && (
                  <p className="border-l-2 border-signal pl-3 text-fg/80">
                    Not counted: {unverified.coins.toLocaleString("en-US")} gift coins seen on {unverified.lives} LIVE{unverified.lives === 1 ? "" : "s"} in the last {days} days that {unverified.lives === 1 ? "wasn't" : "weren't"} verified as yours. <Link href="/app/live" className="text-fg underline decoration-signal decoration-2 underline-offset-4">See why</Link>
                  </p>
                )}
                {!hasLive && (
                  <p>
                    Play the game on your own TikTok LIVE, through your game address and Hookline Bridge, and the gift coins it sees show up here. They&rsquo;re what viewers sent, not what TikTok pays you. <Link href="/app/live" className="text-fg underline decoration-signal decoration-2 underline-offset-4">Set it up</Link>
                  </p>
                )}
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
