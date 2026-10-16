import type { FormatId } from "./types";

/** Each format's colour, the same one its video leads with: for dots, keys and covers. */
export const FORMAT_COLOR: Record<FormatId, string> = { battle: "#ff4a1c", quiz: "#ffd60a", wyr: "#ff3b30", texts: "#34c759", ranking: "#0a84ff", race: "#bf5af2" };

/**
 * A channel's own look: its colours, its type and what's behind
 * everything. Each channel gets one no other channel has (see
 * lookNumber), so two channels' Shorts never look the same. It's kept in
 * every Short's parameters, so a Short always renders the way it was
 * approved, whatever happens to the list of looks later.
 */
export type Look = {
  /** which look this is; 0 is Hookline's own */
  id: number;
  bg: string;
  /** boxes on the background: answers, rows, the chat header */
  panel: string;
  /** a step up from a panel: the other person's messages */
  raised: string;
  line: string;
  text: string;
  dim: string;
  accent: string;
  /** a right answer */
  good: string;
  /** first place */
  gold: string;
  /** the two sides of a choice */
  a: string;
  b: string;
  /** the display face: Anton, or Bricolage Grotesque at its heaviest */
  face: "anton" | "grotesk";
  /** headings in capitals, or as written */
  caps: boolean;
  backdrop: Backdrop;
  /** rounding on boxes, in pixels */
  round: number;
  /** degrees the backdrop is turned past the first 330 looks, so those still differ (see backdropLayer) */
  tilt: number;
};

export const BACKDROPS = ["plain", "grid", "dots", "stripes", "glow"] as const;
export type Backdrop = (typeof BACKDROPS)[number];

type Palette = Pick<Look, "bg" | "panel" | "raised" | "line" | "text" | "dim" | "accent" | "good" | "gold" | "a" | "b">;

/** The palettes, dark and light. The first is Hookline's own. Every one is checked for contrast in the tests. */
export const PALETTES: Palette[] = [
  { bg: "#0B0B0C", panel: "#161618", raised: "#232326", line: "#2C2C30", text: "#F4F1EA", dim: "#8D8A83", accent: "#FF4A1C", good: "#34C759", gold: "#FFD60A", a: "#FF3B30", b: "#0A84FF" },
  { bg: "#0D1B2A", panel: "#15263A", raised: "#1F3550", line: "#2A4466", text: "#EEF4FB", dim: "#8EA4BF", accent: "#FFC145", good: "#3DDC97", gold: "#FFD166", a: "#E63E62", b: "#1479B8" },
  { bg: "#F4F1EA", panel: "#FFFFFF", raised: "#E8E3D8", line: "#D6CFC1", text: "#141414", dim: "#5F5A53", accent: "#C8340F", good: "#11803F", gold: "#9A6512", a: "#C8243A", b: "#1D5FA8" },
  { bg: "#0E1F17", panel: "#163024", raised: "#1F4030", line: "#2B5440", text: "#EDF6EE", dim: "#95B39E", accent: "#C8F031", good: "#5BE38C", gold: "#F2C14E", a: "#D9483B", b: "#2F7FD8" },
  { bg: "#1A0D22", panel: "#281533", raised: "#36204A", line: "#4A2C63", text: "#F8ECFF", dim: "#B49CC6", accent: "#FF6EC7", good: "#4BE3A1", gold: "#FFD166", a: "#E0434F", b: "#5B63E8" },
  { bg: "#EFE4D0", panel: "#FAF4E8", raised: "#E2D3B8", line: "#D1BE9C", text: "#2A1D10", dim: "#62513D", accent: "#A8360A", good: "#2A6E2D", gold: "#835A00", a: "#B42318", b: "#1E4FD8" },
  { bg: "#052A33", panel: "#0A3A46", raised: "#114B5A", line: "#1D6172", text: "#E6FAFF", dim: "#8DBAC4", accent: "#FFB703", good: "#8BE07A", gold: "#FFD166", a: "#E04E0E", b: "#2F73E0" },
  { bg: "#190D09", panel: "#2A1711", raised: "#3A2219", line: "#4D2E22", text: "#FFF2E8", dim: "#C4A08D", accent: "#FF9F1C", good: "#7BD389", gold: "#FFD166", a: "#D33340", b: "#2C7FC8" },
  { bg: "#E4F3EC", panel: "#FFFFFF", raised: "#D2EADF", line: "#B6D9C8", text: "#0D261B", dim: "#46604F", accent: "#B3164F", good: "#13703A", gold: "#7A5F00", a: "#C62828", b: "#1E5BB8" },
  { bg: "#1C2127", panel: "#252C34", raised: "#303945", line: "#3C4754", text: "#F1F5F9", dim: "#9AA6B2", accent: "#22D3EE", good: "#4ADE80", gold: "#FACC15", a: "#E11D48", b: "#4F46E5" },
  { bg: "#FFF4C7", panel: "#FFFDF2", raised: "#F5E7A8", line: "#E6D27F", text: "#1B1A14", dim: "#5A5335", accent: "#C02626", good: "#16733A", gold: "#7E5200", a: "#B83A0B", b: "#1D4ED8" },
];

/** The type: Anton in capitals, or the grotesque in capitals or as written. */
export const TYPES: Pick<Look, "face" | "caps">[] = [
  { face: "anton", caps: true },
  { face: "grotesk", caps: true },
  { face: "grotesk", caps: false },
];

export const ROUNDS = [0, 28];

/**
 * How many looks there are before any repeats a palette, type, backdrop
 * and rounding together. Their counts have no common factor, so look n
 * and look n+1 differ in all four; past this, the backdrop turns too.
 */
export const BASE_LOOKS = PALETTES.length * TYPES.length * BACKDROPS.length * ROUNDS.length;

/**
 * How many look numbers are all different from each other: 90 turns of
 * the 330, since a grid or dots turned a quarter of the way round is the
 * same grid or dots again.
 */
export const DIFFERENT_LOOKS = BASE_LOOKS * 90;

/** Look number n. The first DIFFERENT_LOOKS of them all look different. */
export function lookNumber(n: number): Look {
  const id = Math.max(0, Math.floor(n));
  const round = Math.floor(id / BASE_LOOKS);
  return {
    id,
    ...PALETTES[id % PALETTES.length],
    ...TYPES[id % TYPES.length],
    backdrop: BACKDROPS[id % BACKDROPS.length],
    round: ROUNDS[id % ROUNDS.length],
    tilt: round === 0 ? 0 : (round * 37) % 180 || 1,
  };
}

/** Hookline's own look: Shorts made before channels had their own, and the website's. */
export const HOOKLINE: Look = lookNumber(0);

/**
 * What's drawn behind everything, as CSS: nothing (plain), a grid, dots,
 * stripes or a glow. Past the first 330 looks the backdrop turns: a
 * pattern is turned (a grid or dots only as far as a quarter turn, since
 * that's all of them), the glow moves round, and a plain one gets a wash
 * of the accent from that side, so no two looks draw the same.
 */
export function backdropLayer(look: Look): { background: string; transform?: string } | null {
  const c = alpha(look.text, 0.06);
  const t = look.tilt;
  const turn = (deg: number) => (t ? { transform: `rotate(${deg}deg) scale(1.6)` } : {});
  switch (look.backdrop) {
    case "plain":
      return t ? { background: `linear-gradient(${t}deg, ${alpha(look.accent, 0.16)}, transparent 55%)` } : null;
    case "grid":
      return { background: `linear-gradient(${c} 2px, transparent 2px) 0 0 / 60px 60px, linear-gradient(90deg, ${c} 2px, transparent 2px) 0 0 / 60px 60px`, ...turn(t % 90) };
    case "dots":
      return { background: `radial-gradient(circle, ${alpha(look.text, 0.1)} 3px, transparent 3.5px) 0 0 / 44px 44px`, ...turn(t % 90) };
    case "stripes":
      return { background: `repeating-linear-gradient(45deg, ${c} 0 18px, transparent 18px 54px)`, ...turn(t) };
    case "glow": {
      // round an ellipse as it turns, so every turn puts it somewhere else
      const at = t ? `${(50 + 26 * Math.cos((t * Math.PI) / 90)).toFixed(1)}% ${(30 + 14 * Math.sin((t * Math.PI) / 90)).toFixed(1)}%` : "50% 18%";
      return { background: `radial-gradient(circle at ${at}, ${alpha(look.accent, 0.22)}, transparent 62%)` };
    }
  }
}

/** How bright a colour looks, 0 to 1, the way WCAG measures it. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two colours, 1 to 21. */
export function contrast(x: string, y: string): number {
  const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
}

/** White on a colour where big white text reads, near-black where it doesn't. */
export function textOn(hex: string): string {
  return contrast(hex, "#FFFFFF") >= 3 ? "#FFFFFF" : "#0B0B0C";
}

/** A colour at some opacity, for CSS and SVG. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

export const isLight = (look: Pick<Look, "bg">) => luminance(look.bg) > 0.4;
