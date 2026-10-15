import type { Candidate, Choice, Context } from "../types";

/**
 * Would you rather: five hard choices, one at a time, and viewers answer
 * in the comments. No made-up "68% picked" numbers: the video asks, and
 * the comments are the answer.
 */

type Pair = Choice & { theme: string; /** how torn people are, 1 to 3 */ pull: 1 | 2 | 3 };

export const PAIRS: Pair[] = [
  { id: "wyr-fly-invisible", a: "Be able to fly", b: "Be able to turn invisible", theme: "powers", pull: 3 },
  { id: "wyr-teleport-minds", a: "Teleport anywhere", b: "Read minds", theme: "powers", pull: 3 },
  { id: "wyr-pause-rewind", a: "Pause time", b: "Rewind time", theme: "powers", pull: 3 },
  { id: "wyr-strength-speed", a: "Have super strength", b: "Have super speed", theme: "powers", pull: 2 },
  { id: "wyr-animals-languages", a: "Talk to animals", b: "Speak every language", theme: "powers", pull: 3 },
  { id: "wyr-underwater-fly", a: "Breathe underwater", b: "Never need to sleep", theme: "powers", pull: 2 },
  { id: "wyr-memory-forget", a: "Remember everything you see", b: "Forget anything you want", theme: "powers", pull: 3 },
  { id: "wyr-past-future", a: "Travel to the past", b: "Travel to the future", theme: "time", pull: 3 },
  { id: "wyr-late-early", a: "Always be 10 minutes late", b: "Always be 20 minutes early", theme: "life", pull: 2 },
  { id: "wyr-famous-rich", a: "Be famous and broke", b: "Be rich and unknown", theme: "life", pull: 2 },
  { id: "wyr-lottery-life", a: "Win the lottery", b: "Live twice as long", theme: "life", pull: 3 },
  { id: "wyr-funny-smart", a: "Be the funniest person in the room", b: "Be the smartest person in the room", theme: "life", pull: 3 },
  { id: "wyr-chef-driver", a: "Have a personal chef", b: "Have a personal driver", theme: "life", pull: 2 },
  { id: "wyr-phone-wallet", a: "Lose your phone", b: "Lose your wallet", theme: "life", pull: 2 },
  { id: "wyr-best-worst", a: "Be the best player on a losing team", b: "Be the worst player on a winning team", theme: "sport", pull: 3 },
  { id: "wyr-youtuber-athlete", a: "Be a famous YouTuber", b: "Be a famous athlete", theme: "life", pull: 2 },
  { id: "wyr-ads-lines", a: "Skip every ad forever", b: "Skip every line forever", theme: "life", pull: 3 },
  { id: "wyr-wifi-coffee", a: "Free Wi-Fi everywhere you go", b: "Free food everywhere you go", theme: "life", pull: 2 },
  { id: "wyr-cold-hot", a: "Never feel cold again", b: "Never feel too hot again", theme: "life", pull: 2 },
  { id: "wyr-sweet-salty", a: "Only eat sweet food", b: "Only eat salty food", theme: "food", pull: 3 },
  { id: "wyr-pizza-tacos", a: "Unlimited pizza for life", b: "Unlimited tacos for life", theme: "food", pull: 2 },
  { id: "wyr-no-sugar-no-salt", a: "Give up dessert forever", b: "Give up fries forever", theme: "food", pull: 2 },
  { id: "wyr-music-movies", a: "Live without music", b: "Live without movies and shows", theme: "life", pull: 3 },
  { id: "wyr-social-games", a: "Give up social media", b: "Give up video games", theme: "life", pull: 3 },
  { id: "wyr-whisper-shout", a: "Only be able to whisper", b: "Only be able to shout", theme: "silly", pull: 2 },
  { id: "wyr-sing-dance", a: "Sing everything you say", b: "Dance everywhere you walk", theme: "silly", pull: 2 },
  { id: "wyr-duck-horses", a: "Fight one horse-sized duck", b: "Fight 100 duck-sized horses", theme: "silly", pull: 3 },
  { id: "wyr-dragon-unicorn", a: "Have a pet dragon", b: "Have a pet unicorn", theme: "silly", pull: 1 },
  { id: "wyr-treehouse-boat", a: "Live in a giant treehouse", b: "Live on a houseboat", theme: "home", pull: 2 },
  { id: "wyr-city-island", a: "Live in a huge city", b: "Live on a quiet island", theme: "home", pull: 2 },
  { id: "wyr-space-ocean", a: "Explore deep space", b: "Explore the deep ocean", theme: "adventure", pull: 2 },
  { id: "wyr-one-color", a: "Wear one colour forever", b: "Never wear the same outfit twice", theme: "silly", pull: 2 },
  { id: "wyr-lie-detect", a: "Always know when someone's lying", b: "Always get away with lying", theme: "powers", pull: 3 },
  { id: "wyr-older-younger", a: "Be 10 years older right now", b: "Be 10 years younger right now", theme: "time", pull: 2 },
  { id: "wyr-no-internet-friends", a: "No internet for a month", b: "No talking to friends for a month", theme: "life", pull: 3 },
  { id: "wyr-tiny-giant", a: "Be as tall as a giraffe", b: "Be as small as a mouse", theme: "silly", pull: 1 },
  { id: "wyr-know-everything", a: "Know the ending of every movie", b: "Never be able to finish one", theme: "silly", pull: 2 },
  { id: "wyr-1m-now", a: "$1 million right now", b: "$1,000 every week for life", theme: "money", pull: 3 },
  { id: "wyr-job-love", a: "Love your job but earn little", b: "Hate your job but earn a lot", theme: "money", pull: 3 },
  { id: "wyr-redo-skip", a: "Redo the last 5 years", b: "Skip ahead 5 years", theme: "time", pull: 3 },
];

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
  const fresh = PAIRS.filter((p) => !ctx.used.has(p.id));
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
    why: [`${count} choices people split on, the toughest last, picked from ${tries} sets`, "None of them on your channel before"],
    facts: [
      `A "would you rather" Short: ${count} choices, about 4 seconds each, and viewers comment their picks.`,
      `The choices: ${ps.map((p) => `"${p.a}" or "${p.b}"`).join("; ")}.`,
      "The video shows no poll results or percentages.",
    ],
    title: `Would you rather: ${count} choices you can't skip`,
  };
}
