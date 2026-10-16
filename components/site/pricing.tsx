"use client";
import Link from "next/link";
import { useState } from "react";
import { PLANS, yearSaving, type Interval, type Plan } from "@/lib/billing/plans";

/** The plans, monthly or yearly, as the app sells them. */
export function Pricing() {
  const [interval, setInterval] = useState<Interval>("month");
  return (
    <div>
      <div role="group" aria-label="Billing period" className="mb-8 inline-flex border-2 border-ink">
        {(["month", "year"] as const).map((i) => (
          <button key={i} type="button" aria-pressed={interval === i} onClick={() => setInterval(i)} className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] ${interval === i ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"}`}>
            {i === "month" ? "Monthly" : "Yearly · 2 months free"}
          </button>
        ))}
      </div>
      <ul className="grid gap-5 md:grid-cols-3">
        {(Object.values(PLANS) as Plan[]).map((p) => {
          const dark = p.id === "pro";
          return (
            <li key={p.id} className={`flex flex-col gap-6 p-7 sm:p-8 ${dark ? "bg-ink text-paper" : "border-2 border-ink"}`}>
              <div>
                <h3 className="font-display text-4xl uppercase">{p.name}</h3>
                <p className={`mt-1 text-[15px] ${dark ? "text-paper/70" : "text-ink/65"}`}>{p.line}</p>
              </div>
              <p className="flex items-baseline gap-2">
                <span className="font-display text-6xl leading-none">${p.price[interval]}</span>
                <span className={`font-mono text-[11px] uppercase tracking-[0.14em] ${dark ? "text-dim" : "text-ink/55"}`}>{p.id === "free" ? "forever" : `/ ${interval}`}</span>
              </p>
              {p.id !== "free" && interval === "year" && <p className={`-mt-4 text-[13px] ${dark ? "text-paper/60" : "text-ink/60"}`}>${yearSaving(p)} less than paying monthly</p>}
              <ul className="flex flex-1 flex-col gap-3 text-[15px]">
                {p.features.map((f) => (
                  <li key={f} className={`flex gap-3 border-t pt-3 ${dark ? "border-line" : "border-rule"}`}>
                    <span className="font-mono text-signal">+</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/login" className={`press w-fit px-6 py-3 font-display text-xl uppercase tracking-wider ${dark ? "bg-signal text-ink [--press:var(--color-paper)]" : "bg-ink text-paper [--press:var(--color-signal)]"}`}>
                {p.id === "free" ? "Start free" : `Start with ${p.name}`}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 max-w-2xl text-[14px] leading-relaxed text-ink/65">
        Prices in US dollars. Everyone starts on Free; upgrade inside the app when it&rsquo;s worth it. Cancel any time and keep your plan to the end of what you paid for. The LIVE games run on TikTok gifts, which TikTok only allows from 18, usually with about 1,000 followers, and they need a computer to go LIVE from.
      </p>
    </div>
  );
}
