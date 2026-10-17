import "server-only";
import type { Plan } from "../billing/plans";
import { channelNames, hasRoom } from "../shorts/channels";
import { postsThroughApi, YT_PRIVACY, type YouTubePrivacy } from "../shorts/youtube";
import { saveChannel, type Tokens } from "./channels-store";
import { admin, asUser, withUserLock, type Tx } from "./db";
import { youtubeApi } from "./env";
import { rememberTikTok } from "./live";
import { fitAudience, lockTimes, retimeLate } from "./shorts/queue";

/**
 * The YouTube and TikTok accounts someone has connected. Tokens live
 * elsewhere and never leave the server. Each YouTube channel gets Shorts
 * of its own. Disconnecting one keeps it, with its Shorts, look and
 * learning, so connecting it again carries on where it stopped; only its
 * keys and the figures read with them go.
 */

export type Platform = "youtube" | "tiktok";

export type Channel = {
  id: string;
  platform: Platform;
  externalId: string;
  title: string | null;
  handle: string | null;
  avatarUrl: string | null;
  /** connected; expired (Google or TikTok stopped letting Hookline in); or revoked (the creator disconnected it) */
  status: "connected" | "expired" | "revoked";
  /** YouTube: the creator's answer to "is this channel made for kids?", null until they give one */
  madeForKids: boolean | null;
  /** YouTube: who sees new Shorts */
  privacy: YouTubePrivacy;
  /** YouTube's own verdict on the channel, from when it was connected */
  youtubeKids: boolean | null;
  /** YouTube: Hookline uploads to it itself (after YouTube's audit, or a test channel before it) */
  api: boolean;
  /** YouTube: whether the creator wants new Shorts made for it */
  shortsOn: boolean;
  /** when it was first connected, or connected again after being disconnected: the first get Shorts first */
  addedAt: Date;
};

type Row = {
  id: string; platform: Platform; external_id: string; title: string | null; handle: string | null; avatar_url: string | null; status: Channel["status"];
  made_for_kids: boolean | null; privacy: string; youtube_kids: boolean | null; shorts_on: boolean; added_at: Date;
};

const columns = (tx: Tx) => tx`c.id, c.platform, c.external_id, c.title, c.handle, c.avatar_url, c.status, c.made_for_kids, c.privacy, c.youtube_kids, c.shorts_on, c.added_at`;

function channelOf(r: Row, access = youtubeApi()): Channel {
  return {
    id: r.id,
    platform: r.platform,
    externalId: r.external_id,
    title: r.title,
    handle: r.handle,
    avatarUrl: r.avatar_url,
    status: r.status,
    madeForKids: r.made_for_kids,
    privacy: (YT_PRIVACY as readonly string[]).includes(r.privacy) ? (r.privacy as YouTubePrivacy) : "public",
    youtubeKids: r.youtube_kids,
    api: r.platform === "youtube" && postsThroughApi(r.external_id, access),
    shortsOn: r.shorts_on,
    addedAt: r.added_at,
  };
}

/** Their connected accounts, first connected first. Disconnected ones are left out unless asked for. */
export async function channelsOf(userId: string, opts: { disconnected?: boolean } = {}): Promise<Channel[]> {
  const rows = await asUser(userId, (tx) => tx<Row[]>`
    select ${columns(tx)} from public.channels c
    where c.user_id = ${userId} ${opts.disconnected ? tx`` : tx`and c.status <> 'revoked'`}
    order by c.added_at, c.id`);
  const access = youtubeApi();
  return rows.map((r) => channelOf(r, access));
}

/** A YouTube channel Shorts are shown for: still theirs, or disconnected with Shorts kept for it. */
const shown = (tx: Tx, userId: string) => tx`c.user_id = ${userId} and c.platform = 'youtube'
  and (c.status <> 'revoked' or exists (select 1 from public.videos v where v.channel_id = c.id and v.user_id = c.user_id))`;

/**
 * The YouTube channels their Shorts are for, each with what to call it:
 * the ones still theirs, and disconnected ones while they have Shorts.
 * Filters and labels use these, and labels only show when there's more
 * than one.
 */
export async function shortsChannelsOf(userId: string): Promise<(Channel & { name: string })[]> {
  const rows = await asUser(userId, (tx) => tx<Row[]>`select ${columns(tx)} from public.channels c where ${shown(tx, userId)} order by c.added_at, c.id`);
  const names = channelNames(rows);
  const access = youtubeApi();
  return rows.map((r) => ({ ...channelOf(r, access), name: names.get(r.id)! }));
}

/** The same channels' names, by id, in a transaction already under way. */
export async function shownChannelNames(tx: Tx, userId: string): Promise<Map<string, string>> {
  return channelNames(await tx<{ id: string; title: string | null; handle: string | null }[]>`
    select c.id, c.title, c.handle from public.channels c where ${shown(tx, userId)} order by c.added_at, c.id`);
}

/**
 * Whether the plan has room for this account (by Google's or TikTok's id
 * for it): one they have already, connected or waiting to be reconnected,
 * always fits; a new one, or a disconnected one coming back, only while
 * fewer than the plan's room are active. Every plan has one TikTok account.
 */
export async function hasRoomFor(userId: string, platform: Platform, externalId: string, plan: Plan): Promise<boolean> {
  const rows = await asUser(userId, (tx) => tx<{ external_id: string; status: string }[]>`
    select external_id, status from public.channels where user_id = ${userId} and platform = ${platform}`);
  return hasRoom(rows.map((r) => ({ externalId: r.external_id, status: r.status })), externalId, platform === "youtube" ? plan.channels : plan.tiktokAccounts);
}

/**
 * An account's first YouTube channel taking over what it had before it had
 * one: its Shorts not on YouTube yet, its look and its morning run. Shorts
 * already on YouTube keep no channel, since which one they're on isn't
 * known. Only when this is the account's only YouTube channel that isn't
 * disconnected; returns how many Shorts it took over. Every statement runs
 * in one transaction, the one it's handed if it's handed one.
 */
export async function adoptOrphans(userId: string, channelId: string, tx?: Tx): Promise<number> {
  const run = async (tx: Tx) => {
    const active = await tx<{ id: string }[]>`select id from public.channels where user_id = ${userId} and platform = 'youtube' and status <> 'revoked'`;
    if (active.length !== 1 || active[0].id !== channelId) return 0;
    const moved = await tx`
      update public.videos set channel_id = ${channelId} where user_id = ${userId} and channel_id is null and youtube_id is null returning id`;
    await tx`
      update public.content_ledger set channel_id = ${channelId}
      where kind = 'look' and user_id = ${userId} and channel_id is null
        and not exists (select 1 from public.content_ledger x where x.kind = 'look' and x.channel_id = ${channelId})`;
    const [had] = await tx`select 1 from public.shorts_runs where user_id = ${userId} and channel_id = ${channelId}`;
    if (had) await tx`delete from public.shorts_runs where user_id = ${userId} and channel_id is null`;
    else await tx`update public.shorts_runs set channel_id = ${channelId} where user_id = ${userId} and channel_id is null`;
    return moved.length;
  };
  return tx ? run(tx) : admin(run);
}

/** What connecting did: which channel, whether it was connected already, and how many of its late Shorts got new times. */
export type Connected = { id: string; already: boolean; moved: number };

/**
 * Connecting an account Google or TikTok has just let Hookline into, under
 * the account's lock, so two at once can't both take the plan's last
 * place and Shorts being made for the account can't come out with no
 * channel just after its first channel takes them over. Null when the
 * plan has no room for it. A YouTube channel takes over what the account
 * had before it had one, and its Shorts whose time passed while it was
 * away (or before it took them over) get new times, two hours apart,
 * instead of all going up at once: all in one transaction with saving it,
 * so nothing can go up to it before they have them. Then the Shorts
 * waiting for it fit who it's for, which YouTube may have set for the
 * whole channel. A TikTok's username is what makes a LIVE the game hears
 * count as theirs.
 */
export async function connectChannel(
  userId: string, platform: Platform, info: Parameters<typeof saveChannel>[2], tokens: Tokens, plan: Plan, now = new Date(),
): Promise<Connected | null> {
  return withUserLock(userId, async () => {
    if (!(await hasRoomFor(userId, platform, info.externalId, plan))) return null;
    const [before] = await asUser(userId, (tx) => tx<{ status: Channel["status"] }[]>`
      select status from public.channels where user_id = ${userId} and platform = ${platform} and external_id = ${info.externalId}`);
    const already = before?.status === "connected";
    if (platform === "tiktok") {
      const id = await saveChannel(userId, platform, info, tokens);
      if (info.handle) await rememberTikTok(userId, id, info.handle);
      return { id, already, moved: 0 };
    }
    const away = before?.status === "expired" || before?.status === "revoked";
    const { id, moved } = await admin(async (tx) => {
      // the account's posting times first, as every booking takes them, before this holds any of its Shorts
      await lockTimes(tx, userId);
      const id = await saveChannel(userId, platform, info, tokens, tx);
      const took = await adoptOrphans(userId, id, tx);
      return { id, moved: away || took > 0 ? await retimeLate(userId, id, now, { tx, plan }) : 0 };
    });
    // YouTube may have the whole channel as made for kids: Shorts waiting for it get endings that don't ask for comments
    await fitAudience(userId, id);
    return { id, already, moved };
  });
}

/**
 * Disconnecting, softly: the channel stays, with its Shorts, look,
 * learning and schedule, but gets nothing new and nothing posts to it.
 * Its keys go, and so do its TikTok username (so it can't verify LIVEs)
 * and the figures read with its access, which the creator just took back.
 * Other data read with a channel's access is deleted by its owner's own
 * trigger on channels when the status becomes 'revoked'. For the TikTok
 * posts go to, the choices made for Shorts not sent yet go too: they were
 * made for that account, and TikTok's form has to show the account a
 * post goes to. An extra TikTok from before there was one a plan leaves
 * them alone, since posts still go to the same one. `cleared` is how many
 * Shorts' TikTok choices went. Null when it isn't theirs.
 */
export async function disconnectChannel(userId: string, channelId: string): Promise<{ platform: Platform; cleared: number } | null> {
  return admin(async (tx) => {
    // clearing TikTok choices frees their times, which are booked one at a time
    await lockTimes(tx, userId);
    const [posting] = await tx<{ id: string }[]>`
      select id from public.channels where user_id = ${userId} and platform = 'tiktok' and status = 'connected' order by added_at, id limit 1`;
    const [c] = await tx<{ platform: Platform }[]>`
      update public.channels set status = 'revoked' where id = ${channelId} and user_id = ${userId} returning platform`;
    if (!c) return null;
    await tx`delete from public.channel_tokens where channel_id = ${channelId}`;
    await tx`delete from public.tiktok_usernames where channel_id = ${channelId}`;
    await tx`delete from public.metrics where user_id = ${userId} and channel_id = ${channelId}`;
    // the one posts went to, or with none connected, the one they were made for may be this one
    const cleared = c.platform === "tiktok" && (!posting || posting.id === channelId)
      ? await tx`
          update public.videos set tiktok_post = null, tiktok_at = null, tiktok_error = null
          where user_id = ${userId} and tiktok_publish_id is null and tiktok_post is not null returning id`
      : [];
    return { platform: c.platform, cleared: cleared.length };
  });
}

/**
 * A YouTube channel's own Shorts settings: whether it gets new Shorts.
 * Only the settings given are written, through what people may change on
 * their own channels. Returns whether it was theirs.
 */
export async function setChannelSettings(userId: string, channelId: string, patch: { shortsOn?: boolean }): Promise<boolean> {
  const set: Record<string, boolean> = {};
  if (patch.shortsOn !== undefined) set.shorts_on = patch.shortsOn;
  const rows = await asUser(userId, (tx) => (Object.keys(set).length
    ? tx`update public.channels set ${tx(set)} where id = ${channelId} and user_id = ${userId} and platform = 'youtube' returning id`
    : tx`select id from public.channels where id = ${channelId} and user_id = ${userId} and platform = 'youtube'`));
  return rows.length > 0;
}

/**
 * The creator's answers for a YouTube channel: whether it's made for kids
 * (asked with nothing picked) and who sees new Shorts. The database keeps
 * a record of every answer, with who gave it and when. Its Shorts kept
 * before there was an answer take it now, and are made again if their
 * ending asks for comments it turns off. Nothing went up to it while it
 * waited for its first answer, so those whose time passed meanwhile get
 * new times then, instead of all going up at once.
 */
export async function setAudience(userId: string, channelId: string, madeForKids: boolean, privacy: YouTubePrivacy): Promise<boolean> {
  const [before] = await asUser(userId, async (tx) => {
    const was = await tx<{ made_for_kids: boolean | null }[]>`
      select made_for_kids from public.channels where id = ${channelId} and user_id = ${userId} and platform = 'youtube'`;
    if (was.length) await tx`update public.channels set made_for_kids = ${madeForKids}, privacy = ${privacy} where id = ${channelId} and user_id = ${userId}`;
    return was;
  });
  if (!before) return false;
  await fitAudience(userId, channelId);
  if (before.made_for_kids === null) await retimeLate(userId, channelId);
  return true;
}
