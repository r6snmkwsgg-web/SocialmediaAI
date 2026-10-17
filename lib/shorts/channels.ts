/**
 * Which of an account's channels get Shorts, and how many each can have.
 * Every YouTube channel that gets Shorts is a unit of its own: its own
 * daily Shorts, look, posting times and learning. An account with no
 * YouTube channel is its own unit, so it works as it always has. The plan
 * says how many channels get Shorts, and the first connected go first.
 */

export type ChannelRow = { id: string; platform: "youtube" | "tiktok"; status: "connected" | "expired" | "revoked"; shortsOn: boolean; addedAt: Date };

/** Still the account's: connected, or waiting to be reconnected. A disconnected one keeps its Shorts but gets nothing new. */
export const isActive = (c: { status: string }) => c.status !== "revoked";

/** First connected first, as the database orders them too (by added_at, then id). */
const byAdded = (a: ChannelRow, b: ChannelRow) => a.addedAt.getTime() - b.addedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The YouTube channels that get new Shorts: active, switched on, by addedAt then id, as many as the plan has room for. */
export function gettingShorts<T extends ChannelRow>(channels: T[], room: number): T[] {
  return channels.filter((c) => c.platform === "youtube" && isActive(c) && c.shortsOn).sort(byAdded).slice(0, Math.max(0, room));
}

/**
 * Who each day's Shorts are for: those channels, or the account itself
 * (null) while it has no active YouTube channel. An account whose channels
 * are all switched off has none, so it gets no Shorts.
 */
export function unitsOf(channels: ChannelRow[], room: number): (string | null)[] {
  if (!channels.some((c) => c.platform === "youtube" && isActive(c))) return [null];
  return gettingShorts(channels, room).map((c) => c.id);
}

/**
 * How many more a unit can have: its own share, never past the plan's
 * total for all the account's units together. So a channel swapped for
 * another, or disconnected and connected again, adds nothing that day.
 */
export function roomLeft(a: { each: number; units: number; made: number; accountMade: number }): number {
  return Math.max(0, Math.min(a.each - a.made, a.each * Math.max(1, a.units) - a.accountMade));
}

/**
 * Whether a channel has room in the plan: one the account already has (not
 * disconnected) always fits, and a new one, or a disconnected one coming
 * back, fits only while fewer than the plan's room are active.
 */
export function hasRoom(channels: { externalId: string; status: string }[], externalId: string, room: number): boolean {
  const active = channels.filter(isActive);
  return active.some((c) => c.externalId === externalId) || active.length < room;
}

/** Whether Hookline uploads a Short for this channel itself: a plan that posts, a connected channel it may upload to. */
export function uploadsTo(c: { status: string; api: boolean } | null | undefined, scheduling: boolean): boolean {
  return scheduling && !!c && c.status === "connected" && c.api;
}

/**
 * Whether a yes posts the Shorts of every one of these channels without
 * the creator: TikTok direct posting is on (each goes there at its time),
 * or Hookline uploads to each channel. A Short with no channel has nothing
 * Hookline uploads to, and none at all post nothing.
 */
export function postsAll(channels: ({ status: string; api: boolean } | null | undefined)[], scheduling: boolean, tiktok: boolean): boolean {
  return channels.length > 0 && (tiktok || channels.every((c) => uploadsTo(c, scheduling)));
}

/**
 * A YouTube channel's Shorts settings as a Settings form sends them: only
 * what the form showed. Whether it gets Shorts is read only when the form
 * carries `shortsShown` beside its checkbox, so a form without the
 * checkbox never switches Shorts off.
 */
export function channelSettingsFrom(form: { get(name: string): unknown }): { shortsOn?: boolean } {
  return form.get("shortsShown") === "1" ? { shortsOn: form.get("shortsOn") === "on" } : {};
}

/**
 * What to call each channel: its title, else its handle, else Your
 * channel. A name two share gets the handle added; still the same, a
 * number, in the order they're given.
 */
export function channelNames(channels: { id: string; title: string | null; handle: string | null }[]): Map<string, string> {
  const base = channels.map((c) => c.title ?? c.handle ?? "Your channel");
  const shared = (names: string[], i: number) => names.filter((n) => n === names[i]).length > 1;
  const withHandle = base.map((n, i) => (shared(base, i) && channels[i].title && channels[i].handle ? `${n} (${channels[i].handle})` : n));
  const seen = new Map<string, number>();
  return new Map(channels.map((c, i) => {
    const n = withHandle[i];
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return [c.id, k > 1 ? `${n} ${k}` : n];
  }));
}
