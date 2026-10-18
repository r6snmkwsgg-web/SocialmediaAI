import type { FormatId, Metric } from "./types";

/**
 * What a channel is about. Each YouTube channel can be about one thing
 * the creator picks, and then it only gets Shorts about that thing: its
 * own formats, what Claude writes for it, the chart figure it shows, and
 * where the learning loop chooses. An account's own Shorts, while it has
 * no channel, can be about one too. Until one is picked, a channel gets a
 * mix of everything. Text stories are in no niche.
 *
 * Football, Formula 1, NBA, cars and gaming are written by Claude alone,
 * so they're only offered when Claude is set up. Money and places run on
 * Hookline's charts and banks too, which every channel shares and which
 * run out without Claude.
 */

export const NICHE_IDS = ["league", "football", "f1", "nba", "cars", "gaming", "money", "places"] as const;
export type NicheId = (typeof NICHE_IDS)[number];

/** A niche's quizzes: the kinds it asks, what Claude writes them about, and which of the bank's questions count too. */
export type NicheQuiz = {
  /** each kind it asks, as the learning loop keys it (quiz:<id>), and what a quiz of that kind calls its questions */
  kinds: { id: string; name: string }[];
  /** Claude's subjects, three a batch, each with one of the eras picked at random, unless it's timeless */
  topics: readonly string[];
  eras: readonly string[];
  timeless?: readonly string[];
  /** the bank's own topics (lib/shorts/formats/quiz.ts) that its written kind asks as well */
  bankTopics: readonly string[];
};

/** A niche's would-you-rathers: what Claude writes them about, and the bank's themes that count too. */
export type NicheWyr = { themes: readonly string[]; bankThemes: readonly string[] };

export type ChannelNiche = {
  id: NicheId;
  /** what the picker calls it, and what it makes, in a sentence */
  name: string;
  line: string;
  /** the formats it makes, and never any other */
  formats: FormatId[];
  quiz?: NicheQuiz;
  wyr?: NicheWyr;
  /** the figure its rankings and races use */
  charts?: Metric;
  /** who and what Claude may name, instead of never a living person or a brand */
  names?: string;
  /** what its quiz facts may be, instead of nothing about records, rankings or champions */
  facts?: string;
  /** words its Shorts never use, matched the way lib/shorts/checks.ts matches */
  avoid?: readonly string[];
  /** its own hashtags, after #shorts and before the format's, in the plain description */
  tags: string;
  /** what it's called in Trends (lib/trends/niches.ts) */
  trends: string[];
  /** needs: nothing new without Claude; steady: runs out without it; never: doesn't use it */
  claude: "needs" | "steady" | "never";
};

/** "the 1960s" to "the 2010s", every ten years. */
const decades = (from: number, to: number) => Array.from({ length: (to - from) / 10 + 1 }, (_, i) => `the ${from + i * 10}s`);

/** Past seasons, finals and races are facts in the record books; anything still going, or that can still change, isn't. */
const RECORD_BOOKS = "Winners and results of finished seasons, finals and races are fine. Nothing current or still running, no records that can still be broken, and no fees, salaries or prices.";

/** How sports niches may name people: for what's in the record books, never setting countries' fans against each other. */
const sportNames = (who: string, example: string) =>
  `You may name ${who}, but only for facts in the record books, like ${example}. Never set national teams or their fans against each other, and nothing about anyone's private life, looks, money or opinions.`;

export const CHANNEL_NICHES: ChannelNiche[] = [
  {
    id: "league",
    name: "Ball League",
    line: "Seasons of real physics fights between eight named balls, with a table, semi-finals and a final. Never runs out. Needs nothing set up.",
    formats: ["battle"],
    tags: "#ballleague",
    trends: ["ball-battles"],
    claude: "never",
  },
  {
    id: "football",
    name: "Football clubs",
    line: "Quizzes and would-you-rathers about clubs, cups, finals and famous grounds.",
    formats: ["quiz", "wyr"],
    quiz: {
      kinds: [{ id: "football", name: "football questions" }],
      topics: ["European cup finals", "World Cup history", "famous clubs and grounds", "title races", "laws of the game"],
      eras: decades(1960, 2010),
      timeless: ["laws of the game"],
      bankTopics: [],
    },
    wyr: { themes: ["matchday", "playing careers", "stadiums", "club life", "trophies"], bankThemes: [] },
    names: sportNames("clubs, competitions, grounds and players", "who won a final or which club a player joined"),
    facts: RECORD_BOOKS,
    tags: "#football",
    trends: ["football"],
    claude: "needs",
  },
  {
    id: "f1",
    name: "Formula 1",
    line: "Quizzes and would-you-rathers about teams, circuits and past seasons.",
    formats: ["quiz", "wyr"],
    quiz: {
      kinds: [{ id: "f1", name: "Formula 1 questions" }],
      topics: ["past world champions", "famous circuits", "team histories", "race rules and flags", "classic races"],
      eras: decades(1950, 2010),
      timeless: ["race rules and flags"],
      bankTopics: [],
    },
    wyr: { themes: ["race day", "driving careers", "teams", "circuits"], bankThemes: [] },
    names: sportNames("teams, circuits and drivers", "who won a race or which team a driver joined"),
    facts: RECORD_BOOKS,
    tags: "#f1 #formula1",
    trends: ["f1"],
    claude: "needs",
  },
  {
    id: "nba",
    name: "NBA",
    line: "Quizzes and would-you-rathers about teams, arenas and past Finals.",
    formats: ["quiz", "wyr"],
    quiz: {
      kinds: [{ id: "nba", name: "NBA questions" }],
      topics: ["Finals history", "teams and arenas", "past MVPs and drafts", "rules of the game"],
      eras: decades(1960, 2010),
      timeless: ["rules of the game"],
      bankTopics: [],
    },
    wyr: { themes: ["game day", "careers", "arenas", "teams"], bankThemes: [] },
    names: sportNames("teams, arenas and players", "who won the Finals or which team a player joined"),
    facts: RECORD_BOOKS,
    tags: "#nba #basketball",
    trends: ["nba"],
    claude: "needs",
  },
  {
    id: "cars",
    name: "Cars",
    line: "Quizzes and would-you-rathers about car makers, famous models and engines.",
    formats: ["quiz", "wyr"],
    quiz: {
      kinds: [{ id: "cars", name: "car questions" }],
      topics: ["car makers' histories", "classic models", "how engines work", "motorsport history"],
      eras: decades(1900, 2010),
      timeless: ["how engines work"],
      bankTopics: [],
    },
    wyr: { themes: ["driving", "road trips", "garages", "dream cars"], bankThemes: [] },
    names: "You may name car makers, models and engines. Never road accidents, and nothing that reads as an advert.",
    facts: RECORD_BOOKS,
    avoid: ["crash*", "accident*"],
    tags: "#cars",
    trends: ["cars"],
    claude: "needs",
  },
  {
    id: "gaming",
    name: "Gaming",
    line: "Quizzes and would-you-rathers about consoles, studios and classic games.",
    formats: ["quiz", "wyr"],
    quiz: {
      kinds: [{ id: "gaming", name: "gaming questions" }],
      topics: ["console history", "classic arcade and PC games", "studios and makers", "esports history"],
      eras: ["the late 1970s", "the early 1980s", "the late 1980s", "the early 1990s", "the late 1990s", "the early 2000s", "the late 2000s", "the early 2010s", "the late 2010s"],
      bankTopics: [],
    },
    wyr: { themes: ["games", "consoles", "gaming habits"], bankThemes: [] },
    names: "You may name consoles, studios and games made for teens and adults. Never games made for young children.",
    facts: RECORD_BOOKS,
    // the games Rivals keeps for "All ages", and others made for young children
    avoid: ["roblox", "minecraft", "fortnite", "mario", "sonic", "pokemon", "kirby", "among us", "animal crossing"],
    tags: "#gaming #videogames",
    trends: ["gaming"],
    claude: "needs",
  },
  {
    id: "money",
    name: "Money and economies",
    line: "Countdowns and bar chart races of real GDP figures, with money quizzes and would-you-rathers.",
    formats: ["ranking", "race", "quiz", "wyr"],
    quiz: {
      kinds: [{ id: "money", name: "money questions" }],
      topics: ["money and economics", "currencies", "company histories", "economic history", "how banks work"],
      eras: ["the 1700s", "the 1800s", "the 1900s", "the 1920s", "the 1950s", "the 1970s", "the 1990s"],
      timeless: ["money and economics", "how banks work"],
      bankTopics: ["money"],
    },
    wyr: { themes: ["money", "work", "spending", "saving"], bankThemes: ["money", "work"] },
    charts: "gdp",
    names: "Never name a living person. Never give advice about saving, investing or earning, and never promise money.",
    avoid: ["crypto*", "bitcoin", "invest*", "get rich", "passive income", "side hustle"],
    tags: "#money #economy",
    trends: ["rankings", "bar-chart-races"],
    claude: "steady",
  },
  {
    id: "places",
    name: "Geography and history",
    line: "Countdowns and races of real population figures, capital city quizzes, and geography and history questions.",
    formats: ["ranking", "race", "quiz", "wyr"],
    quiz: {
      kinds: [{ id: "capitals", name: "capitals" }, { id: "places", name: "geography and history questions" }],
      topics: ["geography", "rivers and mountains", "ancient history", "world history before 1900", "exploration", "famous buildings"],
      eras: ["the Middle Ages", "the 1400s", "the 1500s", "the 1600s", "the 1700s", "the 1800s"],
      // eras are for history only
      timeless: ["geography", "rivers and mountains", "ancient history", "famous buildings"],
      bankTopics: ["geography", "history", "earth"],
    },
    wyr: { themes: ["travel", "city life", "home", "history"], bankThemes: ["adventure", "home"] },
    charts: "population",
    tags: "#geography #history",
    trends: ["quizzes", "facts", "rankings"],
    claude: "steady",
  },
];

/** The niche a stored id is, or null: nothing picked, or one the code doesn't know, which reads as not picked. */
export const nicheById = (id: string | null | undefined): ChannelNiche | null => CHANNEL_NICHES.find((n) => n.id === id) ?? null;

/** The niches a creator can pick, in the order the picker lists them. */
export const OFFERED: NicheId[] = [...NICHE_IDS];

/** The niche the picker marks "Suggested": the first of these it lets a creator pick. */
export const SUGGESTED: NicheId[] = ["football", "places"];

/** Whether a niche can be picked on this Hookline: one that's offered, and set up for, since some only Claude writes. */
export const canPick = (n: ChannelNiche, claude: boolean) => OFFERED.includes(n.id) && (n.claude !== "needs" || claude);

/** The one the picker suggests: Football clubs when Claude is set up, otherwise Geography and history. */
export const suggestedOf = (claude: boolean): NicheId | null => SUGGESTED.find((id) => canPick(nicheById(id)!, claude)) ?? null;

/**
 * The niche a Settings form picked. Nothing said when it picked none, so
 * saving the rest leaves it as it is; null when what it picked can't be
 * picked here.
 */
export function nicheFrom(form: { get(name: string): unknown }, claude: boolean): { niche?: NicheId } | null {
  const value = form.get("niche");
  if (value === null || value === undefined || value === "") return {};
  const n = nicheById(String(value));
  return n && canPick(n, claude) ? { niche: n.id } : null;
}

const pick = <T,>(xs: readonly T[], n: number, rand: () => number) => [...xs].sort(() => rand() - 0.5).slice(0, n);

/**
 * A few of a niche's quiz subjects for Claude, each with an era picked
 * at random unless it's timeless ("World Cup history, the 1970s"), so
 * channels in one niche don't all ask about the same things.
 */
export function nicheTopics(q: Pick<NicheQuiz, "topics" | "eras" | "timeless">, rand: () => number, n = 3): string[] {
  return pick(q.topics, n, rand).map((t) => (q.timeless?.includes(t) || !q.eras.length ? t : `${t}, ${q.eras[Math.floor(rand() * q.eras.length)]}`));
}

const either = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

/**
 * In plain words, why a niche Claude writes for got fewer Shorts than it
 * should: Claude didn't answer, or isn't set up. When none were made the
 * morning run tries again in an hour, and says so.
 */
export function writerNote(unwritten: string[], o: { setUp: boolean; made: number; wanted: number }): string {
  const what = `no new ${either(unwritten)}`;
  if (!o.setUp) {
    const why = `${what} can be written until Claude is set up on this Hookline.`;
    return o.made > 0 ? `Only ${o.made} of ${o.wanted} could be made: ${why}` : `${why[0].toUpperCase()}${why.slice(1)}`;
  }
  const why = `Claude didn't answer, so ${what} could be written.`;
  return o.made > 0 ? `Only ${o.made} of ${o.wanted} could be made: ${why}` : `${why} Hookline tries again in an hour.`;
}
