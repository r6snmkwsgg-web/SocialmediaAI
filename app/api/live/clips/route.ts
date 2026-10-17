import { CLIP_BYTES } from "@/lib/live/clip";
import { clipUpload, saveClip } from "@/lib/server/clips";
import { configured } from "@/lib/server/env";

/**
 * A round the game kept for a Short, sent once as it's decided. The game
 * runs signed out (in TikTok LIVE Studio or OBS), so the streamer's overlay
 * key says whose it is. It never sends a round twice and ignores what comes
 * back: Hookline checks the round, plays it back and keeps it only when it
 * plays back exactly and is worth a Short.
 */
export async function POST(req: Request) {
  if (!configured().db) return new Response("Not set up", { status: 503 });
  if (Number(req.headers.get("content-length") ?? 0) > CLIP_BYTES) return new Response("Too big", { status: 413 });
  const text = await upTo(req, CLIP_BYTES);
  if (text === null) return new Response("Too big", { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response("Not JSON", { status: 400 });
  }
  const p = clipUpload.safeParse(body);
  if (!p.success) return new Response("Not a round", { status: 400 });
  const r = await saveClip(p.data.key, p.data.clip);
  if (r.status === 200) return Response.json({ kept: r.kept });
  if (r.status === 422) return new Response(r.why, { status: 422 });
  const why = { 403: "Rounds aren't becoming Shorts on this account", 404: "Unknown key", 409: "Already sent", 429: "Too many rounds this hour" };
  return new Response(why[r.status], { status: r.status });
}

/** The body as text, read a piece at a time, or null once it's past `cap` bytes, so a huge one is never held whole. */
async function upTo(req: Request, cap: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}
