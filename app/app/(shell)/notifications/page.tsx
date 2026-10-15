import type { Metadata } from "next";
import Link from "next/link";
import { MarkSeen } from "@/components/app/client-bits";
import { NoteRow, toView, type NoteView } from "@/components/app/notes";
import { button, Card, Empty, PageHead } from "@/components/app/ui";
import { validTimezone } from "@/lib/shorts/times";
import { account } from "@/lib/server/account";
import { notificationsOf } from "@/lib/server/notify";
import { seenAll } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Notifications({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const before = typeof q.before === "string" && !Number.isNaN(Date.parse(q.before)) ? new Date(q.before) : undefined;
  const { items, unread, more } = await notificationsOf(me.id, { limit: 50, before });

  // grouped by the day each happened, in their own timezone
  const tz = validTimezone(me.profile.timezone);
  const dayOf = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(d);
  const today = dayOf(new Date());
  const yesterday = dayOf(new Date(Date.now() - 86400000));
  const groups: { day: string; items: NoteView[] }[] = [];
  for (const n of items) {
    const d = dayOf(n.createdAt);
    const label = d === today ? "Today" : d === yesterday ? "Yesterday" : d;
    if (groups.at(-1)?.day !== label) groups.push({ day: label, items: [] });
    groups.at(-1)!.items.push(toView(n));
  }

  return (
    <>
      <MarkSeen action={seenAll} when={unread > 0} />
      <PageHead eyebrow="Notifications" title="What's happened" line="Shorts going up, LIVE recaps, results worth hearing about, and anything that needs you. Nothing else." />

      {groups.length === 0 ? (
        <Empty
          title={before ? "Nothing older" : "Nothing yet"}
          body={before ? "That's everything." : "When a Short posts, a LIVE ends, a Short does far better than usual, or an account needs reconnecting, it shows up here and on the bell."}
          action={before ? { href: "/app/notifications", label: "Back to the newest" } : undefined}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section key={g.day} aria-labelledby={`day-${g.day}`}>
              <h2 id={`day-${g.day}`} className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{g.day}</h2>
              <Card>
                <ul className="divide-y-2 divide-edge">
                  {g.items.map((n) => (
                    <li key={n.id}>
                      <NoteRow n={n} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
          <div className="flex gap-3">
            {before && <Link href="/app/notifications" className={button.secondary}>Newest</Link>}
            {more && <Link href={`/app/notifications?before=${encodeURIComponent(items.at(-1)!.createdAt.toISOString())}`} className={button.secondary}>Older</Link>}
          </div>
        </div>
      )}
    </>
  );
}
