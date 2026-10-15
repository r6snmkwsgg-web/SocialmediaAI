"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { checkoutUrl, portalUrl } from "@/lib/server/billing";
import { configured } from "@/lib/server/env";
import { origin } from "@/lib/server/http";

const choice = z.object({ plan: z.enum(["pro", "creator"]), interval: z.enum(["month", "year"]) });

/** Off to Stripe Checkout for a plan; the webhook switches the plan once it's paid. */
export async function checkout(form: FormData) {
  const me = await requireUser();
  const c = choice.safeParse({ plan: form.get("plan"), interval: form.get("interval") });
  if (!c.success) redirect("/app/settings/billing");
  if (!configured().stripe) redirect("/app/settings/billing?error=setup");
  let url: string;
  try {
    url = await checkoutUrl(me, c.data.plan, c.data.interval, await origin());
  } catch (err) {
    console.error("checkout:", err instanceof Error ? err.message : err);
    redirect("/app/settings/billing?error=checkout");
  }
  redirect(url);
}

/** Stripe's billing portal: cards, invoices, switching plans and cancelling. */
export async function manage() {
  const me = await requireUser();
  if (!configured().stripe) redirect("/app/settings/billing?error=setup");
  let url: string;
  try {
    url = await portalUrl(me.id, await origin());
  } catch (err) {
    console.error("portal:", err instanceof Error ? err.message : err);
    redirect("/app/settings/billing?error=portal");
  }
  redirect(url);
}
