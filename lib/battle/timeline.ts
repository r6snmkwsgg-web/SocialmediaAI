import type { Battle } from "./sim";

/**
 * The fight as a video: in real time until just before the deciding hit,
 * that last moment in slow motion, then the winner on screen. Maps video
 * frames to the simulation's frames and back, so what's drawn and what's
 * heard line up. A video can start part way into the fight: a LIVE round's
 * clip shows only its last stretch. It can also play faster than real
 * time: the rare Ball League final too long for a Short plays its fights
 * a little faster, slow motion and the winner as ever. From the start and
 * at real speed, it's the whole fight, exactly as every battle Short has
 * always been.
 */

/** Simulation frames shown in slow motion before a knockout. */
export const SLOW_FRAMES = 20;
/** How many times slower. */
export const SLOW = 4;
/** Frames the winner stays on screen. */
export const OUTRO = 96;

export type Timeline = {
  /** frames in the whole video */
  duration: number;
  /** the video frame the slow motion starts on, or null for a fight decided on time */
  slowFrom: number | null;
  /** the video frame the winner appears on */
  outroFrom: number;
  toSim: (videoFrame: number) => number;
  toVideo: (simFrame: number) => number;
};

export type TimelineOptions = {
  /** the sim frame the video starts on: 0, the whole fight, unless it says otherwise */
  from?: number;
  /** how many times faster than real time the fight plays before its slow motion: 1 unless it says otherwise */
  speed?: number;
};

export function timeline(b: Pick<Battle, "endFrame" | "byTimeout">, opts: TimelineOptions = {}): Timeline {
  const from = opts.from ?? 0;
  const speed = opts.speed ?? 1;
  const slowN = b.byTimeout ? 0 : Math.max(0, Math.min(SLOW_FRAMES, b.endFrame - from));
  // the sim frames before the slow motion, and the video frames they play in: the same at real speed
  const before = b.endFrame + 1 - from - slowN;
  const pre = Math.ceil(before / speed);
  const outroFrom = pre + slowN * SLOW;
  return {
    duration: outroFrom + OUTRO,
    slowFrom: slowN ? pre : null,
    outroFrom,
    toSim: (v) => (v < pre ? from + Math.floor(v * speed) : v < outroFrom ? from + before + Math.floor((v - pre) / SLOW) : b.endFrame),
    toVideo: (s) => (s - from < before ? Math.floor((s - from) / speed) : pre + (s - from - before) * SLOW),
  };
}
