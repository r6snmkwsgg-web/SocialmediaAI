import { describe, expect, it } from "vitest";
import { checklist, nextStep, type Facts } from "@/lib/app/checklist";
import { score } from "@/lib/app/search";
import { monthlyRevenue, PLANS, yearSaving } from "@/lib/billing/plans";
import { HANDLED, planNote, subscriptionRow, type PriceMap, type SubLike } from "@/lib/billing/webhook";

const prices: PriceMap = {
  price_pro_m: { plan: "pro", interval: "month" },
  price_pro_y: { plan: "pro", interval: "year" },
  price_cr_m: { plan: "creator", interval: "month" },
};

function sub(over: Partial<SubLike> & { price?: string; end?: number } = {}): SubLike {
  const { price = "price_pro_m", end = 1_800_000_000, ...rest } = over;
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    items: { data: [{ price: { id: price }, current_period_end: end }] },
    ...rest,
  };
}

describe("plans", () => {
  it("a year is two months free", () => {
    expect(yearSaving(PLANS.pro)).toBe(PLANS.pro.price.month * 2);
    expect(yearSaving(PLANS.creator)).toBe(PLANS.creator.price.month * 2);
  });

  it("free gets the battle with the tag; paid plans get every game without it", () => {
    expect(PLANS.free.games).toEqual(["battle"]);
    expect(PLANS.free.tag).toBe(true);
    for (const p of [PLANS.pro, PLANS.creator]) {
      expect(p.games).toEqual(["battle", "race", "royale", "rivals"]);
      expect(p.tag).toBe(false);
      expect(p.scheduling).toBe(true);
    }
    expect(PLANS.creator.customMenus).toBe(true);
    expect(PLANS.pro.customMenus).toBe(false);
  });
});

describe("monthly revenue at list price", () => {
  it("counts monthly plans whole and yearly ones as a twelfth, only while they're paying", () => {
    expect(
      monthlyRevenue([
        { plan: "pro", interval: "month", status: "active" },
        { plan: "creator", interval: "year", status: "active" },
        { plan: "pro", interval: "month", status: "past_due" },
        { plan: "pro", interval: "month", status: "trialing" },
        { plan: "creator", interval: "month", status: "canceled" },
        { plan: "free", interval: null, status: "none" },
      ]),
    ).toBeCloseTo(PLANS.pro.price.month * 2 + PLANS.creator.price.year / 12);
  });
});

describe("what a Stripe subscription means", () => {
  it("an active subscription to a known price gets that plan", () => {
    const r = subscriptionRow(sub(), prices);
    expect(r).toMatchObject({ plan: "pro", interval: "month", status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", cancel_at_period_end: false });
    expect(r.current_period_end?.toISOString()).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it("trialing and a failed card still keep the plan while Stripe retries", () => {
    expect(subscriptionRow(sub({ status: "trialing" }), prices).plan).toBe("pro");
    expect(subscriptionRow(sub({ status: "past_due" }), prices).plan).toBe("pro");
  });

  it("cancelled, unpaid or unfinished subscriptions drop to free", () => {
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      expect(subscriptionRow(sub({ status }), prices).plan).toBe("free");
    }
  });

  it("a price that isn't one of ours never grants a plan", () => {
    const r = subscriptionRow(sub({ price: "price_someone_else" }), prices);
    expect(r.plan).toBe("free");
    expect(r.interval).toBeNull();
  });

  it("reads the customer whether Stripe sends an id or the whole customer", () => {
    expect(subscriptionRow(sub({ customer: { id: "cus_obj" } }), prices).stripe_customer_id).toBe("cus_obj");
  });

  it("knows a cancellation at the end of the period, and the yearly interval", () => {
    const r = subscriptionRow(sub({ price: "price_pro_y", cancel_at_period_end: true }), prices);
    expect(r).toMatchObject({ plan: "pro", interval: "year", cancel_at_period_end: true });
  });

  it("only listens for the events that change a subscription", () => {
    expect(HANDLED.has("customer.subscription.updated")).toBe(true);
    expect(HANDLED.has("invoice.paid")).toBe(false);
  });
});

describe("what someone's told when their plan changes", () => {
  const note = (over: Parameters<typeof sub>[0]) => planNote(subscriptionRow(sub(over), prices));

  it("says the plan they're on, once per state, so a renewal says nothing new", () => {
    expect(note({})).toMatchObject({ kind: "plan", title: "You're on Pro" });
    expect(note({})?.key).toBe(note({ end: 1_900_000_000 })?.key);
    expect(note({ price: "price_cr_m" })?.title).toBe("You're on Creator");
  });

  it("warns about a failed card, and says when a plan won't renew or has ended", () => {
    expect(note({ status: "past_due" })).toMatchObject({ kind: "account", title: "Your payment didn't go through" });
    expect(note({ cancel_at_period_end: true })?.title).toBe("Pro won't renew");
    expect(note({ status: "canceled" })?.title).toBe("You're on Free now");
  });

  it("says nothing about a checkout that never finished", () => {
    expect(note({ status: "incomplete" })).toBeNull();
    expect(note({ status: "incomplete_expired" })).toBeNull();
  });

  it("only promises Shorts post themselves once Hookline posts them", () => {
    expect(note({})?.body).not.toMatch(/post themselves/);
    expect(planNote(subscriptionRow(sub({}), prices), true)?.body).toBe("Your Shorts now post themselves at your best times.");
  });
});

describe("Home's setup list", () => {
  const none: Facts = { youtube: false, swiped: false, posted: false, liveSetUp: false, wentLive: false, goal: false };

  it("puts what they came for first", () => {
    expect(checklist("shorts", none)[0].id).toBe("youtube");
    expect(checklist("live", none)[0].id).toBe("liveSetUp");
    expect(checklist(null, none)).toHaveLength(6);
  });

  it("only says Shorts post themselves where Hookline posts them", () => {
    const youtube = (posts: boolean) => checklist("shorts", none, posts).find((s) => s.id === "youtube")!.body;
    expect(youtube(true)).toBe("So the Shorts you approve can post themselves.");
    expect(youtube(false)).toBe("So Hookline can check the Shorts you post and read their views.");
    expect(checklist("shorts", none, false).find((s) => s.id === "posted")!.body).toMatch(/I posted it/);
  });

  it("the next step is the first one not done, from real data", () => {
    const steps = checklist("live", { ...none, liveSetUp: true });
    expect(steps[0].done).toBe(true);
    expect(nextStep(steps)?.id).toBe("wentLive");
    expect(nextStep(checklist("both", { youtube: true, swiped: true, posted: true, liveSetUp: true, wentLive: true, goal: true }))).toBeNull();
  });
});

describe("the command palette's search", () => {
  const earnings = { label: "Earnings", words: "money revenue stripe goals views" };
  const live = { label: "Live: your game", words: "tiktok live game gifts obs overlay stream" };

  it("finds a command by its name or the other words people use for it", () => {
    expect(score(earnings, "earn")).toBeGreaterThan(0);
    expect(score(earnings, "money")).toBeGreaterThan(0);
    expect(score(live, "obs")).toBeGreaterThan(0);
    expect(score(live, "money")).toBe(0);
  });

  it("needs every word typed, and ranks a hit in the name above one in the other words", () => {
    expect(score(live, "tiktok gifts")).toBeGreaterThan(0);
    expect(score(live, "tiktok money")).toBe(0);
    expect(score(live, "live")).toBeGreaterThan(score(earnings, "views"));
  });

  it("shows everything when nothing's typed", () => {
    expect(score(earnings, "  ")).toBe(1);
  });
});
