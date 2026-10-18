import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, Empty, NotSetUp, PageHead, Pill } from "@/components/app/ui";
import { FORMATS } from "@/lib/shorts/formats";
import type { FormatId } from "@/lib/shorts/types";
import { kidsOf, NICHES, nicheOf, staleLines, staleOf } from "@/lib/trends/niches";
import { account } from "@/lib/server/account";
import { asUser } from "@/lib/server/db";
import { configured } from "@/lib/server/env";
import { channelTrendNiches, nichesOf } from "@/lib/server/niches";
import { followedNiches, kidsShare, leaderboard, postingTimes, rising, trendChecks } from "@/lib/server/trends";
import { follow, makeLike } from "./actions";

export const metadata: Metadata = { title: "Trends" };

const compact = (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: v < 10_000 ? 1 : 0 }).format(v);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BLOCKS = ["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm"];

function age(d: Date): string {
  const h = Math.max(1, Math.round((Date.now() - d.getTime()) / 3600_000));
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** When a rising Short's views were read: niches are checked once a day, so a figure can be up to a day old. */
function measured(d: Date): string {
  return Date.now() - d.getTime() < 3600_000 ? "measured in the last hour" : `measured ${age(d)}`;
}

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Trends({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const [followed, ours] = await Promise.all([followedNiches(me.id), channelTrendNiches(me.id)]);
  // with none followed, the niches their channels are about; with none of those picked either, every niche
  const niches = followed.length ? followed : ours.ids;
  // with no channel, what its own Shorts are about, to say why "make one like this" made nothing
  const ownNiche = q.error === "niche" && ours.own ? (await asUser(me.id, (tx) => nichesOf(tx, me.id))).get(null) : null;
  const [videos, board, times, [profile], checks, kids] = await Promise.all([
    rising(me.id, niches),
    leaderboard(me.id),
    postingTimes(me.id),
    asUser(me.id, (tx) => tx<{ text_stories: boolean }[]>`select text_stories from public.profiles where id = ${me.id}`),
    trendChecks(me.id),
    kidsShare(me.id, niches),
  ]);
  // text stories are only made once the creator turns them on
  const makes = (f: FormatId) => f !== "texts" || !!profile?.text_stories;
  const ready = configured().youtubeTrends;
  const top = Math.max(...board.rows.map((r) => r.typical ?? 0), 1);
  // the niches on show (every one, when none are picked), and any of them not checked in over a day, or ever. With nothing
  // measured yet, the empty state already says when niches are first checked, so only a reason it went wrong is added
  const shown = niches.length ? NICHES.filter((n) => niches.includes(n.id)) : NICHES;
  const late = ready ? staleOf(checks, shown.map((n) => n.id), new Date()) : [];
  const stale = staleLines(videos.length ? late : late.filter((s) => s.checkedAt || s.outcome));

  return (
    <>
      <PageHead
        eyebrow="Trends"
        title="What's taking off"
        line={
          <>
            Shorts growing fastest right now, in views per hour since they went up, from YouTube. Each niche is checked once a day
            {board.updated ? <>, most recently <LocalTime iso={board.updated.toISOString()} />.</> : "."}
          </>
        }
      />
      {!ready && <div className="mb-6"><NotSetUp what="Trends" keys={["YOUTUBE_API_KEY"]} /></div>}
      {q.error === "allowance" && <p role="alert" className="mb-6 border-2 border-signal px-4 py-3 text-[15px]">That&rsquo;s all the Shorts your plan makes for now. More arrive with your next batch.</p>}
      {q.error === "dry" && <p role="alert" className="mb-6 border-2 border-signal px-4 py-3 text-[15px]">There&rsquo;s nothing new of that kind left to make for you right now. Hookline never makes the same thing twice, for your channel or anyone else&rsquo;s.</p>}
      {q.error === "off" && (
        <p role="alert" className="mb-6 border-2 border-signal px-4 py-3 text-[15px]">
          Text stories are off for your channel. <Link href="/app/settings" className="underline decoration-signal decoration-2 underline-offset-4">Turn them on in Settings</Link> first.
        </p>
      )}
      {q.error === "stopped" && (
        <p role="alert" className="mb-6 border-2 border-signal px-4 py-3 text-[15px]">
          Shorts are off for every channel. <Link href="/app/settings" className="underline decoration-signal decoration-2 underline-offset-4">Switch one on in Settings.</Link>
        </p>
      )}
      {q.error === "niche" && (
        <p role="alert" className="mb-6 border-2 border-signal px-4 py-3 text-[15px]">
          {ours.own ? (
            <>
              Your Shorts are about {ownNiche?.name ?? "one thing"}, which doesn&rsquo;t make {FORMATS[q.format as FormatId]?.plural ?? "Shorts like that"}.{" "}
              <Link href="/app/settings#shorts" className="underline decoration-signal decoration-2 underline-offset-4">Change what they&rsquo;re about in Settings</Link> to make one.
            </>
          ) : (
            <>
              None of your channels make {FORMATS[q.format as FormatId]?.plural ?? "Shorts like that"}.{" "}
              <Link href="/app/settings" className="underline decoration-signal decoration-2 underline-offset-4">Change what a channel is about in Settings</Link> to make one.
            </>
          )}
        </p>
      )}
      {q.error === "writer" && (
        <p role="alert" className="mb-6 border-2 border-signal px-4 py-3 text-[15px]">
          {configured().claude
            ? "Claude didn't answer, so nothing new could be written. Try again in a little while."
            : "Nothing new can be written for that until Claude is set up on this Hookline."}
        </p>
      )}
      {q.error === "waiting" && (
        <p role="alert" className="mb-6 border-2 border-signal px-4 py-3 text-[15px]">
          Swipe the Ball League matches waiting first, then make one.{" "}
          <Link href="/app/shorts" className="underline decoration-signal decoration-2 underline-offset-4">Open your queue</Link>
        </p>
      )}

      <form action={follow} className="mb-8 flex flex-wrap items-center gap-2" aria-label="Niches to show">
        {NICHES.map((n) => (
          <label key={n.id} className="cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-signal">
            <input type="checkbox" name="niche" value={n.id} defaultChecked={followed.includes(n.id)} className="peer sr-only" />
            {/* outlined: on show because their Shorts are about it, though nobody picked it here */}
            <span className={`inline-block border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition peer-checked:border-fg peer-checked:bg-fg peer-checked:text-surface ${!followed.length && ours.ids.includes(n.id) ? "border-fg text-fg" : "border-edge text-muted"}`}>
              {n.name}
            </span>
          </label>
        ))}
        <button type="submit" className={`${button.quiet} ml-1`}>Show these →</button>
        {!followed.length && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            {ours.ids.length ? `Showing ${ours.own ? "what your Shorts are about" : "your channels' niches"}. Pick others to see them instead.` : "Showing every niche"}
          </span>
        )}
      </form>

      <section aria-labelledby="rising" className="mb-12">
        <h2 id="rising" className="mb-4 font-display text-2xl uppercase tracking-wide">Rising now</h2>
        {stale.length > 0 && (
          <div role="status" className="mb-4 flex flex-col gap-1 border-2 border-edge-strong bg-card-2 px-4 py-3 text-[14px] leading-relaxed">
            {stale.map((line) => <p key={line}>{line}</p>)}
          </div>
        )}
        {videos.length === 0 ? (
          <Empty
            title="Nothing measured yet"
            body={ready ? "Each niche is checked once a day, starting within half an hour of the worker starting. Rising Shorts in your niches show up here, fastest-growing first." : "Once a YouTube API key is set, the worker checks each niche once a day and the fastest-growing Shorts show up here."}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {videos.map((v) => {
              const n = nicheOf(v.niche);
              return (
                <li key={v.id} className="flex min-w-0 flex-col border-2 border-edge bg-card">
                  <a href={v.url} target="_blank" rel="noreferrer" className="relative block aspect-video bg-card-2">
                    {v.thumbnail && <Image src={v.thumbnail} alt="" fill sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 100vw" className="object-cover" />}
                  </a>
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-display text-3xl leading-none tabular-nums">{compact(v.perHour)}<span className="ml-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">/hour</span></span>
                      {n && <Pill>{n.name}</Pill>}
                    </div>
                    <p className="-mt-2 font-mono text-[11px] text-muted">{measured(v.fetchedAt)}</p>
                    <a href={v.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[15px] font-semibold leading-snug hover:underline">{v.title}</a>
                    <p className="text-[13px] text-muted">{v.channel} · {compact(v.views)} views · {age(v.publishedAt)}</p>
                    {n?.format && makes(n.format) && (
                      <form action={makeLike} className="mt-auto">
                        <input type="hidden" name="niche" value={n.id} />
                        <button type="submit" className={button.secondary}>Make one like this</button>
                      </form>
                    )}
                    {n?.format && !makes(n.format) && (
                      <p className="mt-auto text-[13px] text-muted">
                        Text stories are off for your channel. <Link href="/app/settings" className="underline underline-offset-4">Turn them on</Link> to make one like this.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHead title="Formats right now" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Typical views/hour</span>} />
          <table className="w-full text-left text-[14px]">
            <caption className="sr-only">Each format: how fast a typical rising Short in it is growing on YouTube now, and how it does on your channel</caption>
            <thead>
              <tr className="border-b-2 border-edge font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                <th scope="col" className="px-5 py-2.5 font-normal">Format</th>
                <th scope="col" className="px-3 py-2.5 font-normal">On YouTube now</th>
                <th scope="col" className="px-5 py-2.5 text-right font-normal">On your channel</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r) => (
                <tr key={r.format} className="border-b border-edge last:border-0">
                  <th scope="row" className="px-5 py-3 font-semibold">{FORMATS[r.format as FormatId]?.name ?? r.format}</th>
                  <td className="px-3 py-3">
                    {r.typical === null ? (
                      <span className="text-muted">Not measured yet</span>
                    ) : (
                      <span className="flex items-center gap-3">
                        <span className="h-2.5 flex-1 bg-card-2"><span className="block h-full bg-signal" style={{ width: `${(r.typical / top) * 100}%` }} /></span>
                        <span className="w-14 text-right font-mono text-[12px] tabular-nums">{compact(r.typical)}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[12px] tabular-nums">
                    {r.mine && r.mine.samples >= 3 ? `${r.mine.score.toFixed(1)}× usual` : <span className="text-muted">{r.mine?.samples ? `${r.mine.samples} posted` : "—"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 pb-4 pt-1 text-[12px] leading-relaxed text-muted">The middle of the rising Shorts measured in each format over the last three days. Your channel&rsquo;s column compares your Shorts&rsquo; first days with your usual one, by engaged views where YouTube has reported them.</p>
        </Card>

        <Card>
          <CardHead title="Your best times" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{times.posts} posts</span>} />
          {times.posts === 0 ? (
            <p className="px-5 py-5 text-[14px] leading-relaxed text-muted">
              When your posts did best, by day and time, from your own Shorts&rsquo; plays at 24 hours. It fills in as you post. Until there&rsquo;s enough to go on, Shorts post at a starting guess, and about one in five at another hour to learn from.
            </p>
          ) : (
            <div className="overflow-x-auto px-5 py-5">
              <table className="w-full min-w-[440px] border-separate border-spacing-1 text-[11px]">
                <caption className="sr-only">How Shorts posted at each day and time did at 24 hours, compared with your usual</caption>
                <thead>
                  <tr>
                    <td />
                    {BLOCKS.map((b) => <th key={b} scope="col" className="pb-1 text-center font-mono font-normal text-muted">{b}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map((d, i) => (
                    <tr key={d}>
                      <th scope="row" className="pr-2 text-left font-mono font-normal text-muted">{d}</th>
                      {times.map.cells[i].map((v, b) => (
                        <td
                          key={b}
                          title={v === null ? "No posts yet" : `${v.toFixed(1)}× your usual, ${times.map.counts[i][b]} post${times.map.counts[i][b] === 1 ? "" : "s"}`}
                          className="h-8 border border-edge text-center font-mono tabular-nums"
                          style={v === null ? undefined : { background: `color-mix(in srgb, var(--color-signal) ${Math.round(Math.min(1, Math.max(0.12, Math.log2(v + 1) / 2)) * 100)}%, var(--card))`, color: v > 1.6 ? "#0b0b0c" : undefined }}
                        >
                          {v === null ? "" : `${v.toFixed(1)}×`}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[12px] text-muted">Each square: how Shorts posted then did by plays at 24 hours, against your usual. Darker is better; blank means no posts there yet.</p>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHead title="Made for kids, by niche" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Last three days</span>} />
        <table className="w-full text-left text-[14px]">
          <caption className="sr-only">For each niche shown, how many of its rising Shorts YouTube marked made for kids, of the ones it said either way about</caption>
          <thead>
            <tr className="border-b-2 border-edge font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              <th scope="col" className="px-5 py-2.5 font-normal">Niche</th>
              <th scope="col" className="px-5 py-2.5 font-normal">Marked made for kids</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((n) => {
              const k = kids.get(n.id);
              const share = kidsOf(k?.kids ?? 0, k?.of ?? 0);
              return (
                <tr key={n.id} className="border-b border-edge last:border-0">
                  <th scope="row" className="w-[38%] px-5 py-3 font-semibold">{n.name}</th>
                  <td className="px-5 py-3">
                    {share.pct === null ? (
                      <span className="text-muted">{share.text}</span>
                    ) : (
                      <span className="flex items-center gap-3">
                        <span className="h-2.5 flex-1 bg-card-2"><span className="block h-full bg-muted" style={{ width: `${share.pct}%` }} /></span>
                        <span className="w-20 shrink-0 text-right font-mono text-[12px] tabular-nums">{share.text}</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-5 pb-4 pt-1 text-[12px] leading-relaxed text-muted">
          Of the fastest-growing Shorts Hookline found in each niche over the last three days, how many YouTube itself marked made for kids. YouTube turns comments off on those. Shorts YouTube said nothing about aren&rsquo;t counted.
        </p>
      </Card>
    </>
  );
}
