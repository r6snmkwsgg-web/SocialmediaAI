import type { Metadata } from "next";
import Link from "next/link";
import { ChannelFilter } from "@/components/app/channel-filter";
import { Card, CardHead, Empty, PageHead, Pill } from "@/components/app/ui";
import { ABILITIES, ABILITY_IDS } from "@/lib/battle/abilities";
import { FINAL, LEAGUE_HEALTH, ROUND_MATCHES, type CastBall } from "@/lib/battle/league";
import { isActive, unitsOf } from "@/lib/shorts/channels";
import {
  gameLines, LEAGUE_NOTE, matchLine, matchName, OWN_LEAGUE, seasonLine, seasonsOver, shortWords, type AllTime, type SeasonOver, type ShortState, type ViewMatch,
} from "@/lib/shorts/league";
import { account } from "@/lib/server/account";
import { shortsChannelsOf } from "@/lib/server/channels";
import { asUser } from "@/lib/server/db";
import { nichesOf } from "@/lib/server/niches";
import { leaguesOf, leagueView } from "@/lib/server/shorts/league";

export const metadata: Metadata = { title: "Ball League" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** How each state of a match's Short shows. */
const TONE: Record<ShortState, "plain" | "good" | "warn" | "signal"> = { waiting: "signal", coming: "warn", posted: "good", skipped: "plain", failed: "signal", none: "plain", unplayed: "plain" };

const linked = "underline decoration-signal decoration-2 underline-offset-4";

/** A ball as the page shows it: a dot in its colour, then its name. */
function Ball({ ball }: { ball: CastBall }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="h-3 w-3 shrink-0 rounded-full border border-edge-strong" style={{ background: ball.color }} aria-hidden="true" />
      <span className="truncate">{ball.name}</span>
    </span>
  );
}

/**
 * A match in the list: which it is, how it went (each game of a knockout
 * that took more than one), its seeds once it's played, and its Short.
 * `stopped` is whether its season stopped, so a match never played won't be.
 */
function Match({ m, cast, stopped }: { m: ViewMatch; cast: CastBall[]; stopped: boolean }) {
  const games = m.games ?? [];
  const seeds = games.flatMap((g) => (g.seed === null ? [] : [g.seed]));
  const pill = <Pill tone={TONE[m.short]}>{shortWords(m.short, stopped)}</Pill>;
  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{matchName(m.number)}</p>
        <p className={`text-[15px] leading-snug ${m.playedAt ? "font-semibold" : "text-muted"}`}>{matchLine(m, cast)}</p>
        {games.length > 1 ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-[13px] text-muted">
            {gameLines(games, cast).map((line, i) => (
              <li key={i}>
                {line}
                {games[i].seed !== null && <span className="font-mono text-[11px]"> · seed {games[i].seed}</span>}
              </li>
            ))}
          </ul>
        ) : (
          seeds.length > 0 && <p className="mt-0.5 font-mono text-[11px] text-muted">seed {seeds[0]}</p>
        )}
      </div>
      <div className="shrink-0">{m.videoId ? <Link href={`/app/shorts/${m.videoId}`} className="hover:opacity-80">{pill}</Link> : pill}</div>
    </li>
  );
}

/** Every season that's over, newest first: its champion and how the final went, or how far a stopped one got. */
function Champions({ over, cast }: { over: SeasonOver[]; cast: CastBall[] }) {
  return (
    <Card>
      <CardHead title="Champions" />
      <ul className="divide-y divide-edge">
        {over.map((s) => (
          <li key={s.number} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Season {s.number}</p>
              <p className="text-[15px] font-semibold">{s.champion === null ? <span className="text-muted">No champion</span> : <Ball ball={cast[s.champion]} />}</p>
            </div>
            <p className="text-[13px] text-muted sm:text-right">{s.line}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The eight balls over every season: each one's matches won, drawn and lost, and its titles, best first. */
function CastRecords({ records, cast }: { records: AllTime[]; cast: CastBall[] }) {
  return (
    <Card>
      <CardHead title="The cast" action={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">All time</span>} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[14px]">
          <caption className="sr-only">Each ball&rsquo;s matches won, drawn and lost over every season, and how many seasons it won</caption>
          <thead>
            <tr className="border-b-2 border-edge font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              <th scope="col" className="py-2.5 pl-5 pr-2 font-normal">Ball</th>
              <th scope="col" className="hidden px-2 py-2.5 font-normal sm:table-cell">Power</th>
              {["W", "D", "L"].map((h) => <th key={h} scope="col" className="px-1.5 py-2.5 text-right font-normal">{h}</th>)}
              <th scope="col" className="py-2.5 pl-1.5 pr-5 text-right font-normal">Titles</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {records.map((r) => (
              <tr key={r.slot} className="border-b border-edge last:border-0">
                <th scope="row" className="max-w-[12rem] py-2.5 pl-5 pr-2 font-semibold"><Ball ball={cast[r.slot]} /></th>
                <td className="hidden px-2 py-2.5 text-muted sm:table-cell">{ABILITIES[cast[r.slot].power].name}</td>
                {[r.won, r.drawn, r.lost].map((v, i) => <td key={i} className="px-1.5 py-2.5 text-right font-mono text-[13px]">{v}</td>)}
                <td className="py-2.5 pl-1.5 pr-5 text-right font-mono text-[13px] font-semibold">{r.titles}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-5 pb-4 pt-2 text-[12px] leading-relaxed text-muted">
          Every match each ball has played, in every season, stopped ones too. A semi-final or the final counts as one match, however many games it took.
        </p>
      </div>
    </Card>
  );
}

export default async function League({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const [shown, niches, had] = await Promise.all([shortsChannelsOf(me.id), asUser(me.id, (tx) => nichesOf(tx, me.id)), leaguesOf(me.id)]);
  // the account's own Shorts are about something of their own only while it has no channel
  const own = !shown.some(isActive);
  const inLeague = (id: string | null) => (id !== null || own) && niches.get(id)?.id === "league";
  // the leagues to show: each channel's in it now or with a season to look back on, and the account's own while it has no channel
  const leagues = [
    ...(own && (inLeague(null) || had.includes(null)) ? [{ id: OWN_LEAGUE, name: "Your Shorts", status: "connected" }] : []),
    ...shown.filter((c) => inLeague(c.id) || had.includes(c.id)),
  ];
  const unitOf = (id: string) => (id === OWN_LEAGUE ? null : id);
  // the units that get Shorts now: one disconnected, switched off or past the plan's room waits where it is
  const getting = unitsOf(shown, me.plan.channels);
  // the one asked for, or else one in the league that gets Shorts, then one in it that's waiting, then one to look back on
  const key = [...leagues, ...shown].find((c) => c.id === q.channel)?.id
    ?? leagues.find((c) => inLeague(unitOf(c.id)) && getting.includes(unitOf(c.id)))?.id
    ?? leagues.find((c) => inLeague(unitOf(c.id)))?.id
    ?? leagues[0]?.id;
  const unit = key === undefined ? undefined : unitOf(key);
  const picked = shown.find((c) => c.id === key) ?? null;
  const view = unit === undefined ? null : await leagueView({ userId: me.id, channelId: unit });
  const on = unit !== undefined && inLeague(unit);
  // where to pick Ball League: the channel's own Shorts settings, the account's while it has no channel, or Settings for several
  const one = picked ?? (unit === undefined && shown.length === 1 ? shown[0] : null);
  const settings = one ? `/app/settings#channel-${one.id}` : own ? "/app/settings#shorts" : "/app/settings";
  const chips = leagues.length > 1 && <ChannelFilter channels={leagues} picked={key ?? null} path="/app/shorts/league" all={false} />;

  if (unit === undefined || (!view && !on)) {
    return (
      <>
        <PageHead eyebrow="Shorts" title="Ball League" />
        {chips}
        <Empty
          title={picked ? `${picked.name} isn't in it` : "Not in the league"}
          body={
            one
              ? "This channel isn't in the Ball League. Pick Ball League as what it's about in Settings."
              : own
                ? "Your Shorts aren't in the Ball League. Pick Ball League as what they're about in Settings."
                : "None of your channels is in the Ball League. Pick Ball League as what one of them is about in Settings."
          }
          action={{ href: settings, label: "Open Settings" }}
        />
      </>
    );
  }

  const line = seasonLine(view, { getting: getting.includes(unit), inLeague: on, who: { name: picked?.name ?? null } });
  const season = view?.seasons[0];
  const cast = view?.cast ?? [];
  const health = season?.health ?? LEAGUE_HEALTH;
  const knockout = view?.matches.filter((m) => m.number > ROUND_MATCHES) ?? [];
  const stopped = season?.status === "stopped";
  const rounds = [...new Set(view?.matches.filter((m) => m.round !== null).map((m) => m.round!) ?? [])];
  // once a season is over, the league has a past: its champions and each ball's record over every season
  const over = view ? seasonsOver(view) : [];

  return (
    <>
      <PageHead eyebrow="Shorts" title="Ball League" line={line} />
      {chips}
      {!on && (
        <p className="mb-6 border-2 border-dashed border-edge-strong px-4 py-3 text-[14px]">
          {picked ? `${picked.name} isn't in the Ball League now` : "Your Shorts aren't in the Ball League now"}, so no new season starts.{" "}
          <Link href={settings} className={linked}>Pick Ball League in Settings</Link> and a new one starts with the same eight balls.
        </p>
      )}
      <p className="mb-8 max-w-3xl border-l-4 border-signal pl-3 text-[14px] leading-relaxed">{LEAGUE_NOTE}</p>

      {/* the matches run down the right of everything else; on a phone they come straight after the table */}
      <div className="grid items-start gap-6 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
        <Card>
          <CardHead title="Table" action={season && <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Season {season.number}</span>} />
          {view && view.table.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <caption className="sr-only">Season {season?.number}: each ball&rsquo;s matches played, won, drawn and lost, and its points</caption>
                <thead>
                  <tr className="border-b-2 border-edge font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                    <th scope="col" className="w-8 py-2.5 pl-5 pr-1 font-normal">#</th>
                    <th scope="col" className="px-2 py-2.5 font-normal">Ball</th>
                    <th scope="col" className="hidden px-2 py-2.5 font-normal sm:table-cell">Power</th>
                    {["P", "W", "D", "L"].map((h) => <th key={h} scope="col" className="px-1.5 py-2.5 text-right font-normal">{h}</th>)}
                    <th scope="col" className="py-2.5 pl-1.5 pr-5 text-right font-normal">Pts</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {view.table.map((r) => (
                    // the top four go through to the semi-finals
                    <tr key={r.slot} className={`border-b border-edge last:border-0 ${r.place === 4 ? "border-b-2 border-b-edge-strong" : ""}`}>
                      <td className="py-2.5 pl-5 pr-1 font-mono text-[12px] text-muted">{r.place}</td>
                      <th scope="row" className="max-w-[12rem] px-2 py-2.5 font-semibold"><Ball ball={cast[r.slot]} /></th>
                      <td className="hidden px-2 py-2.5 text-muted sm:table-cell">{ABILITIES[cast[r.slot].power].name}</td>
                      {[r.played, r.won, r.drawn, r.lost].map((v, i) => <td key={i} className="px-1.5 py-2.5 text-right font-mono text-[13px]">{v}</td>)}
                      <td className="py-2.5 pl-1.5 pr-5 text-right font-mono text-[13px] font-semibold">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 pb-4 pt-2 text-[12px] leading-relaxed text-muted">
                3 points for a win and 1 for a draw. Level on points and wins, the match between them decides, then an order drawn when the season began:{" "}
                {season!.lots.map((s) => cast[s].name).join(", ")}. The top four play the semi-finals.
              </p>
            </div>
          ) : (
            <p className="px-5 py-5 text-[14px] text-muted">The table fills in as the season&rsquo;s matches are played.</p>
          )}
        </Card>

        <Card className="lg:col-start-2 lg:row-start-1 lg:row-end-3">
          <CardHead title="Matches" action={season && <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{season.played} of {FINAL} played</span>} />
          {view && view.matches.length ? (
            <div className="divide-y-2 divide-edge">
              {rounds.map((r) => (
                <section key={r} aria-label={`Round ${r}`}>
                  <h3 className="bg-card-2 px-5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Round {r}</h3>
                  <ul className="divide-y divide-edge">{view.matches.filter((m) => m.round === r).map((m) => <Match key={m.number} m={m} cast={cast} stopped={stopped} />)}</ul>
                </section>
              ))}
              {knockout.length > 0 && (
                <section aria-label="The semi-finals and the final">
                  <h3 className="bg-card-2 px-5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Semi-finals and the final</h3>
                  <ul className="divide-y divide-edge">{knockout.map((m) => <Match key={m.number} m={m} cast={cast} stopped={stopped} />)}</ul>
                </section>
              )}
            </div>
          ) : (
            <p className="px-5 py-5 text-[14px] text-muted">Each match shows here once its season begins, with its Short.</p>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          {view && over.length > 0 && (
            <>
              <Champions over={over} cast={cast} />
              <CastRecords records={view.records} cast={cast} />
            </>
          )}

          <Card>
            <CardHead title="League health" />
            <p className="px-5 pt-4 text-[14px] leading-relaxed text-muted">In the league each power starts with its own health, set so every power can win a season.</p>
            <ul className="px-5 py-4 text-[14px]">
              {cast.length
                ? cast.map((b) => (
                    <li key={b.slot} className="flex items-center justify-between gap-3 border-b border-edge py-2">
                      <Ball ball={b} />
                      <span className="shrink-0 font-mono text-[12px] text-muted">{ABILITIES[b.power].name} · {health[b.power]} HP</span>
                    </li>
                  ))
                : // before the league has its balls, the powers on their own
                  ABILITY_IDS.map((p) => (
                    <li key={p} className="flex items-center justify-between gap-3 border-b border-edge py-2">
                      <span>{ABILITIES[p].name}</span>
                      <span className="shrink-0 font-mono text-[12px] text-muted">{health[p]} HP</span>
                    </li>
                  ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
