import { NextResponse, type NextRequest } from "next/server";
import { billingFor } from "@/lib/server/billing";
import { channelsOf } from "@/lib/server/channels";
import { currentUser } from "@/lib/server/auth";
import { configured } from "@/lib/server/env";
import { origin, safeNext } from "@/lib/server/http";
import { startOAuth } from "@/lib/server/oauth";
import { tiktokAuthUrl } from "@/lib/server/tiktok";
import { youtubeAuthUrl } from "@/lib/server/youtube";

/** Off to Google or TikTok to connect an account; they send the visitor back to /callback. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const base = await origin();
  const me = await currentUser();
  if (!me) return NextResponse.redirect(`${base}/login`);
  const next = safeNext(req.nextUrl.searchParams.get("next"), "/app/settings");
  const back = (error: string) => NextResponse.redirect(`${base}${next}${next.includes("?") ? "&" : "?"}error=${error}`);
  if (platform !== "youtube" && platform !== "tiktok") return back("platform");
  const c = configured();
  if (platform === "youtube" ? !c.youtube : !c.tiktok) return back("setup");

  // more channels than the plan has room for: reconnecting one they have is fine
  const plan = (await billingFor(me.id)).plan;
  const mine = (await channelsOf(me.id)).filter((x) => x.platform === platform);
  if (mine.length >= plan.channels && !mine.some((x) => x.status !== "connected")) return back("channels");

  const state = await startOAuth(platform, next);
  const redirect = `${base}/api/connect/${platform}/callback`;
  return NextResponse.redirect(platform === "youtube" ? youtubeAuthUrl(state, redirect) : tiktokAuthUrl(state, redirect));
}
