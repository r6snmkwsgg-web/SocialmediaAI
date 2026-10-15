"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import type { saveLive, SaveState } from "@/app/app/(shell)/live/actions";
import { DEFAULT_GIFTS, type MenuGift } from "@/lib/live/menu";
import type { GameId, LiveSettings } from "@/lib/live/settings";
import { button, Pill } from "./ui";

type Menu = { name: string; line: string }[];

type Props = {
  initial: LiveSettings;
  games: { id: GameId; name: string; line: string; join: string }[];
  /** each game's six menu items, to label the gift rows */
  menus: Record<GameId, Menu>;
  abilities: { id: string; name: string; color: string; line: string }[];
  allowed: { games: GameId[]; customMenus: boolean; planName: string };
  action: typeof saveLive;
};

const field = "w-full border-2 border-edge-strong bg-surface px-3 py-2 text-[15px] text-fg focus:border-fg focus:outline-none disabled:opacity-60";
const legend = "mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted";

/**
 * A streamer's settings for their LIVE game: which game, how long rounds
 * run, team names and colours, which champions can come up, their own
 * gifts on the menu, and the sound. Saved to their account; the game
 * reads them through its private address.
 */
export function LiveSettingsForm({ initial, games, menus, abilities, allowed, action }: Props) {
  const [s, setS] = useState<LiveSettings>(initial);
  const [own, setOwn] = useState(!!initial.gifts);
  const [gifts, setGifts] = useState<MenuGift[]>(initial.gifts ?? DEFAULT_GIFTS.map((g) => ({ ...g })));
  const [state, save, saving] = useActionState<SaveState, FormData>(action, null);
  const set = <K extends keyof LiveSettings>(k: K, v: LiveSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const value: LiveSettings = { ...s, gifts: own && allowed.customMenus ? gifts : null };
  const menu = menus[s.game];

  return (
    <form action={save} className="flex flex-col divide-y-2 divide-edge">
      <input type="hidden" name="settings" value={JSON.stringify(value)} />

      <fieldset className="px-5 py-5">
        <legend className={`${legend} float-left w-full`}>Game</legend>
        <div className="grid clear-both gap-2 md:grid-cols-3">
          {games.map((g) => {
            const off = !allowed.games.includes(g.id);
            const on = s.game === g.id;
            return (
              <label key={g.id} className={`relative flex cursor-pointer flex-col gap-1 border-2 px-4 py-3 transition has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-signal ${on ? "border-fg bg-card-2" : "border-edge hover:border-fg/50"} ${off ? "cursor-not-allowed opacity-60" : ""}`}>
                <input type="radio" name="game" value={g.id} checked={on} disabled={off} onChange={() => set("game", g.id)} className="sr-only" />
                <span className="flex items-center justify-between gap-2 font-display text-xl uppercase tracking-wide">
                  {g.name}
                  {off && <Pill tone="signal">Pro</Pill>}
                </span>
                <span className="text-[13px] leading-snug text-muted">{g.line}</span>
                <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{g.join} to join</span>
              </label>
            );
          })}
        </div>
        {allowed.games.length < games.length && (
          <p className="mt-3 text-[13px] text-muted">
            Ball Race and Last One Standing come with Pro. <Link href="/app/settings/billing" className="underline decoration-signal decoration-2 underline-offset-4">See plans</Link>
          </p>
        )}
      </fieldset>

      <fieldset className="grid gap-6 px-5 py-5 sm:grid-cols-2">
        <legend className={`${legend} float-left w-full sm:col-span-2`}>Rounds</legend>
        <label className="flex flex-col gap-2">
          <span className="flex items-baseline justify-between text-[14px]">
            Longest a round can run
            <span className="font-mono text-[13px] tabular-nums">{s.roundSeconds < 60 ? `${s.roundSeconds}s` : `${Math.floor(s.roundSeconds / 60)}m${s.roundSeconds % 60 ? ` ${s.roundSeconds % 60}s` : ""}`}</span>
          </span>
          <input type="range" min={30} max={300} step={15} value={s.roundSeconds} onChange={(e) => set("roundSeconds", Number(e.target.value))} className="accent-[var(--color-signal)]" />
          <span className="text-[12px] text-muted">Most rounds end sooner. When time&rsquo;s up, whoever&rsquo;s ahead wins. A race tops out at 75 seconds.</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={s.vote} onChange={(e) => set("vote", e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--color-signal)]" />
          <span className="flex flex-col gap-1">
            <span className="text-[14px]">Chat votes for the next round</span>
            <span className="text-[12px] text-muted">Three choices on the win screen. Viewers type A, B or C, and gifts add votes.</span>
          </span>
        </label>
      </fieldset>

      {s.game === "battle" && (
        <fieldset className="px-5 py-5">
          <legend className={`${legend} float-left w-full`}>Teams</legend>
          <div className="clear-both grid gap-3 sm:grid-cols-2">
            {s.teams.map((t, i) => (
              <div key={i} className="flex items-center gap-3">
                <label className="sr-only" htmlFor={`team-color-${i}`}>Team {i + 1} colour</label>
                <input
                  id={`team-color-${i}`}
                  type="color"
                  value={t.color}
                  onChange={(e) => set("teams", s.teams.map((x, j) => (j === i ? { ...x, color: e.target.value.toUpperCase() } : x)))}
                  className="h-11 w-14 shrink-0 cursor-pointer border-2 border-edge-strong bg-surface p-1"
                />
                <label className="sr-only" htmlFor={`team-name-${i}`}>Team {i + 1} name</label>
                <input
                  id={`team-name-${i}`}
                  value={t.name}
                  maxLength={12}
                  onChange={(e) => set("teams", s.teams.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  className={`${field} font-display text-lg uppercase tracking-wide`}
                />
                <span className="shrink-0 font-mono text-[11px] text-muted">type {i + 1}</span>
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {s.game === "battle" && (
        <fieldset className="px-5 py-5">
          <legend className={`${legend} float-left w-full`}>Champions that can come up</legend>
          <div className="clear-both flex flex-wrap gap-2">
            {abilities.map((a) => {
              const on = s.abilities.includes(a.id as LiveSettings["abilities"][number]);
              const last = on && s.abilities.length <= 2;
              return (
                <label key={a.id} title={a.line} className={`flex cursor-pointer items-center gap-2 border-2 px-3 py-2 transition has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-signal ${on ? "border-fg" : "border-edge text-muted"} ${last ? "cursor-not-allowed" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={last}
                    onChange={(e) => set("abilities", e.target.checked ? [...s.abilities, a.id as LiveSettings["abilities"][number]] : s.abilities.filter((x) => x !== a.id))}
                    className="sr-only"
                  />
                  <span className="h-3 w-3 rounded-full" style={{ background: on ? a.color : "transparent", boxShadow: `inset 0 0 0 2px ${a.color}` }} />
                  <span className="font-display text-base uppercase tracking-wide">{a.name}</span>
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] text-muted">Each round, two of these face off. Keep at least two on.</p>
        </fieldset>
      )}

      <fieldset className="px-5 py-5">
        <legend className={`${legend} float-left flex w-full items-center justify-between`}>
          <span>Gift menu</span>
          {!allowed.customMenus && <Pill tone="signal">Creator</Pill>}
        </legend>
        <label className={`clear-both mb-4 flex items-center gap-3 ${allowed.customMenus ? "" : "opacity-60"}`}>
          <input type="checkbox" checked={own && allowed.customMenus} disabled={!allowed.customMenus} onChange={(e) => setOwn(e.target.checked)} className="h-5 w-5 accent-[var(--color-signal)]" />
          <span className="text-[14px]">Use my own gifts and prices</span>
        </label>
        <ol className="grid gap-2">
          {menu.map((t, i) => {
            const g = own && allowed.customMenus ? gifts[i] : DEFAULT_GIFTS[i];
            const edit = own && allowed.customMenus;
            return (
              <li key={t.name} className="grid grid-cols-[1.6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[1.6rem_minmax(0,1.1fr)_minmax(0,1fr)_auto]">
                <span className="font-mono text-[11px] text-muted">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block font-display text-base uppercase leading-tight tracking-wide">{t.name}</span>
                  <span className="block truncate text-[12px] text-muted">{t.line}</span>
                </span>
                <label className="col-start-2 sm:col-start-auto">
                  <span className="sr-only">Gift for {t.name}</span>
                  <input value={g.name} disabled={!edit} maxLength={20} onChange={(e) => setGifts((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} className={field} />
                </label>
                <label className="col-start-2 flex items-center gap-2 sm:col-start-auto">
                  <span className="sr-only">Coins for {t.name}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100000}
                    value={g.coins}
                    disabled={!edit || i === 0}
                    onChange={(e) => setGifts((x) => x.map((y, j) => (j === i ? { ...y, coins: Math.max(1, Math.round(Number(e.target.value) || 1)) } : y)))}
                    className={`${field} w-28 tabular-nums`}
                  />
                  <span className="font-mono text-[10px] uppercase text-muted">coins</span>
                </label>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          {allowed.customMenus
            ? "Use the gift's exact name and price from TikTok, so viewers know what to send. The first costs 1 coin; each one after costs more."
            : `On ${allowed.planName}, the menu uses TikTok's best-known gifts. Creator lets you put your own on it.`}
        </p>
      </fieldset>

      <fieldset className="px-5 py-5">
        <legend className={`${legend} float-left w-full`}>Sound</legend>
        <label className="clear-both flex max-w-md flex-col gap-2">
          <span className="flex items-baseline justify-between text-[14px]">
            Game volume
            <span className="font-mono text-[13px] tabular-nums">{Math.round(s.volume * 100)}%</span>
          </span>
          <input type="range" min={0} max={100} step={5} value={Math.round(s.volume * 100)} onChange={(e) => set("volume", Number(e.target.value) / 100)} className="accent-[var(--color-signal)]" />
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4 px-5 py-5">
        <button type="submit" disabled={saving} className={button.primary}>{saving ? "Saving…" : "Save settings"}</button>
        {state && (
          <p role={state.ok ? "status" : "alert"} className={`text-[14px] ${state.ok ? "text-muted" : "text-signal"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
