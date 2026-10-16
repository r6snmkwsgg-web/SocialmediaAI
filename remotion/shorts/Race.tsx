import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { say } from "../../lib/shorts/data";
import { raceTitle } from "../../lib/shorts/formats/race";
import { contrast } from "../../lib/shorts/look";
import { endingOf, RACE } from "../../lib/shorts/timing";
import type { RaceParams } from "../../lib/shorts/types";
import { Back, Backdrop, BODY, caps, face, lookOf, Opening, Outro, SAFE, size, Tag, textOn, W } from "./kit";

/** each country keeps its colour the whole race, whatever its place */
const PALETTE = ["#FF4A1C", "#0A84FF", "#FFD60A", "#34C759", "#BF5AF2", "#FF6FB5", "#64D2FF", "#FF9F0A", "#F4F1EA", "#30D158", "#AC8E68", "#5E5CE6", "#1F2A44", "#8E2C48"];

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

/** One moment of the race: the countries' bars that year, overtaking each other as it happened. */
function RaceScene({ params, frame, places, colors }: { params: RaceParams; frame: number; places: Map<string, number>[]; colors: string[] }) {
  const L = lookOf(params);
  const span = params.years.length - 1;
  const step = params.step ?? RACE.year;
  const t = Math.max(0, Math.min(span, (frame - RACE.intro) / step));
  const year = params.years[Math.min(span, Math.round(t))];
  const from = params.years[0], to = params.years[span];
  const title = raceTitle(params.metric, params.region, params.top, from, to);

  // a bar slides to its new place early in each year, rather than jumping
  const k = Math.min(span, Math.floor(t));
  const e = smooth(Math.min(1, (t - k) / 0.6));
  const off = params.top + 2;
  const place = new Map(params.series.map((x) => {
    const a = places[k].get(x.iso) ?? off, b = places[Math.min(span, k + 1)].get(x.iso) ?? off;
    return [x.iso, a + (b - a) * e];
  }));
  const now = params.series.map((s, i) => ({ ...s, color: colors[i % colors.length], v: valueAt(s.values, t) })).filter((s): s is typeof s & { v: number } => s.v !== null);
  const max = Math.max(...now.map((s) => s.v));
  const rowH = 96;
  const top = 400;
  const width = 700;
  const name = size(L, 44);

  return (
    <AbsoluteFill style={{ color: L.text, ...face(L) }}>
      <Backdrop look={L} />
      <div style={{ position: "absolute", top: SAFE.top - 10, left: SAFE.left, right: W - SAFE.right, fontSize: size(L, 60), lineHeight: 1.04, textAlign: "center" }}>{caps(L, title)}</div>
      <div style={{ position: "absolute", top: SAFE.top + 132, left: SAFE.left, right: W - SAFE.right, textAlign: "center", fontFamily: BODY, fontWeight: 400, fontSize: 30, color: L.dim }}>{params.source}</div>
      {now.map((s) => {
        const p = place.get(s.iso)!;
        if (p > params.top + 0.5) return null;
        const fade = Math.max(0, Math.min(1, params.top + 0.5 - p));
        const w = Math.max(8, (s.v / max) * width);
        const c = s.color;
        const inside = w > 330;
        return (
          <div key={s.iso} style={{ position: "absolute", left: SAFE.left, top: top + p * rowH, height: rowH - 18, width: W - SAFE.left * 2, opacity: fade }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: w, background: c, borderRadius: L.round / 3, display: "flex", alignItems: "center", padding: "0 18px", overflow: "hidden" }}>
              {inside && <span style={{ fontSize: name, color: textOn(c), whiteSpace: "nowrap" }}>{caps(L, s.name)}</span>}
            </div>
            <div style={{ position: "absolute", left: w + 16, top: 0, bottom: 0, display: "flex", alignItems: "center", gap: 16, whiteSpace: "nowrap" }}>
              {!inside && <span style={{ fontSize: name, color: L.text }}>{caps(L, s.name)}</span>}
              <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 32, color: L.text, opacity: 0.85 }}>{say(params.metric, s.v)}</span>
            </div>
          </div>
        );
      })}
      <div style={{ position: "absolute", right: W - SAFE.right, top: 1330, fontSize: size(L, 210), lineHeight: 1, color: "transparent", WebkitTextStroke: `4px ${L.text}`, opacity: 0.9 }}>{year}</div>
      <Opening frame={frame} look={L} lines={[`${from} to ${to}`, "Watch the overtakes"]} top={1290} />
    </AbsoluteFill>
  );
}

/** The countries' bars, year by year. */
export function RaceVideo({ params, tag, total }: { params: RaceParams; tag: boolean; total: number }) {
  const frame = useCurrentFrame();
  const L = lookOf(params);
  const end = RACE.intro + (params.years.length - 1) * (params.step ?? RACE.year);
  const ending = endingOf(params);
  const places = useMemo(() => placesByYear(params), [params]);
  // the bar colours that show up on this look's background, starting somewhere of its own
  const colors = useMemo(() => {
    const ok = PALETTE.filter((c) => contrast(c, L.bg) >= 1.6);
    return ok.map((_, i) => ok[(i + L.id) % ok.length]);
  }, [L.bg, L.id]);

  return (
    <AbsoluteFill>
      <RaceScene params={params} frame={frame} places={places} colors={colors} />
      {ending !== "loop" && <Outro frame={frame} from={end + 36} lines={["Who surprised", "you most?"]} small={ending === "comment" ? "Comment below" : undefined} look={L} />}
      {ending === "loop" && (
        <Back frame={frame} total={total} look={L}>
          <RaceScene params={params} frame={0} places={places} colors={colors} />
        </Back>
      )}
      <Tag show={tag} look={L} />
    </AbsoluteFill>
  );
}
