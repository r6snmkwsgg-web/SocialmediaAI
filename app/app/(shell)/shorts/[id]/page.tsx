import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CopyButton } from "@/components/app/client-bits";
import { Icons } from "@/components/app/icons";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, Pill, Stat } from "@/components/app/ui";
import { Phone } from "@/components/phone";
import { EditCopyToggle } from "@/components/shorts/edit-copy";
import { ShortPlayer } from "@/components/shorts/player";
import { TikTokLater } from "@/components/shorts/tiktok";
import { FORMATS } from "@/lib/shorts/formats";
import { historyOf } from "@/lib/shorts/history";
import { times } from "@/lib/shorts/insights";
import { lift } from "@/lib/shorts/learn";
import { seconds } from "@/lib/shorts/timing";
import { account } from "@/lib/server/account";
import { channelsOf } from "@/lib/server/channels";
import { configured } from "@/lib/server/env";
import { shortOf, type ShortDetail } from "@/lib/server/shorts/library";
import { editCopy, posted, postToTikTok, sendToTikTok, tiktokAccount, tryAgain } from "../actions";

export const metadata: Metadata = { title: "Short" };

const n = (v: number) => v.toLocaleString("en-US");

function stateOf(d: ShortDetail): { label: string; tone: "plain" | "good" | "warn" | "signal" } {
  switch (d.status) {
    case "review": return { label: "In your queue", tone: "plain" };
    case "rejected": return { label: "Skipped", tone: "plain" };
    case "posted": return { label: "Posted", tone: "good" };
    case "failed": return { label: "Failed", tone: "signal" };
    case "scheduled": return { label: "Scheduled", tone: "plain" };
    case "ready": return { label: "Ready", tone: "plain" };
    default: return { label: "Being made", tone: "warn" };
  }
}

const MARK = { done: "border-signal bg-signal text-ink", next: "border-edge-strong text-muted", bad: "border-signal text-signal" } as const;

export default async function ShortPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await account();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const d = await shortOf(me.id, id);
  if (!d) notFound();

  const channels = await channelsOf(me.id);
  const tiktok = channels.find((c) => c.platform === "tiktok" && c.status === "connected");
  const tiktokDirect = me.plan.scheduling && !!tiktok && configured().tiktokDirect;
  const s = stateOf(d);
  const steps = historyOf({
    createdAt: d.createdAt,
    origin: d.origin,
    decidedAt: d.decidedAt,
    status: d.status,
    scheduledFor: d.scheduledFor,
    render: d.render,
    uploadedAt: d.uploadedAt,
    youtubeId: d.youtubeId,
    postedAt: d.postedAt,
    tiktokAt: d.tiktok?.at ?? null,
    tiktokPostedAt: d.tiktokPostedAt,
    tiktokError: d.tiktok?.error ?? null,
    error: d.error,
  });
  const day = d.views["24h"];
  const vs = day !== undefined && d.typical !== null ? lift(day, d.typical) : null;
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
              <Pill>{FORMATS[d.spec.format].name}</Pill>
              <Pill tone={s.tone}>{s.label}</Pill>
              {d.tiktokPublishId && <Pill>{d.tiktok ? "On TikTok" : "In TikTok drafts"}</Pill>}
            </div>
            <h1 className="text-[26px] font-semibold leading-snug sm:text-[30px]">{d.title}</h1>
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
              {d.hasFile && tiktok && !d.tiktokPublishId && !configured().tiktokDirect && (
                <form action={sendToTikTok}><input type="hidden" name="id" value={d.id} /><button type="submit" className={button.quiet}>Send to TikTok drafts</button></form>
              )}
              {d.status === "failed" && <form action={tryAgain}><input type="hidden" name="id" value={d.id} /><button type="submit" className={button.primary}>Try again</button></form>}
            </div>
          )}

          {tiktokDirect && chosen && !d.tiktokPublishId && d.status !== "failed" && (!d.tiktok || d.tiktok.error) && (
            <TikTokLater id={d.id} spec={d.spec} seconds={seconds(d.spec)} tag={me.plan.tag} label={d.tiktok ? "Choose again for TikTok" : "Post to TikTok too"} load={tiktokAccount} choose={postToTikTok} />
          )}

          {d.hasFile && !d.youtubeId && (d.status === "ready" || d.status === "scheduled") && (
            <form action={posted} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={d.id} />
              <label className="sr-only" htmlFor="link">YouTube link, if you posted it there</label>
              <input id="link" name="link" placeholder="YouTube link, to track its views (optional)" className="min-w-0 flex-1 border-2 border-edge-strong bg-surface px-3 py-2 text-[14px] focus:border-fg focus:outline-none" />
              <button type="submit" className={button.secondary}>I posted it</button>
            </form>
          )}

          {chosen && (
            <Card>
              <CardHead title="Views" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">From YouTube</span>} />
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-5 py-5 sm:grid-cols-4">
                {(["1h", "24h", "72h"] as const).map((k) => (
                  <Stat key={k} label={k === "1h" ? "After 1 hour" : k === "24h" ? "After 1 day" : "After 3 days"} value={d.views[k] === undefined ? "—" : n(d.views[k]!)} />
                ))}
                <Stat
                  label="Vs your usual"
                  value={vs === null ? "—" : times(vs)}
                  sub={vs !== null ? "Its first day" : d.typical === null ? "Needs 3 Shorts' first days" : "After its first day"}
                />
              </div>
              {!d.youtubeId && <p className="border-t-2 border-edge px-5 py-3 text-[13px] text-muted">Views are read from YouTube at 1 hour, 1 day and 3 days after it posts there.</p>}
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
                {d.why.map((w) => (
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
