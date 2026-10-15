/**
 * When to post. A channel's best hours come from its own Shorts: the
 * hours of the day its posts did best at 24 hours. Until there are
 * enough of those, it uses a starting guess and says so.
 */

/** local hours to start with: lunch, after school or work, evening */
export const STARTING_HOURS = [12, 16, 19];

/** The offset of a timezone from UTC at a moment, in minutes. */
export function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The moment it's `hour`:00 on a local date in a timezone. */
export function atLocal(y: number, m: number, d: number, hour: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hour);
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  // once more, in case the first guess crossed a clock change
  t = guess - offsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

/** The local date and hour of a moment. */
export function localParts(at: Date, tz: string): { y: number; m: number; d: number; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" }).formatToParts(at);
  const v = (t: string) => parts.find((p) => p.type === t)!.value;
  return { y: Number(v("year")), m: Number(v("month")), d: Number(v("day")), hour: Number(v("hour")), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(v("weekday")) };
}

export function validTimezone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** The channel's best hours from its own results, best first; null until there's enough to say. */
export function bestHours(results: { hour: number; lift: number }[], want = 3): number[] | null {
  const by = new Map<number, number[]>();
  for (const r of results) by.set(r.hour, [...(by.get(r.hour) ?? []), r.lift]);
  const hours = [...by.entries()]
    .filter(([, ls]) => ls.length >= 2)
    .map(([h, ls]) => ({ h, avg: ls.reduce((a, b) => a + b, 0) / ls.length }))
    .sort((a, b) => b.avg - a.avg)
    .map((x) => x.h);
  return hours.length >= want ? hours.slice(0, want) : null;
}

/**
 * The next free posting times: at the given local hours, at least an hour
 * from now, and never within two hours of something already scheduled.
 */
export function nextSlots(n: number, now: Date, tz: string, hours: number[], taken: Date[]): Date[] {
  const out: Date[] = [];
  const busy = [...taken];
  const start = localParts(now, tz);
  for (let day = 0; out.length < n && day < 30; day++) {
    const base = new Date(Date.UTC(start.y, start.m - 1, start.d + day));
    for (const h of [...hours].sort((a, b) => a - b)) {
      const t = atLocal(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, tz);
      if (t.getTime() < now.getTime() + 3600_000) continue;
      if (busy.some((b) => Math.abs(b.getTime() - t.getTime()) < 2 * 3600_000)) continue;
      out.push(t);
      busy.push(t);
      if (out.length === n) break;
    }
  }
  return out;
}
