/**
 * The YouTube Partner Program's bars, all in one place, copied from
 * YouTube's own pages: each set says which page it comes from and when
 * someone read it there. Earnings measures each channel against them by
 * YouTube Analytics, which isn't YouTube's own count (YouTube Studio's
 * Earn page has that), and YouTube reviews every channel that applies.
 * Each rung says what needs someone 18 or older. Nothing here counts days
 * down, works out a pace or projects anything. A later set goes in only
 * once someone has read it on YouTube's page, with only what that page says.
 */

/** What a rung needs: subscribers, public uploads in 90 days where it asks for them, and Shorts views in 90 days or watch hours on long videos in 12 months. */
export type Need = { subscribers: number; uploads90?: number; shortsViews90: number; longHours365: number };

export type Rung = { id: "fan" | "ads"; name: string; unlocks: string; adult: string; need: Need };

export type Rules = {
  /** the day these bars start */
  from: string;
  /** the YouTube page they're copied from */
  source: string;
  /** the day someone read that page and copied them; null until someone has */
  checked: string | null;
  /** only channels joining from that day have to meet them */
  newChannelsOnly?: boolean;
  rungs: Rung[];
  /** only where YouTube's page says so: what a channel sharing ad revenue keeps to share in Shorts ad revenue */
  keepShorts90?: number;
  /** only where YouTube's page says so: when channels in the program must accept updated terms */
  termsBy?: string;
};

/** Today's bars. NEXT.md says to check them on YouTube's page before release. */
export const YPP_RULES: Rules[] = [
  {
    from: "2000-01-01",
    source: "https://support.google.com/youtube/answer/72851",
    checked: null,
    rungs: [
      {
        id: "fan",
        name: "Fan funding and Shopping",
        unlocks: "Memberships, Super Chat, Super Thanks and Shopping, where YouTube offers them.",
        adult: "Memberships, Super Chat and Super Thanks need the creator to be 18 or older.",
        need: { subscribers: 500, uploads90: 3, shortsViews90: 3_000_000, longHours365: 3_000 },
      },
      {
        id: "ads",
        name: "Ad revenue",
        unlocks: "A share of ad revenue from long videos and Shorts.",
        adult: "YouTube pays through AdSense, which needs someone 18 or older, so under 18 a parent or guardian sets it up.",
        need: { subscribers: 1_000, shortsViews90: 10_000_000, longHours365: 4_000 },
      },
    ],
  },
];

const byStart = (a: Rules, b: Rules) => a.from.localeCompare(b.from);

/** The bars on a day: the latest set that has started by then. */
export function rulesOn(day: string, sets: Rules[] = YPP_RULES): Rules {
  return sets.filter((r) => r.from <= day).sort(byStart).at(-1) ?? [...sets].sort(byStart)[0];
}

/** A set of bars that starts after `day`, if YouTube's page has said there'll be one. */
export function nextRules(day: string, sets: Rules[] = YPP_RULES): Rules | null {
  return sets.filter((r) => r.from > day).sort(byStart)[0] ?? null;
}

/** A channel's figures, each null when it isn't known: hidden subscribers, or YouTube not splitting Shorts from long videos. Uploads are only those Hookline knows of. */
export type ChannelNumbers = { subscribers: number | null; uploads90: number | null; shortsViews90: number | null; longHours365: number | null };

/** One figure against a bar: past only when it's known and reaches it, and null (not known) when it isn't known. */
export type Check = { have: number | null; need: number; past: boolean | null };

const check = (have: number | null, need: number): Check => ({ have, need, past: have === null ? null : have >= need });

/** Uploads Hookline knows of: reaching the bar is past, and fewer is not known, since there may be others. */
const atLeast = (have: number | null, need: number): Check => ({ have, need, past: have !== null && have >= need ? true : null });

const every = (xs: (boolean | null)[]) => (xs.includes(false) ? false : xs.includes(null) ? null : true);
const either = (xs: (boolean | null)[]) => (xs.includes(true) ? true : xs.includes(null) ? null : false);

export type Progress = { rung: Rung; subscribers: Check; uploads: Check | null; shorts: Check; hours: Check; past: boolean | null };

/**
 * How far a channel is from each rung. A rung is past when its
 * subscribers, its uploads (where it asks for them) and either its Shorts
 * views or its watch hours are all past; anything not known keeps it from
 * being called past.
 */
export function progressOf(n: ChannelNumbers, rules: Rules): Progress[] {
  return rules.rungs.map((rung) => {
    const subscribers = check(n.subscribers, rung.need.subscribers);
    const uploads = rung.need.uploads90 === undefined ? null : atLeast(n.uploads90, rung.need.uploads90);
    const shorts = check(n.shortsViews90, rung.need.shortsViews90);
    const hours = check(n.longHours365, rung.need.longHours365);
    return { rung, subscribers, uploads, shorts, hours, past: every([subscribers.past, uploads ? uploads.past : true, either([shorts.past, hours.past])]) };
  });
}

/** A channel sharing ad revenue, against what it keeps to share in Shorts ad revenue: only where a set says so. */
export function keepProgress(n: ChannelNumbers, rules: Rules): Check | null {
  return rules.keepShorts90 === undefined ? null : check(n.shortsViews90, rules.keepShorts90);
}

/** A big figure in words, rounded down so it never reads as more than it is: 2,990,000 is 2.9 million. */
export function big(n: number): string {
  if (n >= 1_000_000) return `${(Math.floor(n / 100_000) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 })} million`;
  return Math.floor(n).toLocaleString("en-US");
}

const longDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

const sameNeed = (a: Need, b: Need) =>
  a.subscribers === b.subscribers && a.uploads90 === b.uploads90 && a.shortsViews90 === b.shortsViews90 && a.longHours365 === b.longHours365;

/**
 * What changes when a later set of bars starts, built from its own
 * numbers and dates: each rung whose bar moves, whether channels already
 * in the program have to meet it, and for a channel sharing ad revenue,
 * the day YouTube asks it to accept new terms by. Dates only: never a count
 * of days. Nothing while there's no later set.
 */
export function notesFor(today: string, sharesAds: boolean, sets: Rules[] = YPP_RULES): string[] {
  const next = nextRules(today, sets);
  if (!next) return [];
  const now = rulesOn(today, sets);
  const who = next.newChannelsOnly ? "channels joining" : "channels";
  const notes = next.rungs
    .filter((r) => {
      const was = now.rungs.find((x) => x.id === r.id);
      return !was || !sameNeed(was.need, r.need);
    })
    .map((r) => {
      const uploads = r.need.uploads90 === undefined ? "" : `, ${r.need.uploads90} public uploads in 90 days`;
      return `From ${longDay(next.from)}, ${who} need ${r.need.subscribers.toLocaleString("en-US")} subscribers${uploads} and ${big(r.need.shortsViews90)} Shorts views in 90 days or ${r.need.longHours365.toLocaleString("en-US")} watch hours in 12 months for ${r.name.toLowerCase()}.`;
    });
  if (notes.length && next.newChannelsOnly) notes.push("Channels already in the program don't need to meet the new bar to stay in.");
  if (sharesAds && next.termsBy) notes.push(`YouTube asks channels in the program to accept its updated terms by ${longDay(next.termsBy)}. YouTube Studio shows them.`);
  return notes;
}
