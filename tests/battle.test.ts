import { describe, expect, it } from "vitest";
import { ABILITY_IDS, fib } from "@/lib/battle/abilities";
import { arenaAt, ARENA, FPS, SHRINK_TO, simulate, SUDDEN_DEATH } from "@/lib/battle/sim";
import { drama, pickBattle } from "@/lib/battle/drama";
import { OUTRO, SLOW, SLOW_FRAMES, timeline } from "@/lib/battle/timeline";
import { MELODIES, RATE, soundtrack, wav } from "@/lib/battle/sound";

describe("the fight", () => {
  it("is the same fight every time for the same pair and seed, and a different one for another seed", () => {
    const a = simulate("fibonacci", "spike", 7);
    const b = simulate("fibonacci", "spike", 7);
    expect(b.endFrame).toBe(a.endFrame);
    expect(b.events).toEqual(a.events);
    expect(b.frames[a.endFrame]).toEqual(a.frames[a.endFrame]);
    expect(simulate("fibonacci", "spike", 8).events).not.toEqual(a.events);
  });

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
