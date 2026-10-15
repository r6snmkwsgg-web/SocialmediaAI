import { AbsoluteFill, Freeze } from "remotion";
import type { Spec } from "../lib/shorts/types";
import { ANTON, INK, PAPER, SIGNAL } from "./shorts/kit";
import { ShortVideo } from "./shorts/Short";

export type OgProps = { kicker: string; lines: [string, string]; spec: Spec; frame: number };

/**
 * The picture a link to Hookline shows when it's shared: the line that
 * matters, and a real frame of a real Short beside it, drawn by the same
 * composition the videos are.
 */
export function OgCard({ kicker, lines, spec, frame }: OgProps) {
  const scale = 0.27;
  return (
    <AbsoluteFill style={{ background: INK, fontFamily: ANTON, color: PAPER }}>
      <div style={{ position: "absolute", left: 70, top: 70, right: 470, bottom: 70, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ fontSize: 26, letterSpacing: 6, color: SIGNAL }}>{kicker.toUpperCase()}</div>
        <div style={{ fontSize: 96, lineHeight: 0.95 }}>
          <div>{lines[0].toUpperCase()}</div>
          <div style={{ color: SIGNAL }}>{lines[1].toUpperCase()}</div>
        </div>
        <div style={{ fontSize: 40, letterSpacing: 4 }}>HOOKLINE</div>
      </div>
      <div style={{ position: "absolute", right: 90, top: 34, width: 1080 * scale + 20, height: 1920 * scale + 20, borderRadius: 34, background: "#19191b", padding: 10, transform: "rotate(4deg)" }}>
        <div style={{ width: 1080 * scale, height: 1920 * scale, overflow: "hidden", borderRadius: 26, position: "relative" }}>
          <div style={{ width: 1080, height: 1920, transform: `scale(${scale})`, transformOrigin: "top left", position: "absolute" }}>
            <Freeze frame={frame}>
              <ShortVideo spec={spec} tag={false} />
            </Freeze>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
