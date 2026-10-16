import "server-only";
import { rng } from "../../battle/sim";
import type { Plan } from "../../billing/plans";
import { words } from "../../shorts/checks";
import { bankIds, contentIds, finish, FORMATS, ledgerClaims } from "../../shorts/formats";
import { bankQuestions } from "../../shorts/formats/quiz";
import { STORIES } from "../../shorts/formats/texts";
import { bankPairs } from "../../shorts/formats/wyr";
import { kindName, times as timesUsual } from "../../shorts/insights";
import { chooseFormats, dryNote, formatReason, formatsFor, kindScore, odds, standout, type Weight } from "../../shorts/learn";
import { atLocal, EXPLORE, localParts, planSlots, validTimezone, whenLine } from "../../shorts/times";
import type { Candidate, Context, Ending, FormatId, Spec } from "../../shorts/types";
import { billingFor } from "../billing";
import { admin, asUser, withUserLock } from "../db";
import { notify } from "../notify";
import { hourResults } from "./hours";
import { claude, freshPairs, freshQuestions, freshStories } from "./fresh";
import { claim, lookFor, takenCharts, takenInOtherWords, takenOf } from "./ledger";
import { plainDescription, writeCopy } from "./titles";

/**
 * Making a channel's Shorts: as many as the plan allows today, in the
 * formats that have done best for it (with room to keep trying the
 * rest), each with a title and a time to post. Nothing it has had comes
 * round again, and nothing another channel has had goes to it: every
 * item is claimed in the content ledger as it's made. Each is drawn in
 * the channel's own look and ends one of a few ways. Runs every morning
 * from the worker, and when someone opens an empty queue. When there's
 * nothing new left to make, it says so instead of making nothing quietly.
 * The morning run remembers when it last tried each account, how that
 * went and when to try next, so accounts that can't get Shorts today wait
 * their turn instead of holding up everyone else.
 */

/** replacements for swiped-away Shorts, a day */
export const REPLACEMENTS_PER_DAY = 10;

type Profile = { timezone: string; goal: string | null; text_stories: boolean; shorts_note_at: Date | null };

type Past = { format: FormatId; params: Spec["params"]; status: string; suggested_for: Date | null; scheduled_for: Date | null; posted_at: Date | null; measuring: boolean };

/** `frees` is when more can next be made once it's used up: the oldest of the week's turning a week old, or tomorrow. */
export type Allowance = { per: "week" | "day"; limit: number; made: number; left: number; replacementsLeft: number; frees: Date };

/** How a morning try at making Shorts went, as `shorts_runs` keeps it: some made, the plan's allowance used up, nothing new left, or an error. */
export type Outcome = "made" | "allowance" | "nothing_new" | "failed";
/**
 * How many it made, and when fewer than it should have, why: the plan's
 * allowance, nothing new left (`note` says it in words), or, asked for one
 * format, that format is off. `retry` is when the morning run should try
 * this account again.
 */
export type Made = { made: number; short: null | "allowance" | "dry" | "off"; note: string | null; retry: Date };

/** Midnight today, or `days` from today, wherever they are. */
function startOfLocalDay(now: Date, tz: string, days = 0): Date {
  const p = localParts(now, tz);
  return atLocal(p.y, p.m, p.d + days, 0, tz);
}

export async function allowanceOf(userId: string, plan: Plan, tz: string, now = new Date()): Promise<Allowance> {
  const since = plan.shorts.per === "week" ? new Date(now.getTime() - 7 * 86400_000) : startOfLocalDay(now, tz);
  const today = startOfLocalDay(now, tz);
  const [r] = await asUser(userId, (tx) => tx<{ made: number; oldest: Date | null; replaced: number; channels: number }[]>`
    select
      (select count(*) from public.videos where origin = 'daily' and created_at >= ${since})::int as made,
      (select min(created_at) from public.videos where origin = 'daily' and created_at >= ${since}) as oldest,
      (select count(*) from public.videos where origin = 'replacement' and created_at >= ${today})::int as replaced,
      (select count(*) from public.channels where platform = 'youtube' and status = 'connected')::int as channels`);
  const limit = plan.shorts.count * (plan.channels > 1 ? Math.max(1, Math.min(plan.channels, r.channels)) : 1);
  const frees = plan.shorts.per === "week" && r.oldest ? new Date(r.oldest.getTime() + 7 * 86400_000) : startOfLocalDay(now, tz, 1);
  return { per: plan.shorts.per, limit, made: r.made, left: Math.max(0, limit - r.made), replacementsLeft: Math.max(0, REPLACEMENTS_PER_DAY - r.replaced), frees };
}

/**
 * Makes up to `count` Shorts and puts them in the queue. Returns how many
 * it made, which can be fewer if the plan's allowance is used up.
 */
export async function makeShorts(userId: string, opts: MakeOpts): Promise<number> {
  return (await makeShortsSaying(userId, opts)).made;
}

/** The same, and when it made fewer than it should have, why: the plan's allowance, or nothing new left to make (in words). */
export async function makeShortsSaying(userId: string, opts: MakeOpts): Promise<Made> {
  return withUserLock(userId, () => make(userId, opts));
}

type MakeOpts = { origin: "daily" | "replacement"; count?: number; now?: Date; like?: FormatId };

/** How long Claude gets to write a channel's new material; after that the banks fill in, so the morning's Shorts never wait long. */
export const FRESH_MS = 60_000;

/** Material written for this channel by Claude, for the formats it's making today. Nothing when Claude isn't set up. */
async function freshFor(formats: FormatId[], history: Past[], rand: () => number): Promise<NonNullable<Context["fresh"]>> {
  const ask = claude(Date.now() + FRESH_MS);
  if (!ask) return {};
  const n = (f: FormatId) => formats.filter((x) => x === f).length;
  const asked = (f: FormatId) => history.filter((h) => h.format === f).map((h) => h.params);
  // everything the banks ask (capitals too), and everything this channel has had
  const knownQuestions = [...bankQuestions(), ...asked("quiz").flatMap((p) => ("questions" in p ? (p.questions ?? []).map((q) => q.q) : []))];
  const knownPairs = [...bankPairs(), ...asked("wyr").flatMap((p) => ("pairs" in p ? (p.pairs ?? []).map((x) => `${x.a} or ${x.b}`) : []))];
  const knownStories = [...STORIES, ...asked("texts").flatMap((p) => ("story" in p && p.story ? [p.story] : []))].map((s) => s.messages.map((m) => m.text).join(" "));
  const [questions, pairs, stories] = await Promise.all([
    n("quiz") ? freshQuestions(ask, knownQuestions, rand, Math.min(20, 7 * n("quiz") + 5)) : [],
    n("wyr") ? freshPairs(ask, knownPairs, rand, Math.min(20, 6 * n("wyr") + 4)) : [],
    n("texts") ? freshStories(ask, knownStories, n("texts") + 1) : [],
  ]);
  return { questions, pairs, stories };
}

async function make(userId: string, opts: MakeOpts): Promise<Made> {
  const now = opts.now ?? new Date();
  const [profile] = await asUser(userId, (tx) => tx<Profile[]>`select timezone, goal, text_stories, shorts_note_at from public.profiles where id = ${userId}`);
  const tz = validTimezone(profile?.timezone);
  const { plan } = await billingFor(userId);
  const allow = await allowanceOf(userId, plan, tz, now);
  const tomorrow = startOfLocalDay(now, tz, 1);
  const want = opts.origin === "daily" ? Math.min(allow.left, opts.count ?? allow.left) : Math.min(allow.replacementsLeft, opts.count ?? 1);
  // used up: tried again when some come free, or tomorrow if that's sooner (a new plan might have started)
  if (want <= 0) return { made: 0, short: "allowance", note: null, retry: new Date(Math.min(allow.frees.getTime(), tomorrow.getTime())) };

  const { history, weights, results } = await asUser(userId, async (tx) => {
    const history = await tx<Past[]>`
      select format, params, status, suggested_for, scheduled_for, posted_at,
        (youtube_id is not null and not exists (select 1 from public.video_stats s where s.video_id = videos.id and s.checkpoint = '24h')) as measuring
      from public.videos where created_at > now() - interval '365 days'`;
    const weights = await tx<Weight[]>`select kind, name, score, samples from public.weights`;
    return { history, weights, results: await hourResults(tx, tz) };
  });

  // what the channel has had, posted or swiped away, and how often: none of it comes round again
  const times = new Map<string, number>();
  for (const h of history) for (const id of contentIds({ format: h.format, params: h.params } as Spec)) times.set(id, (times.get(id) ?? 0) + 1);
  const rand = rng(Math.floor(Math.random() * 2 ** 31));
  const on = formatsFor({ textStories: !!profile?.text_stories });
  // "make one like this" for a format the creator has left off (text stories): not without them turning it on
  if (opts.like && !on.includes(opts.like)) return { made: 0, short: "off", note: null, retry: tomorrow };
  const allowed = opts.like ? [opts.like] : on;
  const o = odds(weights, allowed);
  const formats = opts.like ? [opts.like] : chooseFormats(want, o, rand);

  // and what other channels have: the banks' questions, choices and stories, and the charts (a fight is checked as it's claimed)
  const [taken, charts, look, fresh] = await Promise.all([takenOf(bankIds()), takenCharts(), lookFor(userId), freshFor(formats, history, rand)]);
  const used = new Set([...times.keys(), ...taken, ...charts, ...(await takenWritten(fresh))]);
  const ctx: Context = { rand, used, times, fresh };

  const made: { c: Candidate; formatWhy: string[] }[] = [];
  const dry = new Set<FormatId>();
  // a few runs of a format, keeping the one whose kind has done best here, claimed before anyone else can have it
  const take = async (f: FormatId): Promise<Candidate | null> => {
    for (let tries = 0; tries < 4; tries++) {
      const runs = [0, 1, 2].map(() => FORMATS[f].propose(ctx)).filter((x): x is Candidate => !!x);
      const best = runs.sort((a, b) => kindScore(b.key, weights) - kindScore(a.key, weights) || b.score - a.score)[0];
      if (!best) return null;
      const ending: Ending = rand() < 0.5 ? "comment" : "loop";
      const c = finish(best, { look, ending });
      const spec = { format: c.format, params: c.params } as Spec;
      const claims = ledgerClaims(spec);
      const lost = await claim(userId, claims.map((x) => ({ ...x, kind: f })));
      if (!lost.length) {
        [...contentIds(spec), ...claims.map((x) => x.item)].forEach((id) => used.add(id));
        return c;
      }
      // someone else's Shorts got there first: make something else
      lost.forEach((id) => used.add(id));
    }
    return null;
  };
  const count = (f: FormatId) => made.filter((m) => m.c.format === f).length;
  const firstOf = async (order: FormatId[], capped: boolean): Promise<Candidate | null> => {
    for (const f of order) {
      if (dry.has(f) || (capped && count(f) >= 2)) continue;
      const c = await take(f);
      if (c) return c;
      dry.add(f);
    }
    return null;
  };
  for (const f of formats) {
    // a format that's run out of new things: try the others, most likely first, two of a kind at most while others have something
    const rest = allowed.filter((x) => x !== f).sort((a, b) => o[b] - o[a]);
    const c = (await firstOf([f], false)) ?? (await firstOf(rest, true)) ?? (await firstOf(rest, false));
    if (!c) break;
    // a kind that clearly stands out says so, with what its Shorts really averaged
    const s = standout(c.key, weights);
    const name = s && kindName(s.name);
    const kindWhy = s && name ? [`${name} have averaged ${timesUsual(s.score)} your usual views (${s.samples} posted)`] : [];
    made.push({ c, formatWhy: [formatReason(FORMATS[c.format].plural, weights.find((w) => w.kind === "format" && w.name === c.format)), ...kindWhy] });
  }
  const note = made.length < formats.length ? dryNote([...dry].map((f) => FORMATS[f].plural), made.length, formats.length) : null;
  // "make one like this" asks for one format: that one running out says nothing about the rest, so the queue's note and the bell are left alone
  if (!opts.like) await noteDry(userId, profile?.shorts_note_at ?? null, note, now);
  if (!made.length) return { made: 0, short: "dry", note, retry: tomorrow };

  // when to post: the channel's own best hours once it has the results, a starting guess until then, and some at other hours to learn from
  const booked = history
    .filter((h) => ["review", "approved", "rendering", "ready", "scheduled"].includes(h.status))
    .map((h) => h.scheduled_for ?? h.suggested_for)
    .filter((d): d is Date => !!d);
  // posted and still waiting for a 24-hour reading (which comes within three days, or never): an hour being tried counts these too
  const unmeasured = history
    .filter((h) => h.status === "posted" && h.measuring && h.posted_at && h.posted_at.getTime() > now.getTime() - 72 * 3600_000)
    .map((h) => h.posted_at!);
  const slots = planSlots(made.length, now, tz, results, booked, rand, EXPLORE, unmeasured);

  const copies = await Promise.all(made.map(({ c }) => writeCopy(c, FORMATS[c.format].name)));

  await asUser(userId, async (tx) => {
    for (let i = 0; i < made.length; i++) {
      const { c, formatWhy } = made[i];
      const slot = slots[i] ?? null;
      const at = slot?.at ?? null;
      const why = [...formatWhy, ...c.why, ...(slot ? [whenLine(slot, tz, plan.scheduling)] : [])];
      const copy = copies[i];
      await tx`
        insert into public.videos (user_id, format, params, key, title, description, why, status, origin, suggested_for)
        values (${userId}, ${c.format}, ${tx.json(c.params as never)}, ${c.key}, ${copy?.title ?? c.title}, ${copy?.description ?? plainDescription(c)},
          ${tx.json(why)}, 'review', ${opts.origin}, ${at})`;
    }
  });
  return { made: made.length, short: note ? "dry" : null, note, retry: tomorrow };
}

/**
 * Of what Claude wrote for a channel, what another channel already has,
 * as it is or in other words.
 */
async function takenWritten(fresh: NonNullable<Context["fresh"]>): Promise<Set<string>> {
  const said = <T extends { id: string }>(xs: T[] | undefined, text: (x: T) => string) => (xs ?? []).map((x) => ({ id: x.id, words: [...words(text(x))] }));
  const groups = [
    { kind: "quiz" as const, items: said(fresh.questions, (q) => q.q) },
    { kind: "wyr" as const, items: said(fresh.pairs, (p) => `${p.a} or ${p.b}`) },
    { kind: "texts" as const, items: said(fresh.stories, (s) => s.messages.map((m) => m.text).join(" ")) },
  ];
  const found = await Promise.all([takenOf(groups.flatMap((g) => g.items.map((x) => x.id))), ...groups.map((g) => takenInOtherWords(g.kind, g.items))]);
  return new Set(found.flatMap((x) => [...x]));
}

/**
 * Why the last Shorts couldn't all be made, kept for the queue to show,
 * with a notification the first time it happens; cleared once they can
 * be again.
 */
export async function noteDry(userId: string, since: Date | null, note: string | null, now: Date): Promise<void> {
  await admin(async (tx) => {
    if (!note) {
      if (since) await tx`update public.profiles set shorts_note = null, shorts_note_at = null where id = ${userId}`;
      return;
    }
    const at = since ?? now;
    await tx`update public.profiles set shorts_note = ${note}, shorts_note_at = ${at} where id = ${userId}`;
    // once for each time it runs dry, however often it's tried
    await notify(userId, { kind: "failed", title: "No new Shorts to make right now", body: note, href: "/app/shorts", key: `content-dry:${at.toISOString()}` }, tx);
  });
}

/** Why Hookline couldn't make all the Shorts it should have, last time it tried, if it couldn't. */
export async function shortsNoteOf(userId: string): Promise<string | null> {
  const [p] = await asUser(userId, (tx) => tx<{ shorts_note: string | null }[]>`select shorts_note from public.profiles where id = ${userId}`);
  return p?.shorts_note ?? null;
}

/** Someone's Shorts for the day, made by the worker or a scheduler, and a note that they're waiting. */
export async function makeDailyShorts(userId: string, now = new Date()): Promise<Made> {
  const r = await withUserLock(userId, () => make(userId, { origin: "daily", now }));
  const n = r.made;
  if (n > 0) {
    const [p] = await admin((tx) => tx<{ timezone: string }[]>`select timezone from public.profiles where id = ${userId}`);
    const day = localParts(now, validTimezone(p?.timezone));
    await notify(userId, {
      kind: "ready",
      title: `${n} new Short${n === 1 ? "" : "s"} to swipe`,
      body: "Swipe right on the ones you want, left for something else.",
      href: "/app/shorts",
      key: `daily:${day.y}-${day.m}-${day.d}`,
    });
  }
  return r;
}

/**
 * Everyone whose morning it is (6am or later where they are), who hasn't
 * had today's Shorts, and whose next try has come, longest waiting first:
 * the worker's daily run. Each try says when the next one is (see
 * `tryDaily`), so an account that can't get Shorts today waits instead of
 * coming back first every time. Timezones the database doesn't know
 * count as UTC, as they do everywhere else.
 */
export async function dueForShorts(now = new Date(), limit = 25): Promise<string[]> {
  const rows = await admin((tx) => tx<{ id: string }[]>`
    with p as (
      select p.id, p.created_at, p.onboarded_at, coalesce(z.name, 'UTC') as tz
      from public.profiles p
      left join pg_catalog.pg_timezone_names z on z.name = p.timezone
      where p.onboarded_at is not null and coalesce(p.goal, 'both') in ('shorts', 'both')
    ), d as (
      select p.*, (date_trunc('day', ${now}::timestamptz at time zone p.tz) at time zone p.tz) as today,
        extract(hour from ${now}::timestamptz at time zone p.tz) as hour
      from p
    )
    select d.id
    from d left join public.shorts_runs r on r.user_id = d.id
    where d.hour >= 6
      and (r.next_try_at is null or r.next_try_at < ${now}::timestamptz)
      and not exists (select 1 from public.videos v where v.user_id = d.id and v.origin = 'daily' and v.created_at >= d.today)
    order by coalesce(r.tried_at, d.onboarded_at), d.created_at, d.id
    limit ${limit}`);
  return rows.map((r) => r.id);
}

/**
 * One account's morning try, written down with when to try again:
 * tomorrow once it's had its Shorts or there's nothing new to make; when
 * Free's week frees up (or tomorrow, if sooner) when it's used up; and in
 * an hour when it went wrong.
 */
export async function tryDaily(id: string, now = new Date()): Promise<string> {
  let outcome: Outcome;
  let made = 0;
  let retry: Date;
  let line: string;
  try {
    const r = await makeDailyShorts(id, now);
    outcome = r.made > 0 ? "made" : r.short === "allowance" ? "allowance" : "nothing_new";
    ({ made, retry } = r);
    line = `${id}: ${outcome === "made" ? `${made} made` : outcome === "allowance" ? "allowance used" : "nothing new left"}`;
  } catch (e) {
    outcome = "failed";
    retry = new Date(now.getTime() + 3600_000);
    line = `${id} failed: ${e instanceof Error ? e.message : e}`;
  }
  await admin((tx) => tx`
    insert into public.shorts_runs (user_id, tried_at, outcome, made, next_try_at) values (${id}, ${now}, ${outcome}, ${made}, ${retry})
    on conflict (user_id) do update set tried_at = excluded.tried_at, outcome = excluded.outcome, made = excluded.made, next_try_at = excluded.next_try_at`);
  return line;
}

/**
 * The worker's (or a scheduler's) morning run: up to `limit` accounts'
 * Shorts, each try written down, so one that fails waits its turn and the
 * rest carry on. Given a time budget (a scheduler's request can only run
 * so long), it starts nobody new once the budget is spent, and they're
 * made on the next run.
 */
export async function runDailyShorts(now = new Date(), limit = 25, budgetMs?: number): Promise<string[]> {
  const started = Date.now();
  const log: string[] = [];
  for (const id of await dueForShorts(now, limit)) {
    if (budgetMs !== undefined && Date.now() - started > budgetMs) break;
    log.push(await tryDaily(id, now));
  }
  return log;
}
