import type { GameId } from "../live/settings";

/**
 * The plans, and what each one allows. The rest of the app asks these
 * questions (how many Shorts, which games, whether the tag shows) rather
 * than checking plan names, so a plan can change in one place.
 */

export type PlanId = "free" | "pro" | "creator";
export type Interval = "month" | "year";

export type Plan = {
  id: PlanId;
  name: string;
  /** in US dollars */
  price: Record<Interval, number>;
  line: string;
  /** Shorts made for you: a week's worth on free, a day's on paid plans */
  shorts: { per: "week" | "day"; count: number };
  games: GameId[];
  /** the "made with Hookline" line on videos and the live game */
  tag: boolean;
  /** posting for you at the best time, rather than downloading */
  scheduling: boolean;
  channels: number;
  /** changing the live game's gift prices */
  customMenus: boolean;
  /** where renders go in the queue */
  priority: number;
  features: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    price: { month: 0, year: 0 },
    line: "Try every part of it.",
    shorts: { per: "week", count: 3 },
    games: ["battle"],
    tag: true,
    scheduling: false,
    channels: 1,
    customMenus: false,
    priority: 0,
    features: ["3 Shorts a week", "The live Ball Battle", "Trends and Earnings", "A small “made with Hookline” tag"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: { month: 19, year: 190 },
    line: "For posting every day.",
    shorts: { per: "day", count: 3 },
    games: ["battle", "race", "royale", "rivals"],
    tag: false,
    scheduling: true,
    channels: 1,
    customMenus: false,
    priority: 1,
    features: ["3 Shorts a day", "Posts them for you at your best times", "Every live game", "No tag"],
  },
  creator: {
    id: "creator",
    name: "Creator",
    price: { month: 49, year: 490 },
    line: "For more than one channel.",
    shorts: { per: "day", count: 5 },
    games: ["battle", "race", "royale", "rivals"],
    tag: false,
    scheduling: true,
    channels: 5,
    customMenus: true,
    priority: 2,
    features: ["5 Shorts a day per channel", "Up to 5 channels", "Your own live gift prices", "Renders first in line"],
  },
};

export const PAID: PlanId[] = ["pro", "creator"];

/** A year's price as months saved: two months free. */
export function yearSaving(p: Plan): number {
  return p.price.month * 12 - p.price.year;
}

/**
 * What paying accounts bring in a month at list price: a yearly plan
 * counts as a twelfth of its price. Trials haven't paid yet; a card
 * Stripe is retrying still counts until the plan ends.
 */
export function monthlyRevenue(subs: { plan: PlanId; interval: Interval | null; status: string }[]): number {
  return subs.reduce((sum, s) => {
    if (s.plan === "free" || !(s.status === "active" || s.status === "past_due")) return sum;
    const price = PLANS[s.plan].price;
    return sum + (s.interval === "year" ? price.year / 12 : price.month);
  }, 0);
}
