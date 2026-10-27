"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { validTimezone } from "@/lib/shorts/times";
import { asUser } from "@/lib/server/db";
import { TERMS_VERSION } from "@/lib/legal";

const goal = z.enum(["shorts", "live", "both"]);

/** Their goal, and their agreement to the terms, which picking one needs. */
export async function pickGoal(form: FormData) {
  const me = await requireUser();
  const g = goal.safeParse(form.get("goal"));
  if (!g.success) redirect("/app/welcome");
  if (form.get("terms") !== "on") redirect("/app/welcome?terms=needed");
  const tz = validTimezone(String(form.get("tz") ?? ""));
  await asUser(me.id, (tx) => tx`
    insert into public.profiles (id, email, goal, timezone, terms_version, terms_accepted_at) values (${me.id}, ${me.email}, ${g.data}, ${tz}, ${TERMS_VERSION}, now())
    on conflict (id) do update set goal = excluded.goal, timezone = case when excluded.timezone = 'UTC' then profiles.timezone else excluded.timezone end,
      terms_version = excluded.terms_version, terms_accepted_at = excluded.terms_accepted_at`);
  redirect("/app/welcome?step=connect");
}

/** Someone already set up agreeing to terms that changed, or that they never saw. */
export async function agreeToTerms(form: FormData) {
  const me = await requireUser();
  if (form.get("terms") !== "on") redirect("/app/welcome?terms=needed");
  await asUser(me.id, (tx) => tx`update public.profiles set terms_version = ${TERMS_VERSION}, terms_accepted_at = now() where id = ${me.id}`);
  redirect("/app");
}

/** Done (or skipped): straight to the screen that does what they came for. */
export async function finish() {
  const me = await requireUser();
  const rows = await asUser(me.id, (tx) => tx<{ goal: string | null }[]>`
    update public.profiles set onboarded_at = coalesce(onboarded_at, now()) where id = ${me.id} returning goal`);
  const g = rows[0]?.goal;
  redirect(g === "shorts" ? "/app/shorts" : g === "live" ? "/app/live" : "/app");
}
