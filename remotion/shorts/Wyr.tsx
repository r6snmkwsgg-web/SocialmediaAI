import { AbsoluteFill, useCurrentFrame } from "remotion";
import { endingOf, WYR } from "../../lib/shorts/timing";
import type { WyrParams } from "../../lib/shorts/types";
import { Back, Backdrop, caps, EndBand, face, fit, lookOf, Opening, Outro, rise, size, Tag, textOn, W } from "./kit";

/** One moment of a would-you-rather: two choices, top and bottom, and a clock. The first choice is there from the first frame. */
function WyrScene({ params, frame }: { params: WyrParams; frame: number }) {
  const L = lookOf(params);
  const n = params.pairs.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor((frame - WYR.intro) / WYR.each)));
  const local = frame - WYR.intro - i * WYR.each;
  const p = params.pairs[i];
  const inA = i === 0 ? 1 : rise(local, 0, 10), inB = i === 0 ? 1 : rise(local, 4, 10);
  const left = Math.max(0, 1 - local / WYR.each);
  const comments = params.allowComments !== false;

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
      <span style={{ position: "absolute", top: top ? 200 : 70, left: 70, fontSize: size(L, 64), color: textOn(color), opacity: 0.55 }}>{letter}</span>
      <span style={{ fontSize: size(L, fit(text, 112, 14, 3)), lineHeight: 1.02, textAlign: "center", color: textOn(color) }}>{caps(L, text)}</span>
    </div>
  );

  return (
    <AbsoluteFill style={{ color: L.text, ...face(L) }}>
      <Backdrop look={L} />
      {half(p.a, L.a, "A", inA, true)}
      {half(p.b, L.b, "B", inB, false)}
      <div style={{ position: "absolute", left: 0, top: 952, height: 16, width: `${left * 100}%`, background: L.text, opacity: 0.85 }} />
      <div style={{ position: "absolute", left: W / 2 - 110, top: 850, width: 220, height: 220, borderRadius: 110, background: L.bg, border: `10px solid ${L.text}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size(L, 96), transform: `scale(${i === 0 ? 1 : rise(local, 8, 10)})` }}>
        {caps(L, "or")}
      </div>
      <div style={{ position: "absolute", top: 120, width: "100%", textAlign: "center", fontSize: size(L, 50), letterSpacing: L.face === "anton" ? 4 : 0, color: textOn(L.a) }}>
        {i + 1} / {n} · {caps(L, comments ? "Comment A or B" : "A or B?")}
      </div>
      <Opening frame={frame} look={L} lines={["Would you rather", `${n} choices`]} top={830} />
    </AbsoluteFill>
  );
}

/** Two choices at a time. The comments are the poll. */
export function WyrVideo({ params, tag, total }: { params: WyrParams; tag: boolean; total: number }) {
  const frame = useCurrentFrame();
  const L = lookOf(params);
  const n = params.pairs.length;
  const end = WYR.intro + n * WYR.each;
  const ending = endingOf(params);

  return (
    <AbsoluteFill>
      <WyrScene params={params} frame={Math.min(frame, end - 1)} />
      {ending === "loop" ? (
        <EndBand frame={frame} from={end} text="Which ones did you pick?" look={L} top={880} />
      ) : ending === "comment" ? (
        <Outro frame={frame} from={end} lines={["Comment", `all ${n} picks`]} small={`Like this: ${"ABBAB".slice(0, n)}`} look={L} />
      ) : (
        <Outro frame={frame} from={end} lines={["Which ones", "did you pick?"]} look={L} />
      )}
      {ending === "loop" && (
        <Back frame={frame} total={total} look={L}>
          <WyrScene params={params} frame={0} />
        </Back>
      )}
      <Tag show={tag} look={L} />
    </AbsoluteFill>
  );
}
