import { useMemo } from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/fonts";
import { ABILITIES, type AbilityId } from "../lib/battle/abilities";
import { ARENA, FPS, simulate, SUDDEN_DEATH, type Battle, type BattleEvent, type BallFrame, type Team } from "../lib/battle/sim";
import { timeline } from "../lib/battle/timeline";

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
};

export const W = 1080;
export const H = 1920;
const AX = 60;
const AY = 520;
const PAPER = "#F4F1EA";
const INK = "#0B0B0C";
const FX = 18;
/** the arena is drawn 960 pixels wide, whatever size the physics uses */
const SCALE = 960 / ARENA;

/** Dark text on light balls, light text on dark ones. */
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? INK : "#fff";
}

const teamOf = (b: Battle, t: Team) => ABILITIES[t === 0 ? b.a : b.b];

function Spikes({ ball, color, turn }: { ball: BallFrame; color: string; turn: number }) {
  const n = 12;
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const ang = turn + (i / (n * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? ball.r + 22 : ball.r - 2;
    pts.push(`${ball.x + Math.cos(ang) * rad},${ball.y + Math.sin(ang) * rad}`);
  }
  return <polygon points={pts.join(" ")} fill={color} stroke={INK} strokeWidth={4} strokeLinejoin="round" />;
}

function Ball({ ball, color, turn }: { ball: BallFrame; color: string; turn: number }) {
  const size = Math.max(24, ball.r * 0.95);
  return (
    <g>
      {ball.k === "spike" && <Spikes ball={ball} color={color} turn={turn} />}
      {ball.k === "sword" && (
        <g strokeLinecap="round">
          <line x1={ball.x + Math.cos(ball.a) * ball.r} y1={ball.y + Math.sin(ball.a) * ball.r} x2={ball.x + Math.cos(ball.a) * (ball.r + ball.L)} y2={ball.y + Math.sin(ball.a) * (ball.r + ball.L)} stroke={INK} strokeWidth={20} />
          <line x1={ball.x + Math.cos(ball.a) * ball.r} y1={ball.y + Math.sin(ball.a) * ball.r} x2={ball.x + Math.cos(ball.a) * (ball.r + ball.L)} y2={ball.y + Math.sin(ball.a) * (ball.r + ball.L)} stroke={PAPER} strokeWidth={10} />
        </g>
      )}
      <circle cx={ball.x} cy={ball.y} r={ball.r} fill={color} stroke={ball.c ? INK : PAPER} strokeWidth={ball.c ? 4 : 6} />
      <text x={ball.x} y={ball.y + size * 0.36} textAnchor="middle" fontFamily={ANTON} fontSize={size} fill={textOn(color)}>
        {Math.ceil(ball.hp)}
      </text>
    </g>
  );
}

/** Sparks, damage numbers and blasts from the last moment of the fight. */
function Effects({ events, frame, toVideo, battle }: { events: BattleEvent[]; frame: number; toVideo: (f: number) => number; battle: Battle }) {
  const out: React.ReactNode[] = [];
  events.forEach((e, i) => {
    const age = frame - toVideo(e.f);
    if (age < 0 || age > FX) return;
    const k = age / FX;
    const fade = 1 - k;
    if (e.type === "hit" || e.type === "cut") {
      const big = e.dmg >= 3;
      if (e.type === "hit") out.push(<circle key={`s${i}`} cx={e.cx} cy={e.cy} r={10 + 50 * k} fill="none" stroke={PAPER} strokeWidth={6 * fade} opacity={fade} />);
      out.push(
        <text key={`d${i}`} x={e.x} y={e.y - 14 - 70 * k} textAnchor="middle" fontFamily={ANTON} fontSize={big ? 64 : 48} fill={e.type === "cut" ? "#64D2FF" : big ? "#FF3B30" : PAPER} stroke={INK} strokeWidth={8} paintOrder="stroke" opacity={fade}>
          -{e.dmg}
        </text>,
      );
    } else if (e.type === "boom") {
      out.push(<circle key={`b${i}`} cx={e.x} cy={e.y} r={30 + 150 * k} fill="#FF9F0A" fillOpacity={0.35 * fade} stroke="#FF9F0A" strokeWidth={10 * fade} />);
    } else if (e.type === "ko") {
      const color = teamOf(battle, e.team).color;
      for (let p = 0; p < 12; p++) {
        const ang = (p / 12) * Math.PI * 2 + i;
        out.push(<circle key={`k${i}-${p}`} cx={e.x + Math.cos(ang) * 140 * k} cy={e.y + Math.sin(ang) * 140 * k} r={12 * fade + 2} fill={color} opacity={fade} />);
      }
    } else if (e.type === "spawn") {
      out.push(
        <text key={`p${i}`} x={e.x} y={e.y - 60 - 50 * k} textAnchor="middle" fontFamily={ANTON} fontSize={52} fill={teamOf(battle, e.team).color} stroke={INK} strokeWidth={8} paintOrder="stroke" opacity={fade}>
          +{e.n}
        </text>,
      );
    } else if (e.type === "heal") {
      out.push(
        <text key={`h${i}`} x={e.x} y={e.y - 50 - 40 * k} textAnchor="middle" fontFamily={ANTON} fontSize={40} fill="#FF6FB5" stroke={INK} strokeWidth={7} paintOrder="stroke" opacity={fade}>
          +1
        </text>,
      );
    }
  });
  return <>{out}</>;
}

/** The two sides' share of all the health in the arena, as one bar that moves. */
function TugBar({ battle, hp }: { battle: Battle; hp: [number, number] }) {
  const A = teamOf(battle, 0), B = teamOf(battle, 1);
  const total = hp[0] + hp[1];
  const share = total > 0 ? hp[0] / total : 0.5;
  const w = W - 2 * AX;
  const split = AX + w * share;
  return (
    <g>
      <rect x={AX} y={372} width={w} height={64} fill="#1A1A1C" />
      <rect x={AX} y={372} width={split - AX} height={64} fill={A.color} />
      <rect x={split} y={372} width={AX + w - split} height={64} fill={B.color} />
      <rect x={split - 4} y={360} width={8} height={88} fill={PAPER} />
      <text x={AX + 18} y={423} fontFamily={ANTON} fontSize={46} fill={textOn(A.color)}>{Math.ceil(hp[0])} HP</text>
      <text x={AX + w - 18} y={423} textAnchor="end" fontFamily={ANTON} fontSize={46} fill={textOn(B.color)}>{Math.ceil(hp[1])} HP</text>
    </g>
  );
}

export const BattleVideo: React.FC<BattleProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const battle = useMemo(() => p.battle ?? simulate(p.a, p.b, p.seed), [p.battle, p.a, p.b, p.seed]);
  const tl = useMemo(() => timeline(battle), [battle]);
  const simF = Math.min(tl.toSim(frame), battle.frames.length - 1);
  const st = battle.frames[simF];
  const A = teamOf(battle, 0), B = teamOf(battle, 1);
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
  const nameSize = Math.min(150, 1900 / (A.name.length + B.name.length + 4));
  const win = battle.winner === null ? null : teamOf(battle, battle.winner);
  const last = battle.frames[battle.endFrame];
  const sound = p.soundUrl ?? (p.soundFile ? staticFile(p.soundFile) : null);

  return (
    <AbsoluteFill style={{ background: INK, fontFamily: ANTON }}>
      {sound && <Audio src={sound} />}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M60 0H0V60" fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="2" />
          </pattern>
          <clipPath id="arena">
            <rect width={ARENA} height={ARENA} />
          </clipPath>
          <pattern id="hatch" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="24" fill="#FF3B30" fillOpacity="0.28" />
          </pattern>
        </defs>

        {/* the matchup, said in the first second */}
        <text x={W / 2} y={190} textAnchor="middle" fontSize={nameSize} letterSpacing={2}>
          <tspan fill={A.color}>{A.name.toUpperCase()}</tspan>
          <tspan fill={PAPER} dx={24}>VS</tspan>
          <tspan fill={B.color} dx={24}>{B.name.toUpperCase()}</tspan>
        </text>
        <text x={W / 2} y={300} textAnchor="middle" fontSize={76} fill={PAPER} letterSpacing={6}>WHO WINS?</text>
        <TugBar battle={battle} hp={st.hp} />

        <g transform={`translate(${AX + sx} ${AY + sy}) scale(${SCALE})`}>
          <rect width={ARENA} height={ARENA} fill="url(#grid)" />
          {sudden && (
            <path d={`M0 0H${ARENA}V${ARENA}H0Z M${st.lo} ${st.lo}V${st.lo + st.size}H${st.lo + st.size}V${st.lo}Z`} fill="url(#hatch)" fillRule="evenodd" />
          )}
          <rect x={st.lo} y={st.lo} width={st.size} height={st.size} fill="none" stroke={sudden ? "#FF3B30" : PAPER} strokeWidth={8} />
          {st.mines.map((m) => (
            <g key={m.id}>
              <circle cx={m.x} cy={m.y} r={16} fill={INK} stroke={teamOf(battle, m.t).color} strokeWidth={5} />
              {m.armed && frame % 16 < 8 && <circle cx={m.x} cy={m.y} r={6} fill="#FF3B30" />}
            </g>
          ))}
          {st.balls.map((ball) => (
            <Ball key={ball.id} ball={ball} color={teamOf(battle, ball.t).color} turn={frame * 0.05} />
          ))}
          <g clipPath="url(#arena)">
            <Effects events={battle.events} frame={frame} toVideo={tl.toVideo} battle={battle} />
          </g>
        </g>

        {sudden && !slow && !outro && <text x={W / 2} y={AY - 22} textAnchor="middle" fontSize={44} fill="#FF3B30" letterSpacing={4}>SUDDEN DEATH: THE WALLS ARE CLOSING</text>}
        {slow && <text x={W / 2} y={AY - 22} textAnchor="middle" fontSize={44} fill={PAPER} letterSpacing={6}>SLOW MOTION</text>}

        {!outro && (
          <>
            <text x={W / 2} y={1590} textAnchor="middle" fontSize={68} fill={PAPER} letterSpacing={3}>COMMENT WHO YOU PICKED</text>
            <text x={W / 2} y={1670} textAnchor="middle" fontSize={44} fill={PAPER} fillOpacity={0.45} letterSpacing={3}>
              {`${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`}
            </text>
          </>
        )}
        {p.tag && (
          <text x={W / 2} y={1840} textAnchor="middle" fontSize={34} fill={PAPER} fillOpacity={0.6} letterSpacing={3}>MADE WITH HOOKLINE</text>
        )}
      </svg>

      {outro && (
        <AbsoluteFill style={{ background: `rgba(11,11,12,${dim})`, alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <div style={{ transform: `scale(${0.6 + 0.4 * pop})`, textAlign: "center", lineHeight: 0.92 }}>
            <div style={{ fontSize: win ? Math.min(230, 1500 / win.name.length) : 230, color: win?.color ?? PAPER }}>{win ? win.name.toUpperCase() : "DRAW"}</div>
            {win && <div style={{ fontSize: 170, color: PAPER }}>WINS</div>}
            <div style={{ fontSize: 56, color: PAPER, opacity: 0.75, marginTop: 36, letterSpacing: 3 }}>
              {battle.winner === null ? "NOBODY LEFT STANDING" : battle.byTimeout ? `ON HEALTH, ${Math.ceil(last.hp[battle.winner])} TO ${Math.ceil(last.hp[1 - battle.winner])}` : `WITH ${Math.ceil(last.hp[battle.winner])} HP LEFT`}
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 300, fontSize: 72, color: PAPER, letterSpacing: 3 }}>DID YOU CALL IT?</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

/** How long the video is, for the player and the renderer. */
export function battleDuration(p: Pick<BattleProps, "a" | "b" | "seed" | "battle">): number {
  return timeline(p.battle ?? simulate(p.a, p.b, p.seed)).duration;
}
