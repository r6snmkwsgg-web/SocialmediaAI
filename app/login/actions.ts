"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { devSignIn } from "@/lib/server/auth";
import { configured } from "@/lib/server/env";
import { origin } from "@/lib/server/http";
import { supabase } from "@/lib/server/supabase";

const email = z.email().max(254);

/** A sign-in link by email: the account is made the first time it's used. */
export async function sendLink(form: FormData) {
  const parsed = email.safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) redirect("/login?error=email");
  if (!configured().supabase) redirect("/login?error=setup");
  const { error } = await (await supabase()).auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: `${await origin()}/auth/callback`, shouldCreateUser: true },
  });
  if (error) redirect(`/login?error=${error.status === 429 ? "slow" : "send"}`);
  redirect("/login?sent=1");
}

export async function google() {
  if (!configured().supabase) redirect("/login?error=setup");
  const { data, error } = await (await supabase()).auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await origin()}/auth/callback` },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

/** On a developer's own machine only (see auth.ts). */
export async function devLogin(form: FormData) {
  const parsed = email.safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) redirect("/login?error=email");
  await devSignIn(parsed.data);
  redirect("/app");
}
