"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Phone } from "@/components/phone";
import { Icons } from "@/components/app/icons";
import { LocalTime } from "@/components/app/local-time";
import { button, Pill } from "@/components/app/ui";
import type { TikTokChoices } from "@/lib/shorts/tiktok";
import { seconds } from "@/lib/shorts/timing";
import type { Spec } from "@/lib/shorts/types";
import { ShortPlayer } from "./player";
import { TikTokChoicesForm, type CreatorResult } from "./tiktok";

export type QueueCard = { id: string; spec: Spec; format: string; title: string; description: string; why: string[]; suggestedFor: string | null };

type Props = {
  items: QueueCard[];
  tag: boolean;
  /** the plan posts for you at the suggested time */
  schedules: boolean;
  /** set when approved Shorts also go straight to TikTok: asks TikTok about the account */
  creator?: () => Promise<CreatorResult>;
  decide: (id: string, yes: boolean, tiktok?: TikTokChoices | null) => Promise<{ ok: boolean; replaced?: boolean }>;
  edit: (id: string, title: string, description: string) => Promise<{ ok: boolean; message?: string }>;
};

/**
 * The swipe queue: one Short at a time in a phone, playing. Right (or →)
 * to post it, left (or ←) for a different one. The title can be changed
 * before it goes. When it's going to TikTok too, a yes first asks
 * TikTok's questions for that Short, next to the Short itself.
 */
export function SwipeQueue({ items, tag, schedules, creator, decide, edit }: Props) {
  const router = useRouter();
  const [list, setList] = useState(items);
  const [dx, setDx] = useState(0);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const cur = list[0];

  useEffect(() => setList(items), [items]);
  useEffect(() => {
    setEditing(false);
    setAsking(false);
  }, [cur?.id]);

  const finish = useCallback(
    (yes: boolean, tiktok: TikTokChoices | null = null) => {
      if (!cur) return;
      const id = cur.id;
      setList((l) => l.filter((x) => x.id !== id));
      setDx(0);
      start(async () => {
        await decide(id, yes, tiktok);
        router.refresh();
      });
    },
    [cur, decide, router],
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

  if (!cur) return null;

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
          <ShortPlayer key={cur.id} spec={cur.spec} tag={tag} />
        </Phone>
        {Math.abs(dx) > 40 && (
          <span className={`pointer-events-none absolute top-14 border-4 px-3 py-1 font-display text-3xl uppercase tracking-wider ${dx > 0 ? "right-6 rotate-12 border-[#34c759] text-[#34c759]" : "left-6 -rotate-12 border-signal text-signal"}`}>
            {dx > 0 ? (schedules ? "Post" : "Keep") : "Skip"}
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
          <EditCopy card={cur} onDone={() => setEditing(false)} edit={edit} />
        ) : (
          <div className="flex flex-col gap-2">
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
                {cur.why.map((w) => (
                  <li key={w} className="flex gap-2.5">
                    <Icons.check className="mt-[3px] h-4 w-4 shrink-0 text-signal" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>

            <p className="border-l-4 border-signal pl-3 text-[14px]">
              {schedules ? (
                cur.suggestedFor ? (
                  <>Swipe right and it posts <b><LocalTime iso={cur.suggestedFor} /></b>. Nothing posts without your yes.</>
                ) : (
                  "Swipe right and it posts at your next free time. Nothing posts without your yes."
                )
              ) : (
                "Swipe right and it's made into a video you download and post yourself. Pro posts it for you."
              )}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => go(false)} className={button.secondary} aria-label="Skip this one and get a different Short">
                <span aria-hidden="true">←</span> Something else
              </button>
              <button type="button" onClick={() => go(true)} className={button.primary}>
                {schedules ? "Post it" : "Keep it"} <span aria-hidden="true">→</span>
              </button>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-muted sm:inline">or ← → on your keyboard</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EditCopy({ card, onDone, edit }: { card: QueueCard; onDone: () => void; edit: Props["edit"] }) {
  const router = useRouter();
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = "w-full border-2 border-edge-strong bg-surface px-3 py-2 text-[15px] text-fg focus:border-fg focus:outline-none";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await edit(card.id, title, description);
          if (!r.ok) setMsg(r.message ?? "That didn't save.");
          else {
            onDone();
            router.refresh();
          }
        });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Title ({title.length}/100)</span>
        <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} className={field} autoFocus />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={field} />
      </label>
      {msg && <p role="alert" className="text-[13px] text-signal">{msg}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={button.secondary}>{pending ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onDone} className={button.quiet}>Cancel</button>
      </div>
    </form>
  );
}
