import { configured } from "@/lib/server/env";

/**
 * Whether Hookline Bridge should be running. Every bridge asks when it
 * starts and every few minutes after; with BRIDGE_OFF=1 they all stop and
 * tell their games to use TikFinity. A bridge that can't reach this keeps
 * going, so an outage never stops someone's LIVE.
 */
export function GET() {
  const off = configured().bridgeOff;
  return Response.json(
    { on: !off, message: off ? "Hookline Bridge is switched off for now. Use TikFinity for your LIVE game instead." : null },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
