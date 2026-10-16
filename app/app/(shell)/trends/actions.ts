"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { makeShortsSaying } from "@/lib/server/shorts/generate";
import { formatOfNiche, setNiches } from "@/lib/server/trends";

export async function follow(form: FormData) {
  const me = await requireUser();
  await setNiches(me.id, form.getAll("niche").map(String));
  revalidatePath("/app/trends");
}

/** A Short in the same format as a rising one, straight into the queue. */
export async function makeLike(form: FormData) {
  const me = await requireUser();
  const format = formatOfNiche(String(form.get("niche") ?? ""));
  if (!format) redirect("/app/trends");
  const r = await makeShortsSaying(me.id, { origin: "daily", count: 1, like: format });
  revalidatePath("/app/shorts");
  redirect(r.made ? "/app/shorts" : `/app/trends?error=${r.short === "dry" || r.short === "off" ? r.short : "allowance"}`);
}
