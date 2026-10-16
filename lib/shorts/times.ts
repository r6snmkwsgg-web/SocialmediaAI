import { median, steady } from "./learn";

/**
 * When to post. A channel's best hours come from its own Shorts: the
 * hours of the day its posts did best at 24 hours. Until there are
 * enough of those it uses a starting guess and says so. About one Short
 * in five goes out at another hour, so there's always something to learn
 * from; without that, the starting guess would be all it ever knew.
 */

/** local hours to start with: lunch, after school or work, evening */
export const STARTING_HOURS = [12, 16, 19];

/** local hours a Short can be tried at: 7am to 10pm */
export const TRY_HOURS = Array.from({ length: 16 }, (_, i) => i + 7);

/** the share of Shorts that go out at an hour still being learned */
export const EXPLORE = 0.2;

/** results an hour needs before it can be one of the channel's best */
export const HOUR_RESULTS = 3;

/** One posted Short: the local hour it went out, and how it did against usual at 24 hours. */
export type HourResult = { hour: number; lift: number };

/** Making a formatter is slow and planning makes many, so each timezone's are kept. */
const formats = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string, kind: "offset" | "parts"): Intl.DateTimeFormat {
  const k = `${kind} ${tz}`;
  let f = formats.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", kind === "offset"
      ? { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }
      : { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" });
    formats.set(k, f);
  }
  return f;
}

/** The offset of a timezone from UTC at a moment, in minutes. */
export function offsetMinutes(at: Date, tz: string): number {
  const parts = formatter(tz, "offset").formatToParts(at);
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
  const parts = formatter(tz, "parts").formatToParts(at);
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

/** posts are at least this many hours apart, so hours closer than it can't both be used in a day */
const GAP_HOURS = 2;

/**
 * The channel's best hours from its own results, best first, or null
 * until there's enough to say. An hour goes by its middle result, so one
 * lucky Short can't carry it, pulled toward usual by how few results it
 * has, the way a format is. Only hours with 3 results count, and they're
 * picked at least two hours apart, as posts are, so all of them fit in a
 * day. "Best" means beating an hour that was really tried, so an hour
 * left out has to have done worse than every one picked.
 */
export function bestHours(results: HourResult[], want = 3): number[] | null {
  const by = new Map<number, number[]>();
  for (const r of results) by.set(r.hour, [...(by.get(r.hour) ?? []), r.lift]);
  const ranked = [...by.entries()]
    .filter(([, ls]) => ls.length >= HOUR_RESULTS)
    .map(([h, ls]) => ({ h, score: steady({ score: median(ls)!, samples: ls.length }) }))
    .sort((a, b) => b.score - a.score || a.h - b.h);
  const picked: typeof ranked = [];
  for (const x of ranked) if (picked.length < want && picked.every((p) => Math.abs(p.h - x.h) >= GAP_HOURS)) picked.push(x);
  const weakest = picked.at(-1)?.score ?? 0;
  const beaten = ranked.some((x) => !picked.includes(x) && x.score < weakest);
  return picked.length === want && beaten ? picked.map((x) => x.h) : null;
}

/** How many of something each local hour has. */
function countHours(hours: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const h of hours) out.set(h, (out.get(h) ?? 0) + 1);
  return out;
}

/**
 * An hour to try a Short at, to learn from, never one already in use, or
 * null if none that should be tried next `fits`. An hour that's been
 * started (fewer than 3 Shorts posted or booked there) comes before a new
 * one, so each is measured properly before the next; once every hour has
 * been, the least measured.
 */
export function hourToTry(tried: Map<number, number>, using: number[], rand: () => number, fits: (h: number) => boolean = () => true): number | null {
  const open = TRY_HOURS.filter((h) => !using.includes(h));
  const n = (h: number) => tried.get(h) ?? 0;
  const started = open.filter((h) => n(h) > 0 && n(h) < HOUR_RESULTS);
  const fresh = open.filter((h) => n(h) === 0);
  const least = Math.min(...open.map(n));
  // one still being finished waits for a time it fits rather than another being started
  const pool = (started.length ? started : fresh.length ? fresh : open.filter((h) => n(h) === least)).filter(fits);
  return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
}

/** A posting time, and why it's then: the starting guess, one of the channel's best hours, or an hour being tried. */
export type Slot = { at: Date; why: "guess" | "best" | "try"; results: number };

/**
 * Times for `n` Shorts: at the channel's best hours once it has them (the
 * starting guess until then), except that each has an `explore` chance of
 * going out at an hour still being learned. A tried hour takes the place
 * of one of the usual times on that same day, and only where it fits
 * around everything else, so trying never pushes the rest later. `taken`
 * is what's already booked; `unmeasured` is what's posted and still
 * waiting for its 24-hour reading. Null where there's no free time in the
 * next 30 days. In time order.
 */
export function planSlots(n: number, now: Date, tz: string, results: HourResult[], taken: Date[], rand: () => number, explore = EXPLORE, unmeasured: Date[] = []): (Slot | null)[] {
  const best = bestHours(results);
  const hours = best ?? STARTING_HOURS;
  const measured = countHours(results.map((r) => r.hour));
  // Shorts booked at an hour, or posted there and not measured yet, count toward trying it, so a start gets finished
  const tried = countHours([...results.map((r) => r.hour), ...[...taken, ...unmeasured].map((t) => localParts(t, tz).hour)]);
  const slots: (Slot | null)[] = nextSlots(n, now, tz, hours, taken).map((at) => ({ at, why: best ? "best" : "guess", results: measured.get(localParts(at, tz).hour) ?? 0 }));
  while (slots.length < n) slots.push(null);

  // the hour `h` on slot j's day, if it's an hour out and two from everything else
  const moved = (j: number, h: number): Date | null => {
    const day = localParts(slots[j]!.at, tz);
    const t = atLocal(day.y, day.m, day.d, h, tz);
    if (t.getTime() < now.getTime() + 3600_000) return null;
    const others = [...taken, ...slots.filter((x, k): x is Slot => !!x && k !== j).map((x) => x.at)];
    return others.some((b) => Math.abs(b.getTime() - t.getTime()) < GAP_HOURS * 3600_000) ? null : t;
  };
  for (let i = 0; i < n; i++) {
    if (!(rand() < explore)) continue;
    // this one's time, or the next usual one after it, or an earlier one
    const order = [...slots.keys()].map((k) => (i + k) % n).filter((j) => slots[j] && slots[j]!.why !== "try");
    for (const j of order) {
      const h = hourToTry(tried, hours, rand, (h) => moved(j, h) !== null);
      if (h === null) continue;
      slots[j] = { at: moved(j, h)!, why: "try", results: measured.get(h) ?? 0 };
      tried.set(h, (tried.get(h) ?? 0) + 1);
      break;
    }
  }
  return slots.sort((a, b) => (a && b ? a.at.getTime() - b.at.getTime() : a ? -1 : b ? 1 : 0));
}

const hourWord = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h}am` : `${h - 12}pm`);

/**
 * The line in a Short's "why" that says when it posts, and why then, in
 * exactly as much as is known. Each starts "Posts at" or "Best posted
 * around", so it can be found and replaced when the time changes.
 */
export function whenLine(s: Slot, tz: string, scheduling: boolean): string {
  const at = `${scheduling ? "Posts at" : "Best posted around"} ${hourWord(localParts(s.at, tz).hour)}`;
  if (s.why === "try") return `${at}: trying another hour, to learn when your Shorts do best`;
  if (s.why === "best") return `${at}: one of your best hours so far, from ${s.results} Shorts posted then`;
  return `${at}, a starting guess until your own numbers come in`;
}

export const isWhenLine = (line: string) => line.startsWith("Posts at ") || line.startsWith("Best posted around ");

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
      if (busy.some((b) => Math.abs(b.getTime() - t.getTime()) < GAP_HOURS * 3600_000)) continue;
      out.push(t);
      busy.push(t);
      if (out.length === n) break;
    }
  }
  return out;
}
