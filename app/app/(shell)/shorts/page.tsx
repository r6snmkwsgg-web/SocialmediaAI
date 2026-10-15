import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton, AutoRefresh, CopyButton } from "@/components/app/client-bits";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, Empty, PageHead, Pill } from "@/components/app/ui";
import { SwipeQueue } from "@/components/shorts/swipe";
import { TikTokLater } from "@/components/shorts/tiktok";
import { FORMATS } from "@/lib/shorts/formats";
import { validTimezone } from "@/lib/shorts/times";
import { seconds } from "@/lib/shorts/timing";
import { account } from "@/lib/server/account";
import { channelsOf } from "@/lib/server/channels";
import { asUser } from "@/lib/server/db";
import { configured } from "@/lib/server/env";
import { allowanceOf, makeShorts } from "@/lib/server/shorts/generate";
import { queueOf, type Coming } from "@/lib/server/shorts/queue";
import { decide, editCopy, makeMore, posted, postToTikTok, sendToTikTok, tiktokAccount, tryAgain } from "./actions";

export const metadata: Metadata = { title: "Shorts" };

const n = (v: number) => v.toLocaleString("en-US");

function statusOf(c: Coming): { label: string; tone: "plain" | "good" | "warn" | "signal" } {
  if (c.status === "failed") return { label: "Failed", tone: "signal" };
  if (c.status === "scheduled") return { label: "Scheduled on YouTube", tone: "good" };
  if (c.status === "ready") return { label: c.youtubeId ? "On YouTube" : "Ready", tone: "good" };
  if (c.progress !== null && c.status === "rendering") return { label: `Rendering ${Math.round(c.progress * 100)}%`, tone: "warn" };
  return { label: "Waiting to render", tone: "plain" };
}

export default async function Shorts() {
  const me = await account();
  const [{ timezone }] = await asUser(me.id, (tx) => tx<{ timezone: string }[]>`select timezone from public.profiles where id = ${me.id}`);
  const tz = validTimezone(timezone);
  let allow = await allowanceOf(me.id, me.plan, tz);
  let q = await queueOf(me.id);

  // the first look of the day, with nothing made yet: make today's now
  if (!q.waiting.length && allow.made === 0 && allow.left > 0) {
    await makeShorts(me.id, { origin: "daily" });
    [allow, q] = await Promise.all([allowanceOf(me.id, me.plan, tz), queueOf(me.id)]);
  }

  const channels = await channelsOf(me.id);
  const youtube = channels.find((c) => c.platform === "youtube" && c.status === "connected");
  const tiktok = channels.find((c) => c.platform === "tiktok" && c.status === "connected");
  // straight to TikTok too: on a plan that posts, once direct posting is on
  const tiktokDirect = me.plan.scheduling && !!tiktok && configured().tiktokDirect;
  const schedules = me.plan.scheduling && (!!youtube || tiktokDirect);
  const working = q.coming.some((c) => c.status === "approved" || c.status === "rendering");
  const per = allow.per === "week" ? "this week" : "today";

  return (
    <>
      <PageHead
        eyebrow="Shorts"
        title="Your queue"
        line={`${allow.made} of ${allow.limit} made ${per}. Swipe right to ${schedules ? "post" : "keep"} one, left for a different one.`}
      />

      {me.plan.scheduling && !youtube && !tiktokDirect && (
        <p className="mb-6 border-2 border-dashed border-edge-strong px-4 py-3 text-[14px]">
          Connect YouTube and the Shorts you approve post themselves at the right time.{" "}
          <Link href="/app/settings" className="underline decoration-signal decoration-2 underline-offset-4">Connect it</Link>
        </p>
      )}

      {q.waiting.length ? (
        <SwipeQueue
          items={q.waiting.map((w) => ({ id: w.id, spec: w.spec, format: FORMATS[w.spec.format].name, title: w.title, description: w.description, why: w.why, suggestedFor: w.suggestedFor?.toISOString() ?? null }))}
          tag={me.plan.tag}
          schedules={schedules}
          creator={tiktokDirect ? tiktokAccount : undefined}
          decide={decide}
          edit={editCopy}
        />
      ) : allow.left > 0 ? (
        <Empty
          title="Nothing waiting"
          body={`You've got ${allow.left} more ${allow.left === 1 ? "Short" : "Shorts"} ${per} on ${me.plan.name}.`}
          action={<ActionButton action={makeMore} className={button.primary} busy="Making them…">Make them now</ActionButton>}
        />
      ) : (
        <Empty
          title={`That's ${per}'s Shorts`}
          body={
            me.plan.id === "free" ? (
              <>Free makes 3 a week; more arrive as the week rolls on. Pro makes 3 every day and posts them for you.</>
            ) : (
              "Tomorrow's land in your queue in the morning."
            )
          }
          action={me.plan.id === "free" ? { href: "/app/settings/billing", label: "See Pro" } : undefined}
        />
      )}

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHead title="Coming up" />
          <AutoRefresh active={working} />
          {q.coming.length === 0 ? (
            <p className="px-5 py-5 text-[14px] text-muted">Shorts you swipe right on show up here while they&rsquo;re made{schedules ? " and until they post" : ", ready to download"}.</p>
          ) : (
            <ul className="divide-y-2 divide-edge">
              {q.coming.map((c) => {
                const s = statusOf(c);
                return (
                  <li key={c.id} className="flex flex-col gap-3 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold">{c.title}</p>
                        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                          {FORMATS[c.spec.format].name}
                          {c.scheduledFor && <> · posts <LocalTime iso={c.scheduledFor.toISOString()} /></>}
                        </p>
                      </div>
                      <Pill tone={s.tone}>{s.label}</Pill>
                    </div>
                    {c.progress !== null && c.status !== "ready" && (
                      <div className="h-1.5 bg-card-2" aria-hidden="true">
                        <div className="h-full bg-signal transition-[width]" style={{ width: `${Math.round(c.progress * 100)}%` }} />
                      </div>
                    )}
                    {c.error && <p className="text-[13px] text-signal">{c.error}</p>}
                    {c.tiktok && !c.tiktokId && (
                      c.tiktok.error ? (
                        <p className="text-[13px] text-signal">TikTok didn&rsquo;t take it: {c.tiktok.error}</p>
                      ) : (
                        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                          TikTok {c.tiktok.at ? <>at <LocalTime iso={c.tiktok.at.toISOString()} /></> : "once it's made"}
                        </p>
                      )
                    )}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                      {c.hasFile && <a href={`/api/videos/${c.id}/file?download=1`} className={button.quiet}>Download</a>}
                      {c.hasFile && <CopyButton text={`${c.title}\n\n${c.description}`} className={button.quiet} />}
                      {c.hasFile && tiktok && !c.tiktokId && !configured().tiktokDirect && (
                        <form action={sendToTikTok}><input type="hidden" name="id" value={c.id} /><button type="submit" className={button.quiet}>Send to TikTok drafts</button></form>
                      )}
                      {c.tiktokId && (
                        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                          {c.tiktok ? "On TikTok · it can take a few minutes to show on your profile" : "In your TikTok drafts"}
                        </span>
                      )}
                      {c.status === "failed" && <form action={tryAgain}><input type="hidden" name="id" value={c.id} /><button type="submit" className={button.quiet}>Try again</button></form>}
                    </div>
                    {tiktokDirect && !c.tiktokId && c.status !== "failed" && (!c.tiktok || c.tiktok.error) && (
                      <TikTokLater
                        id={c.id}
                        spec={c.spec}
                        seconds={seconds(c.spec)}
                        tag={me.plan.tag}
                        label={c.tiktok ? "Choose again for TikTok" : "Post to TikTok too"}
                        load={tiktokAccount}
                        choose={postToTikTok}
                      />
                    )}
                    {c.hasFile && !c.youtubeId && (
                      <form action={posted} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={c.id} />
                        <label className="sr-only" htmlFor={`link-${c.id}`}>YouTube link, if you posted it there</label>
                        <input id={`link-${c.id}`} name="link" placeholder="YouTube link, to track its views (optional)" className="min-w-0 flex-1 border-2 border-edge-strong bg-surface px-3 py-1.5 text-[13px] focus:border-fg focus:outline-none" />
                        <button type="submit" className={button.secondary}>I posted it</button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Posted" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Views at 1h · 24h · 72h</span>} />
          {q.posted.length === 0 ? (
            <p className="px-5 py-5 text-[14px] text-muted">
              Once a Short is up, its views show here at 1 hour, 24 hours and 3 days. That&rsquo;s what Hookline learns from: formats that beat your usual get picked more.
            </p>
          ) : (
            <ul className="divide-y-2 divide-edge">
              {q.posted.map((p) => (
                <li key={p.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">
                      {p.youtubeId ? <a href={`https://youtube.com/shorts/${p.youtubeId}`} target="_blank" rel="noreferrer" className="hover:underline">{p.title}</a> : p.title}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                      {FORMATS[p.format].name}
                      {p.postedAt && <> · <LocalTime iso={p.postedAt.toISOString()} style="day" /></>}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-4 text-right font-mono text-[13px] tabular-nums">
                    {(["1h", "24h", "72h"] as const).map((k) => (
                      <span key={k} className={p.views[k] === undefined ? "text-muted" : ""} title={`${k} after posting`}>
                        {p.views[k] === undefined ? "—" : n(p.views[k]!)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
