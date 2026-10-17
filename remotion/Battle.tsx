import { useMemo } from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/fonts";
import { ABILITIES, type AbilityId } from "../lib/battle/abilities";
import { ARENA, FPS, simulate, SUDDEN_DEATH, type Battle, type BattleEvent, type BallFrame, type Team } from "../lib/battle/sim";
import type { Melody } from "../lib/battle/sound";
import { timeline, type Timeline } from "../lib/battle/timeline";
import { cos, sin } from "../lib/battle/trig";
import { alpha, isLight, type Look } from "../lib/shorts/look";
import { endFrames, endingOf } from "../lib/shorts/timing";
import type { Finish } from "../lib/shorts/types";
import { Back, Backdrop, caps, face, lookOf, size } from "./shorts/kit";

// shipped with the app (SIL Open Font License), so a render never waits on Google
const ANTON = "Anton";
// only in a browser: the page's server render has nothing to load it into
if (typeof window !== "undefined") loadFont({ family: ANTON, url: staticFile("fonts/Anton-Regular.woff2"), weight: "400" });

export type BattleProps = {
  a: AbilityId;
  b: AbilityId;
  seed: number;
  /** the free plan's "made with Hookline" line at the bottom */
  tag: boolean;
  /** a fight already worked out, so the browser doesn't run it twice */
  battle?: Battle;
  /** the soundtrack: a URL the browser made, or a file next to a server render */
  soundUrl?: string | null;
  soundFile?: string | null;
  /** the tune its soundtrack plays, made beside it */
  melody?: Melody;
} & Finish;

export const W = 1080;
export const H = 1920;
/** where the arena's top left corner is drawn */
export const AX = 60;
export const AY = 520;
const INK = "#0B0B0C";
const FX = 18;
/** the arena is drawn 960 pixels wide, whatever size the physics uses */
export const SCALE = 960 / ARENA;

/** Dark text on light balls, light text on dark ones. */
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? INK : "#fff";
}

const teamOf = (b: Battle, t: Team) => ABILITIES[t === 0 ? b.a : b.b];

/** The two sides a fight is drawn with, red then blue: a battle's are its two abilities, a LIVE round's the streamer's own teams. */
export type Sides = [{ name: string; color: string }, { name: string; color: string }];

/** A battle's sides: each ability's name and colour. */
export const sidesOf = (b: Battle): Sides => [teamOf(b, 0), teamOf(b, 1)].map((a) => ({ name: a.name, color: a.color })) as Sides;

/** How much bigger a meteor that hits for `hit` is drawn, as on the LIVE: the old 30-damage one is 1, a Universe's about 2. */
export const meteorSize = (hit: number) => Math.min(2.2, 1 + 0.4 * Math.log10(Math.max(1, hit / 30)));

/** Each event's place in the list, by the video frame it shows on: worked out once, since a LIVE round can have thousands. */
export function byFrame(events: BattleEvent[], toVideo: (f: number) => number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  events.forEach((e, i) => {
    const v = toVideo(e.f);
    const at = out.get(v);
    if (at) at.push(i);
    else out.set(v, [i]);
  });
  return out;
}

/**
 * A spike ball's spikes. These and the other turning parts are drawn with
 * the World's own trig, which comes out the same to the last digit in
 * every engine, so the first frame a page draws on the server is the one
 * the browser draws too.
 */
export function Spikes({ ball, sides, turn }: { ball: BallFrame; sides: Sides; turn: number }) {
  const n = 12;
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const ang = turn + (i / (n * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? ball.r + 22 : ball.r - 2;
    pts.push(`${ball.x + cos(ang) * rad},${ball.y + sin(ang) * rad}`);
  }
  return <polygon points={pts.join(" ")} fill={sides[ball.t].color} stroke={INK} strokeWidth={4} strokeLinejoin="round" />;
}

/** A sword's blade, from the ball's edge out as long as it's grown. */
export function Blade({ ball, look }: { ball: BallFrame; look: Look }) {
  return (
    <g strokeLinecap="round">
      <line x1={ball.x + cos(ball.a) * ball.r} y1={ball.y + sin(ball.a) * ball.r} x2={ball.x + cos(ball.a) * (ball.r + ball.L)} y2={ball.y + sin(ball.a) * (ball.r + ball.L)} stroke={look.bg} strokeWidth={20} />
      <line x1={ball.x + cos(ball.a) * ball.r} y1={ball.y + sin(ball.a) * ball.r} x2={ball.x + cos(ball.a) * (ball.r + ball.L)} y2={ball.y + sin(ball.a) * (ball.r + ball.L)} stroke={look.text} strokeWidth={10} />
    </g>
  );
}

function Ball({ ball, sides, turn, look }: { ball: BallFrame; sides: Sides; turn: number; look: Look }) {
  const size = Math.max(24, ball.r * 0.95);
  const color = sides[ball.t].color;
  return (
    <g>
      {ball.k === "spike" && <Spikes ball={ball} sides={sides} turn={turn} />}
      {ball.k === "sword" && <Blade ball={ball} look={look} />}
      <circle cx={ball.x} cy={ball.y} r={ball.r} fill={color} stroke={ball.c ? look.bg : look.text} strokeWidth={ball.c ? 4 : 6} />
      <text x={ball.x} y={ball.y + size * 0.36} textAnchor="middle" fontFamily={ANTON} fontSize={size} fill={textOn(color)}>
        {Math.ceil(ball.hp)}
      </text>
    </g>
  );
}

/**
 * Sparks, damage numbers and blasts from the last moment of the fight, and
 * on a LIVE round, balls dropping in, saves and what a meteor took. `at`
 * is the events by the frame each shows on, when it's been worked out.
 * `smallest` is the least damage that gets a number: every hit in a
 * battle, and only the big ones in a crowded LIVE round, as the LIVE shows.
 */
export function Effects({ events, at, frame, toVideo, sides, look, smallest = 0 }: { events: BattleEvent[]; at?: Map<number, number[]>; frame: number; toVideo: (f: number) => number; sides: Sides; look: Look; smallest?: number }) {
  const own = useMemo(() => (at ? null : byFrame(events, toVideo)), [at, events, toVideo]);
  const shown = at ?? own!;
  // the events of the last FX frames, oldest first, as they happened
  const near: number[] = [];
  for (let v = frame - FX; v <= frame; v++) near.push(...(shown.get(v) ?? []));
  const out: React.ReactNode[] = [];
  for (const i of near) {
    const e = events[i];
    const age = frame - toVideo(e.f);
    const k = age / FX;
    const fade = 1 - k;
    if (e.type === "hit" || e.type === "cut") {
      const big = e.dmg >= 3;
      if (e.type === "hit") out.push(<circle key={`s${i}`} cx={e.cx} cy={e.cy} r={10 + 50 * k} fill="none" stroke={look.text} strokeWidth={6 * fade} opacity={fade} />);
      if (e.dmg >= smallest) {
        out.push(
          <text key={`d${i}`} x={e.x} y={e.y - 14 - 70 * k} textAnchor="middle" fontFamily={ANTON} fontSize={big ? 64 : 48} fill={e.type === "cut" ? "#64D2FF" : big ? "#FF3B30" : look.text} stroke={look.bg} strokeWidth={8} paintOrder="stroke" opacity={fade}>
            -{e.dmg}
          </text>,
        );
      }
    } else if (e.type === "boom") {
      // a mine's blast, or a meteor landing: bigger for a harder hit, with what the ball it fell on took
      const big = e.hit ? meteorSize(e.hit) : 1;
      out.push(<circle key={`b${i}`} cx={e.x} cy={e.y} r={(30 + 150 * k) * big} fill="#FF9F0A" fillOpacity={0.35 * fade} stroke="#FF9F0A" strokeWidth={10 * fade * big} />);
      if (e.hit && e.dmg > 0) {
        out.push(
          <text key={`m${i}`} x={e.x} y={e.y - 40 - 70 * k} textAnchor="middle" fontFamily={ANTON} fontSize={Math.round(64 * big)} fill="#FF9F0A" stroke={look.bg} strokeWidth={9} paintOrder="stroke" opacity={fade}>
            {`-${e.dmg.toLocaleString("en-US")}`}
          </text>,
        );
      }
    } else if (e.type === "ko") {
      const color = sides[e.team].color;
      for (let p = 0; p < 12; p++) {
        const ang = (p / 12) * Math.PI * 2 + i;
        out.push(<circle key={`k${i}-${p}`} cx={e.x + cos(ang) * 140 * k} cy={e.y + sin(ang) * 140 * k} r={12 * fade + 2} fill={color} opacity={fade} />);
      }
    } else if (e.type === "spawn") {
      out.push(
        <text key={`p${i}`} x={e.x} y={e.y - 60 - 50 * k} textAnchor="middle" fontFamily={ANTON} fontSize={52} fill={sides[e.team].color} stroke={look.bg} strokeWidth={8} paintOrder="stroke" opacity={fade}>
          +{e.n}
        </text>,
      );
    } else if (e.type === "heal") {
      out.push(
        <text key={`h${i}`} x={e.x} y={e.y - 50 - 40 * k} textAnchor="middle" fontFamily={ANTON} fontSize={40} fill="#FF6FB5" stroke={look.bg} strokeWidth={7} paintOrder="stroke" opacity={fade}>
          {`+${(e.n ?? 1).toLocaleString("en-US")}`}
        </text>,
      );
    } else if (e.type === "summon") {
      // a viewer's ball dropping in
      out.push(<circle key={`i${i}`} cx={e.x} cy={e.y} r={50 + 160 * k} fill="none" stroke={sides[e.team].color} strokeWidth={12 * fade} opacity={fade} />);
    } else if (e.type === "saved") {
      out.push(
        <text key={`v${i}`} x={e.x} y={e.y - 70 - 50 * k} textAnchor="middle" fontFamily={ANTON} fontSize={72} fill={sides[e.team].color} stroke={look.text} strokeWidth={9} paintOrder="stroke" opacity={fade}>
          SAVED!
        </text>,
      );
    }
  }
  return <>{out}</>;
}

/**
 * The two sides' share of all the health in the arena, as one bar that
 * moves. With `edge`, the bar and its split are outlined, so a side whose
 * colour is close to the background still shows: a LIVE round's teams
 * have the streamer's own colours.
 */
export function TugBar({ sides, hp, look, edge = false }: { sides: Sides; hp: [number, number]; look: Look; edge?: boolean }) {
  const [A, B] = sides;
  const total = hp[0] + hp[1];
  const share = total > 0 ? hp[0] / total : 0.5;
  const w = W - 2 * AX;
  const split = AX + w * share;
  return (
    <g>
      <rect x={AX} y={372} width={w} height={64} fill={look.panel} />
      <rect x={AX} y={372} width={split - AX} height={64} fill={A.color} />
      <rect x={split} y={372} width={AX + w - split} height={64} fill={B.color} />
      {edge && <rect x={AX} y={372} width={w} height={64} fill="none" stroke={look.text} strokeWidth={4} />}
      <rect x={split - 4} y={360} width={8} height={88} fill={look.text} {...(edge ? { stroke: look.bg, strokeWidth: 3 } : {})} />
      <text x={AX + 18} y={423} fontFamily={ANTON} fontSize={46} fill={textOn(A.color)}>{Math.ceil(hp[0]).toLocaleString("en-US")} HP</text>
      <text x={AX + w - 18} y={423} textAnchor="end" fontFamily={ANTON} fontSize={46} fill={textOn(B.color)}>{Math.ceil(hp[1]).toLocaleString("en-US")} HP</text>
    </g>
  );
}

/** One moment of the fight, as drawn: the matchup, the health bar, the arena, and the winner once it's over. */
function BattleScene({ battle, tl, frame, look, comments, tag }: { battle: Battle; tl: Timeline; frame: number; look: Look; comments: boolean; tag: boolean }) {
  const { fps } = useVideoConfig();
  const simF = Math.min(tl.toSim(frame), battle.frames.length - 1);
  const st = battle.frames[simF];
  const A = teamOf(battle, 0), B = teamOf(battle, 1);
  const sides = useMemo(() => sidesOf(battle), [battle]);
  const seconds = simF / FPS;

  // a little shake when something big goes off
  let shake = 0;
  for (const e of battle.events) {
    const age = frame - tl.toVideo(e.f);
    if (age >= 0 && age < 8 && (e.type === "boom" || e.type === "ko")) shake = Math.max(shake, (e.type === "boom" ? 12 : 7) * (1 - age / 8));
  }
  const sx = Math.sin(frame * 7.3) * shake, sy = Math.cos(frame * 5.1) * shake;

  const slow = tl.slowFrom !== null && frame >= tl.slowFrom && frame < tl.outroFrom;
  const sudden = seconds >= SUDDEN_DEATH;
  const outro = frame >= tl.outroFrom;
  const pop = spring({ frame: frame - tl.outroFrom, fps, config: { damping: 11, mass: 0.7 } });
  const dim = interpolate(frame - tl.outroFrom, [0, 8], [0, 0.9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const nameSize = size(look, Math.min(150, 1900 / (A.name.length + B.name.length + 4)));
  const win = battle.winner === null ? null : teamOf(battle, battle.winner);
  const last = battle.frames[battle.endFrame];
  const F = face(look);
  // the powers' own colours need an outline to read on a light background
  const edge = isLight(look) ? { stroke: look.text, strokeWidth: 3, paintOrder: "stroke" as const } : {};
  const spaced = look.face === "anton" ? 3 : 0;

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
            <rect width="10" height="24" fill="#FF3B30" fillOpacity="0.28" />
          </pattern>
        </defs>

        {/* the matchup, said in the first second */}
        <text x={W / 2} y={190} textAnchor="middle" fontSize={nameSize} letterSpacing={spaced ? 2 : 0}>
          <tspan fill={A.color} {...edge}>{caps(look, A.name)}</tspan>
          <tspan fill={look.text} dx={24}>{caps(look, "vs")}</tspan>
          <tspan fill={B.color} dx={24} {...edge}>{caps(look, B.name)}</tspan>
        </text>
        <text x={W / 2} y={300} textAnchor="middle" fontSize={size(look, 76)} fill={look.text} letterSpacing={spaced * 2}>{caps(look, "Who wins?")}</text>
        <TugBar sides={sides} hp={st.hp} look={look} />

        <g transform={`translate(${AX + sx} ${AY + sy}) scale(${SCALE})`}>
          <rect width={ARENA} height={ARENA} fill="url(#grid)" />
          {sudden && (
            <path d={`M0 0H${ARENA}V${ARENA}H0Z M${st.lo} ${st.lo}V${st.lo + st.size}H${st.lo + st.size}V${st.lo}Z`} fill="url(#hatch)" fillRule="evenodd" />
          )}
          <rect x={st.lo} y={st.lo} width={st.size} height={st.size} fill="none" stroke={sudden ? "#FF3B30" : look.text} strokeWidth={8} rx={look.round / SCALE / 2} />
          {st.mines.map((m) => (
            <g key={m.id}>
              <circle cx={m.x} cy={m.y} r={16} fill={look.bg} stroke={teamOf(battle, m.t).color} strokeWidth={5} />
              {m.armed && frame % 16 < 8 && <circle cx={m.x} cy={m.y} r={6} fill="#FF3B30" />}
            </g>
          ))}
          {st.balls.map((ball) => (
            <Ball key={ball.id} ball={ball} sides={sides} turn={frame * 0.05} look={look} />
          ))}
          <g clipPath="url(#arena)">
            <Effects events={battle.events} frame={frame} toVideo={tl.toVideo} sides={sides} look={look} />
          </g>
        </g>

        {sudden && !slow && !outro && <text x={W / 2} y={AY - 22} textAnchor="middle" fontSize={size(look, 44)} fill="#FF3B30" letterSpacing={spaced + 1}>{caps(look, "Sudden death: the walls are closing")}</text>}
        {slow && <text x={W / 2} y={AY - 22} textAnchor="middle" fontSize={size(look, 44)} fill={look.text} letterSpacing={spaced * 2}>{caps(look, "Slow motion")}</text>}

        {!outro && (
          <>
            <text x={W / 2} y={1590} textAnchor="middle" fontSize={size(look, 68)} fill={look.text} letterSpacing={spaced}>{caps(look, comments ? "Comment who you picked" : "Pick a side now")}</text>
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
            <div style={{ fontSize: size(look, win ? Math.min(230, 1500 / win.name.length) : 230), color: win?.color ?? look.text, WebkitTextStroke: win && isLight(look) ? `4px ${look.text}` : undefined }}>{caps(look, win ? win.name : "Draw")}</div>
            {win && <div style={{ fontSize: size(look, 170), color: look.text }}>{caps(look, "wins")}</div>}
            <div style={{ fontSize: size(look, 56), color: look.text, opacity: 0.75, marginTop: 36, letterSpacing: spaced }}>
              {caps(look, battle.winner === null ? "Nobody left standing" : battle.byTimeout ? `On health, ${Math.ceil(last.hp[battle.winner])} to ${Math.ceil(last.hp[1 - battle.winner])}` : `With ${Math.ceil(last.hp[battle.winner])} HP left`)}
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 300, fontSize: size(look, 72), color: look.text, letterSpacing: spaced }}>{caps(look, "Did you call it?")}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

export const BattleVideo: React.FC<BattleProps> = (p) => {
  const frame = useCurrentFrame();
  const battle = useMemo(() => p.battle ?? simulate(p.a, p.b, p.seed), [p.battle, p.a, p.b, p.seed]);
  const tl = useMemo(() => timeline(battle), [battle]);
  const look = lookOf(p);
  const ending = endingOf(p);
  const comments = p.allowComments !== false;
  const total = tl.outroFrom + endFrames("battle", ending);
  const sound = p.soundUrl ?? (p.soundFile ? staticFile(p.soundFile) : null);

  return (
    <AbsoluteFill style={{ background: look.bg }}>
      {sound && <Audio src={sound} />}
      <BattleScene battle={battle} tl={tl} frame={frame} look={look} comments={comments} tag={p.tag} />
      {ending === "loop" && (
        <Back frame={frame} total={total} look={look}>
          <BattleScene battle={battle} tl={tl} frame={0} look={look} comments={comments} tag={p.tag} />
        </Back>
      )}
    </AbsoluteFill>
  );
};

/** How long the video is, for the player and the renderer: the fight, then its ending. */
export function battleDuration(p: Pick<BattleProps, "a" | "b" | "seed" | "battle" | "ending" | "allowComments">): number {
  return timeline(p.battle ?? simulate(p.a, p.b, p.seed)).outroFrom + endFrames("battle", endingOf(p));
}
