import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { draw } from "@/components/live/draw/frame";
import { TOP3_EMPTY } from "@/components/live/draw/top3";
import { readReply, YouTubeSource } from "@/components/live/youtube-source";
import { PLANS } from "@/lib/billing/plans";
import { rng } from "@/lib/battle/sim";
import { demoTick, GIFTS as DEMO_GIFTS, pretendGift } from "@/lib/live/demo";
import { ytLiveFit } from "@/lib/live/eligibility";
import type { LiveEvent, LivePlatform } from "@/lib/live/events";
import { GAMES, gamesFor } from "@/lib/live/games";
import { BATTLE_MENU } from "@/lib/live/games/battle";
import { RACE_MENU, RaceGame } from "@/lib/live/games/race";
import { RivalsGame } from "@/lib/live/games/rivals";
import { ROYALE_MENU, RoyaleGame } from "@/lib/live/games/royale";
import { DEFAULT_GIFTS, tierIn, withGifts } from "@/lib/live/menu";
import { DEFAULT_SIDE_GIFTS, RIVAL_HEAL, RIVAL_POWERS } from "@/lib/live/rivals";
import { DEFAULT_SETTINGS, type GameId } from "@/lib/live/settings";
import { Show } from "@/lib/live/show";
import { welcomeLine } from "@/lib/live/supporters";
import { words } from "@/lib/live/words";
import {
  keepStreaks, lookWait, readMessage, readWait, streaksOf, tallyOf, tierPower, tryItHref, youtubeMenu, youtubeRecap, YT_PRICES, YT_SIDE_MENU,
  type Streaks, type YouTubeLiveReply, type YouTubeRead, type YouTubeStatus,
} from "@/lib/live/youtube";
import { ACCOUNT_LIVE_UNITS, accountLiveUnits } from "@/lib/shorts/quota";
import { recorder } from "./stubs/canvas";
import { describe as describeEvent } from "@/components/live/setup-parts";
import { readBetween, superChatsRead } from "@/lib/earnings/superchats";
import { addTallies } from "@/lib/live/youtube";

// the route, with its settings and the reader stood in for
const setup = vi.hoisted(() => ({ db: true, youtubeLive: false }));
const asked = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/env", () => ({ configured: () => ({ ...setup }) }));
vi.mock("@/lib/server/ytlive", () => ({ youtubeLiveFor: asked }));
// and the play page, with a key's settings stood in for
const overlay = vi.hoisted(() => ({ value: { state: "unsure" } as unknown }));
vi.mock("@/lib/server/live", () => ({ overlayFor: vi.fn(), lookUp: vi.fn(async () => overlay.value) }));

type Message = { id: string; snippet: Record<string, unknown> };
const page = JSON.parse(readFileSync(new URL("./fixtures/youtube/chat-page.json", import.meta.url), "utf8")) as { items: Message[]; pollingIntervalMillis: number };
/** the fixture's message with this id; the first, when YouTube sent it more than once */
const message = (id: string) => page.items.find((m) => m.id === `LCC.w2yt-${id}`)!;
const NOW = Date.parse("2037-04-06T19:30:10Z");
const read = (id: string, streaks: Streaks = {}) => readMessage(message(id), streaks, NOW)!;
const gifts = (r: YouTubeRead) => r.events.flatMap((e) => (e.kind === "gift" ? [[e.gift, e.coins, e.count]] : []));

const viewer = (id: string, name: string) => ({ id: `yt:${id}`, name, avatar: `https://yt3.ggpht.example/${name.toLowerCase()}=s88` });

/** A Jewels gift from Jo, as YouTube sends one: its message id, its combo count so far, and when it was sent. */
const jewels = (id: string, combo: number, at: string, o: { name?: string; who?: string; details?: string } = {}) => ({
  id,
  snippet: { type: "giftEvent", publishedAt: at, [o.details ?? "giftDetails"]: { giftName: o.name ?? "Glow stick", jewelsAmount: 10, comboCount: combo } },
  authorDetails: { channelId: o.who ?? "UCjo0000000000000000001", displayName: "Jo" },
});

/** A Super Chat from Marco, in any currency and tier. */
const superChat = (details: Record<string, unknown>) => ({
  id: "LCC.w2yt-sc",
  snippet: { type: "superChatEvent", publishedAt: "2037-04-06T19:30:00Z", superChatDetails: details },
  authorDetails: { channelId: "UCmarco00000000000000001", displayName: "Marco" },
});

describe("reading YouTube's live chat", () => {
  it("makes a chat message that viewer's own: an id of its own kind, their name without the @, and their picture", () => {
    const r = read("text-kayla");
    expect(r).toMatchObject({ id: "LCC.w2yt-text-kayla", publishedAt: Date.parse("2037-04-06T19:29:40Z"), combo: 0, tally: {} });
    expect(r.events).toEqual([{ kind: "chat", viewer: viewer("UCkayla00000000000000001", "kayla"), text: "1" }]);
    // a message with no author channel says nothing to the game, and something that isn't a message is nothing
    expect(read("no-author").events).toEqual([]);
    expect(readMessage({ snippet: { type: "textMessageEvent" } }, {}, NOW)).toBeNull();
    expect(readMessage("not a message", {}, NOW)).toBeNull();
    // a long name is cut to 40 letters without splitting one, and a missing one reads as someone; a missing time is now
    const long = readMessage({ id: "x", snippet: { type: "textMessageEvent", displayMessage: "hi" }, authorDetails: { channelId: "UCx", displayName: `@${"🎈".repeat(45)}` } }, {}, NOW)!;
    expect(long.events[0]).toMatchObject({ kind: "chat", text: "hi", viewer: { name: "🎈".repeat(40) } });
    expect(long.publishedAt).toBe(NOW);
    const nameless = readMessage({ id: "y", snippet: { type: "textMessageEvent", textMessageDetails: { messageText: "yo" } }, authorDetails: { channelId: "UCy" } }, {}, NOW)!;
    expect(nameless.events[0]).toMatchObject({ viewer: { id: "yt:UCy", name: "someone" } });
  });

  it("reads a Super Chat's comment before its power, so '2' in it puts its sender on blue first, in a real show", () => {
    const r = read("sc-marco");
    expect(r.events.map((e) => e.kind)).toEqual(["chat", "gift"]);
    expect(r.events[0]).toMatchObject({ kind: "chat", text: "2" });
    expect(gifts(r)).toEqual([["Green Super Chat", 500, 1]]);
    const show = new Show({ seed: 7, settings: { game: "battle", vote: false }, platform: "youtube" });
    while (show.phase === "intro") show.update(0.25);
    for (const e of r.events) show.handle(e);
    expect(show.sideOf("yt:UCmarco00000000000000001")).toBe(1);
    // the Green Super Chat's power landed on blue: the shield, the Light blue item, and the banner says Green
    expect(show.blasts.at(-1)).toMatchObject({ side: 1, coins: 500, tier: { effect: "shield", gift: "Light blue Super Chat" }, gift: "Green Super Chat" });
  });

  it("takes power from YouTube's tier, its colour, the same in every currency, and never from an amount", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(tierPower)).toEqual([100, 200, 500, 1000, 2000, 5000, 10_000]);
    expect(tierPower(9)).toBe(30_000);
    expect(tierPower(undefined)).toBe(100);
    expect(tierPower(null)).toBe(100);
    // a ¥100 Blue Super Chat does exactly what a $1 one does, and a huge amount in the wrong tier does only its tier's
    const dollar = readMessage(superChat({ amountMicros: "1000000", currency: "USD", amountDisplayString: "$1.00", tier: 1 }), {}, NOW)!;
    const yen = readMessage(superChat({ amountMicros: "100000000", currency: "JPY", amountDisplayString: "¥100", tier: 1 }), {}, NOW)!;
    expect(yen.events).toEqual(dollar.events);
    expect(gifts(readMessage(superChat({ amountMicros: "999000000", currency: "USD", tier: 2 }), {}, NOW)!)).toEqual([["Light blue Super Chat", 200, 1]]);
    // without a tier it's just a Super Chat, at the lowest colour's power
    expect(gifts(readMessage(superChat({ amountMicros: "1000000", currency: "USD" }), {}, NOW)!)).toEqual([["Super Chat", 100, 1]]);
    expect(gifts(read("sc-yui"))).toEqual([["Blue Super Chat", 100, 1]]);
    expect(gifts(read("sc-ana"))).toEqual([["Red Super Chat", 30_000, 1]]);
    // nothing the game names, on a menu or a banner, has a currency, an amount or a tier in it
    const all = page.items.map((m) => readMessage(m, {}, NOW)!).flatMap((r) => r.events);
    const names = [
      ...all.flatMap((e) => (e.kind === "gift" ? [e.gift] : [])),
      ...[BATTLE_MENU, RACE_MENU, ROYALE_MENU].flatMap((m) => youtubeMenu(m).map((t) => t.gift)),
      ...YT_SIDE_MENU.map((t) => t.gift),
    ];
    expect(names.length).toBeGreaterThan(20);
    for (const n of names) expect(n).not.toMatch(/[$€£¥₹₩\d]|\b(USD|EUR|JPY|GBP|INR|KRW|BRL|MXN|CAD|AUD)\b|tier/i);
  });

  it("counts a Super Sticker by its tier, a new member and each gifted membership at 500, and the gifted ones only once", () => {
    expect(gifts(read("sticker-sam"))).toEqual([["Super Sticker", 200, 1]]);
    expect(read("sticker-sam").tally).toEqual({ superStickers: 1 });
    expect(gifts(read("member-lee"))).toEqual([["New member", 500, 1]]);
    expect(read("member-lee").tally).toEqual({ newMembers: 1 });
    // moving up a level is a membership bought, but not a new member
    expect(gifts(read("upgrade-nia"))).toEqual([["Membership upgrade", 500, 1]]);
    expect(read("upgrade-nia").tally).toEqual({});
    expect(gifts(read("gifting-priya"))).toEqual([["Gifted membership", 500, 5]]);
    expect(read("gifting-priya").tally).toEqual({ giftedMembers: 5 });
    // each person who gets one is already counted in the gifter's message
    expect(read("received-zoe")).toMatchObject({ events: [], tally: {} });
    // a milestone's comment is chat, with no power
    expect(read("milestone-omar").events).toEqual([{ kind: "chat", viewer: viewer("UComar00000000000000001", "Omar"), text: "six months!" }]);
    // the whole page's counts
    const streaks: Streaks = {};
    expect(tallyOf(page.items.map((m) => readMessage(m, streaks, NOW)!))).toEqual({ superChats: 3, superStickers: 1, jewels: 180, newMembers: 1, giftedMembers: 5 });
  });

  it("pays a Jewels combo only what's new, whether YouTube sends one message again or a new message for each step", () => {
    // one message sent again with a rising count, then again with the same count
    const one: Streaks = {};
    const pay = (m: unknown, s: Streaks) => readMessage(m, s, NOW)!.events.reduce((n, e) => n + (e.kind === "gift" ? e.count : 0), 0);
    expect([1, 3, 3].map((c) => pay(jewels("LCC.a", c, "2037-04-06T19:30:00Z"), one))).toEqual([1, 2, 0]);
    // a new message for each step
    const each: Streaks = {};
    expect([1, 2, 3].map((c, i) => pay(jewels(`LCC.b${c}`, c, `2037-04-06T19:30:0${i}Z`), each))).toEqual([1, 1, 1]);
    // a step already seen, sent again, is nothing; a count that doesn't rise, sent later, starts a new combo
    expect(pay(jewels("LCC.b2", 2, "2037-04-06T19:30:01Z"), each)).toBe(0);
    expect(pay(jewels("LCC.c1", 1, "2037-04-06T19:30:05Z"), each)).toBe(1);
    expect(pay(jewels("LCC.c2", 2, "2037-04-06T19:30:06Z"), each)).toBe(1);
    // two minutes quiet and the combo is over
    expect(pay(jewels("LCC.d4", 4, "2037-04-06T19:32:30Z"), each)).toBe(4);
    // each viewer and each gift has a combo of its own
    expect(pay(jewels("LCC.e1", 5, "2037-04-06T19:32:31Z", { name: "Fireworks" }), each)).toBe(5);
    expect(pay(jewels("LCC.f1", 5, "2037-04-06T19:32:31Z", { who: "UCmax000000000000000001" }), each)).toBe(5);
    expect(Object.keys(each).sort()).toEqual(["yt:UCjo0000000000000000001|Fireworks", "yt:UCjo0000000000000000001|Glow stick", "yt:UCmax000000000000000001|Glow stick"]);
    // the gift as it came, with a Jewel's power for each of its Jewels, and its combo count kept for the reader's key
    const r = readMessage(jewels("LCC.g", 2, "2037-04-06T19:30:00Z"), {}, NOW)!;
    expect(r).toMatchObject({ combo: 2, tally: { jewels: 20 } });
    expect(gifts(r)).toEqual([["Glow stick", 10, 2]]);
    // only giftDetails is read: the name some of Google's pages once used was never in the API
    expect(readMessage(jewels("LCC.h", 1, "2037-04-06T19:30:00Z", { details: "giftEventDetails" }), {}, NOW)).toMatchObject({ events: [], combo: 1 });
    // the fixture's own combos, read in order
    const s: Streaks = {};
    const page2 = page.items.map((m) => readMessage(m, s, NOW)!).filter((x) => x.events.some((e) => e.kind === "gift" && (e.gift === "Glow stick" || e.gift === "Fireworks")));
    expect(page2.map((x) => [x.id, x.combo, gifts(x)[0][2]])).toEqual([
      ["LCC.w2yt-gift-a", 1, 1], ["LCC.w2yt-gift-a", 3, 2], ["LCC.w2yt-gift-b1", 1, 1], ["LCC.w2yt-gift-b2", 2, 1], ["LCC.w2yt-gift-b3", 3, 1],
    ]);
  });

  it("keeps combos two minutes after their last step, and only saved ones that make sense", () => {
    const s: Streaks = { "yt:a|Glow stick": { n: 3, at: NOW - 60_000 }, "yt:b|Glow stick": { n: 2, at: NOW - 3 * 60_000 } };
    expect(keepStreaks(s, NOW)).toEqual({ "yt:a|Glow stick": { n: 3, at: NOW - 60_000 } });
    expect(streaksOf({ "yt:a|x": { n: 1, at: 5 }, "yt:b|x": { n: "1", at: 5 }, "yt:c|x": null })).toEqual({ "yt:a|x": { n: 1, at: 5 } });
    expect(streaksOf("nonsense")).toEqual({});
  });

  it("hands back deletions, retractions and the chat's end as what they do, and ignores what the game has no use for", () => {
    expect(read("deleted")).toMatchObject({ events: [], control: { deleted: "LCC.w2yt-text-gone" } });
    expect(read("retracted")).toMatchObject({ events: [], control: { deleted: "LCC.w2yt-text-kayla" } });
    expect(read("ended")).toMatchObject({ events: [], control: { ended: true } });
    for (const id of ["tombstone", "poll", "banned", "received-zoe"]) {
      const r = read(id);
      expect(r.events, id).toEqual([]);
      expect(r.control, id).toBeUndefined();
    }
    // a kind of message nobody has told the game about: nothing, said once in the logs
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    const odd = { id: "LCC.odd", snippet: { type: "w2ytHologramEvent", publishedAt: "2037-04-06T19:30:00Z" }, authorDetails: { channelId: "UCodd" } };
    expect(readMessage(odd, {}, NOW)).toMatchObject({ events: [], tally: {} });
    readMessage(odd, {}, NOW);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reads the whole page in order, as a game gets it", () => {
    const s: Streaks = {};
    const events = page.items.flatMap((m) => readMessage(m, s, NOW)!.events);
    const said = (e: LiveEvent) => (e.kind === "gift" ? `${e.viewer.name}: ${e.count}x ${e.gift} (${e.coins})` : e.kind === "chat" ? `${e.viewer.name}: "${e.text}"` : e.kind);
    expect(events.map(said)).toEqual([
      'kayla: "1"',
      'Marco: "2"', "Marco: 1x Green Super Chat (500)",
      "Yui: 1x Blue Super Chat (100)",
      'Ana: "A"', "Ana: 1x Red Super Chat (30000)",
      "Sam: 1x Super Sticker (200)",
      "Lee: 1x New member (500)",
      "Nia: 1x Membership upgrade (500)",
      'Omar: "six months!"',
      "Priya: 5x Gifted membership (500)",
      "Jo: 1x Glow stick (10)", "Jo: 2x Glow stick (10)",
      "Max: 1x Fireworks (50)", "Max: 1x Fireworks (50)", "Max: 1x Fireworks (50)",
      'kayla: "this one gets removed"',
    ]);
  });
});

describe("how often the reader asks YouTube", () => {
  it("never reads under 10 seconds or YouTube's own interval, slows to 20 after 3 quiet reads, and not while a game hurries", () => {
    expect(readWait(0, 0, false)).toBe(10_000);
    expect(readWait(page.pollingIntervalMillis, 0, false)).toBe(10_000);
    expect(readWait(15_000, 0, false)).toBe(15_000);
    expect(readWait(4000, 2, false)).toBe(10_000);
    expect(readWait(4000, 3, false)).toBe(20_000);
    expect(readWait(4000, 9, true)).toBe(10_000);
    expect(readWait(30_000, 5, false)).toBe(30_000);
    expect(readWait(NaN, 0, false)).toBe(10_000);
  });

  it("looks for the stream every minute for 10 minutes, every 5 up to 3 hours, then every 30, and never stops", () => {
    const min = 60_000;
    expect(lookWait(0, 0)).toBe(min);
    expect(lookWait(0, 9 * min + 59_000)).toBe(min);
    expect(lookWait(0, 10 * min)).toBe(5 * min);
    expect(lookWait(0, 179 * min)).toBe(5 * min);
    expect(lookWait(0, 180 * min)).toBe(30 * min);
    expect(lookWait(0, 30 * 24 * 60 * min)).toBe(30 * min);
  });

  it("gives one account at most 1,500 of the day's units, and never more than YouTube Live's share", () => {
    expect(ACCOUNT_LIVE_UNITS).toBe(1500);
    expect(accountLiveUnits(10_000)).toBe(1500);
    expect(accountLiveUnits(4000)).toBe(1000);
    expect(accountLiveUnits(null)).toBe(1500);
  });
});

describe("the menus on YouTube", () => {
  it("keeps each game's six things in order, set off by Jewels gifts and then by Super Chat colours", () => {
    expect(YT_PRICES).toEqual([1, 5, 20, 100, 200, 1000]);
    for (const menu of [BATTLE_MENU, RACE_MENU, ROYALE_MENU]) {
      const yt = youtubeMenu(menu);
      expect(yt.map((t) => [t.effect, t.name, t.line])).toEqual(menu.map((t) => [t.effect, t.name, t.line]));
      expect(yt.map((t) => [t.gift, t.unit, t.min])).toEqual([
        ["Gifts", "jewels", 1], ["Gifts", "jewels", 5], ["Gifts", "jewels", 20],
        ["Blue Super Chat", "super", 100], ["Light blue Super Chat", "super", 200], ["Yellow Super Chat", "super", 1000],
      ]);
      // the colours draw as chips, and the Jewels items as thresholds with no chip
      expect(yt.map((t) => !!t.chip)).toEqual([false, false, false, true, true, true]);
    }
    // the streamer's own TikTok gift menu doesn't apply on YouTube
    const own = withGifts(BATTLE_MENU, DEFAULT_GIFTS.map((g, i) => ({ name: `Gift ${i}`, coins: [1, 2, 3, 4, 5, 6][i] })));
    expect(youtubeMenu(own)).toEqual(youtubeMenu(BATTLE_MENU));
  });

  it("sets off what the menu says for each colour: Blue is Rage, Light blue and Green the Shield, Yellow and up the Meteor", () => {
    const battle = youtubeMenu(BATTLE_MENU);
    const effect = (tier: number) => tierIn(battle, tierPower(tier)).effect;
    expect([1, 2, 3, 4, 5, 6, 7, 9].map(effect)).toEqual(["rage", "shield", "shield", "meteor", "meteor", "meteor", "meteor", "meteor"]);
    expect([1, 5, 20, 99].map((j) => tierIn(battle, j).effect)).toEqual(["heal", "small", "ball", "ball"]);
  });

  it("gives Rivals one menu for both sides on YouTube: Jewels heal, then Blue, Light blue and Green", () => {
    expect(YT_SIDE_MENU.map((t) => [t.effect, t.gift, t.unit, t.min])).toEqual([
      ["heal", "Gifts", "jewels", 1], ["ball", "Blue Super Chat", "super", 100], ["rage", "Light blue Super Chat", "super", 200], ["meteor", "Green Super Chat", "super", 500],
    ]);
    expect(YT_SIDE_MENU.slice(1).map((t) => t.name)).toEqual(RIVAL_POWERS.map((p) => p.name));
    // nothing on it names a TikTok gift
    const tiktok = [...DEFAULT_GIFTS, ...DEFAULT_SIDE_GIFTS.red, ...DEFAULT_SIDE_GIFTS.blue].map((g) => g.name.toLowerCase());
    for (const t of YT_SIDE_MENU) for (const g of tiktok) expect(`${t.gift} ${t.line}`.toLowerCase()).not.toContain(g);
  });
});

describe("what the stream says on each platform", () => {
  it("never mentions likes, shares, coins or a TikTok gift on YouTube", () => {
    const yt = words("youtube");
    const lines = [...Object.values(yt).filter((v): v is string => typeof v === "string"), yt.welcome(1), yt.welcome(2)];
    expect(lines.length).toBeGreaterThan(14);
    const tiktok = [...DEFAULT_GIFTS, ...DEFAULT_SIDE_GIFTS.red, ...DEFAULT_SIDE_GIFTS.blue].map((g) => g.name.toUpperCase());
    for (const s of lines) {
      expect(s).not.toMatch(/LIKE|SHARE|COIN/i);
      for (const g of tiktok) expect(s.toUpperCase()).not.toContain(g);
    }
    expect(yt).toMatchObject({ worth: "POWER", rivalsPick: "THEN SUPER CHAT TO HELP YOUR SIDE", vote: "TYPE A, B OR C · SUPER CHATS ADD VOTES" });
  });

  it("keeps TikTok's lines as they've always been", () => {
    const tt = words("tiktok");
    expect(tt).toMatchObject({
      battleRules: "LIKES HEAL YOUR TEAM",
      raceRules: "LIKES MAKE YOUR BALL HEAVIER",
      royaleRules: "LIKES HEAL YOUR BALL",
      rivalsRules: "LIKES AND OTHER GIFTS HELP YOUR SIDE",
      raceHeader: "TO RACE FOR FREE · GIFTS MAKE YOUR BALL HEAVIER",
      rivalsPick: "OR SEND YOUR SIDE'S GIFT",
      footLater: "GIFTS SENT NOW LAND WHEN IT STARTS",
      footNow: "GIFT NOW TO START AHEAD",
      vote: "TYPE A, B OR C · GIFTS ADD VOTES",
      worth: "COINS",
      crownNobody: "BIGGEST GIFTER WEARS THE CROWN",
      raceFull: "race is full · send a gift to get in",
      royaleFull: "it's full · send a gift to get in",
      top3Empty: "TOP GIFTERS THIS LIVE",
    });
    expect(TOP3_EMPTY).toBe(tt.top3Empty);
    expect([tt.welcome(1), tt.welcome(3)]).toEqual([welcomeLine(1), welcomeLine(3)]);
  });
});

describe("a YouTube LIVE's recap", () => {
  it("gives the Super Chats the game heard on the stream, names nobody and never shows money", () => {
    const recaps = [
      youtubeRecap({ rounds: 12, peakPlayers: 31, superChats: 4, title: "Ball Battle all night", earnings: true }),
      youtubeRecap({ rounds: 3, peakPlayers: 5, superChats: 1, title: null, earnings: true }),
      youtubeRecap({ rounds: 1, peakPlayers: 2, superChats: 0, title: "Quiet one", earnings: true }),
    ];
    expect(recaps).toEqual([
      { title: "LIVE recap on YouTube: 12 rounds", body: '31 playing at once. The game heard 4 Super Chats on "Ball Battle all night". What viewers paid shows in Earnings, from YouTube.' },
      { title: "LIVE recap on YouTube: 3 rounds", body: "5 playing at once. The game heard 1 Super Chat on your stream. What viewers paid shows in Earnings, from YouTube." },
      { title: "LIVE recap on YouTube: 1 round", body: "2 playing at once." },
    ]);
    for (const r of recaps) expect(`${r.title} ${r.body}`).not.toMatch(/[$€£¥]|\b(USD|EUR|JPY)\b|coin|earned|income/i);
  });

  it("points to Earnings only for someone whose Super Chats Hookline reads, and never says when they'll show", () => {
    expect(youtubeRecap({ rounds: 3, peakPlayers: 5, superChats: 2, title: null }).body).toBe("5 playing at once. The game heard 2 Super Chats on your stream.");
    expect(youtubeRecap({ rounds: 3, peakPlayers: 5, superChats: 2, title: null, earnings: false }).body).not.toMatch(/Earnings/);
    // a read can wait for YouTube's quota, so no time is promised
    expect(youtubeRecap({ rounds: 3, peakPlayers: 5, superChats: 2, title: null, earnings: true }).body).not.toMatch(/hour|minute|today|soon|within/i);
  });

  it("says the streams, not one stream, for a LIVE that heard more than one", () => {
    expect(youtubeRecap({ rounds: 9, peakPlayers: 14, superChats: 6, title: null, streams: 2, earnings: true }).body).toBe(
      "14 playing at once. The game heard 6 Super Chats on your streams. What viewers paid shows in Earnings, from YouTube.",
    );
  });
});

describe("Super Chats in Earnings", () => {
  const tz = "America/Los_Angeles";
  // 3pm in Los Angeles
  const now = new Date("2037-05-10T22:00:00Z");
  const paid = (amount: number, currency: string, iso: string) => ({ amountMicros: Math.round(amount * 1e6), currency, createdAt: new Date(iso) });
  const byDay = (r: ReturnType<typeof superChatsRead>) => [...r.days].map(([cur, m]) => [cur, [...m]]);

  it("adds up what viewers paid by their own day and currency, exactly, from the first whole day of YouTube's 30", () => {
    const read = superChatsRead([
      paid(4.99, "USD", "2037-05-10T16:00:00Z"),
      paid(0.01, "USD", "2037-05-10T18:00:00Z"),
      // 11pm on the 9th where they are, though the 10th in UTC
      paid(100, "JPY", "2037-05-10T06:00:00Z"),
      paid(2, "usd", "2037-04-11T08:00:00Z"),
      // from before 30 days ago
      paid(50, "EUR", "2037-04-09T12:00:00Z"),
    ], { tz, now, whole: true });
    // 30 days back is 3pm on April 10, so that day was only part read
    expect(read.first).toBe("2037-04-11");
    expect(byDay(read)).toEqual([["usd", [["2037-05-10", 5], ["2037-04-11", 2]]], ["jpy", [["2037-05-09", 100]]]]);
  });

  it("starts the day after the oldest it reached when the page limit stopped it, since that day may be missing some", () => {
    const read = superChatsRead([paid(1, "USD", "2037-05-10T20:00:00Z"), paid(3, "USD", "2037-05-08T20:00:00Z"), paid(9, "USD", "2037-05-08T07:00:00Z")], { tz, now, whole: false });
    expect(read.first).toBe("2037-05-09");
    expect(byDay(read)).toEqual([["usd", [["2037-05-10", 1]]]]);
    // with nothing read, the days start tomorrow, so nothing is kept
    expect(superChatsRead([], { tz, now, whole: false }).first).toBe("2037-05-11");
  });

  it("knows a channel's figures only for the days Hookline has read, where a day read with none had none", () => {
    expect(readBetween(["2037-05-01", "2037-05-02", "2037-05-03", "2037-05-04"], new Map([["2037-05-03", 7]]), "2037-05-02", "2037-05-03")).toEqual([
      { day: "2037-05-01", value: null }, { day: "2037-05-02", value: 0 }, { day: "2037-05-03", value: 7 }, { day: "2037-05-04", value: null },
    ]);
  });
});

describe("what the LIVE page hears on YouTube", () => {
  const marco = { id: "yt:UCmarco00000000000000001", name: "Marco" };

  it("names a gift by the power the game gives it, never coins or money", () => {
    expect(describeEvent({ kind: "gift", viewer: marco, gift: "Green Super Chat", coins: 500, count: 1 }, "power")).toBe("sent Green Super Chat (500 power)");
    expect(describeEvent({ kind: "gift", viewer: marco, gift: "Glow stick", coins: 10, count: 3 }, "power")).toBe("sent 3× Glow stick (30 power)");
    // TikTok's are its coins, as they were
    expect(describeEvent({ kind: "gift", viewer: marco, gift: "Rose", coins: 1, count: 1 })).toBe("sent Rose (1 coin)");
    expect(describeEvent({ kind: "chat", viewer: marco, text: "2" }, "power")).toBe("said “2”");
  });

  it("adds up what the game heard on each of a LIVE's streams", () => {
    const one = { superChats: 2, superStickers: 1, jewels: 30, newMembers: 1, giftedMembers: 0 };
    expect(addTallies([one, { ...one, giftedMembers: 5 }])).toEqual({ superChats: 4, superStickers: 2, jewels: 60, newMembers: 2, giftedMembers: 5 });
    expect(addTallies([])).toEqual({ superChats: 0, superStickers: 0, jewels: 0, newMembers: 0, giftedMembers: 0 });
  });

  it("gives the real YouTube game as the test panel's address only to someone shown YouTube's setup", () => {
    const key = "w2ytlive-key-0001";
    const yes = { adult: true, canGoLive: true, computer: true, superChat: true };
    // as the LIVE page decides it: the setup shows once they've answered and can play
    const href = (check: typeof yes | null) => {
      const fit = ytLiveFit(check);
      return tryItHref(key, "youtube", fit.asked && fit.ok, "rivals");
    };
    // not answered yet, or any answer that keeps them off YouTube Live: the game in YouTube's look with no key, so nothing is read
    for (const check of [null, { ...yes, adult: false }, { ...yes, canGoLive: false }, { ...yes, computer: false }, { ...yes, superChat: false }]) {
      expect(href(check)).toBe("/live/play?src=youtube&game=rivals");
    }
    // someone shown the setup gets their own game, which reads their own stream's chat
    expect(href(yes)).toBe(`/live/play?key=${key}&src=youtube`);
    // TikTok's is their own game with no LIVE to hear, as it was
    expect(tryItHref(key, "tiktok", false, "battle")).toBe(`/live/play?key=${key}`);
  });

  it("tells a YouTube streamer that Rivals' sides are picked in chat there, never by a gift", () => {
    const rivals = (p: LivePlatform) => gamesFor(p).find((g) => g.id === "rivals")!;
    expect(rivals("youtube")).toMatchObject({ line: "A new rivalry every round, red against blue. Both sides take the same Super Chats. Type 1 or 2 to pick yours.", join: "Type 1 or 2" });
    expect(`${rivals("youtube").line} ${rivals("youtube").join}`).not.toMatch(/gift/i);
    // TikTok's read as they always did, and the other games read the same on both
    expect(gamesFor("tiktok")).toEqual(GAMES);
    expect(gamesFor("youtube").filter((g) => g.id !== "rivals")).toEqual(GAMES.filter((g) => g.id !== "rivals"));
  });
});

describe("GET /api/live/youtube", () => {
  const ask = async (q: string) => (await import("@/app/api/live/youtube/route")).GET(new Request(`https://hookline.test/api/live/youtube?${q}`));

  afterEach(() => {
    asked.mockReset();
    Object.assign(setup, { db: true, youtubeLive: false });
  });

  it("says Not set up without a database, and that YouTube Live is off while it's switched off, asking again in a minute", async () => {
    setup.db = false;
    expect((await ask("key=w2ytlive-key-0001")).status).toBe(503);
    setup.db = true;
    const res = await ask("key=w2ytlive-key-0001&after=42");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ state: "off", channel: null, title: null, broadcast: null, until: null, who: null, detail: null, kids: false, events: [], seq: 42, wait: 60_000 });
    expect(asked).not.toHaveBeenCalled();
  });

  it("passes the game's place, look-now and hurry on, says 404 only for a key that isn't anyone's, and 503 when it can't tell", async () => {
    setup.youtubeLive = true;
    const reply = { state: "live", channel: "Ball Battle TV", title: "Ball Battle all night", broadcast: "w2ytBcast01", until: null, who: null, detail: null, kids: false, events: [], seq: 9, wait: 10_300 };
    asked.mockResolvedValueOnce(reply);
    const res = await ask("key=w2ytlive-key-0001&after=8&go=1&hurry=1");
    expect(await res.json()).toEqual(reply);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(asked).toHaveBeenLastCalledWith("w2ytlive-key-0001", 8, { go: true, hurry: true, setup: false });
    // a first ask has no place, and one that isn't a number is treated as a first ask
    asked.mockResolvedValueOnce(reply);
    await ask("key=w2ytlive-key-0001&after=nine");
    expect(asked).toHaveBeenLastCalledWith("w2ytlive-key-0001", null, { go: false, hurry: false, setup: false });
    // the LIVE page listening says so, so it never counts as a game being open
    asked.mockResolvedValueOnce(reply);
    await ask("key=w2ytlive-key-0001&setup=1");
    expect(asked).toHaveBeenLastCalledWith("w2ytlive-key-0001", null, { go: false, hurry: false, setup: true });
    asked.mockResolvedValueOnce(null);
    expect((await ask("key=nobody-has-this-key")).status).toBe(404);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    asked.mockRejectedValueOnce(new Error("connection refused"));
    const down = await ask("key=w2ytlive-key-0001");
    expect(down.status).toBe(503);
    expect(await down.text()).toBe("Try again soon");
  });
});

describe("hearing a YouTube LIVE through Hookline", () => {
  const KEY = "w2ytlive-key-0001";
  const reply = (o: Partial<YouTubeLiveReply> = {}): YouTubeLiveReply => ({
    state: "live", channel: "Ball Battle TV", title: "Ball Battle all night", broadcast: "w2ytBcast01", until: null, who: null, detail: null, kids: false, events: [], seq: 1, wait: 10_000, ...o,
  });
  const kayla: LiveEvent = { kind: "chat", viewer: viewer("UCkayla00000000000000001", "kayla"), text: "1" };
  const marco: LiveEvent = { kind: "gift", viewer: viewer("UCmarco00000000000000001", "Marco"), gift: "Green Super Chat", coins: 500, count: 1 };

  /** what fetch hands back: an answer, a status with nothing readable in it, or a network that fails */
  type Answer = object | number | "down";
  const respond = async (a: Answer) => {
    if (a === "down") throw new TypeError("fetch failed");
    if (typeof a === "number") return { ok: a < 400, status: a, json: async () => null };
    return { ok: true, status: 200, json: async () => a };
  };

  /** Hookline, stood in for: each ask takes the next answer, and the last one again once they run out. What each ask asked, and when. */
  function hookline(...answers: Answer[]) {
    const asks: { q: string; at: number }[] = [];
    const start = Date.now();
    vi.stubGlobal("fetch", (url: string) => {
      asks.push({ q: url.slice(url.indexOf("?") + 1), at: Date.now() - start });
      return respond(answers.length > 1 ? answers.shift()! : answers[0]);
    });
    return asks;
  }

  /** a game listening: what the source told it, in order */
  function listen(hurry?: () => boolean) {
    const said: string[] = [];
    const src = new YouTubeSource(KEY, {
      onEvent: (e) => said.push(e.kind === "chat" ? `${e.viewer.name}: ${e.text}` : e.kind === "gift" ? `${e.viewer.name} sent ${e.gift}` : e.kind),
      onState: (s) => said.push(s),
      onStatus: (s) => said.push(s.state === "gone" ? "gone" : `${s.state} ${s.broadcast ?? ""}`.trim()),
      hurry,
    });
    return { src, said };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("passes on what Hookline says about the stream, then what happened in order, and asks again when it's told to", async () => {
    vi.useFakeTimers();
    const asks = hookline(reply({ events: [kayla, marco], seq: 7, wait: 12_000 }), reply({ seq: 8 }));
    const { src, said } = listen();
    src.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toEqual(["connecting", "open", "live w2ytBcast01", "kayla: 1", "Marco sent Green Super Chat"]);
    // the first ask has no place, so a new game starts from now, and it looks for the stream straight away
    expect(asks).toEqual([{ q: `key=${KEY}&go=1`, at: 0 }]);
    // then it waits as long as Hookline said, and passes back where it left off
    await vi.advanceTimersByTimeAsync(11_000);
    expect(asks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(asks[1]).toEqual({ q: `key=${KEY}&after=7`, at: 12_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(asks[2]).toEqual({ q: `key=${KEY}&after=8`, at: 22_000 });
    src.stop();
  });

  it("says when the game is hurrying, and asks at once when a countdown or vote starts while Hookline reads a chat", async () => {
    vi.useFakeTimers();
    let hurrying = false;
    const asks = hookline(reply());
    const { src } = listen(() => hurrying);
    src.start();
    await vi.advanceTimersByTimeAsync(3000);
    hurrying = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(asks).toEqual([{ q: `key=${KEY}&go=1`, at: 0 }, { q: `key=${KEY}&after=1&hurry=1`, at: 4000 }]);
    // still hurrying, it goes by Hookline's wait, since Hookline already reads at its fastest
    await vi.advanceTimersByTimeAsync(9000);
    expect(asks).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(asks[2]).toEqual({ q: `key=${KEY}&after=1&hurry=1`, at: 14_000 });
    src.stop();
  });

  it("doesn't hurry Hookline while there's no stream to read", async () => {
    vi.useFakeTimers();
    const asks = hookline(reply({ state: "not_live", title: null, broadcast: null, wait: 60_000 }));
    const { src } = listen(() => true);
    src.start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(asks).toEqual([{ q: `key=${KEY}&go=1&hurry=1`, at: 0 }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(asks[1]).toEqual({ q: `key=${KEY}&after=1&hurry=1`, at: 60_000 });
    src.stop();
  });

  it("looks for the stream at once when OBS starts streaming, and not once it's stopped", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    const asks = hookline(reply({ state: "not_live", title: null, broadcast: null, wait: 60_000 }));
    const { src } = listen();
    src.start();
    await vi.advanceTimersByTimeAsync(5000);
    window.dispatchEvent(new Event("obsStreamingStarted"));
    await vi.advanceTimersByTimeAsync(0);
    expect(asks).toEqual([{ q: `key=${KEY}&go=1`, at: 0 }, { q: `key=${KEY}&after=1&go=1`, at: 5000 }]);
    src.stop();
    window.dispatchEvent(new Event("obsStreamingStarted"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(asks).toHaveLength(2);
  });

  it("asks again the moment an answer's in when Check now comes while it's asking, and keeps looking until that's answered", async () => {
    vi.useFakeTimers();
    const asks: string[] = [];
    const answers: ((a: unknown) => void)[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      asks.push(url.slice(url.indexOf("?") + 1));
      return new Promise((r) => answers.push(r));
    });
    const { src } = listen();
    src.start();
    await vi.advanceTimersByTimeAsync(0);
    src.check();
    answers[0](await respond(reply({ state: "not_live", wait: 60_000 })));
    await vi.advanceTimersByTimeAsync(10);
    expect(asks).toEqual([`key=${KEY}&go=1`, `key=${KEY}&after=1&go=1`]);
    answers[1](await respond(reply({ state: "not_live", seq: 2, wait: 60_000 })));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asks[2]).toBe(`key=${KEY}&after=2`);
    src.stop();
  });

  it("says closed while Hookline can't be reached, and tries again in 1, 2 and 4 seconds, then every 10, still looking for the stream", async () => {
    vi.useFakeTimers();
    // a network that fails, a server that can't answer, and an answer that isn't one all count the same
    const asks = hookline("down", 503, { state: "streaming" }, "down", "down", reply());
    const { src, said } = listen();
    src.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(asks.map((a) => a.at)).toEqual([0, 1000, 3000, 7000, 17_000, 27_000]);
    expect(new Set(asks.map((a) => a.q))).toEqual(new Set([`key=${KEY}&go=1`]));
    expect(said).toEqual(["connecting", "closed", "open", "live w2ytBcast01"]);
    // and once it gets through, as usual
    await vi.advanceTimersByTimeAsync(10_000);
    expect(asks.at(-1)).toEqual({ q: `key=${KEY}&after=1`, at: 37_000 });
    src.stop();
  });

  it("stops for good once the address's key has been replaced", async () => {
    vi.useFakeTimers();
    const asks = hookline(404);
    const { src, said } = listen();
    src.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(said).toEqual(["connecting", "gone", "closed"]);
    expect(asks).toHaveLength(1);
  });

  it("holds Hookline's wait to between a second and a minute", async () => {
    vi.useFakeTimers();
    const asks = hookline(reply({ wait: 0 }), reply({ wait: 5 * 60_000 }), reply());
    const { src } = listen();
    src.start();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(asks.map((a) => a.at)).toEqual([0, 1000, 61_000]);
    src.stop();
  });

  it("takes only an answer that is one, and only the events in it that are something a viewer did", () => {
    expect(readReply(reply({ events: [kayla, marco] }))).toEqual(reply({ events: [kayla, marco] }));
    for (const junk of [null, "live", [], { ...reply(), state: "streaming" }, { ...reply(), seq: "7" }, { ...reply(), events: null }, { ...reply(), wait: Infinity }]) {
      expect(readReply(junk)).toBeNull();
    }
    const odd = [{ kind: "dance", viewer: kayla.viewer }, { ...marco, coins: "500" }, { kind: "chat", viewer: { id: 7, name: "x" }, text: "1" }, "Marco: hi"];
    expect(readReply({ ...reply(), channel: 7, who: "nobody", events: [kayla, ...odd, marco] })).toMatchObject({ channel: null, who: null, events: [kayla, marco] });
    // made for kids only when Hookline says so in so many words
    expect(readReply(reply({ state: "chat_off", kids: true }))).toMatchObject({ kids: true });
    expect(readReply({ ...reply({ state: "chat_off" }), kids: "yes" })).toMatchObject({ kids: false });
  });

  it("passes on that YouTube has the stream as made for kids, so the game says why its chat is off", async () => {
    vi.useFakeTimers();
    hookline(reply({ state: "chat_off", kids: true, detail: "YouTube has this stream as made for kids, so it has no live chat." }));
    const seen: YouTubeStatus[] = [];
    const src = new YouTubeSource(KEY, { onEvent: () => {}, onStatus: (s) => seen.push(s) });
    src.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([{ state: "chat_off", channel: "Ball Battle TV", title: "Ball Battle all night", broadcast: "w2ytBcast01", until: null, who: null, detail: "YouTube has this stream as made for kids, so it has no live chat.", kids: true }]);
    src.stop();
  });
});

describe("the games on YouTube", () => {
  const VIEW = { demo: false, image: () => null, tag: true };
  const say = words("youtube");
  const RULES: Record<GameId, string> = { battle: say.battleRules, race: say.raceRules, royale: say.royaleRules, rivals: say.rivalsRules };
  const TIKTOK_GIFTS = [...DEFAULT_GIFTS, ...DEFAULT_SIDE_GIFTS.red, ...DEFAULT_SIDE_GIFTS.blue, ...DEMO_GIFTS].map((g) => g.name.toUpperCase());
  /** a line a YouTube stream never shows: likes, shares, coins, or a TikTok gift */
  const tiktokish = (s: string) => /LIKE|SHARE|COIN/i.test(s) || TIKTOK_GIFTS.some((g) => s.toUpperCase().includes(g));
  const FANS = ["kayla", "Marco", "Yui", "Ana", "Sam", "Lee", "Nia", "Omar", "Priya", "Jo", "Max"];
  /** the fixture's page, as the game gets it */
  const fixture = () => {
    const s: Streaks = {};
    return page.items.flatMap((m) => readMessage(m, s, NOW)!.events);
  };
  const sentGifts = new Set(fixture().flatMap((e) => (e.kind === "gift" ? [e.gift] : [])));

  it("never shows likes, shares, coins or a TikTok gift in any game, from the countdown through the vote to the next round", () => {
    for (const game of ["battle", "race", "royale", "rivals"] as GameId[]) {
      for (const vote of [true, false]) {
        const show = new Show({ seed: 12, settings: { game, vote }, platform: "youtube" });
        const seen = new Set<string>();
        const look = () => {
          const r = recorder();
          draw(r.ctx, show, VIEW);
          for (const t of r.texts) seen.add(t);
        };
        const run = (secs: number) => {
          for (let t = 0; t < secs; t += 0.2) {
            show.update(0.2);
            look();
          }
        };
        // the countdown: people pick sides or type go, and the page's Super Chats, stickers, memberships and Jewels gifts land
        look();
        FANS.forEach((name, i) => {
          show.handle({ kind: "chat", viewer: viewer(`UC${name}`, name), text: String((i % 2) + 1) });
          show.handle({ kind: "chat", viewer: viewer(`UC${name}`, name), text: "go" });
        });
        for (const e of fixture()) show.handle(e);
        run(2);
        // and all of it again in the fight
        while (show.phase === "intro") run(0.2);
        run(3);
        for (const e of fixture()) show.handle(e);
        // then the round to its end, the vote with a Super Chat in it, and the next round's countdown
        for (let i = 0; i < 2000 && show.phase !== "win"; i++) run(0.2);
        run(1);
        show.handle({ kind: "chat", viewer: viewer("UCyui", "Yui"), text: "b" });
        show.handle({ kind: "gift", viewer: viewer("UCana", "Ana"), gift: "Blue Super Chat", coins: 100, count: 1 });
        for (let i = 0; i < 400 && show.round < 2; i++) run(0.2);
        run(1);
        const where = `${game}, vote ${vote ? "on" : "off"}`;
        expect(show.round, where).toBe(2);
        expect([...seen].filter(tiktokish), where).toEqual([]);
        // and it was YouTube's game all along: its rules, and banners naming what was sent
        expect(seen, where).toContain(RULES[game]);
        const banners = [...seen].flatMap((t) => / sent (?:\d+x )?(.+)$/.exec(t)?.[1] ?? []);
        expect(banners.length, where).toBeGreaterThan(0);
        for (const g of banners) expect(sentGifts, where).toContain(g);
      }
    }
  });

  it("tells a free entry how to get into a full race or arena with a Super Chat", () => {
    const fill = (g: RaceGame | RoyaleGame) => {
      g.start({ round: 1, option: null, rand: rng(5) });
      for (let i = 0; i < 40; i++) {
        const said = g.enter(viewer(`UCfan${i}`, `fan${i}`));
        if (!said?.toast?.startsWith("joined")) return said?.toast;
      }
    };
    expect(fill(new RaceGame(DEFAULT_SETTINGS, "youtube"))).toBe("race is full · Super Chat to get in");
    expect(fill(new RoyaleGame(DEFAULT_SETTINGS, "youtube"))).toBe("it's full · Super Chat to get in");
    // TikTok's say what they always have
    expect(fill(new RaceGame(DEFAULT_SETTINGS))).toBe("race is full · send a gift to get in");
    expect(fill(new RoyaleGame(DEFAULT_SETTINGS))).toBe("it's full · send a gift to get in");
  });

  it("gives both sides of Rivals the same menu, and lets the chat pick the side, never a gift's name", () => {
    const g = new RivalsGame(DEFAULT_SETTINGS, "youtube");
    expect([g.sideMenu(0), g.sideMenu(1)]).toEqual([YT_SIDE_MENU, YT_SIDE_MENU]);
    expect(g.menu).toEqual([YT_SIDE_MENU[0]]);
    for (const name of [...DEFAULT_SIDE_GIFTS.red, ...DEFAULT_SIDE_GIFTS.blue].map((x) => x.name).concat(YT_SIDE_MENU.map((t) => t.gift))) expect(g.route(name), name).toBeNull();
    // in a real show, a gift named like red's TikTok gift helps blue when blue is where its sender is
    const show = new Show({ seed: 8, settings: { game: "rivals", vote: false }, platform: "youtube" });
    while (show.phase === "intro") show.update(0.25);
    const jo = viewer("UCjo0000000000000000001", "Jo");
    show.handle({ kind: "chat", viewer: jo, text: "2" });
    show.handle({ kind: "gift", viewer: jo, gift: "Paper Crane", coins: 500, count: 1 });
    expect(show.sideOf(jo.id)).toBe(1);
    expect(show.blasts.at(-1)).toMatchObject({ side: 1, tier: { effect: "meteor", gift: "Green Super Chat" }, gift: "Paper Crane" });
    // and a Super Chat's own comment picks the side before its power lands there
    for (const e of readMessage(superChat({ tier: 2, userComment: "1" }), {}, NOW)!.events) show.handle(e);
    expect(show.sideOf("yt:UCmarco00000000000000001")).toBe(0);
    expect(show.blasts.at(-1)).toMatchObject({ side: 0, tier: { effect: "rage", gift: "Light blue Super Chat" }, gift: "Light blue Super Chat" });
    // on TikTok, each side's own gifts still pick it
    const tt = new RivalsGame(DEFAULT_SETTINGS);
    expect(tt.route("Paper Crane")).toMatchObject({ side: 0 });
    expect(tt.route("Little Crown")).toMatchObject({ side: 1 });
    expect(tt.menu).toEqual([RIVAL_HEAL]);
  });

  it("has pretend viewers send what YouTube's menu takes, Jewels gifts and Super Chats by colour, and never a like or a follow", () => {
    const gifts = youtubeMenu(BATTLE_MENU).map(pretendGift);
    expect(gifts).toEqual([
      { name: "Jewels gift", coins: 1 }, { name: "Jewels gift", coins: 5 }, { name: "Jewels gift", coins: 20 },
      { name: "Blue Super Chat", coins: 100 }, { name: "Light blue Super Chat", coins: 200 }, { name: "Yellow Super Chat", coins: 1000 },
    ]);
    const rand = rng(9);
    const events = Array.from({ length: 3000 }, () => demoTick(0.25, rand, { gifts, likes: false })).flat();
    expect([...new Set(events.map((e) => e.kind))].sort()).toEqual(["chat", "gift"]);
    for (const e of events) if (e.kind === "gift") expect(gifts).toContainEqual({ name: e.gift, coins: e.coins });
    // TikTok's send the menu's own gifts, just as they always have
    expect(BATTLE_MENU.map(pretendGift)).toEqual(DEMO_GIFTS);
    expect(demoTick(30, rng(4))).toEqual(demoTick(30, rng(4), { teams: true, voting: false, gifts: DEMO_GIFTS, likes: true }));
  });
});

describe("the play page on YouTube", () => {
  const open = async (q: Record<string, string>) => (await import("@/app/live/play/page")).default({ searchParams: Promise.resolve(q) });

  afterEach(() => {
    overlay.value = { state: "unsure" };
  });

  it("hears YouTube through Hookline with the streamer's key, keeps no round for a Short, and is YouTube's game without a key", async () => {
    overlay.value = { state: "ok", value: { settings: { ...DEFAULT_SETTINGS, clips: true }, plan: PLANS.pro, supporters: [] } };
    expect((await open({ key: "w2ytlive-key-0001", src: "youtube" })).props).toMatchObject({ src: "youtube", platform: "youtube", overlayKey: "w2ytlive-key-0001", settings: { clips: false } });
    // the same key on TikTok keeps rounds for Shorts, as the streamer chose
    expect((await open({ key: "w2ytlive-key-0001", src: "tikfinity" })).props).toMatchObject({ src: "tikfinity", platform: "tiktok", settings: { clips: true } });
    // without a key there's no one's stream to ask for: the plain game, with YouTube's menu and words
    expect((await open({ src: "youtube" })).props).toMatchObject({ src: "none", platform: "youtube", overlayKey: undefined, settings: { clips: false } });
    // so the test panel's address for someone who can't play on YouTube reads nothing
    expect((await open({ src: "youtube", game: "rivals" })).props).toMatchObject({ src: "none", platform: "youtube", overlayKey: undefined });
  });
});
