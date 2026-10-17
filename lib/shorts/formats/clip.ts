import { ABILITIES } from "../../battle/abilities";
import type { Plan } from "../../billing/plans";
import { clipWindow, type ClipDrama, type ClipLog, type Replay } from "../../live/clip";
import { localParts } from "../times";
import type { Candidate, Spec } from "../types";
import { MELODY_IDS } from "./battle";

/**
 * A round from the creator's own LIVE as a Short: the same fight, step
 * for step, from the game's record of it, credited "From my LIVE". It
 * isn't one of the formats Hookline makes: it comes from a round that was
 * waiting, at most one a morning, and it claims nothing from anyone. No
 * viewer's name goes to the title writer, and neither do coins or gifts,
 * and what it writes never asks anyone for one.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const listed = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What made the round worth watching again, as the swipe card says it: "2 lead changes, a comeback and 1 big gift". */
export function dramaLine(d: ClipDrama): string {
  const bits = [d.leads ? plural(d.leads, "lead change") : "", d.comeback ? "a comeback" : "", d.save ? "a save" : "", d.big ? plural(d.big, "big gift") : "", d.close ? "a close finish" : ""];
  return capital(listed(bits.filter(Boolean)));
}

/** The same, for the title writer, without saying who wins, and saying what the big gifts did rather than that they were gifts. */
function dramaFact(d: ClipDrama): string {
  const said = [
    d.leads ? `${plural(d.leads, "lead change")}.` : "",
    d.comeback ? "The winner came back from well behind." : "",
    d.save ? "A side hanging on by 1 HP was saved in time." : "",
    d.big ? `${d.big === 1 ? "One big power" : `${d.big} big powers`} (a meteor shower, rage or a shield) went off.` : "",
    d.close ? "It was close at the end." : "",
  ];
  return [...said.filter(Boolean), "Don't say who wins."].join(" ");
}

/**
 * A waiting round as a Short it could make, from its replay (the morning
 * run has played it back already, to check it still plays exactly), or
 * null when it doesn't: the cut that shows the most, the round's own
 * number on its LIVE, and what the plan counts it as. It ends on the
 * result, in a tune of its own. Its look and ending are added after, as
 * for every Short.
 */
export function clipCandidate(row: { log: ClipLog; played_at: Date }, r: Replay, o: { tz: string; per: Plan["shorts"]; rand: () => number }): Candidate | null {
  const { log } = row;
  const cut = clipWindow(r, log);
  if (!cut) return null;
  const [red, blue] = [log.teams[0].name, log.teams[1].name];
  const sides = log.game === "rivals"
    ? `The two sides were named ${red} and ${blue} for this round. The balls only stand for the sides viewers picked; nothing in it is those people, teams or brands.`
    : `The sides were called ${red} and ${blue}. Their champions were ${ABILITIES[log.a].name} and ${ABILITIES[log.b].name}.`;
  return {
    format: "clip",
    params: { log, from: cut.from, melody: MELODY_IDS[Math.floor(o.rand() * MELODY_IDS.length)] },
    key: `clip:${log.game}`,
    score: cut.drama.score,
    why: [
      `Round ${log.round} of your LIVE on ${DAYS[localParts(row.played_at, o.tz).weekday]}`,
      dramaLine(cut.drama),
      o.per.per === "day" ? "It counts as one of today's Shorts" : `It counts as one of this week's ${o.per.count} Shorts`,
    ],
    facts: [
      "A round of a ball battle game the creator played with their viewers on their own LIVE, redrawn as a video from the game's record of it. Viewers' gifts dropped balls, rage, shields and meteors into the fight as it happened.",
      sides,
      dramaFact(cut.drama),
      "Don't mention gifts, coins, money or what anything costs, and never ask anyone to send anything. Don't name any viewer.",
    ],
    title: `${red} vs ${blue}: a ball battle round from my LIVE`,
  };
}

/** The same Short showing the names of the people who sent gifts, or not. It keeps the same record, so the round isn't played again. */
export function withNames(spec: Spec, on: boolean): Spec {
  return spec.format === "clip" ? { format: "clip", params: { ...spec.params, names: on } } : spec;
}
