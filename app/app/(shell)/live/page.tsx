import type { Metadata } from "next";
import Link from "next/link";
import { LiveSettingsForm } from "@/components/app/live-settings";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, Empty, PageHead, Pill } from "@/components/app/ui";
import { Setup } from "@/components/live/setup";
import { ABILITIES } from "@/lib/battle/abilities";
import { GAMES } from "@/lib/live/games";
import { BATTLE_MENU } from "@/lib/live/games/battle";
import { RACE_MENU } from "@/lib/live/games/race";
import { ROYALE_MENU } from "@/lib/live/games/royale";
import { liveFit, sellLive } from "@/lib/live/eligibility";
import { NO_USERNAMES, whyNotCounted } from "@/lib/live/proof";
import { RIVAL_POWERS } from "@/lib/live/rivals";
import { allowedBy, LIVE_ABILITIES } from "@/lib/live/settings";
import { account } from "@/lib/server/account";
import { channelsOf } from "@/lib/server/channels";
import { configured } from "@/lib/server/env";
import { liveSettingsOf, overlayKeyOf, sessionsOf, tiktokUsernamesOf, type LiveSession } from "@/lib/server/live";
import { checkLive, newKey, recheckLive, saveLive } from "./actions";

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
  const [{ settings }, key, sessions, accounts, channels] = await Promise.all([liveSettingsOf(me.id), overlayKeyOf(me.id), sessionsOf(me.id), tiktokUsernamesOf(me.id), channelsOf(me.id)]);
  // usernames come from TikTok only once Hookline asks for them; until then no LIVE can count
  const checking = configured().tiktokProfile;
  // a TikTok connected without its username (before Hookline asked for it) needs connecting again
  const noUsername = !accounts.length && channels.some((c) => c.platform === "tiktok");
  const running = allowedBy(settings, me.plan);
  const game = GAMES.find((g) => g.id === running.game)!;
  const fit = liveFit(me.profile.liveCheck);
  const at = (users: string[]) => users.map((u) => `@${u}`).join(", ");

  return (
    <>
      <PageHead
        eyebrow="Live"
        title="Your LIVE game"
        line={`${game.name}: ${game.line}`}
        action={<a href={`/live/play?key=${key}`} target="_blank" rel="noreferrer" className={button.secondary}>Try it with the test panel</a>}
      />

      {typeof q.error === "string" && <p role="alert" className="mb-6 border-2 border-signal px-4 py-3 text-[15px]">TikTok didn&rsquo;t connect. Try again from Settings.</p>}

      <section aria-labelledby="go-live" className="mb-8 scroll-mt-20">
        {!fit.asked ? (
          <>
            <h2 id="go-live" className="mb-4 font-display text-2xl uppercase tracking-wide">Before you set it up</h2>
            <Card>
              <form action={checkLive} className="flex flex-col gap-4 px-5 py-5">
                <p className="max-w-2xl text-[15px] leading-relaxed text-muted">TikTok has its own rules for who can go LIVE and get gifts. Tick what&rsquo;s true for you.</p>
                {[
                  { name: "adult", label: "I'm 18 or older" },
                  { name: "canGoLive", label: "My TikTok can go LIVE", sub: "TikTok usually opens it up at about 1,000 followers" },
                  { name: "computer", label: "I'll go LIVE from a computer", sub: "The games run in TikTok LIVE Studio or OBS, not the phone app" },
                ].map((q) => (
                  <label key={q.name} className="flex items-start gap-3">
                    <input type="checkbox" name={q.name} className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-signal)]" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[15px]">{q.label}</span>
                      {q.sub && <span className="text-[13px] text-muted">{q.sub}</span>}
                    </span>
                  </label>
                ))}
                <button type="submit" className={`${button.primary} w-fit`}>Continue</button>
              </form>
            </Card>
          </>
        ) : !fit.ok ? (
          <>
            <h2 id="go-live" className="mb-4 font-display text-2xl uppercase tracking-wide">You can&rsquo;t earn gifts with these yet</h2>
            <Card>
              <div className="flex flex-col gap-4 px-5 py-5">
                <ul className="flex max-w-2xl flex-col gap-1.5 text-[15px] leading-relaxed">
                  {fit.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
                <p className="max-w-2xl text-[15px] leading-relaxed text-muted">You can make and post Shorts now, while you work toward LIVE. You can still try the games with the test panel.</p>
                <div className="flex flex-wrap items-center gap-4">
                  <Link href="/app/shorts" className={button.primary}>Go to Shorts</Link>
                  <form action={recheckLive}><button type="submit" className={button.quiet}>Change my answers</button></form>
                </div>
              </div>
            </Card>
          </>
        ) : (
          <>
            <h2 id="go-live" className="mb-4 font-display text-2xl uppercase tracking-wide">Go live in three steps</h2>
            <Setup overlayKey={key} game={running.game} accounts={accounts} checking={checking} bridgeOff={configured().bridgeOff} />
          </>
        )}
      </section>

      <Card className="mb-8">
        <CardHead title="Game settings" />
        <LiveSettingsForm
          initial={settings}
          games={GAMES}
          menus={labels}
          abilities={LIVE_ABILITIES.map((id) => ({ id, name: ABILITIES[id].name, color: ABILITIES[id].color, line: ABILITIES[id].line }))}
          allowed={{ games: me.plan.games, customMenus: me.plan.customMenus, planName: me.plan.name }}
          upsell={sellLive(me.profile.liveCheck)}
          action={saveLive}
        />
      </Card>

      <Card className="mb-8">
        <CardHead title="Your LIVEs" action={sessions.length ? <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Real viewers only</span> : undefined} />
        <p className="border-b-2 border-edge px-5 py-3 text-[13px] leading-relaxed text-muted">
          {accounts.length ? (
            <>A LIVE counts as yours when the game hears your connected TikTok ({at(accounts)}) through Hookline Bridge the whole way through. Gift coins seen are what viewers sent, not what TikTok pays you.</>
          ) : !checking ? (
            <>{NO_USERNAMES} Gift coins seen are what viewers sent, not what TikTok pays you.</>
          ) : noUsername ? (
            <>
              Hookline doesn&rsquo;t have your TikTok username yet. <a href={`/api/connect/tiktok?next=${encodeURIComponent("/app/live")}`} className="text-fg underline decoration-signal decoration-2 underline-offset-4">Connect TikTok again</a> and allow your profile, so Hookline can tell your LIVEs are yours. Until then, their gift coins seen don&rsquo;t count in Earnings.
            </>
          ) : (
            <>
              <Link href="/app/settings" className="text-fg underline decoration-signal decoration-2 underline-offset-4">Connect your TikTok</Link> so Hookline can tell your LIVEs are yours. Until then, their gift coins seen don&rsquo;t count in Earnings.
            </>
          )}
        </p>
        {sessions.length === 0 ? (
          <div className="p-5">
            <Empty
              title="No LIVEs yet"
              body="After you play it on a LIVE, each one shows up here: how long it ran, rounds, the most people playing at once, gift coins seen and your top gifters. Only real viewers count; demo and test-panel viewers never do."
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
                  <th scope="col" className="px-5 py-3 text-right font-normal md:px-3">Gift coins seen</th>
                  <th scope="col" className="hidden px-3 py-3 font-normal lg:table-cell">Whose LIVE</th>
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
                    <td className="px-5 py-3 text-right tabular-nums md:px-3">
                      {n(s.coins)}
                      {!s.verified && <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-signal">Not counted</span>}
                    </td>
                    <td className="hidden max-w-[16rem] px-3 py-3 lg:table-cell" title={whyNotCounted(s, accounts, checking) ?? undefined}>
                      <span className="flex flex-wrap items-center gap-2">
                        {s.heard.length ? <span className="truncate">{at(s.heard)}{s.unknown && <span className="text-muted"> + couldn&rsquo;t tell</span>}</span> : <span className="text-muted">Couldn&rsquo;t tell</span>}
                        {s.verified ? <Pill tone="good">Yours</Pill> : <Pill tone="warn">Not verified</Pill>}
                      </span>
                    </td>
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
