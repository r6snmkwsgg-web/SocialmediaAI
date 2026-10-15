import { z } from "zod";

/**
 * What TikTok has the creator decide before anything posts to their
 * account, every time: who can see it (picked by them, never filled in),
 * whether people can comment, Duet and Stitch (all off until they switch
 * them on), and whether it promotes a brand. The form and the server
 * both judge the choices here, so they always agree.
 */

export const PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export type Privacy = (typeof PRIVACY)[number];

export const PRIVACY_LABEL: Record<Privacy, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

/** The creator as TikTok describes them right now: asked again each time the choices are shown. */
export type Creator = {
  nickname: string;
  privacy: Privacy[];
  commentOff: boolean;
  duetOff: boolean;
  stitchOff: boolean;
  maxSeconds: number;
};

export const tiktokChoices = z.object({
  privacy: z.enum(PRIVACY),
  comment: z.boolean(),
  duet: z.boolean(),
  stitch: z.boolean(),
  /** it promotes something: then it's their own brand, someone else's, or both */
  disclose: z.boolean(),
  yourBrand: z.boolean(),
  branded: z.boolean(),
});
export type TikTokChoices = z.infer<typeof tiktokChoices>;

/**
 * What stops these choices posting for this creator, in words for them;
 * null when nothing does. Who can see it may still be unpicked while the
 * creator is choosing; it has to be picked before anything posts.
 */
export function problemWith(c: Omit<TikTokChoices, "privacy"> & { privacy: Privacy | null }, creator: Creator, seconds: number): string | null {
  if (seconds > creator.maxSeconds) return `TikTok takes videos up to ${creator.maxSeconds} seconds from this account, and this one is ${Math.ceil(seconds)}.`;
  if (c.disclose && !c.yourBrand && !c.branded) return "Say whether it promotes you, someone else, or both.";
  if (c.disclose && c.branded && c.privacy === "SELF_ONLY") return "Branded content can't be private on TikTok.";
  if (c.privacy && !creator.privacy.includes(c.privacy)) return "Pick who can see it from the choices TikTok gives this account.";
  return null;
}

/** The label TikTok puts on a post that promotes something. */
export function labelOf(c: Pick<TikTokChoices, "disclose" | "yourBrand" | "branded">): string | null {
  if (!c.disclose) return null;
  if (c.branded) return "Paid partnership";
  return c.yourBrand ? "Promotional content" : null;
}

export const POLICIES = {
  music: "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en",
  branded: "https://www.tiktok.com/legal/page/global/bc-policy/en",
};

/** TikTok's settings for the post. Anything the creator has switched off on TikTok itself stays off. */
export function postSettings(c: TikTokChoices, creator: Creator) {
  return {
    privacy_level: c.privacy,
    disable_comment: creator.commentOff || !c.comment,
    disable_duet: creator.duetOff || !c.duet,
    disable_stitch: creator.stitchOff || !c.stitch,
    brand_content_toggle: c.disclose && c.branded,
    brand_organic_toggle: c.disclose && c.yourBrand,
  };
}

/** TikTok's reasons for turning a post down, in words a creator can act on. */
const REASONS: Record<string, string> = {
  spam_risk_too_many_posts: "TikTok won't take more posts from this account today.",
  spam_risk_user_banned_from_posting: "TikTok has stopped this account from posting.",
  reached_active_user_cap: "TikTok's daily limit for apps under review is full. It can go tomorrow.",
  unaudited_client_can_only_post_to_private_accounts: "While TikTok reviews Hookline, it can only post to private accounts.",
  privacy_level_option_mismatch: "That privacy choice isn't available for this account any more. Choose again.",
  access_token_invalid: "TikTok needs connecting again, in Settings.",
  scope_not_authorized: "TikTok needs connecting again, in Settings, to allow posting.",
  no_tokens: "TikTok needs connecting again, in Settings.",
  no_refresh: "TikTok needs connecting again, in Settings.",
};

export function tiktokReason(code: string | null, fallback: string): string {
  return (code && REASONS[code]) || fallback;
}
