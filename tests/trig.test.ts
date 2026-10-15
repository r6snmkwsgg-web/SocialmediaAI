import { describe, expect, it } from "vitest";
import { cos, hypot, sin } from "@/lib/battle/trig";

/**
 * The battle maths has to give the same bits everywhere, or a fight
 * previewed in a browser stops matching the one rendered and posted.
 * These are fdlibm's answers, pinned to the bit.
 */

const bits = (x: number) => {
  const d = new DataView(new ArrayBuffer(8));
  d.setFloat64(0, x);
  return d.getBigUint64(0).toString(16).padStart(16, "0");
};

const PINNED: [number, string, string, string][] = [
    [0.1, "3fb98eaecb8bcb2c", "3fefd712f9a817c0", "3ff09c4e76d8294c"],
    [0.7853981633974483, "3fe6a09e667f3bcc", "3fe6a09e667f3bcd", "3ff7c7bf551f0b97"],
    [1, "3feaed548f090cee", "3fe14a280fb5068c", "3ffaaaaaaaaaaaaa"],
    [1.5707963267948966, "3ff0000000000000", "3c91a62633145c07", "400181af1a597496"],
    [2.5, "3fe326af0dcfcab0", "bfe9a2f7ef858b7d", "4008cd2ac1760747"],
    [-3.3, "3fc43102cab70c87", "bfef996f2ca70bb6", "400a698097ee272d"],
    [10, "bfe1689ef5f34f52", "bfead9ac890c6b1f", "4025cc0b0d2e7b4d"],
    [123.456, "bfe9b9dadc41aeb6", "bfe307e5980a1558", "40604e84efb4ab18"],
    [1000.5, "3fefd948c50a7a0d", "3fb8dbff75eb664f", "40907bbeb95e3e12"],
    [-98765.4321, "bfa5a0fd0d209b99", "3feff8afef125a18", "40f96ab971cf2a4b"],
    [7, "3fe50608c26d0a08", "3fe81ff79ed92017", "401f0335f84cb7fe"],
    [0.3, "3fd2e9cd95baba33", "3fee921dd42f09ba", "3ff23e2896280f23"],
    [500000, "3fc6c32c3d5d59f3", "bfef7d6d81d1c85d", "4120158d2f93a638"],
];

describe("the battle's own sin, cos and hypot", () => {
  it.each(PINNED)("gives fdlibm's exact answer at %s", (x, s, c, h) => {
    expect(bits(sin(x))).toBe(s);
    expect(bits(cos(x))).toBe(c);
    expect(bits(hypot(x, x / 3 + 1))).toBe(h);
  });

  it("is close to the engine's own everywhere", () => {
    for (let x = -50; x < 50; x += 0.37) {
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-15);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-15);
    }
    expect(hypot(3, 4)).toBe(5);
    expect(hypot(0, 0)).toBe(0);
  });
});
