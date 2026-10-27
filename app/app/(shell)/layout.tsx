import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Hook, Wordmark } from "@/components/brand";
import { AccountMenu } from "@/components/app/account-menu";
import { Bell } from "@/components/app/bell";
import { SectionName, SideNav, TabBar } from "@/components/app/nav";
import { toView } from "@/components/app/notes";
import { Palette, PaletteButton } from "@/components/app/palette";
import { Toaster } from "@/components/app/toast";
import { PLANS } from "@/lib/billing/plans";
import { TERMS_VERSION } from "@/lib/legal";
import { account } from "@/lib/server/account";
import { notificationsOf } from "@/lib/server/notify";
import { seenAll } from "./notifications/actions";

/**
 * The app around every section: the sections down the left on a wide
 * screen and along the bottom on a phone, and the account in the corner.
 */
export default async function Shell({ children }: { children: React.ReactNode }) {
  const me = await account();
  // set up, and agreed to the terms as they are now
  if (!me.profile.onboardedAt || me.profile.termsVersion !== TERMS_VERSION) redirect("/app/welcome");
  const t = (await cookies()).get("hl_theme")?.value;
  const theme = t === "light" || t === "dark" ? t : "system";
  const notes = await notificationsOf(me.id, { limit: 8 });

  return (
    <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:bg-signal focus:px-4 focus:py-2 focus:font-display focus:uppercase focus:text-ink">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-r-2 border-edge px-4 py-6 lg:flex">
        <Link href="/app" className="mb-8 px-3 text-[26px] leading-none" aria-label="Hookline home">
          <Wordmark />
        </Link>
        <SideNav />
        {me.plan.id === "free" && (
          <Link href="/app/settings/billing" className="mt-auto border-2 border-edge p-4 transition hover:border-fg">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Free plan</p>
            <p className="mt-1.5 font-display text-lg uppercase leading-tight">Post every day with Pro</p>
            <p className="mt-1 text-[13px] text-muted">
              ${PLANS.pro.price.month} a month. Cancel any time.
            </p>
          </Link>
        )}
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b-2 border-edge bg-surface px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-2.5 font-display text-2xl uppercase tracking-wide">
            <Link href="/app" className="text-signal lg:hidden" aria-label="Hookline home">
              <Hook className="h-7 w-auto" />
            </Link>
            <SectionName />
          </div>
          <div className="flex items-center gap-3">
            <PaletteButton />
            <Bell items={notes.items.map(toView)} unread={notes.unread} seen={seenAll} />
            <AccountMenu email={me.email} plan={me.plan.name} theme={theme} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-8 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
          {children}
        </main>
      </div>
      <TabBar />
      <Palette />
      <Toaster />
    </div>
  );
}
