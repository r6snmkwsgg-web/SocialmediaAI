import "server-only";
import { asUser } from "./db";

/** The YouTube and TikTok accounts someone has connected. Tokens live elsewhere and never leave the server. */

export type Platform = "youtube" | "tiktok";

export type Channel = {
  id: string;
  platform: Platform;
  title: string | null;
  handle: string | null;
  avatarUrl: string | null;
  status: "connected" | "expired" | "revoked";
};

export async function channelsOf(userId: string): Promise<Channel[]> {
  const rows = await asUser(userId, (tx) => tx<{ id: string; platform: Platform; title: string | null; handle: string | null; avatar_url: string | null; status: Channel["status"] }[]>`
    select id, platform, title, handle, avatar_url, status from public.channels where user_id = ${userId} order by connected_at`);
  return rows.map((r) => ({ id: r.id, platform: r.platform, title: r.title, handle: r.handle, avatarUrl: r.avatar_url, status: r.status }));
}
