import "server-only";
import { admin, asUser, type Tx } from "./db";

/**
 * Notifications: told when something real happens to someone's Shorts,
 * LIVEs, accounts or plan, and only then. Each one has a key naming the
 * event, so the same thing never notifies twice however often the job
 * that noticed it runs. Only the server writes them; people read their
 * own and mark them read.
 */

export const NOTE_KINDS = ["posted", "failed", "ready", "results", "live", "plan", "account"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export type Note = { kind: NoteKind; title: string; body?: string | null; href?: string | null; key: string };

export type Notification = { id: string; kind: NoteKind; title: string; body: string | null; href: string | null; createdAt: Date; read: boolean };

/** Tell someone. Inside a transaction that's already open, pass it, so the note lands with the change it's about. */
export async function notify(userId: string, n: Note, tx?: Tx): Promise<void> {
  const run = (t: Tx) => t`
    insert into public.notifications (user_id, kind, title, body, href, key)
    values (${userId}, ${n.kind}, ${n.title.slice(0, 200)}, ${n.body?.slice(0, 500) ?? null}, ${n.href ?? null}, ${n.key})
    on conflict (user_id, key) do nothing`;
  if (tx) await run(tx);
  else await admin(run);
}

type Row = { id: string; kind: NoteKind; title: string; body: string | null; href: string | null; created_at: Date; read_at: Date | null };
const toNote = (r: Row): Notification => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, createdAt: r.created_at, read: r.read_at !== null });

/** The newest first, and how many haven't been seen. */
export async function notificationsOf(userId: string, opts: { limit?: number; before?: Date } = {}): Promise<{ items: Notification[]; unread: number; more: boolean }> {
  const limit = opts.limit ?? 30;
  return asUser(userId, async (tx) => {
    const rows = await tx<Row[]>`
      select id, kind, title, body, href, created_at, read_at from public.notifications
      where user_id = ${userId} ${opts.before ? tx`and created_at < ${opts.before}` : tx``}
      order by created_at desc limit ${limit + 1}`;
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.notifications where user_id = ${userId} and read_at is null`;
    return { items: rows.slice(0, limit).map(toNote), unread: n, more: rows.length > limit };
  });
}

export async function markAllRead(userId: string): Promise<void> {
  await asUser(userId, (tx) => tx`update public.notifications set read_at = now() where user_id = ${userId} and read_at is null`);
}
