import type { Battle } from "./sim";

/**
 * The fight as a video: in real time until just before the deciding hit,
 * that last moment in slow motion, then the winner on screen. Maps video
 * frames to the simulation's frames and back, so what's drawn and what's
 * heard line up. A video can start part way into the fight: a LIVE round's
 * clip shows only its last stretch. From the start, it's the whole fight,
 * exactly as every battle Short has always been.
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
};

export function timeline(b: Battle, opts: TimelineOptions = {}): Timeline {
  const from = opts.from ?? 0;
  const slowN = b.byTimeout ? 0 : Math.max(0, Math.min(SLOW_FRAMES, b.endFrame - from));
  // the video frame the slow motion starts on: everything before it plays in real time
  const pre = b.endFrame + 1 - from - slowN;
  const outroFrom = pre + slowN * SLOW;
  return {
    duration: outroFrom + OUTRO,
    slowFrom: slowN ? pre : null,
    outroFrom,
    toSim: (v) => (v < pre ? from + v : v < outroFrom ? from + pre + Math.floor((v - pre) / SLOW) : b.endFrame),
    toVideo: (s) => (s - from < pre ? s - from : pre + (s - from - pre) * SLOW),
  };
}
