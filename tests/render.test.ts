import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Thumbnail } from "@remotion/player";
import { rng } from "@/lib/battle/sim";
import { finish, FORMATS } from "@/lib/shorts/formats";
import { BASE_LOOKS, lookNumber } from "@/lib/shorts/look";
import { frames } from "@/lib/shorts/timing";
import { ENDINGS, FORMAT_IDS, type Spec } from "@/lib/shorts/types";
import { ShortVideo } from "@/remotion/shorts/Short";

/**
 * Every format drawn at its opening, middle and ending, in several
 * channels' looks and with every ending, without a browser: a picture
 * that throws would stop a render on the worker.
 */

const draw = (spec: Spec, frame: number) =>
  renderToString(
    createElement(Thumbnail, {
      component: ShortVideo,
      inputProps: { spec, tag: true },
      durationInFrames: frames(spec),
      compositionWidth: 1080,
      compositionHeight: 1920,
      fps: 30,
      frameToDisplay: frame,
      acknowledgeRemotionLicense: true,
    } as never),
  );

describe("drawing", () => {
  it.each(FORMAT_IDS)("%s draws at every moment, in any look, with any ending", (f) => {
    const base = FORMATS[f].propose({ rand: rng(3), used: new Set() })!;
    for (const ending of ENDINGS) {
      for (const n of [0, 2, 5, 331]) {
        const c = finish(base, { look: lookNumber(n), ending, allowComments: n !== 5 });
        const spec = { format: c.format, params: c.params } as Spec;
        const total = frames(spec);
        for (const frame of [0, 20, Math.floor(total / 2), total - 30, total - 1]) {
          const html = draw(spec, frame);
          expect(html, `${f} ${ending} look ${n} frame ${frame}`).not.toMatch(/server rendering errored/);
        }
      }
    }
  });

  it("opens on the action with the title over it, and never asks for comments where they're off", () => {
    const quiz = finish(FORMATS.quiz.propose({ rand: rng(1), used: new Set() })!, { look: lookNumber(3), ending: "comment", allowComments: false });
    const spec = { format: quiz.format, params: quiz.params } as Spec;
    const first = draw(spec, 0);
    if (quiz.format !== "quiz") throw new Error();
    // the first question and the title are both there in the very first frame
    expect(first.toLowerCase()).toContain(quiz.params.questions[0].q.replace(/'/g, "&#x27;").toLowerCase());
    expect(first).toMatch(/5 questions/i);
    expect(draw(spec, frames(spec) - 1)).not.toMatch(/comment/i);
    const wyr = finish(FORMATS.wyr.propose({ rand: rng(1), used: new Set() })!, { ending: "loop", allowComments: false });
    const w = { format: wyr.format, params: wyr.params } as Spec;
    for (const frame of [0, 100, frames(w) - 1]) expect(draw(w, frame)).not.toMatch(/comment/i);
  });

  it("draws the backdrop each look says, so look 330 isn't Hookline's own", () => {
    const base = FORMATS.wyr.propose({ rand: rng(2), used: new Set() })!;
    const at = (n: number) => {
      const c = finish(base, { look: lookNumber(n), ending: "comment" });
      return draw({ format: c.format, params: c.params } as Spec, 200);
    };
    const [own, later] = [at(0), at(BASE_LOOKS)];
    expect(lookNumber(BASE_LOOKS).backdrop).toBe(lookNumber(0).backdrop);
    expect(later).not.toBe(own);
    expect(later).toContain(`linear-gradient(${lookNumber(BASE_LOOKS).tilt}deg`);
  });
});
