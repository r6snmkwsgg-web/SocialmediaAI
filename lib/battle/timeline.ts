import type { Battle } from "./sim";

/**
 * The fight as a video: in real time until just before the deciding hit,
 * that last moment in slow motion, then the winner on screen. Maps video
 * frames to the simulation's frames and back, so what's drawn and what's
 * heard line up.
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

export function timeline(b: Battle): Timeline {
  const slowN = b.byTimeout ? 0 : Math.min(SLOW_FRAMES, b.endFrame);
  const pre = b.endFrame + 1 - slowN;
  const outroFrom = pre + slowN * SLOW;
  return {
    duration: outroFrom + OUTRO,
    slowFrom: slowN ? pre : null,
    outroFrom,
    toSim: (v) => (v < pre ? v : v < outroFrom ? pre + Math.floor((v - pre) / SLOW) : b.endFrame),
    toVideo: (s) => (s < pre ? s : pre + (s - pre) * SLOW),
  };
}
