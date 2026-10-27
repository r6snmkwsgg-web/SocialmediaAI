import "server-only";
import { cache } from "react";
import type { Goal } from "../app/checklist";
import { PLANS, type Plan } from "../billing/plans";
import { parseLiveCheck, parseYtLiveCheck, type LiveCheck, type YtLiveCheck } from "../live/eligibility";
import { requireUser, type User } from "./auth";
import { billingFor, type Billing } from "./billing";
import { asUser } from "./db";

/**
 * The signed-in account, loaded once per request: who they are, what they
 * picked at onboarding, and what their plan lets them do. Every screen in
 * the app starts here.
 */

export type { Goal };

/**
 * `liveCheck` is their answers to "can you earn gifts on a TikTok LIVE?", and `ytLiveCheck` to "can you get Super Chats on
 * YouTube Live?", each null until asked
 */
export type Profile = { name: string | null; goal: Goal | null; timezone: string; onboardedAt: Date | null; liveCheck: LiveCheck | null; ytLiveCheck: YtLiveCheck | null; termsVersion: string | null };

export type Account = User & { profile: Profile; billing: Billing; plan: Plan };

export const account = cache(async (): Promise<Account> => {
  const user = await requireUser();
  const [profile, billing] = await Promise.all([profileOf(user.id), billingFor(user.id)]);
  return { ...user, profile, billing, plan: billing.plan ?? PLANS.free };
});

async function profileOf(userId: string): Promise<Profile> {
  const rows = await asUser(userId, (tx) => tx<{ name: string | null; goal: Goal | null; timezone: string; onboarded_at: Date | null; live_check: unknown; yt_live_check: unknown; terms_version: string | null }[]>`
    select name, goal, timezone, onboarded_at, live_check, yt_live_check, terms_version from public.profiles where id = ${userId}`);
  const r = rows[0];
  return {
    name: r?.name ?? null,
    goal: r?.goal ?? null,
    timezone: r?.timezone ?? "UTC",
    onboardedAt: r?.onboarded_at ?? null,
    liveCheck: parseLiveCheck(r?.live_check),
    ytLiveCheck: parseYtLiveCheck(r?.yt_live_check),
    termsVersion: r?.terms_version ?? null,
  };
}
