"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app/settings", label: "Account" },
  { href: "/app/settings/billing", label: "Plan & billing" },
];

/** The two halves of Settings. */
export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="mb-8 flex gap-1 border-b-2 border-edge">
      {TABS.map((t) => {
        const on = path === t.href;
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={`-mb-[2px] border-b-2 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] ${on ? "border-signal text-fg" : "border-transparent text-muted hover:text-fg"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
