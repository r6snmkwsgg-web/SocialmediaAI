import { PLANS, type Interval, type PlanId } from "./plans";

/**
 * What a Stripe subscription means for an account, worked out without
 * touching Stripe or the database, so it can be tested on its own. The
 * webhook route feeds it Stripe's events and saves the row it returns.
 */

/** the parts of a Stripe subscription this reads */
export type SubLike = {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end: boolean;
  metadata?: Record<string, string> | null;
  items: { data: { price: { id: string; recurring?: { interval?: string } | null }; current_period_end?: number }[] };
};

export type PriceMap = Record<string, { plan: PlanId; interval: Interval }>;

export type SubRow = {
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan: PlanId;
  interval: Interval | null;
  status: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
};

/** Statuses that still get the plan's features: paid up, trialing, or retrying a failed card. */
const ACTIVE = new Set(["active", "trialing", "past_due"]);

export function subscriptionRow(sub: SubLike, prices: PriceMap): SubRow {
  const item = sub.items.data[0];
  const known = item ? prices[item.price.id] : undefined;
  const live = ACTIVE.has(sub.status);
  const end = item?.current_period_end;
  return {
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    plan: live && known ? known.plan : "free",
    interval: known?.interval ?? null,
    status: sub.status,
    current_period_end: end ? new Date(end * 1000) : null,
    cancel_at_period_end: sub.cancel_at_period_end,
  };
}

/** The events that change a subscription, and nothing else. */
export const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/**
 * What to tell someone when their subscription changes, or nothing. The
 * key names the state, so a renewal (same plan, same state) says nothing
 * and a new subscription after cancelling says it all again.
 */
export function planNote(row: SubRow): { kind: "plan" | "account"; title: string; body: string; key: string } | null {
  const key = `plan:${row.stripe_subscription_id}:${row.plan}:${row.status}:${row.cancel_at_period_end}`;
  const name = PLANS[row.plan].name;
  if (row.status === "past_due") return { kind: "account", title: "Your payment didn't go through", body: "Stripe will try your card again. Update it in Plan & billing to keep your plan.", key };
  if (row.plan === "free") {
    // only an ending says anything: a checkout that never finished was never a plan
    return row.status === "canceled" || row.status === "unpaid" ? { kind: "plan", title: "You're on Free now", body: "Your paid plan has ended. Pick one again any time in Plan & billing.", key } : null;
  }
  if (row.cancel_at_period_end) return { kind: "plan", title: `${name} won't renew`, body: "It stays on until the end of the time you've paid for.", key };
  if (row.status === "active" || row.status === "trialing") {
    return { kind: "plan", title: `You're on ${name}`, body: row.plan === "creator" ? "Up to five channels, your own LIVE gift menu, and first in line for rendering." : "Your Shorts now post themselves at your best times.", key };
  }
  return null;
}
