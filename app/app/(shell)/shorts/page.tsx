import type { Metadata } from "next";
import Link from "next/link";
import { ChannelFilter } from "@/components/app/channel-filter";
import { ActionButton, AutoRefresh, CopyButton } from "@/components/app/client-bits";
import { Icons } from "@/components/app/icons";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, Empty, PageHead, Pill } from "@/components/app/ui";
import { PostedForm } from "@/components/shorts/posted";
import { SwipeQueue, type CardChannel } from "@/components/shorts/swipe";
import { TikTokLater } from "@/components/shorts/tiktok";
import { isActive, postsAll, uploadsTo } from "@/lib/shorts/channels";
import { formatName } from "@/lib/shorts/formats";
import { canTryAgain } from "@/lib/live/clip-rules";
import { validTimezone } from "@/lib/shorts/times";
import { seconds } from "@/lib/shorts/timing";
import { markable, STUDIO_UPLOAD } from "@/lib/shorts/youtube";
import { HeldWords } from "@/components/shorts/held";
import { uploadCap } from "@/lib/billing/plans";
import { HELD, heldShown, type Held } from "@/lib/shorts/history";
import { account } from "@/lib/server/account";
import { channelsOf, shortsChannelsOf } from "@/lib/server/channels";
import { asUser } from "@/lib/server/db";
import { configured } from "@/lib/server/env";
import { allowancesOf, makeShorts, shortsNoteOf } from "@/lib/server/shorts/generate";
import { queueOf, type Coming } from "@/lib/server/shorts/queue";
import { workerStatus } from "@/lib/server/worker";
import { decide, editCopy, makeMore, posted, postToTikTok, sendToTikTok, tiktokAccount, tryAgain } from "./actions";

export const metadata: Metadata = { title: "Shorts" };

const n = (v: number) => v.toLocaleString("en-US");

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Where a Short is. `auto` is whether Hookline uploads to its channel itself; otherwise the creator posts it. `held` is what it's waiting for. */
function statusOf(c: Coming, auto: boolean, now: Date, held: Held | null): { label: string; tone: "plain" | "good" | "warn" | "signal" } {
  if (c.status === "failed") return { label: "Failed", tone: "signal" };
  // up on YouTube, but only posted once YouTube says so
  if (c.status === "scheduled") return c.scheduledFor && c.scheduledFor > now ? { label: "Scheduled on YouTube", tone: "good" } : { label: "Checking YouTube", tone: "warn" };
  if (c.status === "ready" && held) return { label: HELD[held.on].pill, tone: "warn" };
  if (c.status === "ready") return { label: c.youtubeId ? "On YouTube" : auto ? "Ready" : "Ready for you to post", tone: "good" };
  if (c.progress !== null && c.status === "rendering") return { label: `Rendering ${Math.round(c.progress * 100)}%`, tone: "warn" };
  return { label: "Waiting to render", tone: "plain" };
}

const linked = "underline decoration-signal decoration-2 underline-offset-4";

export default async function Shorts({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const search = await searchParams;
  const [{ timezone }] = await asUser(me.id, (tx) => tx<{ timezone: string }[]>`select timezone from public.profiles where id = ${me.id}`);
  const tz = validTimezone(timezone);
  // the YouTube channels Shorts are for, and the one picked to see (anything else means all of them)
  const shown = await shortsChannelsOf(me.id);
  const picked = shown.find((c) => c.id === search.channel) ?? null;
  let allow = await allowancesOf(me.id, me.plan, tz);
  let q = await queueOf(me.id, picked?.id);

  // the first look of the day, with nothing made yet: make one channel's now (the one picked, or the first with none
  // made yet), so opening the queue waits on one channel's Shorts at most
  const due = q.waiting.length ? undefined : allow.order.find((u) => (!picked || u === picked.id) && allow.units.get(u)!.made === 0 && allow.units.get(u)!.left > 0);
  if (due !== undefined) {
    await makeShorts(me.id, { origin: "daily", channelId: due });
    [allow, q] = await Promise.all([allowancesOf(me.id, me.plan, tz), queueOf(me.id, picked?.id)]);
  }

  const channels = await channelsOf(me.id);
  const tiktok = channels.find((c) => c.platform === "tiktok" && c.status === "connected");
  // straight to TikTok too: on a plan that posts, once direct posting is on
  const tiktokDirect = me.plan.scheduling && !!tiktok && configured().tiktokDirect;
  const byId = new Map(shown.map((c) => [c.id, c]));
  const channelOf = (id: string | null) => (id ? byId.get(id) : undefined);
  // Hookline uploads to a Short's own channel itself only after YouTube's audit (or to a test channel); otherwise the creator does
  const autoOf = (id: string | null) => uploadsTo(channelOf(id), me.plan.scheduling);
  // each card and row says which channel it's for when there's more than one
  const several = shown.length > 1;
  const nameTag = (id: string | null) => {
    const c = several ? channelOf(id) : undefined;
    return c && <>{c.name} · </>;
  };
  const card = (id: string | null): CardChannel | null => {
    const c = channelOf(id);
    return c
      ? { name: c.name, connected: c.status === "connected", expired: c.status === "expired", auto: autoOf(c.id), api: me.plan.scheduling && c.api, kids: c.madeForKids, youtubeKids: c.youtubeKids }
      : null;
  };
  // a yes posts only when every channel shown is one Hookline uploads to, or TikTok direct posting is on
  const posts = postsAll((picked ? [picked.id] : allow.order).map(channelOf), me.plan.scheduling, tiktokDirect);
  const unit = picked ? allow.units.get(picked.id) : undefined;
  const left = picked ? (unit?.left ?? 0) : allow.account.left;
  const more = picked ? makeMore.bind(null, picked.id) : makeMore;
  const now = new Date();
  // what a plan wait says: the plan, and the Shorts it uploads a day for the YouTube channels connected
  const uploads = { name: me.plan.name, cap: uploadCap(me.plan, channels.filter((c) => c.platform === "youtube" && c.status === "connected").length) };
  const working = q.coming.some((c) => c.status === "approved" || c.status === "rendering" || c.cleaning);
  // nothing's rendering at all right now: say so, rather than leave Shorts looking stuck
  const paused = working && (await workerStatus()).running === 0;
  const per = allow.account.per === "week" ? "this week" : "today";
  // nothing waiting with Shorts left to make: if there was nothing new to make (for the channel picked), say so rather than look empty
  const note = !q.waiting.length && left > 0 ? await shortsNoteOf({ userId: me.id, channelId: picked?.id ?? null }) : null;
  const many = (k: number) => (k === 1 ? "one channel" : `${k} channels`);
  const swipe = `Swipe right to ${posts ? "post" : "keep"} one, left for a different one.`;
  const settings = (href: string) => <Link href={href} className={linked}>Settings</Link>;
  // Shorts made today for a channel that gets none any more still count toward the plan, but never read as more than it allows
  const madeOf = (a: { made: number; limit: number }) => Math.min(a.made, a.limit);
  // what the queue is making: one channel's (or why it gets none), every channel's, or the account's own
  const line: React.ReactNode = picked ? (
    !isActive(picked) ? (
      `${picked.name} is disconnected, so it gets no new Shorts. The ones kept for it are below.`
    ) : !picked.shortsOn ? (
      <>{picked.name} is switched off, so it gets no new Shorts. Switch it on in {settings(`/app/settings#channel-${picked.id}`)}.</>
    ) : !unit ? (
      <>{picked.name} gets no new Shorts on {me.plan.name}, which makes them for {many(me.plan.channels)}. See {settings(`/app/settings#channel-${picked.id}`)}.</>
    ) : (
      `${madeOf(unit)} of ${unit.limit} made ${per} for ${picked.name}. ${swipe}`
    )
  ) : !allow.order.length ? (
    <>Shorts are off for every channel. Switch one on in {settings("/app/settings")}.</>
  ) : allow.order.length === 1 ? (
    `${madeOf(allow.account)} of ${allow.account.limit} made ${per}. ${swipe}`
  ) : (
    `${madeOf(allow.account)} of ${allow.account.limit} made ${per}, ${me.plan.shorts.count} for each of your ${allow.order.length} channels. ${swipe}`
  );
  // the channels this view shows, for what they're waiting on
  const mine = (picked ? [picked] : shown).filter(isActive);

  return (
    <>
      <PageHead eyebrow="Shorts" title="Your queue" line={line} />
      {several && <ChannelFilter channels={shown} picked={picked?.id ?? null} path="/app/shorts" />}

      {me.plan.scheduling && !shown.some(isActive) && !tiktokDirect && (
        <p className="mb-6 border-2 border-dashed border-edge-strong px-4 py-3 text-[14px]">
          {configured().youtubeAudited
            ? "Connect YouTube and the Shorts you approve post themselves at the right time."
            : "Connect YouTube so Hookline can check the Shorts you post and read their views."}{" "}
          <Link href="/app/settings" className={linked}>Connect it</Link>
        </p>
      )}
      {mine.filter((c) => c.madeForKids === null).map((c) => (
        <p key={`kids-${c.id}`} className="mb-6 border-2 border-signal px-4 py-3 text-[14px]">
          Say whether {c.name} is made for kids before anything posts to it.{" "}
          <Link href={`/app/settings#audience-${c.id}`} className={linked}>Answer in Settings</Link>
        </p>
      ))}
      {mine.filter((c) => c.status === "expired").map((c) => (
        <p key={`lost-${c.id}`} className="mb-6 border-2 border-signal px-4 py-3 text-[14px]">
          Hookline lost access to {c.name}. <Link href={`/app/settings#audience-${c.id}`} className={linked}>Reconnect it in Settings</Link>{" "}
          {me.plan.scheduling && c.api ? "so its Shorts can post." : "so Hookline can check its Shorts and read their views."}
        </p>
      ))}

      {q.waiting.length ? (
        <SwipeQueue
          items={q.waiting.map((w) => ({
            id: w.id, spec: w.spec, format: formatName(w.spec), title: w.title, description: w.description, why: w.why, suggestedFor: w.suggestedFor?.toISOString() ?? null,
            channel: card(w.channelId),
          }))}
          tag={me.plan.tag}
          tiktok={tiktokDirect}
          paid={me.plan.scheduling}
          several={several}
          hasYouTube={shown.some(isActive)}
          youtubeApi={configured().youtubeAudited}
          creator={tiktokDirect ? tiktokAccount : undefined}
          decide={decide}
          edit={editCopy}
        />
      ) : note ? (
        <Empty
          title="Nothing new to make right now"
          body={note}
          action={<ActionButton action={more} className={button.secondary} busy="Trying…">Try again</ActionButton>}
        />
      ) : picked && !unit ? (
        // a channel that gets no new Shorts says why, and there's nothing to make
        <Empty title={`Nothing waiting for ${picked.name}`} body={line} />
      ) : !allow.order.length ? (
        <Empty title="Shorts are off" body="Switch a channel on in Settings and its Shorts start again." action={{ href: "/app/settings", label: "Open Settings" }} />
      ) : left > 0 ? (
        <Empty
          title={picked ? `Nothing waiting for ${picked.name}` : "Nothing waiting"}
          body={
            picked
              ? `It has ${left} more ${left === 1 ? "Short" : "Shorts"} ${per}.`
              : allow.order.length > 1
                ? `Your channels have ${left} more ${left === 1 ? "Short" : "Shorts"} ${per}.`
                : `You've got ${left} more ${left === 1 ? "Short" : "Shorts"} ${per} on ${me.plan.name}.`
          }
          action={<ActionButton action={more} className={button.primary} busy="Making them…">Make them now</ActionButton>}
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
            <p className="px-5 py-5 text-[14px] text-muted">Shorts you swipe right on show up here while they&rsquo;re made{posts ? " and until they post" : ", ready to download"}.</p>
          ) : (
            <ul className="divide-y-2 divide-edge">
              {q.coming.map((c) => {
                const ch = channelOf(c.channelId);
                const auto = autoOf(c.channelId);
                // a plan wait shows only while the plan still uploads
                const held = heldShown(c.heldBack, uploads.cap);
                const s = statusOf(c, auto, now, held);
                // the creator posts it to YouTube themselves, so its time is the best time to, not when it posts
                const self = !c.youtubeId && !auto;
                // ready and waiting for them to
                const byHand = self && c.hasFile && c.status === "ready";
                return (
                  <li key={c.id} className="flex flex-col gap-3 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/app/shorts/${c.id}`} className="block truncate text-[15px] font-semibold hover:underline">{c.title}</Link>
                        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                          {nameTag(c.channelId)}
                          {formatName(c.spec)}
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
                    {held && (
                      <p className="text-[13px] text-muted">
                        <HeldWords text={HELD[held.on].line(uploads)} until={held.until} />
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
                      {byHand && ch && <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Upload it to {ch.name}</span>}
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
                      {c.status === "failed" && canTryAgain(c.spec, c.hasFile) && <form action={tryAgain}><input type="hidden" name="id" value={c.id} /><button type="submit" className={button.quiet}>Try again</button></form>}
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
                      {nameTag(p.channelId)}
                      {formatName(p)}
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
