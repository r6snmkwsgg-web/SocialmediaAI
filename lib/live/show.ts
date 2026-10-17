import { rng, TICK, type Team } from "../battle/sim";
import type { LiveEvent, Viewer } from "./events";
import { makeGame } from "./games";
import type { Entrant, Game, Result, VoteOption } from "./games/types";
import { tierIn, type Tier } from "./menu";
import { over } from "./session";
import { DEFAULT_SETTINGS, parseSettings, type LiveSettings } from "./settings";
import { TOP_SHOWN } from "./supporters";
import { packClip, withoutNames, type ClipLog, type ClipPower, type RoundAround } from "./clip";
import { giftLevel } from "./menu";

/**
 * A live show: round after round of one game, steered by the chat. The
 * show owns everything about the stream (who's watching and on which
 * team, coins, the crown, the vote between rounds, the LIVE's top gifters
 * and welcome backs, the session's numbers) and hands the arena to the
 * game. It's all plain logic: the screen reads it and draws it, and a test
 * can run a whole show without one.
 */

export type Phase = "intro" | "play" | "ko" | "win";

/** how long each part of a round lasts, in seconds */
export const INTRO = 6;
export const KO_HOLD = 1.8;
export const WIN = 7;
/** with the vote on, the win screen is the vote, and runs this long */
export const VOTE = 10;
/** this many likes is worth 1 HP (or 1 weight, in a race), while likes come in at a trickle */
export const LIKES_PER_HP = 30;
/**
 * likes a second (per team, or per viewer) that each still get their full
 * worth; past this, each like is worth less, so likes add at most
 * LIKES_FREE / LIKES_PER_HP HP a second however fast a crowd taps
 */
export const LIKES_FREE = 5;
/** how many seconds of likes the rate looks back over */
const LIKE_WINDOW = 10;
export const FOLLOW_HP = 3;
/** a gift during the vote adds a vote per coin */
export const VOTES_PER_COIN = 1;
// the quiet that ends a session lives with the session, so the server can use it without the game
export { SESSION_IDLE } from "./session";
export const LETTERS = ["A", "B", "C"] as const;
/** seconds a welcome back stays up */
export const WELCOME_FOR = 3.5;
/** a welcome waits this long after the newest big gift arrives: its moment can start up to 3 s late and last up to 4 s (frame.ts) */
export const WELCOME_AFTER_BLAST = 8;
/** kept rounds wait here until the page sends them; past this many, the oldest go */
const OUTBOX = 3;
/** the powers a big gift's moment in a clip can be */
const isPower = (effect: string): effect is ClipPower => effect === "rage" || effect === "shield" || effect === "meteor";

export type Member = { viewer: Viewer; side: Team | null; coins: number };
/** one line about what just happened, shown briefly */
export type Toast = { id: number; at: number; side: Team | null; viewer: Viewer; text: string };
/** a big gift going off: its moment on screen, bigger for more coins; `many` is how many of its power it set off, `extra` what else it set off */
export type Blast = { id: number; at: number; side: Team | null; viewer: Viewer; tier: Tier; count: number; coins: number; many?: number; extra?: string[] };
export type Cue = { at: number; kind: "count" | "fight" | "ko" | "win" | "gift" | "join" | "vote"; n?: number };
/** one of the last LIVE's top gifters, back again: `rank` is where they came */
export type Welcome = { id: number; at: number; viewer: Viewer; rank: number };

export type Vote = {
  options: VoteOption[];
  /** each viewer's pick, as an index into options */
  picks: Map<string, number>;
  /** each viewer's extra votes, from gifts during the vote */
  extra: Map<string, number>;
};

/**
 * The session's numbers, from real viewers only: demo and test-panel
 * viewers play like anyone but never count, and rounds count from the
 * first thing a real viewer does.
 */
export type SessionStats = {
  id: string;
  startedAt: number;
  /** when a real viewer first and last did something, as epoch ms */
  firstAt: number | null;
  lastAt: number | null;
  rounds: number;
  coins: number;
  /** the most real viewers taking part in any one round */
  peakPlayers: number;
  gifters: Map<string, { viewer: Viewer; coins: number }>;
};

type Pending =
  /** `tier` when the game routed the gift itself (Rivals); otherwise it's worked out from the price */
  | { kind: "gift"; viewer: Viewer; side: Team | null; each: number; count: number; gift: string; tier?: Tier }
  | { kind: "heal"; viewer: Viewer; side: Team | null; hp: number }
  | { kind: "share"; viewer: Viewer; side: Team | null }
  | { kind: "enter"; viewer: Viewer };

/**
 * Which team someone means in chat: "1" or "2", "left" or "right", a team's
 * name, or its first letter ("r" for Red, "b" for Blue). `also` are more
 * names for each side: in Rivals, red and blue as well as the rivalry's. A
 * first letter that could be either side (Bulls and Bears) means neither.
 */
export function sideFromChat(text: string, names: [string, string] = ["Red", "Blue"], also?: [string, string]): Team | null {
  const t = clean(text).replace(/^team\s*/, "");
  const words: [string[], string[]] = [[names[0]], [names[1]]];
  if (also) words.forEach((w, i) => w.push(also[i]));
  const said = words.map((w) => w.map((x) => clean(x)).filter((x) => x.length > 0));
  if (t === "1" || t === "1️⃣" || t === "left" || said[0].includes(t)) return 0;
  if (t === "2" || t === "2️⃣" || t === "right" || said[1].includes(t)) return 1;
  if (t.length === 1) {
    const first = said.map((w) => w.some((x) => x[0] === t));
    if (first[0] !== first[1]) return first[0] ? 0 : 1;
  }
  return null;
}

/** "go" and friends: someone asking to join an everyone-for-themselves game. */
export function joinFromChat(text: string): boolean {
  return ["go", "join", "play", "me", "in", "im in", "i'm in"].includes(clean(text));
}

/** A vote: "A", "b", "vote c". Null if the message isn't one. */
export function voteFromChat(text: string): number | null {
  const t = clean(text).replace(/^(vote|option)\s*/, "");
  const i = ["a", "b", "c"].indexOf(t);
  return i >= 0 ? i : null;
}

function clean(text: string): string {
  return text.trim().toLowerCase().replace(/^[!#]/, "").replace(/[!.?\s]+$/g, "");
}

export class Show {
  readonly settings: LiveSettings;
  readonly game: Game;
  /** seconds since the show started, real time */
  now = 0;
  phase: Phase = "intro";
  phaseAt = 0;
  round = 0;
  /** team games: rounds each team has won */
  series: [number, number] = [0, 0];
  /** everyone-for-themselves games: rounds each viewer has won */
  readonly wins = new Map<string, number>();
  result: Result | null = null;
  /** how fast play is running: slower when it's about to be decided */
  speed = 1;
  readonly members = new Map<string, Member>();
  /** what each viewer has given this round, in coins */
  readonly roundCoins = new Map<string, number>();
  /** likes toward the next HP: per team in team games, per viewer otherwise, and how fast they're coming in */
  readonly likes: [Likes, Likes] = [newLikes(), newLikes()];
  private readonly viewerLikes = new Map<string, Likes>();
  readonly toasts: Toast[] = [];
  readonly blasts: Blast[] = [];
  /** when each menu item was last set off, so the menu can light up */
  readonly lit = new Map<string, number>();
  /** who's given the most this round, and so wears the crown */
  crown: string | null = null;
  /** the last round's biggest gifter */
  mvp: { viewer: Viewer; coins: number } | null = null;
  readonly cues: Cue[] = [];
  /** every cue so far, counting ones the list has let go of */
  cueCount = 0;
  /** the vote for the next round, while the win screen is up */
  vote: Vote | null = null;
  /** what the last vote picked, to announce as the next round starts */
  voted: { option: VoteOption; votes: number } | null = null;
  /** the session's numbers; a new session starts after SESSION_IDLE without a real viewer */
  stats: SessionStats;
  /** the last LIVE's top gifters as each is welcomed back, the last few */
  readonly welcomes: Welcome[] = [];
  /** rounds worth keeping for a clip, waiting for the page to send them (`takeClips`) */
  private readonly outbox: ClipLog[] = [];
  /** the real viewers taking part this round */
  private readonly roundPlayers = new Set<string>();
  /** this round: whether something a real viewer did reached the arena, whether something a pretend one did, and its big gifts going off */
  private roundReal = false;
  private roundPretend = false;
  private readonly roundMoments: RoundAround["moments"] = [];
  /** what pretend viewers gave, so the test panel and demo can show a top 3 while no LIVE is going */
  private readonly tried: SessionStats["gifters"] = new Map();
  /** the last LIVE's top gifters, by TikTok id, with where each came */
  private readonly supporters = new Map<string, number>();
  /** when each of them was last welcomed back, or joined the list while a LIVE was going, as epoch ms */
  private readonly greeted = new Map<string, number>();
  /** welcome backs waiting for their turn on screen */
  private readonly due: { viewer: Viewer; rank: number }[] = [];
  /** when the LIVE now going began, and the last thing a real viewer did, joins included, as epoch ms */
  private liveFrom = 0;
  private lastReal = 0;
  private readonly pending: Pending[] = [];
  private readonly followed = new Set<string>();
  private readonly shared = new Set<string>();
  private readonly rand: () => number;
  private acc = 0;
  private nextId = 1;
  private next: VoteOption | null = null;

  constructor(o: { seed?: number; settings?: Partial<LiveSettings> } = {}) {
    this.settings = parseSettings({ ...DEFAULT_SETTINGS, ...o.settings });
    this.rand = rng(o.seed ?? Date.now() % 1_000_000_007);
    this.game = makeGame(this.settings);
    this.stats = this.newStats();
    this.startRound();
  }

  /** the two teams as they stand this round: a game with a new rivalry each round names them itself, red and blue */
  get teams(): LiveSettings["teams"] {
    const n = this.game.names?.();
    return n ? [{ name: n[0], color: "#FF3B30" }, { name: n[1], color: "#0A84FF" }] : this.settings.teams;
  }

  /** seconds into the current part of the round */
  get elapsed(): number {
    return this.now - this.phaseAt;
  }

  /** how long the win screen stays up: longer when it's a vote */
  get winFor(): number {
    return this.settings.vote ? VOTE : WIN;
  }

  sideOf(viewerId: string): Team | null {
    return this.members.get(viewerId)?.side ?? null;
  }

  memberCount(side: Team): number {
    let n = 0;
    for (const m of this.members.values()) if (m.side === side) n++;
    return n;
  }

  /** the team that's behind: gifts from someone who hasn't picked go there */
  underdog(): Team {
    const g = this.game;
    const h0 = g.teamHp?.(0) ?? 0, h1 = g.teamHp?.(1) ?? 0;
    if (h0 !== h1) return h0 < h1 ? 0 : 1;
    const m0 = this.memberCount(0), m1 = this.memberCount(1);
    if (m0 !== m1) return m0 < m1 ? 0 : 1;
    return this.rand() < 0.5 ? 0 : 1;
  }

  /** the vote's count so far: one per viewer, plus what their gifts added */
  tally(): number[] {
    const v = this.vote;
    if (!v) return [];
    const out = v.options.map(() => 0);
    for (const [id, i] of v.picks) out[i] += 1 + (v.extra.get(id) ?? 0);
    return out;
  }

  private startRound() {
    this.round++;
    const before = this.game.names?.();
    this.game.start({ round: this.round, option: this.next, rand: this.rand });
    // new sides, new picks: a Messi fan isn't on PlayStation's side because both were red
    const after = this.game.names?.();
    if (before && after && (before[0] !== after[0] || before[1] !== after[1])) for (const m of this.members.values()) m.side = null;
    this.next = null;
    this.result = null;
    this.speed = 1;
    this.acc = 0;
    this.roundCoins.clear();
    this.roundPlayers.clear();
    this.roundReal = false;
    this.roundPretend = false;
    this.roundMoments.length = 0;
    this.crown = null;
    this.shared.clear();
    this.vote = null;
    this.go("intro");
    if (this.game.liveInIntro) this.flush();
  }

  private go(phase: Phase) {
    this.phase = phase;
    this.phaseAt = this.now;
  }

  private cue(kind: Cue["kind"], n?: number) {
    this.cues.push({ at: this.now, kind, n });
    this.cueCount++;
    if (this.cues.length > 64) this.cues.splice(0, this.cues.length - 64);
  }

  private toast(side: Team | null, viewer: Viewer, text: string) {
    this.toasts.push({ id: this.nextId++, at: this.now, side, viewer, text });
    if (this.toasts.length > 12) this.toasts.splice(0, this.toasts.length - 12);
  }

  private flush() {
    for (const p of this.pending.splice(0)) this.apply(p);
  }

  /** Run the show forward by `dt` seconds of real time. */
  update(dt: number) {
    dt = Math.min(dt, 0.25);
    this.now += dt;
    const t = this.elapsed;

    if (this.phase === "intro") {
      const before = Math.ceil(INTRO - (t - dt));
      const after = Math.ceil(INTRO - t);
      if (after !== before && after > 0 && after <= 3) this.cue("count", after);
      if (t >= INTRO) {
        this.go("play");
        this.cue("fight");
        if (!this.game.liveInIntro) this.flush();
      }
      return;
    }

    if (this.phase === "play" || this.phase === "ko") {
      this.speed = this.phase === "ko" ? 0.22 : this.game.tension();
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= TICK && steps < 12) {
        this.game.tick();
        this.acc -= TICK;
        steps++;
        if (this.phase === "play" && this.decided()) break;
      }
      if (this.acc > TICK * 12) this.acc = 0;
      if (this.phase === "play") this.welcomeNext();
      if (this.phase === "ko" && this.elapsed >= KO_HOLD) {
        this.go("win");
        this.cue("win");
        if (this.settings.vote) this.vote = { options: this.game.options(this.rand), picks: new Map(), extra: new Map() };
      }
      return;
    }

    if (this.phase === "win" && t >= this.winFor) {
      this.settle();
      this.startRound();
    }
  }

  /** Has the round just been decided? If so, move on to the knockout. */
  private decided(): boolean {
    const r = this.game.result();
    if (!r) return false;
    this.result = r;
    if (r.team !== undefined && r.team !== null) this.series[r.team]++;
    if (r.champion && !r.champion.cpu) this.wins.set(r.champion.id, (this.wins.get(r.champion.id) ?? 0) + 1);
    const top = this.crown ? this.members.get(this.crown) : undefined;
    this.mvp = top && this.crown ? { viewer: top.viewer, coins: this.roundCoins.get(this.crown) ?? 0 } : null;
    // a round counts once a real viewer has shown up, and not while they've all been gone a while
    const counted = this.liveNow();
    if (counted) this.stats.rounds++;
    this.keepClip(r, counted);
    this.go("ko");
    this.cue("ko");
    return true;
  }

  /**
   * A round worth keeping for a clip goes in the outbox: only with clips on,
   * in a game that can be played again, for a round the session counted that
   * real viewers played and no pretend one touched. It's numbered as the
   * session counts its rounds, never as the show does: a game left open in
   * OBS runs its rounds on across LIVEs.
   */
  private keepClip(r: Result, counted: boolean) {
    const g = this.game;
    if (!this.settings.clips || !counted || !this.roundReal || this.roundPretend || (g.id !== "battle" && g.id !== "rivals")) return;
    const tape = g.tape?.();
    if (!tape) return;
    // the round's gifters, in the order they first gave, under the names they have now
    const gifters = [...this.roundCoins.keys()].map((id) => ({ id, name: this.members.get(id)?.viewer.name ?? "" }));
    const t = this.teams;
    const log = packClip(tape, {
      game: g.id,
      session: this.stats.id,
      round: this.stats.rounds,
      at: Date.now(),
      teams: [t[0], t[1]],
      gifters,
      moments: this.roundMoments,
      result: { team: r.team ?? null, byTime: r.byTime },
    });
    if (!log) return;
    this.outbox.push(log);
    if (this.outbox.length > OUTBOX) this.outbox.splice(0, this.outbox.length - OUTBOX);
  }

  /**
   * The rounds kept for a clip since the page last asked, each handed over
   * once. Taken while viewers' names are hidden, as the page takes them
   * the moment they're decided, each names nobody: no people, and every
   * ball and big gift is just a viewer's.
   */
  takeClips(o: { hideNames: boolean }): ClipLog[] {
    return this.outbox.splice(0).map((log) => (o.hideNames ? withoutNames(log) : log));
  }

  /** The vote's over: the most votes wins, and a tie is a coin toss. */
  private settle() {
    const v = this.vote;
    if (!v || v.options.length === 0) return;
    const t = this.tally();
    const best = Math.max(...t);
    const top = t.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0);
    const pick = top[Math.floor(this.rand() * top.length)];
    this.next = v.options[pick];
    this.voted = best > 0 ? { option: v.options[pick], votes: best } : null;
  }

  /** Someone picks a team, or switches. */
  join(viewer: Viewer, side: Team | null): Member {
    const m = this.members.get(viewer.id);
    this.taking(viewer);
    if (m) {
      m.viewer = { ...m.viewer, ...viewer, avatar: viewer.avatar ?? m.viewer.avatar };
      if (side !== null) m.side = side;
      return m;
    }
    const fresh: Member = { viewer, side, coins: 0 };
    this.members.set(viewer.id, fresh);
    this.cue("join");
    return fresh;
  }

  /** One thing that happened on the stream. */
  handle(e: LiveEvent) {
    const g = this.game;
    // joins too: a top gifter coming back is welcomed whatever they do first
    this.greet(e.viewer);
    if (e.kind === "join") return;

    if (e.kind === "chat") {
      if (this.vote && this.phase === "win") {
        const i = voteFromChat(e.text);
        if (i !== null && i < this.vote.options.length) {
          if (!this.vote.picks.has(e.viewer.id)) this.cue("vote");
          this.vote.picks.set(e.viewer.id, i);
          this.join(e.viewer, null);
          return;
        }
      }
      if (g.teams) {
        // where the sides have a rivalry's names, red and blue still say which is which
        const side = sideFromChat(e.text, [this.teams[0].name, this.teams[1].name], g.names ? ["Red", "Blue"] : undefined);
        if (side !== null) this.join(e.viewer, side);
      } else if (joinFromChat(e.text)) {
        this.join(e.viewer, null);
        this.act({ kind: "enter", viewer: e.viewer });
      }
      return;
    }

    const side = g.teams ? (this.sideOf(e.viewer.id) ?? this.underdog()) : null;

    if (e.kind === "like") {
      let l = side !== null ? this.likes[side] : this.viewerLikes.get(e.viewer.id);
      if (!l) this.viewerLikes.set(e.viewer.id, (l = newLikes()));
      const hp = likesToHp(l, e.count, this.now);
      this.taking(e.viewer);
      if (hp > 0) this.act({ kind: "heal", viewer: e.viewer, side, hp });
      return;
    }

    if (e.kind === "follow") {
      if (this.followed.has(e.viewer.id)) return;
      this.followed.add(e.viewer.id);
      this.join(e.viewer, side);
      this.toast(side, e.viewer, `followed → +${FOLLOW_HP}`);
      this.act({ kind: "heal", viewer: e.viewer, side, hp: FOLLOW_HP });
      return;
    }

    if (e.kind === "share") {
      if (this.shared.has(e.viewer.id)) return;
      this.shared.add(e.viewer.id);
      this.join(e.viewer, side);
      this.act({ kind: "share", viewer: e.viewer, side });
      return;
    }

    // a gift counts for the giver's team, and puts them on it if they hadn't picked; where each
    // side has its own gifts (Rivals), the gift itself is the pick
    const routed = g.route?.(e.gift, e.coins) ?? null;
    const team = routed ? routed.side : side;
    const m = this.join(e.viewer, team);
    const coins = e.coins * e.count;
    m.coins += coins;
    if (!e.viewer.pretend) this.stats.coins += coins;
    // real gifters count for the session; pretend ones only show while no LIVE is going, so one tried during a LIVE never does
    if (!e.viewer.pretend) gave(this.stats.gifters, m.viewer, coins);
    else if (over(this.lastReal)) gave(this.tried, m.viewer, coins);
    this.cue("gift", coins);

    // during the vote, a gift is votes as well, one a coin like everywhere else
    if (this.vote && this.phase === "win") {
      const add = coins * VOTES_PER_COIN;
      this.vote.extra.set(e.viewer.id, (this.vote.extra.get(e.viewer.id) ?? 0) + add);
      const picked = this.vote.picks.has(e.viewer.id);
      const n = `+${add.toLocaleString("en-US")} ${add === 1 ? "VOTE" : "VOTES"}`;
      this.toast(team, m.viewer, picked ? n : `${n} · TYPE A, B OR C TO USE THEM`);
    }
    this.act({ kind: "gift", viewer: m.viewer, side: team, each: e.coins, count: e.count, gift: e.count > 1 ? `${e.count}x ${e.gift}` : e.gift, tier: routed?.tier });
  }

  /** Do it now if the game's taking it; otherwise it waits for the next round. */
  private act(p: Pending) {
    const open = this.phase === "play" || (this.phase === "intro" && this.game.liveInIntro);
    if (open) this.apply(p);
    else this.pending.push(p);
  }

  private apply(p: Pending) {
    const g = this.game;
    // whose doing reaches the arena: a round any pretend viewer touched is never kept for a clip
    if (p.viewer.pretend) this.roundPretend = true;
    else this.roundReal = true;
    if (p.kind === "heal") {
      g.heal(p.viewer, p.side, p.hp);
      return;
    }
    if (p.kind === "share") {
      const said = g.share(p.viewer, p.side);
      if (said?.toast) this.toast(p.side, p.viewer, said.toast);
      return;
    }
    if (p.kind === "enter") {
      const said = g.enter(p.viewer);
      if (said?.toast) this.toast(null, p.viewer, said.toast);
      return;
    }

    const { viewer, side, each, count, gift } = p;
    // where each side has its own menu, any other gift goes by its price on the giver's side's
    const tier = p.tier ?? tierIn(side !== null && g.sideMenu ? g.sideMenu(side) : g.menu, each);
    this.lit.set(tier.effect, this.now);
    // and on its own side's menu, where each side has one
    if (side !== null) this.lit.set(`${side}:${tier.effect}`, this.now);
    const total = (this.roundCoins.get(viewer.id) ?? 0) + each * count;
    this.roundCoins.set(viewer.id, total);
    // the crown goes to whoever's given the most this round
    const top = this.crown ? (this.roundCoins.get(this.crown) ?? 0) : 0;
    const took = this.crown !== viewer.id && total > top;
    if (took) this.crown = viewer.id;

    const said = g.gift({ viewer, side, tier, count, each, total, gift });
    if (said.blast) {
      this.blasts.push({ id: this.nextId++, at: this.now, side, viewer, tier, count, coins: each * count, many: said.many, extra: said.extra });
      if (this.blasts.length > 8) this.blasts.splice(0, this.blasts.length - 8);
      // and its moment for a clip: which power, which side, from whom, how many of it and how big, never its coins
      if (g.step !== undefined && isPower(tier.effect)) this.roundMoments.push({ step: g.step, effect: tier.effect, team: side ?? 0, viewer: viewer.id, many: said.many ?? 1, level: giftLevel(each * count) });
      this.welcomeLater();
    } else if (took && top > 0) this.toast(side, viewer, `took the crown · ${gift}`);
    else if (said.toast) this.toast(side, viewer, said.toast);
  }

  /**
   * A viewer taking part: counted toward the session's numbers if they're
   * real. After SESSION_IDLE with nobody real, it's a new session: a game
   * left open in OBS between LIVEs saves each LIVE as its own.
   */
  private taking(viewer: Viewer) {
    if (viewer.pretend) return;
    const now = Date.now();
    if (this.stats.lastAt !== null && over(this.stats.lastAt, now)) {
      this.stats = this.newStats();
      this.roundPlayers.clear();
    }
    this.roundPlayers.add(viewer.id);
    this.stats.peakPlayers = Math.max(this.stats.peakPlayers, this.roundPlayers.size);
    this.stats.firstAt ??= now;
    this.stats.lastAt = now;
  }

  private newStats(): SessionStats {
    return { id: newId(this.rand), startedAt: Date.now(), firstAt: null, lastAt: null, rounds: 0, coins: 0, peakPlayers: 0, gifters: new Map() };
  }

  /** the session's top gifters, most first */
  topGifters(n = 5): { viewer: Viewer; coins: number }[] {
    return [...this.stats.gifters.values()].sort((a, b) => b.coins - a.coins).slice(0, n);
  }

  /** a real viewer has taken part in the last SESSION_IDLE, so the session's numbers are the LIVE now going */
  liveNow(): boolean {
    return this.stats.lastAt !== null && !over(this.stats.lastAt);
  }

  /**
   * The LIVE's top gifters for the screen, most coins first, with ties to
   * whoever gave first: real ones while a LIVE is going, pretend ones only
   * while none is, so a test run never shows as a real LIVE's.
   */
  top3(): { viewer: Viewer; coins: number }[] {
    // a real viewer who's only joined or said hello means a LIVE is going, before its session has started
    const from = this.liveNow() ? this.stats.gifters : over(this.lastReal) ? this.tried : null;
    return from ? topOf(from, TOP_SHOWN) : [];
  }

  /**
   * The last LIVE's top gifters, by TikTok id, best first: each is welcomed
   * back once a LIVE. One who joins the list while a LIVE is going waits for
   * the next LIVE: the server can't hear the joins and hellos that keep a
   * LIVE going, and goes by its own clock, so a list it sends mid-LIVE can be
   * from earlier in this one.
   */
  setSupporters(ids: string[]) {
    const now = Date.now();
    const had = new Set(this.supporters.keys());
    this.supporters.clear();
    ids.slice(0, TOP_SHOWN).forEach((id, i) => {
      this.supporters.set(id, i + 1);
      if (!had.has(id) && !over(this.lastReal, now)) this.greeted.set(id, now);
    });
  }

  /** A welcome back, as if they'd come back: the test panel's, so pretend viewers get one too. */
  welcome(viewer: Viewer, rank: number) {
    this.due.push({ viewer, rank });
  }

  /**
   * Anything a real viewer does, joins included. After SESSION_IDLE of
   * nothing it's a new LIVE beginning, and each of the last LIVE's top
   * gifters is welcomed back once in it, whatever they do first.
   */
  private greet(viewer: Viewer) {
    if (viewer.pretend) return;
    const now = Date.now();
    if (over(this.lastReal, now)) {
      this.liveFrom = now;
      // whatever the test panel or demo gave before isn't this LIVE's
      this.tried.clear();
    }
    this.lastReal = now;
    const rank = this.supporters.get(viewer.id);
    if (!rank || (this.greeted.get(viewer.id) ?? -1) >= this.liveFrom) return;
    this.greeted.set(viewer.id, now);
    this.due.push({ viewer, rank });
  }

  /** The next welcome back goes up during play, once the last one has had its time and no big gift's moment can still be on screen. */
  private welcomeNext() {
    const last = this.welcomes.at(-1), blast = this.blasts.at(-1);
    if (!this.due.length || (last && this.now - last.at < WELCOME_FOR) || (blast && this.now - blast.at < WELCOME_AFTER_BLAST)) return;
    const { viewer, rank } = this.due.shift()!;
    this.welcomes.push({ id: this.nextId++, at: this.now, viewer, rank });
    if (this.welcomes.length > 4) this.welcomes.splice(0, this.welcomes.length - 4);
    this.cue("join");
  }

  /** A big gift's moment would hide a welcome back that's up, so it goes back to the front of the line, to go up again once the moment's over. */
  private welcomeLater() {
    const w = this.welcomes.at(-1);
    if (!w || this.now - w.at >= WELCOME_FOR) return;
    this.welcomes.pop();
    this.due.unshift({ viewer: w.viewer, rank: w.rank });
  }

  /** the champion's record this session, for the win screen */
  winsOf(e: Entrant | null | undefined): number {
    return e && !e.cpu ? (this.wins.get(e.id) ?? 0) : 0;
  }
}

/**
 * The `n` who gave most, most first, with ties to whoever gave first. One
 * pass rather than a sort, since the screen asks every frame and a big
 * LIVE can have thousands of gifters.
 */
function topOf(list: SessionStats["gifters"], n: number): { viewer: Viewer; coins: number }[] {
  const best: { viewer: Viewer; coins: number }[] = [];
  for (const g of list.values()) {
    const i = best.findIndex((b) => g.coins > b.coins);
    if (i >= 0) best.splice(i, 0, g);
    else if (best.length < n) best.push(g);
    if (best.length > n) best.pop();
  }
  return best;
}

/** Adds a gift to a list of gifters, under the name the gifter has now, so someone who renames shows the new name. */
function gave(list: SessionStats["gifters"], viewer: Viewer, coins: number) {
  const g = list.get(viewer.id);
  if (g) {
    g.coins += coins;
    g.viewer = viewer;
  } else list.set(viewer.id, { viewer, coins });
}

/** Likes on their way to the next HP, and how many a second have been coming in lately. */
export type Likes = { left: number; rate: number; at: number };

const newLikes = (): Likes => ({ left: 0, rate: 0, at: 0 });

/**
 * Some likes coming in at `now` (seconds): the HP they're worth. Up to
 * LIKES_FREE a second, every LIKES_PER_HP likes is 1 HP; faster than that,
 * each is worth less in step, so a crowd tapping as fast as it can adds
 * about LIKES_FREE / LIKES_PER_HP HP a second, never a Galaxy's worth.
 */
export function likesToHp(l: Likes, count: number, now: number): number {
  const dt = Math.max(0, now - l.at);
  l.rate = l.rate * Math.exp(-dt / LIKE_WINDOW) + count / LIKE_WINDOW;
  l.at = now;
  l.left += count / Math.max(1, l.rate / LIKES_FREE);
  const hp = Math.floor(l.left / LIKES_PER_HP);
  l.left -= hp * LIKES_PER_HP;
  return hp;
}

function newId(rand: () => number): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  // a v4-shaped id from the show's own randomness, where there's no crypto
  const h = () => Math.floor(rand() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, h);
}
