import "server-only";
import { postsThroughApi, YT_PRIVACY, type YouTubePrivacy } from "../shorts/youtube";
import { asUser } from "./db";
import { youtubeApi } from "./env";
import { fitAudience } from "./shorts/queue";

/** The YouTube and TikTok accounts someone has connected. Tokens live elsewhere and never leave the server. */

export type Platform = "youtube" | "tiktok";

export type Channel = {
  id: string;
  platform: Platform;
  externalId: string;
  title: string | null;
  handle: string | null;
  avatarUrl: string | null;
  status: "connected" | "expired" | "revoked";
  /** YouTube: the creator's answer to "is this channel made for kids?", null until they give one */
  madeForKids: boolean | null;
  /** YouTube: who sees new Shorts */
  privacy: YouTubePrivacy;
  /** YouTube's own verdict on the channel, from when it was connected */
  youtubeKids: boolean | null;
  /** YouTube: Hookline uploads to it itself (after YouTube's audit, or a test channel before it) */
  api: boolean;
};

type Row = {
  id: string; platform: Platform; external_id: string; title: string | null; handle: string | null; avatar_url: string | null; status: Channel["status"];
  made_for_kids: boolean | null; privacy: string; youtube_kids: boolean | null;
};

export async function channelsOf(userId: string): Promise<Channel[]> {
  const rows = await asUser(userId, (tx) => tx<Row[]>`
    select id, platform, external_id, title, handle, avatar_url, status, made_for_kids, privacy, youtube_kids
    from public.channels where user_id = ${userId} order by connected_at`);
  const access = youtubeApi();
  return rows.map((r) => ({
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
  }));
}

/** The YouTube channel Shorts post to: the first one connected, as posting picks it. */
export function postingChannel(channels: Channel[]): Channel | null {
  return channels.find((c) => c.platform === "youtube" && c.status === "connected") ?? null;
}

/**
 * The creator's answers for a YouTube channel: whether it's made for kids
 * (asked with nothing picked) and who sees new Shorts. The database keeps
 * a record of every answer, with who gave it and when. Shorts kept before
 * there was an answer take it now, and are made again if their ending
 * asks for comments it turns off.
 */
export async function setAudience(userId: string, channelId: string, madeForKids: boolean, privacy: YouTubePrivacy): Promise<boolean> {
  const rows = await asUser(userId, (tx) => tx`
    update public.channels set made_for_kids = ${madeForKids}, privacy = ${privacy}
    where id = ${channelId} and user_id = ${userId} and platform = 'youtube' returning id`);
  if (rows.length) await fitAudience(userId);
  return rows.length > 0;
}
