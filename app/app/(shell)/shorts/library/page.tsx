import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, Empty, PageHead, Pill } from "@/components/app/ui";
import { Cover } from "@/components/shorts/cover";
import { Working } from "@/components/shorts/working";
import { isActive } from "@/lib/shorts/channels";
import { formatName } from "@/lib/shorts/formats";
import { times } from "@/lib/shorts/insights";
import { SHORT_FORMATS, type ShortFormat } from "@/lib/shorts/types";
import { account } from "@/lib/server/account";
import { shortsChannelsOf } from "@/lib/server/channels";
import { FILTERS, insightsFor, libraryOf, type Filter, type LibraryItem } from "@/lib/server/shorts/library";

export const metadata: Metadata = { title: "Library" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const n = (v: number) => v.toLocaleString("en-US");
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "posted", label: "Posted" },
  { id: "coming", label: "Coming up" },
  { id: "failed", label: "Failed" },
];

function state(it: LibraryItem): { label: string; tone: "plain" | "good" | "warn" | "signal" } {
  if (it.status === "posted") return { label: "Posted", tone: "good" };
  if (it.status === "failed") return { label: "Failed", tone: "signal" };
  if (it.status === "scheduled") return { label: "Scheduled", tone: "plain" };
  if (it.status === "ready") return { label: "Ready", tone: "plain" };
  return { label: "Being made", tone: "warn" };
}

export default async function Library({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const filter = (one(q.show) ?? "all") as Filter;
  const show: Filter = filter in FILTERS ? filter : "all";
  const format = SHORT_FORMATS.includes(one(q.format) as ShortFormat) ? (one(q.format) as ShortFormat) : null;
  const text = (one(q.q) ?? "").slice(0, 80);
  const page = Math.max(1, Number(one(q.page)) || 1);
  // the YouTube channels Shorts are for, and the one picked to see (anything else means all of them)
  const shown = await shortsChannelsOf(me.id);
  const picked = shown.find((c) => c.id === one(q.channel)) ?? null;
  const several = shown.length > 1;
  const [lib, learned] = await Promise.all([libraryOf(me.id, { filter: show, format, q: text, page, channel: picked?.id }), insightsFor(me.id, picked?.id)]);
  const narrowed = show !== "all" || !!format || !!text || !!picked;
  const link = (over: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const merged = { show: show === "all" ? null : show, channel: picked?.id ?? null, format, q: text || null, page: null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "/app/shorts/library";
  };
  // with several channels' Shorts shown, each card says which channel it's for
  const names = new Map(shown.map((c) => [c.id, c.name]));
  const tagOf = (it: LibraryItem) => (several && !picked && it.channelId ? names.get(it.channelId) : undefined);
  // what's working on the channel picked, against its own usual; or across them all, each Short against its own channel's
  const day = learned.typical === null ? null : n(Math.round(learned.typical));
  const working = picked
    ? { title: `What's working on ${picked.name}`, note: day === null ? `First day vs ${picked.name}'s usual` : `${picked.name}'s usual: ${day} views on day one` }
    : several
      ? { title: "What's working across your channels", note: "Each Short against its own channel's usual" }
      : { title: "What's working", note: day === null ? "First day vs your usual" : `Your usual: ${day} views on day one` };

  return (
    <>
      <PageHead
        eyebrow="Library"
        title="Every Short"
        line={lib.total || narrowed ? `${n(lib.total)} Short${lib.total === 1 ? "" : "s"} ${narrowed ? (lib.total === 1 ? "matches" : "match") : "you've said yes to"}, newest first.` : "Every Short you say yes to, with how it did."}
      />

      <Card className="mb-8">
        <CardHead title={working.title} action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{working.note}</span>} />
        <div className="px-5 py-5">
          {learned.measured < 3 ? (
            <p className="max-w-2xl text-[15px] leading-relaxed text-muted">
              {picked
                ? `Hookline compares the first day of each Short on ${picked.name} with its usual Short, and makes more of what wins there. Once three of them have been up a day on YouTube, this shows which formats beat its usual and by how much.`
                : several
                  ? "Hookline compares each Short's first day with its own channel's usual Short, and makes more of what wins. Once three Shorts have been up a day on YouTube, this shows which formats beat their channel's usual and by how much."
                  : "Hookline compares each Short's first day with your usual Short, and makes more of what wins. Once three Shorts have been up a day on YouTube, this shows which formats beat your usual and by how much."}{" "}
              {learned.measured > 0 ? `${learned.measured} of 3 so far.` : "None yet."}
            </p>
          ) : (
            <Working formats={learned.formats} kinds={learned.kinds} />
          )}
        </div>
      </Card>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <nav aria-label="Show" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={link({ show: t.id === "all" ? null : t.id })}
              aria-current={show === t.id ? "page" : undefined}
              className={`border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] ${show === t.id ? "border-fg bg-fg text-surface" : "border-edge text-muted hover:border-fg hover:text-fg"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-center gap-2" role="search">
          {show !== "all" && <input type="hidden" name="show" value={show} />}
          {several && (
            <>
              <label className="sr-only" htmlFor="lib-channel">Channel</label>
              <select id="lib-channel" name="channel" defaultValue={picked?.id ?? ""} className="h-10 max-w-full border-2 border-edge-strong bg-surface px-2 text-[14px] text-fg focus:border-fg focus:outline-none">
                <option value="">Every channel</option>
                {shown.map((c) => (
                  <option key={c.id} value={c.id}>{`${c.name}${isActive(c) ? "" : " (disconnected)"}`}</option>
                ))}
              </select>
            </>
          )}
          <label className="sr-only" htmlFor="lib-format">Format</label>
          <select id="lib-format" name="format" defaultValue={format ?? ""} className="h-10 border-2 border-edge-strong bg-surface px-2 text-[14px] text-fg focus:border-fg focus:outline-none">
            <option value="">Every format</option>
            {SHORT_FORMATS.map((f) => (
              <option key={f} value={f}>{formatName({ format: f })}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="lib-q">Search titles</label>
          <input id="lib-q" name="q" defaultValue={text} placeholder="Search titles" className="h-10 w-48 min-w-0 flex-1 border-2 border-edge-strong bg-surface px-3 text-[14px] text-fg placeholder:text-muted focus:border-fg focus:outline-none sm:flex-none" />
          <button type="submit" className={button.secondary}>Search</button>
        </form>
      </div>

      {lib.items.length === 0 ? (
        narrowed ? (
          <Empty title="Nothing matches" body={several ? "Try another channel or format, or fewer words." : "Try another format or fewer words."} action={{ href: "/app/shorts/library", label: "Show everything" }} />
        ) : (
          <Empty title="Nothing here yet" body="Every Short you swipe right on lands here: being made, scheduled, posted, with its views once it's up." action={{ href: "/app/shorts", label: "Go to your queue" }} />
        )
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {lib.items.map((it) => {
            const s = state(it);
            return (
              <li key={it.id}>
                <Link href={`/app/shorts/${it.id}`} className="group flex h-full flex-col border-2 border-edge bg-card transition hover:border-fg">
                  <Cover format={it.format} label={formatName(it)} className="aspect-[4/3] w-full" />
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    {tagOf(it) && <p className="-mb-1 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{tagOf(it)}</p>}
                    <p className="line-clamp-2 text-[14px] font-semibold leading-snug group-hover:underline">{it.title}</p>
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      <Pill tone={s.tone}>{s.label}</Pill>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted"><LocalTime iso={it.at.toISOString()} style="day" /></span>
                    </div>
                    {it.views !== null && (
                      <p className="text-[13px] tabular-nums text-muted">
                        <b className="font-semibold text-fg">{n(it.views)}</b> views
                        {it.vsUsual !== null && <> · <span className={it.vsUsual >= 1 ? "text-fg" : ""}>{it.vsEstimated ? "about " : ""}{times(it.vsUsual)} usual</span></>}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {lib.pages > 1 && (
        <nav aria-label="Pages" className="mt-8 flex items-center gap-3">
          {lib.page > 1 && <Link href={link({ page: lib.page - 1 })} className={button.secondary}>Newer</Link>}
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Page {lib.page} of {lib.pages}</span>
          {lib.page < lib.pages && <Link href={link({ page: lib.page + 1 })} className={button.secondary}>Older</Link>}
        </nav>
      )}
    </>
  );
}
