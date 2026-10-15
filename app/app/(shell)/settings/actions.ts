"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, signOut } from "@/lib/server/auth";
import { stripe } from "@/lib/server/billing";
import { admin, asUser } from "@/lib/server/db";
import { configured } from "@/lib/server/env";
import { removeVideos } from "@/lib/server/storage";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { validTimezone } from "@/lib/shorts/times";

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

export async function disconnect(form: FormData) {
  const me = await requireUser();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) redirect("/app/settings");
  // row-level security keeps this to their own channels; the tokens go with it
  await asUser(me.id, (tx) => tx`delete from public.channels where id = ${id.data}`);
  revalidatePath("/app/settings");
  redirect("/app/settings?disconnected=1");
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
