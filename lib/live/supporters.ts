import { parseSettings } from "./settings";

/**
 * A LIVE's supporters: the gifters a session keeps (its top 5, each with
 * their TikTok id, name and coins), the last LIVE's top 3 that the game
 * welcomes back, and names cut down to initials when the streamer hides
 * them. Coins here are always gift coins seen, never money.
 */

export type TopGifter = { id: string; name: string; coins: number };

/** how many gifters the game shows, and welcomes back */
export const TOP_SHOWN = 3;

/** A name as initials, K.S. for Kayla Smith, so a viewer can be shown without it; "a viewer" when there are no letters to take. */
export function initials(name: string): string {
  // fancy-text letters come down to plain ones, and a letter's accents and marks stay in its word, as in Hindi
  const words = name.normalize("NFKC").split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length) return "a viewer";
  return words.slice(0, 2).map((w) => `${w.match(/[\p{L}\p{N}]/u)![0].toUpperCase()}.`).join("");
}

/**
 * The ids of the last LIVE's top 3 gifters, most coins first, for welcome
 * backs. Only a LIVE verified as the streamer's own has any: anyone
 * else's LIVE has someone else's supporters.
 */
export function supportersFrom(last: { verified: boolean; top_gifters: TopGifter[] } | null): string[] {
  if (!last?.verified || !Array.isArray(last.top_gifters)) return [];
  return last.top_gifters
    .filter((g) => typeof g?.id === "string" && g.coins > 0)
    .sort((a, b) => b.coins - a.coins)
    .slice(0, TOP_SHOWN)
    .map((g) => g.id);
}

/** What a welcome back says about someone, by where they came last LIVE. */
export function welcomeLine(rank: number): string {
  return rank === 1 ? "TOP SUPPORTER LAST LIVE" : "IN THE TOP 3 LAST LIVE";
}

/**
 * What an open game takes from /api/live/overlay as it runs: whether names
 * are hidden, and the last LIVE's top gifters' ids. Null when the answer
 * isn't one, so a bad answer changes nothing.
 */
export function overlayUpdate(json: unknown): { hideNames: boolean; supporters: string[] } | null {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (!o?.settings || typeof o.settings !== "object" || !Array.isArray(o.supporters)) return null;
  const supporters = o.supporters.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64).slice(0, TOP_SHOWN);
  return { hideNames: parseSettings(o.settings).hideNames, supporters };
}
