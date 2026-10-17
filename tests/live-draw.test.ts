import { describe, expect, it } from "vitest";
import { draw } from "@/components/live/draw/frame";
import { H, TIKTOK_PHONE, TOP3, W, type View } from "@/components/live/draw/kit";
import { drawRecap, RECAP, RECAP_CLEAR, recapWords, type RecapData } from "@/components/live/draw/recap";
import { drawTop3, WIN_TOP3_Y } from "@/components/live/draw/top3";
import type { Viewer } from "@/lib/live/events";
import type { GameId } from "@/lib/live/settings";
import { Show, WELCOME_FOR } from "@/lib/live/show";
import { recorder, type Drawn } from "./stubs/canvas";

/**
 * What the live games put on screen: the LIVE's top 3 covers nothing and
 * nothing covers it, in every game and every part of a round, clear of
 * where TikTok's app covers a LIVE; and with names hidden, no viewer's
 * name or picture is drawn anywhere. And what a LIVE's recap card says.
 */

const GAMES: GameId[] = ["battle", "race", "royale", "rivals"];
const picture = {} as HTMLImageElement;
const SHOWN: View = { demo: false, image: () => picture };
const HIDDEN: View = { ...SHOWN, hideNames: true };

const zeb: Viewer = { id: "7001", name: "Zebulon Quixote", avatar: "https://p.example/z.jpg" };
const kayla: Viewer = { id: "7002", name: "Kayla Smith", avatar: "https://p.example/k.jpg" };
const mia: Viewer = { id: "7003", name: "mia", avatar: "https://p.example/m.jpg" };

type Gift = [name: string, coins: number];
/** in each game: a gift that puts the gifter's face in the arena, one with a banner (and a power that names who has it, in the race and Last One Standing), and a bigger one */
const GIFTS: Record<GameId, { face: Gift; power: Gift; big: Gift }> = {
  battle: { face: ["Perfume", 20], power: ["Corgi", 299], big: ["Galaxy", 1000] },
  rivals: { face: ["Paper Crane", 99], power: ["Sunglasses", 199], big: ["Corgi", 299] },
  race: { face: ["Rose", 1], power: ["Hand Hearts", 100], big: ["Galaxy", 1000] },
  royale: { face: ["Rose", 1], power: ["Hand Hearts", 100], big: ["Galaxy", 1000] },
};

/**
 * A round and its win screen, a frame every tenth of a second. Three real
 * viewers give in the countdown, so the top 3 is full. Zebulon gave most
 * last LIVE, so he's welcomed back as the fight starts; then he follows
 * (a toast), sends a power (a banner) and a bigger gift (another), which
 * keeps the crown on him.
 */
function round(game: GameId, vote: boolean, frame: (s: Show) => void) {
  const s = new Show({ seed: 7, settings: { game, vote } });
  const give = (v: Viewer, [gift, coins]: Gift) => s.handle({ kind: "gift", viewer: v, gift, coins, count: 1 });
  s.setSupporters([zeb.id]);
  give(zeb, GIFTS[game].face);
  give(kayla, ["Finger Heart", 5]);
  give(mia, ["Rose", 1]);
  const later: [number, () => void][] = [
    [4, () => s.handle({ kind: "follow", viewer: zeb })],
    [6, () => give(zeb, GIFTS[game].power)],
    [10, () => give(zeb, GIFTS[game].big)],
  ];
  const first = s.round;
  for (let t = 0; s.round === first && t < 600; t += 0.1) {
    s.update(0.1);
    while (s.phase === "play" && later.length && s.elapsed >= later[0][0]) later.shift()![1]();
    frame(s);
  }
  expect(later).toEqual([]);
}

/** where the top 3 is: under the cards, or on the win screen where it moves for a vote */
const bandY = (s: Show) => (s.phase === "win" ? WIN_TOP3_Y[s.vote ? "vote" : "plain"] : TOP3.y);

/** what the top 3 draws on its own */
function alone(s: Show, view: View, y: number): Drawn[] {
  const r = recorder();
  drawTop3(r.ctx, s, view, y);
  return r.drawn;
}

/** what's drawn over the last full-screen fill: on the win screen, what's on its dark overlay */
function onTop(drawn: Drawn[]): Drawn[] {
  const i = drawn.findLastIndex((d) => d.kind === "rect" && d.x <= 0 && d.y <= 0 && d.w >= W && d.h >= H);
  return drawn.slice(i + 1);
}

/** `all` less each of `some` once, which must all be there */
function without(all: Drawn[], some: Drawn[]): Drawn[] {
  const left = [...all];
  for (const d of some) {
    const i = left.findIndex((e) => e.kind === d.kind && e.text === d.text && [e.x - d.x, e.y - d.y, e.w - d.w, e.h - d.h].every((n) => Math.abs(n) < 1e-6));
    expect(i, `the top 3's ${d.text ?? d.kind} at ${d.y}`).toBeGreaterThanOrEqual(0);
    left.splice(i, 1);
  }
  return left;
}

const across = (d: Drawn, top: number, bottom: number) => d.y < bottom && d.y + d.h > top;

describe("the LIVE's top 3 on screen", () => {
  it("keeps clear of everything else in every game and every part of a round, and of TikTok's app", () => {
    for (const game of GAMES) {
      for (const vote of [false, true]) {
        const seen = new Set<string>();
        round(game, vote, (s) => {
          const r = recorder();
          draw(r.ctx, s, SHOWN);
          const y = bandY(s);
          const own = alone(s, SHOWN, y);
          const where = `${game}${vote ? " with a vote" : ""}, ${s.phase} ${s.elapsed.toFixed(1)}s in`;
          expect(own.filter((d) => d.kind === "text").map((d) => d.text), where).toContain("ZEBULON QUIX…");
          // nothing else on screen crosses its band
          expect(without(onTop(r.drawn), own).filter((d) => across(d, y, y + TOP3.h)), where).toEqual([]);
          // its own drawing stays in it, below TikTok's top bar and above the comments
          for (const d of own) {
            expect(d.y, where).toBeGreaterThanOrEqual(y);
            expect(d.y + d.h, where).toBeLessThanOrEqual(y + TOP3.h);
          }
          expect(y).toBeGreaterThanOrEqual(TIKTOK_PHONE.top);
          expect(y + TOP3.h).toBeLessThanOrEqual(TIKTOK_PHONE.chat.y);
          // a welcome back goes in the toasts' lane, clear of TikTok's app too
          const welcome = r.drawn.findIndex((d) => d.text?.startsWith("WELCOME BACK"));
          if (welcome >= 0) {
            const pill = r.drawn.slice(0, welcome).findLast((d) => d.kind === "rect" && d.h === 66)!;
            for (const d of [pill, r.drawn[welcome]]) {
              expect(d.y, where).toBeGreaterThanOrEqual(TIKTOK_PHONE.top);
              expect(d.y + d.h, where).toBeLessThanOrEqual(TIKTOK_PHONE.chat.y);
            }
            seen.add("welcome");
          }
          if (r.texts.some((t) => t.includes(" followed "))) seen.add("toast");
          if (r.texts.some((t) => t.includes(" sent "))) seen.add("banner");
          seen.add(s.phase);
        });
        expect([...seen].sort(), `${game}${vote ? " with a vote" : ""}`).toEqual(["banner", "intro", "ko", "play", "toast", "welcome", "win"]);
      }
    }
  });
});

describe("a welcome back on screen", () => {
  it("stays up for its whole time, even when a big gift lands just after it goes up", () => {
    const s = new Show({ seed: 7, settings: { game: "battle", vote: false } });
    s.setSupporters([zeb.id]);
    s.handle({ kind: "chat", viewer: zeb, text: "1" });
    let frames = 0, sent = false;
    for (let t = 0; t < 40; t += 0.05) {
      s.update(0.05);
      // a Galaxy 0.3 s after the welcome goes up: its moment would hide the rest of it
      if (!sent && s.welcomes.length && s.now - s.welcomes[0].at >= 0.3) {
        s.handle({ kind: "gift", viewer: kayla, gift: "Galaxy", coins: 1000, count: 1 });
        sent = true;
      }
      const r = recorder();
      draw(r.ctx, s, SHOWN);
      if (r.texts.some((x) => x.startsWith("WELCOME BACK, ZEBULON QUIXOTE"))) frames++;
    }
    expect(sent).toBe(true);
    expect(frames * 0.05).toBeGreaterThanOrEqual(WELCOME_FOR - 0.05);
  });
});

/** somewhere a viewer's name is drawn, how it reads with names shown, and with them hidden */
type Place = [place: string, name: RegExp, initials: RegExp];

describe("hiding viewers' names", () => {
  it("draws no name or picture of a viewer anywhere, in every game and every part of a round", () => {
    for (const game of GAMES) {
      for (const vote of [false, true]) {
        const shown: string[] = [], hidden: string[] = [];
        let pictures = 0, hiddenPictures = 0;
        round(game, vote, (s) => {
          const a = recorder(), b = recorder();
          draw(a.ctx, s, SHOWN);
          draw(b.ctx, s, HIDDEN);
          shown.push(...a.texts);
          hidden.push(...b.texts);
          pictures += a.images;
          hiddenPictures += b.images;
        });
        const where = `${game}${vote ? " with a vote" : ""}`;
        expect(hidden.filter((t) => /zebulon|quixote|kayla|smith|\bmia\b/i.test(t)), where).toEqual([]);
        expect(hiddenPictures, where).toBe(0);
        // the same round with names shown has his name, and pictures, wherever he is
        const places: Place[] = [
          ["the top 3", /^ZEBULON QUIX…$/, /^Z\.Q\.$/],
          ["the crown line", /^ZEBULON QUIXOTE HAS THE CROWN/, /^Z\.Q\. HAS THE CROWN/],
          ["the welcome back", /^WELCOME BACK, ZEBULON QUIXOTE: TOP SUPPORTER LAST LIVE$/, /^WELCOME BACK, Z\.Q\.: TOP SUPPORTER LAST LIVE$/],
          ["the toast", /^Zebulon Quixote {2}followed/, /^Z\.Q\. {2}followed/],
          ["the banner", /^Zebulon Quixote sent /, /^Z\.Q\. sent /],
          ["his ball", /^Zebulon Quixote$/, /^Z\.Q\.$/],
          ["the win screen's biggest gifter", /^Zebulon Quixote {2}· {2}[\d,]+ COINS$/, /^Z\.Q\. {2}· {2}[\d,]+ COINS$/],
          ...(game === "race" || game === "royale"
            ? ([
                ["who has the power", /^ZEBULON QUIXOTE · \d+S$/, /^Z\.Q\. · \d+S$/],
                ["the winner", /^ZEBULON QUIXOTE$/, /^Z\.Q\.$/],
              ] as Place[])
            : []),
        ];
        for (const [place, name, initials] of places) {
          expect(shown.some((t) => name.test(t)), `${where}: ${place} with names shown`).toBe(true);
          expect(hidden.some((t) => initials.test(t)), `${where}: ${place} with names hidden`).toBe(true);
        }
        expect(pictures, where).toBeGreaterThan(0);
      }
    }
  });
});

describe("a LIVE's recap card", () => {
  const LIVE: RecapData = {
    username: "k.streams",
    day: "Fri, Oct 16, 2026",
    game: "Ball Battle",
    rounds: 14,
    peakPlayers: 23,
    coins: 4210,
    top: [
      { name: "Zebulon Quixote", coins: 1500 },
      { name: "Kayla Smith", coins: 900 },
      { name: "mia", coins: 400 },
      { name: "Fourth Place", coins: 200 },
    ],
  };
  const card = (d: RecapData, o = { hideNames: false, tag: false }) => {
    const r = recorder();
    drawRecap(r.ctx, d, o);
    return r;
  };

  it("says whose LIVE, when, the gift coins seen as what viewers sent, and the top 3 supporters, with nothing about money", () => {
    const r = card(LIVE);
    for (const t of ["LIVE RECAP", "@k.streams", "FRI, OCT 16, 2026 · BALL BATTLE", "4,210", "GIFT COINS SEEN", "WHAT VIEWERS SENT", "14", "ROUNDS", "23", "MOST PLAYING AT ONCE", "TOP SUPPORTERS", "ZEBULON QUIXOTE", "1,500", "KAYLA SMITH", "MIA"]) {
      expect(r.texts).toContain(t);
    }
    // three at most, and no currency or earnings anywhere
    expect(r.texts.join(" ")).not.toMatch(/FOURTH/i);
    expect(r.texts.filter((t) => /\$|€|£|usd|dollar|earn|money|pay/i.test(t))).toEqual([]);
    // nobody's picture is kept, so none is drawn
    expect(r.images).toBe(0);
  });

  it("shows supporters as initials, and no names, when they're hidden", () => {
    const r = card(LIVE, { hideNames: true, tag: false });
    for (const t of ["Z.Q.", "K.S.", "M."]) expect(r.texts).toContain(t);
    expect(r.texts.filter((t) => /zebulon|quixote|kayla|smith|\bmia\b/i.test(t))).toEqual([]);
    // the streamer's own username stays
    expect(r.texts).toContain("@k.streams");
  });

  it("carries the tag only when the plan has one, and leaves out the supporters when nobody gave", () => {
    expect(card(LIVE).texts).not.toContain("MADE WITH HOOKLINE");
    expect(card(LIVE, { hideNames: false, tag: true }).texts).toContain("MADE WITH HOOKLINE");
    const quiet = card({ ...LIVE, coins: 0, top: [{ name: "Nobody Much", coins: 0 }] }).texts;
    expect(quiet).toContain("0");
    expect(quiet).not.toContain("TOP SUPPORTERS");
    expect(quiet.join(" ")).not.toMatch(/NOBODY/);
  });

  it("keeps everything but the tag clear of where TikTok's app covers a photo, however long the names and numbers", () => {
    const long: RecapData = {
      ...LIVE,
      username: "a_very_long_username_xyz",
      game: "Last One Standing",
      rounds: 12345,
      peakPlayers: 123456,
      coins: 1_234_567_890,
      top: [{ name: "Bartholomew Montgomery-Fitzwilliam the Third", coins: 999_999_999 }, ...LIVE.top],
    };
    for (const d of [LIVE, long]) {
      const drawn = card(d, { hideNames: false, tag: true }).drawn.filter((b) => !(b.w >= RECAP.w && b.h >= RECAP.h) && b.text !== "MADE WITH HOOKLINE");
      expect(drawn.length).toBeGreaterThan(20);
      for (const b of drawn) {
        const what = `${b.text ?? b.kind} at ${Math.round(b.x)}, ${Math.round(b.y)}`;
        expect(b.y, what).toBeGreaterThanOrEqual(RECAP_CLEAR.top);
        expect(b.y + b.h, what).toBeLessThanOrEqual(RECAP_CLEAR.bottom);
        expect(b.x, what).toBeGreaterThanOrEqual(RECAP_CLEAR.side);
        expect(b.x + b.w, what).toBeLessThanOrEqual(RECAP.w - RECAP_CLEAR.side);
      }
    }
  });

  it("says the same in words for a screen reader, with the names as the card shows them", () => {
    expect(recapWords(LIVE, false)).toBe(
      "LIVE recap for @k.streams, Fri, Oct 16, 2026, Ball Battle. 4,210 gift coins seen, what viewers sent. 14 rounds, and at most 23 playing at once. Top supporters: Zebulon Quixote with 1,500, Kayla Smith with 900, mia with 400.",
    );
    expect(recapWords(LIVE, true)).toMatch(/Top supporters: Z\.Q\. with 1,500, K\.S\. with 900, M\. with 400\.$/);
    expect(recapWords({ ...LIVE, rounds: 1, top: [] }, false)).toMatch(/1 round, and at most 23 playing at once\.$/);
  });
});
