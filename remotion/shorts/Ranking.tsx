import { AbsoluteFill, useCurrentFrame } from "remotion";
import { say } from "../../lib/shorts/data";
import { rankingTitle } from "../../lib/shorts/formats/ranking";
import { alpha } from "../../lib/shorts/look";
import { endingOf, RANKING } from "../../lib/shorts/timing";
import type { RankingParams } from "../../lib/shorts/types";
import { Back, Backdrop, BODY, caps, face, lookOf, Opening, Outro, rise, SAFE, size, Tag, W } from "./kit";

/** One moment of a countdown from the bottom of the list to #1, with the source on screen the whole time. */
function RankingScene({ params, frame }: { params: RankingParams; frame: number }) {
  const L = lookOf(params);
  const n = params.items.length;
  const title = rankingTitle(params.metric, params.region, n, params.year).replace(/ \(\d+\)$/, "");
  const max = params.items[0].value;
  const step = Math.floor((frame - RANKING.intro) / RANKING.each);
  // revealed from the bottom up: step 0 is #n
  const revealedFrom = n - 1 - step;
  const end = RANKING.intro + n * RANKING.each;
  const rowH = Math.min(108, Math.floor(1130 / n) - 10);

  return (
    <AbsoluteFill style={{ color: L.text, ...face(L) }}>
      <Backdrop look={L} />
      <div style={{ position: "absolute", top: SAFE.top - 10, left: SAFE.left, right: W - SAFE.right, fontSize: size(L, 62), lineHeight: 1.02, textAlign: "center" }}>{caps(L, `${title}, ${params.year}`)}</div>
      <div style={{ position: "absolute", top: SAFE.top + 128, left: SAFE.left, right: W - SAFE.right, textAlign: "center", fontFamily: BODY, fontWeight: 400, fontSize: 30, color: L.dim }}>{params.source}</div>
      <div style={{ position: "absolute", top: 330, left: SAFE.left, right: W - SAFE.right, display: "flex", flexDirection: "column", gap: 10 }}>
        {params.items.map((it, i) => {
          const at = RANKING.intro + (n - 1 - i) * RANKING.each;
          // the bottom of the list is there from the first frame
          const k = i === n - 1 ? 1 : rise(frame, at, 10);
          const now = i === revealedFrom && frame < end;
          const first = i === 0;
          return (
            <div key={it.iso} style={{ position: "relative", height: rowH, display: "flex", alignItems: "center", gap: 22, padding: "0 26px", background: L.panel, border: `4px solid ${now ? L.accent : first && frame >= at ? L.gold : L.line}`, borderRadius: L.round / 2, overflow: "hidden", opacity: k, transform: `translateX(${(1 - k) * 140}px)` }}>
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(it.value / max) * 100}%`, background: alpha(first ? L.gold : L.accent, 0.18) }} />
              <span style={{ position: "relative", width: 96, fontSize: size(L, rowH * 0.62), color: first ? L.gold : L.text }}>#{i + 1}</span>
              <span style={{ position: "relative", flex: 1, fontSize: size(L, rowH * 0.5), lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{caps(L, it.name)}</span>
              <span style={{ position: "relative", fontFamily: BODY, fontWeight: 700, fontSize: rowH * 0.36, color: L.text }}>{say(params.metric, it.value)}</span>
            </div>
          );
        })}
      </div>
      <Opening frame={frame} look={L} lines={[title, `${params.year}. Countdown from #${n}`]} top={560} />
    </AbsoluteFill>
  );
}

/** A countdown to #1. */
export function RankingVideo({ params, tag, total }: { params: RankingParams; tag: boolean; total: number }) {
  const frame = useCurrentFrame();
  const L = lookOf(params);
  const end = RANKING.intro + params.items.length * RANKING.each;
  const ending = endingOf(params);

  return (
    <AbsoluteFill>
      <RankingScene params={params} frame={frame} />
      {ending !== "loop" && <Outro frame={frame} from={end + 30} lines={["Did any", "surprise you?"]} small={ending === "comment" ? "Comment below" : undefined} look={L} />}
      {ending === "loop" && (
        <Back frame={frame} total={total} look={L}>
          <RankingScene params={params} frame={0} />
        </Back>
      )}
      <Tag show={tag} look={L} />
    </AbsoluteFill>
  );
}
