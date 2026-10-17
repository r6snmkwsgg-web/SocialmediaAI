"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Phone } from "@/components/phone";
import { Icons } from "@/components/app/icons";
import { LocalTime } from "@/components/app/local-time";
import { button, Pill } from "@/components/app/ui";
import type { TikTokChoices } from "@/lib/shorts/tiktok";
import { seconds } from "@/lib/shorts/timing";
import type { Spec } from "@/lib/shorts/types";
import { keptNote, whyFor, withAudience, type Keeping } from "@/lib/shorts/youtube";
import { toast } from "@/components/app/toast";
import { ShortPlayer } from "./player";
import { EditCopy } from "./edit-copy";
import { TikTokChoicesForm, type CreatorResult } from "./tiktok";

/**
 * The YouTube channel a Short is for: what to call it, whether it's
 * connected or needs reconnecting, whether Hookline uploads to it itself
 * now (`auto`) or would once it's connected (`api`), its answer to "made
 * for kids?", and whether YouTube has set the whole channel as made for kids.
 */
export type CardChannel = { name: string; connected: boolean; expired: boolean; auto: boolean; api: boolean; kids: boolean | null; youtubeKids: boolean | null };

export type QueueCard = { id: string; spec: Spec; format: string; title: string; description: string; why: string[]; suggestedFor: string | null; channel: CardChannel | null };

type Props = {
  items: QueueCard[];
  tag: boolean;
  /** a yes posts it to TikTok too, at its time, once TikTok's questions are answered */
  tiktok?: boolean;
  /** on a plan that posts for you, waiting only for an account to post to */
  paid?: boolean;
  /** the account has more than one channel, so each card says which it's for */
  several?: boolean;
  /** the account has a YouTube channel, so a Short without one was made before it had */
  hasYouTube?: boolean;
  /** Hookline posts to YouTube for everyone (YouTube's audit has passed) */
  youtubeApi?: boolean;
  /** set when approved Shorts also go straight to TikTok: asks TikTok about the account */
  creator?: () => Promise<CreatorResult>;
  decide: (id: string, yes: boolean, tiktok?: TikTokChoices | null, kids?: boolean | null) => Promise<{ ok: boolean; replaced?: boolean; at?: string | null; how?: Keeping; channel?: string }>;
  edit: (id: string, title: string, description: string) => Promise<{ ok: boolean; message?: string }>;
};

/**
 * The swipe queue: one Short at a time in a phone, playing. Right (or →)
 * to post it, left (or ←) for a different one. The title can be changed
 * before it goes, and so can who it's for: its channel's answer to "made
 * for kids?" unless the creator says otherwise for this one. When it's
 * going to TikTok too, a yes first asks TikTok's questions for that
 * Short, next to the Short itself. Each card goes by its own channel: it
 * only says a Short posts where Hookline will post it.
 */
export function SwipeQueue({ items, tag, tiktok = false, paid = false, several = false, hasYouTube = false, youtubeApi = false, creator, decide, edit }: Props) {
  const router = useRouter();
  const [list, setList] = useState(items);
  const [dx, setDx] = useState(0);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const cur = list[0];
  const youtube = cur?.channel ?? null;
  // made for kids, for this Short: starts as its channel's answer
  const channelKids = youtube?.kids ?? false;
  const [kids, setKids] = useState(channelKids);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);

  useEffect(() => setList(items), [items]);
  useEffect(() => {
    setEditing(false);
    setAsking(false);
    setKids(channelKids);
  }, [cur?.id, channelKids]);

  const finish = useCallback(
    (yes: boolean, tiktok: TikTokChoices | null = null) => {
      if (!cur) return;
      const id = cur.id;
      setList((l) => l.filter((x) => x.id !== id));
      setDx(0);
      // only a choice that differs from the channel's answer goes with it
      const audience = yes && kids !== channelKids ? kids : null;
      start(async () => {
        const r = await decide(id, yes, tiktok, audience);
        if (!r.ok) toast("That didn't save. Try again.", "bad");
        else if (!yes) toast(r.replaced ? "Skipped. A different one is on its way." : "Skipped.");
        else toast(keptNote(r.how ?? "self", r.at ? new Date(r.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : null, r.channel), "good");
        router.refresh();
      });
    },
    [cur, decide, router, kids, channelKids],
  );

  const go = useCallback(
    (yes: boolean) => {
      if (yes && creator) {
        setDx(0);
        setAsking(true);
      } else finish(yes);
    },
    [creator, finish],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (asking) {
        if (e.key === "Escape") setAsking(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (editing || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))) return;
      if (e.key === "ArrowRight") go(true);
      else if (e.key === "ArrowLeft") go(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go, editing, asking]);

  // YouTube has the whole channel as made for kids: comments are off whatever's ticked
  const channelLocked = youtube?.youtubeKids === true;
  // the preview ends the way the video will, for who it's for
  const preview = useMemo(() => (cur ? withAudience(cur.spec, kids || channelLocked) : null), [cur, kids, channelLocked]);
  // its time is when it posts only where Hookline posts it (its channel, or TikTok for one with no channel); otherwise it's the best time to post it
  const autoPost = youtube ? youtube.auto : tiktok;
  // a yes posts it: to its channel, or to TikTok with the creator's choices
  const posts = tiktok || autoPost;
  const why = useMemo(() => (cur ? whyFor(cur.why, autoPost) : []), [cur, autoPost]);
  // what to call its channel: by name when there are several
  const who = youtube && several ? youtube.name : "your channel";

  if (!cur || !preview) return null;

  // which channel it's for, where that's worth saying: there are several, or it isn't connected
  const forLine = youtube && (several || !youtube.connected) && (
    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">For {youtube.name}</p>
  );

  const onDown = (e: React.PointerEvent) => {
    if (asking) return;
    drag.current = { x: e.clientX, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const d = e.clientX - drag.current.x;
    if (Math.abs(d) > 8) drag.current.moved = true;
    if (drag.current.moved) setDx(d);
  };
  const onUp = () => {
    if (!drag.current) return;
    if (dx > 110) go(true);
    else if (dx < -110) go(false);
    else setDx(0);
    drag.current = { x: 0, moved: drag.current.moved };
    setTimeout(() => (drag.current = null), 0);
  };

  return (
    <div className="grid items-start gap-8 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-12">
      <div
        className="relative mx-auto w-full max-w-[340px] touch-pan-y select-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        style={{ transform: `translateX(${dx}px) rotate(${dx / 24}deg)`, transition: drag.current?.moved ? "none" : "transform 160ms ease" }}
      >
        <Phone>
          <ShortPlayer key={cur.id} spec={preview} tag={tag} />
        </Phone>
        {Math.abs(dx) > 40 && (
          <span className={`pointer-events-none absolute top-14 border-4 px-3 py-1 font-display text-3xl uppercase tracking-wider ${dx > 0 ? "right-6 rotate-12 border-[#34c759] text-[#34c759]" : "left-6 -rotate-12 border-signal text-signal"}`}>
            {dx > 0 ? (posts ? "Post" : "Keep") : "Skip"}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Pill>{cur.format}</Pill>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            {list.length} waiting{pending ? " · saving…" : ""}
          </span>
        </div>

        {asking && creator ? (
          <>
            <div className="flex flex-col gap-1.5">
              {forLine}
              <h2 className="text-[22px] font-semibold leading-snug sm:text-2xl">{cur.title}</h2>
              {cur.suggestedFor && (
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                  Posts <LocalTime iso={cur.suggestedFor} />
                </p>
              )}
            </div>
            <TikTokChoicesForm
              key={cur.id}
              seconds={seconds(cur.spec)}
              load={creator}
              postLabel="Post it"
              onPost={(c) => finish(true, c)}
              onSkip={() => finish(true)}
              onBack={() => setAsking(false)}
            />
          </>
        ) : editing ? (
          <EditCopy id={cur.id} title={cur.title} description={cur.description} onDone={() => setEditing(false)} edit={edit} />
        ) : (
          <div className="flex flex-col gap-2">
            {forLine}
            <h2 className="text-[22px] font-semibold leading-snug sm:text-2xl">{cur.title}</h2>
            <p className="line-clamp-3 whitespace-pre-line text-[14px] leading-relaxed text-muted">{cur.description}</p>
            <button type="button" onClick={() => setEditing(true)} className={`${button.quiet} self-start`}>
              Edit the title
            </button>
          </div>
        )}

        {!asking && (
          <>
            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Why this one</p>
              <ul className="flex flex-col gap-2 text-[14px] leading-snug">
                {why.map((w) => (
                  <li key={w} className="flex gap-2.5">
                    <Icons.check className="mt-[3px] h-4 w-4 shrink-0 text-signal" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>

            <label className="flex items-start gap-2.5 text-[14px] leading-snug">
              <input type="checkbox" checked={kids} onChange={(e) => setKids(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-signal)]" />
              <span>
                Made for kids
                <span className="block text-[13px] text-muted">
                  {youtube?.kids === null || !youtube ? "YouTube needs you to say. " : kids === channelKids ? (several ? "The channel's answer. " : "Your channel's answer. ") : "Just for this one. "}
                  {channelLocked
                    ? `YouTube marked ${who} Made for Kids: comments are off, so it ends without asking for them.`
                    : "Made for kids turns comments off, so it ends without asking for them."}
                </span>
              </span>
            </label>

            <p className="border-l-4 border-signal pl-3 text-[14px]">
              {autoPost ? (
                cur.suggestedFor ? (
                  <>Swipe right and it posts <b><LocalTime iso={cur.suggestedFor} /></b>. Nothing posts without your yes.</>
                ) : (
                  "Swipe right and it posts at your next free time. Nothing posts without your yes."
                )
              ) : youtube && !youtube.connected && !youtube.expired ? (
                `${youtube.name} is disconnected. Swipe right and it's made into a video you post yourself${youtube.api ? ", or connect the channel again and it posts there" : ""}.`
              ) : youtube?.expired ? (
                youtube.api
                  ? `Hookline lost access to ${youtube.name}. Swipe right and it waits until you reconnect it, or you post it yourself.`
                  : `Hookline lost access to ${youtube.name}. Swipe right and it's made into a video you post yourself. Reconnect it in Settings so Hookline can check it.`
              ) : paid && youtube ? (
                cur.suggestedFor ? (
                  <>Swipe right and it&rsquo;s made into a video for you to post on YouTube, best <b><LocalTime iso={cur.suggestedFor} /></b>. Until YouTube finishes reviewing Hookline, you post it yourself.</>
                ) : (
                  "Swipe right and it's made into a video for you to post on YouTube. Until YouTube finishes reviewing Hookline, you post it yourself."
                )
              ) : paid ? (
                youtubeApi && !hasYouTube ? "Swipe right and it's made into a video. Connect YouTube and the ones you keep post themselves." : "Swipe right and it's made into a video you post yourself."
              ) : (
                `Swipe right and it's made into a video you download and post yourself.${youtubeApi ? " Pro posts it for you." : ""}`
              )}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => go(false)} className={button.secondary} aria-label="Skip this one and get a different Short">
                <span aria-hidden="true">←</span> Something else
              </button>
              <button type="button" onClick={() => go(true)} className={button.primary}>
                {posts ? "Post it" : "Keep it"} <span aria-hidden="true">→</span>
              </button>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-muted sm:inline">or ← → on your keyboard</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
