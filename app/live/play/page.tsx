import type { Metadata } from "next";
import { LiveGame } from "@/components/live/game";
import { SOURCES, type SourceId } from "@/components/live/source";
import { GAME_IDS, type GameId } from "@/lib/live/settings";

export const metadata: Metadata = {
  title: "Live battle · Hookline",
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The screen a streamer puts on their TikTok LIVE. Settings come in the
 * address, so it can be pasted straight into OBS or LIVE Studio:
 * ?src=tikfinity|bridge, ?game=battle|race|royale, ?demo=1, ?clean=1,
 * ?ws=ws://… for a custom port.
 */
export default async function LivePlay({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const s = one(q.src);
  const src: SourceId | "none" = s && s in SOURCES ? (s as SourceId) : "none";
  const ws = one(q.ws);
  const url = ws && /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(ws) ? ws : undefined;
  const g = one(q.game);
  const game: GameId = g && (GAME_IDS as readonly string[]).includes(g) ? (g as GameId) : "battle";
  return <LiveGame src={src} url={url} demo={one(q.demo) === "1"} clean={one(q.clean) === "1"} settings={{ game }} />;
}
