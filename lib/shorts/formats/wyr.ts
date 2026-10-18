import { avoided } from "../checks";
import { nicheById } from "../niches";
import type { Candidate, Context, Pair } from "../types";

/**
 * Would you rather: five hard choices, one at a time, and viewers answer
 * in the comments. No made-up "68% picked" numbers: the video asks, and
 * the comments are the answer. The choices are grown-up ones (money,
 * work, time, how you'd live); choices Claude writes for a channel
 * (lib/server/shorts/fresh.ts) come first, and these are what's used
 * without it. A channel about one niche only gets the bank's choices on
 * its niche's own themes.
 */

const P = (id: string, a: string, b: string, theme: string, pull: 1 | 2 | 3): Pair => ({ id: `wyr-${id}`, a, b, theme, pull });

// a choice keeps its id for good, even when its name no longer fits it: channels that have had it are kept by the id
export const PAIRS: Pair[] = [
  P("fly-invisible", "Be able to fly", "Be able to turn invisible", "powers", 3),
  P("teleport-minds", "Teleport anywhere", "Read minds", "powers", 3),
  P("pause-rewind", "Pause time", "Rewind time", "powers", 3),
  P("memory-forget", "Remember everything you see", "Forget anything you want", "powers", 3),
  P("lie-detect", "Always know when someone's lying", "Always get away with lying", "powers", 3),
  P("languages-instruments", "Speak every language fluently", "Play every instrument perfectly", "powers", 3),
  P("sleep-eat", "Never need to sleep", "Never need to eat", "powers", 2),
  P("future-past", "See 10 years into your future", "Change one day in your past", "time", 3),
  P("past-future", "Travel to the past", "Travel to the future", "time", 3),
  P("older-younger", "Be 10 years older right now", "Be 10 years younger right now", "time", 2),
  P("redo-skip", "Redo the last 5 years", "Skip ahead 5 years", "time", 3),
  P("late-early", "Always be 10 minutes late", "Always be 20 minutes early", "time", 2),
  P("famous-rich", "Be famous and broke", "Be rich and unknown", "money", 2),
  P("1m-now", "$1 million right now", "$1,000 every week for life", "money", 3),
  P("job-love", "Love your job but earn little", "Hate your job but earn a lot", "work", 3),
  P("four-day", "Work 4 days a week for your pay now", "Work 5 days for 30% more", "work", 3),
  P("retire", "Retire at 40 with just enough", "Work until 65 and retire rich", "money", 3),
  P("boss-work", "A great boss and boring work", "A bad boss and exciting work", "work", 2),
  P("flights-rent", "Free flights for life", "Free rent for life", "money", 3),
  P("lottery-life", "Win the lottery", "Live twice as long", "life", 3),
  P("remote-office", "Work from home forever", "Work in an office with your best friends", "work", 2),
  P("youtuber-athlete", "Be a famous YouTuber", "Be a famous athlete", "work", 2),
  P("chef-driver", "Have a personal chef", "Have a personal driver", "life", 2),
  P("phone-wallet", "Lose your phone", "Lose your wallet", "tech", 2),
  P("search-texts", "Have your search history made public", "Have your texts made public", "tech", 3),
  P("photos-messages", "Lose every photo you've taken", "Lose every message you've sent", "tech", 3),
  P("social-games", "Give up social media for a year", "Give up video games for a year", "tech", 3),
  P("music-movies", "Live without music", "Live without movies and shows", "life", 3),
  P("ads-lines", "Skip every ad forever", "Skip every queue forever", "life", 3),
  P("wifi-coffee", "Free Wi-Fi everywhere you go", "Free food everywhere you go", "life", 2),
  P("cold-hot", "Never feel cold again", "Never feel too hot again", "life", 2),
  P("no-internet-friends", "No internet for a month", "No talking to friends for a month", "tech", 3),
  P("funny-smart", "Be the funniest person in the room", "Be the smartest person in the room", "life", 3),
  P("know-everything", "Know the ending of every movie", "Never be able to finish one", "life", 2),
  P("say-everything", "Always say exactly what you think", "Never be able to disagree out loud", "life", 2),
  P("group-chats", "Be left out of every group chat", "Be in every group chat with alerts on", "tech", 2),
  P("sweet-salty", "Only eat sweet food", "Only eat salty food", "food", 3),
  P("pizza-tacos", "Unlimited pizza for life", "Unlimited tacos for life", "food", 2),
  P("no-sugar-no-salt", "Give up dessert forever", "Give up fries forever", "food", 2),
  P("cook-dishes", "Always do the cooking", "Always do the dishes", "home", 2),
  P("city-island", "Live in a huge city", "Live on a quiet island", "home", 2),
  P("tiny-huge", "A tiny flat anywhere you like", "A huge house somewhere boring", "home", 3),
  P("space-ocean", "Explore deep space", "Explore the deep ocean", "adventure", 2),
  P("mountains-beach", "Every holiday in the mountains", "Every holiday at the beach", "adventure", 2),
  P("best-worst", "Be the best player on a losing team", "Be the worst player on a winning team", "sport", 3),
  P("gold-cup", "Win an Olympic gold", "Win the World Cup", "sport", 2),
  P("duck-horses", "Fight one horse-sized duck", "Fight 100 duck-sized horses", "silly", 3),
  P("whisper-shout", "Only be able to whisper", "Only be able to shout", "silly", 2),
  P("one-color", "Wear one colour forever", "Never wear the same outfit twice", "silly", 2),
  P("sing-narrate", "Sing everything you say", "Narrate everything you do out loud", "silly", 2),
];

/** Choices the bank had before it was aged up: channels may have had them, so they're never written again either. */
const RETIRED = [
  "Have super strength or Have super speed", "Talk to animals or Speak every language", "Breathe underwater or Never need to sleep", "Sing everything you say or Dance everywhere you walk",
  "Have a pet dragon or Have a pet unicorn", "Live in a giant treehouse or Live on a houseboat", "Be as tall as a giraffe or Be as small as a mouse",
];

/** Every choice the bank has or had, in words, so nothing written for a channel asks one of them again. */
export const bankPairs = (): string[] => [...PAIRS.map((p) => `${p.a} or ${p.b}`), ...RETIRED];

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Hardest choices count most; five of the same theme don't. The toughest goes last. */
export function wyrScore(ps: Pair[]): number {
  let score = ps.reduce((s, p) => s + p.pull, 0);
  const themes = new Set(ps.map((p) => p.theme)).size;
  score += themes * 0.8;
  if (ps[ps.length - 1].pull === 3) score += 1.5;
  for (let i = 1; i < ps.length; i++) if (ps[i].theme === ps[i - 1].theme) score -= 1;
  return score;
}

export function proposeWyr(ctx: Context, tries = 160, count = 5): Candidate | null {
  const niche = nicheById(ctx.niche);
  if (niche && !niche.wyr) return null;
  // in a niche, only the bank's choices on its own themes
  const bank = niche ? PAIRS.filter((p) => niche.wyr?.bankThemes.includes(p.theme) && !avoided(`${p.a} ${p.b}`, niche.avoid ?? [])) : PAIRS;
  // what was written for this channel comes first; the bank fills in when there isn't enough of it
  const written = (ctx.fresh?.pairs ?? []).filter((p) => !ctx.used.has(p.id));
  const fresh = written.length >= count + 2 ? written : [...written, ...bank.filter((p) => !ctx.used.has(p.id))];
  if (fresh.length < count) return null;
  let best: { ps: Pair[]; score: number } | null = null;
  for (let t = 0; t < tries; t++) {
    const ps = shuffle(fresh, ctx.rand).slice(0, count);
    // the one people argue about most goes last
    ps.sort((x, y) => x.pull - y.pull);
    const score = wyrScore(ps);
    if (!best || score > best.score) best = { ps, score };
  }
  const ps = best!.ps;
  return {
    format: "wyr",
    params: { pairs: ps.map(({ id, a, b }) => ({ id, a, b })) },
    key: "wyr",
    score: best!.score,
    why: [`${count} choices people split on, the toughest last, picked from ${tries} sets`, "Never on your channel or anyone else's before"],
    facts: [
      `A "would you rather" Short: ${count} choices, about 4 seconds each.`,
      `The choices: ${ps.map((p) => `"${p.a}" or "${p.b}"`).join("; ")}.`,
      "The video shows no poll results or percentages.",
    ],
    title: `Would you rather: ${count} choices you can't skip`,
  };
}
