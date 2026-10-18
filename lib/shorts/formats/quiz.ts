import { avoided, normal } from "../checks";
import { COUNTRIES, DATA } from "../data";
import { nicheById, type ChannelNiche } from "../niches";
import type { Candidate, Context, Fact, Question } from "../types";

/**
 * Quizzes: five multiple-choice questions, three seconds each, then the
 * answer. Every question is a fact that doesn't change and that anyone can
 * check, or a sum worked out by the code itself, so a quiz is never wrong.
 * They're for teens and adults: nothing a young child would be asked.
 * Questions Claude writes for a channel (lib/server/shorts/fresh.ts) come
 * first; these are what's used without it. A channel about one niche only
 * asks that niche's kinds, from what was written for it and the bank's
 * questions on its own topics.
 */

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

/** general knowledge that doesn't change, for grown-ups */
export const FACTS: Fact[] = [
  { id: "sci-hottest-planet", q: "What's the hottest planet in our solar system?", a: "Venus", decoys: ["Mercury", "Mars"], level: 2, topic: "space" },
  { id: "sci-shortest-day", q: "Which planet has the shortest day?", a: "Jupiter", decoys: ["Mercury", "Mars"], level: 3, topic: "space" },
  { id: "sci-largest-moon", q: "What's the largest moon in our solar system?", a: "Ganymede", decoys: ["Titan", "Europa"], level: 3, topic: "space" },
  { id: "sci-sun-gas", q: "Which gas is most of the Sun made of?", a: "Hydrogen", decoys: ["Helium", "Oxygen"], level: 2, topic: "space" },
  { id: "sci-closest-star", q: "What's the closest star to Earth?", a: "The Sun", decoys: ["Proxima Centauri", "Sirius"], level: 3, topic: "space" },
  { id: "sci-sideways-planet", q: "Which planet spins on its side?", a: "Uranus", decoys: ["Neptune", "Venus"], level: 3, topic: "space" },
  { id: "sci-sunlight", q: "How long does sunlight take to reach Earth?", a: "About 8 minutes", decoys: ["About 8 seconds", "About 8 hours"], level: 3, topic: "space" },
  { id: "sci-light-speed", q: "Roughly how fast does light travel?", a: "300,000 km a second", decoys: ["30,000 km a second", "3,000 km a second"], level: 3, topic: "physics" },
  { id: "sci-boiling", q: "At sea level, water boils at…", a: "100 °C", decoys: ["90 °C", "120 °C"], level: 1, topic: "physics" },
  { id: "sci-gold", q: "What's the chemical symbol for gold?", a: "Au", decoys: ["Ag", "Gd"], level: 2, topic: "chemistry" },
  { id: "sci-iron", q: "What's the chemical symbol for iron?", a: "Fe", decoys: ["Ir", "In"], level: 2, topic: "chemistry" },
  { id: "sci-sodium", q: "What's the chemical symbol for sodium?", a: "Na", decoys: ["So", "Sd"], level: 3, topic: "chemistry" },
  { id: "sci-potassium", q: "What's the chemical symbol for potassium?", a: "K", decoys: ["P", "Po"], level: 3, topic: "chemistry" },
  { id: "sci-element-one", q: "Which element has the atomic number 1?", a: "Hydrogen", decoys: ["Helium", "Carbon"], level: 2, topic: "chemistry" },
  { id: "sci-liquid-metal", q: "Which metal is liquid at room temperature?", a: "Mercury", decoys: ["Lead", "Tin"], level: 2, topic: "chemistry" },
  { id: "sci-ph-water", q: "What's the pH of pure water at 25 °C?", a: "7", decoys: ["0", "14"], level: 2, topic: "chemistry" },
  { id: "sci-hardest", q: "What's the hardest natural material?", a: "Diamond", decoys: ["Quartz", "Granite"], level: 2, topic: "earth" },
  { id: "sci-air-gas", q: "Which gas is most of the air we breathe?", a: "Nitrogen", decoys: ["Oxygen", "Carbon dioxide"], level: 2, topic: "earth" },
  { id: "sci-bones", q: "How many bones does an adult human have?", a: "206", decoys: ["186", "226"], level: 3, topic: "body" },
  { id: "sci-donor", q: "Which blood type can be given to almost anyone?", a: "O negative", decoys: ["AB positive", "A negative"], level: 3, topic: "body" },
  { id: "sci-largest-organ", q: "What's the biggest organ in the human body?", a: "Skin", decoys: ["Liver", "Brain"], level: 2, topic: "body" },
  { id: "sci-longest-bone", q: "What's the longest bone in the human body?", a: "Femur", decoys: ["Tibia", "Humerus"], level: 2, topic: "body" },
  { id: "sci-heart-chambers", q: "How many chambers does the human heart have?", a: "4", decoys: ["2", "3"], level: 2, topic: "body" },
  { id: "sci-teeth", q: "How many teeth does a full adult set have?", a: "32", decoys: ["28", "36"], level: 3, topic: "body" },
  { id: "sci-balance", q: "Which part of the brain controls balance?", a: "Cerebellum", decoys: ["Frontal lobe", "Hypothalamus"], level: 3, topic: "body" },
  { id: "sci-octopus-hearts", q: "How many hearts does an octopus have?", a: "3", decoys: ["1", "2"], level: 2, topic: "nature" },
  { id: "sci-flying-mammal", q: "What's the only mammal that can truly fly?", a: "The bat", decoys: ["The flying squirrel", "The sugar glider"], level: 2, topic: "nature" },
  { id: "sci-biggest-desert", q: "What's the biggest desert on Earth?", a: "Antarctica", decoys: ["Sahara", "Gobi"], level: 3, topic: "earth" },
  { id: "sci-deepest-trench", q: "Which ocean trench holds the deepest point on Earth?", a: "Mariana Trench", decoys: ["Tonga Trench", "Java Trench"], level: 2, topic: "earth" },
  { id: "sci-largest-ocean", q: "What's the biggest ocean on Earth?", a: "Pacific", decoys: ["Atlantic", "Indian"], level: 1, topic: "earth" },
  { id: "sci-tallest-mountain", q: "What's the tallest mountain above sea level?", a: "Mount Everest", decoys: ["K2", "Kangchenjunga"], level: 1, topic: "earth" },
  { id: "sci-byte", q: "How many bits are in a byte?", a: "8", decoys: ["4", "16"], level: 2, topic: "tech" },
  { id: "sci-cpu", q: "In a computer, what does CPU stand for?", a: "Central processing unit", decoys: ["Core power unit", "Central program utility"], level: 2, topic: "tech" },
  { id: "geo-smallest-country", q: "What's the smallest country in the world?", a: "Vatican City", decoys: ["Monaco", "San Marino"], level: 2, topic: "geography" },
  { id: "geo-most-countries", q: "Which continent has the most countries?", a: "Africa", decoys: ["Europe", "Asia"], level: 2, topic: "geography" },
  { id: "geo-largest-country", q: "What's the largest country by area?", a: "Russia", decoys: ["Canada", "China"], level: 1, topic: "geography" },
  { id: "geo-amazon", q: "What's the longest river in South America?", a: "Amazon", decoys: ["Paraná", "Orinoco"], level: 2, topic: "geography" },
  { id: "geo-time-zones", q: "Which country has the most time zones?", a: "France", decoys: ["Russia", "USA"], level: 3, topic: "geography" },
  { id: "geo-yen", q: "What's Japan's currency called?", a: "Yen", decoys: ["Won", "Yuan"], level: 2, topic: "money" },
  { id: "his-berlin-wall", q: "In which year did the Berlin Wall fall?", a: "1989", decoys: ["1987", "1991"], level: 2, topic: "history" },
  { id: "his-moon-landing", q: "In which year did people first walk on the Moon?", a: "1969", decoys: ["1965", "1972"], level: 2, topic: "history" },
  { id: "his-titanic", q: "Which ship sank on its first voyage in 1912?", a: "Titanic", decoys: ["Lusitania", "Britannic"], level: 1, topic: "history" },
  { id: "his-first-world-cup", q: "Which country won the first football World Cup, in 1930?", a: "Uruguay", decoys: ["Brazil", "Italy"], level: 3, topic: "sport" },
  { id: "art-mona-lisa", q: "Who painted the Mona Lisa?", a: "Leonardo da Vinci", decoys: ["Michelangelo", "Raphael"], level: 1, topic: "culture" },
  { id: "art-starry-night", q: "Who painted The Starry Night?", a: "Vincent van Gogh", decoys: ["Claude Monet", "Paul Cézanne"], level: 2, topic: "culture" },
  { id: "art-romeo-juliet", q: "Who wrote Romeo and Juliet?", a: "William Shakespeare", decoys: ["Christopher Marlowe", "Charles Dickens"], level: 1, topic: "culture" },
  { id: "lang-most-speakers", q: "Which language has the most native speakers?", a: "Mandarin Chinese", decoys: ["Spanish", "English"], level: 2, topic: "language" },
  { id: "sport-chess-bishop", q: "In chess, which piece only ever moves diagonally?", a: "Bishop", decoys: ["Rook", "Knight"], level: 2, topic: "sport" },
  { id: "sport-chess-squares", q: "How many squares are on a chessboard?", a: "64", decoys: ["81", "49"], level: 2, topic: "sport" },
  { id: "sport-marathon", q: "How long is a marathon?", a: "42.195 km", decoys: ["40 km", "45.5 km"], level: 3, topic: "sport" },
  { id: "sport-rings", q: "How many rings are on the Olympic flag?", a: "5", decoys: ["4", "6"], level: 1, topic: "sport" },
];

/** topics that make a science quiz */
export const SCIENCE = new Set(["space", "physics", "chemistry", "body", "nature", "earth", "tech", "science"]);

export const KINDS = ["capitals", "science", "mixed"] as const;
export type QuizKind = (typeof KINDS)[number];

const LETTERS = ["A", "B", "C"];

const pick = <T,>(xs: readonly T[], rand: () => number) => xs[Math.floor(rand() * xs.length)];

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

/**
 * Capitals with more than one answer people would argue for, ones that
 * have moved lately or that are disputed, and city-states whose capital
 * is the country's own name: never asked.
 */
const NOT_ASKED = new Set(["AND", "BOL", "ZAF", "NLD", "ISR", "TWN", "LKA", "BEN", "SWZ", "BDI", "GNQ", "PLW", "NRU", "KIR", "YEM", "MYS", "KAZ", "VAT", "MCO", "SGP", "SMR", "LUX", "DJI", "KWT", "PAN", "GTM", "MEX"]);

/** Names said the way a question needs them. */
const COUNTRY_SAID: Record<string, string> = {
  BHS: "the Bahamas", GMB: "the Gambia", MDV: "the Maldives", PHL: "the Philippines", MHL: "the Marshall Islands", SLB: "the Solomon Islands", GBR: "the UK",
  CAF: "the Central African Republic", COG: "the Republic of the Congo", COD: "DR Congo", BIH: "Bosnia and Herzegovina", ATG: "Antigua and Barbuda", TTO: "Trinidad and Tobago",
  LCA: "Saint Lucia", KNA: "Saint Kitts and Nevis", VCT: "Saint Vincent and the Grenadines", STP: "São Tomé and Príncipe", FSM: "Micronesia", CZE: "Czechia",
};

/** Capitals with the accents the data leaves off. */
const CITY_SAID: Record<string, string> = { Asuncion: "Asunción", Chisinau: "Chișinău", Lome: "Lomé", "San Jose": "San José", "Sao Tome": "São Tomé", Reykjavik: "Reykjavík", Male: "Malé", Yaounde: "Yaoundé", Bogota: "Bogotá", Brasilia: "Brasília" };

let fromData: Fact[] | null = null;

/**
 * Every other country's capital, from the country data: the answer is
 * what the data says, and the wrong ones are other capitals on the same
 * continent, so all three are real capitals and only one is that
 * country's. Bigger countries' are easier.
 */
export function dataCapitals(): Fact[] {
  if (fromData) return fromData;
  const banked = new Set(CAPITALS.map((c) => c.iso));
  const pop = DATA.population;
  const last = pop.years.length - 1;
  const big = new Set(Object.entries(pop.values).sort((x, y) => (y[1][last] ?? 0) - (x[1][last] ?? 0)).slice(0, 70).map(([iso]) => iso));
  const isos = Object.keys(COUNTRIES).filter((iso) => !NOT_ASKED.has(iso)).sort();
  const city = (iso: string) => CITY_SAID[COUNTRIES[iso].capital] ?? COUNTRIES[iso].capital;
  fromData = isos
    .filter((iso) => !banked.has(iso))
    .map((iso) => {
      const same = isos.filter((o) => o !== iso && COUNTRIES[o].continent === COUNTRIES[iso].continent && city(o) !== city(iso));
      const at = same.findIndex((o) => o > iso);
      // two neighbours in the alphabet, so the same country always gets the same wrong answers
      const d1 = same[(at + same.length) % same.length], d2 = same[(at + 5 + same.length) % same.length];
      const country = COUNTRY_SAID[iso] ?? COUNTRIES[iso].name;
      return { id: `cap-${iso}`, q: `What's the capital of ${country}?`, a: city(iso), decoys: [city(d1), city(d2)] as [string, string], level: big.has(iso) ? 2 : 3, topic: "capitals" } satisfies Fact;
    })
    // three different answers, and none that's in the country's own name, like Tunis in Tunisia
    .filter((f) => new Set([f.a, ...f.decoys]).size === 3 && !normal(f.q).includes(normal(f.a)));
  return fromData;
}

/** What the sums are made of: two numbers to multiply (short and long ones), a percentage of a number, or a number squared. */
const TIMES = { a: [12, 19], b: [6, 9] }, LONG_TIMES = { a: [13, 25], b: [11, 15] };
const PERCENTS = [15, 20, 25, 30, 35, 40, 60, 75], OF = [40, 60, 80, 120, 160, 180, 240, 360, 400];
const SQUARES = [13, 25];

const span = ([from, to]: number[]) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
// only figures that make a whole number
const ofFor = (p: number) => OF.filter((n) => (p * n) % 100 === 0);

/** Every sum the code can ask, for the ledger: there are only a couple of hundred, so other channels' are looked up first. */
export function sumIds(): string[] {
  return [
    ...[TIMES, LONG_TIMES].flatMap((t) => span(t.a).flatMap((a) => span(t.b).map((b) => `math-${a}x${b}`))),
    ...PERCENTS.flatMap((p) => ofFor(p).map((n) => `math-${p}pc-${n}`)),
    ...span(SQUARES).map((n) => `math-sq-${n}`),
  ];
}

/** A sum the code works out, with near misses for the wrong answers. No times tables: these take a moment. */
export function sum(rand: () => number): Fact {
  const kind = pick(["times", "long-times", "percent", "square"] as const, rand);
  const near = (ans: number, a: number, b: number): [string, string] => {
    const set = new Set<number>([ans]);
    for (const d of [a, b, -a, 10, -10, 1, -1]) {
      if (set.size === 3) break;
      if (ans + d > 0) set.add(ans + d);
    }
    const [, x, y] = [...set];
    return [x.toLocaleString("en-US"), y.toLocaleString("en-US")];
  };
  const within = ([from, to]: number[]) => from + Math.floor(rand() * (to - from + 1));
  if (kind === "times" || kind === "long-times") {
    const t = kind === "times" ? TIMES : LONG_TIMES;
    const a = within(t.a);
    const b = within(t.b);
    const ans = a * b;
    return { id: `math-${a}x${b}`, q: `What's ${a} x ${b}?`, a: ans.toLocaleString("en-US"), decoys: near(ans, a, b), level: kind === "times" ? 2 : 3, topic: "maths" };
  }
  if (kind === "percent") {
    const p = pick(PERCENTS, rand);
    const n = pick(ofFor(p), rand);
    const ans = (p * n) / 100;
    return { id: `math-${p}pc-${n}`, q: `What's ${p}% of ${n}?`, a: String(ans), decoys: near(ans, Math.max(2, Math.round(ans / 4)), 10), level: 2, topic: "maths" };
  }
  const n = within(SQUARES);
  const ans = n * n;
  return { id: `math-sq-${n}`, q: `What's ${n} squared?`, a: ans.toLocaleString("en-US"), decoys: [((n + 1) * (n + 1)).toLocaleString("en-US"), (ans - n).toLocaleString("en-US")], level: 3, topic: "maths" };
}

/** Every question the built-in banks have, and every sum, for the ledger. */
export function bankQuestionIds(): string[] {
  return [...CAPITALS.map((c) => c.id), ...dataCapitals().map((f) => f.id), ...FACTS.map((f) => f.id), ...sumIds()];
}

/** Every question the banks ask, in words, so nothing written for a channel asks one of them again. */
export function bankQuestions(): string[] {
  return [...CAPITALS.map((c) => capital(c).q), ...dataCapitals().map((f) => f.q), ...FACTS.map((f) => f.q), ...RETIRED];
}

/** Questions the bank had before it was aged up: channels may have had them, so they're never written again either. */
const RETIRED = [
  "Which planet is closest to the Sun?", "Which planet is called the Red Planet?", "How many legs does a spider have?", "What's the biggest planet in our solar system?",
  "Which gas do plants take in from the air?", "What's the fastest land animal?", "How many planets are in our solar system?", "Which planet has the biggest rings?",
  "What do bees collect from flowers to make honey?",
];

function pool(kind: QuizKind, ctx: Context): Fact[] {
  const fresh = (ctx.fresh?.questions ?? []).filter((f) => kind === "mixed" || (kind === "science" && SCIENCE.has(f.topic)));
  if (kind === "capitals") return [...CAPITALS.map(capital), ...dataCapitals()];
  const bank = kind === "science" ? FACTS.filter((f) => SCIENCE.has(f.topic)) : [...CAPITALS.map(capital), ...dataCapitals(), ...FACTS];
  const sums = kind === "mixed" ? Array.from({ length: 12 }, () => sum(ctx.rand)) : [];
  // what was written for this channel comes first; the banks fill in when there isn't enough of it
  const unused = fresh.filter((f) => !ctx.used.has(f.id));
  return unused.length >= 6 ? [...unused, ...sums.slice(0, 2)] : [...unused, ...bank, ...sums];
}

/**
 * A niche's questions for one of its kinds: the capitals, or what was
 * written for the channel with the bank's questions on the niche's own
 * topics. Never the general banks or sums, so its quizzes are only about it.
 */
function nichePool(kind: string, niche: ChannelNiche, ctx: Context): Fact[] {
  if (kind === "capitals") return [...CAPITALS.map(capital), ...dataCapitals()];
  const bank = FACTS.filter((f) => niche.quiz?.bankTopics.includes(f.topic) && ![f.q, f.a, ...f.decoys].some((t) => avoided(t, niche.avoid ?? [])));
  const unused = (ctx.fresh?.questions ?? []).filter((f) => !ctx.used.has(f.id));
  return unused.length >= 6 ? unused : [...unused, ...bank];
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

/** A quiz of the kind asked for, or of any kind that still has enough new questions: one of its niche's, where it has one. */
export function proposeQuiz(ctx: Context, kind?: string, tries = 160, count = 5): Candidate | null {
  const niche = nicheById(ctx.niche);
  if (niche && !niche.quiz) return null;
  const kinds = niche?.quiz ? niche.quiz.kinds.map((x) => x.id) : [...KINDS];
  for (const k of kind ? [kind] : shuffle(kinds, ctx.rand)) {
    const seen = new Set<string>();
    const facts = (niche ? nichePool(k, niche, ctx) : pool(k as QuizKind, ctx)).filter((f) => !ctx.used.has(f.id) && !seen.has(f.id) && seen.add(f.id));
    if (facts.length < count) continue;
    let best: { qs: Question[]; score: number } | null = null;
    for (let t = 0; t < tries; t++) {
      const chosen = shuffle(facts, ctx.rand).slice(0, count).sort((a, b) => a.level - b.level);
      const qs = chosen.map((f) => asQuestion(f, ctx.rand));
      const score = quizScore(qs);
      if (!best || score > best.score) best = { qs, score };
    }
    const qs = best!.qs;
    const hardest = qs[qs.length - 1];
    const own = niche?.quiz?.kinds.find((x) => x.id === k)?.name;
    const name = own ?? (k === "capitals" ? "capitals" : k === "science" ? "science questions" : "questions");
    return {
      format: "quiz",
      params: { questions: qs },
      key: `quiz:${k}`,
      score: best!.score,
      why: [`${count} ${name}, easiest first and the hardest last, picked from ${tries} sets`, "Never asked on your channel or anyone else's before"],
      facts: [
        `A quiz Short: ${count} multiple-choice ${name}, 3 seconds each, and the answer shows after each one.`,
        `The questions: ${qs.map((q) => `"${q.q}"`).join(", ")}.`,
        `The last and hardest: "${hardest.q}" Don't give away any answers.`,
      ],
      title:
        k === "capitals" ? `Name these ${count} capitals in 3 seconds each`
        : own ? `${count} ${own}, 3 seconds each`
        : k === "science" ? `${count} science questions, 3 seconds each`
        : `${count} questions, 3 seconds each. How many can you get?`,
    };
  }
  return null;
}

export { LETTERS };
