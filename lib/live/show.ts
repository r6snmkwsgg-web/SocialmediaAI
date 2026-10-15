import { rng, TICK, type Team } from "../battle/sim";
import type { LiveEvent, Viewer } from "./events";
import { makeGame } from "./games";
import type { Entrant, Game, Result, VoteOption } from "./games/types";
import { tierIn, type Tier } from "./menu";
import { DEFAULT_SETTINGS, parseSettings, type LiveSettings } from "./settings";

/**
 * A live show: round after round of one game, steered by the chat. The
 * show owns everything about the stream (who's watching and on which
 * team, coins, the crown, the vote between rounds, the session's numbers)
 * and hands the arena to the game. It's all plain logic: the screen reads
 * it and draws it, and a test can run a whole show without one.
 */

export type Phase = "intro" | "play" | "ko" | "win";

/** how long each part of a round lasts, in seconds */
export const INTRO = 6;
export const KO_HOLD = 1.8;
export const WIN = 7;
/** with the vote on, the win screen is the vote, and runs this long */
export const VOTE = 10;
/** this many likes is worth 1 HP (or 1 weight, in a race) */
export const LIKES_PER_HP = 30;
export const FOLLOW_HP = 3;
/** a gift during the vote adds a vote per coin, up to this many per gift */
export const GIFT_VOTES_MAX = 50;
export const LETTERS = ["A", "B", "C"] as const;

export type Member = { viewer: Viewer; side: Team | null; coins: number };
/** one line about what just happened, shown briefly */
export type Toast = { id: number; at: number; side: Team | null; viewer: Viewer; text: string };
/** a big gift going off: its moment on screen */
export type Blast = { id: number; at: number; side: Team | null; viewer: Viewer; tier: Tier; count: number };
export type Cue = { at: number; kind: "count" | "fight" | "ko" | "win" | "gift" | "join" | "vote"; n?: number };

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
  | { kind: "gift"; viewer: Viewer; side: Team | null; each: number; count: number; gift: string }
  | { kind: "heal"; viewer: Viewer; side: Team | null; hp: number }
  | { kind: "share"; viewer: Viewer; side: Team | null }
  | { kind: "enter"; viewer: Viewer };

/** Which team someone means in chat: "1" or "2", a team's name, left or right. */
export function sideFromChat(text: string, names: [string, string] = ["red", "blue"]): Team | null {
  const t = clean(text).replace(/^team\s*/, "");
  if (t === "1" || t === "1️⃣" || t === "left" || t === "l" || t === names[0].toLowerCase()) return 0;
  if (t === "2" || t === "2️⃣" || t === "right" || t === "r" || t === names[1].toLowerCase()) return 1;
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
  /** likes toward the next HP: per team in team games, per viewer otherwise */
  readonly likes: [number, number] = [0, 0];
  private readonly viewerLikes = new Map<string, number>();
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
  readonly stats: SessionStats;
  /** the real viewers taking part this round */
  private readonly roundPlayers = new Set<string>();
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
    this.stats = { id: newId(this.rand), startedAt: Date.now(), firstAt: null, lastAt: null, rounds: 0, coins: 0, peakPlayers: 0, gifters: new Map() };
    this.startRound();
  }

  get teams(): LiveSettings["teams"] {
    return this.settings.teams;
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
    this.game.start({ round: this.round, option: this.next, rand: this.rand });
    this.next = null;
    this.result = null;
    this.speed = 1;
    this.acc = 0;
    this.roundCoins.clear();
    this.roundPlayers.clear();
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
    if (this.stats.firstAt !== null) this.stats.rounds++;
    this.go("ko");
    this.cue("ko");
    return true;
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
        const side = sideFromChat(e.text, [this.teams[0].name, this.teams[1].name]);
        if (side !== null) this.join(e.viewer, side);
      } else if (joinFromChat(e.text)) {
        this.join(e.viewer, null);
        this.act({ kind: "enter", viewer: e.viewer });
      }
      return;
    }

    const side = g.teams ? (this.sideOf(e.viewer.id) ?? this.underdog()) : null;

    if (e.kind === "like") {
      let hp = 0;
      if (side !== null) {
        this.likes[side] += e.count;
        hp = Math.floor(this.likes[side] / LIKES_PER_HP);
        this.likes[side] -= hp * LIKES_PER_HP;
      } else {
        const n = (this.viewerLikes.get(e.viewer.id) ?? 0) + e.count;
        hp = Math.floor(n / LIKES_PER_HP);
        this.viewerLikes.set(e.viewer.id, n - hp * LIKES_PER_HP);
      }
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

    // a gift counts for the giver's team, and puts them on it if they hadn't picked
    const m = this.join(e.viewer, side);
    const coins = e.coins * e.count;
    m.coins += coins;
    if (!e.viewer.pretend) {
      this.stats.coins += coins;
      const g2 = this.stats.gifters.get(e.viewer.id);
      if (g2) g2.coins += coins;
      else this.stats.gifters.set(e.viewer.id, { viewer: m.viewer, coins });
    }
    this.cue("gift", coins);

    // during the vote, a gift is votes as well
    if (this.vote && this.phase === "win") {
      const add = Math.min(GIFT_VOTES_MAX, coins);
      this.vote.extra.set(e.viewer.id, (this.vote.extra.get(e.viewer.id) ?? 0) + add);
      const picked = this.vote.picks.has(e.viewer.id);
      this.toast(side, m.viewer, picked ? `+${add} VOTES` : `+${add} VOTES · TYPE A, B OR C TO USE THEM`);
    }
    this.act({ kind: "gift", viewer: m.viewer, side, each: e.coins, count: e.count, gift: e.count > 1 ? `${e.count}x ${e.gift}` : e.gift });
  }

  /** Do it now if the game's taking it; otherwise it waits for the next round. */
  private act(p: Pending) {
    const open = this.phase === "play" || (this.phase === "intro" && this.game.liveInIntro);
    if (open) this.apply(p);
    else this.pending.push(p);
  }

  private apply(p: Pending) {
    const g = this.game;
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
    const tier = tierIn(g.menu, each);
    this.lit.set(tier.effect, this.now);
    const total = (this.roundCoins.get(viewer.id) ?? 0) + each * count;
    this.roundCoins.set(viewer.id, total);
    // the crown goes to whoever's given the most this round
    const top = this.crown ? (this.roundCoins.get(this.crown) ?? 0) : 0;
    const took = this.crown !== viewer.id && total > top;
    if (took) this.crown = viewer.id;

    const said = g.gift({ viewer, side, tier, count, each, total, gift });
    if (said.blast) {
      this.blasts.push({ id: this.nextId++, at: this.now, side, viewer, tier, count });
      if (this.blasts.length > 8) this.blasts.splice(0, this.blasts.length - 8);
    } else if (took && top > 0) this.toast(side, viewer, `took the crown · ${gift}`);
    else if (said.toast) this.toast(side, viewer, said.toast);
  }

  /** A viewer taking part: counted toward the session's numbers if they're real. */
  private taking(viewer: Viewer) {
    if (viewer.pretend) return;
    this.roundPlayers.add(viewer.id);
    this.stats.peakPlayers = Math.max(this.stats.peakPlayers, this.roundPlayers.size);
    const now = Date.now();
    this.stats.firstAt ??= now;
    this.stats.lastAt = now;
  }

  /** the session's top gifters, most first */
  topGifters(n = 5): { viewer: Viewer; coins: number }[] {
    return [...this.stats.gifters.values()].sort((a, b) => b.coins - a.coins).slice(0, n);
  }

  /** the champion's record this session, for the win screen */
  winsOf(e: Entrant | null | undefined): number {
    return e && !e.cpu ? (this.wins.get(e.id) ?? 0) : 0;
  }
}

function newId(rand: () => number): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  // a v4-shaped id from the show's own randomness, where there's no crypto
  const h = () => Math.floor(rand() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, h);
}
