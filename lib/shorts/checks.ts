import { storyTimes, FPS } from "./timing";
import type { Fact, Pair, Tale } from "./types";

/**
 * The checks every piece of written material passes before it can go in
 * a Short, whoever wrote it: short enough to fit the screen, nothing
 * unsafe, nothing aimed at young children, and nothing already asked in
 * other words. Claude's quiz facts are also checked twice by Claude
 * (lib/server/shorts/fresh.ts); sums are only ever worked out by code.
 */

/** Text cut down to what it says: lower case, no accents or punctuation, "what's" as "what is". */
export function normal(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\b(\w+)'s\b/g, (m, w: string) => (["what", "who", "where", "that", "it", "there", "here"].includes(w) ? `${w} is` : w))
    .replace(/n't\b/g, " not")
    .replace(/[^a-z0-9%$ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set("a an the of in on at to is are was were be by for and or what which who whose how many much does do did has have had this that these those it its with from as your you would rather".split(" "));

/** The words that carry the meaning, for telling two wordings of the same thing apart. */
export function words(text: string): Set<string> {
  return new Set(normal(text).split(" ").filter((w) => w && !STOP.has(w)).map((w) => w.replace(/s$/, "")));
}

/** How much two texts overlap, 0 to 1. */
export function overlap(x: string, y: string): number {
  const a = words(x), b = words(y);
  if (!a.size || !b.size) return 0;
  let same = 0;
  for (const w of a) if (b.has(w)) same++;
  return same / (a.size + b.size - same);
}

/** How much two texts must overlap to be the same thing; the content ledger uses it too, for other channels'. */
export const SAME = 0.7;

/** Close enough to be the same question, choice or story said another way. */
export const sameThing = (x: string, y: string) => normal(x) === normal(y) || overlap(x, y) >= SAME;

/** A short, stable id for a piece of text: the same text always gets the same one, whoever wrote it. */
export function textId(prefix: string, text: string): string {
  return hashId(prefix, normal(text));
}

/**
 * An id for what a question or choice says rather than how: the words
 * that carry the meaning, in any order, so "Which planet's day is the
 * shortest?" and "Which planet has the shortest day?" get the same one,
 * and only one channel can have it.
 */
export function wordsId(prefix: string, text: string): string {
  return hashId(prefix, [...words(text)].sort().join(" "));
}

function hashId(prefix: string, text: string): string {
  // FNV-1a, 64 bits as two halves
  let h1 = 0x811c9dc5, h2 = 0x050c5d1f;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return `${prefix}-${h1.toString(36)}${h2.toString(36)}`;
}

/**
 * Off limits in every format: violence, sex, drugs and drink, gambling,
 * illness, and the subjects Hookline never sets people against each
 * other over (religion, race, where people are from, who they love,
 * politics). Whole words, or the start of one where it ends in *.
 */
const UNSAFE = [
  "kill*", "murder*", "suicid*", "self harm", "die", "dies", "died", "dying", "dead", "death*", "gore", "bloody", "gun", "guns", "shoot*", "stab*", "weapon*", "terror*", "bomb*", "massacre*", "genocide", "nazi*", "hitler", "slave*",
  "sex*", "nude", "naked", "porn*", "kiss*", "hook up", "boyfriend*", "girlfriend*", "crush",
  "drug*", "cocaine", "heroin", "weed", "cannabis", "marijuana", "alcohol*", "beer*", "wine*", "vodka", "drunk", "smok*", "vape*", "cigar*", "casino*", "gambl*", "bet", "betting",
  "religio*", "god", "gods", "jesus", "christ", "allah", "church*", "mosque*", "temple*", "bible", "quran", "koran", "torah", "pray*", "muslim*", "islam", "islamic", "islamist*", "christian*", "jew", "jews", "jewish", "hindu*", "buddhis*", "sikh*", "atheis*", "pope",
  "racis*", "racial", "ethnic*", "immigra*", "gay", "lesbian", "transgender", "queer", "lgbt*",
  "democrat*", "republican*", "trump", "biden", "election*", "abortion", "politic*", "president*",
  "cancer", "disease*", "covid*", "pandemic*", "funeral*", "fat", "ugly", "diet*", "weight loss",
];

/** What says "for young children": the kind of thing that makes YouTube treat a channel as made for kids. */
const KID = [
  "unicorn*", "dragon*", "fairy", "fairies", "princess*", "mermaid*", "cartoon*", "toy", "toys", "teddy", "crayon*", "colouring", "coloring", "playground*", "recess", "nap time", "bedtime", "mommy", "daddy", "potty",
  "kindergarten", "preschool", "elementary school", "primary school", "nursery", "lollipop*", "candy", "sweets", "puppy", "puppies", "kitten*", "bunny", "bunnies", "santa", "dinosaur*",
  "times table*", "how many legs", "what colour is", "what color is", "what shape", "what sound does", "baby animal*", "pet", "pets",
];

/** Whether any of the words or phrases are in the text. */
function has(text: string, list: string[]): boolean {
  const t = ` ${normal(text)} `;
  return list.some((w) => (w.endsWith("*") ? t.includes(` ${w.slice(0, -1)}`) : t.includes(` ${w} `)));
}

/** Something no Short should say. */
export const unsafe = (text: string) => has(text, UNSAFE);

/** Something that reads as being for young children. */
export const kidCoded = (text: string) => has(text, KID);

/** A sum, which only the code works out, never a writer. */
export const isSum = (text: string) => /\d\s*(x|×|\*|\+|-|÷|\/)\s*\d|\bsquared\b|\bper ?cent\b|%|\btimes\b|\bplus\b|\bminus\b|\bdivided\b|\bsquare root\b/i.test(text);

/** Why a quiz question can't be used, or null if it can. `known` is what's been asked before. */
export function questionProblem(f: Fact, known: string[] = []): string | null {
  const opts = [f.a, ...f.decoys];
  if (f.q.length < 12 || f.q.length > 90) return "length";
  if (opts.some((o) => !o.trim() || o.length > 28)) return "answer length";
  if (new Set(opts.map(normal)).size !== 3) return "same answers";
  if (opts.some((o) => normal(o).length > 3 && ` ${normal(f.q)} `.includes(` ${normal(o)} `))) return "gives it away";
  if (isSum(f.q)) return "sum";
  if ([f.q, ...opts].some(unsafe)) return "unsafe";
  if ([f.q, ...opts].some(kidCoded)) return "for kids";
  if (known.some((k) => sameThing(k, f.q))) return "asked before";
  return null;
}

/** Why a would-you-rather choice can't be used, or null if it can. */
export function pairProblem(p: Pick<Pair, "a" | "b">, known: string[] = []): string | null {
  if ([p.a, p.b].some((s) => s.trim().length < 3 || s.length > 48)) return "length";
  if (sameThing(p.a, p.b)) return "same both sides";
  if ([p.a, p.b].some(unsafe)) return "unsafe";
  if ([p.a, p.b].some(kidCoded)) return "for kids";
  const both = `${p.a} or ${p.b}`;
  if (known.some((k) => sameThing(k, both))) return "asked before";
  return null;
}

/** Why a text story can't be used, or null if it can. */
export function storyProblem(s: Pick<Tale, "contact" | "messages" | "title">, known: string[] = []): string | null {
  if (!s.contact.trim() || s.contact.length > 16) return "contact";
  if (s.messages.length < 6 || s.messages.length > 12) return "length";
  if (s.messages.some((m) => !m.text.trim() || m.text.length > 90)) return "message length";
  if (s.messages.filter((m) => m.me).length < 2 || s.messages.filter((m) => !m.me).length < 2) return "one-sided";
  const all = [s.title, s.contact, ...s.messages.map((m) => m.text)];
  if (all.some(unsafe)) return "unsafe";
  if (all.some(kidCoded)) return "for kids";
  const secs = storyTimes(s.messages).at(-1)!.at / FPS;
  if (secs < 12 || secs > 45) return "time";
  const text = s.messages.map((m) => m.text).join(" ");
  if (known.some((k) => sameThing(k, text))) return "told before";
  return null;
}
