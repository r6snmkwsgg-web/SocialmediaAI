import { plausible, sessionSchema } from "@/lib/live/session";
import { configured } from "@/lib/server/env";
import { recordSession } from "@/lib/server/live";

/**
 * The game saving a LIVE session's numbers. The game runs signed out (in
 * TikTok LIVE Studio or OBS), so the streamer's overlay key says whose it
 * is. Sent as JSON, or as a beacon when the page closes.
 */
export async function POST(req: Request) {
  if (!configured().db) return new Response("Not set up", { status: 503 });
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new Response("Not JSON", { status: 400 });
  }
  const p = sessionSchema.safeParse(body);
  if (!p.success || !plausible(p.data)) return new Response("Not a session", { status: 400 });
  const saved = await recordSession(p.data);
  return saved ? Response.json({ ok: true }) : new Response("Unknown key", { status: 404 });
}
