import type { Metadata } from "next";
import { AutoRefresh } from "@/components/app/client-bits";
import { DailyBars } from "@/components/app/daily-bars";
import { Icons } from "@/components/app/icons";
import { LocalTime } from "@/components/app/local-time";
import { TypicalAccount } from "@/components/app/typical-account";
import { Card, CardHead, PageHead, Pill, Stat } from "@/components/app/ui";
import { PLANS } from "@/lib/billing/plans";
import { fill, lastDays } from "@/lib/earnings/series";
import { healthLine } from "@/lib/shorts/proof";
import { KIND_NAMES, type Bucket } from "@/lib/shorts/quota";
import { overview } from "@/lib/server/admin";
import { cohorts } from "@/lib/server/cohorts";
import { configured } from "@/lib/server/env";
import { quotaToday, type QuotaToday } from "@/lib/server/quota";
import { analyticsHealth } from "@/lib/server/shorts/proof";

export const metadata: Metadata = { title: "Today" };

const n = (v: number) => v.toLocaleString("en-US");
const usd = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

function age(from: Date | null, now: Date): string {
  if (!from) return "None waiting";
  const m = Math.round((now.getTime() - from.getTime()) / 60000);
  return m < 1 ? "Under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

type Allowance = QuotaToday["buckets"][number];

/** What an allowance has used today, against its limit when it has one. */
const usedOf = (a: Allowance) => (a.limit === null ? n(a.used) : `${n(a.used)} / ${n(a.limit)}`);

/** Under an allowance's figure: when YouTube said it was used up, or when Hookline's count found no room, or else `otherwise`. */
function soFar(a: Allowance, otherwise: string): React.ReactNode {
  if (a.fullAt) return <>YouTube said used up at <LocalTime iso={a.fullAt.toISOString()} style="time" /></>;
  if (a.ranOutAt) return <>Ran out at <LocalTime iso={a.ranOutAt.toISOString()} style="time" /></>;
  return otherwise;
}

/** A quota day as the table names it: its Pacific date, or Today. */
function dayName(day: string, today: string): string {
  if (day === today) return "Today";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * YouTube's quota today, as Hookline counted it: each allowance, the
 * units each part of Hookline used against the most it may, what's held
 * for posting, the Shorts waiting, and the last 7 days for Google's
 * quota form.
 */
function YouTubeQuota({ q }: { q: QuotaToday }) {
  const of = Object.fromEntries(q.buckets.map((b) => [b.bucket, b])) as Record<Bucket, Allowance>;
  const units = of.units;
  // the Data API's three allowances, which Google's quota form asks about
  const columns: Bucket[] = ["uploads", "searches", "units"];
  return (
    <Card className="mt-6">
      <CardHead title="YouTube quota" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Resets <LocalTime iso={q.resetsAt.toISOString()} /></span>} />
      {!q.firstAt ? (
        <p className="px-5 py-5 text-[15px] text-muted">Nothing counted yet. Every YouTube call is counted from the first one after this update.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-7 px-5 py-6 lg:grid-cols-4">
            <Stat label="Uploads" value={usedOf(of.uploads)} sub={soFar(of.uploads, "Shared by every account")} />
            <Stat label="Searches" value={usedOf(of.searches)} sub={soFar(of.searches, "Trends")} />
            <Stat label="Units" value={usedOf(units)} sub={units.fullAt ? soFar(units, "") : `${n(units.held ?? 0)} held for posting`} />
            <Stat label="YouTube Analytics" value={usedOf(of.analytics)} sub={of.analytics.limit === null ? "No limit set" : soFar(of.analytics, "Earnings")} />
          </div>
          <p className="border-t border-edge px-5 py-3 text-[13px] leading-relaxed text-muted">
            Counted by Hookline as it makes each call. Google&rsquo;s own figures are on the project&rsquo;s Quotas page in Cloud Console.
          </p>

          <div className="overflow-x-auto border-t-2 border-edge">
            <table className="w-full text-left text-[14px]">
              <caption className="px-5 pt-4 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Units used today by each part of Hookline, and the most each may use</caption>
              <thead>
                <tr className="border-b-2 border-edge font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  <th scope="col" className="px-5 py-3 font-normal">Part</th>
                  <th scope="col" className="px-3 py-3 text-right font-normal">Used</th>
                  <th scope="col" className="px-5 py-3 text-right font-normal">Most a day</th>
                </tr>
              </thead>
              <tbody>
                {units.kinds.map((k) => (
                  <tr key={k.kind} className="border-b border-edge last:border-0">
                    <th scope="row" className="px-5 py-2.5 font-normal">{KIND_NAMES[k.kind]}</th>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums">
                      {n(k.units)}
                      {k.ranOutAt && <span className="block text-[11px] text-signal">ran out at <LocalTime iso={k.ranOutAt.toISOString()} style="time" /></span>}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-[12px] tabular-nums">{k.cap === null ? <span className="text-muted">Whatever&rsquo;s left</span> : n(k.cap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 border-t border-edge px-5 py-4 text-[14px] leading-relaxed">
            <p>
              Trends, views, link checks, connecting channels and YouTube Live can&rsquo;t go past their share, so at least {n(units.held ?? 0)} units a day are left for posting. A call with no room waits for the reset instead of going to YouTube.
            </p>
            <p className="text-muted">Shorts waiting now: {n(q.waiting.youtube_quota)} for YouTube&rsquo;s upload quota · {n(q.waiting.plan_cap)} for their plan&rsquo;s next uploads.</p>
          </div>

          <div className="overflow-x-auto border-t-2 border-edge">
            <table className="w-full text-left text-[14px]">
              <caption className="px-5 pt-4 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Last 7 days</caption>
              <thead>
                <tr className="border-b-2 border-edge font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  <th scope="col" className="py-3 pl-5 pr-2 font-normal">Day (Pacific)</th>
                  <th scope="col" className="px-2 py-3 text-right font-normal">Uploads</th>
                  <th scope="col" className="px-2 py-3 text-right font-normal">Searches</th>
                  <th scope="col" className="py-3 pl-2 pr-5 text-right font-normal">Units</th>
                </tr>
              </thead>
              <tbody>
                {[...q.week].reverse().map(({ day, used, full }) => (
                  <tr key={day} className="border-b border-edge last:border-0">
                    <th scope="row" className="py-2.5 pl-5 pr-2 font-normal">
                      {dayName(day, q.day)}
                      {/* counting began part way through that day */}
                      {day === q.firstDay && q.firstAt && <span className="block text-[12px] text-muted">from <LocalTime iso={q.firstAt.toISOString()} style="time" /></span>}
                    </th>
                    {used === null ? (
                      <td colSpan={3} className="px-5 py-2.5 text-right text-muted">Not counted</td>
                    ) : (
                      columns.map((b) => (
                        <td key={b} className={`py-2.5 text-right font-mono text-[12px] tabular-nums ${b === "units" ? "pl-2 pr-5" : "px-2"}`}>
                          {/* the pill under the figure on a phone, and before it on a wider screen, so the figures line up */}
                          <span className="flex flex-col items-end gap-1 sm:flex-row-reverse sm:items-center sm:justify-start sm:gap-2">
                            {n(used[b])}
                            {full.includes(b) && <span className="whitespace-nowrap"><Pill tone="signal">used up</Pill></span>}
                          </span>
                        </td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

export default async function Admin() {
  const [o, quota, typical, health] = await Promise.all([overview(), quotaToday(), cohorts(), analyticsHealth()]);
  const c = configured();
  const now = new Date();
  const signups = fill(lastDays(now.toISOString().slice(0, 10), 30), o.signups, 0);
  const setup: [string, boolean, string][] = [
    ["Database", c.db, "DATABASE_URL"],
    ["Encrypted tokens", c.tokens, "TOKEN_KEY"],
    ["Sign-in (Supabase)", c.supabase, "NEXT_PUBLIC_SUPABASE_*"],
    ["Video storage", c.storage, "SUPABASE_SERVICE_ROLE_KEY"],
    ["Plans (Stripe)", c.stripe, "STRIPE_*"],
    ["Titles (Claude)", c.claude, "ANTHROPIC_API_KEY, ANTHROPIC_MODEL"],
    ["YouTube connect", c.youtube, "GOOGLE_CLIENT_*"],
    ["Trends (YouTube data)", c.youtubeTrends, "YOUTUBE_API_KEY"],
    ["TikTok connect", c.tiktok, "TIKTOK_CLIENT_*"],
    ["TikTok direct posting", c.tiktokDirect, "TIKTOK_DIRECT_POST"],
  ];
  const workerUp = o.workers.running > 0;

  return (
    <>
      <AutoRefresh active every={30_000} />
      <PageHead eyebrow="Admin" title="Hookline today" line="Live from the database, every half minute. Money is at list price; Stripe has the exact figures after fees and discounts." />

      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-7 px-5 py-6 lg:grid-cols-4">
          <Stat label="Accounts" value={n(o.accounts)} sub={`${n(o.newWeek)} new this week`} />
          <Stat label="Set up" value={n(o.onboarded)} sub={o.accounts ? `${Math.round((o.onboarded / o.accounts) * 100)}% finished onboarding` : "Nobody yet"} />
          <Stat label="Paying" value={n(o.paying.pro + o.paying.creator)} sub={`${n(o.paying.pro)} ${PLANS.pro.name} · ${n(o.paying.creator)} ${PLANS.creator.name}`} />
          <Stat label="Monthly revenue" value={usd(o.revenue)} sub="At list price" />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHead title="Last 24 hours" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-7 px-5 py-6 sm:grid-cols-3">
              <Stat label="Shorts made" value={n(o.day.made)} />
              <Stat label="Said yes to" value={n(o.day.approved)} />
              <Stat label="Posted" value={n(o.day.posted)} />
              <Stat label="LIVEs" value={n(o.day.lives)} sub={`${n(o.day.verifiedLives)} verified as the streamer's own`} />
              <Stat label="Gift coins seen" value={n(o.day.coins)} sub={`Verified LIVEs only. ${n(o.day.unverified)} more not verified`} />
            </div>
          </Card>

          <Card>
            <CardHead title="Sign-ups" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Last 30 days</span>} />
            <div className="max-w-xl px-5 py-5">
              <DailyBars points={signups} unit="count" label="Sign-ups" />
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHead title="Rendering" action={workerUp ? <Pill tone="good">{o.workers.running} worker{o.workers.running === 1 ? "" : "s"} running</Pill> : <Pill tone="signal">No worker running</Pill>} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-5 py-5">
              <Stat label="Waiting" value={n(o.queue.queued)} sub={age(o.queue.oldest, now)} />
              <Stat label="Rendering now" value={n(o.queue.running)} />
              <Stat label="Failed today" value={n(o.queue.failedDay)} />
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Last check-in</span>
                <span className="font-display text-2xl uppercase leading-none">{o.workers.lastSeen ? <LocalTime iso={o.workers.lastSeen.toISOString()} style="ago" /> : "Never"}</span>
                {!workerUp && <span className="text-[13px] text-muted">Start one with pnpm worker</span>}
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Connected" />
            <div className="grid grid-cols-3 gap-x-6 px-5 py-5">
              <Stat label="YouTube" value={n(o.connected.youtube)} />
              <Stat label="TikTok" value={n(o.connected.tiktok)} />
              <Stat label="Need reconnecting" value={n(o.connected.lost)} />
            </div>
            {/* how many channels' YouTube Analytics were read, and why the rest can't be: counts only, never anyone's numbers */}
            <p className="border-t border-edge px-5 py-3 text-[13px] leading-relaxed text-muted">{healthLine(health)}</p>
          </Card>

          <Card>
            <CardHead title="Setup" action={<span className="font-mono text-[11px] tabular-nums text-muted">{setup.filter((s) => s[1]).length} / {setup.length}</span>} />
            <ul className="divide-y divide-edge">
              {setup.map(([name, on, keys]) => (
                <li key={name} className="flex items-center gap-3 px-5 py-2.5 text-[14px]">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 ${on ? "border-signal bg-signal text-ink" : "border-edge-strong text-muted"}`} aria-hidden="true">
                    {on ? <Icons.check className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">{name}</span>
                  <span className="sr-only">{on ? "set up" : "not set up"}</span>
                  {!on && <code className="truncate font-mono text-[11px] text-muted">{keys}</code>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <YouTubeQuota q={quota} />

      <TypicalAccount rows={typical} />

      <Card className="mt-6">
        <CardHead title="Newest accounts" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[14px]">
            <caption className="sr-only">The ten newest accounts</caption>
            <thead>
              <tr className="border-b-2 border-edge font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                <th scope="col" className="px-5 py-3 font-normal">Email</th>
                <th scope="col" className="px-3 py-3 font-normal">Plan</th>
                <th scope="col" className="hidden px-3 py-3 font-normal sm:table-cell">Came for</th>
                <th scope="col" className="hidden px-3 py-3 font-normal sm:table-cell">Set up</th>
                <th scope="col" className="px-5 py-3 font-normal">Joined</th>
              </tr>
            </thead>
            <tbody>
              {o.newest.map((u) => (
                <tr key={u.email + u.at.toISOString()} className="border-b border-edge last:border-0">
                  <td className="max-w-[14rem] truncate px-5 py-3">{u.email}</td>
                  <td className="px-3 py-3">{PLANS[u.plan].name}</td>
                  <td className="hidden px-3 py-3 sm:table-cell">{u.goal ? `${u.goal[0].toUpperCase()}${u.goal.slice(1)}` : <span className="text-muted">Not yet</span>}</td>
                  <td className="hidden px-3 py-3 sm:table-cell">{u.onboarded ? "Yes" : <span className="text-muted">No</span>}</td>
                  <td className="whitespace-nowrap px-5 py-3"><LocalTime iso={u.at.toISOString()} style="ago" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHead title="Problems" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Newest first</span>} />
        {o.problems.length === 0 ? (
          <p className="px-5 py-5 text-[15px] text-muted">Nothing&rsquo;s failing. Renders, uploads or TikTok posts that go wrong show up here.</p>
        ) : (
          <ul className="divide-y divide-edge">
            {o.problems.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 px-5 py-3">
                <p className="text-[14px]"><b className="font-semibold">{p.title}</b> <span className="text-muted">· {p.email} · <LocalTime iso={p.at.toISOString()} style="ago" /></span></p>
                <p className="font-mono text-[12px] text-signal">{p.error}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
