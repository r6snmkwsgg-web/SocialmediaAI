"use client";
import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import type { saveLive, SaveState } from "@/app/app/(shell)/live/actions";
import type { Plan } from "@/lib/billing/plans";
import { DEFAULT_GIFTS, type MenuGift } from "@/lib/live/menu";
import { DEFAULT_SIDE_GIFTS, NAME_MAX, ownRivalryProblem, priceGaps, RIVAL_GROUPS, RIVAL_POWERS, RIVALRIES, rivalryLabel, sidesProblem, validSideGifts, type SideGifts } from "@/lib/live/rivals";
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
  /** point them at the plans for more games; not for someone who can't earn gifts on a LIVE yet */
  upsell?: boolean;
  /** rounds becoming Shorts: the plan's Shorts, which a round counts as one of, and why none can right now, when none can */
  clips: { shorts: Plan["shorts"]; note: React.ReactNode };
  action: typeof saveLive;
};

const field = "w-full border-2 border-edge-strong bg-surface px-3 py-2 text-[15px] text-fg focus:border-fg focus:outline-none disabled:opacity-60";
const legend = "mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted";

const SIDE_COLOR = { red: "#FF3B30", blue: "#0A84FF" } as const;
const dot = (side: keyof typeof SIDE_COLOR) => <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SIDE_COLOR[side] }} />;
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * A streamer's settings for their LIVE game: which game, how long rounds
 * run, whether the best become Shorts, team names and colours, which
 * champions can come up, their own gifts on the menu, Rivals' rivalries
 * and each side's gifts, and the sound. Saved to their account; the game
 * reads them through its private address.
 */
export function LiveSettingsForm({ initial, games, menus, abilities, allowed, upsell = true, clips, action }: Props) {
  const [s, setS] = useState<LiveSettings>(initial);
  const [own, setOwn] = useState(!!initial.gifts);
  const [gifts, setGifts] = useState<MenuGift[]>(initial.gifts ?? DEFAULT_GIFTS.map((g) => ({ ...g })));
  const [ownSides, setOwnSides] = useState(!!initial.rivals.gifts);
  const [sideGifts, setSideGifts] = useState<SideGifts>(initial.rivals.gifts ?? { red: DEFAULT_SIDE_GIFTS.red.map((g) => ({ ...g })), blue: DEFAULT_SIDE_GIFTS.blue.map((g) => ({ ...g })) });
  const [state, save, saving] = useActionState<SaveState, FormData>(action, null);
  const set = <K extends keyof LiveSettings>(k: K, v: LiveSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const value: LiveSettings = {
    ...s,
    gifts: own && allowed.customMenus ? gifts : null,
    rivals: { ...s.rivals, gifts: ownSides && allowed.customMenus ? sideGifts : null },
  };
  const menu = menus[s.game];
  const locked = games.filter((g) => !allowed.games.includes(g.id)).map((g) => g.name);
  const champions = s.game === "battle" || s.game === "rivals";
  const teamsProblem = sidesProblem(s.teams[0].name, s.teams[1].name);
  // why no round can become a Short right now: what the page knows first, then the game picked here
  const noClips = clips.note ?? (champions ? null : "Ball Race and Last One Standing rounds can't become Shorts yet.");

  return (
    <form
      action={save}
      // saved in a transition: a form's own submit puts every box back as it was first drawn once it's saved, so a box just unticked would show ticked
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => save(data));
      }}
      className="flex flex-col divide-y-2 divide-edge"
    >
      <input type="hidden" name="settings" value={JSON.stringify(value)} />

      <fieldset className="px-5 py-5">
        <legend className={`${legend} float-left w-full`}>Game</legend>
        <div className="grid clear-both gap-2 sm:grid-cols-2">
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
        {locked.length > 0 && upsell && (
          <p className="mt-3 text-[13px] text-muted">
            {andList(locked)} {locked.length === 1 ? "comes" : "come"} with Pro. <Link href="/app/settings/billing" className="underline decoration-signal decoration-2 underline-offset-4">See plans</Link>
          </p>
        )}
      </fieldset>

      <fieldset className="grid gap-6 px-5 py-5 sm:grid-cols-2">
        <legend className={`${legend} float-left w-full sm:col-span-2`}>Rounds</legend>
        <label className="flex flex-col gap-2 sm:row-span-2">
          <span className="flex items-baseline justify-between text-[14px]">
            Longest a round can run
            <span className="font-mono text-[13px] tabular-nums">{s.roundSeconds < 60 ? `${s.roundSeconds}s` : `${Math.floor(s.roundSeconds / 60)}m${s.roundSeconds % 60 ? ` ${s.roundSeconds % 60}s` : ""}`}</span>
          </span>
          <input type="range" min={30} max={300} step={15} value={s.roundSeconds} onChange={(e) => set("roundSeconds", Number(e.target.value))} className="accent-[var(--color-signal)]" />
          <span className="text-[12px] text-muted">Most rounds end sooner. When time&rsquo;s up, whoever&rsquo;s ahead wins. A race tops out at 75 seconds.</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={s.vote} onChange={(e) => set("vote", e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-signal)]" />
          <span className="flex flex-col gap-1">
            <span className="text-[14px]">Chat votes for the next round</span>
            <span className="text-[12px] text-muted">Three choices on the win screen. Viewers type A, B or C, and every coin they gift is a vote.</span>
          </span>
        </label>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={s.clips} onChange={(e) => set("clips", e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-signal)]" />
            <span className="flex flex-col gap-1">
              <span className="text-[14px]">Best rounds become Shorts</span>
              <span className="text-[12px] leading-relaxed text-muted">
                When a Ball Battle or Rivals round is worth watching again, the game keeps how it played. The best one waits in your Shorts the next morning, redrawn in your channel&rsquo;s look.{" "}
                {clips.shorts.per === "day" ? "It counts as one of that day's Shorts." : `It counts as one of that week's ${clips.shorts.count} Shorts.`}
              </span>
              <span className="text-[12px] leading-relaxed text-muted">
                Nobody&rsquo;s name is in it unless you choose to show the names of people who sent gifts. Pictures never are. Only LIVEs that count as yours: your connected TikTok, heard through Hookline Bridge.
              </span>
              <span className="text-[12px] leading-relaxed text-muted">Turn it off and the rounds waiting are deleted.</span>
            </span>
          </label>
          {noClips && <p className="ml-8 text-[12px] leading-relaxed text-fg">{noClips}</p>}
        </div>
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
          {teamsProblem && <p role="alert" className="mt-2 max-w-2xl text-[13px] text-signal">{teamsProblem}</p>}
        </fieldset>
      )}

      {s.game === "rivals" && <RivalriesField value={s.rivals} onChange={(r) => set("rivals", r)} />}

      {champions && (
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
          <p className="mt-3 text-[12px] text-muted">
            {s.game === "rivals" ? "Each round, one of these fights for both sides, so it's the gifts that decide it. Keep at least two on." : "Each round, two of these face off. Keep at least two on."}
          </p>
        </fieldset>
      )}

      {s.game === "rivals" ? (
        <SideGiftsField own={ownSides} setOwn={setOwnSides} gifts={sideGifts} setGifts={setSideGifts} allowed={allowed} />
      ) : (
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
      )}

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

/** Which rivalries come up: Hookline's, by group, and the streamer's own. */
function RivalriesField({ value, onChange }: { value: LiveSettings["rivals"]; onChange: (r: LiveSettings["rivals"]) => void }) {
  const [red, setRed] = useState("");
  const [blue, setBlue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const politics = value.groups.includes("politics");
  const add = () => {
    const why = ownRivalryProblem(red, blue) ?? (value.own.length >= 12 ? "That's 12 of your own. Take one off to add another." : null);
    if (why) return setProblem(why);
    onChange({ ...value, own: [...value.own, { red: red.trim(), blue: blue.trim() }] });
    setRed("");
    setBlue("");
    setProblem(null);
  };
  // Enter adds the rivalry, rather than saving the whole form
  const enter = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    add();
  };

  return (
    <fieldset className="px-5 py-5">
      <legend className={`${legend} float-left w-full`}>Rivalries</legend>
      <p className="clear-both mb-4 max-w-2xl text-[13px] leading-relaxed text-muted">
        Every round is a different one, red against blue. With the vote on, chat picks the next from three.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {RIVAL_GROUPS.map((g) => {
          const on = value.groups.includes(g.id);
          return (
            <label key={g.id} className={`flex cursor-pointer items-start gap-3 border-2 px-4 py-3 transition has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-signal ${on ? "border-fg" : "border-edge hover:border-fg/50"}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => onChange({ ...value, groups: e.target.checked ? [...value.groups, g.id] : value.groups.filter((x) => x !== g.id) })}
                className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-signal)]"
              />
              <span className="min-w-0">
                <span className="block font-display text-lg uppercase leading-tight tracking-wide">{g.name}</span>
                <span className="mt-1 block text-[12px] leading-snug text-muted">{RIVALRIES.filter((r) => r.group === g.id).map(rivalryLabel).join(" · ")}</span>
                {g.note && <span className="mt-1 block text-[12px] leading-snug text-fg/80">{g.note}</span>}
              </span>
            </label>
          );
        })}
      </div>
      <p className={`mt-3 max-w-2xl text-[12px] leading-relaxed ${politics ? "text-fg" : "text-muted"}`}>
        {politics && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal">Politics is on · </span>}
        TikTok is strict about LIVEs that stir up politics for gifts, and in 2024 it banned some creators who ran political fights from LIVE matches. Keep it about the parties, never the people in your chat.
      </p>

      <div className="mt-6">
        <p className="mb-2 text-[14px]">Your own</p>
        {value.own.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-2">
            {value.own.map((r, i) => (
              <li key={`${i}-${r.red}-${r.blue}`} className="flex items-center gap-2 border-2 border-edge py-1 pl-3 pr-1">
                {dot("red")}
                <span className="font-display text-base uppercase tracking-wide">{r.red}</span>
                <span className="font-mono text-[10px] uppercase text-muted">vs</span>
                {dot("blue")}
                <span className="font-display text-base uppercase tracking-wide">{r.blue}</span>
                <button type="button" onClick={() => onChange({ ...value, own: value.own.filter((_, j) => j !== i) })} className="px-2 py-1 text-muted hover:text-fg" aria-label={`Take off ${rivalryLabel(r)}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-56">
            {dot("red")}
            <span className="sr-only">Red side</span>
            <input value={red} maxLength={NAME_MAX} placeholder="Red side" onChange={(e) => setRed(e.target.value)} onKeyDown={enter} className={`${field} font-display uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal`} />
          </label>
          <span className="font-mono text-[11px] uppercase text-muted">vs</span>
          <label className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-56">
            {dot("blue")}
            <span className="sr-only">Blue side</span>
            <input value={blue} maxLength={NAME_MAX} placeholder="Blue side" onChange={(e) => setBlue(e.target.value)} onKeyDown={enter} className={`${field} font-display uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal`} />
          </label>
          <button type="button" onClick={add} className={button.secondary}>Add</button>
        </div>
        {problem ? (
          <p role="alert" className="mt-2 max-w-2xl text-[13px] text-signal">{problem}</p>
        ) : (
          <p className="mt-2 text-[12px] text-muted">Up to {NAME_MAX} letters a side. Things people pick, like teams, games or food, never countries, religion, race, gender or who people love.</p>
        )}
      </div>
    </fieldset>
  );
}

/** Each side's three gifts, for the same three powers. */
function SideGiftsField({ own, setOwn, gifts, setGifts, allowed }: {
  own: boolean;
  setOwn: (v: boolean) => void;
  gifts: SideGifts;
  setGifts: React.Dispatch<React.SetStateAction<SideGifts>>;
  allowed: Props["allowed"];
}) {
  const edit = own && allowed.customMenus;
  const g = edit ? gifts : DEFAULT_SIDE_GIFTS;
  const ok = validSideGifts(g);
  const gaps = ok ? priceGaps(g) : [];
  const change = (side: keyof SideGifts, i: number, v: Partial<MenuGift>) => setGifts((x) => ({ ...x, [side]: x[side].map((y, j) => (j === i ? { ...y, ...v } : y)) }));

  return (
    <fieldset className="px-5 py-5">
      <legend className={`${legend} float-left flex w-full items-center justify-between`}>
        <span>Each side&rsquo;s gifts</span>
        {!allowed.customMenus && <Pill tone="signal">Creator</Pill>}
      </legend>
      <p className="clear-both mb-4 max-w-2xl text-[13px] leading-relaxed text-muted">
        Both sides get the same three powers, and each sets them off with its own gifts, so the gift someone sends is the side they&rsquo;re on. Any other gift helps the side they&rsquo;re on: a Rose heals, one that costs as much as a power sets it off, and one that costs more than the meteor brings down more of them.
      </p>
      <label className={`mb-4 flex items-center gap-3 ${allowed.customMenus ? "" : "opacity-60"}`}>
        <input type="checkbox" checked={edit} disabled={!allowed.customMenus} onChange={(e) => setOwn(e.target.checked)} className="h-5 w-5 accent-[var(--color-signal)]" />
        <span className="text-[14px]">Use my own gifts and prices</span>
      </label>
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.25fr)] gap-3 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted sm:grid">
        <span>Power</span>
        <span className="flex items-center gap-2">{dot("red")} Red side</span>
        <span className="flex items-center gap-2">{dot("blue")} Blue side</span>
      </div>
      <ol className="grid gap-4 sm:gap-2">
        {RIVAL_POWERS.map((p, i) => (
          <li key={p.effect} className="grid gap-2 border-t border-edge pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.25fr)] sm:items-center sm:gap-3 sm:pt-2">
            <span className="min-w-0">
              <span className="block font-display text-base uppercase leading-tight tracking-wide">{p.name}</span>
              <span className="block text-[12px] leading-snug text-muted">{p.line}</span>
            </span>
            {(["red", "blue"] as const).map((side) => (
              <span key={side} className="flex min-w-0 items-center gap-2">
                <span className="sm:hidden">{dot(side)}</span>
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{side === "red" ? "Red" : "Blue"} side&rsquo;s gift for {p.name}</span>
                  <input value={g[side][i].name} disabled={!edit} maxLength={20} onChange={(e) => change(side, i, { name: e.target.value })} className={field} />
                </label>
                <label className="flex shrink-0 items-center gap-1.5">
                  <span className="sr-only">Coins for the {side} side&rsquo;s {p.name}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100000}
                    value={g[side][i].coins}
                    disabled={!edit}
                    onChange={(e) => change(side, i, { coins: Math.min(100000, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                    className={`${field} w-24 tabular-nums`}
                  />
                </label>
              </span>
            ))}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex max-w-2xl flex-col gap-1 text-[12px] leading-relaxed">
        {!ok && <p role="alert" className="text-signal">Each side needs three different gifts, each costing more than the one before, and no gift on both sides. Until then, the game uses Hookline&rsquo;s.</p>}
        {gaps.map((x) => (
          <p key={x.power} className="text-muted">
            {x.power}: red pays {x.red.toLocaleString("en-US")} coins, blue pays {x.blue.toLocaleString("en-US")}. Gifts at the same price keep it fair.
          </p>
        ))}
        {!edit && <p className="text-muted">Each pair costs the same, and anyone can send them: none needs a gifter level.</p>}
        {!allowed.customMenus && <p className="text-muted">On {allowed.planName}, each side uses these gifts. Creator lets you pick your own.</p>}
      </div>
    </fieldset>
  );
}
