import type { LivePlatform } from "./events";
import { welcomeLine } from "./supporters";

/**
 * Every line on the stream that differs by platform, in one place. A
 * YouTube stream says only what happens there: its chat has no likes,
 * shares or coins, so its lines speak of Super Chats and Jewels gifts, and
 * of power where TikTok's speak of coins. TikTok's lines are the ones it
 * has always had.
 */

export type Words = {
  /** each game's rules line about what helps besides the menu */
  battleRules: string;
  raceRules: string;
  royaleRules: string;
  rivalsRules: string;
  /** under Ball Race's TYPE GO */
  raceHeader: string;
  /** under Rivals' PICK YOUR SIDE */
  rivalsPick: string;
  /** under the countdown: in games where gifts wait for the fight, and in games that take them during it (Ball Race) */
  footLater: string;
  footNow: string;
  /** under the vote's heading */
  vote: string;
  /** what a gift's worth is called in the crown line and the round's best */
  worth: string;
  /** the crown line while nobody has given anything this round */
  crownNobody: string;
  /** the toast when Ball Race or Last One Standing is full */
  raceFull: string;
  royaleFull: string;
  /** the top 3 strip while nobody has given anything this LIVE */
  top3Empty: string;
  /** a welcome back, by where they came last LIVE */
  welcome: (rank: number) => string;
};

const TIKTOK: Words = {
  battleRules: "LIKES HEAL YOUR TEAM",
  raceRules: "LIKES MAKE YOUR BALL HEAVIER",
  royaleRules: "LIKES HEAL YOUR BALL",
  rivalsRules: "LIKES AND OTHER GIFTS HELP YOUR SIDE",
  raceHeader: "TO RACE FOR FREE · GIFTS MAKE YOUR BALL HEAVIER",
  rivalsPick: "OR SEND YOUR SIDE'S GIFT",
  footLater: "GIFTS SENT NOW LAND WHEN IT STARTS",
  footNow: "GIFT NOW TO START AHEAD",
  vote: "TYPE A, B OR C · GIFTS ADD VOTES",
  worth: "COINS",
  crownNobody: "BIGGEST GIFTER WEARS THE CROWN",
  raceFull: "race is full · send a gift to get in",
  royaleFull: "it's full · send a gift to get in",
  top3Empty: "TOP GIFTERS THIS LIVE",
  welcome: welcomeLine,
};

const YOUTUBE: Words = {
  battleRules: "SUPER CHATS AND GIFTS POWER YOUR TEAM",
  raceRules: "SUPER CHATS AND GIFTS MAKE YOUR BALL HEAVIER",
  royaleRules: "SUPER CHATS AND GIFTS POWER YOUR BALL",
  rivalsRules: "SUPER CHATS AND GIFTS HELP YOUR SIDE",
  raceHeader: "TO RACE FOR FREE · SUPER CHATS MAKE YOUR BALL HEAVIER",
  // the cheapest Super Chats carry no message, so the side is picked by typing first
  rivalsPick: "THEN SUPER CHAT TO HELP YOUR SIDE",
  footLater: "SUPER CHATS SENT NOW LAND WHEN IT STARTS",
  footNow: "SUPER CHAT NOW TO START AHEAD",
  vote: "TYPE A, B OR C · SUPER CHATS ADD VOTES",
  worth: "POWER",
  crownNobody: "BIGGEST SUPPORTER WEARS THE CROWN",
  raceFull: "race is full · Super Chat to get in",
  royaleFull: "it's full · Super Chat to get in",
  top3Empty: "TOP SUPPORTERS THIS LIVE",
  welcome: welcomeLine,
};

/** The stream's lines for a platform. */
export function words(platform: LivePlatform): Words {
  return platform === "youtube" ? YOUTUBE : TIKTOK;
}
