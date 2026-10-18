import { ShortsTabs } from "@/components/shorts/tabs";
import { requireUser } from "@/lib/server/auth";
import { inLeagueNow } from "@/lib/server/shorts/league";

/** Every Shorts screen, with the queue, calendar and library a tap apart, and a channel's Ball League once one is in it. */
export default async function ShortsLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  return (
    <>
      <ShortsTabs league={await inLeagueNow(me.id)} />
      {children}
    </>
  );
}
