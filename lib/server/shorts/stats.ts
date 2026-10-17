import "server-only";
import { at24h, firstDayLift, keyGroups, median, onTime, updated, usualShare, type Weight } from "../../shorts/learn";
import { shownChannelNames } from "../channels";
import { admin, type Tx } from "../db";
import { configured } from "../env";
import { notify } from "../notify";
import { youtubeAccess, youtubeViews } from "../youtube";
import { QuotaWait } from "../quota";

/**
 * The learning loop's eyes: each posted Short's plays at 1, 24 and 72
 * hours, from YouTube, for public Shorts known to be on the creator's own
 * channel (uploaded by Hookline, or a link checked with YouTube). How its
 * first day did against its channel's usual one moves the weights for its
 * format and its kind (matchup, quiz kind, story tone), which tomorrow's
 * picks are drawn from: the channel's own, and the account's across all
 * its channels. A first day is its plays at 24 hours, compared by engaged
 * views once YouTube Analytics has said how many of its plays it counted
 * as engaged, so Hookline makes more of what people watch and less of what
 * they swipe past. That comes a few days late, so each first day is
 * learned once it's in, or by plays when it isn't coming. A reading that
 * came late (the worker was down) is scaled back to 24 hours by how late
 * it really was, so it isn't counted as a win.
 */

const CHECKPOINTS = [
  { name: "1h", hours: 1 },
  { name: "24h", hours: 24 },
  { name: "72h", hours: 72 },
] as const;

/**
 * Reads what's due, then learns every first day that's ready, on every
 * run: whether or not any reading was due, and even when YouTube couldn't
 * be read, since engaged views come in on their own. A reading that can't
 * wait for them is learned the moment it's read.
 */
export async function collectStats(now = new Date()): Promise<string[]> {
  let read: string[] = [];
  let failed: unknown = null;
  try {
    read = await readPlays(now);
  } catch (e) {
    failed = e;
  }
  const learned = await learnDue(now);
  if (failed) throw failed;
  return [...read, ...learned];
}

/** Each due Short's plays at its checkpoint. Its first day isn't learned here: learnDue does that, once. */
async function readPlays(now: Date): Promise<string[]> {
  if (!configured().youtubeTrends && !configured().youtube) return [];
  // only videos known to be on the creator's own channel, and public: unlisted and private views can't be compared
  const due = await admin((tx) => tx<{ id: string; user_id: string; channel_id: string | null; youtube_id: string; checkpoint: "1h" | "24h" | "72h" }[]>`
    select v.id, v.user_id, v.channel_id, v.youtube_id, cp.name as checkpoint
    from public.videos v
    cross join (values ('1h', 1), ('24h', 24), ('72h', 72)) as cp(name, hours)
    where v.status = 'posted' and v.youtube_id is not null and v.posted_at is not null
      and v.youtube_verified and coalesce(v.youtube_privacy, 'public') = 'public'
      and v.posted_at + make_interval(hours => cp.hours) <= ${now}
      and v.posted_at + make_interval(hours => cp.hours + 48) > ${now}
      and not exists (select 1 from public.video_stats s where s.video_id = v.id and s.checkpoint = cp.name)
    limit 500`);
  if (!due.length) return [];

  // with an API key, one call per 50 videos; without, each channel reads its own, and a Short whose channel isn't
  // connected is read by another of the account's that is (anyone's access reads a public video's views). Once views
  // have used their share of the day's quota, the rest are read after the reset, like any reading that comes late
  const log: string[] = [];
  const views = new Map<string, { views: number; likes: number | null; comments: number | null }>();
  if (configured().youtubeTrends) {
    try {
      for (const [k, v] of await youtubeViews([...new Set(due.map((d) => d.youtube_id))], { now })) views.set(k, v);
    } catch (err) {
      if (!(err instanceof QuotaWait)) throw err;
      return [`views wait for YouTube quota until ${err.until.toISOString()}`];
    }
  } else {
    const connected = await admin((tx) => tx<{ id: string; user_id: string }[]>`
      select id, user_id from public.channels
      where user_id in ${tx([...new Set(due.map((d) => d.user_id))])} and platform = 'youtube' and status = 'connected' order by added_at, id`);
    const byChannel = new Map<string, Set<string>>();
    for (const d of due) {
      const reader = connected.find((c) => c.id === d.channel_id) ?? connected.find((c) => c.user_id === d.user_id);
      if (reader) byChannel.set(reader.id, (byChannel.get(reader.id) ?? new Set()).add(d.youtube_id));
    }
    for (const [channelId, ids] of byChannel) {
      try {
        for (const [k, v] of await youtubeViews([...ids], { access: await youtubeAccess(channelId), now })) views.set(k, v);
      } catch (err) {
        // every channel reads out of the same quota, so once there's none left the rest wait for the reset too
        if (err instanceof QuotaWait) {
          log.push(`views wait for YouTube quota until ${err.until.toISOString()}`);
          break;
        }
        // otherwise that channel needs reconnecting; Settings says so
      }
    }
  }

  for (const d of due) {
    const v = views.get(d.youtube_id);
    if (!v) continue;
    // written as not learned yet, since the database counts a reading as learned unless told otherwise: what code from
    // before learnDue writes during a deploy was learned the moment it was read
    await admin((tx) => tx`
      insert into public.video_stats (video_id, checkpoint, views, likes, comments, fetched_at, learned_at, learned_on)
      values (${d.id}, ${d.checkpoint}, ${v.views}, ${v.likes}, ${v.comments}, ${now}, null, null)
      on conflict do nothing`);
    log.push(`${d.id} ${d.checkpoint}: ${v.views} views`);
  }
  return log;
}

/**
 * When a first day can't wait any longer for its engaged share, for a
 * query over videos v, their channels ch and channel_analytics c: it has
 * waited 6 days, nothing reads YouTube Analytics, it has no channel to be
 * read through or its channel isn't connected, Hookline isn't allowed to
 * read the channel or lost access to it (unless it's been connected again
 * since, so it's read again soon), or the channel's last try failed and
 * nothing has been read in full for 2 days. Then it's compared by plays,
 * as it always was.
 */
export function noShareComing(tx: Tx, now: Date) {
  return tx`coalesce(
    v.posted_at < ${now}::timestamptz - interval '6 days'
    or ${!configured().youtube}::boolean
    or ch.id is null or ch.status <> 'connected'
    or (c.problem in ('scope', 'access') and not coalesce(c.tried_at < ch.connected_at, false))
    or (c.problem in ('quota', 'error') and coalesce(c.synced_at, '-infinity') < ${now}::timestamptz - interval '2 days'),
    false)`;
}

type Ready = { id: string; user_id: string; channel_id: string | null; format: string; key: string; views: number; hours: number; share: number | null };

/**
 * Learns each first day that's ready, once: as soon as YouTube Analytics
 * has given its Short an engaged share, or by plays when none is coming.
 * Each is taken before it's learned, so two runners (two workers, or the
 * worker and /api/cron/stats) never learn the same one twice. Only
 * collectStats runs this.
 */
export async function learnDue(now = new Date()): Promise<string[]> {
  const ready = await admin((tx) => tx<Ready[]>`
    select v.id, v.user_id, v.channel_id, v.format, v.key, s.views::float8 as views,
      extract(epoch from s.fetched_at - v.posted_at)::float8 / 3600 as hours, a.first_share as share
    from public.video_stats s
    join public.videos v on v.id = s.video_id
    left join public.channels ch on ch.id = v.channel_id
    left join public.channel_analytics c on c.channel_id = v.channel_id
    left join public.video_analytics a on a.video_id = v.id
    where s.checkpoint = '24h' and s.learned_at is null and v.posted_at is not null
      and v.status = 'posted' and v.youtube_verified and coalesce(v.youtube_privacy, 'public') = 'public'
      and (a.first_share is not null or ${noShareComing(tx, now)})
    order by v.posted_at limit 500`);
  const log: string[] = [];
  for (const r of ready) {
    try {
      const by = await admin(async (tx) => {
        // this run's to learn, unless another got there first
        const [mine] = await tx`
          update public.video_stats set learned_at = ${now} where video_id = ${r.id} and checkpoint = '24h' and learned_at is null returning video_id`;
        if (!mine) return undefined;
        const by = await learnIn(tx, { userId: r.user_id, videoId: r.id, format: r.format, key: r.key, views: r.views, hours: r.hours, channelId: r.channel_id, share: r.share });
        await tx`update public.video_stats set learned_on = ${by} where video_id = ${r.id} and checkpoint = '24h'`;
        return by;
      });
      if (by !== undefined) log.push(`${r.id}: ${by ? `first day learned, by ${by === "engaged" ? "engaged views" : "plays"}` : "first day set the baseline"}`);
    } catch (e) {
      // it's tried again next run, and the rest are learned meanwhile
      log.push(`${r.id}: first day not learned (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return log;
}

/** One first day: its plays, read `hours` after posting, and its engaged share once YouTube has given it. */
export type FirstDay = { userId: string; videoId: string; format: string; key: string; views: number; hours: number; channelId: string | null; share: number | null };

/**
 * One more result for a format and its kind, against its channel's usual
 * first day, so each channel is measured against its own audience (a
 * Short with no channel against the others with none): by engaged views
 * when the Short has its own share and the channel a usual one, by plays
 * otherwise (`firstDayLift`). Every reading, this one and the baseline's,
 * is scaled back to 24 hours by how late it was read. The result moves the
 * account's weights and, for a channel, its own. An account's first days
 * are learned one at a time, so two never move its weights at once. Says
 * which it went by, or null when the Short only set the baseline.
 */
export async function learnIn(tx: Tx, d: FirstDay): Promise<"engaged" | "plays" | null> {
  const { userId, videoId, format, key, views, hours, channelId, share } = d;
  await tx`select pg_advisory_xact_lock(hashtext(${`learn:${userId}`}))`;
  const before = await tx<{ views: string; hours: number | null; share: number | null }[]>`
    select s.views, extract(epoch from s.fetched_at - v.posted_at)::float8 / 3600 as hours, a.first_share as share
    from public.video_stats s join public.videos v on v.id = s.video_id
    left join public.video_analytics a on a.video_id = v.id
    where v.user_id = ${userId} and ${channelId ? tx`v.channel_id = ${channelId}` : tx`v.channel_id is null`}
      and s.checkpoint = '24h' and v.id <> ${videoId} order by s.fetched_at desc limit 30`;
  // the first few Shorts have nothing to compare with; they only set the baseline
  if (before.length < 3) return null;
  const typical = median(before.map((b) => at24h(Number(b.views), b.hours ?? 24)))!;
  const { lift: l, by } = firstDayLift(at24h(views, hours), share, typical, usualShare(before.map((b) => b.share)));
  // a clear win is worth hearing about; everything else just steers tomorrow. A reading that came
  // late is only an estimate of the first day, so it steers but doesn't claim anything.
  if (l >= 1.5 && onTime(24, hours)) {
    const [v] = await tx<{ title: string }[]>`select title from public.videos where id = ${videoId}`;
    // with more than one channel, which one's usual it beat
    const names = channelId ? await shownChannelNames(tx, userId) : new Map<string, string>();
    const where = names.size > 1 ? names.get(channelId!) : undefined;
    // a round from a LIVE only comes from the creator's own LIVEs, so Hookline can't make more like it
    const more = format === "clip" ? "" : where ? " Hookline will make more like it there." : " Hookline will make more like it.";
    await notify(userId, {
      kind: "results",
      title: `${l >= 10 ? Math.round(l) : l.toFixed(1)}× your usual first day`,
      body: `${v?.title ?? "A Short"} beat ${where ? `${where}'s usual` : "your usual"} Short in its first day, by ${by === "engaged" ? "engaged views" : "plays"}.${more}`,
      href: `/app/shorts/${videoId}`,
      key: `results:${videoId}`,
    }, tx);
  }
  const all: ["format" | "key", string][] = [["format", format], ...keyGroups(key).map((g) => ["key", g] as ["key", string])];
  for (const [kind, name] of all) {
    const [w] = await tx<Pick<Weight, "score" | "samples">[]>`select score, samples from public.weights where user_id = ${userId} and kind = ${kind} and name = ${name}`;
    const next = updated(w ?? { score: 1, samples: 0 }, l);
    await tx`
      insert into public.weights (user_id, kind, name, score, samples, updated_at) values (${userId}, ${kind}, ${name}, ${next.score}, ${next.samples}, now())
      on conflict (user_id, kind, name) do update set score = excluded.score, samples = excluded.samples, updated_at = now()`;
    if (!channelId) continue;
    const [c] = await tx<Pick<Weight, "score" | "samples">[]>`select score, samples from public.channel_weights where channel_id = ${channelId} and kind = ${kind} and name = ${name}`;
    const mine = updated(c ?? { score: 1, samples: 0 }, l);
    await tx`
      insert into public.channel_weights (channel_id, user_id, kind, name, score, samples, updated_at)
      values (${channelId}, ${userId}, ${kind}, ${name}, ${mine.score}, ${mine.samples}, now())
      on conflict (channel_id, kind, name) do update set score = excluded.score, samples = excluded.samples, updated_at = now()`;
  }
  return by;
}

/**
 * One first day learned now, in a transaction of its own: what learnDue
 * does once one is ready, by engaged views when `share` is given and the
 * channel has a usual one. `hours` is how long after posting the plays
 * were read.
 */
export async function learn(userId: string, videoId: string, format: string, key: string, views: number, hours = 24, channelId: string | null = null, share: number | null = null) {
  return admin((tx) => learnIn(tx, { userId, videoId, format, key, views, hours, channelId, share }));
}

export { CHECKPOINTS };
