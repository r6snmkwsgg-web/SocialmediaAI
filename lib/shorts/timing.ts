import { series } from "../battle/series";
import { FPS } from "../battle/sim";
import { OUTRO } from "../battle/timeline";
import { clipOutro } from "../live/clip";
import type { Ending, Message, ShortFormat, Spec } from "./types";

/**
 * How long each format's video runs, and when each part of it happens.
 * The compositions draw from these and the soundtracks are timed by them,
 * so picture and sound always line up.
 *
 * Every format starts on the action from the first frame, with its title
 * over the top for the first second and a half: there's no title card
 * to swipe away from.
 */

export { FPS };

const s = (seconds: number) => Math.round(seconds * FPS);

/** how long the title stays over the opening */
export const TITLE = s(1.5);

/** how long a Ball League match's "previously" stays over its opening, before what's at stake takes over */
export const LEAGUE_OPEN = s(3);

export const QUIZ = { intro: 0, show: s(0.5), think: s(3), reveal: s(1.3), outro: s(2.6) };
export const quizStep = QUIZ.show + QUIZ.think + QUIZ.reveal;

export const WYR = { intro: 0, each: s(4.6), outro: s(2.6) };

export const RANKING = { intro: 0, each: s(2.2), outro: s(3.2) };

export const RACE = { intro: 0, year: s(0.5), outro: s(3.4) };

export const TEXTS = { intro: s(0.3), pause: s(0.35), hold: s(1.6), outro: s(2.6) };

/**
 * How each format ends, in frames. "comment" is the closing screen that
 * asks for a comment; "loop" holds the end a moment, then runs back into
 * the opening, so a replay carries straight on; "quiet" closes without
 * asking for anything, for Shorts where comments are off. A round from a
 * LIVE ends the way a battle does.
 */
export const ENDS: Record<ShortFormat, Record<Ending, number>> = {
  battle: { comment: OUTRO, loop: s(2.2), quiet: OUTRO },
  quiz: { comment: QUIZ.outro, loop: s(1.6), quiet: s(2.2) },
  wyr: { comment: WYR.outro, loop: s(1.4), quiet: s(2.2) },
  texts: { comment: TEXTS.outro, loop: s(1.6), quiet: s(2.2) },
  ranking: { comment: RANKING.outro, loop: s(2.0), quiet: s(2.8) },
  race: { comment: RACE.outro, loop: s(2.2), quiet: s(3.0) },
  clip: { comment: OUTRO, loop: s(2.2), quiet: OUTRO },
};

/** The last frames of a loop ending, that run back into the opening. */
export const BACK = s(0.6);

/** The ending a Short actually has: never one that asks for comments where comments are off. */
export function endingOf(params: { ending?: Ending; allowComments?: boolean }): Ending {
  const e = params.ending ?? "comment";
  return params.allowComments === false && e === "comment" ? "quiet" : e;
}

export const endFrames = (format: ShortFormat, ending: Ending) => ENDS[format][ending];

/** Frames a year takes in a race: half a second, slower for a short stretch so it still runs about 20 seconds. */
export function raceStep(years: number): number {
  return Math.max(RACE.year, Math.min(s(1), Math.round((FPS * 20) / Math.max(1, years - 1))));
}

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

/**
 * The frame each format's ending starts on. A battle's comes after its
 * games (a Ball League knockout can have several, one after another). A
 * LIVE round's comes from its record alone, so a clip's length never
 * needs it played back.
 */
export function endFrom(spec: Spec): number {
  switch (spec.format) {
    case "battle":
      return series(spec.params).endFrom;
    case "quiz":
      return QUIZ.intro + spec.params.questions.length * quizStep;
    case "wyr":
      return WYR.intro + spec.params.pairs.length * WYR.each;
    case "texts":
      return storyTimes(spec.params.story.messages).at(-1)!.at + TEXTS.hold;
    case "ranking":
      return RANKING.intro + spec.params.items.length * RANKING.each;
    case "race":
      return RACE.intro + (spec.params.years.length - 1) * (spec.params.step ?? RACE.year);
    case "clip":
      return clipOutro(spec.params.log.end, spec.params.from, spec.params.log.result.byTime);
  }
}

/** Frames in a Short, for the player, the renderer and the soundtrack. */
export function frames(spec: Spec): number {
  return endFrom(spec) + endFrames(spec.format, endingOf(spec.params));
}

export const seconds = (spec: Spec) => frames(spec) / FPS;
