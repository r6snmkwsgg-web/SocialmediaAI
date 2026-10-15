import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { saveChannel } from "@/lib/server/channels-store";
import { origin } from "@/lib/server/http";
import { finishOAuth } from "@/lib/server/oauth";
import { tiktokExchange, tiktokUser } from "@/lib/server/tiktok";
import { youtubeChannel, youtubeExchange } from "@/lib/server/youtube";

/** Back from Google or TikTok: swap the code for tokens, find the account, save both. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const base = await origin();
  const me = await currentUser();
  if (!me) return NextResponse.redirect(`${base}/login`);
  const q = req.nextUrl.searchParams;
  const ok = await finishOAuth(platform, q.get("state"));
  const next = ok?.next ?? "/app/settings";
  const go = (extra: string) => NextResponse.redirect(`${base}${next}${next.includes("?") ? "&" : "?"}${extra}`);
  const code = q.get("code");
  if (!ok || !code) return go(`error=${q.get("error") === "access_denied" ? "denied" : "connect"}`);

  const redirect = `${base}/api/connect/${platform}/callback`;
  try {
    if (platform === "youtube") {
      const t = await youtubeExchange(code, redirect);
      const info = await youtubeChannel(t.access);
      await saveChannel(me.id, "youtube", info, t);
    } else if (platform === "tiktok") {
      const t = await tiktokExchange(code, redirect);
      const info = await tiktokUser(t.access);
      await saveChannel(me.id, "tiktok", info, t);
    } else {
      return go("error=platform");
    }
  } catch (err) {
    console.error(`connect ${platform}:`, err instanceof Error ? err.message : err);
    return go(`error=${err instanceof Error && /channel yet/.test(err.message) ? "nochannel" : "connect"}`);
  }
  return go(`connected=${platform}`);
}
