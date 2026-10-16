import { AbsoluteFill, useCurrentFrame } from "remotion";
import { endingOf, storyTimes, TEXTS } from "../../lib/shorts/timing";
import type { TextsParams } from "../../lib/shorts/types";
import { ANTON, Back, Backdrop, BODY, EndBand, face, lookOf, Outro, rise, size, Tag, textOn } from "./kit";

/**
 * One moment of a conversation, labelled STORY so nobody takes it for
 * someone's real texts. Once the screen fills, older messages scroll up
 * and out of the way.
 */
function TextsScene({ params, frame }: { params: TextsParams; frame: number }) {
  const L = lookOf(params);
  const { story } = params;
  const times = storyTimes(story.messages);
  const typing = times.findIndex((t) => t.typingFrom !== null && frame >= t.typingFrom && frame < t.at);
  const shown = story.messages.map((m, i) => ({ m, i, at: times[i].at })).filter((x) => frame >= x.at);

  return (
    <AbsoluteFill style={{ color: L.text }}>
      <Backdrop look={L} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 290, background: L.panel, borderBottom: `2px solid ${L.line}`, display: "flex", alignItems: "flex-end", padding: "0 70px 34px", gap: 26 }}>
        <span style={{ width: 104, height: 104, borderRadius: 52, background: L.raised, display: "flex", alignItems: "center", justifyContent: "center", ...face(L), fontSize: size(L, 58), color: L.text }}>{story.contact[0].toUpperCase()}</span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 52 }}>{story.contact}</span>
          <span style={{ fontFamily: BODY, fontSize: 30, color: L.dim }}>{typing >= 0 ? "typing…" : "online"}</span>
        </span>
        <span style={{ marginLeft: "auto", marginBottom: 14, fontFamily: ANTON, fontSize: 38, letterSpacing: 4, color: textOn(L.accent), background: L.accent, padding: "6px 18px", borderRadius: L.round / 3 }}>STORY</span>
      </div>

      <div style={{ position: "absolute", top: 300, bottom: 400, left: 0, right: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", gap: 22, padding: "30px 60px 20px" }}>
          {shown.map(({ m, i, at }) => {
            const k = rise(frame, at, 7);
            const bubble = m.me ? L.b : L.raised;
            return (
              <div key={i} style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start", maxHeight: `${k * 600}px`, overflow: "visible" }}>
                <span
                  style={{
                    maxWidth: 760,
                    padding: "22px 32px",
                    borderRadius: 44,
                    borderBottomRightRadius: m.me ? 12 : 44,
                    borderBottomLeftRadius: m.me ? 44 : 12,
                    background: bubble,
                    color: m.me ? textOn(bubble) : L.text,
                    fontFamily: BODY,
                    fontWeight: 500,
                    fontSize: 50,
                    lineHeight: 1.22,
                    transform: `scale(${0.85 + 0.15 * k})`,
                    transformOrigin: m.me ? "bottom right" : "bottom left",
                    opacity: k,
                  }}
                >
                  {m.text}
                </span>
              </div>
            );
          })}
          {typing >= 0 && (
            <div style={{ display: "flex" }}>
              <span style={{ display: "flex", gap: 14, padding: "30px 36px", borderRadius: 44, borderBottomLeftRadius: 12, background: L.raised }}>
                {[0, 1, 2].map((d) => (
                  <span key={d} style={{ width: 20, height: 20, borderRadius: 10, background: L.text, opacity: 0.35 + 0.65 * Math.max(0, Math.sin((frame / 6 - d * 0.9) % (Math.PI * 2))) }} />
                ))}
              </span>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** A made-up conversation, one message at a time. */
export function TextsVideo({ params, tag, total }: { params: TextsParams; tag: boolean; total: number }) {
  const frame = useCurrentFrame();
  const L = lookOf(params);
  const times = storyTimes(params.story.messages);
  const end = times[times.length - 1].at + TEXTS.hold;
  const ending = endingOf(params);

  return (
    <AbsoluteFill>
      <TextsScene params={params} frame={frame} />
      {ending === "loop" ? (
        <EndBand frame={frame} from={end} text="What would you reply?" look={L} top={320} />
      ) : (
        <Outro frame={frame} from={end} lines={["What would", "you reply?"]} small={ending === "comment" ? "Comment below" : undefined} look={L} />
      )}
      {ending === "loop" && (
        <Back frame={frame} total={total} look={L}>
          <TextsScene params={params} frame={0} />
        </Back>
      )}
      <Tag show={tag} look={L} />
    </AbsoluteFill>
  );
}
