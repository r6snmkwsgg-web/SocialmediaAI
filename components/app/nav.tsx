"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "./icons";

/**
 * The app's sections: a sidebar on wide screens, a tab bar along the
 * bottom on phones. The current section is marked in both.
 */

export const SECTIONS = [
  { href: "/app", label: "Home", icon: Icons.home },
  { href: "/app/shorts", label: "Shorts", icon: Icons.shorts },
  { href: "/app/live", label: "Live", icon: Icons.live },
  { href: "/app/trends", label: "Trends", icon: Icons.trends },
  { href: "/app/earnings", label: "Earnings", icon: Icons.earnings },
] as const;

function isOn(path: string, href: string) {
  return href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`);
}

export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Sections" className="flex flex-col gap-1">
      {[...SECTIONS, { href: "/app/settings", label: "Settings", icon: Icons.settings }].map((s) => {
        const on = isOn(path, s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 font-display text-lg uppercase tracking-wide transition ${on ? "bg-fg text-surface" : "text-fg/75 hover:bg-card-2 hover:text-fg"}`}
          >
            <s.icon className="h-5 w-5 shrink-0" />
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function TabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t-2 border-edge bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      {SECTIONS.map((s) => {
        const on = isOn(path, s.href);
        return (
          <Link key={s.href} href={s.href} aria-current={on ? "page" : undefined} className={`flex flex-col items-center gap-1 py-2.5 font-mono text-[9px] uppercase tracking-[0.12em] ${on ? "text-signal" : "text-muted"}`}>
            <s.icon className="h-5 w-5" />
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The current section's name, for the top bar on phones. */
export function SectionName() {
  const path = usePathname();
  const s = [...SECTIONS].reverse().find((x) => isOn(path, x.href));
  return <span>{path.startsWith("/app/settings") ? "Settings" : (s?.label ?? "Hookline")}</span>;
}
