import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { button } from "@/components/app/ui";
import { requireUser } from "@/lib/server/auth";
import { isAdmin } from "@/lib/server/env";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Hookline admin" }, robots: { index: false } };

/** For whoever runs Hookline (ADMIN_EMAILS). Anyone else gets the ordinary "not here" page, so it doesn't even show it exists. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  if (!isAdmin(me.email)) notFound();
  const t = (await cookies()).get("hl_theme")?.value;
  return (
    <div className="app min-h-dvh" data-theme={t === "light" || t === "dark" ? t : undefined}>
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b-2 border-edge bg-surface px-4 sm:px-8">
        <Link href="/admin" className="flex items-center gap-3 text-[24px] leading-none" aria-label="Admin home">
          <Wordmark />
          <span className="border border-signal px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-signal">Admin</span>
        </Link>
        <Link href="/app" className={button.quiet}>Back to the app</Link>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:py-10">{children}</main>
    </div>
  );
}
