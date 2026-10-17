"use client";
import { useActionState } from "react";
import type { NamesState, saveNames } from "@/app/app/(shell)/live/actions";

/**
 * One tap between showing viewers' names in the game and showing their
 * initials, with no profile pictures. A game that's already open asks
 * every half minute, so it changes within a minute.
 */
export function NamesSwitch({ hidden, action }: { hidden: boolean; action: typeof saveNames }) {
  const [state, save, saving] = useActionState<NamesState, FormData>(action, null);
  // what the last tap saved, until the page catches up with it
  const on = state?.ok ? state.hide : hidden;
  return (
    <form action={save} className="flex flex-col gap-3">
      <div role="group" aria-label="Viewer names in the game" className="inline-flex w-fit border-2 border-fg">
        {[
          { hide: false, label: "Show names" },
          { hide: true, label: "Hide names" },
        ].map((o) => (
          <button
            key={o.label}
            type="submit"
            name="hide"
            value={o.hide ? "1" : "0"}
            aria-pressed={on === o.hide}
            disabled={saving}
            className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition disabled:opacity-60 ${on === o.hide ? "bg-fg text-surface" : "text-muted hover:text-fg"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[13px] leading-relaxed text-muted">Hidden, the game shows initials like K.S. and no profile pictures, everywhere it shows a viewer.</p>
      {state && (
        <p role={state.ok ? "status" : "alert"} className={`text-[14px] ${state.ok ? "text-muted" : "text-signal"}`}>
          {!state.ok ? "That didn't save. Try again." : state.hide ? "Names are hidden. A game that's open changes within a minute." : "Names are shown. A game that's open changes within a minute."}
        </p>
      )}
    </form>
  );
}
