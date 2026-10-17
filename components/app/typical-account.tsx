import { Card, CardHead } from "@/components/app/ui";
import { cohortView, NOT_YET, SMALL, WEEKS, type CohortCells } from "@/lib/app/cohorts";
import type { CohortRow } from "@/lib/server/cohorts";

/**
 * /admin's typical account: each week's sign-ups, newest first, after all
 * of them together, and how far they got by Hookline's own records. The
 * Shorts they posted show the middle account's count and the middle half's,
 * never the best account's. YouTube's own numbers are never in it, since
 * YouTube's API rules don't allow combining different people's channels.
 */

/** The columns after the week, in order, the first 4 weeks' last. */
const COLUMNS: [keyof CohortCells, string][] = [
  ["accounts", "Accounts"],
  ["connected", "YouTube connected now"],
  ["kept", "Kept a Short"],
  ["postedAny", "Posted one, YouTube confirmed"],
  ["posted", "Shorts posted, YouTube confirmed"],
  ["tiktok", "Sent one to TikTok"],
  ["week4", "Still saying yes in week 4"],
];
/** the ones that count only each account's first 4 weeks, under a heading of their own */
const FIRST_WEEKS: (keyof CohortCells)[] = ["postedAny", "posted", "tiktok", "week4"];

/** `rows` as cohorts() gives them: every week's together first, then each week with sign-ups, newest first. */
export function TypicalAccount({ rows, weeks = WEEKS }: { rows: CohortRow[]; weeks?: number }) {
  const views = rows.map((r) => cohortView(r, weeks));
  const anyone = rows.some((r) => r.week === null && r.accounts > 0);
  return (
    <Card className="mt-6">
      <CardHead title="Typical account" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">The middle account, not the best</span>} />
      {!anyone ? (
        <p className="px-5 py-5 text-[15px] text-muted">Nobody signed up in the {weeks} weeks before this one. Each week&rsquo;s sign-ups show here from the Monday after.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-[14px]">
              <caption className="sr-only">Each week&rsquo;s sign-ups and how far they got, by Hookline&rsquo;s own records</caption>
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  <td colSpan={COLUMNS.length - FIRST_WEEKS.length + 1} />
                  <th scope="colgroup" colSpan={FIRST_WEEKS.length} className="border-b border-edge pb-2 pl-3 pr-5 pt-4 text-right font-normal">In their first 4 weeks</th>
                </tr>
                <tr className="border-b-2 border-edge align-bottom font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  {/* the week stays in view while the rest scrolls sideways on a phone */}
                  <th scope="col" className="sticky left-0 bg-card px-5 py-3 font-normal">Signed up, week of</th>
                  {COLUMNS.map(([k, name]) => (
                    <th key={k} scope="col" className={`py-3 text-right font-normal ${k === "week4" ? "pl-3 pr-5" : "px-3"}`}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {views.map(({ key, label, all, cells }) => (
                  <tr key={key} className={all ? "border-b-2 border-edge" : "border-b border-edge last:border-0"}>
                    <th scope="row" className={`sticky left-0 whitespace-nowrap bg-card px-5 py-2.5 text-left ${all ? "font-semibold" : "font-normal"}`}>{label}</th>
                    {cells ? (
                      COLUMNS.map(([k]) => (
                        <td key={k} className={`whitespace-nowrap py-2.5 text-right tabular-nums ${k === "week4" ? "pl-3 pr-5" : "px-3"} ${cells[k] === NOT_YET ? "text-[13px] text-muted" : "font-mono text-[12px]"}`}>
                          {cells[k]}
                        </td>
                      ))
                    ) : (
                      <td colSpan={COLUMNS.length} className="px-3 py-2.5 text-[13px] text-muted">Fewer than {SMALL} accounts</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 border-t border-edge px-5 py-4 text-[13px] leading-relaxed text-muted">
            <p>
              Each week is the accounts that signed up from its Monday to its Sunday (UTC). Shorts posted gives the middle account&rsquo;s count, then the lowest and highest of the middle half of accounts. The first 4 weeks&rsquo; columns count only accounts at least 4 weeks old, and say {NOT_YET} until there are {SMALL} of them. A week with fewer than {SMALL} accounts shows no figures.
            </p>
            <p>
              Posted counts only Shorts YouTube confirmed. TikTok counts what was sent. YouTube&rsquo;s own numbers aren&rsquo;t here: YouTube&rsquo;s API rules don&rsquo;t allow combining different people&rsquo;s channels.
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
