import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: { default: "Hookline", template: "%s · Hookline" },
  robots: { index: false },
};

/** Everything signed in: the app's own light or dark surfaces, as the account picked. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const theme = (await cookies()).get("hl_theme")?.value;
  return (
    <div className="app min-h-dvh" data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      {children}
    </div>
  );
}
