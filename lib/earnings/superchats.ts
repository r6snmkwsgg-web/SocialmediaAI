import { localParts } from "../shorts/times";
import type { Point } from "./series";

/**
 * Super Chats and Super Stickers in Earnings, worked out without the
 * database so they can be tested: a channel's read from YouTube added up
 * by local day and currency, the days that read covered in full, and a
 * channel's figures for the days Hookline has read of them.
 *
 * YouTube lists a channel's last 30 days of them, newest first, with what
 * each viewer paid in their own currency before YouTube's share. Hookline
 * keeps each day once a read has covered it in full, and never calls a
 * day it hasn't read a day without any.
 */

/** One Super Chat or Super Sticker as YouTube lists it: what the viewer paid in millionths, in its currency, and when. */
export type SuperChat = { amountMicros: number; currency: string; createdAt: Date };

/** how far back YouTube lists a channel's Super Chats */
export const SUPER_CHAT_DAYS = 30;

const DAY = 86400_000;

/** A moment's day where the account is, as "2026-10-15". */
export function localDay(at: Date, tz: string): string {
  const t = localParts(at, tz);
  return `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
}

/** The day after a day. */
export const dayAfter = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() + DAY).toISOString().slice(0, 10);

/**
 * What one read of a channel's Super Chats covered. `whole` says the read
 * reached back past 30 days (or the end of YouTube's list), so every one
 * since then is in it; otherwise it stopped at its page limit, and the day
 * of the oldest one read may be missing some. `first` is the first local
 * day it covered in full, and `days` is what viewers paid on each day from
 * then on, by lowercase currency and day.
 */
export function superChatsRead(items: SuperChat[], o: { tz: string; now: Date; whole: boolean }): { first: string; days: Map<string, Map<string, number>> } {
  const since = new Date(o.now.getTime() - SUPER_CHAT_DAYS * DAY);
  const kept = items.filter((x) => x.createdAt >= since);
  const oldest = kept.reduce((a, x) => (x.createdAt < a ? x.createdAt : a), o.now);
  // the day the read reaches back into may be only part read, so it starts the day after
  const first = dayAfter(localDay(o.whole ? since : oldest, o.tz));
  // added up in millionths, so the sums are exact
  const micros = new Map<string, Map<string, number>>();
  for (const x of kept) {
    const day = localDay(x.createdAt, o.tz);
    if (day < first) continue;
    const cur = x.currency.toLowerCase();
    if (!micros.has(cur)) micros.set(cur, new Map());
    const m = micros.get(cur)!;
    m.set(day, (m.get(day) ?? 0) + x.amountMicros);
  }
  const days = new Map([...micros].map(([cur, m]) => [cur, new Map([...m].map(([day, v]) => [day, v / 1e6]))]));
  return { first, days };
}

/**
 * A channel's figures for each day: what it had on the days Hookline has
 * read in full (none where nothing came), and unknown before the first of
 * them or after the last read, never none.
 */
export function readBetween(days: string[], values: Map<string, number>, from: string, through: string): Point[] {
  return days.map((day) => ({ day, value: day >= from && day <= through ? (values.get(day) ?? 0) : null }));
}
