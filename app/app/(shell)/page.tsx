import type { Metadata } from "next";
import Link from "next/link";
import { Icons } from "@/components/app/icons";
import { LocalTime } from "@/components/app/local-time";
import { NoteRow, toView } from "@/components/app/notes";
import { button, Card, CardHead, PageHead, Stat } from "@/components/app/ui";
import { checklist, nextStep } from "@/lib/app/checklist";
import { times } from "@/lib/shorts/insights";
import { account } from "@/lib/server/account";
import { homeData } from "@/lib/server/home";
import { notificationsOf } from "@/lib/server/notify";
import { insightsFor } from "@/lib/server/shorts/library";

export const metadata: Metadata = { title: "Home" };

const n = (v: number) => v.toLocaleString("en-US");

export default async function Home() {
  const me = await account();
  const [d, learned, notes] = await Promise.all([homeData(me.id), insightsFor(me.id), notificationsOf(me.id, { limit: 5 })]);
  const best = learned.formats.filter((f) => f.samples > 0).slice(0, 3);
  const steps = checklist(me.profile.goal, d);
  const next = nextStep(steps);
  const done = steps.filter((s) => s.done).length;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  const line =
    d.inReview > 0
      ? `${d.inReview} Short${d.inReview === 1 ? " is" : "s are"} waiting for a yes or no.`
      : next
        ? `Next up: ${next.title}.`
        : "You're set up. New Shorts land in your queue every morning.";
  const action =
    d.inReview > 0 ? { href: "/app/shorts", label: `Swipe ${d.inReview} Short${d.inReview === 1 ? "" : "s"}` } : next ? { href: next.href, label: next.title } : null;

  return (
    <>
      <PageHead
        eyebrow={today}
        title={me.profile.name ? `Hey ${me.profile.name}` : "Today"}
        line={line}
        action={action && <Link href={action.href} className={button.primary}>{action.label} <Icons.arrow className="h-5 w-5" /></Link>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHead title="This week" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Last 7 days</span>} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-7 px-5 py-6 sm:grid-cols-4">
              <Stat label="Shorts posted" value={n(d.week.posted)} sub={d.posted ? undefined : "None yet"} />
              <Stat label="Views" value={d.week.views === null ? "—" : n(d.week.views)} sub={d.week.views === null ? (d.youtube ? "After your first post" : "Connect YouTube") : "On this week's Shorts"} />
              <Stat label="LIVE rounds" value={n(d.week.rounds)} sub={d.week.lives ? `${d.week.lives} LIVE${d.week.lives === 1 ? "" : "s"}` : "No LIVEs yet"} />
              <Stat label="Gift coins" value={n(d.week.coins)} sub="Coins, not cash" />
            </div>
          </Card>

          <Card>
            <CardHead title="Coming up" action={<Link href="/app/shorts/calendar" className={button.quiet}>Calendar <Icons.arrow className="h-3.5 w-3.5" /></Link>} />
            {d.upcoming.length ? (
              <ul className="divide-y-2 divide-edge">
                {d.upcoming.map((u) => (
                  <li key={u.id}>
                    <Link href={`/app/shorts/${u.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 transition hover:bg-card-2">
                      <span className="min-w-0 truncate text-[15px] font-medium">{u.title}</span>
                      <span className="shrink-0 font-mono text-[12px] text-muted"><LocalTime iso={u.at.toISOString()} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-5 text-[15px] text-muted">
                Nothing scheduled. {d.inReview ? "Swipe right on a Short and it gets a time." : "Your next Shorts arrive in the queue; swipe right and they get a time."}
              </p>
            )}
          </Card>

          <Card>
            <CardHead title="What's working" action={<Link href="/app/shorts/library" className={button.quiet}>Library <Icons.arrow className="h-3.5 w-3.5" /></Link>} />
            {best.length && learned.measured >= 3 ? (
              <ul className="grid gap-px bg-edge sm:grid-cols-3">
                {best.map((f) => (
                  <li key={f.format} className="bg-card px-5 py-4">
                    <Stat label={f.name} value={times(f.score)} sub={`your usual · ${f.samples} posted`} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-5 text-[15px] leading-relaxed text-muted">
                Once three Shorts have had their first day on YouTube, this shows which formats beat your usual Short, and Hookline makes more of them. {learned.measured ? `${learned.measured} of 3 so far.` : ""}
              </p>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {done < steps.length && (
            <Card as="section">
              <CardHead title="Get set up" action={<span className="font-mono text-[11px] tabular-nums text-muted">{done} / {steps.length}</span>} />
              <div className="flex gap-1 px-5 pt-4" aria-hidden="true">
                {steps.map((s) => <span key={s.id} className={`h-1.5 flex-1 ${s.done ? "bg-signal" : "bg-card-2"}`} />)}
              </div>
              <ol className="flex flex-col px-2 py-3">
                {steps.map((s, i) => {
                  const body = (
                    <>
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border-2 font-mono text-[11px] ${s.done ? "border-signal bg-signal text-ink" : "border-edge-strong text-muted"}`}>
                        {s.done ? <Icons.check className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block font-display text-lg uppercase leading-tight tracking-wide ${s.done ? "text-muted line-through decoration-2" : ""}`}>{s.title}</span>
                        {!s.done && <span className="mt-0.5 block text-[14px] leading-snug text-muted">{s.body}</span>}
                      </span>
                      {!s.done && <Icons.arrow className="mt-1 h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-signal" />}
                    </>
                  );
                  return (
                    <li key={s.id}>
                      {s.done ? (
                        <div className="flex items-start gap-3.5 px-3 py-3">{body}</div>
                      ) : (
                        <Link href={s.href} className="group flex items-start gap-3.5 px-3 py-3 transition hover:bg-card-2">{body}</Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}

          <Card>
            <CardHead title="Latest" action={<Link href="/app/notifications" className={button.quiet}>All <Icons.arrow className="h-3.5 w-3.5" /></Link>} />
            {notes.items.length ? (
              <ul className="divide-y-2 divide-edge">
                {notes.items.map((n) => (
                  <li key={n.id}>
                    <NoteRow n={toView(n)} compact />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-5 text-[15px] leading-relaxed text-muted">Posts going up, LIVE recaps and anything that needs you show up here.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
