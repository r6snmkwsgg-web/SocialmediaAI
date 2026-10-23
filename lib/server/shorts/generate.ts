import "server-only";
import { rng } from "../../battle/sim";
import { postsPerDay, PLANS, type Plan } from "../../billing/plans";
import { roomLeft, unitsOf, type ChannelRow } from "../../shorts/channels";
import { words } from "../../shorts/checks";
import { bankIds, contentIds, finish, FORMATS, formatName, formatPlural, ledgerClaims } from "../../shorts/formats";
import { bankQuestions } from "../../shorts/formats/quiz";
import { STORIES } from "../../shorts/formats/texts";
import { bankPairs } from "../../shorts/formats/wyr";
import { kindName, times as timesUsual } from "../../shorts/insights";
import { chooseFormats, dryNote, formatCap, formatReason, formatsFor, kindScore, odds, standout, trendLean, trendReason, withTrends } from "../../shorts/learn";
import { nicheById, writerNote, type ChannelNiche, type NicheId } from "../../shorts/niches";
import { atLocal, EXPLORE, localParts, planSlots, validTimezone, whenLine } from "../../shorts/times";
import type { Candidate, Context, Ending, FormatId, ShortFormat, Spec } from "../../shorts/types";
import { billingFor } from "../billing";
import { stopWaiting, takeClip, type TakenClip } from "../clips";
import { admin, asUser, withUserLock, type Tx } from "../db";
import { configured } from "../env";
import { nichesOf } from "../niches";
import { notify } from "../notify";
import { formatGrowth } from "../trends";
import { hourResults } from "./hours";
import { claude, freshPairs, freshQuestions, freshStories } from "./fresh";
import { nextMatches, playMatches, saveMatches, stopIfLeft, waitingFor } from "./league";
import { claim, lookFor, takenCharts, takenInOtherWords, takenOf } from "./ledger";
import { plainDescription, writeCopy } from "./titles";
import { weightsFor } from "./weights";

/**
 * Making a channel's Shorts: as many as the plan allows today, in the
 * formats that have done best for it (with room to keep trying the
 * rest), each with a title and a time to post. Nothing it has had comes
 * round again, and nothing another channel has had goes to it: every
 * item is claimed in the content ledger as it's made. Each is drawn in
 * the channel's own look and ends one of a few ways. Runs every morning
 * from the worker, and when someone opens an empty queue. When there's
 * nothing new left to make, it says so instead of making nothing quietly.
 * The morning run remembers when it last tried each channel, how that
 * went and when to try next, so channels that can't get Shorts today wait
 * their turn instead of holding up everyone else.
 *
 * Every YouTube channel that gets Shorts is made for on its own (a unit),
 * with its own share of the plan, history, look, times and learning; an
 * account with no channel is one unit by itself, as it always was.
 *
 * A channel about one niche only gets Shorts about it: its niche's
 * formats, what Claude writes for it and the chart figure it shows. A
 * channel in the Ball League gets its season's next matches instead, in
 * order, while a day's worth aren't still waiting for a swipe.
 *
 * A round from the creator's own LIVE can be one of a morning's Shorts,
 * at most one a day, for the account's first channel that hasn't picked a
 * niche, in its place among the plan's: the day's Shorts are one fewer
 * made ones, never one more.
 */

/** replacements for swiped-away Shorts, a day */
export const REPLACEMENTS_PER_DAY = 10;

type Profile = { timezone: string; goal: string | null; text_stories: boolean; shorts_note_at: Date | null };

type Past = { format: ShortFormat; params: Spec["params"]; status: string; suggested_for: Date | null; scheduled_for: Date | null; posted_at: Date | null; measuring: boolean };

/** Who a run of Shorts is for: one of the account's YouTube channels, or the account itself (null) while it has none. */
export type Unit = { userId: string; channelId: string | null };

/** `frees` is when more can next be made once it's used up: the oldest of the week's turning a week old, or tomorrow. */
export type Allowance = { per: "week" | "day"; limit: number; made: number; left: number; replacementsLeft: number; frees: Date };

/**
 * What an account can still have made: the whole account against the
 * plan's total (`units` is how many get Shorts), each unit's own share by
 * its channel (null for the account's own), and the units in the order
 * they come, first connected first.
 */
export type Allowances = { account: Allowance & { units: number }; units: Map<string | null, Allowance>; order: (string | null)[] };

/**
 * How a morning try at making Shorts went, as `shorts_runs` keeps it: some
 * made, the plan's allowance used up, nothing new left, an error, or a Ball
 * League channel's matches still waiting for a swipe.
 */
export type Outcome = "made" | "allowance" | "nothing_new" | "failed" | "waiting";
/**
 * How many it made, and when fewer than it should have, why: the plan's
 * allowance, nothing new left (`note` says it in words), Claude writing
 * nothing for a niche only it writes (`writer`, said in `note` too), or,
 * asked for one format, that format is off or none of the account's
 * channels is about something with it (`niche`); `stopped` when no
 * channel of the account's gets Shorts; and `waiting` when a Ball League
 * channel's last matches are still waiting for a swipe. `retry` is when
 * the morning run should try this unit again; `channels` is how many
 * units the account has.
 */
export type Made = { made: number; short: null | "allowance" | "dry" | "off" | "stopped" | "niche" | "writer" | "waiting"; note: string | null; retry: Date; channels: number };

/** Midnight today, or `days` from today, wherever they are. */
function startOfLocalDay(now: Date, tz: string, days = 0): Date {
  const p = localParts(now, tz);
  return atLocal(p.y, p.m, p.d + days, 0, tz);
}

/**
 * Each unit's allowance: the plan's Shorts for each channel that gets
 * them, counted over that channel's own Shorts, and never past the plan's
 * total for the account, counted over all of them (so Shorts made today
 * for a channel since disconnected or switched off still count). Free
 * counts the last 7 days; the paid plans count today where they are.
 * Replacements for swiped-away Shorts are 10 a day for each unit.
 */
export async function allowancesOf(userId: string, plan: Plan, tz: string, now = new Date()): Promise<Allowances> {
  const since = plan.shorts.per === "week" ? new Date(now.getTime() - 7 * 86400_000) : startOfLocalDay(now, tz);
  const today = startOfLocalDay(now, tz);
  const { counts, channels } = await asUser(userId, async (tx) => ({
    counts: await tx<{ channel_id: string | null; made: number; oldest: Date | null; replaced: number }[]>`
      select channel_id,
        count(*) filter (where origin = 'daily' and created_at >= ${since})::int as made,
        min(created_at) filter (where origin = 'daily' and created_at >= ${since}) as oldest,
        count(*) filter (where origin = 'replacement' and created_at >= ${today})::int as replaced
      from public.videos where created_at >= ${since < today ? since : today}
      group by channel_id`,
    channels: await tx<{ id: string; platform: ChannelRow["platform"]; status: ChannelRow["status"]; shorts_on: boolean; added_at: Date }[]>`
      select id, platform, status, shorts_on, added_at from public.channels where platform = 'youtube'`,
  }));
  const order = unitsOf(channels.map((c) => ({ id: c.id, platform: c.platform, status: c.status, shortsOn: c.shorts_on, addedAt: c.added_at })), plan.channels);
  const each = plan.shorts.count;
  const accountMade = counts.reduce((a, c) => a + c.made, 0);
  const oldest = counts.map((c) => c.oldest).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
  const frees = plan.shorts.per === "week" && oldest ? new Date(oldest.getTime() + 7 * 86400_000) : startOfLocalDay(now, tz, 1);
  const units = new Map(order.map((id): [string | null, Allowance] => {
    const c = counts.find((x) => x.channel_id === id);
    const made = c?.made ?? 0;
    const left = roomLeft({ each, units: order.length, made, accountMade });
    return [id, { per: plan.shorts.per, limit: each, made, left, replacementsLeft: Math.max(0, REPLACEMENTS_PER_DAY - (c?.replaced ?? 0)), frees }];
  }));
  const limit = each * Math.max(1, order.length);
  const all = [...units.values()];
  const left = Math.min(all.reduce((a, u) => a + u.left, 0), Math.max(0, limit - accountMade));
  const replacementsLeft = all.reduce((a, u) => a + u.replacementsLeft, 0);
  return { account: { per: plan.shorts.per, limit, made: accountMade, left, replacementsLeft, frees, units: order.length }, units, order };
}

/**
 * The unit with the most room left for a day's Shorts, or for a
 * swiped-away one's replacement, ties going to the first in order: who a
 * Short is made for when nobody says. Only units `accept` takes count.
 * Null when there are none.
 */
export function pickUnit(a: Allowances, accept: (channelId: string | null) => boolean = () => true, origin: MakeOpts["origin"] = "daily"): { channelId: string | null } | null {
  const room = (id: string | null) => (origin === "daily" ? a.units.get(id)!.left : a.units.get(id)!.replacementsLeft);
  const best = a.order.filter(accept).reduce<string | null | undefined>((b, id) => (b === undefined || room(id) > room(b) ? id : b), undefined);
  return best === undefined ? null : { channelId: best };
}

/**
 * What a unit has had this past year: its channel's Shorts, or for an
 * account without one, its Shorts with no channel. None of it comes round
 * again, and new times keep clear of it. A round from a LIVE comes without
 * its record, which none of this needs and can be 128 KB.
 */
export async function pastOf(tx: Tx, unit: Unit): Promise<Past[]> {
  return tx<Past[]>`
    select format, case when format = 'clip' then params - 'log' else params end as params, status, suggested_for, scheduled_for, posted_at,
      (youtube_id is not null and not exists (select 1 from public.video_stats s where s.video_id = videos.id and s.checkpoint = '24h')) as measuring
    from public.videos where user_id = ${unit.userId} and created_at > now() - interval '365 days'
      and ${unit.channelId ? tx`channel_id = ${unit.channelId}` : tx`channel_id is null`}`;
}

/** The channel a unit's Shorts are for, as the database has it: what it's about, and since when its note has said why its Shorts fell short. */
export type UnitChannel = { id: string; title: string | null; status: ChannelRow["status"]; shortsOn: boolean; niche: NicheId | null; noteAt: Date | null };

/** A unit's channel, read once wherever its Shorts are made: null for the account's own, or when it isn't one of theirs. */
export async function unitChannel(tx: Tx, unit: Unit): Promise<UnitChannel | null> {
  if (!unit.channelId) return null;
  const [c] = await tx<{ id: string; title: string | null; status: ChannelRow["status"]; shorts_on: boolean; niche: string | null; shorts_note_at: Date | null }[]>`
    select id, title, status, shorts_on, niche, shorts_note_at from public.channels where id = ${unit.channelId} and user_id = ${unit.userId} and platform = 'youtube'`;
  return c ? { id: c.id, title: c.title, status: c.status, shortsOn: c.shorts_on, niche: nicheById(c.niche)?.id ?? null, noteAt: c.shorts_note_at } : null;
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

/** `channelId` is the unit they're for; left out, the one with the most room. */
type MakeOpts = { origin: "daily" | "replacement"; count?: number; now?: Date; like?: FormatId; channelId?: string | null };

/** How long Claude gets to write a channel's new material; after that the banks fill in, so the morning's Shorts never wait long. */
export const FRESH_MS = 60_000;

/** Material written for this channel by Claude, for the formats it's making today, about its niche if it has one. Nothing when Claude isn't set up. */
async function freshFor(formats: FormatId[], history: Past[], rand: () => number, niche: ChannelNiche | null): Promise<NonNullable<Context["fresh"]>> {
  const ask = claude(Date.now() + FRESH_MS);
  if (!ask) return {};
  const n = (f: FormatId) => formats.filter((x) => x === f).length;
  const asked = (f: FormatId) => history.filter((h) => h.format === f).map((h) => h.params);
  // everything the banks ask (capitals too), and everything this channel has had
  const knownQuestions = [...bankQuestions(), ...asked("quiz").flatMap((p) => ("questions" in p ? (p.questions ?? []).map((q) => q.q) : []))];
  const knownPairs = [...bankPairs(), ...asked("wyr").flatMap((p) => ("pairs" in p ? (p.pairs ?? []).map((x) => `${x.a} or ${x.b}`) : []))];
  const knownStories = [...STORIES, ...asked("texts").flatMap((p) => ("story" in p && p.story ? [p.story] : []))].map((s) => s.messages.map((m) => m.text).join(" "));
  const [questions, pairs, stories] = await Promise.all([
    n("quiz") ? freshQuestions(ask, knownQuestions, rand, Math.min(20, 7 * n("quiz") + 5), niche) : [],
    n("wyr") ? freshPairs(ask, knownPairs, rand, Math.min(20, 6 * n("wyr") + 4), niche) : [],
    n("texts") ? freshStories(ask, knownStories, n("texts") + 1) : [],
  ]);
  return { questions, pairs, stories };
}

/** The LIVE round a morning took stopped waiting before its day was saved: it waited three days, or rounds were turned off meanwhile. */
class RoundGone extends Error {}

async function make(userId: string, opts: MakeOpts): Promise<Made> {
  try {
    return await makeDay(userId, opts, true);
  } catch (err) {
    // nothing of the day was saved, so it's made again without a round: all made Shorts, as many as ever
    if (err instanceof RoundGone) return makeDay(userId, opts, false);
    throw err;
  }
}

/** A unit's Shorts for now, and with `rounds`, maybe one of them a waiting round from the creator's LIVE. */
async function makeDay(userId: string, opts: MakeOpts, rounds: boolean): Promise<Made> {
  const now = opts.now ?? new Date();
  const { profile, niches } = await asUser(userId, async (tx) => ({
    profile: (await tx<Profile[]>`select timezone, goal, text_stories, shorts_note_at from public.profiles where id = ${userId}`)[0],
    // what each unit is about
    niches: await nichesOf(tx, userId),
  }));
  const tz = validTimezone(profile?.timezone);
  const { plan } = await billingFor(userId);
  const allow = await allowancesOf(userId, plan, tz, now);
  const tomorrow = startOfLocalDay(now, tz, 1);
  const channels = allow.order.length;
  // every channel switched off: nothing until one is switched on
  if (!channels) return { made: 0, short: "stopped", note: null, retry: tomorrow, channels };
  // "make one like this" goes to a unit whose niche makes that format, or that hasn't picked one
  const makes = (id: string | null) => !opts.like || (niches.get(id)?.formats.includes(opts.like) ?? true);
  const picked = opts.channelId !== undefined ? { channelId: opts.channelId } : pickUnit(allow, makes, opts.origin);
  // none of the account's channels is about something with that format
  if (!picked) return { made: 0, short: "niche", note: null, retry: tomorrow, channels };
  const unit: Unit = { userId, channelId: picked.channelId };
  const room = allow.units.get(unit.channelId);
  // a channel that doesn't get Shorts (disconnected, switched off, or past what the plan has room for) gets none
  if (!room) return { made: 0, short: "allowance", note: null, retry: tomorrow, channels };
  const want = opts.origin === "daily" ? Math.min(room.left, opts.count ?? room.left) : Math.min(room.replacementsLeft, opts.count ?? 1);
  // used up: tried again when some come free, or tomorrow if that's sooner (a new plan might have started)
  if (want <= 0) return { made: 0, short: "allowance", note: null, retry: new Date(Math.min(room.frees.getTime(), tomorrow.getTime())), channels };

  // what this channel has had, what it's learned and when its Shorts did best: each channel's own
  const { channel, history, weights, results, growth } = await asUser(userId, async (tx) => {
    const channel = await unitChannel(tx, unit);
    return {
      channel,
      history: await pastOf(tx, unit),
      weights: await weightsFor(tx, unit.channelId),
      results: await hourResults(tx, tz, unit.channelId),
      growth: await formatGrowth(tx),
    };
  });
  if (unit.channelId && !channel) return { made: 0, short: "allowance", note: null, retry: tomorrow, channels };
  // what it's about: its channel's niche, or the account's own while it has no channel; and since when its note has said why
  const niche = unit.channelId ? nicheById(channel?.niche) : (niches.get(null) ?? null);
  const noteSince = unit.channelId ? (channel?.noteAt ?? null) : (profile?.shorts_note_at ?? null);

  // what the channel has had, posted or swiped away, and how often: none of it comes round again
  const times = new Map<string, number>();
  for (const h of history) for (const id of contentIds({ format: h.format, params: h.params } as Spec)) times.set(id, (times.get(id) ?? 0) + 1);
  const rand = rng(Math.floor(Math.random() * 2 ** 31));
  const on = formatsFor({ textStories: !!profile?.text_stories, niche });
  // "make one like this" for a format the channel doesn't make: one outside its niche, or text stories the creator has left off
  if (opts.like && !on.includes(opts.like)) return { made: 0, short: niche ? "niche" : "off", note: null, retry: tomorrow, channels };
  // the Ball League's schedule decides what comes next; a channel that's left it stops the season it had on, however it was changed
  if (niche?.id === "league") return makeLeague(unit, { origin: opts.origin, want, plan, tz, now, tomorrow, channels, history, results, rand, noteSince });
  await stopIfLeft(unit);
  const allowed = opts.like ? [opts.like] : on;
  // the channel's own results first, then a lean toward what's rising on YouTube Shorts right now
  const lean = trendLean(growth, allowed);
  const o = withTrends(odds(weights, allowed), lean);
  // a round from their LIVE first, on a day's own run (never a replacement or "make one like this") for the account's first
  // channel that hasn't picked a niche, since a niche's Shorts are only about it: with one in hand, one fewer is made. Anything
  // going wrong here only means no round today
  const clipUnit = allow.order.find((id) => !niches.get(id));
  const round = rounds && opts.origin === "daily" && !opts.like && unit.channelId === clipUnit ? await roundFor(userId, now, tz, plan, rand) : null;
  // two of a format a day, and more only when the niche has too few formats to fill the day
  const n = want - (round ? 1 : 0);
  const cap = formatCap(n, allowed.length);
  const formats = opts.like ? [opts.like] : chooseFormats(n, o, rand, cap);

  // and what other channels have: the banks' questions, choices and stories, and the charts (a fight is checked as it's claimed)
  const [taken, charts, look, fresh] = await Promise.all([takenOf(bankIds()), takenCharts(), lookFor(userId, unit.channelId), freshFor(formats, history, rand, niche)]);
  const refused = await takenWritten(fresh);
  // what Claude wrote that another channel already has: the more channels share a niche, the more of it there is
  const wrote = (fresh.questions?.length ?? 0) + (fresh.pairs?.length ?? 0) + (fresh.stories?.length ?? 0);
  if (refused.size) console.log(`fresh: ${refused.size} of the ${wrote} written for ${unit.channelId ?? userId}${niche ? ` (${niche.id})` : ""} other channels already have`);
  const used = new Set([...times.keys(), ...taken, ...charts, ...refused]);
  const ctx: Context = { rand, used, times, fresh, niche: niche?.id };
  // the round in the channel's look, ending the way a made one does
  const clip = round && { c: finish(round.c, { look, ending: rand() < 0.5 ? "comment" : "loop" }), formatWhy: [], round };

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
      // someone else's Shorts got there first: make something else, knowing all they've taken meanwhile, since being
      // made at the same moment they'd mostly pick the same things
      lost.forEach((id) => used.add(id));
      for (const id of [...(await takenOf(bankIds())), ...(await takenCharts())]) used.add(id);
    }
    return null;
  };
  const count = (f: FormatId) => made.filter((m) => m.c.format === f).length;
  const firstOf = async (order: FormatId[], capped: boolean): Promise<Candidate | null> => {
    for (const f of order) {
      if (dry.has(f) || (capped && count(f) >= cap)) continue;
      const c = await take(f);
      if (c) return c;
      dry.add(f);
    }
    return null;
  };
  for (const f of formats) {
    // a format that's run out of new things: try the others, most likely first, no more of a kind than a day's share while others have something
    const rest = allowed.filter((x) => x !== f).sort((a, b) => o[b] - o[a]);
    const c = (await firstOf([f], false)) ?? (await firstOf(rest, true)) ?? (await firstOf(rest, false));
    if (!c) break;
    // a kind that clearly stands out says so, with what its Shorts really averaged
    const s = standout(c.key, weights);
    const name = s && kindName(s.name);
    const kindWhy = s && name ? [`${name} have averaged ${timesUsual(s.score)} your usual first day (${s.samples} posted)`] : [];
    const rising = opts.like ? null : trendReason(formatPlural(c), (lean as Partial<Record<string, number>>)[c.format]);
    made.push({ c, formatWhy: [formatReason(formatPlural(c), weights.find((w) => w.kind === "format" && w.name === c.format)), ...(rising ? [rising] : []), ...kindWhy] });
  }
  // the day's Shorts: the LIVE round first, so it goes out soonest after its LIVE, then the made ones
  const day: { c: Candidate; formatWhy: string[]; round?: TakenClip }[] = [...(clip ? [clip] : []), ...made];
  const wanted = formats.length + (clip ? 1 : 0);
  // a niche only Claude writes for, short of a kind Claude wrote nothing of: it didn't answer (or isn't set up), which isn't running dry
  const unwritten = niche?.claude === "needs" && made.length < formats.length ? allowed.filter((f) => dry.has(f) && !wroteFor(fresh, f)) : [];
  const note = unwritten.length
    ? writerNote(unwritten.map((f) => FORMATS[f].plural), { setUp: configured().claude, made: day.length, wanted })
    : made.length < formats.length ? dryNote([...dry].map((f) => FORMATS[f].plural), day.length, wanted) : null;
  // "make one like this" asks for one format: that one running out says nothing about the rest, so the queue's note and the bell are left alone
  if (!opts.like) await noteDry(unit, noteSince, note, now);
  if (!day.length) {
    // with nothing written, the morning run tries again in an hour; with Claude not set up at all, the next morning, as nothing can come sooner
    if (unwritten.length) return { made: 0, short: "writer", note, retry: configured().claude ? new Date(now.getTime() + 3600_000) : tomorrow, channels };
    return { made: 0, short: "dry", note, retry: tomorrow, channels };
  }

  // when to post: the channel's own best hours once it has the results, a starting guess until then, and some at other hours to learn from,
  // two hours apart from the rest of this channel's (another channel's times are its own)
  const slots = planSlots(day.length, now, tz, results, bookedOf(history), rand, EXPLORE, unmeasuredOf(history, now), postsPerDay(plan));

  const copies = await Promise.all(day.map(({ c }) => writeCopy(c, formatName(c))));

  // the whole day at once, as the server, since only the server makes a Short from a LIVE round: all of it, or if anything goes
  // wrong none of it, so the morning run tries this channel again in an hour. A round that stopped waiting meanwhile saves
  // nothing either, and the day is made again without it
  await admin(async (tx) => {
    for (const [i, { c, formatWhy, round }] of day.entries()) {
      if (round && !(await stopWaiting(tx, userId, round))) throw new RoundGone("the LIVE round stopped waiting");
      const slot = slots[i] ?? null;
      const at = slot?.at ?? null;
      const why = [...formatWhy, ...c.why, ...(slot ? [whenLine(slot, tz, plan.scheduling)] : [])];
      const copy = copies[i];
      await tx`
        insert into public.videos (user_id, channel_id, format, params, key, title, description, why, status, origin, suggested_for)
        values (${userId}, ${channel?.id ?? null}, ${c.format}, ${tx.json(c.params as never)}, ${c.key}, ${copy?.title ?? c.title}, ${copy?.description ?? plainDescription(c, niche)},
          ${tx.json(why)}, 'review', ${opts.origin}, ${at})`;
    }
  });
  return { made: day.length, short: unwritten.length ? "writer" : note ? "dry" : null, note, retry: tomorrow, channels };
}

/** The posting times a unit's kept Shorts and the ones waiting for a swipe already have: new ones keep two hours from these. */
function bookedOf(history: Past[]): Date[] {
  return history
    .filter((h) => ["review", "approved", "rendering", "ready", "scheduled"].includes(h.status))
    .map((h) => h.scheduled_for ?? h.suggested_for)
    .filter((d): d is Date => !!d);
}

/** Posted and still waiting for a 24-hour reading (which comes within three days, or never): an hour being tried counts these too. */
function unmeasuredOf(history: Past[], now: Date): Date[] {
  return history
    .filter((h) => h.status === "posted" && h.measuring && h.posted_at && h.posted_at.getTime() > now.getTime() - 72 * 3600_000)
    .map((h) => h.posted_at!);
}

/** The latest time a unit's Ball League Shorts waiting for a swipe, or kept and still to post, have: 0 when none has one. */
function lastMatchAt(history: Past[]): number {
  return history
    .filter((h) => h.format === "battle" && "league" in h.params && ["review", "approved", "rendering", "ready", "scheduled"].includes(h.status))
    .reduce((t, h) => Math.max(t, (h.scheduled_for ?? h.suggested_for)?.getTime() ?? 0), 0);
}

/** What a Ball League channel's make goes by, from the unit's own make. */
type LeagueMake = {
  origin: MakeOpts["origin"]; want: number; plan: Plan; tz: string; now: Date; tomorrow: Date; channels: number;
  history: Past[]; results: Awaited<ReturnType<typeof hourResults>>; rand: () => number; noteSince: Date | null;
};

/**
 * A Ball League channel's Shorts: its season's next matches, in order,
 * each one real fight (or a knockout's games) from the seeds its season
 * began with, saved as it's played so it counts whether or not it's
 * posted, and given times in match order, after the league's earlier
 * ones still waiting or to post (a replacement's too, and a new season's
 * after the final). Only as many are played as fill a day's worth (the
 * plan's posts a day) waiting for a swipe, so a season never runs on
 * without the creator, and a swiped-away one always makes room for the
 * next match. A final saved, the next season begins with the same eight
 * balls, the same morning if there's room. A league never runs dry, so
 * any note on why Shorts fell short is cleared.
 */
async function makeLeague(unit: Unit, o: LeagueMake): Promise<Made> {
  const room = postsPerDay(o.plan) - (await waitingFor(unit));
  if (room <= 0) return { made: 0, short: "waiting", note: null, retry: o.tomorrow, channels: o.channels };
  const want = Math.min(o.want, room);
  await noteDry(unit, o.noteSince, null, o.now);
  const look = await lookFor(unit.userId, unit.channelId);
  const booked = bookedOf(o.history);
  let last = lastMatchAt(o.history);
  let made = 0;
  while (made < want) {
    const next = await nextMatches(unit, want - made);
    const played = await playMatches(unit, next);
    if (!played.length) break;
    // a league Short never loops: its opening would make a seam
    const day = played.map((p) => ({ ...p, c: finish(p.c, { look, ending: "comment" }) }));
    // the earliest time to the first match, and every one after the league's matches already waiting or to post
    const from = new Date(Math.max(o.now.getTime(), last));
    const slots = planSlots(day.length, from, o.tz, o.results, booked, o.rand, EXPLORE, unmeasuredOf(o.history, o.now), postsPerDay(o.plan));
    const copies = await Promise.all(day.map(({ c }) => writeCopy(c, formatName(c))));
    await saveMatches(unit, next.season.id, day.map((p, i) => {
      const slot = slots[i] ?? null;
      return {
        ...p,
        title: copies[i]?.title ?? p.c.title,
        description: copies[i]?.description ?? plainDescription(p.c),
        why: [...p.c.why, ...(slot ? [whenLine(slot, o.tz, o.plan.scheduling)] : [])],
        origin: o.origin,
        suggestedFor: slot?.at ?? null,
      };
    }));
    for (const s of slots) {
      if (!s) continue;
      booked.push(s.at);
      last = Math.max(last, s.at.getTime());
    }
    made += day.length;
  }
  return { made, short: null, note: null, retry: o.tomorrow, channels: o.channels };
}

/** Whether Claude wrote anything for a format it writes for: what a niche only Claude writes for has to go on. */
function wroteFor(fresh: NonNullable<Context["fresh"]>, f: FormatId): boolean {
  if (f === "quiz") return !!fresh.questions?.length;
  if (f === "wyr") return !!fresh.pairs?.length;
  if (f === "texts") return !!fresh.stories?.length;
  return true;
}

/**
 * A waiting round from the creator's own LIVE for today's Shorts, or null
 * when there's none to take. A try that goes wrong goes in the log, and
 * the day is all made Shorts, as many as ever.
 */
async function roundFor(userId: string, now: Date, tz: string, plan: Plan, rand: () => number): Promise<TakenClip | null> {
  try {
    return await takeClip(userId, { now, today: startOfLocalDay(now, tz), tz, per: plan.shorts, rand });
  } catch (err) {
    console.error("shorts: couldn't take a LIVE round:", err instanceof Error ? err.message : err);
    return null;
  }
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
 * Why a unit's last Shorts couldn't all be made, kept for the queue to
 * show, with a notification the first time it happens; cleared once they
 * can be again. Each channel keeps its own, since what one channel is
 * about can run dry while another's never does; an account with no
 * channel keeps it on its profile.
 */
export async function noteDry(unit: Unit, since: Date | null, note: string | null, now: Date): Promise<void> {
  const { userId, channelId } = unit;
  const keep = (tx: Tx, text: string | null, at: Date | null) =>
    channelId
      ? tx`update public.channels set shorts_note = ${text}, shorts_note_at = ${at} where id = ${channelId} and user_id = ${userId}`
      : tx`update public.profiles set shorts_note = ${text}, shorts_note_at = ${at} where id = ${userId}`;
  await admin(async (tx) => {
    if (!note) {
      if (since) await keep(tx, null, null);
      return;
    }
    const at = since ?? now;
    await keep(tx, note, at);
    // once for each time it runs dry, however often it's tried, and for each channel on its own
    await notify(userId, {
      kind: "failed",
      title: "No new Shorts to make right now",
      body: note,
      href: channelId ? `/app/shorts?channel=${channelId}` : "/app/shorts",
      key: channelId ? `content-dry:${channelId}:${at.toISOString()}` : `content-dry:${at.toISOString()}`,
    }, tx);
  });
}

/** Why Hookline couldn't make all the Shorts it should have for a unit, last time it tried, if it couldn't: its own note, like `noteDry` keeps. */
export async function shortsNoteOf(unit: Unit): Promise<string | null> {
  const { userId, channelId } = unit;
  const [r] = await asUser(userId, (tx) => (channelId
    ? tx<{ shorts_note: string | null }[]>`select shorts_note from public.channels where id = ${channelId} and user_id = ${userId}`
    : tx<{ shorts_note: string | null }[]>`select shorts_note from public.profiles where id = ${userId}`));
  return r?.shorts_note ?? null;
}

/**
 * A unit's Shorts for the day, made by the worker or a scheduler, and a
 * note that they're waiting: once a day for the account, after its first
 * channel's, so with several channels it doesn't say how many or that all
 * of them are in.
 */
export async function makeDailyShorts(unit: Unit, now = new Date()): Promise<Made> {
  const r = await withUserLock(unit.userId, () => make(unit.userId, { origin: "daily", now, channelId: unit.channelId }));
  const n = r.made;
  if (n > 0) {
    const [p] = await admin((tx) => tx<{ timezone: string }[]>`select timezone from public.profiles where id = ${unit.userId}`);
    const day = localParts(now, validTimezone(p?.timezone));
    const several = r.channels > 1;
    await notify(unit.userId, {
      kind: "ready",
      title: several ? "New Shorts to swipe" : `${n} new Short${n === 1 ? "" : "s"} to swipe`,
      body: `${several ? "Each of your channels gets its own today. " : ""}Swipe right on the ones you want, left for something else.`,
      href: "/app/shorts",
      key: `daily:${day.y}-${day.m}-${day.d}`,
    });
  }
  return r;
}

/**
 * Every channel whose morning it is (6am or later where its owner is),
 * that hasn't had today's Shorts and whose next try has come, longest
 * waiting first: the worker's daily run. The channels are the ones that
 * get Shorts, in the same order the app counts them (`unitsOf`), and an
 * account with no channel that isn't disconnected is one unit itself.
 * Each try says when the next one is (see `tryDaily`), so one that can't
 * get Shorts today waits instead of coming back first every time.
 * Timezones the database doesn't know count as UTC, as they do everywhere else.
 */
export async function dueForShorts(now = new Date(), limit = 25): Promise<Unit[]> {
  const room = Object.values(PLANS).map((p) => ({ plan: p.id, channels: p.channels }));
  const rows = await admin((tx) => tx<{ user_id: string; channel_id: string | null }[]>`
    with p as (
      select p.id, p.created_at, p.onboarded_at, coalesce(z.name, 'UTC') as tz, coalesce(s.plan, 'free') as plan
      from public.profiles p
      left join pg_catalog.pg_timezone_names z on z.name = p.timezone
      left join public.subscriptions s on s.user_id = p.id
      where p.onboarded_at is not null and coalesce(p.goal, 'both') in ('shorts', 'both')
    ), room as (
      select * from jsonb_to_recordset(${tx.json(room)}::jsonb) as r (plan text, channels int)
    ), yt as (
      select user_id, id, added_at, shorts_on from public.channels where platform = 'youtube' and status <> 'revoked'
    ), getting as (
      select user_id, id, added_at, row_number() over (partition by user_id order by added_at, id) as n from yt where shorts_on
    ), units as (
      select p.*, g.id as channel_id, g.added_at as since
      from p join room r on r.plan = p.plan join getting g on g.user_id = p.id and g.n <= r.channels
      union all
      select p.*, null::uuid, null::timestamptz from p where not exists (select 1 from yt where yt.user_id = p.id)
    ), d as (
      select u.*, (date_trunc('day', ${now}::timestamptz at time zone u.tz) at time zone u.tz) as today,
        extract(hour from ${now}::timestamptz at time zone u.tz) as hour
      from units u
    )
    select d.id as user_id, d.channel_id
    from d left join public.shorts_runs r on r.user_id = d.id and r.channel_id is not distinct from d.channel_id
    where d.hour >= 6
      and (r.next_try_at is null or r.next_try_at < ${now}::timestamptz)
      and not exists (select 1 from public.videos v where v.user_id = d.id and v.channel_id is not distinct from d.channel_id
        and v.origin = 'daily' and v.created_at >= d.today)
    order by coalesce(r.tried_at, d.since, d.onboarded_at), d.created_at, d.id, d.channel_id nulls first
    limit ${limit}`);
  return rows.map((r) => ({ userId: r.user_id, channelId: r.channel_id }));
}

/**
 * One unit's morning try, written down with when to try again: tomorrow
 * once it's had its Shorts, there's nothing new to make, or a Ball League
 * channel's matches are still waiting for a swipe; when Free's week frees
 * up (or tomorrow, if sooner) when it's used up; and in an hour when it
 * went wrong, or Claude wrote nothing for a niche only it writes for.
 * While Claude isn't set up at all, such a niche has nothing new to make,
 * and is tried the next morning.
 */
export async function tryDaily(unit: Unit, now = new Date()): Promise<string> {
  const who = unit.channelId ? `${unit.userId} ${unit.channelId}` : unit.userId;
  let outcome: Outcome;
  let made = 0;
  let retry: Date;
  let line: string;
  try {
    const r = await makeDailyShorts(unit, now);
    // Claude writing nothing is a try that failed, unless it isn't set up, when nothing new can be made until it is
    const silent = r.short === "writer" && configured().claude;
    // no channel getting Shorts any more is, for this one, an allowance used up until tomorrow
    outcome = r.made > 0 ? "made" : r.short === "allowance" || r.short === "stopped" ? "allowance" : silent ? "failed" : r.short === "waiting" ? "waiting" : "nothing_new";
    ({ made, retry } = r);
    const writer = silent ? "Claude wrote nothing" : "Claude isn't set up";
    line = `${who}: ${outcome === "made" ? `${made} made` : r.short === "stopped" ? "Shorts off" : r.short === "writer" ? writer : r.short === "waiting" ? "matches waiting for a swipe" : outcome === "allowance" ? "allowance used" : "nothing new left"}`;
  } catch (e) {
    outcome = "failed";
    retry = new Date(now.getTime() + 3600_000);
    line = `${who} failed: ${e instanceof Error ? e.message : e}`;
  }
  await admin((tx) => tx`
    insert into public.shorts_runs (user_id, channel_id, tried_at, outcome, made, next_try_at)
    values (${unit.userId}, ${unit.channelId}, ${now}, ${outcome}, ${made}, ${retry})
    on conflict (user_id, channel_id) do update set tried_at = excluded.tried_at, outcome = excluded.outcome, made = excluded.made, next_try_at = excluded.next_try_at`);
  return line;
}

/**
 * The worker's (or a scheduler's) morning run: up to `limit` channels'
 * Shorts, each try written down, so one that fails waits its turn and the
 * rest carry on. A Creator account's channels are made one after another,
 * each in turn under the account's lock. Given a time budget (a
 * scheduler's request can only run so long), it starts nobody new once the
 * budget is spent, and they're made on the next run.
 */
export async function runDailyShorts(now = new Date(), limit = 25, budgetMs?: number): Promise<string[]> {
  const started = Date.now();
  const log: string[] = [];
  for (const unit of await dueForShorts(now, limit)) {
    if (budgetMs !== undefined && Date.now() - started > budgetMs) break;
    log.push(await tryDaily(unit, now));
  }
  return log;
}
