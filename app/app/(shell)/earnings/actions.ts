"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { asUser } from "@/lib/server/db";
import { connectStripe, disconnectStripe } from "@/lib/server/earnings";

/** what a goal can be set on: the Earnings series ids, and how each is stored */
const TARGETS: Record<string, { source: string; metric: string; noun: string }> = {
  "youtube:views": { source: "youtube", metric: "views", noun: "YouTube views" },
  "youtube:subscribers": { source: "youtube", metric: "subscribers", noun: "new subscribers" },
  "youtube:engaged_views": { source: "youtube", metric: "engaged_views", noun: "engaged views on YouTube" },
  "youtube:revenue": { source: "youtube", metric: "revenue", noun: "in YouTube revenue" },
  "tiktok:views": { source: "tiktok", metric: "views_total", noun: "TikTok views" },
  "live:coins": { source: "live", metric: "coins", noun: "gift coins seen on your LIVEs" },
};

const goal = z.object({
  series: z.string().min(1),
  target: z.coerce.number().positive().max(1e12),
  period: z.enum(["month", "all"]),
});

export async function addGoal(form: FormData) {
  const me = await requireUser();
  const g = goal.safeParse({ series: form.get("series"), target: form.get("target"), period: form.get("period") });
  if (!g.success) redirect("/app/earnings?error=goal");
  const t = g.data.series.startsWith("stripe:revenue:")
    ? { source: "stripe", metric: g.data.series.slice("stripe:".length), noun: `in Stripe sales (${g.data.series.split(":")[2].toUpperCase()})` }
    : TARGETS[g.data.series];
  if (!t) redirect("/app/earnings?error=goal");
  const money = t.metric.startsWith("revenue");
  const amount = money ? g.data.target.toLocaleString("en-US", { maximumFractionDigits: 2 }) : Math.round(g.data.target).toLocaleString("en-US");
  const label = `${money && !t.noun.includes("Stripe") ? "$" : ""}${amount} ${t.noun} ${g.data.period === "month" ? "this month" : "in all"}`;
  await asUser(me.id, (tx) => tx`
    insert into public.goals (user_id, source, metric, target, period, label) values (${me.id}, ${t.source}, ${t.metric}, ${g.data.target}, ${g.data.period}, ${label})`);
  revalidatePath("/app/earnings");
  revalidatePath("/app");
  redirect("/app/earnings");
}

export async function removeGoal(form: FormData) {
  const me = await requireUser();
  const id = z.uuid().safeParse(form.get("id"));
  if (id.success) await asUser(me.id, (tx) => tx`delete from public.goals where id = ${id.data}`);
  revalidatePath("/app/earnings");
}

export async function stripeConnect(form: FormData) {
  const me = await requireUser();
  const r = await connectStripe(me.id, String(form.get("key") ?? "").trim());
  revalidatePath("/app/earnings");
  redirect(r.ok ? "/app/earnings?stripe=1" : `/app/earnings?error=stripe-${r.reason}`);
}

export async function stripeDisconnect() {
  const me = await requireUser();
  await disconnectStripe(me.id);
  revalidatePath("/app/earnings");
}
