import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton, AutoRefresh, CopyButton } from "@/components/app/client-bits";
import { Icons } from "@/components/app/icons";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, Empty, PageHead, Pill } from "@/components/app/ui";
import { PostedForm } from "@/components/shorts/posted";
import { SwipeQueue } from "@/components/shorts/swipe";
import { TikTokLater } from "@/components/shorts/tiktok";
import { FORMATS } from "@/lib/shorts/formats";
import { validTimezone } from "@/lib/shorts/times";
import { seconds } from "@/lib/shorts/timing";
import { markable, STUDIO_UPLOAD } from "@/lib/shorts/youtube";
import { account } from "@/lib/server/account";
import { channelsOf, postingChannel } from "@/lib/server/channels";
import { asUser } from "@/lib/server/db";
import { configured } from "@/lib/server/env";
import { allowanceOf, makeShorts, shortsNoteOf } from "@/lib/server/shorts/generate";
import { queueOf, type Coming } from "@/lib/server/shorts/queue";
import { workerStatus } from "@/lib/server/worker";
import { decide, editCopy, makeMore, posted, postToTikTok, sendToTikTok, tiktokAccount, tryAgain } from "./actions";

export const metadata: Metadata = { title: "Shorts" };

const n = (v: number) => v.toLocaleString("en-US");

/** Where a Short is. `auto` is whether Hookline uploads to the channel itself; otherwise the creator posts it. */
function statusOf(c: Coming, auto: boolean, now: Date): { label: string; tone: "plain" | "good" | "warn" | "signal" } {
  if (c.status === "failed") return { label: "Failed", tone: "signal" };
  // up on YouTube, but only posted once YouTube says so
  if (c.status === "scheduled") return c.scheduledFor && c.scheduledFor > now ? { label: "Scheduled on YouTube", tone: "good" } : { label: "Checking YouTube", tone: "warn" };
  if (c.status === "ready" && c.heldBack) return { label: "Waiting for quota", tone: "warn" };
  if (c.status === "ready") return { label: c.youtubeId ? "On YouTube" : auto ? "Ready" : "Ready for you to post", tone: "good" };
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
  const youtube = postingChannel(channels);
  const tiktok = channels.find((c) => c.platform === "tiktok" && c.status === "connected");
  // straight to TikTok too: on a plan that posts, once direct posting is on
  const tiktokDirect = me.plan.scheduling && !!tiktok && configured().tiktokDirect;
  // Hookline uploads to YouTube itself only after YouTube's audit (or to a test channel); otherwise the creator does
  const youtubeAuto = me.plan.scheduling && !!youtube?.api;
  const schedules = youtubeAuto || tiktokDirect;
  const now = new Date();
  const working = q.coming.some((c) => c.status === "approved" || c.status === "rendering" || c.cleaning);
  // nothing's rendering at all right now: say so, rather than leave Shorts looking stuck
  const paused = working && (await workerStatus()).running === 0;
  const per = allow.per === "week" ? "this week" : "today";
  // nothing waiting with Shorts left to make: if there was nothing new to make, say so rather than look empty
  const note = !q.waiting.length && allow.left > 0 ? await shortsNoteOf(me.id) : null;

  return (
    <>
      <PageHead
        eyebrow="Shorts"
        title="Your queue"
        line={`${allow.made} of ${allow.limit} made ${per}. Swipe right to ${schedules ? "post" : "keep"} one, left for a different one.`}
      />

      {me.plan.scheduling && !youtube && !tiktokDirect && (
        <p className="mb-6 border-2 border-dashed border-edge-strong px-4 py-3 text-[14px]">
          {configured().youtubeAudited
            ? "Connect YouTube and the Shorts you approve post themselves at the right time."
            : "Connect YouTube so Hookline can check the Shorts you post and read their views."}{" "}
          <Link href="/app/settings" className="underline decoration-signal decoration-2 underline-offset-4">Connect it</Link>
        </p>
      )}
      {youtube && youtube.madeForKids === null && (
        <p className="mb-6 border-2 border-signal px-4 py-3 text-[14px]">
          Say whether your YouTube channel is made for kids before anything posts to it.{" "}
          <Link href="/app/settings#audience" className="underline decoration-signal decoration-2 underline-offset-4">Answer in Settings</Link>
        </p>
      )}

      {q.waiting.length ? (
        <SwipeQueue
          items={q.waiting.map((w) => ({ id: w.id, spec: w.spec, format: FORMATS[w.spec.format].name, title: w.title, description: w.description, why: w.why, suggestedFor: w.suggestedFor?.toISOString() ?? null }))}
          tag={me.plan.tag}
          schedules={schedules}
          paid={me.plan.scheduling}
          youtube={youtube ? { auto: youtubeAuto, kids: youtube.madeForKids, youtubeKids: youtube.youtubeKids } : null}
          youtubeApi={configured().youtubeAudited}
          creator={tiktokDirect ? tiktokAccount : undefined}
          decide={decide}
          edit={editCopy}
        />
      ) : note ? (
        <Empty
          title="Nothing new to make right now"
          body={note}
          action={<ActionButton action={makeMore} className={button.secondary} busy="Trying…">Try again</ActionButton>}
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
              <>Free makes 3 a week; more arrive as the week rolls on. Pro makes 3 every day{configured().youtubeAudited ? " and posts them for you" : ""}.</>
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
          {paused && (
            <p role="status" className="border-b-2 border-edge bg-card-2 px-5 py-3 text-[13px] leading-relaxed">
              <b className="font-semibold">Making videos is paused right now.</b> Yours are safe in line and get made as soon as it&rsquo;s back, by themselves.
            </p>
          )}
          {q.coming.length === 0 ? (
            <p className="px-5 py-5 text-[14px] text-muted">Shorts you swipe right on show up here while they&rsquo;re made{schedules ? " and until they post" : ", ready to download"}.</p>
          ) : (
            <ul className="divide-y-2 divide-edge">
              {q.coming.map((c) => {
                const s = statusOf(c, youtubeAuto, now);
                // the creator posts it to YouTube themselves, so its time is the best time to, not when it posts
                const self = !c.youtubeId && !youtubeAuto;
                // ready and waiting for them to
                const byHand = self && c.hasFile && c.status === "ready";
                return (
                  <li key={c.id} className="flex flex-col gap-3 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/app/shorts/${c.id}`} className="block truncate text-[15px] font-semibold hover:underline">{c.title}</Link>
                        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                          {FORMATS[c.spec.format].name}
                          {c.scheduledFor && <> · {self ? "best time" : "posts"} <LocalTime iso={c.scheduledFor.toISOString()} /></>}
                          {c.madeForKids && <> · made for kids</>}
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
                    {c.youtubeKids && <p className="text-[13px]">YouTube marked this Made for Kids: comments are off.</p>}
                    {c.heldBack && (
                      <p className="text-[13px] text-muted">
                        Waiting for YouTube upload quota. It goes up when that resets{c.heldBack.until && <>, around <LocalTime iso={c.heldBack.until.toISOString()} /></>}.
                      </p>
                    )}
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
                      {byHand && (
                        <a href={STUDIO_UPLOAD} target="_blank" rel="noreferrer" className={button.quiet}>
                          Open YouTube Studio <Icons.external className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {c.hasFile && tiktok && !c.tiktokId && !configured().tiktokDirect && (
                        c.cleaning ? (
                          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Making TikTok&rsquo;s copy, without the tag…</span>
                        ) : (
                          <form action={sendToTikTok}><input type="hidden" name="id" value={c.id} /><button type="submit" className={button.quiet}>{c.tiktokFile ? "Send to TikTok drafts" : "Get it ready for TikTok"}</button></form>
                        )
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
                        tag={false}
                        label={c.tiktok ? "Choose again for TikTok" : "Post to TikTok too"}
                        load={tiktokAccount}
                        choose={postToTikTok}
                      />
                    )}
                    {markable(c) && <PostedForm id={c.id} posted={posted} />}
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
                    <Link href={`/app/shorts/${p.id}`} className="block truncate text-[15px] font-semibold hover:underline">{p.title}</Link>
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                      {FORMATS[p.format].name}
                      {p.postedAt && <> · <LocalTime iso={p.postedAt.toISOString()} style="day" /></>}
                      {p.privacy && p.privacy !== "public" && <> · {p.privacy}</>}
                      {p.youtubeId && !p.verified && <> · link not checked</>}
                      {p.youtubeKids && <> · made for kids, comments off</>}
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
