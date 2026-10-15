import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sign, unsign } from "./crypto";
import { admin } from "./db";
import { configured, devLoginOn } from "./env";
import { supabase } from "./supabase";

/**
 * Who's signed in. In a deploy that's Supabase Auth (a magic link by
 * email, or Google). On a developer's own machine, with no Supabase set
 * up, there's also a sign-in without email, so the app can be worked on
 * offline; it can't be switched on in a deploy.
 */

export type User = { id: string; email: string };

const DEV_COOKIE = "hl_dev";

export const currentUser = cache(async (): Promise<User | null> => {
  if (configured().supabase) {
    const { data } = await (await supabase()).auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
  }
  if (devLoginOn()) {
    const raw = (await cookies()).get(DEV_COOKIE)?.value;
    const value = raw ? unsign(raw) : null;
    if (!value) return null;
    const [id, email] = value.split("|");
    return id ? { id, email: email ?? "" } : null;
  }
  return null;
});

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Local development only: sign in as an email, making the account if it's new. */
export async function devSignIn(email: string): Promise<void> {
  if (!devLoginOn()) throw new Error("Not available here.");
  const rows = await admin((tx) => tx<{ id: string }[]>`
    insert into auth.users (email) values (${email}) on conflict (email) do update set email = excluded.email returning id`);
  (await cookies()).set(DEV_COOKIE, sign(`${rows[0].id}|${email}`), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export async function signOut(): Promise<void> {
  if (configured().supabase) await (await supabase()).auth.signOut();
  (await cookies()).delete(DEV_COOKIE);
}
