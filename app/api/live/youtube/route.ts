import type { YouTubeLiveReply } from "@/lib/live/youtube";
import { configured } from "@/lib/server/env";
import { youtubeLiveFor } from "@/lib/server/ytlive";

/**
 * A game on a YouTube stream asking for its chat. The game runs signed out
 * (an OBS browser source), so the streamer's overlay key says whose
 * stream it is, and the server finds that stream on their own connected
 * channel. `after` is the seq from the last reply, `go=1` looks for the
 * stream now, and `hurry=1` says the game is counting down or voting.
 * `setup=1` is the LIVE page asking, which keeps the chat read like a game
 * does but never counts as a game being open.
 * Every reply says when to ask again. While YouTube Live is switched off
 * the game hears so and asks again in a minute; 404 only when the key
 * really isn't anyone's, and 503 when Hookline can't tell.
 */

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  if (!configured().db) return new Response("Not set up", { status: 503 });
  const q = new URL(req.url).searchParams;
  const after = /^\d{1,15}$/.test(q.get("after") ?? "") ? Number(q.get("after")) : null;
  if (!configured().youtubeLive) {
    const off: YouTubeLiveReply = { state: "off", channel: null, title: null, broadcast: null, until: null, who: null, detail: null, kids: false, events: [], seq: after ?? 0, wait: 60_000 };
    return Response.json(off, { headers: NO_STORE });
  }
  try {
    const reply = await youtubeLiveFor(q.get("key") ?? "", after, { go: q.get("go") === "1", hurry: q.get("hurry") === "1", setup: q.get("setup") === "1" });
    if (!reply) return new Response("Unknown key", { status: 404 });
    return Response.json(reply, { headers: NO_STORE });
  } catch (err) {
    console.error("youtube live: couldn't answer a game:", err instanceof Error ? err.message : err);
    return new Response("Try again soon", { status: 503 });
  }
}
