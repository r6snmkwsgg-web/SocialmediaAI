import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, PageHead, Pill, Stat } from "@/components/app/ui";
import { RecapCard } from "@/components/live/recap-card";
import { GAMES } from "@/lib/live/games";
import { NO_USERNAMES, whyNotCounted } from "@/lib/live/proof";
import { lasted, over } from "@/lib/live/session";
import { TOP_SHOWN } from "@/lib/live/supporters";
import { account } from "@/lib/server/account";
import { configured } from "@/lib/server/env";
import { liveSettingsOf, sessionOf, tiktokUsernamesOf, type LiveSession } from "@/lib/server/live";

export const metadata: Metadata = { title: "LIVE" };

const n = (v: number) => v.toLocaleString("en-US");
const at = (users: string[]) => users.map((u) => `@${u}`).join(", ");

/** Why a LIVE has no recap card yet, or ever; null when it has one. */
function noCard(s: LiveSession): string | null {
  if (!s.verified) return "This LIVE isn't verified as yours, so it gets no recap card. A card could show someone else's numbers as yours.";
  if (!over(s.lastAt)) return "Your recap card is ready 20 minutes after the LIVE goes quiet.";
  return null;
}

/**
 * One LIVE on its own: its numbers, whose LIVE it was, its top gifters
 * (shown to the streamer only), and once a LIVE verified as theirs is
 * over, a recap card to post.
 */
export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await account();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const s = await sessionOf(me.id, id);
  if (!s) notFound();

  const [{ settings }, accounts] = await Promise.all([liveSettingsOf(me.id), tiktokUsernamesOf(me.id)]);
  const checking = configured().tiktokProfile;
  const game = GAMES.find((g) => g.id === s.game)?.name ?? s.game;
  const why = noCard(s);
  const card = why === null && {
    username: s.heard[0] ?? null,
    game,
    rounds: s.rounds,
    peakPlayers: s.peakPlayers,
    coins: s.coins,
    // names and coins only: the card has no use for anyone's TikTok id
    top: s.topGifters.filter((g) => g.coins > 0).slice(0, TOP_SHOWN).map((g) => ({ name: g.name, coins: g.coins })),
  };

  return (
    <>
      <PageHead
        eyebrow="Live"
        title={game}
        line={<><LocalTime iso={s.startedAt.toISOString()} /> · {lasted(s)}</>}
        action={<Link href="/app/live#lives" className={button.secondary}>All your LIVEs</Link>}
      />

      <div className={card ? "grid items-start gap-8 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)] xl:gap-12" : ""}>
        {card && (
          <section aria-label="Recap card" className="xl:sticky xl:top-24">
            <RecapCard data={card} startedAt={s.startedAt.toISOString()} tag={me.plan.tag} hideNames={settings.hideNames} />
          </section>
        )}

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHead title="Numbers" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Real viewers only</span>} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-5 py-5 sm:grid-cols-4">
              <Stat label="Rounds" value={n(s.rounds)} />
              <Stat label="Most playing at once" value={n(s.peakPlayers)} />
              <Stat label="Gift coins seen" value={n(s.coins)} sub="What viewers sent, not what TikTok pays you" />
              <Stat label="Length" value={lasted(s)} />
            </div>
          </Card>

          <Card>
            <CardHead title="Whose LIVE" action={s.verified ? <Pill tone="good">Yours</Pill> : <Pill tone="warn">Not verified</Pill>} />
            <p className="px-5 py-4 text-[15px] leading-relaxed">
              {s.verified ? (
                <>The game heard {at(s.heard)} on Hookline Bridge from start to end.</>
              ) : (
                <>
                  {whyNotCounted(s, accounts, checking) ?? NO_USERNAMES} <span className="text-muted">Its gift coins seen don&rsquo;t count in Earnings.</span>
                </>
              )}
            </p>
          </Card>

          <Card>
            <CardHead title="Top gifters" />
            {s.topGifters.length ? (
              <ol className="flex flex-col divide-y divide-edge">
                {s.topGifters.map((g, i) => (
                  <li key={`${i}-${g.id}`} className="flex items-center gap-4 px-5 py-3 text-[15px]">
                    <span className="w-4 shrink-0 font-mono text-[12px] tabular-nums text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <span className="shrink-0 tabular-nums text-muted">{n(g.coins)} coins</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-5 py-4 text-[15px] text-muted">Nobody sent a gift.</p>
            )}
            <p className="border-t-2 border-edge px-5 py-3 text-[13px] leading-relaxed text-muted">Hookline keeps only a LIVE&rsquo;s top 5 gifters: their TikTok name, id and coins. They go when you delete your account.</p>
          </Card>

          {why && (
            <Card>
              <CardHead title="Recap card" />
              <p className="px-5 py-4 text-[15px] leading-relaxed text-muted">{why}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
