import type { Channel, Platform } from "@/lib/server/channels";
import { Icons } from "./icons";
import { Pill } from "./ui";

/**
 * Connecting YouTube and TikTok: what each one is for, whether it's
 * connected, and the button that connects it. Used in onboarding and in
 * Settings.
 */

const ABOUT: Record<Platform, { name: string; why: string }> = {
  youtube: { name: "YouTube", why: "Posts the Shorts you approve and reads how they do." },
  tiktok: { name: "TikTok", why: "Posts to TikTok where TikTok allows it, and reads your views." },
};

export function PlatformMark({ platform, className = "h-9 w-9" }: { platform: Platform; className?: string }) {
  return platform === "youtube" ? (
    <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
      <rect width="36" height="36" fill="#FF0033" />
      <path d="M14 11.5v13l11-6.5z" fill="#fff" />
    </svg>
  ) : (
    <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
      <rect width="36" height="36" fill="#0b0b0c" />
      <path d="M20.5 8.5v12.2a3.9 3.9 0 1 1-3.4-3.9" fill="none" stroke="#25F4EE" strokeWidth="2.6" transform="translate(-1 -1)" />
      <path d="M20.5 8.5v12.2a3.9 3.9 0 1 1-3.4-3.9" fill="none" stroke="#FE2C55" strokeWidth="2.6" transform="translate(1 1)" />
      <path d="M20.5 8.5v12.2a3.9 3.9 0 1 1-3.4-3.9M20.5 8.5c.4 2.6 2.3 4.4 5 4.6" fill="none" stroke="#fff" strokeWidth="2.6" />
    </svg>
  );
}

export function ConnectList({ platforms, channels, ready, next, disconnect }: { platforms: Platform[]; channels: Channel[]; ready: Record<Platform, boolean>; next: string; disconnect?: (form: FormData) => Promise<void> }) {
  return (
    <ul className="flex flex-col gap-3">
      {platforms.map((p) => {
        const mine = channels.filter((c) => c.platform === p);
        const live = mine.find((c) => c.status === "connected");
        const broken = mine.find((c) => c.status !== "connected");
        return (
          <li key={p} className="flex flex-wrap items-center gap-4 border-2 border-edge bg-card px-4 py-4 sm:flex-nowrap">
            <PlatformMark platform={p} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl uppercase tracking-wide">{ABOUT[p].name}</p>
              <p className="text-[14px] leading-snug text-muted">
                {live ? (live.title ?? live.handle ?? "Connected") : ABOUT[p].why}
              </p>
            </div>
            {live ? (
              <div className="flex items-center gap-4">
                <Pill tone="good"><Icons.check className="h-3 w-3" /> Connected</Pill>
                {disconnect && (
                  <form action={disconnect}>
                    <input type="hidden" name="id" value={live.id} />
                    <button type="submit" className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted underline-offset-4 hover:text-signal hover:underline">
                      Disconnect
                    </button>
                  </form>
                )}
              </div>
            ) : ready[p] ? (
              <a href={`/api/connect/${p}?next=${encodeURIComponent(next)}`} className="inline-flex items-center gap-2 border-2 border-fg px-4 py-2 font-display text-base uppercase tracking-wider transition hover:bg-fg hover:text-surface">
                {broken ? "Reconnect" : "Connect"}
              </a>
            ) : (
              <Pill>Not set up yet</Pill>
            )}
          </li>
        );
      })}
    </ul>
  );
}
