import { z } from "zod";

/**
 * Who can earn from the LIVE games. TikTok decides who can go LIVE and get
 * gifts: 18 and over, and in most places about 1,000 followers before
 * LIVE opens up. The games also need a computer, because they go on the
 * LIVE through TikTok LIVE Studio or OBS; the phone app can't show them.
 * Hookline asks rather than checks, and when someone can't earn gifts yet
 * it says so plainly and points them at Shorts instead of selling them
 * games they can't make money with.
 */

export const liveCheckSchema = z.object({
  /** 18 or older */
  adult: z.boolean(),
  /** their TikTok can go LIVE already (usually from 1,000 followers) */
  canGoLive: z.boolean(),
  /** they'll go LIVE from a computer, with LIVE Studio or OBS */
  computer: z.boolean(),
});

export type LiveCheck = z.infer<typeof liveCheckSchema>;

export function parseLiveCheck(raw: unknown): LiveCheck | null {
  const p = liveCheckSchema.safeParse(raw);
  return p.success ? p.data : null;
}

export type LiveFit = { asked: false } | { asked: true; ok: boolean; reasons: string[] };

/** Whether the games can earn gifts for them, and if not, why, in their order of importance. */
export function liveFit(c: LiveCheck | null): LiveFit {
  if (!c) return { asked: false };
  const reasons: string[] = [];
  if (!c.adult) reasons.push("TikTok only lets people 18 and over go LIVE and get gifts.");
  if (!c.canGoLive) reasons.push("TikTok usually opens up LIVE once an account has about 1,000 followers.");
  if (!c.computer) reasons.push("The games go on your LIVE through TikTok LIVE Studio or OBS on a computer. The phone app can't show them.");
  return { asked: true, ok: reasons.length === 0, reasons };
}

/** Whether to offer them the paid LIVE games: not when they've said they can't earn gifts yet. */
export function sellLive(c: LiveCheck | null): boolean {
  const f = liveFit(c);
  return !f.asked || f.ok;
}

/**
 * The line about LIVE gifts under the plans. It says what TikTok needs and
 * never what anything will earn: nobody's income can be promised, and the
 * platforms' own reward programs have their own bars to clear.
 */
export function giftsLine(c: LiveCheck | null): string {
  return sellLive(c)
    ? "Gifts on a TikTok LIVE need you to be 18 or older, an account that can go LIVE, and a computer."
    : "You told us you can't get gifts on a TikTok LIVE yet, so the LIVE games in Pro can't bring you any for now.";
}
