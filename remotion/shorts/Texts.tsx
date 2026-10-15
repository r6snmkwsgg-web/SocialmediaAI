import { AbsoluteFill, useCurrentFrame } from "remotion";
import { storyTimes, TEXTS } from "../../lib/shorts/timing";
import type { TextsParams } from "../../lib/shorts/types";
import { ANTON, BLUE, BODY, DIM, INK, INK3, Outro, PAPER, rise, SIGNAL, Tag } from "./kit";

/**
 * A conversation, one message at a time, labelled STORY so nobody takes it
 * for someone's real texts. Once the screen fills, older messages scroll
 * up and out of the way.
 */
export function TextsVideo({ params, tag }: { params: TextsParams; tag: boolean }) {
  const frame = useCurrentFrame();
  const { story } = params;
  const times = storyTimes(story.messages);
  const last = times[times.length - 1].at;
  const typing = times.findIndex((t) => t.typingFrom !== null && frame >= t.typingFrom && frame < t.at);
  const shown = story.messages.map((m, i) => ({ m, i, at: times[i].at })).filter((x) => frame >= x.at);

  return (
    <AbsoluteFill style={{ background: INK, color: PAPER }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 290, background: "#141416", borderBottom: "2px solid #26262a", display: "flex", alignItems: "flex-end", padding: "0 70px 34px", gap: 26 }}>
        <span style={{ width: 104, height: 104, borderRadius: 52, background: INK3, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: ANTON, fontSize: 58, color: PAPER }}>{story.contact[0].toUpperCase()}</span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 52 }}>{story.contact}</span>
          <span style={{ fontFamily: BODY, fontSize: 30, color: DIM }}>{typing >= 0 ? "typing…" : "online"}</span>
        </span>
        <span style={{ marginLeft: "auto", marginBottom: 14, fontFamily: ANTON, fontSize: 38, letterSpacing: 4, color: INK, background: SIGNAL, padding: "6px 18px" }}>STORY</span>
      </div>

      <div style={{ position: "absolute", top: 300, bottom: 400, left: 0, right: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", gap: 22, padding: "30px 60px 20px" }}>
          {shown.map(({ m, i, at }) => {
            const k = rise(frame, at, 7);
            return (
              <div key={i} style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start", maxHeight: `${k * 600}px`, overflow: "visible" }}>
                <span
                  style={{
                    maxWidth: 760,
                    padding: "22px 32px",
                    borderRadius: 44,
                    borderBottomRightRadius: m.me ? 12 : 44,
                    borderBottomLeftRadius: m.me ? 44 : 12,
                    background: m.me ? BLUE : INK3,
                    color: "#FFFFFF",
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
              <span style={{ display: "flex", gap: 14, padding: "30px 36px", borderRadius: 44, borderBottomLeftRadius: 12, background: INK3 }}>
                {[0, 1, 2].map((d) => (
                  <span key={d} style={{ width: 20, height: 20, borderRadius: 10, background: PAPER, opacity: 0.35 + 0.65 * Math.max(0, Math.sin((frame / 6 - d * 0.9) % (Math.PI * 2))) }} />
                ))}
              </span>
            </div>
          )}
        </div>
      </div>

      <Outro frame={frame} from={last + TEXTS.hold} lines={["WHAT WOULD", "YOU REPLY?"]} small="COMMENT BELOW" />
      <Tag show={tag} />
    </AbsoluteFill>
  );
}
