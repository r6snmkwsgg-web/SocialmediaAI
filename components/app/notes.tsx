import Link from "next/link";
import type { NoteKind, Notification } from "@/lib/server/notify";
import { Icons } from "./icons";
import { LocalTime } from "./local-time";

/** A notification as the screen gets it: plain values, ready to cross to the browser. */
export type NoteView = { id: string; kind: NoteKind; title: string; body: string | null; href: string | null; at: string; read: boolean };

export const toView = (n: Notification): NoteView => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, at: n.createdAt.toISOString(), read: n.read });

const ICON: Record<NoteKind, (p: { className?: string }) => React.JSX.Element> = {
  posted: Icons.check,
  failed: Icons.alert,
  ready: Icons.shorts,
  results: Icons.trends,
  live: Icons.live,
  plan: Icons.card,
  account: Icons.plug,
};

export function NoteIcon({ kind }: { kind: NoteKind }) {
  const I = ICON[kind];
  const tone = kind === "failed" || kind === "account" ? "border-signal text-signal" : kind === "results" ? "border-signal bg-signal text-ink" : "border-edge-strong text-fg";
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center border-2 ${tone}`} aria-hidden="true">
      <I className="h-4 w-4" />
    </span>
  );
}

/** One notification: what happened, a line more, and when; a link when there's somewhere to go. */
export function NoteRow({ n, onGo, compact = false }: { n: NoteView; onGo?: () => void; compact?: boolean }) {
  const inner = (
    <>
      <NoteIcon kind={n.kind} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[14px] font-semibold leading-snug">{n.title}</span>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            <LocalTime iso={n.at} style="ago" />
          </span>
        </span>
        {n.body && <span className={`mt-0.5 block text-[13px] leading-snug text-muted ${compact ? "line-clamp-2" : ""}`}>{n.body}</span>}
      </span>
      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 bg-signal" aria-label="New" />}
    </>
  );
  const cls = "flex items-start gap-3 px-4 py-3";
  return n.href ? (
    <Link href={n.href} onClick={onGo} className={`${cls} transition hover:bg-card-2`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
