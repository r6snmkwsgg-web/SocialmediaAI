"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { billingFor } from "@/lib/server/billing";
import { requireUser } from "@/lib/server/auth";
import { channelsOf, shortsChannelsOf } from "@/lib/server/channels";
import { configured } from "@/lib/server/env";
import { makeShorts } from "@/lib/server/shorts/generate";
import { approve, chooseTikTok, fileOf, markPosted, reject, retitle, retry, type PostedResult } from "@/lib/server/shorts/queue";
import { cleanCopy } from "@/lib/server/shorts/render";
import { getVideo } from "@/lib/server/storage";
import { TikTokError, tiktokCreator, tiktokToDrafts } from "@/lib/server/tiktok";
import { asUser } from "@/lib/server/db";
import { tiktokChoices, tiktokReason, type Creator } from "@/lib/shorts/tiktok";
import { keeping, type Keeping } from "@/lib/shorts/youtube";

const id = z.uuid();

/**
 * Right or left on a Short. Left makes a new one in its place, on the
 * same channel, while that channel's replacements for the day last (and
 * none for a channel that doesn't get Shorts any more). A right can carry
 * the creator's TikTok choices. A right says when it posts only when
 * something will post it (its own channel, or TikTok), at the time that
 * one posts it; otherwise its time is the best time for the creator to
 * post it.
 */
export async function decide(
  videoId: string, yes: boolean, tiktok?: unknown, kids?: unknown,
): Promise<{ ok: boolean; replaced?: boolean; at?: string | null; how?: Keeping; channel?: string }> {
  const me = await requireUser();
  if (!id.safeParse(videoId).success) return { ok: false };
  if (yes) {
    const choices = tiktok == null ? null : tiktokChoices.safeParse(tiktok);
    if (choices && !choices.success) return { ok: false };
    // made for kids or not, when the creator chose differently from the channel's answer for this one
    const audience = typeof kids === "boolean" ? kids : null;
    const { plan } = await billingFor(me.id);
    const ok = await approve(me.id, videoId, plan, new Date(), choices?.data ?? null, audience);
    // its times, its channel and who posts it, for the toast that says so
    const [v] = ok ? await asUser(me.id, (tx) => tx<{ scheduled_for: Date | null; tiktok_at: Date | null; tiktok: boolean; channel_id: string | null }[]>`
      select scheduled_for, tiktok_at, tiktok_post is not null as tiktok, channel_id from public.videos where id = ${videoId}`) : [];
    const channel = v?.channel_id ? (await shortsChannelsOf(me.id)).find((c) => c.id === v.channel_id) : undefined;
    // Hookline uploads only to a connected channel it may upload to
    const youtube = channel ? { api: channel.status === "connected" && channel.api, answered: channel.madeForKids !== null } : null;
    const toTikTok = !!v?.tiktok && configured().tiktokDirect;
    const how = keeping({ scheduling: plan.scheduling, youtube, tiktok: toTikTok });
    // TikTok's time when TikTok is what posts it: it can be later, two hours from the account's other TikTok posts
    const at = toTikTok && !(youtube?.api && youtube.answered) ? v?.tiktok_at : v?.scheduled_for;
    revalidatePath("/app/shorts", "layout");
    revalidatePath("/app");
    return { ok, at: at?.toISOString() ?? null, how, channel: channel?.name };
  }
  const [v] = await asUser(me.id, (tx) => tx<{ channel_id: string | null }[]>`select channel_id from public.videos where id = ${videoId}`);
  const ok = await reject(me.id, videoId);
  // on its own channel; one from before the account had a channel goes to whichever has the most room
  const replaced = ok ? (await makeShorts(me.id, { origin: "replacement", channelId: v?.channel_id ?? undefined })) > 0 : false;
  revalidatePath("/app/shorts", "layout");
  return { ok, replaced };
}

/**
 * Today's Shorts, if the plan has any left: for the empty queue's button.
 * Bound to a channel when the queue shows one; otherwise the channel with
 * the most left to make. One that isn't theirs, or doesn't get Shorts, gets none.
 */
export async function makeMore(channelId?: string | null): Promise<number> {
  const me = await requireUser();
  if (channelId != null && !id.safeParse(channelId).success) return 0;
  const n = await makeShorts(me.id, { origin: "daily", channelId: channelId ?? undefined });
  revalidatePath("/app/shorts", "layout");
  return n;
}

const copy = z.object({ title: z.string().trim().min(1).max(100), description: z.string().trim().max(4900) });

export async function editCopy(videoId: string, title: string, description: string): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser();
  const c = copy.safeParse({ title, description });
  if (!id.safeParse(videoId).success || !c.success) return { ok: false, message: "Titles need 1 to 100 characters." };
  await retitle(me.id, videoId, c.data.title, c.data.description);
  revalidatePath("/app/shorts", "layout");
  return { ok: true };
}

/** "I posted it": with a YouTube link, it's checked to be on their own channel first. */
export async function posted(videoId: string, link: string): Promise<PostedResult> {
  const me = await requireUser();
  if (!id.safeParse(videoId).success) return { ok: false, message: "That Short can't be marked as posted." };
  const r = await markPosted(me.id, videoId, link.slice(0, 300));
  if (r.ok) {
    revalidatePath("/app/shorts", "layout");
    revalidatePath("/app");
  }
  return r;
}

export async function tryAgain(form: FormData) {
  const me = await requireUser();
  const v = String(form.get("id") ?? "");
  if (!id.safeParse(v).success) return;
  await retry(me.id, v, (await billingFor(me.id)).plan);
  revalidatePath("/app/shorts", "layout");
}

/**
 * Into their TikTok drafts, to finish in the TikTok app: always the copy
 * without the free plan's tag. One made before TikTok was connected gets
 * that copy made first, and the button sends it once it's ready.
 */
export async function sendToTikTok(form: FormData) {
  const me = await requireUser();
  const v = String(form.get("id") ?? "");
  if (!id.safeParse(v).success) return;
  const file = await fileOf(me.id, v);
  const tiktok = (await channelsOf(me.id)).find((c) => c.platform === "tiktok" && c.status === "connected");
  if (!file || !tiktok) return;
  const clean = await cleanCopy(v, (await billingFor(me.id)).plan.priority);
  if (!clean) {
    revalidatePath("/app/shorts", "layout");
    return;
  }
  try {
    const publishId = await tiktokToDrafts(tiktok.id, await getVideo(clean));
    await asUser(me.id, (tx) => tx`update public.videos set tiktok_publish_id = ${publishId}, error = null where id = ${v}`);
  } catch (err) {
    // TikTok's reason in plain words; nothing sends a draft again by itself, so a full day says to try tomorrow
    const e = err instanceof TikTokError ? err : null;
    const msg = e?.code === "spam_risk_too_many_posts"
      ? "TikTok's daily limit for this account is full. Try again tomorrow."
      : e ? tiktokReason(e.code, e.message) : "TikTok didn't take it. Try again in a moment.";
    await asUser(me.id, (tx) => tx`update public.videos set error = ${msg} where id = ${v}`);
  }
  revalidatePath("/app/shorts", "layout");
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
  revalidatePath("/app/shorts", "layout");
  return { ok };
}
