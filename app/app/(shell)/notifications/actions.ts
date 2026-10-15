"use server";
import { requireUser } from "@/lib/server/auth";
import { markAllRead } from "@/lib/server/notify";

/** Everything so far counts as seen. */
export async function seenAll(): Promise<void> {
  const me = await requireUser();
  await markAllRead(me.id);
}
