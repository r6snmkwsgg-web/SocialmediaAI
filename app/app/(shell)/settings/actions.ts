"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, signOut } from "@/lib/server/auth";
import { stripe } from "@/lib/server/billing";
import { disconnectChannel, setAudience, setChannelSettings } from "@/lib/server/channels";
import { admin, asUser } from "@/lib/server/db";
import { configured } from "@/lib/server/env";
import { safeNext } from "@/lib/server/http";
import { removeVideos } from "@/lib/server/storage";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { channelSettingsFrom } from "@/lib/shorts/channels";
import { validTimezone } from "@/lib/shorts/times";
import { YT_PRIVACY } from "@/lib/shorts/youtube";

const profile = z.object({
  name: z.string().trim().max(40).transform((s) => s || null),
  goal: z.enum(["shorts", "live", "both"]),
  timezone: z.string().refine((t) => validTimezone(t) === t),
});

export async function saveProfile(form: FormData) {
  const me = await requireUser();
  const p = profile.safeParse({ name: form.get("name") ?? "", goal: form.get("goal"), timezone: form.get("timezone") ?? "UTC" });
  if (!p.success) redirect("/app/settings?error=profile");
  await asUser(me.id, (tx) => tx`update public.profiles set name = ${p.data.name}, goal = ${p.data.goal}, timezone = ${p.data.timezone} where id = ${me.id}`);
  revalidatePath("/app", "layout");
  redirect("/app/settings?saved=1");
}

/** Which kinds of Short to make: text stories are off until switched on here. */
export async function saveShorts(form: FormData) {
  const me = await requireUser();
  const on = form.get("textStories") === "on";
  await asUser(me.id, (tx) => tx`update public.profiles set text_stories = ${on} where id = ${me.id}`);
  revalidatePath("/app/settings");
  redirect("/app/settings?saved=1");
}

/** Disconnecting keeps the channel and its Shorts; its keys, and the figures read with them, go. */
export async function disconnect(form: FormData) {
  const me = await requireUser();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) redirect("/app/settings");
  const done = await disconnectChannel(me.id, id.data);
  revalidatePath("/app", "layout");
  // the note says when TikTok choices made for that account were cleared
  redirect(done ? `/app/settings?disconnected=${done.platform}${done.cleared ? "&cleared=1" : ""}` : "/app/settings");
}

/** A YouTube channel's own Shorts settings: whether it gets new Shorts, read only where the form showed its checkbox. */
export async function saveChannelSettings(form: FormData) {
  const me = await requireUser();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success || !(await setChannelSettings(me.id, id.data, channelSettingsFrom(form)))) redirect("/app/settings?error=settings");
  revalidatePath("/app", "layout");
  // back where they were, with the channel saying it's saved
  redirect(`/app/settings?saved=channel&channel=${id.data}#channel-${id.data}`);
}

const audience = z.object({
  id: z.uuid(),
  kids: z.enum(["yes", "no"]),
  privacy: z.enum(YT_PRIVACY),
});

/** The creator's answers for a YouTube channel: made for kids or not (nothing picked for them), and who sees new Shorts. */
export async function saveAudience(form: FormData) {
  const me = await requireUser();
  const next = safeNext(String(form.get("next") ?? ""), "/app/settings");
  const a = audience.safeParse({ id: form.get("id"), kids: form.get("kids"), privacy: form.get("privacy") ?? "public" });
  const back = (q: string) => `${next}${next.includes("?") ? "&" : "?"}${q}`;
  if (!a.success) redirect(back("error=audience"));
  await setAudience(me.id, a.data.id, a.data.kids === "yes", a.data.privacy);
  revalidatePath("/app", "layout");
  redirect(back("saved=audience"));
}

/**
 * Deleting an account: the subscription is cancelled first so nobody is
 * charged again, then the account and everything that belongs to it.
 */
export async function deleteAccount(form: FormData) {
  const me = await requireUser();
  if (String(form.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") redirect("/app/settings?error=confirm#delete");
  const subs = await admin((tx) => tx<{ stripe_subscription_id: string | null }[]>`
    select stripe_subscription_id from public.subscriptions where user_id = ${me.id} and status not in ('canceled', 'incomplete_expired', 'none')`);
  const sub = subs[0]?.stripe_subscription_id;
  if (sub) {
    try {
      await stripe().subscriptions.cancel(sub);
    } catch (err) {
      console.error("delete account: cancelling failed", err instanceof Error ? err.message : err);
      redirect("/app/settings?error=cancel#delete");
    }
  }
  await removeVideos(me.id).catch(() => {});
  if (configured().storage) {
    const { error } = await supabaseAdmin().auth.admin.deleteUser(me.id);
    if (error) redirect("/app/settings?error=delete#delete");
  } else {
    await admin((tx) => tx`delete from auth.users where id = ${me.id}`);
  }
  await signOut();
  redirect("/?deleted=1");
}
