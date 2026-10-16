import "server-only";
import Stripe from "stripe";
import { PLANS, type Interval, type Plan, type PlanId } from "../billing/plans";
import { HANDLED, planNote, subscriptionRow, type PriceMap } from "../billing/webhook";
import { admin, asUser } from "./db";
import { configured, env } from "./env";
import { notify } from "./notify";

/**
 * Stripe: checkout, the billing portal, and the webhook that keeps each
 * account's plan in step with what it pays for. Plans are read from the
 * database, which only the webhook writes.
 */

let client: Stripe | null = null;

export function stripe(): Stripe {
  const k = env().STRIPE_SECRET_KEY;
  if (!k) throw new Error("Stripe isn't set up.");
  if (!client) client = new Stripe(k);
  return client;
}

/** The price IDs in the environment, and which plan each one is. */
export function prices(): PriceMap {
  const e = env();
  const out: PriceMap = {};
  const add = (id: string | undefined, plan: PlanId, interval: Interval) => {
    if (id) out[id] = { plan, interval };
  };
  add(e.STRIPE_PRICE_PRO_MONTH, "pro", "month");
  add(e.STRIPE_PRICE_PRO_YEAR, "pro", "year");
  add(e.STRIPE_PRICE_CREATOR_MONTH, "creator", "month");
  add(e.STRIPE_PRICE_CREATOR_YEAR, "creator", "year");
  return out;
}

export function priceFor(plan: PlanId, interval: Interval): string | undefined {
  return Object.entries(prices()).find(([, v]) => v.plan === plan && v.interval === interval)?.[0];
}

export type Billing = {
  plan: Plan;
  interval: Interval | null;
  status: string;
  renews: Date | null;
  cancelling: boolean;
  customer: string | null;
};

/** What an account is on right now. No row means free. */
export async function billingFor(userId: string): Promise<Billing> {
  const rows = await asUser(userId, (tx) => tx<{ plan: PlanId; interval: Interval | null; status: string; current_period_end: Date | null; cancel_at_period_end: boolean; stripe_customer_id: string | null }[]>`
    select plan, "interval", status, current_period_end, cancel_at_period_end, stripe_customer_id from public.subscriptions where user_id = ${userId}`);
  const r = rows[0];
  return {
    plan: PLANS[r?.plan ?? "free"],
    interval: r?.interval ?? null,
    status: r?.status ?? "none",
    renews: r?.current_period_end ?? null,
    cancelling: r?.cancel_at_period_end ?? false,
    customer: r?.stripe_customer_id ?? null,
  };
}

/** A Stripe Checkout page for a plan; the account's Stripe customer is made once and reused. */
export async function checkoutUrl(user: { id: string; email: string }, plan: PlanId, interval: Interval, origin: string): Promise<string> {
  const price = priceFor(plan, interval);
  if (!price) throw new Error("That plan isn't set up in Stripe yet.");
  const s = stripe();
  let customer = (await billingFor(user.id)).customer;
  if (!customer) {
    customer = (await s.customers.create({ email: user.email, metadata: { user_id: user.id } })).id;
    await admin((tx) => tx`
      insert into public.subscriptions (user_id, stripe_customer_id) values (${user.id}, ${customer})
      on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id, updated_at = now()`);
  }
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id } },
    allow_promotion_codes: true,
    success_url: `${origin}/app/settings/billing?done=1`,
    cancel_url: `${origin}/app/settings/billing`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout page.");
  return session.url;
}

/** Stripe's own page for changing a card, switching plans or cancelling. */
export async function portalUrl(userId: string, origin: string): Promise<string> {
  const customer = (await billingFor(userId)).customer;
  if (!customer) throw new Error("There's no billing to manage yet.");
  const p = await stripe().billingPortal.sessions.create({ customer, return_url: `${origin}/app/settings/billing` });
  return p.url;
}

/**
 * One event from Stripe: verified, handled once, and turned into the
 * account's plan. Returns what it did, for the log.
 */
export async function handleWebhook(body: string, signature: string): Promise<string> {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET isn't set.");
  const s = stripe();
  const event = s.webhooks.constructEvent(body, signature, secret);
  if (!HANDLED.has(event.type)) return `ignored ${event.type}`;

  const fresh = await admin((tx) => tx`insert into public.stripe_events (id, type) values (${event.id}, ${event.type}) on conflict do nothing returning id`);
  if (fresh.length === 0) return `already handled ${event.id}`;

  let sub: Stripe.Subscription;
  let userId: string | null;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!session.subscription) return "checkout without a subscription";
    sub = await s.subscriptions.retrieve(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
    userId = session.client_reference_id ?? sub.metadata?.user_id ?? null;
  } else {
    sub = event.data.object as Stripe.Subscription;
    userId = sub.metadata?.user_id ?? null;
  }
  const row = subscriptionRow(sub, prices());
  // no user on the subscription: find them by their Stripe customer
  if (!userId) {
    const found = await admin((tx) => tx<{ user_id: string }[]>`select user_id from public.subscriptions where stripe_customer_id = ${row.stripe_customer_id}`);
    userId = found[0]?.user_id ?? null;
  }
  if (!userId) return `no account for customer ${row.stripe_customer_id}`;
  await admin((tx) => tx`
    insert into public.subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, "interval", status, current_period_end, cancel_at_period_end, updated_at)
    values (${userId}, ${row.stripe_customer_id}, ${row.stripe_subscription_id}, ${row.plan}, ${row.interval}, ${row.status}, ${row.current_period_end}, ${row.cancel_at_period_end}, now())
    on conflict (user_id) do update set
      stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
      plan = excluded.plan, "interval" = excluded."interval", status = excluded.status,
      current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end, updated_at = now()`);
  const note = planNote(row, configured().youtubeAudited);
  if (note) await notify(userId, { ...note, href: "/app/settings/billing" });
  return `${userId} is on ${row.plan} (${row.status})`;
}
