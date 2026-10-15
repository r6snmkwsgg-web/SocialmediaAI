import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { say } from "../../lib/shorts/data";
import { raceTitle } from "../../lib/shorts/formats/race";
import { RACE } from "../../lib/shorts/timing";
import type { RaceParams } from "../../lib/shorts/types";
import { ANTON, BODY, DIM, INK, Outro, PAPER, rise, SAFE, SIGNAL, Tag, textOn, W } from "./kit";

/** each country keeps its colour the whole race, whatever its place */
const PALETTE = ["#FF4A1C", "#0A84FF", "#FFD60A", "#34C759", "#BF5AF2", "#FF6FB5", "#64D2FF", "#FF9F0A", "#F4F1EA", "#30D158", "#AC8E68", "#5E5CE6"];

/** A country's value part-way between two years: straight between the figures, nothing where there's none. */
function valueAt(values: (number | null)[], t: number): number | null {
  const k = Math.floor(t), f = t - k;
  const a = values[k], b = values[Math.min(values.length - 1, k + 1)];
  if (a === null) return null;
  if (b === null || f === 0) return a;
  return a + (b - a) * f;
}

/** Each country's place in each year, from that year's figures. */
function placesByYear(p: RaceParams): Map<string, number>[] {
  return p.years.map((_, k) => {
    const order = p.series.filter((s) => s.values[k] !== null).sort((a, b) => b.values[k]! - a.values[k]!);
    return new Map(order.map((s, i) => [s.iso, i]));
  });
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** The countries' bars, year by year, overtaking each other as it happened. */
export function RaceVideo({ params, tag }: { params: RaceParams; tag: boolean }) {
  const frame = useCurrentFrame();
  const span = params.years.length - 1;
  const t = Math.max(0, Math.min(span, (frame - RACE.intro) / RACE.year));
  const year = params.years[Math.min(span, Math.round(t))];
  const from = params.years[0], to = params.years[span];
  const title = raceTitle(params.metric, params.region, params.top, from, to);
  const outroAt = RACE.intro + span * RACE.year;

  // a bar slides to its new place early in each year, rather than jumping
  const places = useMemo(() => placesByYear(params), [params]);
  const k = Math.min(span, Math.floor(t));
  const e = smooth(Math.min(1, (t - k) / 0.6));
  const off = params.top + 2;
  const place = new Map(params.series.map((x) => {
    const a = places[k].get(x.iso) ?? off, b = places[Math.min(span, k + 1)].get(x.iso) ?? off;
    return [x.iso, a + (b - a) * e];
  }));
  const now = params.series.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length], v: valueAt(s.values, t) })).filter((s): s is typeof s & { v: number } => s.v !== null);
  const max = Math.max(...now.map((s) => s.v));
  const rowH = 96;
  const top = 400;
  const width = 700;

  return (
    <AbsoluteFill style={{ background: INK, color: PAPER, fontFamily: ANTON }}>
      {frame < RACE.intro ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 90px", gap: 26 }}>
          <div style={{ fontSize: 118, lineHeight: 0.98, textAlign: "center", transform: `scale(${0.7 + 0.3 * rise(frame, 0, 12)})`, opacity: rise(frame, 0, 8) }}>{title.toUpperCase()}</div>
          <div style={{ fontSize: 54, letterSpacing: 4, color: SIGNAL, opacity: rise(frame, 16, 8) }}>WATCH THE OVERTAKES</div>
        </div>
      ) : (
        <>
          <div style={{ position: "absolute", top: SAFE.top - 10, left: SAFE.left, right: W - SAFE.right, fontSize: 60, lineHeight: 1.02, textAlign: "center" }}>{title.toUpperCase()}</div>
          <div style={{ position: "absolute", top: SAFE.top + 132, left: SAFE.left, right: W - SAFE.right, textAlign: "center", fontFamily: BODY, fontSize: 30, color: DIM }}>{params.source}</div>
          {now.map((s) => {
            const p = place.get(s.iso)!;
            if (p > params.top + 0.5) return null;
            const fade = Math.max(0, Math.min(1, params.top + 0.5 - p));
            const w = Math.max(8, (s.v / max) * width);
            const c = s.color;
            const inside = w > 330;
            return (
              <div key={s.iso} style={{ position: "absolute", left: SAFE.left, top: top + p * rowH, height: rowH - 18, width: W - SAFE.left * 2, opacity: fade }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: w, background: c, display: "flex", alignItems: "center", padding: "0 18px", overflow: "hidden" }}>
                  {inside && <span style={{ fontSize: 44, color: textOn(c), whiteSpace: "nowrap" }}>{s.name.toUpperCase()}</span>}
                </div>
                <div style={{ position: "absolute", left: w + 16, top: 0, bottom: 0, display: "flex", alignItems: "center", gap: 16, whiteSpace: "nowrap" }}>
                  {!inside && <span style={{ fontSize: 44, color: PAPER }}>{s.name.toUpperCase()}</span>}
                  <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 32, color: PAPER, opacity: 0.85 }}>{say(params.metric, s.v)}</span>
                </div>
              </div>
            );
          })}
          <div style={{ position: "absolute", right: W - SAFE.right, top: 1330, fontSize: 210, lineHeight: 1, color: "transparent", WebkitTextStroke: `4px ${PAPER}`, opacity: 0.9 }}>{year}</div>
        </>
      )}
      <Outro frame={frame} from={outroAt + 36} lines={["WHO SURPRISED", "YOU MOST?"]} small="COMMENT BELOW" />
      <Tag show={tag} />
    </AbsoluteFill>
  );
}
