import { atLocal, localParts } from "./times";

/**
 * The Shorts calendar: a month as weeks of days (Sunday first, the way
 * most of Hookline's users read a calendar), with each Short on the local
 * day it posts or posted.
 */

export type Month = { y: number; m: number };
export type Day = { y: number; m: number; d: number; key: string; inMonth: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
export const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The local day a moment falls on, as "2026-10-15". */
export function dayKey(at: Date, tz: string): string {
  const p = localParts(at, tz);
  return keyOf(p.y, p.m, p.d);
}

/** "2026-10" from the address, or this month where they are. */
export function parseMonth(s: string | undefined, now: Date, tz: string): Month {
  const hit = s && /^(\d{4})-(\d{2})$/.exec(s);
  if (hit) {
    const y = Number(hit[1]);
    const m = Number(hit[2]);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) return { y, m };
  }
  const p = localParts(now, tz);
  return { y: p.y, m: p.m };
}

export function shiftMonth(at: Month, by: number): Month {
  const i = at.y * 12 + (at.m - 1) + by;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}

export const monthParam = (at: Month) => `${at.y}-${pad(at.m)}`;

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The month as whole weeks, Sunday to Saturday, with the days around it filling the first and last. */
export function monthGrid(at: Month): Day[][] {
  const first = new Date(Date.UTC(at.y, at.m - 1, 1)).getUTCDay();
  const total = Math.ceil((first + daysIn(at.y, at.m)) / 7) * 7;
  const weeks: Day[][] = [];
  for (let i = 0; i < total; i++) {
    const date = new Date(Date.UTC(at.y, at.m - 1, 1 - first + i));
    const day = { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
    if (i % 7 === 0) weeks.push([]);
    weeks.at(-1)!.push({ ...day, key: keyOf(day.y, day.m, day.d), inMonth: day.m === at.m });
  }
  return weeks;
}

/** The moments the grid starts and ends, in a timezone: what to load for it. */
export function gridBounds(at: Month, tz: string): { from: Date; to: Date } {
  const weeks = monthGrid(at);
  const a = weeks[0][0];
  const z = weeks.at(-1)!.at(-1)!;
  const after = new Date(Date.UTC(z.y, z.m - 1, z.d + 1));
  return { from: atLocal(a.y, a.m, a.d, 0, tz), to: atLocal(after.getUTCFullYear(), after.getUTCMonth() + 1, after.getUTCDate(), 0, tz) };
}

/** Things with a time, grouped by the local day they fall on. */
export function byDay<T extends { at: Date }>(items: T[], tz: string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of [...items].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const k = dayKey(it.at, tz);
    out.set(k, [...(out.get(k) ?? []), it]);
  }
  return out;
}
