import type { Metadata } from "next";
import { LiveSettingsForm } from "@/components/app/live-settings";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, Empty, PageHead } from "@/components/app/ui";
import { Setup } from "@/components/live/setup";
import { ABILITIES } from "@/lib/battle/abilities";
import { GAMES } from "@/lib/live/games";
import { BATTLE_MENU } from "@/lib/live/games/battle";
import { RACE_MENU } from "@/lib/live/games/race";
import { ROYALE_MENU } from "@/lib/live/games/royale";
import { RIVAL_POWERS } from "@/lib/live/rivals";
import { allowedBy, LIVE_ABILITIES } from "@/lib/live/settings";
import { account } from "@/lib/server/account";
import { liveSettingsOf, overlayKeyOf, sessionsOf, type LiveSession } from "@/lib/server/live";
import { newKey, saveLive } from "./actions";

export const metadata: Metadata = { title: "Live" };

const menus = { battle: BATTLE_MENU, race: RACE_MENU, royale: ROYALE_MENU, rivals: RIVAL_POWERS };
const labels = Object.fromEntries(Object.entries(menus).map(([k, m]) => [k, m.map((t) => ({ name: t.name, line: t.line }))])) as Record<keyof typeof menus, { name: string; line: string }[]>;

const n = (v: number) => v.toLocaleString("en-US");

function length(s: LiveSession): string {
  const min = Math.max(1, Math.round((s.lastAt.getTime() - s.startedAt.getTime()) / 60000));
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Live({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const [{ settings }, key, sessions] = await Promise.all([liveSettingsOf(me.id), overlayKeyOf(me.id), sessionsOf(me.id)]);
  const running = allowedBy(settings, me.plan);
  const game = GAMES.find((g) => g.id === running.game)!;

  return (
    <>
      <PageHead
        eyebrow="Live"
        title="Your LIVE game"
        line={`${game.name}: ${game.line}`}
        action={<a href={`/live/play?key=${key}`} target="_blank" rel="noreferrer" className={button.secondary}>Try it with the test panel</a>}
      />

      <section aria-labelledby="go-live" className="mb-8">
        <h2 id="go-live" className="mb-4 font-display text-2xl uppercase tracking-wide">Go live in three steps</h2>
        <Setup overlayKey={key} game={running.game} />
      </section>

      <Card className="mb-8">
        <CardHead title="Game settings" />
        <LiveSettingsForm
          initial={settings}
          games={GAMES}
          menus={labels}
          abilities={LIVE_ABILITIES.map((id) => ({ id, name: ABILITIES[id].name, color: ABILITIES[id].color, line: ABILITIES[id].line }))}
          allowed={{ games: me.plan.games, customMenus: me.plan.customMenus, planName: me.plan.name }}
          action={saveLive}
        />
      </Card>

      <Card className="mb-8">
        <CardHead title="Your LIVEs" action={sessions.length ? <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Real viewers only</span> : undefined} />
        {sessions.length === 0 ? (
          <div className="p-5">
            <Empty
              title="No LIVEs yet"
              body="After you play it on a LIVE, each one shows up here: how long it ran, rounds, the most people playing at once, gift coins and your top gifters. Only real viewers count; demo and test-panel viewers never do."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <caption className="sr-only">Your LIVE sessions, newest first</caption>
              <thead>
                <tr className="border-b-2 border-edge font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  <th scope="col" className="px-5 py-3 font-normal">When</th>
                  <th scope="col" className="hidden px-3 py-3 font-normal md:table-cell">Game</th>
                  <th scope="col" className="hidden px-3 py-3 text-right font-normal sm:table-cell">Length</th>
                  <th scope="col" className="px-3 py-3 text-right font-normal">Rounds</th>
                  <th scope="col" className="hidden px-3 py-3 text-right font-normal sm:table-cell">Most playing</th>
                  <th scope="col" className="px-5 py-3 text-right font-normal md:px-3">Gift coins</th>
                  <th scope="col" className="hidden px-5 py-3 font-normal md:table-cell">Top gifter</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-edge last:border-0">
                    <td className="px-5 py-3 whitespace-nowrap"><LocalTime iso={s.startedAt.toISOString()} /></td>
                    <td className="hidden px-3 py-3 whitespace-nowrap md:table-cell">{GAMES.find((g) => g.id === s.game)?.name ?? s.game}</td>
                    <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{length(s)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{n(s.rounds)}</td>
                    <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{n(s.peakPlayers)}</td>
                    <td className="px-5 py-3 text-right tabular-nums md:px-3">{n(s.coins)}</td>
                    <td className="hidden max-w-[12rem] truncate px-5 py-3 md:table-cell">{s.topGifters[0] ? `${s.topGifters[0].name} · ${n(s.topGifters[0].coins)}` : <span className="text-muted">None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="border-dashed">
        <div id="address" className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-display text-xl uppercase tracking-wide">Your game address</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">
              {q.rotated === "1"
                ? "Done: there's a new address above. Paste it into LIVE Studio or OBS in place of the old one, which no longer works."
                : "It has a private key in it, so the game uses your settings and saves your stats. If someone else got hold of it, make a new one; the old one stops working at once."}
            </p>
          </div>
          <form action={newKey}>
            <button type="submit" className={button.secondary}>Make a new address</button>
          </form>
        </div>
      </Card>
    </>
  );
}
