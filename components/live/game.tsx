"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { rng } from "@/lib/battle/sim";
import { demoTick, demoViewer } from "@/lib/live/demo";
import type { LiveEvent, Viewer } from "@/lib/live/events";
import type { LiveSettings } from "@/lib/live/settings";
import { LETTERS, LIKES_PER_HP, Show } from "@/lib/live/show";
import { draw, H, W } from "./draw/frame";
import { LiveSound } from "./sound";
import { LiveSource, SOURCES, type SourceId, type SourceState } from "./source";

type Props = {
  /** where the live's events come from; none means only the test panel and demo */
  src: SourceId | "none";
  /** a custom WebSocket address, instead of the source's usual one */
  url?: string;
  demo: boolean;
  /** hide the hints around the canvas, for capturing it */
  clean: boolean;
  /** the streamer's settings, or the defaults */
  settings?: Partial<LiveSettings>;
  /** the free plan's "made with Hookline" line */
  tag?: boolean;
  /** something the streamer needs to fix, shown at the top of the game */
  notice?: string;
  /** reports the session's numbers now and then, for the streamer's stats */
  onStats?: (show: Show, final: boolean) => void;
};

const TESTERS: [Viewer, Viewer] = [
  { id: "test-1", name: "tester one", pretend: true },
  { id: "test-2", name: "tester two", pretend: true },
];

/** Pictures of viewers, loaded once each, for drawing on balls and in the lists. */
function useImages() {
  const cache = useRef(new Map<string, HTMLImageElement | "loading" | "error">());
  return useCallback((url: string): HTMLImageElement | null => {
    const got = cache.current.get(url);
    if (got && got !== "loading" && got !== "error") return got;
    if (!got) {
      cache.current.set(url, "loading");
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => cache.current.set(url, img);
      img.onerror = () => cache.current.set(url, "error");
      img.src = url;
    }
    return null;
  }, []);
}

/**
 * The live game on a canvas, for the streamer to put on their stream. It
 * runs the game in real time, listens to TikFinity or the bridge, and has
 * a test panel (press T) for trying every gift without spending a coin.
 */
export function LiveGame({ src, url, demo: demoAtStart, clean, settings, tag = false, notice, onStats }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const show = useRef<Show | null>(null);
  const sound = useRef<LiveSound | null>(null);
  const demo = useRef(demoAtStart);
  const image = useImages();
  const [panel, setPanel] = useState(false);
  const [demoOn, setDemoOn] = useState(demoAtStart);
  const [state, setState] = useState<SourceState>("closed");
  const [soundOn, setSoundOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [, redraw] = useState(0);
  const stateRef = useRef<SourceState>("closed");
  const stats = useRef(onStats);
  stats.current = onStats;

  if (!show.current) show.current = new Show({ settings });
  if (!sound.current) {
    sound.current = new LiveSound();
    sound.current.setVolume(show.current.settings.volume);
  }
  const s0 = show.current;

  // in development, the show is reachable from the console and from tests
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __show?: Show }).__show = show.current!;
  }, []);

  const handle = useCallback((e: LiveEvent) => show.current?.handle(e), []);

  // listen to the live
  useEffect(() => {
    if (src === "none") return;
    const s = new LiveSource(url || SOURCES[src].url, handle, (st) => {
      stateRef.current = st;
      setState(st);
    });
    s.start();
    return () => s.stop();
  }, [src, url, handle]);

  // the session's numbers, every half minute and when the page closes
  useEffect(() => {
    const send = (final: boolean) => {
      if (show.current && stats.current) stats.current(show.current, final);
    };
    const every = setInterval(() => send(false), 30_000);
    const bye = () => send(true);
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(every);
      window.removeEventListener("pagehide", bye);
    };
  }, []);

  // the loop: run the show, play its sounds, draw it
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const s = show.current!;
    const snd = sound.current!;
    const rand = rng(Date.now() % 100_000);
    let round = -1;
    let seen = 0;
    let cues = s.cueCount;
    let last = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (demo.current) for (const e of demoTick(dt, rand, s.game.teams, s.phase === "win" && !!s.vote)) s.handle(e);
      s.update(dt);
      // sounds for whatever happened since the last frame
      if (s.round !== round) {
        round = s.round;
        seen = 0;
      }
      const evs = s.game.events;
      if (evs.length < seen) seen = 0;
      if (evs.length > seen) snd.battle(evs.slice(seen));
      seen = evs.length;
      const fresh = Math.min(s.cueCount - cues, s.cues.length);
      if (fresh > 0) for (const c of s.cues.slice(-fresh)) snd.cue(c);
      cues = s.cueCount;
    };

    const status = () => {
      if (src === "none") return undefined;
      if (stateRef.current === "open") return undefined;
      return `WAITING FOR ${SOURCES[src].name.toUpperCase()}…`;
    };

    let ticks = 0;
    const frame = (now: number) => {
      step(now);
      draw(ctx, s, { demo: demo.current, image, status: status(), tag, notice });
      // the test panel shows the vote's buttons only while there's a vote
      if (++ticks % 15 === 0) redraw((n) => n + 1);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // a hidden tab gets no animation frames; keep the game going anyway
    const keepGoing = setInterval(() => {
      if (performance.now() - last > 300) step(performance.now());
    }, 250);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(keepGoing);
    };
  }, [image, src, tag, notice]);

  // the font, before anything that matters is drawn
  useEffect(() => {
    const f = new FontFace("Anton", "url(/fonts/Anton-Regular.woff2)");
    f.load().then((loaded) => document.fonts.add(loaded)).catch(() => {});
  }, []);

  const startSound = useCallback(() => {
    if (sound.current?.start()) setTimeout(() => setSoundOn(!!sound.current?.on), 60);
  }, []);

  // try sound straight away: a capture tool like OBS allows it without a click
  useEffect(() => {
    startSound();
  }, [startSound]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      startSound();
      const k = e.key.toLowerCase();
      if (k === "t") setPanel((p) => !p);
      else if (k === "d") {
        demo.current = !demo.current;
        setDemoOn(demo.current);
      } else if (k === "m") {
        setMuted((m) => {
          sound.current?.setVolume(m ? (show.current?.settings.volume ?? 0.7) : 0);
          return !m;
        });
      } else if (k === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [startSound]);

  // the test panel's buttons: as if a viewer did it
  const fresh = useRef(0);
  const teams = s0.game.teams;
  const newcomer = (side: 0 | 1 | null): Viewer => {
    const i = fresh.current++;
    const v = { ...demoViewer(i * 2 + (side ?? 0)), id: `test-new-${i}` };
    if (side !== null) show.current!.join(v, side);
    return v;
  };
  const tester = (side: 0 | 1 | null) => {
    const v = TESTERS[side ?? 0];
    if (side !== null) show.current!.join(v, side);
    return v;
  };
  const crowd = (side: 0 | 1 | null) => {
    for (let i = 0; i < 6; i++) handle({ kind: "chat", viewer: { ...demoViewer(i * 2 + (side ?? 0)), id: `test-crowd-${fresh.current++}` }, text: side === null ? "go" : String(side + 1) });
  };
  const votes = (i: number) => {
    for (let n = 0; n < 5; n++) handle({ kind: "chat", viewer: { ...demoViewer(n), id: `test-voter-${fresh.current++}` }, text: LETTERS[i] });
  };
  const btn = "border border-paper/20 px-2 py-1.5 text-left hover:border-paper hover:bg-paper/10";
  const groups: (0 | 1 | null)[] = teams ? [0, 1] : [null];
  const voting = s0.phase === "win" && s0.vote;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#050506]" onClick={startSound}>
      <canvas
        ref={canvas}
        width={W}
        height={H}
        className="block h-full max-h-[100dvh] w-auto max-w-[100vw] object-contain"
        style={{ aspectRatio: "9 / 16" }}
        aria-label="The live game"
      />

      {!clean && (
        <div className="pointer-events-none fixed left-3 top-3 flex flex-col gap-1.5 font-mono text-[10px] uppercase tracking-wider text-paper/55">
          {!soundOn && <span className="pointer-events-auto bg-signal px-2 py-1 text-ink">Click anywhere for sound</span>}
          {src !== "none" && (
            <span>
              {SOURCES[src].name}: {state === "open" ? "connected" : state === "connecting" ? "connecting…" : "not running, retrying"}
            </span>
          )}
          <span>T test panel · D demo {demoOn ? "on" : "off"} · M {muted ? "unmute" : "mute"} · F full screen</span>
        </div>
      )}

      {panel && (
        <div className="fixed right-3 top-3 max-h-[calc(100dvh-24px)] w-[300px] overflow-y-auto border-2 border-paper/20 bg-ink/95 p-4 font-mono text-[11px] text-paper" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <p className="font-display text-xl uppercase tracking-wide">Test panel</p>
            <button type="button" onClick={() => setPanel(false)} className="text-paper/60 hover:text-paper" aria-label="Close the test panel">✕</button>
          </div>
          <p className="mt-1 leading-relaxed text-paper/55">Every button acts like a viewer did it. Nothing is sent to TikTok.</p>
          {voting && (
            <div className="mt-4">
              <p className="mb-2 uppercase tracking-[0.16em] text-[#FFD60A]">The vote</p>
              <div className="grid grid-cols-3 gap-1.5">
                {s0.vote!.options.map((o, i) => (
                  <button key={o.key} type="button" onClick={() => votes(i)} className={btn}>
                    <span className="block text-paper">5 × {LETTERS[i]}</span>
                    <span className="block truncate text-[10px] text-dim">{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {groups.map((side) => (
            <div key={String(side)} className="mt-4">
              <p className="mb-2 uppercase tracking-[0.16em]" style={{ color: side === null ? "#FFD60A" : s0.teams[side].color }}>
                {side === null ? "Viewers · type go" : `${s0.teams[side].name} · type ${side + 1}`}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {s0.game.menu.map((t) => (
                  <button key={t.effect} type="button" onClick={() => handle({ kind: "gift", viewer: newcomer(side), gift: t.gift, coins: t.min, count: 1 })} className={btn}>
                    <span className="block text-paper">{t.gift}</span>
                    <span className="block text-[10px] text-dim">{t.min} · {t.name}</span>
                  </button>
                ))}
                <button type="button" onClick={() => handle({ kind: "gift", viewer: tester(side), gift: s0.game.menu[2].gift, coins: s0.game.menu[2].min, count: 1 })} className={btn}>
                  <span className="block text-paper">Same viewer again</span>
                  <span className="block text-[10px] text-dim">{s0.game.menu[2].gift} from {tester(side).name}</span>
                </button>
                <button type="button" onClick={() => handle({ kind: "like", viewer: tester(side), count: LIKES_PER_HP })} className={btn}>
                  <span className="block text-paper">{LIKES_PER_HP} likes</span>
                  <span className="block text-[10px] text-dim">from {tester(side).name}</span>
                </button>
                <button type="button" onClick={() => crowd(side)} className={btn}>
                  <span className="block text-paper">6 join</span>
                  <span className="block text-[10px] text-dim">type {side === null ? "go" : side + 1} in chat</span>
                </button>
                <button type="button" onClick={() => handle({ kind: "share", viewer: newcomer(side) })} className={btn}>
                  <span className="block text-paper">Share</span>
                  <span className="block text-[10px] text-dim">a new viewer</span>
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              demo.current = !demo.current;
              setDemoOn(demo.current);
            }}
            className={`mt-4 w-full border-2 px-3 py-2 uppercase tracking-wider ${demoOn ? "border-signal bg-signal text-ink" : "border-paper/30 hover:border-paper"}`}
          >
            {demoOn ? "Demo viewers on" : "Turn on demo viewers"}
          </button>
        </div>
      )}
    </div>
  );
}
