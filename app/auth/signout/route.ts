import { NextResponse } from "next/server";
import { signOut } from "@/lib/server/auth";
import { origin } from "@/lib/server/http";

/** Signing out: a form posts here, so a link can't sign anyone out. */
export async function POST() {
  await signOut();
  return NextResponse.redirect(`${await origin()}/`, { status: 303 });
}
