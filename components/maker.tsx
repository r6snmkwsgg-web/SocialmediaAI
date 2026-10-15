"use client";
import { useState, useTransition } from "react";
import { ABILITIES, ABILITY_IDS, type AbilityId } from "@/lib/battle/abilities";
import { drama, pickBattle, type Drama } from "@/lib/battle/drama";
import { simulate, type Battle } from "@/lib/battle/sim";
import { BattlePlayer } from "./battle-player";
import { Phone } from "./phone";

const TRIES = 24;

type Result = { battle: Battle; drama: Drama; tried: number };

/** "a 23.4 second fight, the lead changed 3 times…": what the picker found, all from the real run. */
function story(r: Result): string {
  const d = r.drama;
  const winner = r.battle.winner === null ? null : ABILITIES[r.battle.winner === 0 ? r.battle.a : r.battle.b].name;
  const lead = d.leadChanges === 0 ? "One side led the whole way" : `The lead changed hands ${d.leadChanges === 1 ? "once" : `${d.leadChanges} times`}`;
  const end = winner ? `${winner} won with ${Math.round(d.winnerLeft * 100)}% of its health left` : "It ended in a draw";
  return `${lead}. ${end}${d.comeback ? ", after being way behind" : ""}.`;
}

function Picker({ label, value, other, onPick }: { label: string; value: AbilityId; other: AbilityId; onPick: (id: AbilityId) => void }) {
  return (
    <fieldset>
      <legend className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/60">{label}</legend>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {ABILITY_IDS.map((id) => {
          const ab = ABILITIES[id];
          const on = id === value;
          const taken = id === other;
          return (
            <button
              key={id}
              type="button"
              disabled={taken}
              onClick={() => onPick(id)}
              aria-pressed={on}
              className={`flex items-center gap-2 border-2 px-2.5 py-2 text-left font-display text-lg uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-25 ${on ? "border-ink bg-ink text-paper" : "border-ink/15 bg-paper text-ink hover:border-ink/60"}`}
            >
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-ink" style={{ background: ab.color }} aria-hidden="true" />
              {ab.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Pick two abilities and watch the fight: it runs the matchup a couple of
 * dozen times right here in the browser and plays the closest one, the same
 * way Hookline picks every video it makes.
 */
export function Maker({ start }: { start: { a: AbilityId; b: AbilityId; seed: number } }) {
  const [a, setA] = useState<AbilityId>(start.a);
  const [b, setB] = useState<AbilityId>(start.b);
  const [result, setResult] = useState<Result>(() => {
    const battle = simulate(start.a, start.b, start.seed);
    return { battle, drama: drama(battle), tried: 120 };
  });
  const [running, setRunning] = useState(false);
  const [, startTransition] = useTransition();

  const fight = () => {
    setRunning(true);
    // let the button show it's working before the fights run
    setTimeout(() => {
      const r = pickBattle(a, b, TRIES, 1 + Math.floor(Math.random() * 10_000));
      startTransition(() => {
        setResult(r);
        setRunning(false);
      });
    }, 30);
  };

  const r = result;
  const shown = [ABILITIES[r.battle.a], ABILITIES[r.battle.b]];

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-16">
      <div className="flex flex-col gap-7">
        <Picker label="Left ball" value={a} other={b} onPick={setA} />
        <Picker label="Right ball" value={b} other={a} onPick={setB} />
        <div className="grid gap-3 border-y-2 border-ink py-4 sm:grid-cols-2">
          {[a, b].map((id) => (
            <p key={id} className="text-[15px] leading-snug text-ink/80">
              <b className="font-display text-lg uppercase tracking-wide text-ink">{ABILITIES[id].name}.</b> {ABILITIES[id].line}
            </p>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <button
            type="button"
            onClick={fight}
            disabled={running}
            className="press bg-signal px-7 py-3.5 font-display text-2xl uppercase tracking-wider text-ink [--press:var(--color-ink)] disabled:opacity-60"
          >
            {running ? `Running ${TRIES} fights…` : "Fight →"}
          </button>
          <p className="max-w-sm font-mono text-[11px] uppercase leading-relaxed tracking-wider text-ink/60">
            Runs the matchup {TRIES} times in your browser and keeps the closest one.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Phone className="mx-auto w-full max-w-[340px] -rotate-1">
          <BattlePlayer a={r.battle.a} b={r.battle.b} seed={r.battle.seed} battle={r.battle} />
        </Phone>
        <div className="border-2 border-ink bg-paper-2 p-4" aria-live="polite">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/55">
            The closest of {r.tried} runs · {r.drama.seconds.toFixed(1)} seconds
          </p>
          <p className="mt-1.5 text-[15px] leading-snug text-ink">
            <span style={{ color: shown[0].color }} className="font-display text-lg uppercase [-webkit-text-stroke:0.6px_var(--color-ink)]">{shown[0].name}</span>
            <span className="font-display text-lg uppercase text-ink"> vs </span>
            <span style={{ color: shown[1].color }} className="font-display text-lg uppercase [-webkit-text-stroke:0.6px_var(--color-ink)]">{shown[1].name}</span>
            <br />
            {story(r)}
          </p>
        </div>
      </div>
    </div>
  );
}
