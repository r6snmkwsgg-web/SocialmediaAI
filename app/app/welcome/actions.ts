"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { validTimezone } from "@/lib/shorts/times";
import { asUser } from "@/lib/server/db";

const goal = z.enum(["shorts", "live", "both"]);

export async function pickGoal(form: FormData) {
  const me = await requireUser();
  const g = goal.safeParse(form.get("goal"));
  if (!g.success) redirect("/app/welcome");
  const tz = validTimezone(String(form.get("tz") ?? ""));
  await asUser(me.id, (tx) => tx`
    insert into public.profiles (id, email, goal, timezone) values (${me.id}, ${me.email}, ${g.data}, ${tz})
    on conflict (id) do update set goal = excluded.goal, timezone = case when excluded.timezone = 'UTC' then profiles.timezone else excluded.timezone end`);
  redirect("/app/welcome?step=connect");
}

/** Done (or skipped): straight to the screen that does what they came for. */
export async function finish() {
  const me = await requireUser();
  const rows = await asUser(me.id, (tx) => tx<{ goal: string | null }[]>`
    update public.profiles set onboarded_at = coalesce(onboarded_at, now()) where id = ${me.id} returning goal`);
  const g = rows[0]?.goal;
  redirect(g === "shorts" ? "/app/shorts" : g === "live" ? "/app/live" : "/app");
}
