import { AbsoluteFill, useCurrentFrame } from "remotion";
import { say } from "../../lib/shorts/data";
import { rankingTitle } from "../../lib/shorts/formats/ranking";
import { RANKING } from "../../lib/shorts/timing";
import type { RankingParams } from "../../lib/shorts/types";
import { ANTON, BODY, DIM, GOLD, INK, INK2, Outro, PAPER, rise, SAFE, SIGNAL, Tag, W } from "./kit";

/** A countdown from the bottom of the list to #1, with the source on screen the whole time. */
export function RankingVideo({ params, tag }: { params: RankingParams; tag: boolean }) {
  const frame = useCurrentFrame();
  const n = params.items.length;
  const title = rankingTitle(params.metric, params.region, n, params.year).replace(/ \(\d+\)$/, "");
  const max = params.items[0].value;
  const step = Math.floor((frame - RANKING.intro) / RANKING.each);
  // revealed from the bottom up: step 0 is #n
  const revealedFrom = n - 1 - step;
  const outroAt = RANKING.intro + n * RANKING.each;
  const rowH = Math.min(108, Math.floor(1130 / n) - 10);

  return (
    <AbsoluteFill style={{ background: INK, color: PAPER, fontFamily: ANTON }}>
      {frame < RANKING.intro ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 90px", gap: 30 }}>
          <div style={{ fontSize: 120, lineHeight: 0.98, textAlign: "center", transform: `scale(${0.7 + 0.3 * rise(frame, 0, 12)})`, opacity: rise(frame, 0, 8) }}>{title.toUpperCase()}</div>
          <div style={{ fontSize: 64, color: INK, background: SIGNAL, padding: "4px 26px", opacity: rise(frame, 14, 8) }}>{params.year}</div>
          <div style={{ fontSize: 50, letterSpacing: 4, color: DIM, opacity: rise(frame, 22, 8) }}>COUNTDOWN FROM #{n}</div>
        </div>
      ) : (
        <>
          <div style={{ position: "absolute", top: SAFE.top - 10, left: SAFE.left, right: W - SAFE.right, fontSize: 62, lineHeight: 1, textAlign: "center" }}>{title.toUpperCase()}</div>
          <div style={{ position: "absolute", top: SAFE.top + 128, left: SAFE.left, right: W - SAFE.right, textAlign: "center", fontFamily: BODY, fontSize: 30, color: DIM }}>{params.source}</div>
          <div style={{ position: "absolute", top: 330, left: SAFE.left, right: W - SAFE.right, display: "flex", flexDirection: "column", gap: 10 }}>
            {params.items.map((it, i) => {
              const at = RANKING.intro + (n - 1 - i) * RANKING.each;
              const k = rise(frame, at, 10);
              const now = i === revealedFrom && frame < outroAt;
              const first = i === 0;
              return (
                <div key={it.iso} style={{ position: "relative", height: rowH, display: "flex", alignItems: "center", gap: 22, padding: "0 26px", background: INK2, border: `4px solid ${now ? SIGNAL : first && frame >= at ? GOLD : "#26262a"}`, opacity: k, transform: `translateX(${(1 - k) * 140}px)` }}>
                  <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(it.value / max) * 100}%`, background: first ? GOLD : SIGNAL, opacity: 0.18 }} />
                  <span style={{ position: "relative", width: 96, fontSize: rowH * 0.62, color: first ? GOLD : PAPER }}>#{i + 1}</span>
                  <span style={{ position: "relative", flex: 1, fontSize: rowH * 0.5, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name.toUpperCase()}</span>
                  <span style={{ position: "relative", fontFamily: BODY, fontWeight: 700, fontSize: rowH * 0.36, color: PAPER }}>{say(params.metric, it.value)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      <Outro frame={frame} from={outroAt + 30} lines={["DID ANY", "SURPRISE YOU?"]} small="COMMENT BELOW" />
      <Tag show={tag} />
    </AbsoluteFill>
  );
}
