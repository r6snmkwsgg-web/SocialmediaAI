/**
 * A 2D canvas that draws nothing and writes down where things would go,
 * for testing what the live games put on screen. It follows save, restore,
 * translate and scale (not rotate), takes the font size from ctx.font, and
 * guesses text at half an em a character. It records the boxes fillText,
 * strokeText, fillRect and roundRect cover, and drawImage's, in canvas
 * pixels, and every text and picture drawn.
 *
 * clip() keeps to the box round the rects, round rects and arcs in the
 * path, so the arena's clip keeps its drawing out of the bands above it,
 * as on screen. A path it can't follow clips nothing, and everything else
 * does nothing, so it can only over-report.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type Drawn = Box & { kind: "text" | "rect" | "image"; text?: string };

type State = { tx: number; ty: number; sx: number; sy: number; clip: Box | null; props: Record<string | symbol, unknown> };

const union = (a: Box | null, b: Box): Box => {
  if (!a) return b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

const meet = (a: Box | null, b: Box): Box | null => {
  if (!a) return b;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};

export function recorder() {
  const drawn: Drawn[] = [];
  const texts: string[] = [];
  const out = { ctx: null as unknown as CanvasRenderingContext2D, drawn, texts, images: 0 };
  let st: State = { tx: 0, ty: 0, sx: 1, sy: 1, clip: null, props: { globalAlpha: 1, font: "10px sans-serif", textAlign: "start" } };
  const saved: State[] = [];
  let path: Box | null = null;

  /** a box in the current drawing's units, in canvas pixels */
  const toCanvas = (x: number, y: number, w: number, h: number): Box => {
    const x0 = st.tx + st.sx * x, y0 = st.ty + st.sy * y, x1 = st.tx + st.sx * (x + w), y1 = st.ty + st.sy * (y + h);
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  };
  const record = (kind: Drawn["kind"], b: Box, text?: string) => {
    // a clip that leaves none of it showing means it isn't on screen
    const seen = st.clip ? meet(st.clip, b) : b;
    if (seen) drawn.push({ kind, ...seen, ...(text === undefined ? {} : { text }) });
  };
  const em = () => Number(/([\d.]+)px/.exec(String(st.props.font))?.[1] ?? 10);
  const width = (s: string) => Array.from(s).length * em() * 0.5;
  const write = (s: string, x: number, y: number) => {
    texts.push(s);
    const w = width(s), size = em(), align = st.props.textAlign;
    const left = align === "center" ? x - w / 2 : align === "right" || align === "end" ? x - w : x;
    // from a full em above the baseline to a quarter below, which covers accents and descenders
    record("text", toCanvas(left, y - size, w, size * 1.25), s);
  };

  const calls: Record<string, (...a: never[]) => unknown> = {
    save: () => saved.push({ ...st, props: { ...st.props } }),
    restore: () => {
      st = saved.pop() ?? st;
    },
    translate: (x: number, y: number) => {
      st.tx += st.sx * x;
      st.ty += st.sy * y;
    },
    scale: (x: number, y: number) => {
      st.sx *= x;
      st.sy *= y;
    },
    beginPath: () => {
      path = null;
    },
    rect: (x: number, y: number, w: number, h: number) => {
      path = union(path, toCanvas(x, y, w, h));
    },
    roundRect: (x: number, y: number, w: number, h: number) => {
      const b = toCanvas(x, y, w, h);
      path = union(path, b);
      record("rect", b);
    },
    arc: (x: number, y: number, r: number) => {
      path = union(path, toCanvas(x - r, y - r, 2 * r, 2 * r));
    },
    clip: () => {
      if (path) st.clip = st.clip ? (meet(st.clip, path) ?? { x: 0, y: 0, w: 0, h: 0 }) : path;
    },
    fillRect: (x: number, y: number, w: number, h: number) => record("rect", toCanvas(x, y, w, h)),
    fillText: (s: string, x: number, y: number) => write(s, x, y),
    strokeText: (s: string, x: number, y: number) => write(s, x, y),
    measureText: (s: string) => ({ width: width(s) }),
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
      out.images++;
      record("image", toCanvas(x, y, w, h));
    },
    createLinearGradient: () => ({ addColorStop: () => {} }),
  };

  out.ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_, p) => (typeof p === "string" && p in calls ? calls[p] : p in st.props ? st.props[p] : () => {}),
    set: (_, p, v) => {
      st.props[p] = v;
      return true;
    },
    has: (_, p) => (typeof p === "string" && p in calls) || p in st.props,
  });
  return out;
}
