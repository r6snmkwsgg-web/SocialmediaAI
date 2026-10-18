import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ABILITIES, ABILITY_IDS, fib } from "@/lib/battle/abilities";
import { arenaAt, ARENA, FPS, SHRINK_TO, simulate, SUDDEN_DEATH } from "@/lib/battle/sim";
import { drama, pickBattle } from "@/lib/battle/drama";
import { OUTRO, SLOW, SLOW_FRAMES, timeline } from "@/lib/battle/timeline";
import { MELODIES, RATE, soundtrack, wav } from "@/lib/battle/sound";
import { clipOutro } from "@/lib/live/clip";

describe("the fight", () => {
  it("is the same fight every time for the same pair and seed, and a different one for another seed", () => {
    const a = simulate("fibonacci", "spike", 7);
    const b = simulate("fibonacci", "spike", 7);
    expect(b.endFrame).toBe(a.endFrame);
    expect(b.events).toEqual(a.events);
    expect(b.frames[a.endFrame]).toEqual(a.frames[a.endFrame]);
    expect(simulate("fibonacci", "spike", 8).events).not.toEqual(a.events);
  });

  // Shorts already made, and the live preview, depend on every fight staying
  // exactly as it was. This changes only if the simulation does; if it has
  // to, every video made before the change will play differently.
  it("is still exactly the fight it always was, for every matchup", () => {
    const h = createHash("sha256");
    for (const a of ABILITY_IDS) {
      for (const b of ABILITY_IDS) {
        if (a === b) continue;
        for (const seed of [1, 2, 3, 4, 32, 66, 98]) h.update(JSON.stringify(simulate(a, b, seed)));
      }
    }
    expect(h.digest("hex")).toBe("7033c6cb4fcab19a6aad1d96b36f1869ec009c4c8867b5ef53667d5072e34fe1");
  }, 30_000);

  it("is exactly the same fight when each side is given its own health, and another with other health", () => {
    for (const a of ABILITY_IDS) {
      for (const b of ABILITY_IDS) {
        if (a === b) continue;
        for (const seed of [1, 66]) {
          const own = simulate(a, b, seed, [ABILITIES[a].hp, ABILITIES[b].hp]);
          expect(JSON.stringify(own), `${a} ${b} ${seed}`).toBe(JSON.stringify(simulate(a, b, seed)));
        }
      }
    }
    // a Ball League match's health starts each side there, and the balls still start where they always did
    const league = simulate("heal", "fibonacci", 7, [27, 4]);
    const plain = simulate("heal", "fibonacci", 7);
    expect(league.start).toEqual([27, 4]);
    expect(league.frames[0].hp).toEqual([27, 4]);
    expect(league.frames[0].balls.map((x) => [x.x, x.y])).toEqual(plain.frames[0].balls.map((x) => [x.x, x.y]));
  }, 30_000);

  it("ends with a winner, inside the arena, never in the first few seconds", () => {
    for (const x of ABILITY_IDS) {
      for (const y of ABILITY_IDS) {
        if (x === y) continue;
        const b = simulate(x, y, 3);
        expect(b.endFrame / FPS).toBeGreaterThan(4);
        expect(b.endFrame / FPS).toBeLessThan(60);
        const last = b.frames[b.endFrame];
        if (!b.byTimeout && b.winner !== null) expect(last.count[1 - b.winner]).toBe(0);
        for (const fr of b.frames.filter((_, i) => i % 15 === 0)) {
          for (const ball of fr.balls) {
            expect(ball.x).toBeGreaterThanOrEqual(fr.lo - 1);
            expect(ball.x).toBeLessThanOrEqual(fr.lo + fr.size + 1);
          }
        }
      }
    }
  });

  it("closes the walls in for sudden death, so nothing runs forever", () => {
    expect(arenaAt(0).size).toBe(ARENA);
    expect(arenaAt(SUDDEN_DEATH).size).toBe(ARENA);
    expect(arenaAt(SUDDEN_DEATH + 7).size).toBeLessThan(ARENA);
    expect(arenaAt(SUDDEN_DEATH + 100).size).toBe(SHRINK_TO);
  });

  it("splits Fibonacci the way its name says, and records it", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(fib)).toEqual([1, 1, 2, 3, 5, 8, 13]);
    const b = simulate("fibonacci", "grow", 11);
    const spawns = b.events.filter((e) => e.type === "spawn" && e.team === 0).map((e) => (e.type === "spawn" ? e.n : 0));
    expect(spawns[0]).toBe(1);
    // each split is the next Fibonacci number, or fewer when the team is nearly full
    spawns.forEach((n, i) => expect(n).toBeLessThanOrEqual(fib(i + 1)));
    expect(Math.max(...b.frames.map((f) => f.count[0]))).toBeLessThanOrEqual(21);
  });
});

describe("picking the fight to show", () => {
  it("keeps the most dramatic of the runs it tried", () => {
    const { battle, drama: d, tried } = pickBattle("sword", "heal", 12);
    expect(tried).toBe(12);
    for (let s = 1; s <= 12; s++) expect(drama(simulate("sword", "heal", s)).score).toBeLessThanOrEqual(d.score);
    expect(d.seconds).toBeCloseTo((battle.endFrame + 1) / FPS);
  });
});

describe("the video and its sound", () => {
  const b = simulate("spike", "bomb", 4);
  const tl = timeline(b);

  it("slows down just before the deciding hit, then shows the winner", () => {
    const pre = b.endFrame + 1 - SLOW_FRAMES;
    expect(tl.slowFrom).toBe(pre);
    expect(tl.toSim(pre - 1)).toBe(pre - 1);
    expect(tl.toSim(pre + SLOW * 3)).toBe(pre + 3);
    expect(tl.toVideo(pre + 3)).toBe(pre + SLOW * 3);
    expect(tl.toSim(tl.duration - 1)).toBe(b.endFrame);
    expect(tl.duration).toBe(tl.outroFrom + OUTRO);
  });

  it("is a real WAV as long as the video, loud enough to hear and never clipping", () => {
    const pcm = soundtrack(b, tl, "elise");
    expect(pcm.length).toBe(Math.ceil((tl.duration / FPS) * RATE));
    const peak = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThanOrEqual(1);
    const bytes = wav(pcm);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(bytes.length).toBe(44 + pcm.length * 2);
    expect(MELODIES.ode.length).toBeGreaterThan(30);
  });
});

describe("a video that starts part way into the fight", () => {
  it("is the whole fight from the start, exactly as it always was, for every matchup", () => {
    for (const a of ABILITY_IDS) {
      for (const b of ABILITY_IDS) {
        if (a === b) continue;
        for (const seed of [2, 9]) {
          const fight = simulate(a, b, seed);
          const [whole, zero] = [timeline(fight), timeline(fight, { from: 0 })];
          expect([zero.duration, zero.slowFrom, zero.outroFrom]).toEqual([whole.duration, whole.slowFrom, whole.outroFrom]);
          for (let v = 0; v < whole.duration; v++) expect(zero.toSim(v)).toBe(whole.toSim(v));
          for (let f = 0; f <= fight.endFrame; f++) expect(zero.toVideo(f)).toBe(whole.toVideo(f));
          // real time, the last 20 frames before a knockout four times slower, then the winner
          const slow = fight.byTimeout ? 0 : Math.min(SLOW_FRAMES, fight.endFrame);
          expect(whole.outroFrom).toBe(fight.endFrame + 1 + slow * (SLOW - 1));
          expect(whole.slowFrom).toBe(slow ? fight.endFrame + 1 - slow : null);
        }
      }
    }
  });

  it("is exactly the same at real speed, and faster only before the slow motion", () => {
    for (const a of ABILITY_IDS) {
      for (const b of ABILITY_IDS) {
        if (a === b) continue;
        const fight = simulate(a, b, 9);
        const [whole, real] = [timeline(fight), timeline(fight, { speed: 1 })];
        expect([real.duration, real.slowFrom, real.outroFrom]).toEqual([whole.duration, whole.slowFrom, whole.outroFrom]);
        for (let v = 0; v < whole.duration; v++) expect(real.toSim(v)).toBe(whole.toSim(v));
        for (let f = 0; f <= fight.endFrame; f++) expect(real.toVideo(f)).toBe(whole.toVideo(f));
      }
    }
    // played faster: the real-time part takes fewer frames, the slow motion and the winner as long as ever
    const fight = simulate("spike", "bomb", 4);
    const [real, fast] = [timeline(fight), timeline(fight, { speed: 1.5 })];
    const slow = real.outroFrom - real.slowFrom!;
    expect(fast.slowFrom).toBe(Math.ceil(real.slowFrom! / 1.5));
    expect(fast.outroFrom - fast.slowFrom!).toBe(slow);
    expect(fast.duration - fast.outroFrom).toBe(OUTRO);
    expect(fast.toSim(0)).toBe(0);
    expect(fast.toSim(fast.slowFrom! - 1)).toBeLessThan(real.slowFrom!);
    expect(fast.toSim(fast.slowFrom!)).toBe(real.slowFrom!);
    expect(fast.toSim(fast.duration - 1)).toBe(fight.endFrame);
    // every sim frame shows, in order, and the video frame each one shows on maps back to it or just before
    for (let f = 0; f <= fight.endFrame; f++) {
      expect(fast.toSim(fast.toVideo(f))).toBeLessThanOrEqual(f);
      if (f > 0) expect(fast.toVideo(f)).toBeGreaterThanOrEqual(fast.toVideo(f - 1));
    }
  });

  it("shows that sim frame first, still slows the knockout, and gets to the winner where clipOutro() says", () => {
    const fight = simulate("spike", "bomb", 4);
    const end = 2 * (fight.endFrame + 1);
    for (const from of [1, 90, fight.endFrame - 40, fight.endFrame - 5, fight.endFrame]) {
      const tl = timeline(fight, { from });
      expect(tl.toSim(0)).toBe(from);
      expect(tl.toVideo(from)).toBe(0);
      expect(tl.toSim(tl.duration - 1)).toBe(fight.endFrame);
      expect(tl.duration).toBe(tl.outroFrom + OUTRO);
      expect(tl.outroFrom).toBe(clipOutro(end, from, false));
      // the slow motion is the last 20 frames, or as many as the video shows
      const slow = Math.min(SLOW_FRAMES, fight.endFrame - from);
      expect(tl.slowFrom).toBe(slow ? fight.endFrame + 1 - from - slow : null);
      if (slow) {
        const pre = tl.slowFrom!;
        expect(tl.toSim(pre - 1)).toBe(from + pre - 1);
        expect(tl.toSim(pre + SLOW * 2)).toBe(from + pre + 2);
        expect(tl.toVideo(from + pre + 2)).toBe(pre + SLOW * 2);
      }
    }
    // a fight decided on time has no slow motion, however late it starts
    const timed = { ...fight, byTimeout: true };
    expect(timeline(timed, { from: 120 }).slowFrom).toBeNull();
    expect(timeline(timed, { from: 120 }).outroFrom).toBe(clipOutro(end, 120, true));
    expect(clipOutro(end, 120, true)).toBe(fight.endFrame + 1 - 120);
  });
});
