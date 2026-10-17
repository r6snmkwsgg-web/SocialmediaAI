import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AutoRefresh, CopyButton } from "@/components/app/client-bits";
import { Icons } from "@/components/app/icons";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, Pill, Stat } from "@/components/app/ui";
import { Phone } from "@/components/phone";
import { EditCopyToggle } from "@/components/shorts/edit-copy";
import { ShortPlayer } from "@/components/shorts/player";
import { PostedForm } from "@/components/shorts/posted";
import { TikTokLater } from "@/components/shorts/tiktok";
import { VsUsual } from "@/components/shorts/vs-usual";
import { uploadsTo } from "@/lib/shorts/channels";
import { formatName } from "@/lib/shorts/formats";
import { canTryAgain } from "@/lib/live/clip-rules";
import { historyOf } from "@/lib/shorts/history";
import { readAfter } from "@/lib/shorts/insights";
import { againstUsual } from "@/lib/shorts/learn";
import { connectAgain, percentOf, readLine, readState, reportedDay, watched } from "@/lib/shorts/proof";
import { seconds } from "@/lib/shorts/timing";
import { markable, STUDIO_UPLOAD, whyFor } from "@/lib/shorts/youtube";
import { HeldWords } from "@/components/shorts/held";
import { uploadCap } from "@/lib/billing/plans";
import { HELD, heldShown, type Held } from "@/lib/shorts/history";
import { account } from "@/lib/server/account";
import { channelsOf, shortsChannelsOf } from "@/lib/server/channels";
import { configured } from "@/lib/server/env";
import { shortOf, type ShortDetail } from "@/lib/server/shorts/library";
import { editCopy, posted, postToTikTok, sendToTikTok, tiktokAccount, tryAgain } from "../actions";

export const metadata: Metadata = { title: "Short" };

const n = (v: number) => v.toLocaleString("en-US");

function stateOf(d: ShortDetail, byHand: boolean, now: Date, held: Held | null): { label: string; tone: "plain" | "good" | "warn" | "signal" } {
  switch (d.status) {
    case "review": return { label: "In your queue", tone: "plain" };
    case "rejected": return { label: "Skipped", tone: "plain" };
    case "posted": return { label: "Posted", tone: "good" };
    case "failed": return { label: "Failed", tone: "signal" };
    // up on YouTube, but only posted once YouTube says so
    case "scheduled": return d.scheduledFor && d.scheduledFor > now ? { label: "Scheduled", tone: "plain" } : { label: "Checking YouTube", tone: "warn" };
    case "ready": return held ? { label: HELD[held.on].pill, tone: "warn" } : { label: byHand ? "Ready for you to post" : "Ready", tone: "plain" };
    default: return { label: "Being made", tone: "warn" };
  }
}

const MARK = { done: "border-signal bg-signal text-ink", next: "border-edge-strong text-muted", bad: "border-signal text-signal" } as const;

const linked = "underline decoration-signal decoration-2 underline-offset-4";

/** YouTube's revenue estimate, in US dollars as YouTube gives it; a sliver of a cent says so rather than $0.00. */
const dollars = (v: number) => (v > 0 && v < 0.005 ? "Under $0.01" : v.toLocaleString("en-US", { style: "currency", currency: "USD" }));

/** Its channel's YouTube Analytics can't be read: not allowed, or access lost. */
const unreadable = (d: ShortDetail) => !!d.channel && d.channel.status !== "revoked" && ["scope", "access"].includes(readState({ ...d.channel, syncedAt: null }));

/**
 * What YouTube Analytics has said about a posted Short, up to the day
 * YouTube has reported: engaged views, plays, how long people watched,
 * and YouTube's revenue estimate where it estimates revenue for the
 * channel. Or why there's nothing: no channel known, one disconnected or
 * one that can't be read (with Google's screen again), or nothing
 * reported yet.
 */
function FromAnalytics({ d, canConnect }: { d: ShortDetail; canConnect: boolean }) {
  const a = d.analytics, ch = d.channel;
  const head = (text: string) => <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{text}</p>;
  // why there's nothing to show, if there isn't
  const why = !d.channelId || !ch
    ? "Hookline doesn't know which of your channels this Short is on, so it can't read its YouTube Analytics."
    : ch.status === "revoked"
      ? `${ch.title} is disconnected, so Hookline can't read its YouTube Analytics.`
      : unreadable(d)
        ? readLine(readState({ ...ch, syncedAt: null }), null)
        : !a
          ? "Engaged views come from YouTube Analytics a few days after a Short goes up."
          : null;
  if (why !== null || !a || !ch) {
    return (
      <div className="border-t-2 border-edge px-5 py-5">
        {head("From YouTube Analytics")}
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          {why} {canConnect && ch && unreadable(d) && <a href={connectAgain(ch.id)} className={`text-fg ${linked}`}>Connect again</a>}
        </p>
      </div>
    );
  }
  // how long, with how much of the Short under it, which passes 100% when people watch it again; left out when YouTube gave neither
  const avg = watched(a.avgSeconds, null) ?? watched(null, a.avgPercent);
  return (
    <div className="border-t-2 border-edge px-5 py-5">
      {head(`From YouTube Analytics, up to ${reportedDay(a.through)}`)}
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        <Stat label="Engaged views" value={n(a.engaged)} />
        <Stat label="Plays" value={n(a.plays)} />
        {avg && <Stat label="Average watched" value={avg} sub={a.avgSeconds !== null && a.avgPercent !== null ? `${watched(null, a.avgPercent)} of the Short` : undefined} />}
        {ch.earns && a.revenue !== null && <Stat label="YouTube's revenue estimate" value={dollars(a.revenue)} sub="In US dollars" />}
      </div>
    </div>
  );
}

export default async function ShortPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await account();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const d = await shortOf(me.id, id);
  if (!d) notFound();

  const [channels, shown] = await Promise.all([channelsOf(me.id), shortsChannelsOf(me.id)]);
  const tiktok = channels.find((c) => c.platform === "tiktok" && c.status === "connected");
  const tiktokDirect = me.plan.scheduling && !!tiktok && configured().tiktokDirect;
  // the YouTube channel it's for, with what to call it, even once that channel is disconnected
  const mine = shown.find((c) => c.id === d.channelId);
  // Hookline uploads to the channel it's for itself; otherwise the creator posts it there, and its time is the best time to
  const auto = uploadsTo(mine, me.plan.scheduling);
  // while it's still to go up, a channel Hookline can't reach says so, and what reaching it again would do
  const away = mine && mine.status !== "connected" && !d.youtubeId && ["review", "approved", "rendering", "ready"].includes(d.status) ? mine : undefined;
  const wouldPost = me.plan.scheduling && !!mine?.api;
  const self = !d.youtubeId && !auto;
  // ready, and waiting for them to post it
  const byHand = self && d.hasFile && d.status === "ready";
  const now = new Date();
  // what it's waiting for: a plan wait shows only while the plan still uploads, and says how many a day for the YouTube channels connected
  const uploads = { name: me.plan.name, cap: uploadCap(me.plan, channels.filter((c) => c.platform === "youtube" && c.status === "connected").length) };
  const held = heldShown(d.heldBack, uploads.cap);
  // an upload that didn't go through, for a reason that passes: it says what went wrong, not that it's waiting, until it goes again
  const unsent = auto && d.status === "ready" && !held ? d.error : null;
  const s = stateOf(d, byHand, now, held);
  const steps = historyOf({
    createdAt: d.createdAt,
    origin: d.origin,
    decidedAt: d.decidedAt,
    status: d.status,
    scheduledFor: d.scheduledFor,
    render: d.render,
    uploadedAt: d.uploadedAt,
    publishAt: d.publishAt,
    youtubeId: d.youtubeId,
    postedAt: d.postedAt,
    tiktokAt: d.tiktok?.at ?? null,
    tiktokPostedAt: d.tiktokPostedAt,
    tiktokError: d.tiktok?.error ?? null,
    error: d.error,
    youtubePrivacy: d.youtubePrivacy,
    verified: d.verified,
    byHand: self,
    heldBack: held,
  });
  const day = d.views["24h"];
  // a first day read late is scaled back to 24 hours, and says it's an estimate; with several channels, it says whose usual.
  // By engaged views once it has its own share and the channel a usual one, as the library and the learning loop go by
  const vs = day !== undefined && d.typical !== null ? againstUsual(day, d.readAt["24h"] ?? 24, d.typical, d.firstShare, d.usualShare) : null;
  const whose = shown.length > 1 && mine ? mine.name : undefined;
  // a posted Short whose link didn't check out, or that isn't public, is never compared, as the notes under its plays say
  const uncounted = d.status === "posted" && !!d.youtubeId && (!d.verified || (!!d.youtubePrivacy && d.youtubePrivacy !== "public"));
  const editable = ["review", "approved", "rendering", "ready"].includes(d.status);
  const chosen = d.status !== "review" && d.status !== "rejected";

  return (
    <>
      <Link href={d.status === "review" ? "/app/shorts" : "/app/shorts/library"} className={`${button.quiet} mb-6`}>
        <Icons.arrow className="h-3.5 w-3.5 rotate-180" /> {d.status === "review" ? "Queue" : "Library"}
      </Link>

      <div className="grid items-start gap-8 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-12">
        <div className="md:sticky md:top-24">
          <Phone className="mx-auto w-full max-w-[340px]">
            <ShortPlayer spec={d.spec} tag={me.plan.tag} />
          </Phone>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {mine && <Pill>{mine.name}</Pill>}
              <Pill>{formatName(d.spec)}</Pill>
              <Pill tone={s.tone}>{s.label}</Pill>
              {d.tiktokPublishId && <Pill>{d.tiktok ? "On TikTok" : "In TikTok drafts"}</Pill>}
              {d.madeForKids && d.status !== "posted" && <Pill>Made for kids</Pill>}
            </div>
            {/* once it's posted, who it was for, as the creator chose, YouTube's verdict, and who watches its channel */}
            {d.status === "posted" && d.madeForKids !== null && <p className="text-[14px]">Made for kids: {d.madeForKids ? "yes" : "no"}, as you chose.</p>}
            {d.youtubeKids && <p className="border-l-4 border-signal pl-3 text-[14px]">YouTube marked this Made for Kids: comments are off.</p>}
            {d.status === "posted" && d.channel?.status === "connected" && d.channel.largest && !unreadable(d) && (
              <p className="text-[13px] leading-relaxed text-muted">
                This channel&rsquo;s biggest group of signed-in viewers: {d.channel.largest.age} ({percentOf(d.channel.largest.percent)}). Nobody under 13 is counted.{" "}
                <Link href={`/app/earnings#channel-${d.channel.id}`} className={`text-fg ${linked}`}>See who&rsquo;s watching</Link>
              </p>
            )}
            <h1 className="text-[26px] font-semibold leading-snug sm:text-[30px]">{d.title}</h1>
            {d.spec.format === "clip" && <p className="-mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Round {d.spec.params.log.round} of your LIVE, <LocalTime iso={new Date(d.spec.params.log.at).toISOString()} /></p>}
            {d.description && <p className="line-clamp-6 whitespace-pre-line text-[14px] leading-relaxed text-muted">{d.description}</p>}
            {editable && <EditCopyToggle id={d.id} title={d.title} description={d.description} edit={editCopy} />}
          </div>

          {chosen && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              {d.youtubeId && (
                <a href={`https://youtube.com/shorts/${d.youtubeId}`} target="_blank" rel="noreferrer" className={button.secondary}>
                  Watch on YouTube <Icons.external className="h-4 w-4" />
                </a>
              )}
              {d.hasFile && <a href={`/api/videos/${d.id}/file?download=1`} className={button.quiet}><Icons.download className="h-3.5 w-3.5" /> Download</a>}
              {d.hasFile && <CopyButton text={`${d.title}\n\n${d.description}`} className={button.quiet} />}
              {byHand && (
                <a href={STUDIO_UPLOAD} target="_blank" rel="noreferrer" className={button.quiet}>
                  Open YouTube Studio <Icons.external className="h-3.5 w-3.5" />
                </a>
              )}
              {d.hasFile && tiktok && !d.tiktokPublishId && !configured().tiktokDirect && (
                d.cleaning ? (
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Making TikTok&rsquo;s copy, without the tag…</span>
                ) : (
                  <form action={sendToTikTok}><input type="hidden" name="id" value={d.id} /><button type="submit" className={button.quiet}>{d.tiktokFile ? "Send to TikTok drafts" : "Get it ready for TikTok"}</button></form>
                )
              )}
              {d.status === "failed" && canTryAgain(d.spec, d.hasFile) && <form action={tryAgain}><input type="hidden" name="id" value={d.id} /><button type="submit" className={button.primary}>Try again</button></form>}
            </div>
          )}

          {away && (
            <p role="status" className="border-2 border-signal px-4 py-3 text-[14px] leading-relaxed">
              {away.status === "revoked" ? (
                wouldPost ? (
                  <>{away.name} is disconnected. Connect it again in <Link href="/app/settings" className={linked}>Settings</Link> and this posts there, or download it and post it yourself.</>
                ) : (
                  <>{away.name} is disconnected. Download it and post it there yourself, or connect it again in <Link href="/app/settings" className={linked}>Settings</Link> so Hookline can check it and read its views.</>
                )
              ) : (
                <>
                  Hookline lost access to {away.name}. Reconnect it in <Link href={`/app/settings#audience-${away.id}`} className={linked}>Settings</Link>{" "}
                  {wouldPost ? "so this can post." : "so Hookline can check it and read its views."}
                </>
              )}
            </p>
          )}

          {held && (
            <p role="status" className="border-2 border-edge-strong bg-card-2 px-4 py-3 text-[14px] leading-relaxed">
              <b className="font-semibold">{HELD[held.on].lead(uploads)}</b> <HeldWords text={HELD[held.on].box(uploads)} until={held.until} />
            </p>
          )}

          {unsent && (
            <div role="status" className="border-2 border-signal px-4 py-3 text-[14px] leading-relaxed">
              <p><b className="font-semibold">The upload didn&rsquo;t go through.</b> Hookline tries again in about half an hour.</p>
              <p className="mt-1 text-[13px] text-signal">{unsent}</p>
            </div>
          )}

          {tiktokDirect && chosen && !d.tiktokPublishId && d.status !== "failed" && (!d.tiktok || d.tiktok.error) && (
            <TikTokLater id={d.id} spec={d.spec} seconds={seconds(d.spec)} tag={false} label={d.tiktok ? "Choose again for TikTok" : "Post to TikTok too"} load={tiktokAccount} choose={postToTikTok} />
          )}

          {markable(d) && <PostedForm id={d.id} posted={posted} size="big" />}
          <AutoRefresh active={d.cleaning} />

          {chosen && (
            <Card>
              {/* each row says whose figures it has: YouTube's plays, Hookline's comparison worked out from them, and YouTube Analytics' own */}
              <CardHead title="Plays and engaged views" />
              <div className="px-5 py-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Plays, from YouTube</p>
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
                  {(["1h", "24h", "72h"] as const).map((k) => (
                    <Stat
                      key={k}
                      label={d.readAt[k] !== undefined ? readAfter(d.readAt[k]!) : k === "1h" ? "After 1 hour" : k === "24h" ? "After 1 day" : "After 3 days"}
                      value={d.views[k] === undefined ? "—" : n(d.views[k]!)}
                    />
                  ))}
                </div>
              </div>
              {(vs !== null || !uncounted) && <VsUsual vs={vs} typical={d.typical} waiting={d.waiting} channel={whose} />}
              {/* YouTube Analytics reads posted Shorts whose link checked out, whoever can see them */}
              {d.status === "posted" && d.youtubeId && d.verified && <FromAnalytics d={d} canConnect={configured().youtube} />}
              {d.status === "posted" && d.verified && d.analytics && d.channel && d.channel.status !== "revoked" && !unreadable(d) && (
                <p className="border-t-2 border-edge px-5 py-3 text-[13px] leading-relaxed text-muted">
                  Plays are what YouTube now shows as views: every time the Short starts. Engaged views leave out the ones swiped past, and are what YouTube counts for the Partner Program.
                  {d.analytics.avgPercent !== null && " Average watched can pass 100% when people watch a Short more than once."}
                </p>
              )}
              {!d.youtubeId && (
                <p className="border-t-2 border-edge px-5 py-3 text-[13px] text-muted">
                  Plays are read from YouTube at 1 hour, 1 day and 3 days after it posts there. Engaged views come from YouTube Analytics a few days after that.
                </p>
              )}
              {d.youtubeId && d.status === "posted" && !d.verified && (
                <p className="border-t-2 border-edge px-5 py-3 text-[13px] text-muted">Its link couldn&rsquo;t be checked with YouTube, so its plays and engaged views aren&rsquo;t read or counted.</p>
              )}
              {d.youtubeId && d.status === "posted" && d.verified && d.youtubePrivacy && d.youtubePrivacy !== "public" && (
                <p className="border-t-2 border-edge px-5 py-3 text-[13px] text-muted">It&rsquo;s {d.youtubePrivacy} on YouTube, so its plays aren&rsquo;t read at 1 hour, 1 day and 3 days, or compared with your public Shorts.</p>
              )}
            </Card>
          )}

          <Card>
            <CardHead title="What's happened" />
            <ol className="flex flex-col px-5 py-4">
              {steps.map((st, i) => (
                <li key={i} className="relative flex gap-3.5 pb-5 last:pb-0">
                  {i < steps.length - 1 && <span className="absolute bottom-0 left-[11px] top-6 w-[2px] bg-edge" aria-hidden="true" />}
                  <span className={`relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border-2 ${MARK[st.tone]}`} aria-hidden="true">
                    {st.tone === "done" ? <Icons.check className="h-3.5 w-3.5" /> : st.tone === "bad" ? <Icons.alert className="h-3.5 w-3.5" /> : null}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-[15px] font-medium ${st.tone === "next" ? "text-muted" : ""}`}>
                      {st.title}
                      {st.at && <> · <span className="font-normal text-muted"><LocalTime iso={st.at.toISOString()} /></span></>}
                    </p>
                    {st.body && <p className="mt-0.5 text-[13px] text-signal">{st.body}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {d.why.length > 0 && (
            <Card>
              <CardHead title="Why this one" />
              <ul className="flex flex-col gap-2 px-5 py-4 text-[14px] leading-snug">
                {whyFor(d.why, auto).map((w) => (
                  <li key={w} className="flex gap-2.5">
                    <Icons.check className="mt-[3px] h-4 w-4 shrink-0 text-signal" />
                    {w}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
