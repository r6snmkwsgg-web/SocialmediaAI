"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { BattleVideo, H, W } from "@/remotion/Battle";
import { FPS, simulate, type Battle } from "@/lib/battle/sim";
import { timeline } from "@/lib/battle/timeline";
import { soundtrack, wav } from "@/lib/battle/sound";
import type { AbilityId } from "@/lib/battle/abilities";

/**
 * A ball battle playing live in the page: the same simulation and drawing
 * the renderer uses, so what you see here is exactly the video it would
 * post. It plays muted while it's on screen and stops when it isn't; tap
 * the speaker and it makes the soundtrack and plays it.
 */
export function BattlePlayer({ a, b, seed, battle: given, className = "", priority = false }: {
  a: AbilityId;
  b: AbilityId;
  seed: number;
  /** a fight already worked out, from the picker */
  battle?: Battle;
  className?: string;
  /** start straight away rather than when scrolled to */
  priority?: boolean;
}) {
  const ref = useRef<PlayerRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const battle = useMemo(() => given ?? simulate(a, b, seed), [given, a, b, seed]);
  const duration = useMemo(() => timeline(battle).duration, [battle]);
  const [sound, setSound] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);

  // a new fight starts muted again, with its own soundtrack made on demand
  useEffect(() => {
    setMuted(true);
    setSound(null);
    ref.current?.seekTo(0);
  }, [battle]);
  useEffect(() => () => {
    if (sound) URL.revokeObjectURL(sound);
  }, [sound]);

  // only play while it's on screen
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) ref.current?.play();
      else ref.current?.pause();
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [battle]);

  const toggle = () => {
    const p = ref.current;
    if (!p) return;
    if (muted) {
      if (!sound) setSound(URL.createObjectURL(new Blob([wav(soundtrack(battle, timeline(battle)))], { type: "audio/wav" })));
      p.unmute();
      p.play();
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  };

  return (
    <div ref={box} className={className}>
      <Player
        ref={ref}
        component={BattleVideo}
        inputProps={{ a, b, seed: battle.seed, tag: true, battle, soundUrl: sound }}
        durationInFrames={duration}
        compositionWidth={W}
        compositionHeight={H}
        fps={FPS}
        loop
        autoPlay={priority}
        initiallyMuted
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
        <span className="font-mono text-[9px] uppercase tracking-wider text-dim">Drawn live</span>
      </div>
    </div>
  );
}
