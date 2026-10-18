"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "@/components/app/icons";

const TABS = [
  { href: "/app/shorts", label: "Queue", icon: Icons.shorts },
  { href: "/app/shorts/calendar", label: "Calendar", icon: Icons.calendar },
  { href: "/app/shorts/library", label: "Library", icon: Icons.grid },
];

/** A channel's Ball League: its table and its matches. */
const LEAGUE = { href: "/app/shorts/league", label: "League", icon: Icons.table };

/**
 * Shorts' views: what's waiting, when things post, and everything so far,
 * and with a channel in the Ball League (`league`), its table. A single
 * Short's page has its own way back.
 */
export function ShortsTabs({ league = false }: { league?: boolean }) {
  const path = usePathname();
  // the league's page keeps its tab even once nothing's in the league, so its seasons can still be looked back on
  const tabs = league || path === LEAGUE.href ? [...TABS, LEAGUE] : TABS;
  if (!tabs.some((t) => t.href === path)) return null;
  return (
    <nav aria-label="Shorts" className="mb-8 flex gap-1 overflow-x-auto border-b-2 border-edge">
      {tabs.map((t) => {
        const on = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`-mb-[2px] flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] ${on ? "border-signal text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {/* four tabs fit a phone without their icons */}
            <t.icon className={`h-4 w-4 ${tabs.length > 3 ? "hidden sm:block" : ""}`} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
