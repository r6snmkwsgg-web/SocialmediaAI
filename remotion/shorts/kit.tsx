import type { CSSProperties, ReactNode } from "react";
import { loadFont } from "@remotion/fonts";
import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { alpha, backdropLayer, HOOKLINE, textOn as onColour, type Look } from "../../lib/shorts/look";
import { BACK, TITLE } from "../../lib/shorts/timing";
import type { Finish } from "../../lib/shorts/types";

/**
 * What every Short shares: the brand's two typefaces (shipped with the
 * app, so a render never waits on a font server), the channel's look, the
 * title over the opening, the endings, and the free plan's tag. Text that
 * matters stays inside the area Shorts and TikTok don't cover with their
 * own buttons.
 */

export const ANTON = "Anton";
export const BODY = "Bricolage Grotesque";

if (typeof window !== "undefined") {
  loadFont({ family: ANTON, url: staticFile("fonts/Anton-Regular.woff2"), weight: "400" });
  loadFont({ family: BODY, url: staticFile("fonts/Bricolage-Grotesque.woff2"), weight: "200 800" });
}

export const W = 1080;
export const H = 1920;
// Hookline's own colours, for the share images
export const INK = HOOKLINE.bg;
export const PAPER = HOOKLINE.text;
export const SIGNAL = HOOKLINE.accent;

/** room the platforms' own buttons take: keep what matters out of it */
export const SAFE = { top: 150, bottom: 1500, left: 70, right: 970 };

export const textOn = onColour;

/** The look a Short is drawn in: its channel's, or Hookline's own for Shorts made before channels had one. */
export const lookOf = (p: Finish): Look => p.look ?? HOOKLINE;

/** The display face, at its weight. */
export function face(look: Look): CSSProperties {
  return look.face === "anton" ? { fontFamily: ANTON, fontWeight: 400 } : { fontFamily: BODY, fontWeight: 800, letterSpacing: "-0.01em" };
}

/** A display size in a look: the grotesque is much wider than Anton, so it's set smaller to take the same room. */
export const size = (look: Look, px: number) => (look.face === "anton" ? px : Math.round(px * (look.caps ? 0.68 : 0.8)));

/** A heading as the look sets them: in capitals, or as written. */
export const caps = (look: Look, text: string) => (look.caps ? text.toUpperCase() : text);

/** 0 to 1 over `len` frames from `from`, eased out. */
export function rise(frame: number, from: number, len = 10): number {
  const k = interpolate(frame, [from, from + len], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return 1 - (1 - k) ** 3;
}

/** What's behind everything: plain, a grid, dots, stripes or a glow, turned in the later looks (see backdropLayer). */
export function Backdrop({ look }: { look: Look }) {
  const layer = backdropLayer(look);
  return (
    <AbsoluteFill style={{ background: look.bg, overflow: "hidden" }}>
      {layer && <div style={{ position: "absolute", inset: 0, ...layer }} />}
    </AbsoluteFill>
  );
}

export function Tag({ show, look = HOOKLINE }: { show: boolean; look?: Look }) {
  if (!show) return null;
  return (
    <div style={{ position: "absolute", bottom: 54, width: "100%", textAlign: "center", fontFamily: ANTON, fontSize: 34, letterSpacing: 3, color: look.text, opacity: 0.6 }}>
      MADE WITH HOOKLINE
    </div>
  );
}

/**
 * The title over the opening: there from the first frame, over the
 * action rather than before it, and gone after a second and a half.
 */
export function Opening({ frame, look, lines, top }: { frame: number; look: Look; lines: string[]; top: number }) {
  if (frame >= TITLE) return null;
  const k = 1 - rise(frame, TITLE - 9, 9);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, opacity: k, transform: `translateY(${(1 - k) * -40}px)` }}>
      {lines.map((l, i) => (
        <div
          key={l}
          style={{
            ...face(look),
            fontSize: size(look, i === 0 ? 104 : 60),
            lineHeight: 1.04,
            padding: i === 0 ? "10px 34px" : "6px 26px",
            background: i === 0 ? look.accent : look.text,
            color: i === 0 ? textOn(look.accent) : look.bg,
            borderRadius: look.round / 2,
            transform: `rotate(${i === 0 ? -2 : 1.5}deg)`,
            maxWidth: 940,
            textAlign: "center",
          }}
        >
          {caps(look, l)}
        </div>
      ))}
    </div>
  );
}

/** A big closing line, over everything. */
export function Outro({ frame, from, lines, small, look = HOOKLINE }: { frame: number; from: number; lines: string[]; small?: string; look?: Look }) {
  const k = rise(frame, from, 12);
  if (k <= 0) return null;
  return (
    <div style={{ position: "absolute", inset: 0, background: alpha(look.bg, 0.88 * k), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "0 90px" }}>
      {lines.map((l, i) => (
        <div key={l} style={{ ...face(look), fontSize: size(look, i === 0 ? 132 : 104), lineHeight: 0.98, color: i === 0 ? look.text : look.accent, textAlign: "center", transform: `scale(${0.7 + 0.3 * rise(frame, from + i * 5, 12)})`, opacity: rise(frame, from + i * 5, 8) }}>
          {caps(look, l)}
        </div>
      ))}
      {small && <div style={{ marginTop: 34, ...face(look), fontSize: size(look, 48), letterSpacing: look.face === "anton" ? 3 : 0, color: look.text, opacity: 0.7 * k }}>{caps(look, small)}</div>}
    </div>
  );
}

/** A line across the screen while a looping Short holds its end, before it runs back to the start. */
export function EndBand({ frame, from, text, look, top }: { frame: number; from: number; text: string; look: Look; top: number }) {
  const k = rise(frame, from, 8);
  if (k <= 0) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, display: "flex", justifyContent: "center", opacity: k, transform: `scale(${0.85 + 0.15 * k})` }}>
      <div style={{ ...face(look), fontSize: size(look, 84), lineHeight: 1.04, padding: "10px 34px", background: look.accent, color: textOn(look.accent), borderRadius: look.round / 2, maxWidth: 940, textAlign: "center" }}>
        {caps(look, text)}
      </div>
    </div>
  );
}

/**
 * The run back to the start, for a Short that loops: the opening slides
 * up over the end and lands exactly where the video begins, so when the
 * platform plays it again there's no seam.
 */
export function Back({ frame, total, look, children }: { frame: number; total: number; look: Look; children: ReactNode }) {
  const from = total - BACK;
  if (frame < from) return null;
  const t = Math.min(1, (frame - from) / (BACK - 1));
  const k = t * t * (3 - 2 * t);
  return <AbsoluteFill style={{ background: look.bg, transform: `translateY(${(1 - k) * H}px)` }}>{children}</AbsoluteFill>;
}

/** Text that shrinks to fit: a long question gets smaller instead of overflowing. */
export function fit(text: string, base: number, perLine: number, lines: number): number {
  const need = Math.ceil(text.length / perLine);
  return need <= lines ? base : Math.max(base * 0.62, (base * lines) / need);
}

/** A tick, drawn: the display face has no glyph for one. */
export function Check({ size: px, color }: { size: number; color: string }) {
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3.6} strokeLinecap="square" aria-hidden="true">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}
