import { AbsoluteFill, useCurrentFrame } from "remotion";
import { alpha } from "../../lib/shorts/look";
import { endingOf, QUIZ, quizStep } from "../../lib/shorts/timing";
import type { QuizParams } from "../../lib/shorts/types";
import { Back, Backdrop, BODY, caps, Check, EndBand, face, fit, lookOf, Opening, Outro, rise, SAFE, size, Tag, textOn, W } from "./kit";

const LETTERS = ["A", "B", "C"];

/** One moment of a quiz: the question, its options and the clock. The first question is there from the very first frame. */
function QuizScene({ params, frame }: { params: QuizParams; frame: number }) {
  const L = lookOf(params);
  const n = params.questions.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor((frame - QUIZ.intro) / quizStep)));
  const local = frame - QUIZ.intro - i * quizStep;
  const q = params.questions[i];
  const thinking = local - QUIZ.show;
  const revealed = local >= QUIZ.show + QUIZ.think;
  const left = Math.max(0, Math.min(1, 1 - thinking / QUIZ.think));
  const count = Math.max(1, Math.ceil(3 * left));
  // the first question doesn't animate in: the opening frame already shows it
  const enter = i === 0 ? 1 : rise(local, 0, 9);
  const onGood = textOn(L.good);

  return (
    <AbsoluteFill style={{ color: L.text, ...face(L) }}>
      <Backdrop look={L} />
      <div style={{ position: "absolute", top: SAFE.top, left: SAFE.left, right: W - SAFE.right, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: size(L, 46), letterSpacing: L.face === "anton" ? 4 : 0, opacity: 0.75 }}>{caps(L, `Question ${i + 1} of ${n}`)}</span>
        <span style={{ display: "flex", gap: 12 }}>
          {params.questions.map((_, k) => (
            <span key={k} style={{ width: 26, height: 26, borderRadius: 13, background: k < i || (k === i && revealed) ? L.accent : k === i ? L.text : L.line }} />
          ))}
        </span>
      </div>

      <div style={{ position: "absolute", top: 280, left: SAFE.left, right: W - SAFE.right, height: 420, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: size(L, fit(q.q, 104, 17, 3)), lineHeight: 1.04, opacity: enter, transform: `translateY(${(1 - enter) * 40}px)` }}>
        {caps(L, q.q)}
      </div>

      <div style={{ position: "absolute", top: 740, left: SAFE.left, right: W - SAFE.right, display: "flex", flexDirection: "column", gap: 30 }}>
        {q.options.map((o, k) => {
          const right = k === q.answer;
          const show = i === 0 ? 1 : rise(local, 4 + k * 4, 8);
          const lit = revealed && right;
          return (
            <div
              key={o}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 30,
                height: 160,
                padding: "0 34px",
                background: lit ? L.good : L.panel,
                border: `6px solid ${lit ? L.good : L.text}`,
                borderRadius: L.round,
                opacity: show * (revealed && !right ? 0.32 : 1),
                transform: `translateX(${(1 - show) * 80}px) scale(${lit ? 1 + 0.04 * Math.sin(Math.min(1, (local - QUIZ.show - QUIZ.think) / 8) * Math.PI) : 1})`,
              }}
            >
              <span style={{ width: 92, height: 92, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: lit ? onGood : L.text, color: lit ? L.good : L.bg, borderRadius: L.round / 2, fontSize: size(L, 66) }}>{LETTERS[k]}</span>
              <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: o.length > 18 ? 54 : 64, lineHeight: 1.05, color: lit ? onGood : L.text }}>{o}</span>
              {lit && <span style={{ marginLeft: "auto", display: "flex" }}><Check size={84} color={onGood} /></span>}
            </div>
          );
        })}
      </div>

      <div style={{ position: "absolute", top: 1330, left: SAFE.left, right: W - SAFE.right, display: "flex", alignItems: "center", gap: 28 }}>
        <span style={{ width: 120, height: 120, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size(L, 120), lineHeight: 1, color: L.accent }}>{revealed ? <Check size={110} color={L.good} /> : thinking < 0 ? 3 : count}</span>
        <span style={{ flex: 1, height: 30, background: alpha(L.text, 0.14), borderRadius: L.round ? 15 : 0, overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${(thinking < 0 ? 1 : left) * 100}%`, background: revealed ? L.good : L.accent }} />
        </span>
      </div>

      <Opening frame={frame} look={L} lines={[`${n} questions`, "3 seconds each. Keep score"]} top={SAFE.top - 6} />
    </AbsoluteFill>
  );
}

/** Five questions, three seconds each: think, then the answer lights up. */
export function QuizVideo({ params, tag, total }: { params: QuizParams; tag: boolean; total: number }) {
  const frame = useCurrentFrame();
  const L = lookOf(params);
  const n = params.questions.length;
  const end = QUIZ.intro + n * quizStep;
  const ending = endingOf(params);

  return (
    <AbsoluteFill>
      <QuizScene params={params} frame={Math.min(frame, end - 1)} />
      {ending === "loop" ? (
        <EndBand frame={frame} from={end} text="How many did you get?" look={L} top={1320} />
      ) : (
        <Outro frame={frame} from={end} lines={["How many", `out of ${n}?`]} small={ending === "comment" ? "Comment your score" : undefined} look={L} />
      )}
      {ending === "loop" && (
        <Back frame={frame} total={total} look={L}>
          <QuizScene params={params} frame={0} />
        </Back>
      )}
      <Tag show={tag} look={L} />
    </AbsoluteFill>
  );
}
