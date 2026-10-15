"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { H, W } from "@/remotion/shorts/kit";
import { ShortVideo } from "@/remotion/shorts/Short";
import { soundFor, wav } from "@/lib/shorts/sound";
import { FPS, frames } from "@/lib/shorts/timing";
import type { Spec } from "@/lib/shorts/types";

/**
 * Any Short, playing in the page: the same drawing the renderer uses, so
 * what someone approves is exactly what gets posted. It starts muted; the
 * speaker makes the soundtrack and turns it on.
 */
export function ShortPlayer({ spec, tag, autoPlay = true, className = "" }: { spec: Spec; tag: boolean; autoPlay?: boolean; className?: string }) {
  const ref = useRef<PlayerRef>(null);
  const duration = useMemo(() => frames(spec), [spec]);
  const [sound, setSound] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);

  // a new Short starts from the top, muted, with its own soundtrack made on demand
  useEffect(() => {
    setMuted(true);
    setSound(null);
    ref.current?.seekTo(0);
    if (autoPlay) ref.current?.play();
  }, [spec, autoPlay]);
  useEffect(() => () => {
    if (sound) URL.revokeObjectURL(sound);
  }, [sound]);

  const toggle = () => {
    const p = ref.current;
    if (!p) return;
    if (muted) {
      if (!sound) setSound(URL.createObjectURL(new Blob([wav(soundFor(spec))], { type: "audio/wav" })));
      p.unmute();
      p.play();
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  };

  return (
    <div className={className}>
      <Player
        ref={ref}
        component={ShortVideo}
        inputProps={{ spec, tag, soundUrl: sound }}
        durationInFrames={duration}
        compositionWidth={W}
        compositionHeight={H}
        fps={FPS}
        loop
        autoPlay={autoPlay}
        initiallyMuted
        clickToPlay
        acknowledgeRemotionLicense
        style={{ width: "100%", aspectRatio: "9 / 16", display: "block" }}
      />
      <div className="flex h-9 items-center justify-between bg-ink px-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={muted ? "Turn the sound on" : "Turn the sound off"}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-paper/80 transition hover:text-paper"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
            {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M17 8a5 5 0 0 1 0 8M19.5 5.5a9 9 0 0 1 0 13" />}
          </svg>
          {muted ? "Tap for sound" : "Sound on"}
        </button>
        <span className="font-mono text-[9px] uppercase tracking-wider text-dim">{Math.round(duration / FPS)}s · drawn live</span>
      </div>
    </div>
  );
}
