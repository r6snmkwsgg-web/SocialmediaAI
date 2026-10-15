/**
 * sin, cos and hypot that give the same answer, to the last bit, in every
 * JavaScript engine. Browsers' own Math.sin and Math.cos differ in the
 * last digit between versions, and a physics simulation turns a last-digit
 * difference into a different fight: the one previewed in someone's
 * browser, the one rendered by the worker and the one the server scored
 * would no longer be the same video.
 *
 * These are fdlibm's (the classic C maths library, from netlib), which is
 * what V8 used until recently, so the fights are the same ones they always
 * were. Only plain arithmetic and Math.sqrt are used, which every engine
 * must get exactly right.
 */

const buf = new DataView(new ArrayBuffer(8));
const hi = (x: number) => (buf.setFloat64(0, x), buf.getInt32(0));
const fromWords = (h: number, l: number) => (buf.setInt32(0, h), buf.setInt32(4, l), buf.getFloat64(0));

const S1 = -1.66666666666666324348e-1, S2 = 8.33333333332248946124e-3, S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6, S5 = -2.50507602534068634195e-8, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2, C2 = -1.38888888888741095749e-3, C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7, C5 = 2.08757232129817482790e-9, C6 = -1.13596475577881948265e-11;

function kSin(x: number, y: number, iy: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return iy === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

function kCos(x: number, y: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c,
  0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c,
  0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
];
const INVPIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;

/** x reduced to [-pi/4, pi/4] as a head and tail, and which quarter turn it was in; null if it's too big for this. */
function remPio2(x: number, y: [number, number]): number | null {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    y[0] = x;
    y[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        y[0] = z - PIO2_1T;
        y[1] = z - y[0] - PIO2_1T;
      } else {
        z -= PIO2_2;
        y[0] = z - PIO2_2T;
        y[1] = z - y[0] - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      y[0] = z + PIO2_1T;
      y[1] = z - y[0] + PIO2_1T;
    } else {
      z += PIO2_2;
      y[0] = z + PIO2_2T;
      y[1] = z - y[0] + PIO2_2T;
    }
    return -1;
  }
  if (ix > 0x413921fb) return null;
  let t = Math.abs(x);
  const n = (t * INVPIO2 + 0.5) | 0;
  const fn = n;
  let r = t - fn * PIO2_1;
  let w = fn * PIO2_1T;
  if (n < 32 && ix !== NPIO2_HW[n - 1]) {
    y[0] = r - w;
  } else {
    const j = ix >> 20;
    y[0] = r - w;
    let i = j - ((hi(y[0]) >> 20) & 0x7ff);
    if (i > 16) {
      t = r;
      w = fn * PIO2_2;
      r = t - w;
      w = fn * PIO2_2T - (t - r - w);
      y[0] = r - w;
      i = j - ((hi(y[0]) >> 20) & 0x7ff);
      if (i > 49) {
        t = r;
        w = fn * PIO2_3;
        r = t - w;
        w = fn * PIO2_3T - (t - r - w);
        y[0] = r - w;
      }
    }
  }
  y[1] = r - y[0] - w;
  if (hx < 0) {
    y[0] = -y[0];
    y[1] = -y[1];
    return -n;
  }
  return n;
}

const y: [number, number] = [0, 0];

export function sin(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x, y);
  // far beyond anything the simulation turns through
  if (n === null) return Math.sin(x);
  switch (n & 3) {
    case 0:
      return kSin(y[0], y[1], 1);
    case 1:
      return kCos(y[0], y[1]);
    case 2:
      return -kSin(y[0], y[1], 1);
    default:
      return -kCos(y[0], y[1]);
  }
}

export function cos(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x, y);
  if (n === null) return Math.cos(x);
  switch (n & 3) {
    case 0:
      return kCos(y[0], y[1]);
    case 1:
      return -kSin(y[0], y[1], 1);
    case 2:
      return -kCos(y[0], y[1]);
    default:
      return kSin(y[0], y[1], 1);
  }
}

/** The length of (a, b), the way V8 has always worked it out: scaled, with compensated summing. */
export function hypot(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  const max = Math.max(a, b);
  if (max === Infinity) return Infinity;
  if (max === 0 || Number.isNaN(max)) return max;
  let sum = 0, comp = 0;
  for (const v of [a, b]) {
    const n = v / max;
    const summand = n * n - comp;
    const pre = sum + summand;
    comp = pre - sum - summand;
    sum = pre;
  }
  return Math.sqrt(sum) * max;
}
