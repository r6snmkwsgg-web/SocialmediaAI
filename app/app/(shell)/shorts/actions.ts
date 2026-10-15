"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { billingFor } from "@/lib/server/billing";
import { requireUser } from "@/lib/server/auth";
import { channelsOf } from "@/lib/server/channels";
import { makeShorts } from "@/lib/server/shorts/generate";
import { approve, chooseTikTok, fileOf, markPosted, reject, retitle, retry } from "@/lib/server/shorts/queue";
import { getVideo } from "@/lib/server/storage";
import { TikTokError, tiktokCreator, tiktokToDrafts } from "@/lib/server/tiktok";
import { asUser } from "@/lib/server/db";
import { youtubeIdFrom } from "@/lib/server/youtube";
import { tiktokChoices, tiktokReason, type Creator } from "@/lib/shorts/tiktok";

const id = z.uuid();

/**
 * Right or left on a Short. Left makes a new one in its place, while the
 * day's replacements last. A right can carry the creator's TikTok choices.
 */
export async function decide(videoId: string, yes: boolean, tiktok?: unknown): Promise<{ ok: boolean; replaced?: boolean; at?: string | null }> {
  const me = await requireUser();
  if (!id.safeParse(videoId).success) return { ok: false };
  if (yes) {
    const choices = tiktok == null ? null : tiktokChoices.safeParse(tiktok);
    if (choices && !choices.success) return { ok: false };
    const ok = await approve(me.id, videoId, (await billingFor(me.id)).plan, new Date(), choices?.data ?? null);
    // when it'll post, for the toast that says so
    const [v] = ok ? await asUser(me.id, (tx) => tx<{ scheduled_for: Date | null }[]>`select scheduled_for from public.videos where id = ${videoId}`) : [];
    revalidatePath("/app/shorts");
    revalidatePath("/app");
    return { ok, at: v?.scheduled_for?.toISOString() ?? null };
  }
  const ok = await reject(me.id, videoId);
  const replaced = ok ? (await makeShorts(me.id, { origin: "replacement" })) > 0 : false;
  revalidatePath("/app/shorts");
  return { ok, replaced };
}

/** Today's Shorts, if the plan has any left: for the empty queue's button. */
export async function makeMore(): Promise<number> {
  const me = await requireUser();
  const n = await makeShorts(me.id, { origin: "daily" });
  revalidatePath("/app/shorts");
  return n;
}

const copy = z.object({ title: z.string().trim().min(1).max(100), description: z.string().trim().max(4900) });

export async function editCopy(videoId: string, title: string, description: string): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser();
  const c = copy.safeParse({ title, description });
  if (!id.safeParse(videoId).success || !c.success) return { ok: false, message: "Titles need 1 to 100 characters." };
  await retitle(me.id, videoId, c.data.title, c.data.description);
  revalidatePath("/app/shorts");
  return { ok: true };
}

export async function posted(form: FormData) {
  const me = await requireUser();
  const v = String(form.get("id") ?? "");
  if (!id.safeParse(v).success) return;
  const link = String(form.get("link") ?? "").trim();
  await markPosted(me.id, v, link ? youtubeIdFrom(link) : null);
  revalidatePath("/app/shorts");
  revalidatePath("/app");
}

export async function tryAgain(form: FormData) {
  const me = await requireUser();
  const v = String(form.get("id") ?? "");
  if (!id.safeParse(v).success) return;
  await retry(me.id, v, (await billingFor(me.id)).plan);
  revalidatePath("/app/shorts");
}

/** Into their TikTok drafts, to finish in the TikTok app. */
export async function sendToTikTok(form: FormData) {
  const me = await requireUser();
  const v = String(form.get("id") ?? "");
  if (!id.safeParse(v).success) return;
  const file = await fileOf(me.id, v);
  const tiktok = (await channelsOf(me.id)).find((c) => c.platform === "tiktok" && c.status === "connected");
  if (!file || !tiktok) return;
  try {
    const publishId = await tiktokToDrafts(tiktok.id, await getVideo(file.key));
    await asUser(me.id, (tx) => tx`update public.videos set tiktok_publish_id = ${publishId}, error = null where id = ${v}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TikTok didn't take it";
    await asUser(me.id, (tx) => tx`update public.videos set error = ${msg} where id = ${v}`);
  }
  revalidatePath("/app/shorts");
}

/** Who they are on TikTok right now and what they can post: asked each time TikTok's questions open. */
export async function tiktokAccount(): Promise<{ ok: true; creator: Creator } | { ok: false; message: string }> {
  const me = await requireUser();
  const tiktok = (await channelsOf(me.id)).find((c) => c.platform === "tiktok" && c.status === "connected");
  if (!tiktok) return { ok: false, message: "Connect TikTok in Settings first." };
  try {
    return { ok: true, creator: await tiktokCreator(tiktok.id) };
  } catch (err) {
    const e = err instanceof TikTokError ? err : null;
    return { ok: false, message: e ? tiktokReason(e.code, e.message) : "TikTok didn't answer. Try again in a moment." };
  }
}

/** TikTok choices for a Short that's already on its way. */
export async function postToTikTok(videoId: string, choices: unknown): Promise<{ ok: boolean }> {
  const me = await requireUser();
  const c = tiktokChoices.safeParse(choices);
  if (!id.safeParse(videoId).success || !c.success) return { ok: false };
  const ok = await chooseTikTok(me.id, videoId, c.data);
  revalidatePath("/app/shorts");
  return { ok };
}
