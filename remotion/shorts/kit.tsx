import { loadFont } from "@remotion/fonts";
import { interpolate, staticFile } from "remotion";

/**
 * What every Short shares: the brand's two typefaces (shipped with the
 * app, so a render never waits on a font server), its colours, and the
 * free plan's tag. Text that matters stays inside the area Shorts and
 * TikTok don't cover with their own buttons.
 */

export const ANTON = "Anton";
export const BODY = "Bricolage Grotesque";

if (typeof window !== "undefined") {
  loadFont({ family: ANTON, url: staticFile("fonts/Anton-Regular.woff2"), weight: "400" });
  loadFont({ family: BODY, url: staticFile("fonts/Bricolage-Grotesque.woff2"), weight: "200 800" });
}

export const W = 1080;
export const H = 1920;
export const INK = "#0B0B0C";
export const INK2 = "#161618";
export const INK3 = "#232326";
export const PAPER = "#F4F1EA";
export const DIM = "#8D8A83";
export const SIGNAL = "#FF4A1C";
export const GREEN = "#34C759";
export const RED = "#FF3B30";
export const BLUE = "#0A84FF";
export const GOLD = "#FFD60A";

/** room the platforms' own buttons take: keep what matters out of it */
export const SAFE = { top: 150, bottom: 1500, left: 70, right: 970 };

/** Dark text on light colours, light text on dark ones. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? INK : "#FFFFFF";
}

/** 0 to 1 over `len` frames from `from`, eased out. */
export function rise(frame: number, from: number, len = 10): number {
  const k = interpolate(frame, [from, from + len], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return 1 - (1 - k) ** 3;
}

export function Tag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div style={{ position: "absolute", bottom: 54, width: "100%", textAlign: "center", fontFamily: ANTON, fontSize: 34, letterSpacing: 3, color: PAPER, opacity: 0.6 }}>
      MADE WITH HOOKLINE
    </div>
  );
}

/** A big closing line, over everything. */
export function Outro({ frame, from, lines, small }: { frame: number; from: number; lines: string[]; small?: string }) {
  const k = rise(frame, from, 12);
  if (k <= 0) return null;
  return (
    <div style={{ position: "absolute", inset: 0, background: `rgba(11,11,12,${0.88 * k})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "0 90px" }}>
      {lines.map((l, i) => (
        <div key={l} style={{ fontFamily: ANTON, fontSize: i === 0 ? 132 : 104, lineHeight: 0.95, color: i === 0 ? PAPER : SIGNAL, textAlign: "center", transform: `scale(${0.7 + 0.3 * rise(frame, from + i * 5, 12)})`, opacity: rise(frame, from + i * 5, 8) }}>
          {l}
        </div>
      ))}
      {small && <div style={{ marginTop: 34, fontFamily: ANTON, fontSize: 48, letterSpacing: 3, color: PAPER, opacity: 0.7 * k }}>{small}</div>}
    </div>
  );
}

/** Text that shrinks to fit: a long question gets smaller instead of overflowing. */
export function fit(text: string, base: number, perLine: number, lines: number): number {
  const need = Math.ceil(text.length / perLine);
  return need <= lines ? base : Math.max(base * 0.62, (base * lines) / need);
}

/** A tick, drawn: the display face has no glyph for one. */
export function Check({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3.6} strokeLinecap="square" aria-hidden="true">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}
