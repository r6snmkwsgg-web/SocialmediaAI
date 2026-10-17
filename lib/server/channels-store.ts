import "server-only";
import { open, seal } from "./crypto";
import { admin, type Tx } from "./db";
import { notify } from "./notify";
import type { Platform } from "./channels";

/**
 * Saving a connected account and its tokens. The account row is the
 * user's to read and answer questions on, but only the server writes
 * which account it is, since that's what checks lean on, and only the
 * server connects or disconnects it; the tokens go in a table nothing
 * signed in can read, encrypted.
 */

export type Tokens = { access: string; refresh: string | null; expiresAt: Date | null; scopes: string | null };

/** The account and its tokens, saved together: in the transaction it's handed, if it's handed one. */
export async function saveChannel(
  userId: string,
  platform: Platform,
  info: { externalId: string; title: string | null; handle: string | null; avatarUrl: string | null; madeForKids?: boolean | null },
  t: Tokens,
  tx?: Tx,
): Promise<string> {
  const run = async (tx: Tx) => {
    // YouTube's own verdict on the channel is kept for what it says; the creator's answer is asked separately. One coming
    // back after being disconnected goes to the end of the line for the plan's room; one that only expired keeps its place
    const [row] = await tx<{ id: string }[]>`
      insert into public.channels (user_id, platform, external_id, title, handle, avatar_url, status, connected_at, youtube_kids)
      values (${userId}, ${platform}, ${info.externalId}, ${info.title}, ${info.handle}, ${info.avatarUrl}, 'connected', now(), ${info.madeForKids ?? null})
      on conflict (user_id, platform, external_id) do update set
        title = excluded.title, handle = excluded.handle, avatar_url = excluded.avatar_url, status = 'connected', connected_at = now(),
        youtube_kids = excluded.youtube_kids,
        added_at = case when channels.status = 'revoked' then date_trunc('milliseconds', now()) else channels.added_at end
      returning id`;
    const [old] = await tx<{ refresh_token: string | null }[]>`select refresh_token from public.channel_tokens where channel_id = ${row.id}`;
    // Google only sends a refresh token the first time: keep the one we have
    const refresh = t.refresh ? seal(t.refresh) : (old?.refresh_token ?? null);
    await tx`
      insert into public.channel_tokens (channel_id, access_token, refresh_token, expires_at, scopes)
      values (${row.id}, ${seal(t.access)}, ${refresh}, ${t.expiresAt}, ${t.scopes})
      on conflict (channel_id) do update set access_token = excluded.access_token, refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at, scopes = excluded.scopes`;
    return row.id;
  };
  return tx ? run(tx) : admin(run);
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

/**
 * The account stopped letting us in (revoked at Google or TikTok, or the
 * token died): say so in Settings, and tell them. Only a connected one: a
 * refresh that fails during or after a disconnect leaves it disconnected.
 */
export async function markExpired(channelId: string): Promise<void> {
  await admin(async (tx) => {
    const [c] = await tx<{ user_id: string; platform: Platform; title: string | null; connected_at: Date }[]>`
      update public.channels set status = 'expired' where id = ${channelId} and status = 'connected' returning user_id, platform, title, connected_at`;
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
