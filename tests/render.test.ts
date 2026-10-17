import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Thumbnail } from "@remotion/player";
import { rng, type Team } from "@/lib/battle/sim";
import { timeline } from "@/lib/battle/timeline";
import { PLANS } from "@/lib/billing/plans";
import { CLIP_V, replay, type ClipInput, type ClipLog } from "@/lib/live/clip";
import { demoClip } from "@/lib/live/clip-demo";
import { liveHp, liveOptions, liveResult, liveWorld } from "@/lib/live/games/battle";
import { DEFAULT_GIFTS } from "@/lib/live/menu";
import { DEFAULT_SIDE_GIFTS } from "@/lib/live/rivals";
import { fingerprint, type RecordedWorld } from "@/lib/live/tape";
import { finish, FORMATS } from "@/lib/shorts/formats";
import { clipCandidate, withNames } from "@/lib/shorts/formats/clip";
import { BASE_LOOKS, lookNumber } from "@/lib/shorts/look";
import { soundFor } from "@/lib/shorts/sound";
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

/** A made-up LIVE's most dramatic round as the morning run makes it into a Short, in a look, with an ending, gifters' names shown or not. */
function clipSpec(log: ClipLog, o: { look?: number; ending?: (typeof ENDINGS)[number]; comments?: boolean; names?: boolean } = {}): Spec {
  const c = clipCandidate({ log, played_at: new Date(log.at) }, replay(log), { tz: "UTC", per: PLANS.pro.shorts, rand: rng(1) })!;
  const f = finish(c, { look: lookNumber(o.look ?? 0), ending: o.ending ?? "comment", allowComments: o.comments });
  return withNames({ format: f.format, params: f.params } as Spec, o.names ?? false);
}

/**
 * A 30-second round played straight into a recorded arena: both sides
 * kept alive with heals until 27 seconds in, then a meteor leaves Blue
 * hanging on at 1 HP, owing far more than it has, as time runs out.
 */
function timedOut(): ClipLog {
  const fightMax = 30, world = liveOptions(fightMax), hp = liveHp("heal", "grow");
  const w = liveWorld("heal", "grow", 9, world, hp, true) as RecordedWorld;
  const act = () => {
    if (w.sub % 60 === 0 && w.sub < 27 * 60) for (const t of [0, 1] as Team[]) w.heal(t, 30);
    if (w.sub === 27 * 60) w.meteor(0, 0, 0, 1_000_000);
  };
  act();
  let result = null;
  while (!result) {
    w.tick();
    result = liveResult(w, fightMax);
    if (!result) act();
  }
  const inputs = w.inputs.map((x): ClipInput => (x[1] === "s" ? [x[0], x[1], x[2], x[3], x[4], x[5], -1] : x));
  const teams: ClipLog["teams"] = [{ name: "Red", color: "#FF3B30" }, { name: "Blue", color: "#0A84FF" }];
  return { v: CLIP_V, game: "battle", session: "7b6d1f9c-2f3e-4a5b-8c7d-1e2f3a4b5c6d", round: 2, at: Date.now(), seed: 9, a: "heal", b: "grow", hp, world, fightMax, teams, inputs, moments: [], people: [], end: w.sub, result, check: fingerprint(w) };
}

/** a name as it would appear in the drawing, on its own */
const named = (name: string) => new RegExp(`(^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w]|$)`);

describe("a round from a LIVE", () => {
  const rounds = { battle: demoClip("battle"), rivals: demoClip("rivals") };

  it.each(["battle", "rivals"] as const)("%s draws at every moment, in any look, with any ending, names on or off", (game) => {
    for (const ending of ENDINGS) {
      for (const look of [0, 2, 5, 331]) {
        for (const names of [false, true]) {
          const spec = clipSpec(rounds[game], { look, ending, comments: look !== 5, names });
          const total = frames(spec);
          for (const frame of [0, 20, Math.floor(total / 2), total - 30, total - 1]) {
            const html = draw(spec, frame);
            expect(html, `${game} ${ending} look ${look} frame ${frame}`).not.toMatch(/server rendering errored/);
            expect(html).toMatch(/From my LIVE/i);
          }
        }
      }
    }
  });

  it("names nobody unless names are on, then only the people who sent gifts, and never shows coins or a gift", () => {
    const gifts = [...DEFAULT_GIFTS, ...DEFAULT_SIDE_GIFTS.red, ...DEFAULT_SIDE_GIFTS.blue].map((g) => g.name);
    for (const log of [rounds.battle, rounds.rivals]) {
      const shown = { off: new Set<string>(), on: new Set<string>() };
      let banners = 0;
      for (const names of [false, true]) {
        const spec = clipSpec(log, { names });
        for (let frame = 0; frame < frames(spec); frame += 6) {
          const html = draw(spec, frame);
          for (const p of log.people) if (named(p).test(html)) shown[names ? "on" : "off"].add(p);
          if (!names && /A viewer&#x27;s gift/.test(html)) banners++;
          expect(html).not.toMatch(/coin/i);
          for (const g of gifts) expect(html).not.toContain(g);
        }
      }
      expect([...shown.off]).toEqual([]);
      expect(shown.on.size).toBeGreaterThan(0);
      // a big gift still shows what it did, as nobody's
      expect(banners).toBeGreaterThan(0);
    }
  });

  it("starts sudden death at the round's own time, and ends a time-out on health less what's owed, never below 0", () => {
    const log = timedOut();
    const r = replay(log);
    expect([r.exact, log.result.byTime, log.world.suddenDeath]).toEqual([true, true, 20]);
    expect(r.hp[1]).toBe(0);
    const spec: Spec = { format: "clip", params: { log, from: 0 } };
    // walls closing at 20 seconds, as this LIVE's 30-second rounds have them, not at a battle Short's 36
    expect(draw(spec, 19 * 30)).not.toMatch(/sudden death/i);
    expect(draw(spec, 21 * 30)).toMatch(/sudden death: the walls are closing/i);
    // Blue hanging on from 28.2 seconds, when the meteor landed, for 4: what it needs, and how long it has left
    expect(draw(spec, Math.round(29.5 * 30))).toMatch(/Blue needs 999,[\d]{3} HP · 3s/i);
    const end = draw(spec, timeline(r.battle).outroFrom + 20);
    expect(end).toMatch(/Red/i);
    expect(end).toMatch(new RegExp(`On health, ${Math.ceil(r.hp[0]).toLocaleString("en-US")} to 0`, "i"));
    expect(end).not.toMatch(/to -/i);
  });

  it("says plainly when its record no longer plays back, and stays quiet, rather than show the wrong fight", () => {
    const log = structuredClone(rounds.rivals);
    const heal = log.inputs.findIndex((x) => x[1] === "h");
    (log.inputs[heal] as [number, "h", Team, number])[3] += 1;
    const spec = clipSpec(rounds.rivals);
    const broken: Spec = { format: "clip", params: { ...(spec.params as object), log } } as Spec;
    expect(replay(log).exact).toBe(false);
    for (const frame of [0, 100, frames(broken) - 1]) expect(draw(broken, frame)).toMatch(/no longer plays back exactly/i);
    expect(soundFor(broken).every((v) => v === 0)).toBe(true);
    expect(soundFor(broken).length).toBe(soundFor(spec).length);
  });
});
