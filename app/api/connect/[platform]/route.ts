import { NextResponse, type NextRequest } from "next/server";
import { billingFor } from "@/lib/server/billing";
import { channelsOf } from "@/lib/server/channels";
import { currentUser } from "@/lib/server/auth";
import { configured } from "@/lib/server/env";
import { origin, safeNext } from "@/lib/server/http";
import { startOAuth } from "@/lib/server/oauth";
import { tiktokAuthUrl } from "@/lib/server/tiktok";
import { youtubeAuthUrl } from "@/lib/server/youtube";

/**
 * Off to Google or TikTok to connect an account; they send the visitor
 * back to /callback. `channel=<id>` says it's to connect one of theirs
 * again (Settings' Reconnect, say).
 */
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

  // a full plan (counting the ones not disconnected, and one TikTok on every plan): reconnecting one they have is fine,
  // the one asked for or one that needs it, and so is a TikTok connected before Hookline read usernames, which needs
  // connecting again for its LIVEs to count. The account chooser says which comes back, so the callback checks again
  const plan = (await billingFor(me.id)).plan;
  const mine = (await channelsOf(me.id)).filter((x) => x.platform === platform);
  const room = platform === "youtube" ? plan.channels : plan.tiktokAccounts;
  const again = req.nextUrl.searchParams.get("channel");
  const noUsername = (x: (typeof mine)[number]) => c.tiktokProfile && x.platform === "tiktok" && !x.handle;
  if (mine.length >= room && !mine.some((x) => x.id === again || x.status === "expired" || noUsername(x))) {
    return back(platform === "youtube" ? "channels" : "tiktokOne");
  }

  const state = await startOAuth(platform, next);
  const redirect = `${base}/api/connect/${platform}/callback`;
  return NextResponse.redirect(platform === "youtube" ? youtubeAuthUrl(state, redirect) : tiktokAuthUrl(state, redirect));
}
