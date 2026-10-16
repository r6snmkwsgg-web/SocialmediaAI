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
/** a stretch this long with nothing from a real viewer ends a session; the next thing starts a new one */
export const SESSION_IDLE = 20 * 60_000;
export const LETTERS = ["A", "B", "C"] as const;

export type Member = { viewer: Viewer; side: Team | null; coins: number };
/** one line about what just happened, shown briefly */
export type Toast = { id: number; at: number; side: Team | null; viewer: Viewer; text: string };
/** a big gift going off: its moment on screen, bigger for more coins; `many` is how many of its power it set off, `extra` what else it set off */
export type Blast = { id: number; at: number; side: Team | null; viewer: Viewer; tier: Tier; count: number; coins: number; many?: number; extra?: string[] };
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
    // a round counts once a real viewer has shown up, and not while they've all been gone a while
    if (this.stats.lastAt !== null && Date.now() - this.stats.lastAt <= SESSION_IDLE) this.stats.rounds++;
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
    if (!e.viewer.pretend) {
      this.stats.coins += coins;
      const g2 = this.stats.gifters.get(e.viewer.id);
      if (g2) g2.coins += coins;
      else this.stats.gifters.set(e.viewer.id, { viewer: m.viewer, coins });
    }
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
    if (this.stats.lastAt !== null && now - this.stats.lastAt > SESSION_IDLE) {
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

  /** the champion's record this session, for the win screen */
  winsOf(e: Entrant | null | undefined): number {
    return e && !e.cpu ? (this.wins.get(e.id) ?? 0) : 0;
  }
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
