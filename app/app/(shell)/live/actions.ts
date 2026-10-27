"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { LiveCheck, YtLiveCheck } from "@/lib/live/eligibility";
import { validGifts } from "@/lib/live/menu";
import { ownRivalryProblem, sidesProblem, validSideGifts } from "@/lib/live/rivals";
import { liveSettingsSchema } from "@/lib/live/settings";
import { requireUser } from "@/lib/server/auth";
import { forgetClips } from "@/lib/server/clips";
import { asUser } from "@/lib/server/db";
import { rotateOverlayKey, saveLiveSettings, setHideNames } from "@/lib/server/live";
import { chooseLiveChannel } from "@/lib/server/ytlive";

export type SaveState = { ok: boolean; message: string; at: number } | null;
/** after a tap on the names switch: whether it saved, and which way */
export type NamesState = { ok: boolean; hide: boolean; at: number } | null;

export async function saveLive(_: SaveState, form: FormData): Promise<SaveState> {
  const me = await requireUser();
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("settings") ?? ""));
  } catch {
    return { ok: false, message: "That didn't save. Reload the page and try again.", at: Date.now() };
  }
  const p = liveSettingsSchema.safeParse(raw);
  if (!p.success) {
    const where = p.error.issues[0]?.path[0];
    const why: Record<string, string> = {
      teams: "Team names need 1 to 12 letters.",
      abilities: "Keep at least two champions on.",
      gifts: "Every gift needs a name and a price in coins.",
      roundSeconds: "Rounds run between 30 seconds and 5 minutes.",
      rivals: "Each side of a rivalry needs a name of up to 12 letters, and each side's gifts a name and a price in coins.",
    };
    return { ok: false, message: why[String(where)] ?? "Something in there isn't right. Check it and save again.", at: Date.now() };
  }
  if (p.data.gifts && !validGifts(p.data.gifts)) {
    return { ok: false, message: "Your first gift has to cost 1 coin, and each one after it more than the last.", at: Date.now() };
  }
  const teams = sidesProblem(p.data.teams[0].name, p.data.teams[1].name);
  if (teams) return { ok: false, message: `Team names: ${teams}`, at: Date.now() };
  for (const r of p.data.rivals.own) {
    const why = ownRivalryProblem(r.red, r.blue);
    if (why) return { ok: false, message: `${r.red} vs ${r.blue}: ${why}`, at: Date.now() };
  }
  if (p.data.rivals.gifts && !validSideGifts(p.data.rivals.gifts)) {
    return { ok: false, message: "Each side needs three different gifts, each costing more than the one before, and no gift on both sides.", at: Date.now() };
  }
  await saveLiveSettings(me.id, p.data);
  // with rounds no longer becoming Shorts, the ones waiting go, gifters' names and all
  if (!p.data.clips) await forgetClips(me.id);
  revalidatePath("/app/live");
  revalidatePath("/app");
  return { ok: true, message: "Saved. A game that's already open picks it up when you reload it.", at: Date.now() };
}

/** One tap: viewers' initials instead of their names and pictures in the game, or names again. A game that's open asks within a minute. */
export async function saveNames(_: NamesState, form: FormData): Promise<NamesState> {
  const me = await requireUser();
  const hide = form.get("hide") === "1";
  try {
    await setHideNames(me.id, hide);
  } catch (err) {
    console.error("hide names: saving failed", err instanceof Error ? err.message : err);
    return { ok: false, hide, at: Date.now() };
  }
  revalidatePath("/app/live");
  return { ok: true, hide, at: Date.now() };
}

/** A new private key for the game's address; the old address stops working. */
export async function newKey() {
  const me = await requireUser();
  await rotateOverlayKey(me.id);
  revalidatePath("/app/live");
  redirect("/app/live?rotated=1#address");
}

/** Their answers to "can you earn gifts on a TikTok LIVE?": a box left unticked is a no. */
export async function checkLive(form: FormData) {
  const me = await requireUser();
  const c: LiveCheck = { canGoLive: form.get("canGoLive") === "on", computer: form.get("computer") === "on" };
  await asUser(me.id, (tx) => tx`update public.profiles set live_check = ${tx.json(c)} where id = ${me.id}`);
  revalidatePath("/app", "layout");
  redirect("/app/live#go-live");
}

/** Answer again. */
export async function recheckLive() {
  const me = await requireUser();
  await asUser(me.id, (tx) => tx`update public.profiles set live_check = null where id = ${me.id}`);
  revalidatePath("/app", "layout");
  redirect("/app/live#go-live");
}

/** Their answers to "can you get Super Chats on YouTube Live?": a box left unticked is a no. */
export async function checkYouTubeLive(form: FormData) {
  const me = await requireUser();
  const on = (name: string) => form.get(name) === "on";
  const c: YtLiveCheck = { canGoLive: on("canGoLive"), computer: on("computer"), superChat: on("superChat") };
  await asUser(me.id, (tx) => tx`update public.profiles set yt_live_check = ${tx.json(c)} where id = ${me.id}`);
  revalidatePath("/app", "layout");
  redirect("/app/live?on=youtube#go-live");
}

/** Answer YouTube's questions again. */
export async function recheckYouTubeLive() {
  const me = await requireUser();
  await asUser(me.id, (tx) => tx`update public.profiles set yt_live_check = null where id = ${me.id}`);
  revalidatePath("/app", "layout");
  redirect("/app/live?on=youtube#go-live");
}

/** The YouTube channel they go live on, which the game then reads: only ever one of their own. */
export async function pickLiveChannel(form: FormData) {
  const me = await requireUser();
  const id = z.uuid().safeParse(form.get("channel"));
  if (id.success) await chooseLiveChannel(me.id, id.data);
  revalidatePath("/app/live");
  redirect("/app/live?on=youtube#go-live");
}
