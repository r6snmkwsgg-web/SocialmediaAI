import { useMemo } from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/fonts";
import { ABILITIES, type AbilityId } from "../lib/battle/abilities";
import { ordinal } from "../lib/battle/league";
import { momentOf, series, winnerOf, type Series } from "../lib/battle/series";
import { ARENA, FPS, simulate, SUDDEN_DEATH, type Battle, type BattleEvent, type BallFrame, type Team } from "../lib/battle/sim";
import type { Timeline } from "../lib/battle/timeline";
import { cos, sin } from "../lib/battle/trig";
import { alpha, isLight, textOn as onColour, type Look } from "../lib/shorts/look";
import { endFrames, endingOf, LEAGUE_OPEN } from "../lib/shorts/timing";
import type { BattleParams, LeagueCard, LeagueLine } from "../lib/shorts/types";
import { Back, Backdrop, caps, face, lookOf, rise, size } from "./shorts/kit";

// shipped with the app (SIL Open Font License), so a render never waits on Google
const ANTON = "Anton";
// only in a browser: the page's server render has nothing to load it into
if (typeof window !== "undefined") loadFont({ family: ANTON, url: staticFile("fonts/Anton-Regular.woff2"), weight: "400" });

/**
 * A battle Short's parameters, and how it's shown: a Ball League match
 * carries its health, its games, its speed and what the league says
 * about it (see BattleParams).
 */
export type BattleProps = BattleParams & {
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
/** where the arena's top left corner is drawn */
export const AX = 60;
export const AY = 520;
const INK = "#0B0B0C";
const FX = 18;
/** the arena is drawn 960 pixels wide, whatever size the physics uses */
export const SCALE = 960 / ARENA;
/** how long a knockout's later game says which it is, as it starts */
const LABEL = Math.round(1.2 * FPS);

/** Dark text on light balls, light text on dark ones. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? INK : "#fff";
}

const teamOf = (b: Battle, t: Team) => ABILITIES[t === 0 ? b.a : b.b];

/** The two sides a fight is drawn with, red then blue: a battle's are its two abilities, a LIVE round's the streamer's own teams. */
export type Sides = [{ name: string; color: string }, { name: string; color: string }];

/** A battle's sides: each ability's name and colour. */
export const sidesOf = (b: Battle): Sides => [teamOf(b, 0), teamOf(b, 1)].map((a) => ({ name: a.name, color: a.color })) as Sides;

/** A Ball League match's sides: the two balls of the channel's cast, by name and colour. */
export const leagueSides = (card: LeagueCard): Sides => card.sides.map((s) => ({ name: s.name, color: s.color })) as Sides;

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

/** What a Ball League match's header shows: its card, each side's power, how far the stakes line has faded in, and how fast its fights play. */
type LeagueHead = { card: LeagueCard; powers: [AbilityId, AbilityId]; stakes: number; speed: number };

/** A name in a ball's own colour, outlined in the look's text colour so it reads on any background. */
const outlined = (look: Look, px = 3): React.CSSProperties => ({ WebkitTextStroke: `${px}px ${look.text}`, paintOrder: "stroke fill" });

/**
 * A line the league says, at most 32 characters: the ball it's about, if
 * any, in a chip of its own colour, then the line itself in `color`. A
 * line about the ball already named above it (`named`) goes without.
 */
function Said({ line, sides, look, px, color, named = null }: { line: LeagueLine; sides: Sides; look: Look; px: number; color: string; named?: Team | null }) {
  const ball = line.side === null || line.side === named ? null : sides[line.side];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: Math.round(px * 0.35), fontSize: px, lineHeight: 1.15, whiteSpace: "nowrap" }}>
      {ball && (
        <span style={{ background: ball.color, color: textOn(ball.color), padding: `${Math.round(px * 0.06)}px ${Math.round(px * 0.28)}px`, borderRadius: look.round / 2, boxShadow: `0 0 0 3px ${look.text}` }}>
          {caps(look, ball.name)}
        </span>
      )}
      <span style={{ color }}>{caps(look, line.text)}</span>
    </div>
  );
}

/** A size for a line with its chip that fits across the frame: smaller for a long one, never bigger than `base`. */
const lineSize = (line: LeagueLine, sides: Sides, base: number, width = 900, named: Team | null = null) =>
  Math.min(base, width / (0.52 * (line.text.length + (line.side === null || line.side === named ? 0 : sides[line.side].name.length + 2))));

/**
 * A Ball League match's header, where a battle names its matchup: which
 * match it is, the two balls in their colours with each one's power and
 * how it stands (its place and its won, drawn and lost), then what's at
 * stake, or "Who wins?" when nothing is certain yet.
 */
function LeagueHeader({ head, sides, look }: { head: LeagueHead; sides: Sides; look: Look }) {
  const { card } = head;
  const spaced = look.face === "anton" ? 3 : 0;
  // both names the same size, each fitting its half
  const px = size(look, Math.min(64, 760 / Math.max(sides[0].name.length, sides[1].name.length)));
  const side = (t: Team) => {
    const s = card.sides[t];
    const how = [ABILITIES[head.powers[t]].name, ...(s.place ? [ordinal(s.place), `${s.record.won}-${s.record.drawn}-${s.record.lost}`] : [])].join(" · ");
    return (
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <div style={{ fontSize: px, lineHeight: 1.04, color: sides[t].color, whiteSpace: "nowrap", ...outlined(look) }}>{caps(look, sides[t].name)}</div>
        <div style={{ fontSize: size(look, 30), lineHeight: 1.1, color: look.text, opacity: 0.75, letterSpacing: spaced, whiteSpace: "nowrap" }}>{caps(look, how)}</div>
      </div>
    );
  };
  const stakes = card.stakes ?? { side: null, text: "Who wins?" };
  return (
    <div style={{ position: "absolute", left: AX, right: AX, top: 150, display: "flex", flexDirection: "column", alignItems: "center", ...face(look) }}>
      <div style={{ fontSize: size(look, 34), lineHeight: "40px", color: look.accent, letterSpacing: spaced + 1, whiteSpace: "nowrap" }}>{caps(look, `Season ${card.season} · ${card.label}`)}</div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 20, width: "100%", marginTop: 2 }}>
        {side(0)}
        <div style={{ fontSize: size(look, 40), lineHeight: `${px * 1.04}px`, color: look.text }}>{caps(look, "vs")}</div>
        {side(1)}
      </div>
      <div style={{ marginTop: 10, opacity: head.stakes }}>
        <Said line={stakes} sides={sides} look={look} px={size(look, lineSize(stakes, sides, 38))} color={look.text} />
      </div>
    </div>
  );
}

/**
 * One moment of one fight, as drawn: who's in it, the health bar and the
 * arena. A battle names its matchup at the top; a Ball League match has
 * its own header instead. What goes over the fight (a match's opening, a
 * gap between games, the ending) is drawn on top of this.
 */
function BattleScene({ battle, tl, frame, sides, look, comments, tag, league }: {
  battle: Battle; tl: Timeline; frame: number; sides: Sides; look: Look; comments: boolean; tag: boolean; league?: LeagueHead;
}) {
  const simF = Math.min(tl.toSim(frame), battle.frames.length - 1);
  const st = battle.frames[simF];
  const [A, B] = sides;
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
  const nameSize = size(look, Math.min(150, 1900 / (A.name.length + B.name.length + 4)));
  const F = face(look);
  // the powers' own colours need an outline to read on a light background
  const edge = isLight(look) ? { stroke: look.text, strokeWidth: 3, paintOrder: "stroke" as const } : {};
  const spaced = look.face === "anton" ? 3 : 0;
  // a long final played faster says so, wherever nothing else is being said over the arena
  const faster = league && league.speed !== 1 && !sudden && !slow && !outro ? `Played at ${league.speed}x speed` : null;

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
        {!league && (
          <>
            <text x={W / 2} y={190} textAnchor="middle" fontSize={nameSize} letterSpacing={spaced ? 2 : 0}>
              <tspan fill={A.color} {...edge}>{caps(look, A.name)}</tspan>
              <tspan fill={look.text} dx={24}>{caps(look, "vs")}</tspan>
              <tspan fill={B.color} dx={24} {...edge}>{caps(look, B.name)}</tspan>
            </text>
            <text x={W / 2} y={300} textAnchor="middle" fontSize={size(look, 76)} fill={look.text} letterSpacing={spaced * 2}>{caps(look, "Who wins?")}</text>
          </>
        )}
        {/* a league's balls have their own colours, outlined so each reads on any look */}
        <TugBar sides={sides} hp={st.hp} look={look} edge={!!league} />

        <g transform={`translate(${AX + sx} ${AY + sy}) scale(${SCALE})`}>
          <rect width={ARENA} height={ARENA} fill="url(#grid)" />
          {sudden && (
            <path d={`M0 0H${ARENA}V${ARENA}H0Z M${st.lo} ${st.lo}V${st.lo + st.size}H${st.lo + st.size}V${st.lo}Z`} fill="url(#hatch)" fillRule="evenodd" />
          )}
          <rect x={st.lo} y={st.lo} width={st.size} height={st.size} fill="none" stroke={sudden ? "#FF3B30" : look.text} strokeWidth={8} rx={look.round / SCALE / 2} />
          {st.mines.map((m) => (
            <g key={m.id}>
              <circle cx={m.x} cy={m.y} r={16} fill={look.bg} stroke={sides[m.t].color} strokeWidth={5} />
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
        {faster && <text x={W / 2} y={AY - 22} textAnchor="middle" fontSize={size(look, 40)} fill={look.text} fillOpacity={0.75} letterSpacing={spaced + 1}>{caps(look, faster)}</text>}

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
      {league && <LeagueHeader head={league} sides={sides} look={look} />}
    </AbsoluteFill>
  );
}

/**
 * A Ball League match's opening, over the top of the arena while its
 * fight starts: what happened before it, there from the first frame and
 * gone after three seconds, styled like every Short's title.
 */
function Previously({ frame, card, sides, look }: { frame: number; card: LeagueCard; sides: Sides; look: Look }) {
  if (frame >= LEAGUE_OPEN) return null;
  const k = 1 - rise(frame, LEAGUE_OPEN - 9, 9);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: AY + 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, opacity: k, transform: `translateY(${(1 - k) * -40}px)`, ...face(look) }}>
      <div style={{ fontSize: size(look, 84), lineHeight: 1.04, padding: "8px 30px", background: look.accent, color: onColour(look.accent), borderRadius: look.round / 2, transform: "rotate(-2deg)" }}>
        {caps(look, "Previously")}
      </div>
      {card.previously.map((line, i) => (
        <div key={i} style={{ padding: "8px 22px", background: look.text, borderRadius: look.round / 2, transform: `rotate(${i % 2 ? -1.2 : 1.5}deg)` }}>
          <Said line={line} sides={sides} look={look} px={size(look, lineSize(line, sides, 54, 860))} color={look.bg} />
        </div>
      ))}
    </div>
  );
}

/** The start of a knockout's next game: which game it is, over the top of the arena for a moment. */
function GameLabel({ n, frame, look }: { n: number; frame: number; look: Look }) {
  if (frame >= LABEL) return null;
  const k = 1 - rise(frame, LABEL - 8, 8);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: AY + 48, display: "flex", justifyContent: "center", opacity: k, ...face(look) }}>
      <div style={{ fontSize: size(look, 96), lineHeight: 1.04, padding: "8px 32px", background: look.accent, color: onColour(look.accent), borderRadius: look.round / 2, transform: "rotate(-2deg)" }}>
        {caps(look, `Game ${n}`)}
      </div>
    </div>
  );
}

/** How a knockout's game went, for the gap after it or the card it's shown as: its number, who took it (null for a draw), and how the match stands. */
type GameNote = { n: number; who: Team | null; lines: string[] };

function noteOf(s: Series, i: number, sides: Sides, final: boolean): GameNote {
  const g = s.games[i];
  const wins = ([0, 1] as const).map((t) => s.games.slice(0, i + 1).filter((x) => x.winner === t).length);
  // only the final counts games won, and draws don't count
  const lead = !final || wins[0] + wins[1] === 0 ? null : wins[0] === wins[1] ? `Level at ${wins[0]}-${wins[1]}` : wins[0] > wins[1] ? `${sides[0].name} leads ${wins[0]}-${wins[1]}` : `${sides[1].name} leads ${wins[1]}-${wins[0]}`;
  const how = g.seed === null ? ["The seeds ran out, so it goes to the higher-placed ball"] : g.winner === null ? ["It's played again"] : [];
  return { n: i + 1, who: g.winner, lines: [...how, ...(lead ? [lead] : [])] };
}

/**
 * Between a knockout's games, the last frame of one dimmed under how it
 * went and how the match stands; and a game shown as a card the same way,
 * over the last game fought. `since` is the frames since it began, and a
 * card always follows a gap or another card, so it's dimmed from the start.
 */
function Pause({ p, since, card, sides, look }: { p: GameNote; since: number; card: boolean; sides: Sides; look: Look }) {
  const k = rise(since, 0, 8);
  const who = p.who === null ? null : sides[p.who];
  const spaced = look.face === "anton" ? 3 : 0;
  return (
    <AbsoluteFill style={{ background: alpha(look.bg, 0.88 * (card ? 1 : k)), alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14, padding: "0 90px", textAlign: "center", ...face(look) }}>
      <div style={{ opacity: k, transform: `scale(${0.85 + 0.15 * k})`, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ fontSize: size(look, 96), lineHeight: 1, color: look.text, letterSpacing: spaced }}>{caps(look, `Game ${p.n}`)}</div>
        <div style={{ fontSize: size(look, who ? Math.min(150, 1400 / who.name.length) : 150), lineHeight: 1, color: who?.color ?? look.text, ...(who ? outlined(look, 4) : {}) }}>
          {caps(look, who ? who.name : "A draw")}
        </div>
        {p.lines.map((l, i) => (
          <div key={l} style={{ fontSize: size(look, i === 0 ? 56 : 48), lineHeight: 1.1, color: i === 0 ? look.text : look.accent, opacity: i === 0 ? 0.85 : 1, letterSpacing: spaced }}>{caps(look, l)}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

/**
 * How the video ends: who won and the word for it, how the game that
 * decided it was won (when one fought did), and for a Ball League match
 * what the result means in the league.
 */
type Outcome = { winner: Team | null; word: string; line: string | null; after: LeagueLine[] };

/** A fight's last moment in words: how much health the winner had left, the health either side had when time ran out, or nobody standing. */
function healthLine(b: Battle): string {
  const last = b.frames[b.endFrame];
  if (b.winner === null) return "Nobody left standing";
  return b.byTimeout ? `On health, ${Math.ceil(last.hp[b.winner])} to ${Math.ceil(last.hp[1 - b.winner])}` : `With ${Math.ceil(last.hp[b.winner])} HP left`;
}

function outcomeOf(s: Series, league?: LeagueCard): Outcome {
  const winner = winnerOf(s);
  const last = s.games[s.games.length - 1];
  // a semi-final that's only draws goes to the higher-placed ball: it goes through, it doesn't win
  const through = s.games.length > 1 && s.games.every((g) => g.winner === null);
  const decided = last.battle && last.winner === winner ? last.battle : null;
  return { winner, word: through ? "goes through" : "wins", line: decided ? healthLine(decided) : null, after: league?.after ?? [] };
}

/**
 * The result, over the fight's last frame: who won, how, what it means in
 * the league, and only where comments are on, the question for them.
 * `edge` is how the winner's name is outlined, if it is.
 */
function Ending({ since, outcome, sides, look, comments, edge }: { since: number; outcome: Outcome; sides: Sides; look: Look; comments: boolean; edge: React.CSSProperties }) {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: since, fps, config: { damping: 11, mass: 0.7 } });
  const dim = interpolate(since, [0, 8], [0, 0.9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const win = outcome.winner === null ? null : sides[outcome.winner];
  const spaced = look.face === "anton" ? 3 : 0;
  return (
    <AbsoluteFill style={{ background: alpha(look.bg, dim), alignItems: "center", justifyContent: "center", flexDirection: "column", ...face(look) }}>
      <div style={{ transform: `scale(${0.6 + 0.4 * pop})`, textAlign: "center", lineHeight: 0.96 }}>
        <div style={{ fontSize: size(look, win ? Math.min(230, 1500 / win.name.length) : 230), color: win?.color ?? look.text, ...(win ? edge : {}) }}>{caps(look, win ? win.name : "Draw")}</div>
        {win && <div style={{ fontSize: size(look, Math.min(170, 1800 / outcome.word.length)), color: look.text }}>{caps(look, outcome.word)}</div>}
        {outcome.line && <div style={{ fontSize: size(look, 56), color: look.text, opacity: 0.75, marginTop: 36, letterSpacing: spaced }}>{caps(look, outcome.line)}</div>}
      </div>
      {outcome.after.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, marginTop: 48 }}>
          {outcome.after.map((line, i) => (
            <div key={i} style={{ opacity: rise(since, 10 + i * 6, 10) }}>
              <Said line={line} sides={sides} look={look} px={size(look, lineSize(line, sides, 54, 900, outcome.winner))} color={i === 0 ? look.accent : look.text} named={outcome.winner} />
            </div>
          ))}
        </div>
      )}
      {comments && <div style={{ position: "absolute", bottom: 300, fontSize: size(look, 72), color: look.text, letterSpacing: spaced }}>{caps(look, "Did you call it?")}</div>}
    </AbsoluteFill>
  );
}

/** Everything a battle Short draws from: its games laid out, its two sides, its look, and for a Ball League match, its card and the balls' powers. */
type Show = { s: Series; sides: Sides; outcome: Outcome; look: Look; comments: boolean; tag: boolean; league?: LeagueCard; powers: [AbilityId, AbilityId] };

/**
 * One frame of a battle Short: the fight it falls in, and over it a
 * league match's opening, a later game's label, how a game went between
 * games (or as a card), or the ending.
 */
function Moment({ s, sides, outcome, look, comments, tag, league, powers, frame }: Show & { frame: number }) {
  const m = momentOf(s, frame);
  const g = s.games[m.shown];
  const opening = m.kind === "fight" && m.game === 0;
  // what's at stake comes in once the opening's "previously" has gone
  const head = league && { card: league, powers, speed: s.speed, stakes: opening ? rise(m.local, LEAGUE_OPEN, 10) : 1 };
  const paused = (m.kind === "gap" || m.kind === "card") && noteOf(s, m.game, sides, league?.stage === "final");
  // a league's ball colours are outlined on every look; a battle's powers only need it on a light one
  const edge = league ? outlined(look, 4) : isLight(look) ? { WebkitTextStroke: `4px ${look.text}` } : {};
  return (
    <AbsoluteFill>
      <BattleScene battle={g.battle!} tl={g.tl!} frame={m.local} sides={sides} look={look} comments={comments} tag={tag} league={head} />
      {league && opening && <Previously frame={m.local} card={league} sides={sides} look={look} />}
      {m.kind === "fight" && m.game > 0 && <GameLabel n={m.game + 1} frame={m.local} look={look} />}
      {paused && <Pause p={paused} since={m.kind === "gap" ? m.local - g.tl!.outroFrom : frame - s.games[m.game].from} card={m.kind === "card"} sides={sides} look={look} />}
      {m.kind === "end" && <Ending since={frame - s.endFrom} outcome={outcome} sides={sides} look={look} comments={comments} edge={edge} />}
    </AbsoluteFill>
  );
}

export const BattleVideo: React.FC<BattleProps> = (p) => {
  const frame = useCurrentFrame();
  const { a, b, seed, hp, games, speed, cards, battle, league } = p;
  // a fight already worked out is the one game; otherwise each game is run from its seed
  const s = useMemo(() => series({ a, b, seed, hp, games, speed, cards }, battle ? () => battle : simulate), [a, b, seed, hp, games, speed, cards, battle]);
  const sides = useMemo(() => (league ? leagueSides(league) : sidesOf(s.games[0].battle!)), [league, s]);
  const outcome = useMemo(() => outcomeOf(s, league), [s, league]);
  const look = lookOf(p);
  const ending = endingOf(p);
  const total = s.endFrom + endFrames("battle", ending);
  const sound = p.soundUrl ?? (p.soundFile ? staticFile(p.soundFile) : null);
  const show: Show = { s, sides, outcome, look, comments: p.allowComments !== false, tag: p.tag, league, powers: [a, b] };

  return (
    <AbsoluteFill style={{ background: look.bg }}>
      {sound && <Audio src={sound} />}
      <Moment {...show} frame={frame} />
      {ending === "loop" && (
        <Back frame={frame} total={total} look={look}>
          <Moment {...show} frame={0} />
        </Back>
      )}
    </AbsoluteFill>
  );
};

/** How long the video is, for the player and the renderer: its games one after another, then its ending. */
export function battleDuration(p: Pick<BattleProps, "a" | "b" | "seed" | "hp" | "games" | "speed" | "cards" | "battle" | "ending" | "allowComments">): number {
  const { battle } = p;
  return series(p, battle ? () => battle : simulate).endFrom + endFrames("battle", endingOf(p));
}
