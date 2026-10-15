import type { Metadata } from "next";
import { Play } from "@/components/live/play";
import { SOURCES, type SourceId } from "@/components/live/source";
import { PLANS } from "@/lib/billing/plans";
import { allowedBy, DEFAULT_SETTINGS, GAME_IDS, type GameId, type LiveSettings } from "@/lib/live/settings";
import { overlayFor } from "@/lib/server/live";

export const metadata: Metadata = {
  title: "Live game",
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The screen a streamer puts on their TikTok LIVE. Settings come in the
 * address, so it can be pasted straight into OBS or LIVE Studio:
 * ?key=… (a streamer's own settings, and saves their stats),
 * ?src=tikfinity|bridge, ?game=battle|race|royale (without a key),
 * ?demo=1, ?clean=1, ?ws=ws://… for a custom port.
 */
export default async function LivePlay({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const s = one(q.src);
  const src: SourceId | "none" = s && s in SOURCES ? (s as SourceId) : "none";
  const ws = one(q.ws);
  const url = ws && /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(ws) ? ws : undefined;
  const g = one(q.game);
  const game: GameId = g && (GAME_IDS as readonly string[]).includes(g) ? (g as GameId) : "battle";
  const demo = one(q.demo) === "1";
  const key = one(q.key);

  let settings: LiveSettings = { ...DEFAULT_SETTINGS, game };
  let tag = true;
  let notice: string | undefined;
  if (key) {
    const o = await overlayFor(key).catch(() => null);
    if (o) {
      settings = o.settings;
      tag = o.plan.tag;
    } else {
      settings = allowedBy(settings, PLANS.free);
      notice = "OLD GAME ADDRESS · COPY THE NEW ONE FROM HOOKLINE";
    }
  } else if (!demo) {
    // no account behind it: the free game
    settings = allowedBy(settings, PLANS.free);
  }

  return <Play src={src} url={url} demo={demo} clean={one(q.clean) === "1"} settings={settings} tag={tag} notice={notice} overlayKey={key && !notice ? key : undefined} />;
}
