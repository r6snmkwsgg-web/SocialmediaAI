import { FPS, simulate } from "../battle/sim";
import { timeline } from "../battle/timeline";
import type { Message, Spec } from "./types";

/**
 * How long each format's video runs, and when each part of it happens.
 * The compositions draw from these and the soundtracks are timed by them,
 * so picture and sound always line up.
 */

export { FPS };

const s = (seconds: number) => Math.round(seconds * FPS);

export const QUIZ = { intro: s(1.6), show: s(0.5), think: s(3), reveal: s(1.3), outro: s(2.6) };
export const quizStep = QUIZ.show + QUIZ.think + QUIZ.reveal;

export const WYR = { intro: s(1.4), each: s(4.6), outro: s(2.6) };

export const RANKING = { intro: s(2.2), each: s(2.2), outro: s(3.2) };

export const RACE = { intro: s(2.2), year: s(0.5), outro: s(3.4) };

export const TEXTS = { intro: s(0.3), pause: s(0.35), hold: s(1.6), outro: s(2.6) };

/** When each message of a story arrives, and when "typing…" shows before it. */
export function storyTimes(messages: Message[]): { typingFrom: number | null; at: number }[] {
  let t = TEXTS.intro;
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    // time to read what came before
    if (prev) t += Math.round(Math.min(s(2.4), Math.max(s(0.7), s(0.35) + (prev.text.length / 26) * FPS)));
    // the first message is there straight away: an empty screen loses people in the first second
    if (i === 0) return { typingFrom: null, at: t };
    if (m.me) {
      t += TEXTS.pause;
      return { typingFrom: null, at: t };
    }
    const typing = Math.round(Math.min(s(1.5), Math.max(s(0.6), s(0.4) + (m.text.length / 45) * FPS)));
    const from = t;
    t += typing;
    return { typingFrom: from, at: t };
  });
}

/** Frames in a Short, for the player, the renderer and the soundtrack. */
export function frames(spec: Spec): number {
  switch (spec.format) {
    case "battle":
      return timeline(simulate(spec.params.a, spec.params.b, spec.params.seed)).duration;
    case "quiz":
      return QUIZ.intro + spec.params.questions.length * quizStep + QUIZ.outro;
    case "wyr":
      return WYR.intro + spec.params.pairs.length * WYR.each + WYR.outro;
    case "texts": {
      const t = storyTimes(spec.params.story.messages);
      return t[t.length - 1].at + TEXTS.hold + TEXTS.outro;
    }
    case "ranking":
      return RANKING.intro + spec.params.items.length * RANKING.each + RANKING.outro;
    case "race":
      return RACE.intro + (spec.params.years.length - 1) * RACE.year + RACE.outro;
  }
}

export const seconds = (spec: Spec) => frames(spec) / FPS;
