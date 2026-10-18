import type { Metadata } from "next";
import Link from "next/link";
import { NamesSwitch } from "@/components/app/live-names";
import { LiveSettingsForm } from "@/components/app/live-settings";
import { LocalTime } from "@/components/app/local-time";
import { button, Card, CardHead, Empty, PageHead, Pill } from "@/components/app/ui";
import { Setup } from "@/components/live/setup";
import { ABILITIES } from "@/lib/battle/abilities";
import type { LivePlatform } from "@/lib/live/events";
import { GAMES, gamesFor } from "@/lib/live/games";
import { BATTLE_MENU } from "@/lib/live/games/battle";
import { RACE_MENU } from "@/lib/live/games/race";
import { ROYALE_MENU } from "@/lib/live/games/royale";
import { liveFit, sellLive, ytLiveFit } from "@/lib/live/eligibility";
import { NO_USERNAMES, whyNotCounted } from "@/lib/live/proof";
import { RIVAL_POWERS } from "@/lib/live/rivals";
import { lasted } from "@/lib/live/session";
import { allowedBy, LIVE_ABILITIES } from "@/lib/live/settings";
import { addTallies, tryItHref } from "@/lib/live/youtube";
import { channelNames, unitsOf } from "@/lib/shorts/channels";
import { account, type Goal } from "@/lib/server/account";
import { channelsOf } from "@/lib/server/channels";
import { clipsAllowed, clipsOf, type LiveClips } from "@/lib/server/clips";
import { asUser } from "@/lib/server/db";
import { configured } from "@/lib/server/env";
import { lastLiveOf, liveSettingsOf, overlayKeyOf, sessionsOf, tiktokUsernamesOf, type LiveSession } from "@/lib/server/live";
import { nichesOf } from "@/lib/server/niches";
import { youtubeLiveOf } from "@/lib/server/ytlive";
import { checkLive, checkYouTubeLive, newKey, pickLiveChannel, recheckLive, recheckYouTubeLive, saveLive, saveNames } from "./actions";

export const metadata: Metadata = { title: "Live" };

const menus = { battle: BATTLE_MENU, race: RACE_MENU, royale: ROYALE_MENU, rivals: RIVAL_POWERS };
const labels = Object.fromEntries(Object.entries(menus).map(([k, m]) => [k, m.map((t) => ({ name: t.name, line: t.line }))])) as Record<keyof typeof menus, { name: string; line: string }[]>;

const n = (v: number) => v.toLocaleString("en-US");

const OWN_PAGE = "Each LIVE opens on its own page, with a recap card to share when it's verified as yours.";

/** Whether the last LIVE's top gifters get a welcome back, and why: only a LIVE verified as theirs has supporters of their own. */
function welcomeNote(last: { verified: boolean } | null, checking: boolean, accounts: string[]): string {
  if (!checking && !accounts.length) return "Welcome backs need a LIVE verified as yours, and Hookline can't check TikTok usernames yet.";
  if (!last) return "After a LIVE that's verified as yours, its top 3 gifters get a welcome when they come back.";
  return last.verified
    ? "Your last LIVE was verified as yours, so its top 3 gifters get a welcome when they come back."
    : "Your last LIVE wasn't verified as yours, so nobody gets a welcome next time.";
}

const link = "text-fg underline decoration-signal decoration-2 underline-offset-4";

/**
 * Why none of their rounds can become a Short right now, the first reason that applies, or null when they can: `shorts` is
 * whether any of their channels gets Shorts, and `picked` whether every one that does is about one thing, since a round only
 * goes to one that gets a mix of everything. The game picked is the form's to say.
 */
function clipsNote(checking: boolean, accounts: string[], noUsername: boolean, goal: Goal | null, shorts: boolean, picked: boolean): React.ReactNode {
  if (!checking) return "Hookline can't check TikTok usernames yet, so no LIVE counts as yours and no round becomes a Short for now.";
  if (!accounts.length && noUsername) {
    return <><a href={`/api/connect/tiktok?next=${encodeURIComponent("/app/live")}`} className={link}>Connect TikTok again</a> and allow your profile, so Hookline can tell a LIVE is yours.</>;
  }
  if (!accounts.length) return <>Connect the TikTok you go LIVE on in <Link href="/app/settings" className={link}>Settings</Link>, so Hookline can tell a LIVE is yours.</>;
  if (goal === "live") {
    return <>Your Shorts are off while Hookline is set to LIVE games only. Set what you use Hookline for to Both in <Link href="/app/settings" className={link}>Settings</Link> to get your best rounds as Shorts.</>;
  }
  if (!shorts) return <>Shorts are off for every channel, so no round becomes a Short. Switch one on in <Link href="/app/settings" className={link}>Settings</Link>.</>;
  if (picked) return "Rounds only become Shorts on a channel that gets a mix of everything, and every channel that gets Shorts is about one thing, so no round becomes a Short.";
  return null;
}

/** What came of a LIVE's rounds: the Short made from one, how many wait for a morning's Shorts (only while rounds can become Shorts), or none. */
function ShortsCell({ c, on }: { c: LiveClips | undefined; on: boolean }) {
  const waiting = on ? (c?.waiting ?? 0) : 0;
  if (!c?.shortId && !waiting) return <span className="text-muted">None</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {c?.shortId && <Link href={`/app/shorts/${c.shortId}`} className="underline decoration-edge-strong decoration-2 underline-offset-4 transition hover:decoration-signal">Made a Short</Link>}
      {waiting > 0 && <span>{n(waiting)} {waiting === 1 ? "round" : "rounds"} waiting</span>}
    </span>
  );
}

const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

/** A YouTube LIVE's gifts: the Super Chats the game heard on its streams, which are the streams' counts and not the session's alone. */
function HeardCell({ s }: { s: LiveSession }) {
  if (!s.broadcasts.length) return <span className="text-muted">No stream heard</span>;
  // a LIVE that counted as theirs only loses its streams' counts with their channel; one that didn't names streams Hookline has nothing of
  if (!s.streams.length) return <span className="text-muted">{s.verified ? "Gone with its channel" : "No stream on record"}</span>;
  const t = addTallies(s.streams);
  const members = t.newMembers + t.giftedMembers;
  const more = [t.jewels > 0 && `${n(t.jewels)} Jewels`, t.superStickers > 0 && plural(t.superStickers, "Super Sticker"), members > 0 && plural(members, "member")].filter(Boolean);
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span>{plural(t.superChats, "Super Chat")} heard on {s.streams.length > 1 ? "these streams" : "this stream"}</span>
      {more.length > 0 && <span className="text-[12px] text-muted">{more.join(" · ")}</span>}
    </span>
  );
}

/** The questions before setting up, one tick each: a box left unticked is a no. */
function CheckForm({ action, intro, questions }: { action: (form: FormData) => Promise<void>; intro: string; questions: { name: string; label: string; sub?: string }[] }) {
  return (
    <Card>
      <form action={action} className="flex flex-col gap-4 px-5 py-5">
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted">{intro}</p>
        {questions.map((q) => (
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
  );
}

/** Why they can't play there yet, and where to go instead. */
function CantPlay({ reasons, next, recheck }: { reasons: string[]; next: string; recheck: () => Promise<void> }) {
  return (
    <Card>
      <div className="flex flex-col gap-4 px-5 py-5">
        <ul className="flex max-w-2xl flex-col gap-1.5 text-[15px] leading-relaxed">
          {reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted">{next}</p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/app/shorts" className={button.primary}>Go to Shorts</Link>
          <form action={recheck}><button type="submit" className={button.quiet}>Change my answers</button></form>
        </div>
      </div>
    </Card>
  );
}

const TIKTOK_QUESTIONS = [
  { name: "adult", label: "I'm 18 or older" },
  { name: "canGoLive", label: "My TikTok can go LIVE", sub: "TikTok usually opens it up at about 1,000 followers" },
  { name: "computer", label: "I'll go LIVE from a computer", sub: "The games run in TikTok LIVE Studio or OBS, not the phone app" },
];

const YOUTUBE_QUESTIONS = [
  { name: "adult", label: "I'm 18 or older" },
  { name: "canGoLive", label: "My channel can go live", sub: "YouTube asks for a verified channel with no live streaming restrictions. The first time, it can take a day to switch on." },
  { name: "computer", label: "I'll go live from a computer", sub: "The game goes on your stream through OBS or another streaming app. The YouTube phone app can't show it." },
  { name: "superChat", label: "My channel has Super Chat", sub: "It comes with the YouTube Partner Program, for people 18 and over in the places YouTube offers it." },
];

/** TikTok LIVE or YouTube Live, while YouTube Live is on: the setup at the top is for one of them at a time. */
function PlatformSwitch({ on }: { on: LivePlatform }) {
  return (
    <div role="group" aria-label="Where you go live" className="mb-5 flex w-fit border-2 border-fg">
      {([["tiktok", "TikTok LIVE"], ["youtube", "YouTube Live"]] as const).map(([p, name]) => (
        <Link
          key={p}
          href={`/app/live?on=${p}#go-live`}
          aria-current={on === p ? "true" : undefined}
          className={`px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] ${on === p ? "bg-fg text-surface" : "text-muted hover:text-fg"}`}
        >
          {name}
        </Link>
      ))}
    </div>
  );
}

const heading = "mb-4 font-display text-2xl uppercase tracking-wide";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Live({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const [{ settings }, key, sessions, accounts, channels, last] = await Promise.all([liveSettingsOf(me.id), overlayKeyOf(me.id), sessionsOf(me.id), tiktokUsernamesOf(me.id), channelsOf(me.id), lastLiveOf(me.id)]);
  // usernames come from TikTok only once Hookline asks for them; until then no LIVE can count
  const checking = configured().tiktokProfile;
  // a TikTok connected without its username (before Hookline asked for it) needs connecting again
  const noUsername = !accounts.length && channels.some((c) => c.platform === "tiktok");
  const running = allowedBy(settings, me.plan);
  const fit = liveFit(me.profile.liveCheck);
  const youtubeOn = configured().youtubeLive;
  const ytFit = ytLiveFit(me.profile.ytLiveCheck);
  // the setup at the top: the one they picked, or YouTube's when they've answered its questions and not TikTok's
  const side: LivePlatform = !youtubeOn ? "tiktok" : q.on === "youtube" || (q.on !== "tiktok" && ytFit.asked && !fit.asked) ? "youtube" : "tiktok";
  // the games as they play where they're setting up
  const games = gamesFor(side);
  const game = games.find((g) => g.id === running.game)!;
  const ytSetup = side === "youtube" && ytFit.asked && ytFit.ok;
  const yt = ytSetup ? await youtubeLiveOf(me.id) : null;
  const ytChannels = channels.filter((c) => c.platform === "youtube" && c.status !== "revoked");
  const ytNames = channelNames(ytChannels);
  const connectYouTube = `/api/connect/youtube?next=${encodeURIComponent("/app/live?on=youtube")}`;
  const at = (users: string[]) => users.map((u) => `@${u}`).join(", ");
  // what came of each LIVE's rounds: the column shows while rounds can become Shorts, and while a LIVE here has one. With every
  // channel's Shorts off, no morning makes any, so none can. A morning gives a round to the first channel getting Shorts that
  // isn't about one thing (generate.ts), so with every one about one thing, none can either
  const clipped = await clipsOf(me.id, sessions.map((s) => s.id));
  const units = unitsOf(channels, me.plan.channels);
  const shorts = units.length > 0;
  const niches = await asUser(me.id, (tx) => nichesOf(tx, me.id));
  const picked = shorts && units.every((id) => niches.get(id));
  const clipsOn = clipsAllowed(settings, me.profile.goal, checking) && shorts && !picked;
  const shortsColumn = clipsOn || [...clipped.values()].some((c) => c.shortId);
  // with YouTube LIVEs listed, each row says what its gifts were
  const onYouTube = sessions.some((s) => s.platform === "youtube");
  const onTikTok = sessions.some((s) => s.platform === "tiktok");
  // on a phone, those longer gift lines need the room Rounds takes; each LIVE's own page has its rounds
  const roundsCell = onYouTube ? "hidden px-3 py-3 text-right sm:table-cell" : "px-3 py-3 text-right";

  return (
    <>
      <PageHead
        eyebrow="Live"
        title="Your LIVE game"
        line={`${game.name}: ${game.line}`}
        action={<a href={tryItHref(key, side, ytSetup, running.game)} target="_blank" rel="noreferrer" className={button.secondary}>Try it with the test panel</a>}
      />

      {typeof q.error === "string" && (
        <p role="alert" className="mb-6 border-2 border-signal px-4 py-3 text-[15px]">{side === "youtube" ? "YouTube" : "TikTok"} didn&rsquo;t connect. Try again from Settings.</p>
      )}
      {side === "youtube" && (q.connected === "youtube" || q.connected === "already") && (
        <p role="status" className="mb-6 border-2 border-fg bg-card px-4 py-3 text-[15px]">YouTube is connected. Once you&rsquo;re live, press Check now below.</p>
      )}

      <section aria-labelledby="go-live" className="mb-8 scroll-mt-20">
        {youtubeOn && <PlatformSwitch on={side} />}
        {side === "youtube" ? (
          !ytFit.asked ? (
            <>
              <h2 id="go-live" className={heading}>Before you set it up</h2>
              <CheckForm action={checkYouTubeLive} intro="YouTube has its own rules for who can get Super Chats. Tick what's true for you." questions={YOUTUBE_QUESTIONS} />
            </>
          ) : !ytFit.ok ? (
            <>
              <h2 id="go-live" className={heading}>You can&rsquo;t play on YouTube Live yet</h2>
              <CantPlay reasons={ytFit.reasons} next="You can make and post Shorts now. You can still try the games with the test panel." recheck={recheckYouTubeLive} />
            </>
          ) : (
            <>
              <h2 id="go-live" className={heading}>Go live in three steps</h2>
              <Setup
                platform="youtube"
                overlayKey={key}
                game={running.game}
                youtube={{
                  channels: ytChannels.map((c) => ({ id: c.id, name: ytNames.get(c.id)! })),
                  picked: yt?.channelId ?? null,
                  summary: {
                    state: yt?.state ?? "idle", detail: yt?.detail ?? null, kids: !!yt?.kids, channel: yt?.channel ?? null, title: yt?.title ?? null,
                    until: yt?.until?.toISOString() ?? null, who: yt?.who ?? null, open: !!yt?.open, used: yt?.used ?? 0,
                  },
                  pick: pickLiveChannel,
                  connect: connectYouTube,
                  reconnect: yt?.channelId ? `${connectYouTube}&channel=${yt.channelId}` : null,
                  ownMenu: !!(running.gifts || running.rivals.gifts),
                }}
              />
            </>
          )
        ) : !fit.asked ? (
          <>
            <h2 id="go-live" className={heading}>Before you set it up</h2>
            <CheckForm action={checkLive} intro="TikTok has its own rules for who can go LIVE and get gifts. Tick what's true for you." questions={TIKTOK_QUESTIONS} />
          </>
        ) : !fit.ok ? (
          <>
            <h2 id="go-live" className={heading}>You can&rsquo;t earn gifts with these yet</h2>
            <CantPlay reasons={fit.reasons} next="You can make and post Shorts now, while you work toward LIVE. You can still try the games with the test panel." recheck={recheckLive} />
          </>
        ) : (
          <>
            <h2 id="go-live" className={heading}>Go live in three steps</h2>
            <Setup overlayKey={key} game={running.game} accounts={accounts} checking={checking} bridgeOff={configured().bridgeOff} />
          </>
        )}
      </section>

      <Card className="mb-8">
        <CardHead title="On screen" />
        <dl className="flex flex-col divide-y-2 divide-edge">
          {[
            { term: "Top gifters", body: <p>The LIVE&rsquo;s top 3 gifters stay on screen near the top, round after round. Only real viewers count.</p> },
            { term: "Welcome backs", body: <p>{welcomeNote(last, checking, accounts)}{youtubeOn && " Welcome backs are for TikTok LIVEs for now."}</p> },
            { term: "Viewer names", body: <NamesSwitch hidden={settings.hideNames} action={saveNames} /> },
          ].map((r) => (
            <div key={r.term} className="grid gap-2 px-5 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
              <dt className="pt-0.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{r.term}</dt>
              <dd className="max-w-2xl text-[15px] leading-relaxed">{r.body}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="mb-8">
        <CardHead title="Game settings" />
        <LiveSettingsForm
          initial={settings}
          games={games}
          menus={labels}
          abilities={LIVE_ABILITIES.map((id) => ({ id, name: ABILITIES[id].name, color: ABILITIES[id].color, line: ABILITIES[id].line }))}
          allowed={{ games: me.plan.games, customMenus: me.plan.customMenus, planName: me.plan.name }}
          upsell={sellLive(me.profile.liveCheck, me.profile.ytLiveCheck, youtubeOn)}
          clips={{ shorts: me.plan.shorts, note: clipsNote(checking, accounts, noUsername, me.profile.goal, shorts, picked) }}
          action={saveLive}
        />
      </Card>

      <Card id="lives" className="mb-8 scroll-mt-20">
        <CardHead title="Your LIVEs" action={sessions.length ? <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Real viewers only</span> : undefined} />
        <div className="flex flex-col gap-2 border-b-2 border-edge px-5 py-3 text-[13px] leading-relaxed text-muted">
          {(side === "tiktok" || onTikTok) && (
            <p>
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
              {sessions.length > 0 && ` ${OWN_PAGE}`}
              {clipsOn && " Your best rounds from LIVEs that count as yours wait three days for a morning's Shorts."}
            </p>
          )}
          {(side === "youtube" || onYouTube) && (
            <p>
              A YouTube LIVE is yours when the game heard it through your connected channel, which is the only way it hears YouTube. Counts are what the game heard on each stream.
              {youtubeOn && me.profile.ytLiveCheck?.superChat && " What viewers paid in Super Chats is in Earnings, from YouTube."}
            </p>
          )}
        </div>
        {sessions.length === 0 ? (
          <div className="p-5">
            <Empty
              title="No LIVEs yet"
              body={`After you play it on a LIVE, each one shows up here: how long it ran, rounds, the most people playing at once, gift coins seen and your top gifters. Only real viewers count; demo and test-panel viewers never do. ${OWN_PAGE}`}
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
                  <th scope="col" className={`${roundsCell} font-normal`}>Rounds</th>
                  <th scope="col" className="hidden px-3 py-3 text-right font-normal sm:table-cell">Most playing</th>
                  <th scope="col" className="px-5 py-3 text-right font-normal md:px-3">{onYouTube ? "Gifts seen" : "Gift coins seen"}</th>
                  {shortsColumn && <th scope="col" className="hidden px-3 py-3 font-normal md:table-cell">Shorts</th>}
                  <th scope="col" className="hidden px-3 py-3 font-normal lg:table-cell">Whose LIVE</th>
                  <th scope="col" className="hidden px-5 py-3 font-normal md:table-cell">Top gifter</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const youtube = s.platform === "youtube";
                  // the channels its streams were on, as the reader found them
                  const on = [...new Set(s.streams.map((x) => x.channel ?? "Your channel"))];
                  return (
                    <tr key={s.id} className="border-b border-edge last:border-0">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Link href={`/app/live/${s.id}`} className="font-medium underline decoration-edge-strong decoration-2 underline-offset-4 transition hover:decoration-signal">
                          <LocalTime iso={s.startedAt.toISOString()} />
                        </Link>
                        {onYouTube && <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{youtube ? "YouTube" : "TikTok"}</span>}
                      </td>
                      <td className="hidden px-3 py-3 whitespace-nowrap md:table-cell">{GAMES.find((g) => g.id === s.game)?.name ?? s.game}</td>
                      <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{lasted(s)}</td>
                      <td className={`${roundsCell} tabular-nums`}>{n(s.rounds)}</td>
                      <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{n(s.peakPlayers)}</td>
                      <td className="px-5 py-3 text-right tabular-nums md:px-3">
                        {youtube ? <HeardCell s={s} /> : onYouTube ? `${n(s.coins)} gift coins` : n(s.coins)}
                        {!youtube && !s.verified && <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-signal">Not counted</span>}
                      </td>
                      {shortsColumn && (
                        <td className="hidden px-3 py-3 whitespace-nowrap md:table-cell">
                          {!youtube && <ShortsCell c={clipped.get(s.id)} on={clipsOn} />}
                        </td>
                      )}
                      <td className="hidden max-w-[16rem] px-3 py-3 lg:table-cell" title={whyNotCounted(s, accounts, checking) ?? undefined}>
                        <span className="flex flex-wrap items-center gap-2">
                          {youtube ? (
                            on.length ? <span className="truncate">{on.join(", ")}</span> : <span className="text-muted">Your YouTube</span>
                          ) : s.heard.length ? (
                            <span className="truncate">{at(s.heard)}{s.unknown && <span className="text-muted"> + couldn&rsquo;t tell</span>}</span>
                          ) : (
                            <span className="text-muted">Couldn&rsquo;t tell</span>
                          )}
                          {s.verified ? <Pill tone="good">Yours</Pill> : <Pill tone="warn">Not verified</Pill>}
                        </span>
                      </td>
                      <td className="hidden max-w-[12rem] truncate px-5 py-3 md:table-cell">
                        {!s.topGifters[0] ? <span className="text-muted">None</span> : youtube ? s.topGifters[0].name : `${s.topGifters[0].name} · ${n(s.topGifters[0].coins)}`}
                      </td>
                    </tr>
                  );
                })}
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
