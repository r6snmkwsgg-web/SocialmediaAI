import type { Metadata } from "next";
import Link from "next/link";
import { Icons } from "@/components/app/icons";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, PageHead, Stat } from "@/components/app/ui";
import { checklist, nextStep } from "@/lib/app/checklist";
import { account } from "@/lib/server/account";
import { homeData } from "@/lib/server/home";

export const metadata: Metadata = { title: "Home" };

const n = (v: number) => v.toLocaleString("en-US");

export default async function Home() {
  const me = await account();
  const d = await homeData(me.id);
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
            <CardHead title="Next post" action={<Link href="/app/shorts" className={button.quiet}>Queue <Icons.arrow className="h-3.5 w-3.5" /></Link>} />
            <div className="px-5 py-5">
              {d.next ? (
                <div className="flex items-center justify-between gap-4">
                  <p className="min-w-0 truncate text-[15px] font-medium">{d.next.title}</p>
                  <span className="shrink-0 font-mono text-[12px] text-muted"><LocalTime iso={d.next.at.toISOString()} /></span>
                </div>
              ) : (
                <p className="text-[15px] text-muted">
                  Nothing scheduled. {d.inReview ? "Swipe right on a Short and it gets a time." : "Your next Shorts arrive in the queue; swipe right and they get a time."}
                </p>
              )}
            </div>
          </Card>
        </div>

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
      </div>
    </>
  );
}
