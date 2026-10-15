import { AbsoluteFill, useCurrentFrame } from "remotion";
import { QUIZ, quizStep } from "../../lib/shorts/timing";
import type { QuizParams } from "../../lib/shorts/types";
import { ANTON, BODY, Check, fit, GREEN, INK, INK2, Outro, PAPER, rise, SAFE, SIGNAL, Tag, W } from "./kit";

const LETTERS = ["A", "B", "C"];

/** Five questions, three seconds each: think, then the answer lights up green. */
export function QuizVideo({ params, tag }: { params: QuizParams; tag: boolean }) {
  const frame = useCurrentFrame();
  const n = params.questions.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor((frame - QUIZ.intro) / quizStep)));
  const local = frame - QUIZ.intro - i * quizStep;
  const q = params.questions[i];
  const thinking = local - QUIZ.show;
  const revealed = local >= QUIZ.show + QUIZ.think;
  const left = Math.max(0, Math.min(1, 1 - thinking / QUIZ.think));
  const count = Math.max(1, Math.ceil(3 * left));
  const outroAt = QUIZ.intro + n * quizStep;
  const enter = rise(local, 0, 9);

  return (
    <AbsoluteFill style={{ background: INK, color: PAPER, fontFamily: ANTON }}>
      {frame < QUIZ.intro ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {[`${n} QUESTIONS`, "3 SECONDS EACH", "KEEP SCORE"].map((t, k) => (
            <div key={t} style={{ fontSize: k === 0 ? 170 : 110, lineHeight: 1, color: k === 2 ? SIGNAL : PAPER, transform: `scale(${0.6 + 0.4 * rise(frame, k * 8, 10)})`, opacity: rise(frame, k * 8, 6) }}>
              {t}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div style={{ position: "absolute", top: SAFE.top, left: SAFE.left, right: W - SAFE.right, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 46, letterSpacing: 4, opacity: 0.75 }}>QUESTION {i + 1} OF {n}</span>
            <span style={{ display: "flex", gap: 12 }}>
              {params.questions.map((_, k) => (
                <span key={k} style={{ width: 26, height: 26, borderRadius: 13, background: k < i || (k === i && revealed) ? SIGNAL : k === i ? PAPER : "#2c2c30" }} />
              ))}
            </span>
          </div>

          <div style={{ position: "absolute", top: 280, left: SAFE.left, right: W - SAFE.right, height: 420, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: fit(q.q, 104, 17, 3), lineHeight: 1.02, opacity: enter, transform: `translateY(${(1 - enter) * 40}px)` }}>
            {q.q.toUpperCase()}
          </div>

          <div style={{ position: "absolute", top: 740, left: SAFE.left, right: W - SAFE.right, display: "flex", flexDirection: "column", gap: 30 }}>
            {q.options.map((o, k) => {
              const right = k === q.answer;
              const show = rise(local, 4 + k * 4, 8);
              const bg = revealed && right ? GREEN : INK2;
              return (
                <div
                  key={o}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 30,
                    height: 160,
                    padding: "0 34px",
                    background: bg,
                    border: `6px solid ${revealed && right ? GREEN : PAPER}`,
                    opacity: show * (revealed && !right ? 0.32 : 1),
                    transform: `translateX(${(1 - show) * 80}px) scale(${revealed && right ? 1 + 0.04 * Math.sin(Math.min(1, (local - QUIZ.show - QUIZ.think) / 8) * Math.PI) : 1})`,
                  }}
                >
                  <span style={{ width: 92, height: 92, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: revealed && right ? INK : PAPER, color: revealed && right ? GREEN : INK, fontSize: 66 }}>{LETTERS[k]}</span>
                  <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: o.length > 18 ? 54 : 64, lineHeight: 1.05, color: revealed && right ? INK : PAPER }}>{o}</span>
                  {revealed && right && <span style={{ marginLeft: "auto", display: "flex" }}><Check size={84} color={INK} /></span>}
                </div>
              );
            })}
          </div>

          <div style={{ position: "absolute", top: 1330, left: SAFE.left, right: W - SAFE.right, display: "flex", alignItems: "center", gap: 28 }}>
            <span style={{ width: 120, height: 120, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 120, lineHeight: 1, color: SIGNAL }}>{revealed ? <Check size={110} color={GREEN} /> : thinking < 0 ? 3 : count}</span>
            <span style={{ flex: 1, height: 30, background: "#2c2c30" }}>
              <span style={{ display: "block", height: "100%", width: `${(thinking < 0 ? 1 : left) * 100}%`, background: revealed ? GREEN : SIGNAL }} />
            </span>
          </div>
        </>
      )}
      <Outro frame={frame} from={outroAt} lines={["HOW MANY", `OUT OF ${n}?`]} small="COMMENT YOUR SCORE" />
      <Tag show={tag} />
    </AbsoluteFill>
  );
}
