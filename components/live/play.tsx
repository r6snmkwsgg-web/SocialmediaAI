"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { lastGoodKey, OLD_ADDRESS, readLastGood, writeLastGood, type LastGood } from "@/lib/live/last-good";
import type { Heard } from "@/lib/live/proof";
import { sessionPayload } from "@/lib/live/session";
import { parseSettings } from "@/lib/live/settings";
import type { Show } from "@/lib/live/show";
import { overlayUpdate } from "@/lib/live/supporters";
import { LiveGame } from "./game";

type Props = Omit<React.ComponentProps<typeof LiveGame>, "onStats" | "status" | "hideNames"> & {
  overlayKey?: string;
  /** Hookline couldn't load this key's settings just now: not the same as a key that's gone */
  unsure?: boolean;
};

/** how often the game asks Hookline again: for its settings when it couldn't load them, and otherwise whether names are hidden and who to welcome back */
const ASK_EVERY = 30_000;

function load(key: string): LastGood | null {
  try {
    return readLastGood(localStorage.getItem(lastGoodKey(key)));
  } catch {
    return null;
  }
}

function keep(key: string, g: LastGood) {
  try {
    localStorage.setItem(lastGoodKey(key), writeLastGood(g));
  } catch {
    // a browser source that can't store anything just won't have a fallback
  }
}

/**
 * The game as a streamer runs it from their own address: it saves the
 * session's numbers to their account as it goes, with the TikTok LIVEs it
 * heard, so Hookline can tell whether they were the streamer's own.
 * Without a key it's the plain game, and saves nothing.
 *
 * Each time its settings load, it keeps them. If Hookline can't be reached
 * when it opens, it plays with the ones it kept; with none kept, it plays
 * the plain game and says it's reconnecting, asks again every half
 * minute, and switches to the streamer's settings once they come.
 *
 * While it plays, it asks every half minute whether names are hidden and
 * who to welcome back. Those are the only two things that change in a
 * game that's open; the rest waits for a reload.
 */
export function Play({ overlayKey, unsure = false, settings, tag, notice: given, supporters: first = [], ...props }: Props) {
  const last = useRef("");
  // null while it looks for what it kept, which only the browser can do
  const [game, setGame] = useState<(LastGood & { waiting: boolean }) | null>(unsure ? null : { settings: parseSettings(settings ?? {}), tag: !!tag, waiting: false });
  const [gone, setGone] = useState(false);
  const [round, setRound] = useState(0);
  // what the asking has heard since it opened; until it hears, names go by the settings
  const [hideNames, setHideNames] = useState<boolean>();
  const [supporters, setSupporters] = useState(first);
  const key = gone ? undefined : overlayKey;

  useEffect(() => {
    if (!overlayKey) return;
    if (!unsure) {
      if (settings) keep(overlayKey, { settings: parseSettings(settings), tag: !!tag });
      return;
    }
    const kept = load(overlayKey);
    setGame(kept ? { ...kept, waiting: false } : { settings: parseSettings(settings ?? {}), tag: false, waiting: true });
  }, [overlayKey, unsure, settings, tag]);

  // nothing kept: ask again until the settings come, then start over with them
  const waiting = !!game?.waiting && !gone;
  useEffect(() => {
    if (!overlayKey || !waiting) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/live/overlay?key=${encodeURIComponent(overlayKey)}`, { cache: "no-store" }).catch(() => null);
      if (!res) return;
      if (res.status === 404) return setGone(true);
      if (!res.ok) return;
      const j = (await res.json().catch(() => null)) as { settings?: unknown; tag?: unknown } | null;
      if (!j?.settings) return;
      const got = { settings: parseSettings(j.settings), tag: j.tag !== false };
      keep(overlayKey, got);
      setGame({ ...got, waiting: false });
      const u = overlayUpdate(j);
      if (u) {
        setHideNames(u.hideNames);
        setSupporters(u.supporters);
      }
      setRound((r) => r + 1);
    }, ASK_EVERY);
    return () => clearInterval(t);
  }, [overlayKey, waiting]);

  // playing with settings it has: ask whether names are hidden and who to welcome back. A failed or odd answer changes nothing, and a gone key waits for a reload.
  useEffect(() => {
    if (!overlayKey || !game || game.waiting || gone) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/live/overlay?key=${encodeURIComponent(overlayKey)}`, { cache: "no-store" }).catch(() => null);
      const u = res?.ok ? overlayUpdate(await res.json().catch(() => null)) : null;
      if (!u) return;
      setHideNames(u.hideNames);
      setSupporters(u.supporters);
      // kept with the new choice, so a reload while Hookline is down still hides names; the ids are never kept
      keep(overlayKey, { settings: { ...game.settings, hideNames: u.hideNames }, tag: game.tag });
    }, ASK_EVERY);
    return () => clearInterval(t);
  }, [overlayKey, game, gone]);

  const onStats = useCallback(
    (show: Show, final: boolean, heard: Heard) => {
      if (!key) return;
      const p = sessionPayload(show, key, heard);
      if (!p) return;
      const json = JSON.stringify(p);
      if (json === last.current) return;
      last.current = json;
      // a page that's closing can only send a beacon
      if (final && navigator.sendBeacon?.("/api/live/sessions", new Blob([json], { type: "application/json" }))) return;
      void fetch("/api/live/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: json, keepalive: final }).catch(() => {
        last.current = "";
      });
    },
    [key],
  );

  if (!game) return <div className="fixed inset-0 bg-[#050506]" />;
  return (
    <LiveGame
      key={round}
      {...props}
      settings={game.settings}
      tag={game.tag}
      hideNames={hideNames}
      supporters={supporters}
      notice={gone ? OLD_ADDRESS : given}
      status={waiting ? "RECONNECTING TO HOOKLINE…" : undefined}
      onStats={key ? onStats : undefined}
    />
  );
}
