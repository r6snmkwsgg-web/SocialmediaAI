import { PLANS } from "@/lib/billing/plans";
import type { Channel, Platform } from "@/lib/server/channels";
import { isActive, uploadsTo } from "@/lib/shorts/channels";
import { KIDS_GUIDE, YT_PRIVACY, YT_PRIVACY_LABEL, type YouTubePrivacy } from "@/lib/shorts/youtube";
import { Icons } from "./icons";
import { button, Pill } from "./ui";

/**
 * Connecting YouTube and TikTok: what each one is for, the accounts
 * connected, and the button that connects one. Used in onboarding,
 * Settings and Earnings. Each YouTube channel is listed with where it
 * stands, and says who it's for (made for kids or not, asked with nothing
 * picked, since YouTube needs the creator to say) and who sees new Shorts;
 * nothing posts to it until that's answered. Where the plan has room for
 * more than one channel, each also says whether it gets Shorts. TikTok is
 * one account.
 */

const ABOUT: Record<Platform, { name: string; why: string; whyBeforeAudit?: string; whySelf?: string; whyNoProfile?: string; whyLive?: string }> = {
  youtube: {
    name: "YouTube",
    why: "Posts the Shorts you approve and reads how they do.",
    whyBeforeAudit: "Checks the Shorts you post and reads how they do. Posting for you comes once YouTube approves Hookline.",
    whySelf: "Checks the Shorts you post and reads how they do.",
    // with YouTube Live on, it's also how the LIVE game hears the creator's own stream
    whyLive: "It also plays your LIVE game with your stream's chat.",
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

/** Where each account stands, as its pill says it. */
const STATE: Record<Channel["status"], { label: string; tone: "good" | "warn" | "plain" }> = {
  connected: { label: "Connected", tone: "good" },
  expired: { label: "Needs reconnecting", tone: "warn" },
  revoked: { label: "Disconnected", tone: "plain" },
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
const connectButton = "inline-flex items-center gap-2 border-2 border-fg px-4 py-2 font-display text-base uppercase tracking-wider transition hover:bg-fg hover:text-surface";
const quietAction = "font-mono text-[11px] uppercase tracking-[0.14em] text-muted underline-offset-4 hover:text-signal hover:underline";

/** A channel as listed: `name` tells apart two that share a title, where the page has it. */
type Listed = Channel & { name?: string };

const nameOf = (c: Listed) => c.name ?? c.title ?? c.handle ?? (c.platform === "youtube" ? "Your channel" : "Your TikTok");

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
    // a link here lands with the channel's name still in view above it
    <div id={`audience-${channel.id}`} className="flex scroll-mt-40 flex-col gap-3 border-t-2 border-edge px-4 py-4">
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

/**
 * Whether a YouTube channel gets new Shorts, shown where the plan has room
 * for more than one channel, more are connected than it has room for, or
 * it's switched off (so it can be switched on again). One switched on past
 * the plan's room says why it gets none. The form carries `shortsShown`
 * beside the checkbox, so a save from a form without the checkbox never
 * switches Shorts off.
 */
function ChannelShorts({ channel, action, room, active, getting, plan, posts, saved }: {
  channel: Channel;
  action: (form: FormData) => Promise<void>;
  /** how many YouTube channels the plan makes Shorts for, and how many the account has that aren't disconnected */
  room: number;
  active: number;
  /** the channels that get Shorts now */
  getting: string[];
  plan: string;
  posts: boolean;
  /** this channel's settings were just saved */
  saved: boolean;
}) {
  if (!(room > 1 || active > room || !channel.shortsOn)) return null;
  const beyond = channel.shortsOn && !getting.includes(channel.id);
  return (
    <div id={`channel-${channel.id}`} className="scroll-mt-40 border-t-2 border-edge px-4 py-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={channel.id} />
        <input type="hidden" name="shortsShown" value="1" />
        <label className="flex items-start gap-3">
          <input type="checkbox" name="shortsOn" defaultChecked={channel.shortsOn} className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-signal)]" />
          <span className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold">Make Shorts for this channel</span>
            <span className="max-w-2xl text-[13px] leading-relaxed text-muted">
              Each day, in its own look, at its own best times. Off: no new ones. {uploadsTo(channel, posts) ? "Shorts you've kept still post." : "Shorts you've kept stay for you to post."}
            </span>
          </span>
        </label>
        {beyond && (
          <p className="border-l-4 border-signal pl-3 text-[13px] leading-relaxed">
            No new Shorts on {plan}.{" "}
            {room === 1
              ? "It makes Shorts for one channel, the first connected that's switched on. Switch that one off to give this one its place"
              : `It makes Shorts for ${room} channels, the first connected that are switched on. Switch one of those off to give this one its place`}
            {room < PLANS.creator.channels ? ", or move to Creator" : ""}.
          </p>
        )}
        <div className="flex items-center gap-4">
          <button type="submit" className={button.secondary}>Save</button>
          {saved && <span role="status" className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Saved</span>}
        </div>
      </form>
    </div>
  );
}

/** One connected account: what it is, where it stands, and what can be done about it. */
function AccountRow({ c, href, ready, disconnect }: { c: Listed; href: string; ready: boolean; disconnect?: (form: FormData) => Promise<void> }) {
  const s = STATE[c.status];
  const name = nameOf(c);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-edge bg-card-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-[15px] font-semibold">{name}</p>
        {c.handle && !name.includes(c.handle) && <p className="truncate font-mono text-[11px] text-muted">{c.handle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Pill tone={s.tone}>{c.status === "connected" && <Icons.check className="h-3 w-3" />} {s.label}</Pill>
        {c.status !== "connected" && ready && (
          <a href={href} className={connectButton}>{c.status === "revoked" ? "Connect again" : "Reconnect"}</a>
        )}
        {c.status !== "revoked" && disconnect && (
          <form action={disconnect}>
            <input type="hidden" name="id" value={c.id} />
            <button type="submit" className={quietAction} aria-label={`Disconnect ${name}`}>Disconnect</button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Every plan has one TikTok account: with others connected from before, which one Shorts go to (the first connected). */
function oneTikTok(listed: Listed[]): string {
  if (listed.length < 2) return "Hookline sends Shorts to one TikTok account.";
  const posting = listed.find((c) => c.status === "connected") ?? listed[0];
  return `Hookline sends Shorts to one TikTok account, ${nameOf(posting)}. The others stay connected, but Shorts don't go to them.`;
}

export function ConnectList({
  platforms,
  channels,
  ready,
  next,
  room,
  plan,
  disconnect,
  settings,
  getting = [],
  saved,
  audience,
  youtubeApi = false,
  posts = false,
  tiktokProfile = false,
  live = false,
}: {
  platforms: Platform[];
  /** the accounts to list, first connected first; a disconnected YouTube channel is listed as given, so pass one only while it has Shorts */
  channels: Listed[];
  ready: Record<Platform, boolean>;
  next: string;
  /** how many YouTube channels the plan has room for, and the plan's name */
  room: number;
  plan: string;
  disconnect?: (form: FormData) => Promise<void>;
  /** saves a YouTube channel's own Shorts settings; without it, they aren't shown */
  settings?: (form: FormData) => Promise<void>;
  /** the YouTube channels that get Shorts now, and the one whose Shorts settings were just saved */
  getting?: string[];
  saved?: string;
  /** saves a YouTube channel's answers; without it, the question points to Settings */
  audience?: (form: FormData) => Promise<void>;
  /** Hookline posts to YouTube for everyone (its API audit has passed) */
  youtubeApi?: boolean;
  /** their plan posts Shorts for them; on Free they post their own */
  posts?: boolean;
  /** TikTok tells Hookline the account's username, so a LIVE can be shown to be theirs */
  tiktokProfile?: boolean;
  /** YouTube Live is on: the LIVE game hears a stream through the YouTube channel it's on */
  live?: boolean;
}) {
  const connectTo = (p: Platform, again?: string) => `/api/connect/${p}?next=${encodeURIComponent(next)}${again ? `&channel=${again}` : ""}`;
  return (
    <ul className="flex flex-col gap-3">
      {platforms.map((p) => {
        const mine = channels.filter((c) => c.platform === p);
        // disconnected YouTube channels last, while they have Shorts; a TikTok that's gone is gone
        const listed = [...mine.filter(isActive), ...(p === "youtube" ? mine.filter((c) => !isActive(c)) : [])];
        const active = mine.filter(isActive).length;
        const why =
          p === "tiktok" ? (tiktokProfile ? ABOUT[p].why : ABOUT[p].whyNoProfile!) : !posts ? ABOUT[p].whySelf! : youtubeApi ? ABOUT[p].why : ABOUT[p].whyBeforeAudit!;
        const also = p === "youtube" && live ? ` ${ABOUT[p].whyLive}` : "";
        return (
          <li key={p} className="border-2 border-edge bg-card">
            <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:flex-nowrap">
              <PlatformMark platform={p} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-xl uppercase tracking-wide">{ABOUT[p].name}</p>
                <p className="text-[14px] leading-snug text-muted">{why}{also}</p>
              </div>
              {listed.length === 0 && (ready[p] ? <a href={connectTo(p)} className={connectButton}>Connect</a> : <Pill>Not set up yet</Pill>)}
            </div>
            {listed.map((c) => (
              <div key={c.id}>
                <AccountRow c={c} href={connectTo(p, c.id)} ready={ready[p]} disconnect={disconnect} />
                {p === "youtube" && isActive(c) && (
                  <>
                    <Audience channel={c} action={audience} next={next} posts={posts} />
                    {settings && <ChannelShorts channel={c} action={settings} room={room} active={active} getting={getting} plan={plan} posts={posts} saved={saved === c.id} />}
                  </>
                )}
                {p === "youtube" && !isActive(c) && (
                  <p className="border-t-2 border-edge px-4 py-3 text-[13px] leading-relaxed text-muted">
                    Disconnected. Hookline can&rsquo;t post there or read it, and its figures are gone from Earnings. Its Shorts stay in your queue and library: post them yourself
                    {posts && c.api ? ", or connect it again and they post to it" : ""}.
                  </p>
                )}
              </div>
            ))}
            {p === "youtube" && listed.length > 0 && (
              active < room && ready.youtube ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t-2 border-edge px-4 py-4">
                  <a href={connectTo("youtube")} className={connectButton}>{active ? "Add a channel" : "Connect"}</a>
                  <p className="min-w-0 flex-1 basis-60 text-[13px] leading-relaxed text-muted">
                    Each channel connects on its own. When Google asks, pick the account or Brand Account that owns it.{room > 1 ? ` ${active} of ${room} connected.` : ""}
                  </p>
                </div>
              ) : room > 1 ? (
                <p className="border-t-2 border-edge px-4 py-3 text-[13px] text-muted">{active} of {room} connected.</p>
              ) : (
                // where channels are looked after: a full one-channel plan says where more room is
                settings && (
                  <p className="border-t-2 border-edge px-4 py-3 text-[13px] leading-relaxed text-muted">
                    Your plan has room for one channel. Creator makes Shorts for up to five.{" "}
                    <a href="/app/settings/billing" className="text-fg underline decoration-signal decoration-2 underline-offset-4">See Creator</a>
                  </p>
                )
              )
            )}
            {p === "tiktok" && listed.length > 0 && (
              <p className="border-t-2 border-edge px-4 py-3 text-[13px] leading-relaxed text-muted">
                {oneTikTok(listed)}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
