import "server-only";
import { open, seal } from "./crypto";
import { admin, asUser } from "./db";
import { notify } from "./notify";
import type { Platform } from "./channels";

/**
 * Saving a connected account and its tokens. The account row is the
 * user's own (row-level security); the tokens go in a table nothing
 * signed in can read, encrypted.
 */

export type Tokens = { access: string; refresh: string | null; expiresAt: Date | null; scopes: string | null };

export async function saveChannel(
  userId: string,
  platform: Platform,
  info: { externalId: string; title: string | null; handle: string | null; avatarUrl: string | null },
  t: Tokens,
): Promise<string> {
  const [row] = await asUser(userId, (tx) => tx<{ id: string }[]>`
    insert into public.channels (user_id, platform, external_id, title, handle, avatar_url, status, connected_at)
    values (${userId}, ${platform}, ${info.externalId}, ${info.title}, ${info.handle}, ${info.avatarUrl}, 'connected', now())
    on conflict (user_id, platform, external_id) do update set
      title = excluded.title, handle = excluded.handle, avatar_url = excluded.avatar_url, status = 'connected', connected_at = now()
    returning id`);
  await admin(async (tx) => {
    const [old] = await tx<{ refresh_token: string | null }[]>`select refresh_token from public.channel_tokens where channel_id = ${row.id}`;
    // Google only sends a refresh token the first time: keep the one we have
    const refresh = t.refresh ? seal(t.refresh) : (old?.refresh_token ?? null);
    await tx`
      insert into public.channel_tokens (channel_id, access_token, refresh_token, expires_at, scopes)
      values (${row.id}, ${seal(t.access)}, ${refresh}, ${t.expiresAt}, ${t.scopes})
      on conflict (channel_id) do update set access_token = excluded.access_token, refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at, scopes = excluded.scopes`;
  });
  return row.id;
}

export async function tokensOf(channelId: string): Promise<Tokens | null> {
  const [r] = await admin((tx) => tx<{ access_token: string; refresh_token: string | null; expires_at: Date | null; scopes: string | null }[]>`
    select access_token, refresh_token, expires_at, scopes from public.channel_tokens where channel_id = ${channelId}`);
  if (!r) return null;
  return { access: open(r.access_token), refresh: r.refresh_token ? open(r.refresh_token) : null, expiresAt: r.expires_at, scopes: r.scopes };
}

export async function updateTokens(channelId: string, t: Pick<Tokens, "access" | "expiresAt"> & { refresh?: string | null }): Promise<void> {
  await admin((tx) => tx`
    update public.channel_tokens set access_token = ${seal(t.access)}, expires_at = ${t.expiresAt},
      refresh_token = coalesce(${t.refresh ? seal(t.refresh) : null}, refresh_token)
    where channel_id = ${channelId}`);
}

/** The account stopped letting us in (revoked, or the token died): say so in Settings, and tell them. */
export async function markExpired(channelId: string): Promise<void> {
  await admin(async (tx) => {
    const [c] = await tx<{ user_id: string; platform: Platform; title: string | null; connected_at: Date }[]>`
      update public.channels set status = 'expired' where id = ${channelId} returning user_id, platform, title, connected_at`;
    if (!c) return;
    const name = c.platform === "youtube" ? "YouTube" : "TikTok";
    await notify(c.user_id, {
      kind: "account",
      title: `Reconnect ${name}`,
      body: `Hookline lost access to ${c.title ?? `your ${name}`}. Connect it again in Settings so your Shorts keep posting.`,
      href: "/app/settings",
      key: `expired:${channelId}:${c.connected_at.getTime()}`,
    }, tx);
  });
}
