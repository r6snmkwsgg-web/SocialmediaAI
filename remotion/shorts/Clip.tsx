import { useMemo } from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ABILITIES } from "../../lib/battle/abilities";
import { ARENA, FPS, type BallFrame, type BattleEvent, type Team } from "../../lib/battle/sim";
import { timeline, type Timeline } from "../../lib/battle/timeline";
import { cos, sin } from "../../lib/battle/trig";
import { playsFrom, replay, type BallMeta, type ClipLog, type ClipMoment, type ClipPower, type LiveFrame, type Replay } from "../../lib/live/clip";
import { BATTLE_MENU } from "../../lib/live/games/battle";
import { alpha, textOn, type Look } from "../../lib/shorts/look";
import { endFrames, endingOf } from "../../lib/shorts/timing";
import type { ClipParams } from "../../lib/shorts/types";
import { AX, AY, Blade, byFrame, Effects, H, meteorSize, SCALE, Spikes, TugBar, W, type Sides } from "../Battle";
import { ANTON, Back, Backdrop, caps, face, lookOf, size } from "./kit";

/**
 * A round from the creator's own LIVE, as a Short: the same fight, step
 * for step, played back from the game's record of it and drawn in the
 * channel's look, credited "From my LIVE". The two sides keep their LIVE
 * names and colours, outlined on every look, since a streamer's own team
 * colours can be dark on a dark look. Viewers' balls are plain balls with
 * a person mark, never a picture, and a gifter's name shows only when the
 * creator chose to show names. Nothing in it shows coins, a gift's name or
 * a price: only what the powers did.
 */

export type ClipProps = {
  params: ClipParams;
  /** the free plan's "made with Hookline" line */
  tag: boolean;
  /** the soundtrack: a URL the browser made, or a file next to a server render */
  soundUrl?: string | null;
  soundFile?: string | null;
};

const INK = "#0B0B0C";
const RED = "#FF3B30";
const SHIELD = "#64D2FF";
const GOLD = "#FFD60A";
/** how long a big gift's banner stays up, in frames */
const BANNER = Math.round(1.5 * FPS);

/** each power as the menu shows it: its name and its colour */
const tier = (p: ClipPower) => BATTLE_MENU.find((t) => t.effect === p)!;
const POWER: Record<ClipPower, { name: string; color: string }> = { rage: tier("rage"), shield: tier("shield"), meteor: tier("meteor") };

const ease = (k: number) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;

/** a size that fits `text` into `width` pixels, roughly: a number with thousands in it, or a long name */
const fitted = (text: string, base: number, width: number) => Math.min(base, width / (Math.max(1, [...text].length) * 0.58));

/** a side's name as the round said it, and whether it reads as many ("CELTICS HIT", "CELTICS ARE") */
const many = (name: string) => /[^sS][sS]$/.test(name);

/** What a big gift did, as its banner says it: "RED HITS TWICE AS HARD", "5 METEORS ON BLUE". Never the gift itself. */
export function powerLine(effect: ClipPower, count: number, us: string, them: string): string {
  if (effect === "rage") return `${us} ${many(us) ? "hit" : "hits"} twice as hard`;
  if (effect === "shield") return `${us} ${many(us) ? "are" : "is"} shielded`;
  return count > 1 ? `${count} meteors on ${them}` : `On ${them}${many(them) ? "'" : "'s"} biggest ball`;
}

/** A big gift's banner, in video frames: one at a time, and one left waiting too long behind others is let go, as on the LIVE. */
type Banner = { from: number; m: ClipMoment };

function bannersOf(log: ClipLog, tl: Timeline, from: number, endFrame: number): Banner[] {
  const out: Banner[] = [];
  let free = -Infinity;
  for (const m of log.moments) {
    const f = Math.floor(m[0] / 2);
    if (f < from || f > endFrame) continue;
    const at = tl.toVideo(f);
    const start = Math.max(at, free);
    if (start - at > BANNER) continue;
    out.push({ from: start, m });
    free = start + BANNER;
  }
  return out;
}

/** The round's events as they're drawn: heals that reached one side on the same frame show as one number, so a burst of gifts reads as one. */
function drawn(events: BattleEvent[]): BattleEvent[] {
  const out: BattleEvent[] = [];
  const first = new Map<string, number>();
  for (const e of events) {
    if (e.type === "heal" && e.n !== undefined) {
      const key = `${e.f}:${e.team}`;
      const at = first.get(key);
      const h = at === undefined ? null : out[at];
      if (h?.type === "heal") {
        out[at!] = { ...h, n: (h.n ?? 0) + e.n };
        continue;
      }
      first.set(key, out.length);
    }
    out.push(e);
  }
  return out;
}

/** A gifter's name to show, only when names are on and the round names them; otherwise nobody. */
function nameOf(log: ClipLog, names: boolean, who: number | null): string | null {
  if (!names || who === null || who < 0) return null;
  const n = log.people[who]?.trim();
  return n ? n : null;
}

/** A flame, the menu's picture for rage, upright at (x, y). */
function Flame({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }) {
  const d = `M0 ${-s / 2}C${s * 0.45} ${-s * 0.1} ${s * 0.4} ${s * 0.45} 0 ${s / 2}C${-s * 0.4} ${s * 0.45} ${-s * 0.45} 0 ${-s * 0.12} ${-s * 0.18}C${-s * 0.05} 0 ${s * 0.05} ${-s * 0.2} 0 ${-s / 2}Z`;
  return <path d={d} fill={fill} transform={`translate(${x} ${y})`} />;
}

/** The number on a ball, as big as fits: a gift's ball can carry thousands. */
function Hp({ x, y, r, hp, fill }: { x: number; y: number; r: number; hp: number; fill: string }) {
  const n = Math.ceil(hp).toLocaleString("en-US");
  const px = fitted(n, Math.max(24, r * 0.95), r * 1.7);
  return (
    <text x={x} y={y + px * 0.36} textAnchor="middle" fontFamily={ANTON} fontSize={px} fill={fill}>
      {n}
    </text>
  );
}

/**
 * One ball. A champion is drawn as in a battle Short. A viewer's ball is
 * a plain ball in its side's colour with a person mark and its health in
 * a badge, and its gifter's name under it when names are shown. Rage is a
 * ring of flames and a 2X, a shield a blue ring, and a side hanging on a
 * red ring that beats.
 */
function ClipBall({ ball, meta, live, sides, turn, t, look, name }: { ball: BallFrame; meta: BallMeta | undefined; live: LiveFrame; sides: Sides; turn: number; t: number; look: Look; name: string | null }) {
  const color = sides[ball.t].color;
  const viewer = meta?.who !== null && meta?.who !== undefined;
  // a ball dropping in grows into place, and can't fight until it's clear
  const grown = meta && meta.born > 0 ? ease((t - meta.born) / 0.35) : 1;
  const r = ball.r * (0.55 + 0.45 * grown);
  const shown = { ...ball, r };
  const fresh = !!meta && meta.fresh > t;
  const raging = live.rage[ball.t] > 0;
  const plain = meta?.plain ?? false;
  const beat = 0.5 + 0.5 * sin(turn * 14);
  const pulse = 0.5 + 0.5 * sin(turn * 6);
  return (
    <g>
      {raging &&
        Array.from({ length: 8 }, (_, i) => {
          const a = turn * 1.5 + (i / 8) * Math.PI * 2;
          const flick = 0.75 + 0.25 * sin(turn * 14 + i * 2);
          return <Flame key={i} x={ball.x + cos(a) * (r + 10)} y={ball.y + sin(a) * (r + 10)} s={30 * flick} fill={i % 2 ? "#FF9F0A" : RED} />;
        })}
      {!plain && ball.k === "spike" && <Spikes ball={shown} sides={sides} turn={turn * 1.5} />}
      {!plain && ball.k === "sword" && <Blade ball={shown} look={look} />}
      <g opacity={fresh ? 0.6 + 0.4 * Math.abs(sin(turn * 10)) : 1}>
        <circle cx={ball.x} cy={ball.y} r={r} fill={color} stroke={look.text} strokeWidth={6} />
        {viewer ? (
          <>
            <circle cx={ball.x} cy={ball.y - r * 0.22} r={r * 0.26} fill={textOn(color)} fillOpacity={0.85} />
            <path d={`M${ball.x - r * 0.52} ${ball.y + r * 0.58}Q${ball.x - r * 0.5} ${ball.y + r * 0.08} ${ball.x} ${ball.y + r * 0.08}Q${ball.x + r * 0.5} ${ball.y + r * 0.08} ${ball.x + r * 0.52} ${ball.y + r * 0.58}Z`} fill={textOn(color)} fillOpacity={0.85} />
            <Badge x={ball.x + r * 0.74} y={ball.y - r * 0.74} r={Math.max(15, r * 0.34)} hp={ball.hp} color={color} look={look} />
          </>
        ) : (
          <Hp x={ball.x} y={ball.y} r={r} hp={ball.hp} fill={textOn(color)} />
        )}
      </g>
      {name && (
        <text x={ball.x} y={ball.y + r + (plain ? 26 : 32)} textAnchor="middle" fontFamily={ANTON} fontSize={fitted(name, plain ? 24 : 30, 220)} fill={look.text} stroke={look.bg} strokeWidth={7} paintOrder="stroke">
          {name}
        </text>
      )}
      {raging && (
        <g>
          <rect x={ball.x - r * 0.78 - 26} y={ball.y - r * 0.78 - 18} width={52} height={36} rx={10} fill={RED} stroke={look.text} strokeWidth={3} />
          <text x={ball.x - r * 0.78} y={ball.y - r * 0.78 + 12} textAnchor="middle" fontFamily={ANTON} fontSize={30} fill="#fff">2X</text>
        </g>
      )}
      {live.shield[ball.t] > 0 && <circle cx={ball.x} cy={ball.y} r={r + 16 + pulse * 4} fill="rgba(100,210,255,0.14)" stroke={SHIELD} strokeWidth={5} />}
      {live.hanging[ball.t] > 0 && <circle cx={ball.x} cy={ball.y} r={r + 12 + beat * 10} fill="none" stroke={RED} strokeWidth={6 + beat * 4} />}
    </g>
  );
}

/** A viewer's ball's health, in a badge on its shoulder. */
function Badge({ x, y, r, hp, color, look }: { x: number; y: number; r: number; hp: number; color: string; look: Look }) {
  const n = Math.ceil(hp).toLocaleString("en-US");
  const px = fitted(n, r * 1.1, r * 1.8);
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={color} stroke={look.text} strokeWidth={4} />
      <text x={x} y={y + px * 0.36} textAnchor="middle" fontFamily={ANTON} fontSize={px} fill={textOn(color)}>
        {n}
      </text>
    </g>
  );
}

/** A meteor on its way down onto (x, y), `k` of the way, with a target ring over the ball it'll hit. */
function Meteor({ m, turn }: { m: LiveFrame["meteors"][number]; turn: number }) {
  const big = meteorSize(m.hit);
  const rr = m.r + 40 - 24 * m.k;
  const sx = m.x + 520 * (1 - m.k), sy = m.y - 900 * (1 - m.k);
  return (
    <g>
      <g transform={`translate(${m.x} ${m.y}) rotate(${turn * 2 * (180 / Math.PI)})`} stroke={RED} strokeWidth={6} fill="none">
        <circle r={rr} />
        {[0, 90, 180, 270].map((a) => (
          <line key={a} x1={rr - 20} x2={rr + 20} transform={`rotate(${a})`} />
        ))}
      </g>
      <line x1={sx} y1={sy} x2={sx + 170} y2={sy - 300} stroke="#FF9F0A" strokeOpacity={0.45} strokeWidth={46 * big} strokeLinecap="round" />
      <circle cx={sx} cy={sy} r={38 * big} fill="#FF9F0A" stroke={INK} strokeWidth={6} />
      <circle cx={sx - 9 * big} cy={sy - 9 * big} r={13 * big} fill={GOLD} />
    </g>
  );
}

/** A big gift going off, over the top of the arena: what it does, and whose it was only when names are shown. Never the gift, its price or a picture. */
function GiftBanner({ b, frame, log, sides, look, names }: { b: Banner; frame: number; log: ClipLog; sides: Sides; look: Look; names: boolean }) {
  const [, effect, team, who, count, level] = b.m;
  const age = frame - b.from;
  const k = Math.min(ease(age / 5), ease((BANNER - age) / 6));
  const p = POWER[effect];
  const us = sides[team].name, them = sides[1 - team].name;
  const gifter = nameOf(log, names, who);
  const from = gifter ? `${gifter}'s gift` : "A viewer's gift";
  const x = AX + 26, y = AY + 22, w = W - 2 * AX - 52, h = 196;
  const s = (0.9 + 0.1 * k) * (1 + 0.04 * level);
  const big = caps(look, `${p.name}${effect === "meteor" && count > 1 ? ` ×${count}` : ""}!`);
  const line = caps(look, powerLine(effect, count, us, them));
  return (
    <g opacity={k} transform={`translate(${W / 2} ${y + h / 2}) scale(${s}) translate(${-W / 2} ${-(y + h / 2)})`}>
      <rect x={x} y={y} width={w} height={h} rx={look.round / 2} fill={look.panel} stroke={p.color} strokeWidth={6} />
      <text x={x + 40} y={y + 56} fontSize={fitted(from, size(look, 34), w - 80)} fill={look.text} fillOpacity={0.8}>{from}</text>
      <text x={x + 40} y={y + 132} fontSize={fitted(big, size(look, 80), w - 80)} fill={p.color} stroke={look.text} strokeWidth={3} paintOrder="stroke">{big}</text>
      <text x={x + 40} y={y + 176} fontSize={fitted(line, size(look, 32), w - 80)} fill={look.text} fillOpacity={0.7}>{line}</text>
    </g>
  );
}

/** One moment of the round, as drawn: where it's from, the two sides, the health bar, the arena, and the result once it's decided. */
function ClipScene({ log, r, tl, events, at, banners, from, frame, look, names, comments, tag }: {
  log: ClipLog; r: Replay; tl: Timeline; events: BattleEvent[]; at: Map<number, number[]>; banners: Banner[]; from: number; frame: number; look: Look; names: boolean; comments: boolean; tag: boolean;
}) {
  const { fps } = useVideoConfig();
  const sides = log.teams;
  const simF = Math.min(Math.max(from, tl.toSim(frame)), r.battle.endFrame);
  const st = r.frames[simF];
  const seconds = simF / FPS;
  // the arena's own clock on this frame, for balls dropping in
  const t = (2 * simF + 1) / (2 * FPS);
  const turn = frame / FPS;

  // a shake when something big goes off: harder for a harder meteor
  let shake = 0;
  for (let v = frame - 7; v <= frame; v++) {
    for (const i of at.get(v) ?? []) {
      const e = events[i];
      const hard = e.type === "boom" ? 12 * (e.hit ? meteorSize(e.hit) : 1) : e.type === "ko" ? 7 : 0;
      shake = Math.max(shake, hard * (1 - (frame - v) / 8));
    }
  }
  const sx = sin(frame * 7.3) * shake, sy = cos(frame * 5.1) * shake;

  const slow = tl.slowFrom !== null && frame >= tl.slowFrom && frame < tl.outroFrom;
  const sudden = seconds >= log.world.suddenDeath;
  const outro = frame >= tl.outroFrom;
  const pop = spring({ frame: frame - tl.outroFrom, fps, config: { damping: 11, mass: 0.7 } });
  const dim = interpolate(frame - tl.outroFrom, [0, 8], [0, 0.9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const F = face(look);
  const spaced = look.face === "anton" ? 3 : 0;
  // every side's name and colour gets an outline, on every look
  const edge = { stroke: look.text, strokeWidth: 3, paintOrder: "stroke" as const };
  const rivals = log.game === "rivals";
  const nameSize = size(look, Math.min(rivals ? 120 : 104, 1800 / (sides[0].name.length + sides[1].name.length + 4)));
  const banner = !outro ? banners.find((b) => frame >= b.from && frame < b.from + BANNER) : undefined;
  const hung = ([0, 1] as Team[]).filter((s) => st.hanging[s] > 0);
  // the result as the round was decided: health less what a side hanging on owed, never below 0
  const won = r.result?.team ?? null;
  const win = won === null ? null : sides[won];
  const [h0, h1] = r.hp.map((n) => Math.ceil(n).toLocaleString("en-US"));
  const said = r.result?.byTime ? (won === 1 ? `On health, ${h1} to ${h0}` : `On health, ${h0} to ${h1}`) : won === null ? "Nobody left standing" : `With ${won === 0 ? h0 : h1} HP left`;
  const balls = st.balls.map((ball) => ({ ball, meta: r.meta.get(ball.id) }));
  const ball = ({ ball: b, meta }: (typeof balls)[number]) => (
    <ClipBall key={b.id} ball={b} meta={meta} live={st} sides={sides} turn={turn} t={t} look={look} name={nameOf(log, names, meta?.who ?? null)} />
  );

  return (
    <AbsoluteFill>
      <Backdrop look={look} />
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }} fontFamily={String(F.fontFamily)} fontWeight={F.fontWeight}>
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M60 0H0V60" fill="none" stroke={look.text} strokeOpacity="0.05" strokeWidth="2" />
          </pattern>
          <clipPath id="arena">
            <rect width={ARENA} height={ARENA} />
          </clipPath>
          <pattern id="hatch" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="24" fill={RED} fillOpacity="0.28" />
          </pattern>
        </defs>

        {/* where it's from, then the two sides as the LIVE named them */}
        <text x={W / 2} y={172} textAnchor="middle" fontSize={size(look, 40)} fill={look.accent} letterSpacing={spaced + 1}>{caps(look, "From my LIVE")}</text>
        <text x={W / 2} y={rivals ? 296 : 266} textAnchor="middle" fontSize={nameSize} letterSpacing={spaced ? 2 : 0}>
          <tspan fill={sides[0].color} {...edge}>{caps(look, sides[0].name)}</tspan>
          <tspan fill={look.text} dx={24}>{caps(look, "vs")}</tspan>
          <tspan fill={sides[1].color} dx={24} {...edge}>{caps(look, sides[1].name)}</tspan>
        </text>
        {!rivals && (
          <text x={W / 2} y={334} textAnchor="middle" fontSize={size(look, 40)} fill={look.text} fillOpacity={0.75} letterSpacing={spaced}>
            {caps(look, `${ABILITIES[log.a].name} vs ${ABILITIES[log.b].name}`)}
          </text>
        )}
        <TugBar sides={sides} hp={st.hp} look={look} edge />

        <g transform={`translate(${AX + sx} ${AY + sy}) scale(${SCALE})`}>
          <rect width={ARENA} height={ARENA} fill="url(#grid)" />
          {sudden && <path d={`M0 0H${ARENA}V${ARENA}H0Z M${st.lo} ${st.lo}V${st.lo + st.size}H${st.lo + st.size}V${st.lo}Z`} fill="url(#hatch)" fillRule="evenodd" />}
          <rect x={st.lo} y={st.lo} width={st.size} height={st.size} fill="none" stroke={sudden ? RED : look.text} strokeWidth={8} rx={look.round / SCALE / 2} />
          {st.mines.map((m) => (
            <g key={m.id}>
              <circle cx={m.x} cy={m.y} r={16} fill={look.bg} stroke={sides[m.t].color} strokeWidth={5} />
              {m.armed && frame % 16 < 8 && <circle cx={m.x} cy={m.y} r={6} fill={RED} />}
            </g>
          ))}
          {/* champions under viewers' balls, so names stay readable */}
          {balls.filter((b) => b.meta?.who === null || b.meta === undefined).map(ball)}
          {balls.filter((b) => b.meta?.who !== null && b.meta !== undefined).map(ball)}
          <g clipPath="url(#arena)">
            <Effects events={events} at={at} frame={frame} toVideo={tl.toVideo} sides={sides} look={look} smallest={4} />
            {st.meteors.map((m, i) => (
              <Meteor key={i} m={m} turn={turn} />
            ))}
          </g>
        </g>

        {sudden && !slow && !outro && <text x={W / 2} y={AY - 22} textAnchor="middle" fontSize={size(look, 44)} fill={RED} letterSpacing={spaced + 1}>{caps(look, "Sudden death: the walls are closing")}</text>}
        {slow && <text x={W / 2} y={AY - 22} textAnchor="middle" fontSize={size(look, 44)} fill={look.text} letterSpacing={spaced * 2}>{caps(look, "Slow motion")}</text>}
        {!outro &&
          hung.map((s, i) => {
            const line = caps(look, `${sides[s].name} needs ${Math.ceil(st.owed[s]).toLocaleString("en-US")} HP · ${Math.ceil(st.hanging[s])}s`);
            return (
              <text key={s} x={W / 2} y={AY + 960 - 34 - i * 58} textAnchor="middle" fontSize={fitted(line, size(look, 46), 880)} fill={sides[s].color} letterSpacing={spaced} stroke={look.text} strokeWidth={4} paintOrder="stroke">
                {line}
              </text>
            );
          })}
        {banner && <GiftBanner b={banner} frame={frame} log={log} sides={sides} look={look} names={names} />}

        {!outro && (
          <>
            <text x={W / 2} y={1590} textAnchor="middle" fontSize={size(look, 68)} fill={look.text} letterSpacing={spaced}>{caps(look, comments ? "Comment who you'd back" : "Pick a side now")}</text>
            <text x={W / 2} y={1670} textAnchor="middle" fontSize={44} fontFamily={ANTON} fontWeight={400} fill={look.text} fillOpacity={0.45} letterSpacing={3}>
              {`${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`}
            </text>
          </>
        )}
        {tag && (
          <text x={W / 2} y={1840} textAnchor="middle" fontSize={34} fontFamily={ANTON} fontWeight={400} fill={look.text} fillOpacity={0.6} letterSpacing={3}>MADE WITH HOOKLINE</text>
        )}
      </svg>

      {outro && (
        <AbsoluteFill style={{ background: alpha(look.bg, dim), alignItems: "center", justifyContent: "center", flexDirection: "column", ...F }}>
          <div style={{ transform: `scale(${0.6 + 0.4 * pop})`, textAlign: "center", lineHeight: 0.96 }}>
            <div style={{ fontSize: size(look, win ? Math.min(230, 1500 / win.name.length) : 230), color: win?.color ?? look.text, WebkitTextStroke: win ? `4px ${look.text}` : undefined, paintOrder: "stroke fill" }}>{caps(look, win ? win.name : "Draw")}</div>
            {win && <div style={{ fontSize: size(look, 170), color: look.text }}>{caps(look, "wins")}</div>}
            <div style={{ fontSize: size(look, 56), color: look.text, opacity: 0.75, marginTop: 36, letterSpacing: spaced }}>{caps(look, said)}</div>
            <div style={{ fontSize: size(look, 48), color: look.accent, marginTop: 28, letterSpacing: spaced + 1 }}>{caps(look, "From my LIVE")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 300, fontSize: size(look, 72), color: look.text, letterSpacing: spaced }}>{caps(look, "Did you call it?")}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

/** A round that no longer plays back the way it was recorded: said plainly, never drawn wrong. The worker never renders one. */
function Broken({ look }: { look: Look }) {
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 120px" }}>
      <Backdrop look={look} />
      <div style={{ position: "relative", ...face(look), fontSize: size(look, 72), lineHeight: 1.05, color: look.text, textAlign: "center" }}>
        {caps(look, "This LIVE round no longer plays back exactly as it happened")}
      </div>
    </AbsoluteFill>
  );
}

/** A round from a LIVE, with its own soundtrack, as a battle has. It plays the round back once, from its record. */
export function ClipVideo({ params, tag, soundUrl, soundFile }: ClipProps) {
  const frame = useCurrentFrame();
  const { log, from } = params;
  const r = useMemo(() => replay(log), [log]);
  const tl = useMemo(() => timeline(r.battle, { from }), [r, from]);
  const events = useMemo(() => drawn(r.battle.events), [r]);
  const at = useMemo(() => byFrame(events, tl.toVideo), [events, tl]);
  const banners = useMemo(() => bannersOf(log, tl, from, r.battle.endFrame), [log, tl, from, r]);
  const look = lookOf(params);
  const ending = endingOf(params);
  const sound = soundUrl ?? (soundFile ? staticFile(soundFile) : null);
  if (!playsFrom(r, from)) return <Broken look={look} />;
  const total = tl.outroFrom + endFrames("clip", ending);
  const scene = { log, r, tl, events, at, banners, from, look, names: params.names === true, comments: params.allowComments !== false, tag };

  return (
    <AbsoluteFill style={{ background: look.bg }}>
      {sound && <Audio src={sound} />}
      <ClipScene {...scene} frame={frame} />
      {ending === "loop" && (
        <Back frame={frame} total={total} look={look}>
          <ClipScene {...scene} frame={0} />
        </Back>
      )}
    </AbsoluteFill>
  );
}
