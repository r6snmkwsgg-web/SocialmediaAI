import type { Metadata } from "next";
import { Play } from "@/components/live/play";
import { SOURCES, type SourceId } from "@/components/live/source";
import { PLANS } from "@/lib/billing/plans";
import { OLD_ADDRESS } from "@/lib/live/last-good";
import { allowedBy, DEFAULT_SETTINGS, GAME_IDS, type GameId, type LiveSettings } from "@/lib/live/settings";
import { lookUp, overlayFor } from "@/lib/server/live";

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
 * ?src=tikfinity|bridge, ?game=battle|race|royale|rivals (without a key),
 * ?demo=1, ?clean=1, ?ws=ws://… for a custom port.
 *
 * A key that's been replaced shows a bar asking for the new address. A key
 * whose settings can't be read right now (the database is down) is not
 * that: the game keeps the streamer's last settings, or reconnects.
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

  // only a game playing a streamer's own settings keeps rounds for Shorts: never the free game, or the plain one while Hookline can't be reached
  let settings: LiveSettings = { ...DEFAULT_SETTINGS, game, clips: false };
  let tag = true;
  let notice: string | undefined;
  let unsure = false;
  // the last LIVE's top gifters' TikTok ids, to welcome back; none without a key, or when the key can't be read
  let supporters: string[] = [];
  if (key) {
    const o = await lookUp(() => overlayFor(key));
    if (o.state === "ok") {
      settings = o.value.settings;
      tag = o.value.plan.tag;
      supporters = o.value.supporters;
    } else {
      settings = allowedBy(settings, PLANS.free);
      if (o.state === "gone") notice = OLD_ADDRESS;
      else unsure = true;
    }
  } else if (!demo) {
    // no account behind it: the free game
    settings = allowedBy(settings, PLANS.free);
  }

  return <Play src={src} url={url} demo={demo} clean={one(q.clean) === "1"} settings={settings} tag={tag} notice={notice} unsure={unsure} overlayKey={key && !notice ? key : undefined} supporters={supporters} />;
}
