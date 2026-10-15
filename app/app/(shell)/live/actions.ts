"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validGifts } from "@/lib/live/menu";
import { ownRivalryProblem, validSideGifts } from "@/lib/live/rivals";
import { liveSettingsSchema } from "@/lib/live/settings";
import { requireUser } from "@/lib/server/auth";
import { rotateOverlayKey, saveLiveSettings } from "@/lib/server/live";

export type SaveState = { ok: boolean; message: string; at: number } | null;

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
  for (const r of p.data.rivals.own) {
    const why = ownRivalryProblem(r.red, r.blue);
    if (why) return { ok: false, message: `${r.red} vs ${r.blue}: ${why}`, at: Date.now() };
  }
  if (p.data.rivals.gifts && !validSideGifts(p.data.rivals.gifts)) {
    return { ok: false, message: "Each side needs three different gifts, each costing more than the one before, and no gift on both sides.", at: Date.now() };
  }
  await saveLiveSettings(me.id, p.data);
  revalidatePath("/app/live");
  revalidatePath("/app");
  return { ok: true, message: "Saved. A game that's already open picks it up when you reload it.", at: Date.now() };
}

/** A new private key for the game's address; the old address stops working. */
export async function newKey() {
  const me = await requireUser();
  await rotateOverlayKey(me.id);
  revalidatePath("/app/live");
  redirect("/app/live?rotated=1#address");
}
