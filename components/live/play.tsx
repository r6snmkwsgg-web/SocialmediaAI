"use client";
import { useCallback, useRef } from "react";
import { sessionPayload } from "@/lib/live/session";
import type { Show } from "@/lib/live/show";
import { LiveGame } from "./game";

type Props = Omit<React.ComponentProps<typeof LiveGame>, "onStats"> & { overlayKey?: string };

/**
 * The game as a streamer runs it from their own address: it saves the
 * session's numbers to their account as it goes. Without a key it's the
 * plain game, and saves nothing.
 */
export function Play({ overlayKey, ...props }: Props) {
  const last = useRef("");
  const onStats = useCallback(
    (show: Show, final: boolean) => {
      if (!overlayKey) return;
      const p = sessionPayload(show, overlayKey);
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
    [overlayKey],
  );
  return <LiveGame {...props} onStats={overlayKey ? onStats : undefined} />;
}
