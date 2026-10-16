import { parseSettings, type LiveSettings } from "./settings";

/**
 * The last settings a streamer's game loaded, kept in the browser source
 * itself (OBS and LIVE Studio keep a page's storage). When Hookline can't
 * be reached as the game opens, it plays with these rather than dropping
 * a paying streamer to the free game in the middle of their LIVE.
 */

export type LastGood = { settings: LiveSettings; tag: boolean };

/** what the game says, at the top, when its address has a key that's been replaced */
export const OLD_ADDRESS = "OLD GAME ADDRESS · COPY THE NEW ONE FROM HOOKLINE";

export const lastGoodKey = (overlayKey: string) => `hookline:game:${overlayKey}`;

/** What was kept, if it's readable. */
export function readLastGood(raw: string | null): LastGood | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { settings?: unknown; tag?: unknown };
    if (!j || typeof j !== "object" || !j.settings) return null;
    return { settings: parseSettings(j.settings), tag: j.tag !== false };
  } catch {
    return null;
  }
}

export function writeLastGood(g: LastGood): string {
  return JSON.stringify({ settings: g.settings, tag: g.tag });
}
