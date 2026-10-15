import { storyTimes, FPS } from "../timing";
import type { Candidate, Context, Story } from "../types";

/**
 * Text stories: a made-up conversation, one message at a time, with a
 * turn at the end. Every one is labelled as a story on screen, so nobody
 * takes it for someone's real messages.
 */

type Tale = Story & { title: string; tone: "funny" | "sweet" | "twist" };

const me = (text: string) => ({ me: true, text });
const them = (text: string) => ({ me: false, text });

export const STORIES: Tale[] = [
  {
    id: "story-dad-pickup",
    title: "Dad picks me up",
    contact: "Dad",
    tone: "funny",
    messages: [
      me("dad can you pick me up"),
      them("Hi Pick Me Up, I'm Dad"),
      me("seriously"),
      them("Hi Seriously, I'm Dad"),
      me("i'm not doing this"),
      them("Hi Not Doing This, I'm Dad"),
      me("fine. i'll walk home"),
      them("No need"),
      them("Look outside"),
      them("Been parked here for 10 minutes. Just wanted to say hi to all of you"),
    ],
  },
  {
    id: "story-mom-lol",
    title: "Mom learns what LOL means",
    contact: "Mom",
    tone: "funny",
    messages: [
      them("Your aunt's cat ran away LOL"),
      me("mom why would you say lol"),
      them("Lots of love. I say it to everyone"),
      me("lol means laughing out loud"),
      them("Oh no"),
      them("I sent it to your grandpa when he lost his glasses"),
      me("that's not that bad"),
      them("And to the neighbor when her car broke down"),
      me("mom"),
      them("And the pastor. Twice"),
    ],
  },
  {
    id: "story-group-project",
    title: "The group project",
    contact: "Jake",
    tone: "twist",
    messages: [
      them("did you finish your part of the project"),
      me("yeah sent it last night"),
      them("nice. did you do my part too"),
      me("why would i do your part"),
      them("thought we were friends"),
      me("we are. that's why i'm reminding you it's due in an hour"),
      them("WAIT what. i thought it was next week"),
      me("it was next week. last week"),
      them("i'm so done"),
      me("relax. i did your part too"),
      them("i take back everything i've ever said about you"),
    ],
  },
  {
    id: "story-lost-dog",
    title: "Someone found my dog",
    contact: "Unknown number",
    tone: "sweet",
    messages: [
      them("hi, i think i found your dog"),
      me("really?? where"),
      them("outside the bakery on main st. your number is on his collar"),
      me("i don't have a dog"),
      them("well he's very sure he's yours"),
      me("what does he look like"),
      them("big. fluffy. currently eating my sandwich"),
      me("my old number was on an adoption form last year"),
      me("i never heard back"),
      them("sounds like he found you instead"),
      me("on my way"),
    ],
  },
  {
    id: "story-test-results",
    title: "I got my test back",
    contact: "Mom",
    tone: "sweet",
    messages: [
      me("got my math test back"),
      them("And?"),
      me("remember when you said you'd love me no matter what"),
      them("What did you get"),
      me("say it again first"),
      them("I love you no matter what. WHAT DID YOU GET"),
      me("100%"),
      them("Then why the drama"),
      me("just wanted to hear it"),
    ],
  },
  {
    id: "story-roommate-pasta",
    title: "Who ate the pasta",
    contact: "Sam",
    tone: "funny",
    messages: [
      them("did you eat my leftover pasta"),
      me("no"),
      them("it had my name on it"),
      me("i didn't see a name"),
      them("it was on the bottom of the box"),
      me("then how would i see it"),
      them("so you DID pick up the box"),
      me("..."),
      me("i'll buy you pasta"),
      them("make it two"),
    ],
  },
  {
    id: "story-console",
    title: "Mom took my console",
    contact: "Alex",
    tone: "funny",
    messages: [
      them("you on tonight?"),
      me("can't. mom took my console"),
      them("why"),
      me("she said i play too much"),
      them("how long did you play"),
      me("she says 9 hours. i say one really long game"),
      them("fair"),
      them("wait how are you texting me"),
      me("she forgot about the laptop"),
      them("see you online in 5"),
    ],
  },
  {
    id: "story-grandma-caps",
    title: "Grandma's new phone",
    contact: "Grandma",
    tone: "funny",
    messages: [
      them("HELLO DEAR THIS IS GRANDMA"),
      me("hi grandma! you got the new phone"),
      them("YES. HOW DO I MAKE THE LETTERS SMALL"),
      me("tap the arrow next to the A"),
      them("OK"),
      them("IS IT SMALL NOW"),
      me("still big"),
      them("I TAPPED IT 40 TIMES"),
      me("grandma that's caps lock"),
      them("WELL TELL HIM TO STOP"),
    ],
  },
  {
    id: "story-birthday",
    title: "What are you doing Saturday",
    contact: "Maya",
    tone: "sweet",
    messages: [
      them("what are you doing saturday"),
      me("nothing why"),
      them("no reason"),
      them("wear something nice"),
      me("why"),
      them("no reason"),
      me("is this a surprise party"),
      them("NO. why would you think that"),
      me("saturday is my birthday"),
      them("is it? huh. weird. anyway. something nice. 7pm"),
    ],
  },
  {
    id: "story-sick-day",
    title: "I'm too sick for school",
    contact: "Mom",
    tone: "twist",
    messages: [
      me("mom i don't feel good. can i stay home"),
      them("What hurts?"),
      me("everything. mostly my math test"),
      them("Your math test hurts?"),
      me("i meant my head"),
      them("Interesting. Your teacher just emailed"),
      them("The test moved to Friday"),
      me("actually i feel a lot better"),
      them("Thought you might. Bus in 10 minutes"),
    ],
  },
  {
    id: "story-pizza",
    title: "Six pizzas I didn't order",
    contact: "Marco's Pizza",
    tone: "sweet",
    messages: [
      them("Your order is on its way!"),
      me("i didn't order anything"),
      them("6 large pizzas for this number"),
      me("6?? it wasn't me"),
      them("Already paid. Going to 42 Elm St"),
      me("that's my address"),
      them("There's a note on the order"),
      me("what does it say"),
      them("\"Congrats on the new job. Share with the team. Love, your sister\""),
      me("ok i'm crying in the office now"),
    ],
  },
  {
    id: "story-alarm",
    title: "Who keeps hitting snooze",
    contact: "Leo",
    tone: "twist",
    messages: [
      them("why is your alarm going off"),
      me("what time is it"),
      them("6am. it's been going for 20 minutes"),
      me("i'm not home. i stayed at mike's"),
      them("then who keeps hitting snooze"),
      me("the cat?"),
      them("the cat is asleep on my bed"),
      me("then who's in my room"),
      them("ok it was dad"),
      them("he says it's the most relaxing alarm in the house"),
    ],
  },
  {
    id: "story-lottery",
    title: "My lottery numbers",
    contact: "Mom",
    tone: "sweet",
    messages: [
      them("Did you buy a lottery ticket?"),
      me("yeah how did you know"),
      them("It fell out of your jacket. Check the numbers"),
      me("did i win??"),
      them("No"),
      them("But you picked my birthday"),
      me("...so?"),
      them("It's the nicest thing anyone has done all week"),
      them("Dinner's on me"),
      me("i should lose more often"),
    ],
  },
  {
    id: "story-wrong-number",
    title: "Wrong number",
    contact: "Unknown number",
    tone: "twist",
    messages: [
      them("hey is this the pizza place"),
      me("no sorry, wrong number"),
      them("oh. do you know a good pizza place"),
      me("marco's on 5th is great"),
      them("do they deliver"),
      me("yeah"),
      them("cool. ordering now"),
      them("they say it's going to the address on your account"),
      me("what account"),
      them("it's your brother. new phone. thanks for dinner"),
    ],
  },
  {
    id: "story-new-teacher",
    title: "The new teacher",
    contact: "Priya",
    tone: "twist",
    messages: [
      them("did you see the new science teacher"),
      me("no is she nice"),
      them("she seems strict"),
      them("she asked who keeps leaving gum under desk 14"),
      me("that's my desk"),
      them("i know"),
      me("did you tell her"),
      them("didn't have to"),
      them("she's your aunt, isn't she"),
      me("...family dinner is going to be so awkward"),
    ],
  },
];

/** seconds of messages, from the first to the last */
const length = (s: Story) => storyTimes(s.messages).at(-1)!.at / FPS;

/** Stories that fit a Short best run 20 to 45 seconds. */
export function storyFit(s: Story): number {
  const secs = length(s);
  return secs >= 20 && secs <= 45 ? 1 : secs < 20 ? secs / 20 : Math.max(0, 1 - (secs - 45) / 20);
}

export function proposeTexts(ctx: Context): Candidate | null {
  const fresh = STORIES.filter((s) => !ctx.used.has(s.id));
  if (!fresh.length) return null;
  // the best fit, with a little chance so channels don't all get them in the same order
  const ranked = fresh.map((s) => ({ s, score: storyFit(s) + ctx.rand() * 0.6 })).sort((a, b) => b.score - a.score);
  const { s, score } = ranked[0];
  const story: Story = { id: s.id, contact: s.contact, messages: s.messages };
  return {
    format: "texts",
    params: { story },
    key: `texts:${s.tone}`,
    score,
    why: [`A ${s.tone === "twist" ? "story with a twist" : s.tone === "sweet" ? "sweet story" : "funny story"}, about ${Math.round(length(s))} seconds of messages`, "Not posted on your channel before"],
    facts: [
      "A made-up text conversation, shown one message at a time, labelled STORY on screen. Never call it real or someone's actual texts.",
      `The other person is "${s.contact}". What it's about: ${s.title}.`,
      `The messages: ${s.messages.map((m) => `${m.me ? "me" : s.contact}: ${m.text}`).join(" / ")}.`,
      "Don't give away the ending in the title.",
    ],
    title: `Text story: ${s.title}`,
  };
}
