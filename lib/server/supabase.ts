import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Supabase, for signing in (magic links and Google) and for storing
 * rendered videos. The database itself is reached directly (see db.ts),
 * so row-level security applies the same way either route.
 */

/** Supabase as the visitor, with their session cookies: for auth. */
export async function supabase(): Promise<SupabaseClient> {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error("Supabase isn't set up.");
  const store = await cookies();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // a server component can't set cookies; the middleware refreshes them instead
        }
      },
    },
  });
}

export { supabaseAdmin } from "./supabase-admin";
