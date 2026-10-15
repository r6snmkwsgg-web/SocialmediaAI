import { AbsoluteFill, useCurrentFrame } from "remotion";
import { WYR } from "../../lib/shorts/timing";
import type { WyrParams } from "../../lib/shorts/types";
import { ANTON, BLUE, fit, INK, Outro, PAPER, RED, rise, SIGNAL, Tag, W } from "./kit";

/** Two choices, top and bottom, and a clock. The comments are the poll. */
export function WyrVideo({ params, tag }: { params: WyrParams; tag: boolean }) {
  const frame = useCurrentFrame();
  const n = params.pairs.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor((frame - WYR.intro) / WYR.each)));
  const local = frame - WYR.intro - i * WYR.each;
  const p = params.pairs[i];
  const inA = rise(local, 0, 10), inB = rise(local, 4, 10);
  const left = Math.max(0, 1 - local / WYR.each);
  const outroAt = WYR.intro + n * WYR.each;

  const half = (text: string, color: string, letter: string, k: number, top: boolean) => (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: top ? 0 : 960,
        height: 960,
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: top ? "220px 110px 110px" : "110px 110px 380px",
        transform: `translateX(${(top ? -1 : 1) * (1 - k) * W}px)`,
      }}
    >
      <span style={{ position: "absolute", top: top ? 200 : 70, left: 70, fontSize: 64, color: INK, opacity: 0.55 }}>{letter}</span>
      <span style={{ fontSize: fit(text, 112, 14, 3), lineHeight: 1, textAlign: "center", color: "#FFFFFF" }}>{text.toUpperCase()}</span>
    </div>
  );

  return (
    <AbsoluteFill style={{ background: INK, color: PAPER, fontFamily: ANTON }}>
      {frame < WYR.intro ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {["WOULD", "YOU", "RATHER"].map((t, k) => (
            <div key={t} style={{ fontSize: 250, lineHeight: 0.92, color: k === 2 ? SIGNAL : PAPER, transform: `translateY(${(1 - rise(frame, k * 6, 10)) * 120}px)`, opacity: rise(frame, k * 6, 8) }}>
              {t}
            </div>
          ))}
        </div>
      ) : (
        <>
          {half(p.a, RED, "A", inA, true)}
          {half(p.b, BLUE, "B", inB, false)}
          <div style={{ position: "absolute", left: 0, top: 952, height: 16, width: `${left * 100}%`, background: PAPER, opacity: 0.85 }} />
          <div style={{ position: "absolute", left: W / 2 - 110, top: 850, width: 220, height: 220, borderRadius: 110, background: INK, border: `10px solid ${PAPER}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 96, transform: `scale(${rise(local, 8, 10)})` }}>
            OR
          </div>
          <div style={{ position: "absolute", top: 120, width: "100%", textAlign: "center", fontSize: 50, letterSpacing: 4, color: INK }}>
            {i + 1} / {n} · COMMENT A OR B
          </div>
        </>
      )}
      <Outro frame={frame} from={outroAt} lines={["COMMENT", `ALL ${n} PICKS`]} small={`LIKE THIS: ${"ABBAB".slice(0, n)}`} />
      <Tag show={tag} />
    </AbsoluteFill>
  );
}
