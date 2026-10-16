import { lookUp, overlayFor } from "@/lib/server/live";

/**
 * A game's settings by its key, for a game that couldn't load them when it
 * opened (the database was down): it asks again now and then and picks
 * them up once they're back. 404 only when the key really isn't anyone's.
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const o = await lookUp(() => overlayFor(key), [300]);
  if (o.state === "gone") return new Response("Unknown key", { status: 404 });
  if (o.state === "unsure") return new Response("Try again soon", { status: 503 });
  return Response.json({ settings: o.value.settings, tag: o.value.plan.tag }, { headers: { "cache-control": "no-store" } });
}
