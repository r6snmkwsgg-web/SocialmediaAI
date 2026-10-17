import { Stat } from "@/components/app/ui";
import { times } from "@/lib/shorts/insights";

/** A first day against the usual one, as `againstUsual` gives it, or null before there's one. */
type Vs = { vs: number; estimated: boolean; by: "engaged" | "plays" } | null;

/**
 * What its first day was compared by: engaged views or plays, or plays
 * for now while its engaged views can still come; whose usual it was
 * against, with several channels; and whether a late reading was scaled
 * back. Nothing is compared until its channel has 3 first days.
 */
function vsLine(vs: Vs, typical: number | null, waiting: boolean, channel?: string): string {
  if (vs === null) return typical === null ? "Needs 3 Shorts' first days" : "After its first day";
  const late = vs.estimated ? ", estimated from a late reading" : "";
  if (waiting) return `By plays for now${late}. Engaged views come in a few days.`;
  return `Its first day${channel ? `, against ${channel}'s usual` : ""}, by ${vs.by === "engaged" ? "engaged views" : "plays"}${late}`;
}

/**
 * A Short's first day against its usual one, for its page. It's Hookline's
 * comparison, worked out from YouTube's figures and never one of them, so
 * it gets a row of its own that says it's Hookline's, apart from the rows
 * that say they're YouTube's. `channel` names whose usual it was, when
 * there are several channels.
 */
export function VsUsual({ vs, typical, waiting, channel }: { vs: Vs; typical: number | null; waiting: boolean; channel?: string }) {
  return (
    <div className="border-t-2 border-edge px-5 py-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Hookline&rsquo;s comparison</p>
      <div className="mt-3">
        <Stat label="Vs your usual" value={vs === null ? "—" : times(vs.vs)} sub={vsLine(vs, typical, waiting, channel)} />
      </div>
    </div>
  );
}
