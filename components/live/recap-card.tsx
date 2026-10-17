"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { button } from "@/components/app/ui";
import { drawRecap, RECAP, recapWords, type RecapData } from "./draw/recap";

type Props = {
  /** everything on the card but the day, which is the LIVE's date where the streamer is */
  data: Omit<RecapData, "day">;
  /** when the LIVE started */
  startedAt: string;
  /** the free plan's MADE WITH HOOKLINE */
  tag: boolean;
  /** whether the game hides viewers' names now, which the card starts from */
  hideNames: boolean;
};

/** A date as the file name has it, in the streamer's own timezone: 2026-10-16. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A LIVE's recap card, drawn here in the browser at a TikTok photo's size,
 * with a switch to hide the supporters' names and a button that saves it
 * as a picture to post.
 */
export function RecapCard({ data, startedAt, tag, hideNames: hiddenInGame }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hideNames, setHideNames] = useState(hiddenInGame);
  // the card's font is ready, or couldn't be had and the browser's own will do
  const [font, setFont] = useState(false);
  // the day as the streamer's device writes it, since the server doesn't know their timezone
  const [day, setDay] = useState<{ line: string; file: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const card = useMemo(() => (day ? { ...data, day: day.line } : null), [data, day]);

  // the app's own Anton has another name, so the card registers it as the games do
  useEffect(() => {
    let gone = false;
    const f = new FontFace("Anton", "url(/fonts/Anton-Regular.woff2)");
    f.load()
      .then((loaded) => document.fonts.add(loaded))
      .catch(() => {})
      .finally(() => {
        if (!gone) setFont(true);
      });
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    const d = new Date(startedAt);
    setDay({ line: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }), file: ymd(d) });
  }, [startedAt]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx && font && card) drawRecap(ctx, card, { hideNames, tag });
  }, [card, font, hideNames, tag]);

  const download = () => {
    setFailed(false);
    const c = canvas.current;
    if (!c || !day) return setFailed(true);
    c.toBlob((blob) => {
      if (!blob) return setFailed(true);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `live-recap-${day.file}.png`;
      a.click();
      // long enough for the download to start
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, "image/png");
  };

  return (
    <div className="flex flex-col gap-4">
      <canvas
        ref={canvas}
        width={RECAP.w}
        height={RECAP.h}
        role="img"
        aria-label={card ? recapWords(card, hideNames) : "Your LIVE recap card"}
        className="block aspect-[9/16] w-full max-w-[360px] border-2 border-edge bg-ink"
      />
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={hideNames} onChange={(e) => setHideNames(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-signal)]" />
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px]">Hide names</span>
          <span className="text-[13px] text-muted">Your supporters show as initials, like K.S.</span>
        </span>
      </label>
      <button type="button" onClick={download} disabled={!font || !day} className={`${button.primary} w-fit`}>
        Download card
      </button>
      {failed && <p role="alert" className="text-[14px] text-signal">Couldn&rsquo;t make the picture. Try again.</p>}
      <p className="text-[12px] leading-relaxed text-muted">A PNG at 1080 × 1920, the size of a TikTok photo or a story.</p>
    </div>
  );
}
