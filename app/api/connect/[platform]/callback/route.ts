import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { channelsOf } from "@/lib/server/channels";
import { saveChannel } from "@/lib/server/channels-store";
import { origin } from "@/lib/server/http";
import { rememberTikTok } from "@/lib/server/live";
import { fitAudience } from "@/lib/server/shorts/queue";
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
      const id = await saveChannel(me.id, "youtube", info, t);
      // YouTube may have the whole channel as made for kids: Shorts waiting for it get endings that don't ask for comments
      await fitAudience(me.id);
      // a new channel has a question to answer (made for kids or not) before anything posts to it: Settings and onboarding ask it
      const fresh = (await channelsOf(me.id)).find((c) => c.id === id);
      if (fresh?.madeForKids === null && !/^\/app\/(settings|welcome)/.test(next)) {
        return NextResponse.redirect(`${base}/app/settings?connected=youtube#audience`);
      }
    } else if (platform === "tiktok") {
      const t = await tiktokExchange(code, redirect);
      const info = await tiktokUser(t.access, t.scopes);
      const id = await saveChannel(me.id, "tiktok", info, t);
      // the username TikTok gave us is what makes a LIVE the game hears count as theirs
      if (info.handle) await rememberTikTok(me.id, id, info.handle);
    } else {
      return go("error=platform");
    }
  } catch (err) {
    console.error(`connect ${platform}:`, err instanceof Error ? err.message : err);
    return go(`error=${err instanceof Error && /channel yet/.test(err.message) ? "nochannel" : "connect"}`);
  }
  return go(`connected=${platform}`);
}
