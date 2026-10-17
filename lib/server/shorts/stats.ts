import "server-only";
import { at24h, keyGroups, lift, median, onTime, updated, type Weight } from "../../shorts/learn";
import { shownChannelNames } from "../channels";
import { admin } from "../db";
import { configured } from "../env";
import { notify } from "../notify";
import { youtubeAccess, youtubeViews } from "../youtube";

/**
 * The learning loop's eyes: each posted Short's views at 1, 24 and 72
 * hours, from YouTube, for public Shorts known to be on the creator's own
 * channel (uploaded by Hookline, or a link checked with YouTube). At 24
 * hours, how it did against its channel's typical Short moves the weights
 * for its format and its kind (matchup, quiz kind, story tone), which
 * tomorrow's picks are drawn from: the channel's own, and the account's
 * across all its channels. A reading that came late (the worker was down)
 * is scaled back to 24 hours by how late it really was, so it isn't
 * counted as a win.
 */

const CHECKPOINTS = [
  { name: "1h", hours: 1 },
  { name: "24h", hours: 24 },
  { name: "72h", hours: 72 },
] as const;

export async function collectStats(now = new Date()): Promise<string[]> {
  if (!configured().youtubeTrends && !configured().youtube) return [];
  // only videos known to be on the creator's own channel, and public: unlisted and private views can't be compared
  const due = await admin((tx) => tx<{ id: string; user_id: string; channel_id: string | null; youtube_id: string; format: string; key: string; posted_at: Date; checkpoint: "1h" | "24h" | "72h" }[]>`
    select v.id, v.user_id, v.channel_id, v.youtube_id, v.format, v.key, v.posted_at, cp.name as checkpoint
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
  // connected is read by another of the account's that is (anyone's access reads a public video's views)
  const views = new Map<string, { views: number; likes: number | null; comments: number | null }>();
  if (configured().youtubeTrends) {
    for (const [k, v] of await youtubeViews([...new Set(due.map((d) => d.youtube_id))])) views.set(k, v);
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
        for (const [k, v] of await youtubeViews([...ids], await youtubeAccess(channelId))) views.set(k, v);
      } catch {
        // that channel needs reconnecting; Settings says so
      }
    }
  }

  const log: string[] = [];
  for (const d of due) {
    const v = views.get(d.youtube_id);
    if (!v) continue;
    await admin((tx) => tx`
      insert into public.video_stats (video_id, checkpoint, views, likes, comments, fetched_at) values (${d.id}, ${d.checkpoint}, ${v.views}, ${v.likes}, ${v.comments}, ${now})
      on conflict do nothing`);
    log.push(`${d.id} ${d.checkpoint}: ${v.views} views`);
    if (d.checkpoint === "24h") await learn(d.user_id, d.id, d.format, d.key, v.views, (now.getTime() - d.posted_at.getTime()) / 3600_000, d.channel_id);
  }
  return log;
}

/**
 * One more result for a format and its kind, against its channel's
 * typical Short at 24 hours, so each channel is measured against its own
 * audience (a Short with no channel against the others with none).
 * `hours` is how long after posting the views were read; every reading,
 * this one and the baseline's, is scaled back to 24 hours by that. The
 * result moves the account's weights and, for a channel, its own.
 */
export async function learn(userId: string, videoId: string, format: string, key: string, views: number, hours = 24, channelId: string | null = null) {
  await admin(async (tx) => {
    const before = await tx<{ views: string; hours: number | null }[]>`
      select s.views, extract(epoch from s.fetched_at - v.posted_at)::float8 / 3600 as hours
      from public.video_stats s join public.videos v on v.id = s.video_id
      where v.user_id = ${userId} and ${channelId ? tx`v.channel_id = ${channelId}` : tx`v.channel_id is null`}
        and s.checkpoint = '24h' and v.id <> ${videoId} order by s.fetched_at desc limit 30`;
    // the first few Shorts have nothing to compare with; they only set the baseline
    if (before.length < 3) return;
    const l = lift(at24h(views, hours), median(before.map((b) => at24h(Number(b.views), b.hours ?? 24)))!);
    // a clear win is worth hearing about; everything else just steers tomorrow. A reading that came
    // late is only an estimate of the first day, so it steers but doesn't claim anything.
    if (l >= 1.5 && onTime(24, hours)) {
      const [v] = await tx<{ title: string }[]>`select title from public.videos where id = ${videoId}`;
      // with more than one channel, which one's usual it beat
      const names = channelId ? await shownChannelNames(tx, userId) : new Map<string, string>();
      const where = names.size > 1 ? names.get(channelId!) : undefined;
      await notify(userId, {
        kind: "results",
        title: `${l >= 10 ? Math.round(l) : l.toFixed(1)}× your usual views`,
        body: where
          ? `${v?.title ?? "A Short"} beat ${where}'s usual Short in its first day. Hookline will make more like it there.`
          : `${v?.title ?? "A Short"} beat your typical Short in its first day. Hookline will make more like it.`,
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
  });
}

export { CHECKPOINTS };
