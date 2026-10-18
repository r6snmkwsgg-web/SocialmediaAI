import { z } from "zod";

/**
 * Who can earn from the LIVE games. TikTok decides who can go LIVE and get
 * gifts: 18 and over, and in most places about 1,000 followers before
 * LIVE opens up. The games also need a computer, because they go on the
 * LIVE through TikTok LIVE Studio or OBS; the phone app can't show them.
 * Hookline asks rather than checks, and when someone can't earn gifts yet
 * it says so plainly and points them at Shorts instead of selling them
 * games they can't make money with.
 *
 * YouTube Live is asked the same way, with its own questions. The games
 * run on Super Chats there, which YouTube gives only to people 18 and over
 * in its Partner Program, with Super Chat switched on. YouTube lets people
 * stream alone from 16, but a stream without Super Chats would show a menu
 * nobody can send.
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

export const ytLiveCheckSchema = z.object({
  /** 18 or older */
  adult: z.boolean(),
  /** their channel can go live: verified, with no live streaming restrictions */
  canGoLive: z.boolean(),
  /** they'll go live from a computer, with OBS or another streaming app */
  computer: z.boolean(),
  /** their channel has Super Chat, which comes with the YouTube Partner Program */
  superChat: z.boolean(),
});

export type YtLiveCheck = z.infer<typeof ytLiveCheckSchema>;

export function parseYtLiveCheck(raw: unknown): YtLiveCheck | null {
  const p = ytLiveCheckSchema.safeParse(raw);
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

/** Whether the games can get them Super Chats on YouTube Live, and if not, why, in their order of importance. */
export function ytLiveFit(c: YtLiveCheck | null): LiveFit {
  if (!c) return { asked: false };
  const reasons: string[] = [];
  if (!c.adult) reasons.push("YouTube only lets people 18 and over get Super Chats, and the games run on them.");
  if (!c.canGoLive) reasons.push("Your channel needs live streaming switched on first. YouTube asks for a verified channel, and the first time it can take a day.");
  if (!c.computer) reasons.push("The games go on your stream through OBS or another app on a computer. The YouTube phone app can't show them.");
  // Super Chat is only for 18 and over, so someone younger isn't told to switch it on
  if (!c.superChat && c.adult) reasons.push("The games run on Super Chats, which come with the YouTube Partner Program. Switch Super Chat on for your channel first.");
  return { asked: true, ok: reasons.length === 0, reasons };
}

/**
 * Whether to offer them the paid LIVE games: not when they've said they
 * can't earn gifts on TikTok yet, unless they've said they can get Super
 * Chats on YouTube Live. Their YouTube answers only count while YouTube
 * Live is on (`youtubeOn`).
 */
export function sellLive(tiktok: LiveCheck | null, youtube: YtLiveCheck | null = null, youtubeOn = false): boolean {
  const t = liveFit(tiktok);
  const y = ytLiveFit(youtubeOn ? youtube : null);
  return !t.asked || t.ok || (y.asked && y.ok);
}

/**
 * The line about LIVE gifts under the plans. It says what TikTok needs and
 * never what anything will earn: nobody's income can be promised, and the
 * platforms' own reward programs have their own bars to clear. While
 * YouTube Live is on, it says what YouTube needs for Super Chats too.
 */
export function giftsLine(tiktok: LiveCheck | null, youtube: YtLiveCheck | null = null, youtubeOn = false): string {
  const onTikTok = sellLive(tiktok)
    ? "Gifts on a TikTok LIVE need you to be 18 or older, an account that can go LIVE, and a computer."
    : "You told us you can't get gifts on a TikTok LIVE yet, so the LIVE games in Pro can't bring you any for now.";
  if (!youtubeOn) return onTikTok;
  const y = ytLiveFit(youtube);
  const onYouTube = y.asked && !y.ok
    ? "You told us you can't get Super Chats on YouTube yet, so the LIVE games can't bring you any there for now."
    : "Super Chats on YouTube Live need you to be 18 or older and in the YouTube Partner Program.";
  return `${onTikTok} ${onYouTube}`;
}
