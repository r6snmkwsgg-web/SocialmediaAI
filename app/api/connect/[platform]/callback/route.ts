import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { billingFor } from "@/lib/server/billing";
import { channelsOf, connectChannel } from "@/lib/server/channels";
import { origin } from "@/lib/server/http";
import { finishOAuth } from "@/lib/server/oauth";
import { tiktokExchange, tiktokUser } from "@/lib/server/tiktok";
import { YouTubeError, youtubeChannel, youtubeExchange } from "@/lib/server/youtube";
import { QuotaWait } from "@/lib/server/quota";

/**
 * Back from Google or TikTok: swap the code for tokens, find the account,
 * and connect it if the plan has room for it (checked again here, since
 * the account chooser decides which one comes back). A grant made before
 * a refusal stays at Google or TikTok, where the privacy page says to
 * remove it.
 */
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
    const { plan } = await billingFor(me.id);
    if (platform === "youtube") {
      const t = await youtubeExchange(code, redirect);
      const info = await youtubeChannel(t.access);
      const c = await connectChannel(me.id, "youtube", info, t, plan);
      if (!c) return go("error=channels");
      // which channel, for Settings' note, and how many of its Shorts got new times while it was away
      const said = `connected=${c.already ? "already" : "youtube"}&channel=${c.id}${c.moved ? `&moved=${c.moved}` : ""}`;
      // a channel with its question to answer (made for kids or not) before anything posts to it: Settings asks it, and onboarding
      const fresh = (await channelsOf(me.id)).find((x) => x.id === c.id);
      if (fresh?.madeForKids === null && !/^\/app\/welcome/.test(next)) return NextResponse.redirect(`${base}/app/settings?${said}#audience-${c.id}`);
      return go(said);
    } else if (platform === "tiktok") {
      const t = await tiktokExchange(code, redirect);
      const info = await tiktokUser(t.access, t.scopes);
      // every plan posts to one TikTok account
      if (!(await connectChannel(me.id, "tiktok", info, t, plan))) return go("error=tiktokOne");
    } else {
      return go("error=platform");
    }
  } catch (err) {
    // no quota left today to read the channel with, by Hookline's count or YouTube's own word. While getting started the
    // welcome page's connect step says so, since the rest of the app waits until that's done; from anywhere else, Settings does
    if (err instanceof QuotaWait || (err instanceof YouTubeError && err.quota)) {
      return /^\/app\/welcome/.test(next) ? go("error=quota") : NextResponse.redirect(`${base}/app/settings?error=quota`);
    }
    console.error(`connect ${platform}:`, err instanceof Error ? err.message : err);
    return go(`error=${err instanceof Error && /channel yet/.test(err.message) ? "nochannel" : "connect"}`);
  }
  return go(`connected=${platform}`);
}
