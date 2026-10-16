import type { Metadata } from "next";
import Link from "next/link";
import { SettingsTabs } from "@/components/app/settings-tabs";
import { Icons } from "@/components/app/icons";
import { button, NotSetUp, PageHead, Pill } from "@/components/app/ui";
import { PLANS, yearSaving, type Interval, type Plan } from "@/lib/billing/plans";
import { giftsLine } from "@/lib/live/eligibility";
import { account } from "@/lib/server/account";
import { configured } from "@/lib/server/env";
import { checkout, manage } from "./actions";

export const metadata: Metadata = { title: "Plan & billing" };

const ERRORS: Record<string, string> = {
  setup: "Payments aren't set up on this Hookline yet.",
  checkout: "Stripe couldn't open the checkout page. Try again in a minute.",
  portal: "Stripe couldn't open the billing page. Try again in a minute.",
};

const STATUS: Record<string, { label: string; tone: "good" | "warn" | "signal" | "plain" }> = {
  active: { label: "Active", tone: "good" },
  trialing: { label: "Trial", tone: "good" },
  past_due: { label: "Payment failed", tone: "warn" },
  unpaid: { label: "Unpaid", tone: "signal" },
  canceled: { label: "Cancelled", tone: "plain" },
  incomplete: { label: "Not finished", tone: "warn" },
  incomplete_expired: { label: "Expired", tone: "plain" },
};

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Billing({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const interval: Interval = q.interval === "year" || q.interval === "month" ? q.interval : (me.billing.interval ?? "month");
  const ready = configured().stripe;
  const b = me.billing;
  const paid = me.plan.id !== "free";
  const error = typeof q.error === "string" ? ERRORS[q.error] : undefined;
  const status = STATUS[b.status];

  return (
    <>
      <PageHead eyebrow="Settings" title="Plan & billing" />
      <SettingsTabs />

      {q.done === "1" && (
        <p role="status" className="mb-6 flex items-start gap-3 border-2 border-fg bg-card px-4 py-3 text-[15px]">
          <Icons.check className="mt-0.5 h-5 w-5 shrink-0 text-signal" />
          {paid ? `You're on ${me.plan.name}. Everything it includes is on now.` : "Payment received. Your plan switches over as soon as Stripe confirms it, usually within a few seconds. Refresh in a moment."}
        </p>
      )}
      {error && <p role="alert" className="mb-6 border-2 border-signal px-4 py-3 text-[15px]">{error}</p>}
      {!ready && <div className="mb-6"><NotSetUp what="Payments" keys={["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO_MONTH", "STRIPE_PRICE_PRO_YEAR", "STRIPE_PRICE_CREATOR_MONTH", "STRIPE_PRICE_CREATOR_YEAR"]} /></div>}

      <section aria-labelledby="now" className="mb-10 flex flex-col gap-5 border-2 border-edge bg-card px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <p id="now" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Your plan</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display text-4xl uppercase leading-none">{me.plan.name}</span>
            {paid && status && <Pill tone={status.tone}>{status.label}</Pill>}
          </div>
          <p className="text-[14px] text-muted">
            {!paid
              ? "Free for as long as you like."
              : b.status === "past_due"
                ? "Your last payment didn't go through. Stripe will try again; update your card so you keep your plan."
                : b.renews
                  ? b.cancelling
                    ? `Ends on ${day(b.renews)}. You keep everything until then.`
                    : `$${me.plan.price[b.interval ?? "month"]} a ${b.interval ?? "month"}. Renews on ${day(b.renews)}.`
                  : `$${me.plan.price[b.interval ?? "month"]} a ${b.interval ?? "month"}.`}
          </p>
        </div>
        {b.customer && ready && (
          <form action={manage}>
            <button type="submit" className={b.status === "past_due" ? button.primary : button.secondary}>
              {b.status === "past_due" ? "Update card" : "Manage billing"}
            </button>
          </form>
        )}
      </section>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-2xl uppercase tracking-wide">Plans</h2>
        <div role="group" aria-label="Billing period" className="flex border-2 border-fg">
          {(["month", "year"] as const).map((i) => (
            <Link
              key={i}
              href={`/app/settings/billing?interval=${i}`}
              scroll={false}
              aria-current={interval === i ? "true" : undefined}
              className={`px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] ${interval === i ? "bg-fg text-surface" : "text-muted hover:text-fg"}`}
            >
              {i === "month" ? "Monthly" : "Yearly · 2 months free"}
            </Link>
          ))}
        </div>
      </div>

      <ul className="grid gap-4 md:grid-cols-3">
        {(Object.values(PLANS) as Plan[]).map((p) => (
          <PlanCard key={p.id} plan={p} interval={interval} current={me.plan.id === p.id} onPaid={paid} ready={ready} hasCustomer={!!b.customer} />
        ))}
      </ul>
      <p className="mt-5 max-w-2xl text-[13px] leading-relaxed text-muted">
        Prices in US dollars. Cancel any time from Manage billing and keep your plan to the end of what you paid for. Hookline makes the videos and the games; what they earn depends on you, your niche and the platforms.
        {` ${giftsLine(me.profile.liveCheck)}`}
      </p>
    </>
  );
}

function PlanCard({ plan, interval, current, onPaid, ready, hasCustomer }: { plan: Plan; interval: Interval; current: boolean; onPaid: boolean; ready: boolean; hasCustomer: boolean }) {
  const free = plan.id === "free";
  const price = plan.price[interval];
  return (
    <li className={`flex flex-col gap-5 border-2 bg-card px-5 py-6 ${current ? "border-fg" : "border-edge"}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-3xl uppercase leading-none">{plan.name}</h3>
        {current && <Pill tone="signal">Your plan</Pill>}
      </div>
      <div>
        <p className="flex items-baseline gap-1.5">
          <span className="font-display text-5xl leading-none tabular-nums">${price}</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{free ? "forever" : `/ ${interval}`}</span>
        </p>
        <p className="mt-2 text-[14px] text-muted">
          {!free && interval === "year" ? `Saves $${yearSaving(plan)} a year. ` : ""}
          {plan.line}
        </p>
      </div>
      <ul className="flex flex-1 flex-col gap-2 text-[14px]">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2.5">
            <Icons.check className="mt-[3px] h-4 w-4 shrink-0 text-signal" />
            {f}
          </li>
        ))}
      </ul>
      {current ? (
        <p className="py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">You&rsquo;re on this plan</p>
      ) : free ? (
        onPaid && hasCustomer && ready ? (
          <form action={manage}><button type="submit" className={`${button.quiet} py-2`}>Cancel in billing</button></form>
        ) : null
      ) : onPaid && hasCustomer ? (
        <form action={manage}>
          <button type="submit" disabled={!ready} className={`${button.secondary} w-full`}>Switch to {plan.name}</button>
        </form>
      ) : (
        <form action={checkout}>
          <input type="hidden" name="plan" value={plan.id} />
          <input type="hidden" name="interval" value={interval} />
          <button type="submit" disabled={!ready} className={`${plan.id === "pro" ? button.primary : button.secondary} w-full`}>
            Get {plan.name}
          </button>
        </form>
      )}
    </li>
  );
}
