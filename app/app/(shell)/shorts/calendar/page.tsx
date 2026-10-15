import type { Metadata } from "next";
import Link from "next/link";
import { Icons } from "@/components/app/icons";
import { button, Card, Empty, PageHead } from "@/components/app/ui";
import { byDay, dayKey, gridBounds, monthGrid, monthParam, parseMonth, shiftMonth } from "@/lib/shorts/calendar";
import { FORMATS } from "@/lib/shorts/formats";
import { FORMAT_COLOR } from "@/lib/shorts/look";
import { validTimezone } from "@/lib/shorts/times";
import type { FormatId } from "@/lib/shorts/types";
import { account } from "@/lib/server/account";
import { calendarOf, type CalendarItem } from "@/lib/server/shorts/library";

export const metadata: Metadata = { title: "Calendar" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Item({ it, tz }: { it: CalendarItem; tz: string }) {
  const time = it.at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const state = it.status === "posted" ? "Posted" : it.status === "failed" ? "Failed" : "Posts";
  return (
    <Link
      href={`/app/shorts/${it.id}`}
      title={`${state} ${time}: ${it.title}`}
      className={`flex min-w-0 items-center gap-1.5 px-1.5 py-1 text-[12px] leading-tight transition hover:bg-card-2 ${it.status === "failed" ? "text-signal" : ""}`}
    >
      <span className="h-2 w-2 shrink-0" style={{ background: FORMAT_COLOR[it.format] }} aria-hidden="true" />
      <span className="shrink-0 font-mono text-[10px] text-muted">{time.replace(":00", "").replace(" ", "").toLowerCase()}</span>
      <span className={`truncate ${it.status === "posted" ? "text-muted" : "font-medium"}`}>{it.title}</span>
      <span className="sr-only">, {state.toLowerCase()}{it.tiktok ? ", TikTok too" : ""}</span>
    </Link>
  );
}

export default async function Calendar({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const tz = validTimezone(me.profile.timezone);
  const q = await searchParams;
  const now = new Date();
  const month = parseMonth(typeof q.m === "string" ? q.m : undefined, now, tz);
  const { from, to } = gridBounds(month, tz);
  const items = await calendarOf(me.id, from, to);
  const days = byDay(items, tz);
  const weeks = monthGrid(month);
  const today = dayKey(now, tz);
  const here = monthParam(month);
  const name = new Date(Date.UTC(month.y, month.m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const thisMonth = [...days.entries()].filter(([k]) => k.startsWith(here));
  const count = thisMonth.reduce((s, [, list]) => s + list.length, 0);
  const posts = me.plan.scheduling;

  return (
    <>
      <PageHead
        eyebrow="Calendar"
        title={name}
        line={count ? `${count} Short${count === 1 ? "" : "s"} ${posts ? "posting or posted" : "kept"} this month, at your times (${tz.replace(/_/g, " ")}).` : `Nothing in ${name.split(" ")[0]} yet.`}
        action={
          <nav aria-label="Months" className="flex items-center gap-2">
            <Link href={`?m=${monthParam(shiftMonth(month, -1))}`} className={button.secondary} aria-label="Previous month">
              <Icons.arrow className="h-4 w-4 rotate-180" />
            </Link>
            <Link href="/app/shorts/calendar" className={button.secondary}>Today</Link>
            <Link href={`?m=${monthParam(shiftMonth(month, 1))}`} className={button.secondary} aria-label="Next month">
              <Icons.arrow className="h-4 w-4" />
            </Link>
          </nav>
        }
      />

      {!items.length ? (
        <Empty
          title="Nothing scheduled"
          body={posts ? "Swipe right on Shorts in your queue and each one lands here on the day and hour it posts." : "Swipe right on Shorts in your queue and they land here on the day you kept them. Pro posts them for you at your best times."}
          action={{ href: "/app/shorts", label: "Go to your queue" }}
        />
      ) : (
        <>
          {/* the month as a grid on wide screens */}
          <Card className="hidden md:block">
            <div className="grid grid-cols-7 border-b-2 border-edge">
              {WEEKDAYS.map((d) => (
                <p key={d} className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{d}</p>
              ))}
            </div>
            {weeks.map((w) => (
              <div key={w[0].key} className="grid grid-cols-7 border-b border-edge last:border-0">
                {w.map((d) => {
                  const list = days.get(d.key) ?? [];
                  const isToday = d.key === today;
                  return (
                    <div key={d.key} className={`min-h-[7.5rem] min-w-0 border-r border-edge p-1.5 last:border-r-0 ${d.inMonth ? "" : "bg-card-2/50"}`}>
                      <p className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center px-1 font-mono text-[11px] ${isToday ? "bg-signal font-bold text-ink" : d.inMonth ? "text-fg" : "text-muted"}`}>
                        {d.d}
                      </p>
                      <div className="flex flex-col">
                        {list.slice(0, 3).map((it) => <Item key={it.id} it={it} tz={tz} />)}
                        {list.length > 3 && <p className="px-1.5 font-mono text-[10px] text-muted">+{list.length - 3} more</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </Card>

          {/* and as a list of days on a phone */}
          <div className="flex flex-col gap-6 md:hidden">
            {thisMonth.length === 0 && <p className="text-[15px] text-muted">Nothing this month; the days around it have some.</p>}
            {thisMonth.map(([k, list]) => {
              const [y, m, d] = k.split("-").map(Number);
              const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
              return (
                <section key={k} aria-label={label}>
                  <h2 className={`mb-2 font-mono text-[11px] uppercase tracking-[0.18em] ${k === today ? "text-signal" : "text-muted"}`}>{k === today ? `Today · ${label}` : label}</h2>
                  <Card>
                    <div className="flex flex-col divide-y divide-edge py-1">
                      {list.map((it) => <Item key={it.id} it={it} tz={tz} />)}
                    </div>
                  </Card>
                </section>
              );
            })}
          </div>

          <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2" aria-label="Colours">
            {(Object.keys(FORMATS) as FormatId[]).map((f) => (
              <li key={f} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                <span className="h-2 w-2" style={{ background: FORMAT_COLOR[f] }} aria-hidden="true" />
                {FORMATS[f].name}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
