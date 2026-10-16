import type { Channel, Platform } from "@/lib/server/channels";
import { KIDS_GUIDE, YT_PRIVACY, YT_PRIVACY_LABEL, type YouTubePrivacy } from "@/lib/shorts/youtube";
import { Icons } from "./icons";
import { button, Pill } from "./ui";

/**
 * Connecting YouTube and TikTok: what each one is for, whether it's
 * connected, and the button that connects it. Used in onboarding and in
 * Settings. A connected YouTube channel also says who it's for (made for
 * kids or not, asked with nothing picked, since YouTube needs the creator
 * to say) and who sees new Shorts; nothing posts to it until that's
 * answered.
 */

const ABOUT: Record<Platform, { name: string; why: string; whyBeforeAudit?: string; whySelf?: string; whyNoProfile?: string }> = {
  youtube: {
    name: "YouTube",
    why: "Posts the Shorts you approve and reads how they do.",
    whyBeforeAudit: "Checks the Shorts you post and reads how they do. Posting for you comes once YouTube approves Hookline.",
    whySelf: "Checks the Shorts you post and reads how they do.",
  },
  tiktok: {
    name: "TikTok",
    why: "Posts to TikTok where TikTok allows it, reads your views, and shows your LIVEs are yours.",
    // until TikTok gives Hookline the username, it can't tell which LIVEs are theirs
    whyNoProfile: "Posts to TikTok where TikTok allows it, and reads your views.",
  },
};

const PRIVACY_ABOUT: Record<YouTubePrivacy, string> = {
  public: "Everyone. It goes public at its time.",
  unlisted: "Only people with the link.",
  private: "Only you, until you make it public in YouTube Studio.",
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

const small = "font-mono text-[11px] uppercase tracking-[0.16em] text-muted";
const radio = "mt-1 h-4 w-4 shrink-0 accent-[var(--color-signal)]";

/** Made for kids or not, and who sees new Shorts: the question for a YouTube channel. */
function AudienceForm({ channel, action, next }: { channel: Channel; action: (form: FormData) => Promise<void>; next: string }) {
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={channel.id} />
      <input type="hidden" name="next" value={next} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[15px] font-semibold">Is this channel made for kids?</legend>
        <p className="text-[13px] leading-relaxed text-muted">
          YouTube needs you to say. Made for kids turns comments off and shows fewer ads.{" "}
          <a href={KIDS_GUIDE} target="_blank" rel="noreferrer" className="underline underline-offset-4">How YouTube decides</a>
        </p>
        <label className="flex items-start gap-2.5 text-[14px]">
          <input type="radio" name="kids" value="yes" required defaultChecked={channel.madeForKids === true} className={radio} />
          Yes, it&rsquo;s made for kids
        </label>
        <label className="flex items-start gap-2.5 text-[14px]">
          <input type="radio" name="kids" value="no" defaultChecked={channel.madeForKids === false} className={radio} />
          No, it&rsquo;s not made for kids
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[15px] font-semibold">Who sees new Shorts</legend>
        {YT_PRIVACY.map((p) => (
          <label key={p} className="flex items-start gap-2.5 text-[14px]">
            <input type="radio" name="privacy" value={p} defaultChecked={channel.privacy === p} className={radio} />
            <span><b className="font-semibold">{YT_PRIVACY_LABEL[p]}</b>: {PRIVACY_ABOUT[p]}</span>
          </label>
        ))}
      </fieldset>
      <button type="submit" className={`${button.primary} self-start`}>Save</button>
    </form>
  );
}

function Audience({ channel, action, next, posts }: { channel: Channel; action?: (form: FormData) => Promise<void>; next: string; posts: boolean }) {
  return (
    <div id="audience" className="flex flex-col gap-3 border-t-2 border-edge px-4 py-4">
      {channel.youtubeKids && (
        <p className="border-l-4 border-signal pl-3 text-[13px] leading-relaxed">YouTube has this channel set as made for kids: comments are off on all its videos.</p>
      )}
      {channel.madeForKids === null ? (
        action ? (
          <>
            <p className="text-[14px] leading-relaxed">One question before anything posts to this channel.</p>
            <AudienceForm channel={channel} action={action} next={next} />
          </>
        ) : (
          <p className="text-[14px]">Say whether this channel is made for kids, in Settings, before anything posts to it.</p>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <p className={small}>
            For kids: {channel.madeForKids ? "Yes" : "No"} · New Shorts: {YT_PRIVACY_LABEL[channel.privacy]}
          </p>
          {action && (
            <details>
              <summary className={`${button.quiet} cursor-pointer list-none`}>Change</summary>
              <div className="pt-4">
                <AudienceForm channel={channel} action={action} next={next} />
              </div>
            </details>
          )}
        </div>
      )}
      {!(posts && channel.api) && (
        <p className="text-[13px] leading-relaxed text-muted">
          {posts ? "Until YouTube finishes reviewing Hookline, you post Shorts yourself." : "You post Shorts yourself."} Hookline checks the links you paste and reads their views.
        </p>
      )}
    </div>
  );
}

export function ConnectList({
  platforms,
  channels,
  ready,
  next,
  disconnect,
  audience,
  youtubeApi = false,
  posts = false,
  tiktokProfile = false,
}: {
  platforms: Platform[];
  channels: Channel[];
  ready: Record<Platform, boolean>;
  next: string;
  disconnect?: (form: FormData) => Promise<void>;
  /** saves a YouTube channel's answers; without it, the question points to Settings */
  audience?: (form: FormData) => Promise<void>;
  /** Hookline posts to YouTube for everyone (its API audit has passed) */
  youtubeApi?: boolean;
  /** their plan posts Shorts for them; on Free they post their own */
  posts?: boolean;
  /** TikTok tells Hookline the account's username, so a LIVE can be shown to be theirs */
  tiktokProfile?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {platforms.map((p) => {
        const mine = channels.filter((c) => c.platform === p);
        const live = mine.find((c) => c.status === "connected");
        const broken = mine.find((c) => c.status !== "connected");
        const why =
          p === "tiktok" ? (tiktokProfile ? ABOUT[p].why : ABOUT[p].whyNoProfile!) : !posts ? ABOUT[p].whySelf! : youtubeApi ? ABOUT[p].why : ABOUT[p].whyBeforeAudit!;
        return (
          <li key={p} className="border-2 border-edge bg-card">
            <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:flex-nowrap">
              <PlatformMark platform={p} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-xl uppercase tracking-wide">{ABOUT[p].name}</p>
                <p className="text-[14px] leading-snug text-muted">{live ? (live.title ?? live.handle ?? "Connected") : why}</p>
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
            </div>
            {p === "youtube" && live && <Audience channel={live} action={audience} next={next} posts={posts} />}
          </li>
        );
      })}
    </ul>
  );
}
