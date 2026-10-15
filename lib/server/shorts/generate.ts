import "server-only";
import { rng } from "../../battle/sim";
import type { Plan } from "../../billing/plans";
import { contentIds, FORMATS } from "../../shorts/formats";
import { chooseFormats, formatReason, kindScore, lift, median, odds, type Weight } from "../../shorts/learn";
import { atLocal, bestHours, localParts, nextSlots, STARTING_HOURS, validTimezone } from "../../shorts/times";
import { FORMAT_IDS, type Candidate, type FormatId, type Spec } from "../../shorts/types";
import { billingFor } from "../billing";
import { admin, asUser, withUserLock } from "../db";
import { plainDescription, writeCopy } from "./titles";

/**
 * Making a channel's Shorts: as many as the plan allows today, in the
 * formats that have done best for it (with room to keep trying the
 * rest), nothing it has posted before, each with a title and a time to
 * post. Runs every morning from the worker, and when someone opens an
 * empty queue.
 */

/** replacements for swiped-away Shorts, a day */
export const REPLACEMENTS_PER_DAY = 10;

type Profile = { timezone: string; goal: string | null };

export type Allowance = { per: "week" | "day"; limit: number; made: number; left: number; replacementsLeft: number };

/** Midnight today, wherever they are. */
function startOfLocalDay(now: Date, tz: string): Date {
  const p = localParts(now, tz);
  return atLocal(p.y, p.m, p.d, 0, tz);
}

export async function allowanceOf(userId: string, plan: Plan, tz: string, now = new Date()): Promise<Allowance> {
  const since = plan.shorts.per === "week" ? new Date(now.getTime() - 7 * 86400_000) : startOfLocalDay(now, tz);
  const today = startOfLocalDay(now, tz);
  const [r] = await asUser(userId, (tx) => tx<{ made: number; replaced: number; channels: number }[]>`
    select
      (select count(*) from public.videos where origin = 'daily' and created_at >= ${since})::int as made,
      (select count(*) from public.videos where origin = 'replacement' and created_at >= ${today})::int as replaced,
      (select count(*) from public.channels where platform = 'youtube' and status = 'connected')::int as channels`);
  const limit = plan.shorts.count * (plan.channels > 1 ? Math.max(1, Math.min(plan.channels, r.channels)) : 1);
  return { per: plan.shorts.per, limit, made: r.made, left: Math.max(0, limit - r.made), replacementsLeft: Math.max(0, REPLACEMENTS_PER_DAY - r.replaced) };
}

const hourWord = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h}am` : `${h - 12}pm`);

/**
 * Makes up to `count` Shorts and puts them in the queue. Returns how many
 * it made, which can be fewer if the plan's allowance is used up.
 */
export async function makeShorts(userId: string, opts: { origin: "daily" | "replacement"; count?: number; now?: Date; like?: FormatId }): Promise<number> {
  return withUserLock(userId, () => make(userId, opts));
}

async function make(userId: string, opts: { origin: "daily" | "replacement"; count?: number; now?: Date; like?: FormatId }): Promise<number> {
  const now = opts.now ?? new Date();
  const [profile] = await asUser(userId, (tx) => tx<Profile[]>`select timezone, goal from public.profiles where id = ${userId}`);
  const tz = validTimezone(profile?.timezone);
  const { plan } = await billingFor(userId);
  const allow = await allowanceOf(userId, plan, tz, now);
  const want = opts.origin === "daily" ? Math.min(allow.left, opts.count ?? allow.left) : Math.min(allow.replacementsLeft, opts.count ?? 1);
  if (want <= 0) return 0;

  const { history, weights, results } = await asUser(userId, async (tx) => {
    const history = await tx<{ format: FormatId; params: Spec["params"]; status: string; suggested_for: Date | null; scheduled_for: Date | null }[]>`
      select format, params, status, suggested_for, scheduled_for from public.videos where created_at > now() - interval '365 days'`;
    const weights = await tx<Weight[]>`select kind, name, score, samples from public.weights`;
    const results = await tx<{ views: number; posted_at: Date }[]>`
      select s.views::float8 as views, v.posted_at from public.video_stats s join public.videos v on v.id = s.video_id
      where s.checkpoint = '24h' and v.posted_at is not null order by v.posted_at desc limit 60`;
    return { history, weights, results };
  });

  // nothing the channel has had, posted or swiped away, comes round again
  const used = new Set(history.flatMap((h) => contentIds({ format: h.format, params: h.params } as Spec)));
  const rand = rng(Math.floor(Math.random() * 2 ** 31));
  const o = odds(weights);
  const formats = opts.like ? [opts.like] : chooseFormats(want, o, rand);

  const made: { c: Candidate; formatWhy: string[] }[] = [];
  const tried = new Set<FormatId>();
  // a few runs of each format, keeping the one whose kind has done best here
  const propose = (f: FormatId): Candidate | null => {
    const runs = [0, 1, 2].map(() => FORMATS[f].propose({ rand, used })).filter((x): x is Candidate => !!x);
    return runs.sort((a, b) => kindScore(b.key, weights) - kindScore(a.key, weights) || b.score - a.score)[0] ?? null;
  };
  for (const f of formats) {
    let c = propose(f);
    // a format that's run out of new things: try the others, most likely first
    for (const alt of [...FORMAT_IDS].sort((a, b) => o[b] - o[a])) {
      if (c) break;
      if (tried.has(alt)) continue;
      tried.add(alt);
      c = propose(alt);
    }
    if (!c) continue;
    contentIds(c).forEach((id) => used.add(id));
    const k = kindScore(c.key, weights);
    const kindWhy = k >= 1.15 ? [`This kind does well for you: ${k.toFixed(1)}× your usual views`] : [];
    made.push({ c, formatWhy: [formatReason(FORMATS[c.format].plural, weights.find((w) => w.kind === "format" && w.name === c!.format)), ...kindWhy] });
  }
  if (!made.length) return 0;

  // when to post: the channel's own best hours once it has the results, a starting guess until then
  const typical = median(results.map((r) => r.views)) ?? 0;
  const learned = bestHours(results.map((r) => ({ hour: localParts(r.posted_at, tz).hour, lift: lift(r.views, typical) })));
  const hours = learned ?? STARTING_HOURS;
  const taken = history
    .filter((h) => ["review", "approved", "rendering", "ready", "scheduled"].includes(h.status))
    .map((h) => h.scheduled_for ?? h.suggested_for)
    .filter((d): d is Date => !!d);
  const slots = nextSlots(made.length, now, tz, hours, taken);

  const copies = await Promise.all(made.map(({ c }) => writeCopy(c, FORMATS[c.format].name)));

  await asUser(userId, async (tx) => {
    for (let i = 0; i < made.length; i++) {
      const { c, formatWhy } = made[i];
      const at = slots[i] ?? null;
      const verb = plan.scheduling ? "Posts at" : "Best posted around";
      const when = at
        ? learned
          ? `${verb} ${hourWord(localParts(at, tz).hour)}: one of the hours your Shorts do best`
          : `${verb} ${hourWord(localParts(at, tz).hour)}, a starting guess until your own numbers come in`
        : null;
      const why = [...formatWhy, ...c.why, ...(when ? [when] : [])];
      const copy = copies[i];
      await tx`
        insert into public.videos (user_id, format, params, key, title, description, why, status, origin, suggested_for)
        values (${userId}, ${c.format}, ${tx.json(c.params as never)}, ${c.key}, ${copy?.title ?? c.title}, ${copy?.description ?? plainDescription(c)},
          ${tx.json(why)}, 'review', ${opts.origin}, ${at})`;
    }
  });
  return made.length;
}

/** Everyone whose morning it is and who hasn't had today's Shorts yet: the worker's daily run. */
export async function dueForShorts(now = new Date(), limit = 25): Promise<string[]> {
  const rows = await admin((tx) => tx<{ id: string; timezone: string; last: Date | null }[]>`
    select p.id, p.timezone, (select max(created_at) from public.videos v where v.user_id = p.id and v.origin = 'daily') as last
    from public.profiles p
    where p.onboarded_at is not null and coalesce(p.goal, 'both') in ('shorts', 'both')
    order by p.created_at
    limit 2000`);
  const due: string[] = [];
  for (const r of rows) {
    const tz = validTimezone(r.timezone);
    if (localParts(now, tz).hour < 6) continue;
    if (r.last && r.last >= startOfLocalDay(now, tz)) continue;
    due.push(r.id);
    if (due.length >= limit) break;
  }
  return due;
}
