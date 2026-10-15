import "server-only";
import { cache } from "react";
import type { Goal } from "../app/checklist";
import { PLANS, type Plan } from "../billing/plans";
import { requireUser, type User } from "./auth";
import { billingFor, type Billing } from "./billing";
import { asUser } from "./db";

/**
 * The signed-in account, loaded once per request: who they are, what they
 * picked at onboarding, and what their plan lets them do. Every screen in
 * the app starts here.
 */

export type { Goal };

export type Profile = { name: string | null; goal: Goal | null; timezone: string; onboardedAt: Date | null };

export type Account = User & { profile: Profile; billing: Billing; plan: Plan };

export const account = cache(async (): Promise<Account> => {
  const user = await requireUser();
  const [profile, billing] = await Promise.all([profileOf(user.id), billingFor(user.id)]);
  return { ...user, profile, billing, plan: billing.plan ?? PLANS.free };
});

async function profileOf(userId: string): Promise<Profile> {
  const rows = await asUser(userId, (tx) => tx<{ name: string | null; goal: Goal | null; timezone: string; onboarded_at: Date | null }[]>`
    select name, goal, timezone, onboarded_at from public.profiles where id = ${userId}`);
  const r = rows[0];
  return { name: r?.name ?? null, goal: r?.goal ?? null, timezone: r?.timezone ?? "UTC", onboardedAt: r?.onboarded_at ?? null };
}
