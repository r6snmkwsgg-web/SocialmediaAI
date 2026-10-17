import type { CohortRow } from "../server/cohorts";

/**
 * The typical account, as /admin shows it: each week's figures in words,
 * with the middle account's count of Shorts and the middle half's beside
 * it, never the best account's. A week with too few accounts shows no
 * figures, since they'd be one or two people's, and the first-4-weeks
 * figures wait until enough of its accounts are 4 weeks old.
 */

/** How many whole weeks of sign-ups the table shows. */
export const WEEKS = 12;

/** Fewer accounts than this and a figure would be one or two people's, so it isn't shown. */
export const SMALL = 5;

/** What a first-4-weeks figure says until enough of a row's accounts are 4 weeks old. */
export const NOT_YET = "Not yet";

/** A row's figures as the table shows them. */
export type CohortCells = { accounts: string; connected: string; kept: string; postedAny: string; posted: string; tiktok: string; week4: string };

/** One row of the table: the weeks it covers, and its figures, or null when it has too few accounts to show any. */
export type CohortView = { key: string; label: string; all: boolean; cells: CohortCells | null };

const count = (n: number) => n.toLocaleString("en-US");

/** A week of sign-ups by its Monday, as the table names it: "Mar 2". */
export function weekOf(monday: string): string {
  return new Date(`${monday}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * One row in words. The first-4-weeks figures count only accounts at least
 * 28 days old, out of how many there are, and say Not yet until there are
 * enough of them. Shorts posted is the middle account's count, then the
 * range the middle half of accounts posted in.
 */
export function cohortView(row: CohortRow, weeks = WEEKS): CohortView {
  const key = row.week ?? "all";
  const label = row.week ? weekOf(row.week) : `All ${weeks} weeks`;
  if (row.accounts < SMALL) return { key, label, all: row.week === null, cells: null };
  const ready = row.complete >= SMALL;
  const of = (n: number) => (ready ? `${count(n)} of ${count(row.complete)}` : NOT_YET);
  const p = row.posted;
  return {
    key,
    label,
    all: row.week === null,
    cells: {
      accounts: count(row.accounts),
      connected: count(row.connected),
      kept: count(row.kept),
      postedAny: of(row.postedAny),
      posted: ready && p ? `${count(p.median)} (${count(p.low)} to ${count(p.high)})` : NOT_YET,
      tiktok: of(row.tiktok),
      week4: of(row.week4),
    },
  };
}
