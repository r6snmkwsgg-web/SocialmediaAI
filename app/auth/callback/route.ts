import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { configured } from "@/lib/server/env";
import { origin, safeNext } from "@/lib/server/http";
import { supabase } from "@/lib/server/supabase";

/**
 * Where a sign-in link and Google send people back. Google (and a link
 * opened in the same browser) bring a code; the email template in
 * README.md brings a token instead, which works on any device.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const base = await origin();
  if (!configured().supabase) return NextResponse.redirect(`${base}/login?error=setup`);
  const client = await supabase();
  const code = q.get("code");
  const tokenHash = q.get("token_hash");
  const type = q.get("type") as EmailOtpType | null;

  const { error } = code
    ? await client.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await client.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("nothing to sign in with") };
  if (error) return NextResponse.redirect(`${base}/login?error=link`);
  return NextResponse.redirect(`${base}${safeNext(q.get("next"))}`);
}
