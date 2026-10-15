import type { Candidate, Context, Question } from "../types";

/**
 * Quizzes: five multiple-choice questions, three seconds each, then the
 * answer. Every question is a fact that doesn't change and that anyone can
 * check, or sums worked out by the code itself, so a quiz is never wrong.
 */

type Fact = { id: string; q: string; a: string; decoys: [string, string]; level: 1 | 2 | 3; topic: string };

/** capitals, with the country's better-known cities as the wrong answers */
export const CAPITALS: (Omit<Fact, "q" | "topic"> & { iso: string; country: string })[] = [
  { id: "cap-FRA", iso: "FRA", country: "France", a: "Paris", decoys: ["Lyon", "Marseille"], level: 1 },
  { id: "cap-JPN", iso: "JPN", country: "Japan", a: "Tokyo", decoys: ["Osaka", "Kyoto"], level: 1 },
  { id: "cap-ITA", iso: "ITA", country: "Italy", a: "Rome", decoys: ["Milan", "Venice"], level: 1 },
  { id: "cap-ESP", iso: "ESP", country: "Spain", a: "Madrid", decoys: ["Barcelona", "Seville"], level: 1 },
  { id: "cap-DEU", iso: "DEU", country: "Germany", a: "Berlin", decoys: ["Munich", "Hamburg"], level: 1 },
  { id: "cap-EGY", iso: "EGY", country: "Egypt", a: "Cairo", decoys: ["Alexandria", "Luxor"], level: 1 },
  { id: "cap-RUS", iso: "RUS", country: "Russia", a: "Moscow", decoys: ["St Petersburg", "Kazan"], level: 1 },
  { id: "cap-GRC", iso: "GRC", country: "Greece", a: "Athens", decoys: ["Thessaloniki", "Patras"], level: 1 },
  { id: "cap-KOR", iso: "KOR", country: "South Korea", a: "Seoul", decoys: ["Busan", "Incheon"], level: 1 },
  { id: "cap-THA", iso: "THA", country: "Thailand", a: "Bangkok", decoys: ["Phuket", "Chiang Mai"], level: 1 },
  { id: "cap-ARG", iso: "ARG", country: "Argentina", a: "Buenos Aires", decoys: ["Córdoba", "Rosario"], level: 1 },
  { id: "cap-USA", iso: "USA", country: "the USA", a: "Washington, D.C.", decoys: ["New York City", "Los Angeles"], level: 1 },
  { id: "cap-CAN", iso: "CAN", country: "Canada", a: "Ottawa", decoys: ["Toronto", "Vancouver"], level: 2 },
  { id: "cap-BRA", iso: "BRA", country: "Brazil", a: "Brasília", decoys: ["Rio de Janeiro", "São Paulo"], level: 2 },
  { id: "cap-AUS", iso: "AUS", country: "Australia", a: "Canberra", decoys: ["Sydney", "Melbourne"], level: 2 },
  { id: "cap-TUR", iso: "TUR", country: "Türkiye", a: "Ankara", decoys: ["Istanbul", "Izmir"], level: 2 },
  { id: "cap-IND", iso: "IND", country: "India", a: "New Delhi", decoys: ["Mumbai", "Kolkata"], level: 2 },
  { id: "cap-CHE", iso: "CHE", country: "Switzerland", a: "Bern", decoys: ["Zurich", "Geneva"], level: 2 },
  { id: "cap-MAR", iso: "MAR", country: "Morocco", a: "Rabat", decoys: ["Casablanca", "Marrakesh"], level: 2 },
  { id: "cap-VNM", iso: "VNM", country: "Vietnam", a: "Hanoi", decoys: ["Ho Chi Minh City", "Da Nang"], level: 2 },
  { id: "cap-NZL", iso: "NZL", country: "New Zealand", a: "Wellington", decoys: ["Auckland", "Christchurch"], level: 2 },
  { id: "cap-PAK", iso: "PAK", country: "Pakistan", a: "Islamabad", decoys: ["Karachi", "Lahore"], level: 2 },
  { id: "cap-COL", iso: "COL", country: "Colombia", a: "Bogotá", decoys: ["Medellín", "Cali"], level: 2 },
  { id: "cap-SAU", iso: "SAU", country: "Saudi Arabia", a: "Riyadh", decoys: ["Jeddah", "Mecca"], level: 2 },
  { id: "cap-ARE", iso: "ARE", country: "the UAE", a: "Abu Dhabi", decoys: ["Dubai", "Sharjah"], level: 2 },
  { id: "cap-POL", iso: "POL", country: "Poland", a: "Warsaw", decoys: ["Kraków", "Gdańsk"], level: 2 },
  { id: "cap-PRT", iso: "PRT", country: "Portugal", a: "Lisbon", decoys: ["Porto", "Faro"], level: 2 },
  { id: "cap-ECU", iso: "ECU", country: "Ecuador", a: "Quito", decoys: ["Guayaquil", "Cuenca"], level: 2 },
  { id: "cap-PER", iso: "PER", country: "Peru", a: "Lima", decoys: ["Cusco", "Arequipa"], level: 2 },
  { id: "cap-CHL", iso: "CHL", country: "Chile", a: "Santiago", decoys: ["Valparaíso", "Antofagasta"], level: 2 },
  { id: "cap-NGA", iso: "NGA", country: "Nigeria", a: "Abuja", decoys: ["Lagos", "Kano"], level: 3 },
  { id: "cap-TZA", iso: "TZA", country: "Tanzania", a: "Dodoma", decoys: ["Dar es Salaam", "Arusha"], level: 3 },
  { id: "cap-KAZ", iso: "KAZ", country: "Kazakhstan", a: "Astana", decoys: ["Almaty", "Shymkent"], level: 3 },
  { id: "cap-MMR", iso: "MMR", country: "Myanmar", a: "Naypyidaw", decoys: ["Yangon", "Mandalay"], level: 3 },
  { id: "cap-CIV", iso: "CIV", country: "Ivory Coast", a: "Yamoussoukro", decoys: ["Abidjan", "Bouaké"], level: 3 },
  { id: "cap-BLZ", iso: "BLZ", country: "Belize", a: "Belmopan", decoys: ["Belize City", "San Ignacio"], level: 3 },
  { id: "cap-MNG", iso: "MNG", country: "Mongolia", a: "Ulaanbaatar", decoys: ["Erdenet", "Darkhan"], level: 3 },
  { id: "cap-UZB", iso: "UZB", country: "Uzbekistan", a: "Tashkent", decoys: ["Samarkand", "Bukhara"], level: 3 },
  { id: "cap-CMR", iso: "CMR", country: "Cameroon", a: "Yaoundé", decoys: ["Douala", "Garoua"], level: 3 },
  { id: "cap-LAO", iso: "LAO", country: "Laos", a: "Vientiane", decoys: ["Luang Prabang", "Pakse"], level: 3 },
];

/** science and nature facts that don't change */
export const FACTS: Fact[] = [
  { id: "sci-closest-planet", q: "Which planet is closest to the Sun?", a: "Mercury", decoys: ["Venus", "Mars"], level: 1, topic: "space" },
  { id: "sci-red-planet", q: "Which planet is called the Red Planet?", a: "Mars", decoys: ["Jupiter", "Venus"], level: 1, topic: "space" },
  { id: "sci-spider-legs", q: "How many legs does a spider have?", a: "8", decoys: ["6", "10"], level: 1, topic: "animals" },
  { id: "sci-largest-planet", q: "What's the biggest planet in our solar system?", a: "Jupiter", decoys: ["Saturn", "Neptune"], level: 1, topic: "space" },
  { id: "sci-largest-ocean", q: "What's the biggest ocean on Earth?", a: "Pacific", decoys: ["Atlantic", "Indian"], level: 1, topic: "earth" },
  { id: "sci-tallest-mountain", q: "What's the tallest mountain above sea level?", a: "Mount Everest", decoys: ["K2", "Kilimanjaro"], level: 1, topic: "earth" },
  { id: "sci-boiling", q: "At sea level, water boils at…", a: "100 °C", decoys: ["90 °C", "120 °C"], level: 1, topic: "physics" },
  { id: "sci-octopus-hearts", q: "How many hearts does an octopus have?", a: "3", decoys: ["1", "2"], level: 2, topic: "animals" },
  { id: "sci-gold", q: "What's the chemical symbol for gold?", a: "Au", decoys: ["Ag", "Gd"], level: 2, topic: "chemistry" },
  { id: "sci-largest-organ", q: "What's the biggest organ in the human body?", a: "Skin", decoys: ["Liver", "Brain"], level: 2, topic: "body" },
  { id: "sci-plants-gas", q: "Which gas do plants take in from the air?", a: "Carbon dioxide", decoys: ["Oxygen", "Nitrogen"], level: 2, topic: "nature" },
  { id: "sci-fastest-animal", q: "What's the fastest land animal?", a: "Cheetah", decoys: ["Pronghorn", "Lion"], level: 2, topic: "animals" },
  { id: "sci-liquid-metal", q: "Which metal is liquid at room temperature?", a: "Mercury", decoys: ["Lead", "Tin"], level: 2, topic: "chemistry" },
  { id: "sci-longest-bone", q: "What's the longest bone in the human body?", a: "Femur", decoys: ["Tibia", "Humerus"], level: 2, topic: "body" },
  { id: "sci-planet-count", q: "How many planets are in our solar system?", a: "8", decoys: ["9", "7"], level: 2, topic: "space" },
  { id: "sci-air-gas", q: "Which gas is most of the air we breathe?", a: "Nitrogen", decoys: ["Oxygen", "Carbon dioxide"], level: 2, topic: "earth" },
  { id: "sci-rings", q: "Which planet has the biggest rings?", a: "Saturn", decoys: ["Jupiter", "Uranus"], level: 2, topic: "space" },
  { id: "sci-bees", q: "What do bees collect from flowers to make honey?", a: "Nectar", decoys: ["Pollen", "Sap"], level: 2, topic: "animals" },
  { id: "sci-hardest", q: "What's the hardest natural material?", a: "Diamond", decoys: ["Quartz", "Granite"], level: 2, topic: "earth" },
  { id: "sci-bones", q: "How many bones does an adult human have?", a: "206", decoys: ["186", "226"], level: 3, topic: "body" },
  { id: "sci-closest-star", q: "What's the closest star to Earth?", a: "The Sun", decoys: ["Proxima Centauri", "Sirius"], level: 3, topic: "space" },
  { id: "sci-biggest-desert", q: "What's the biggest desert on Earth?", a: "Antarctica", decoys: ["Sahara", "Gobi"], level: 3, topic: "earth" },
  { id: "sci-sideways-planet", q: "Which planet spins on its side?", a: "Uranus", decoys: ["Neptune", "Venus"], level: 3, topic: "space" },
  { id: "sci-sunlight", q: "How long does sunlight take to reach Earth?", a: "About 8 minutes", decoys: ["About 8 seconds", "About 8 hours"], level: 3, topic: "space" },
  { id: "sci-donor", q: "Which blood type can be given to almost anyone?", a: "O negative", decoys: ["AB positive", "A negative"], level: 3, topic: "body" },
  { id: "sci-sodium", q: "What's the chemical symbol for sodium?", a: "Na", decoys: ["So", "Sd"], level: 3, topic: "chemistry" },
  { id: "sci-teeth", q: "How many teeth does a full adult set have?", a: "32", decoys: ["28", "36"], level: 3, topic: "body" },
];

export const KINDS = ["capitals", "science", "mixed"] as const;
export type QuizKind = (typeof KINDS)[number];

const LETTERS = ["A", "B", "C"];

const pick = <T,>(xs: T[], rand: () => number) => xs[Math.floor(rand() * xs.length)];

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function asQuestion(f: Fact, rand: () => number): Question {
  const options = shuffle([f.a, ...f.decoys], rand);
  return { id: f.id, q: f.q, options, answer: options.indexOf(f.a), topic: f.topic, level: f.level };
}

const capital = (c: (typeof CAPITALS)[number]): Fact => ({ ...c, q: `What's the capital of ${c.country}?`, topic: "capitals" });

/** A sum the code works out, with near misses for the wrong answers. */
export function sum(rand: () => number): Fact {
  const kind = pick(["times", "big-times", "percent", "square"] as const, rand);
  const near = (ans: number, a: number, b: number): [string, string] => {
    const set = new Set<number>([ans]);
    for (const d of [a, b, -a, 10, -10, 1, -1]) {
      if (set.size === 3) break;
      if (ans + d > 0) set.add(ans + d);
    }
    const [, x, y] = [...set];
    return [x.toLocaleString("en-US"), y.toLocaleString("en-US")];
  };
  if (kind === "times" || kind === "big-times") {
    const a = kind === "times" ? 3 + Math.floor(rand() * 7) : 11 + Math.floor(rand() * 9);
    const b = 3 + Math.floor(rand() * 7);
    const ans = a * b;
    return { id: `math-${a}x${b}`, q: `What's ${a} x ${b}?`, a: ans.toLocaleString("en-US"), decoys: near(ans, a, b), level: kind === "times" ? 1 : 2, topic: "maths" };
  }
  if (kind === "percent") {
    const p = pick([10, 20, 25, 50, 75], rand);
    const n = pick([40, 60, 80, 120, 160, 200, 240, 400], rand);
    const ans = (p * n) / 100;
    return { id: `math-${p}pc-${n}`, q: `What's ${p}% of ${n}?`, a: String(ans), decoys: near(ans, Math.max(2, Math.round(ans / 4)), 10), level: 2, topic: "maths" };
  }
  const n = 13 + Math.floor(rand() * 13);
  const ans = n * n;
  return { id: `math-sq-${n}`, q: `What's ${n} squared?`, a: ans.toLocaleString("en-US"), decoys: [((n + 1) * (n + 1)).toLocaleString("en-US"), (ans - n).toLocaleString("en-US")], level: 3, topic: "maths" };
}

function pool(kind: QuizKind, rand: () => number): Fact[] {
  const caps = CAPITALS.map(capital);
  if (kind === "capitals") return caps;
  if (kind === "science") return FACTS;
  return [...caps, ...FACTS, ...Array.from({ length: 12 }, () => sum(rand))];
}

/**
 * How good a set of questions is: easiest first and hardest last, at least
 * one hard one, the right answers not all in the same place, and (in a
 * mixed quiz) not two of a kind in a row.
 */
export function quizScore(qs: Question[]): number {
  let score = 0;
  for (let i = 1; i < qs.length; i++) if (qs[i].level >= qs[i - 1].level) score += 1;
  if (qs[qs.length - 1].level === 3) score += 2;
  if (!qs.some((q) => q.level === 3)) score -= 3;
  const spots = new Set(qs.map((q) => q.answer)).size;
  score += spots >= 3 ? 1.5 : spots === 2 ? 0.5 : -2;
  for (let i = 2; i < qs.length; i++) if (qs[i].answer === qs[i - 1].answer && qs[i].answer === qs[i - 2].answer) score -= 1.5;
  for (let i = 1; i < qs.length; i++) if (qs[i].topic === qs[i - 1].topic && qs[i].topic !== "capitals") score -= 0.5;
  return score;
}

export function proposeQuiz(ctx: Context, kind: QuizKind = pick([...KINDS], ctx.rand), tries = 160, count = 5): Candidate | null {
  const facts = pool(kind, ctx.rand).filter((f) => !ctx.used.has(f.id));
  if (facts.length < count) return null;
  let best: { qs: Question[]; score: number } | null = null;
  for (let t = 0; t < tries; t++) {
    const chosen = shuffle(facts, ctx.rand).slice(0, count).sort((a, b) => a.level - b.level);
    const qs = chosen.map((f) => asQuestion(f, ctx.rand));
    const score = quizScore(qs);
    if (!best || score > best.score) best = { qs, score };
  }
  const qs = best!.qs;
  const hardest = qs[qs.length - 1];
  const name = kind === "capitals" ? "capitals" : kind === "science" ? "science questions" : "questions";
  return {
    format: "quiz",
    params: { questions: qs },
    key: `quiz:${kind}`,
    score: best!.score,
    why: [
      `${count} ${name}, easiest first and the hardest last, picked from ${tries} sets`,
      "None of them asked on your channel before",
    ],
    facts: [
      `A quiz Short: ${count} multiple-choice ${name}, 3 seconds each, and the answer shows after each one.`,
      `The questions: ${qs.map((q) => `"${q.q}"`).join(", ")}.`,
      `The last and hardest: "${hardest.q}" Don't give away any answers.`,
      "It ends asking viewers to comment their score out of 5.",
    ],
    title: kind === "capitals" ? `Name these ${count} capitals in 3 seconds each` : kind === "science" ? `${count} science questions, 3 seconds each` : `${count} questions, 3 seconds each. How many can you get?`,
  };
}

export { LETTERS };
