import { ABILITIES, ABILITY_IDS, type AbilityId } from "../battle/abilities";
import { ARENA, rng, TICK, World, type Team } from "../battle/sim";
import type { LiveEvent, Viewer } from "./events";
import { giftSteps, LIKES_PER_HP, RAGE_SECONDS, SHIELD_SECONDS, sideFromChat, tierFor, type Effect } from "./rules";

/**
 * A live show: round after round of ball battles that the chat steers.
 * Viewers pick a side by typing 1 or 2, and their gifts, likes and shares
 * land in the fight as it happens. It keeps the score across rounds and
 * who's given the most, and it's all plain logic: the screen reads it and
 * draws it, and a test can run a whole show without one.
 */

export type Phase = "intro" | "fight" | "ko" | "win";

/** how long each part of a round lasts, in seconds */
export const INTRO = 6;
export const KO_HOLD = 1.8;
export const WIN = 7.5;
/** a round that's still going this long is decided on health */
export const FIGHT_MAX = 90;
/** the walls start closing in later than in a video, so gifts have time to matter */
export const LIVE_SUDDEN = 50;
/** balls start tougher than in a video, for the same reason */
export const LIVE_HP = 1.5;
export const MAX_TEAM = 24;

export type Member = { viewer: Viewer; side: Team; coins: number };
export type FeedItem = { id: number; at: number; side: Team | null; viewer: Viewer; text: string; coins: number };
export type Callout = { id: number; at: number; side: Team; viewer: Viewer; gift: string; count: number; coins: number; effect: Effect; label: string };
export type Cue = { at: number; kind: "count" | "fight" | "ko" | "win" | "gift" | "join"; n?: number };

type Pending = { side: Team; viewer: Viewer; effect: Effect; n: number };

export class Show {
  /** seconds since the show started, real time */
  now = 0;
  phase: Phase = "intro";
  phaseAt = 0;
  round = 0;
  series: [number, number] = [0, 0];
  /** a side's run of wins in a row */
  streak: { side: Team; n: number } | null = null;
  a: AbilityId = "spike";
  b: AbilityId = "fibonacci";
  world!: World;
  winner: Team | null = null;
  byTime = false;
  /** how fast the fight is running: slower when it's close to the end */
  speed = 1;
  readonly members = new Map<string, Member>();
  /** what each viewer has given this round, in coins */
  readonly roundCoins = new Map<string, number>();
  /** likes toward the next HP, per side, and in all this round */
  readonly likes: [number, number] = [0, 0];
  readonly roundLikes: [number, number] = [0, 0];
  readonly feed: FeedItem[] = [];
  readonly callouts: Callout[] = [];
  readonly cues: Cue[] = [];
  /** every cue so far, counting ones the list has let go of */
  cueCount = 0;
  /** the last round's best gifter */
  mvp: { viewer: Viewer; coins: number; side: Team } | null = null;
  private readonly pending: Pending[] = [];
  private readonly shared = new Set<string>();
  private readonly followed = new Set<string>();
  private readonly rand: () => number;
  private acc = 0;
  private nextId = 1;

  constructor(seed = Date.now() % 1_000_000_007) {
    this.rand = rng(seed);
    this.startRound();
  }

  get names(): [string, string] {
    return [ABILITIES[this.a].name, ABILITIES[this.b].name];
  }

  kind(side: Team): AbilityId {
    return side === 0 ? this.a : this.b;
  }

  /** seconds into the current part of the round */
  get elapsed(): number {
    return this.now - this.phaseAt;
  }

  sideOf(viewerId: string): Team | null {
    return this.members.get(viewerId)?.side ?? null;
  }

  memberCount(side: Team): number {
    let n = 0;
    for (const m of this.members.values()) if (m.side === side) n++;
    return n;
  }

  /** the side that's behind: gifts from someone who hasn't picked go there */
  underdog(): Team {
    const h0 = this.world.hp(0), h1 = this.world.hp(1);
    if (h0 !== h1) return h0 < h1 ? 0 : 1;
    const m0 = this.memberCount(0), m1 = this.memberCount(1);
    if (m0 !== m1) return m0 < m1 ? 0 : 1;
    return this.rand() < 0.5 ? 0 : 1;
  }

  /** this round's biggest gifters on a side */
  top(side: Team, n = 3): { viewer: Viewer; coins: number }[] {
    const out: { viewer: Viewer; coins: number }[] = [];
    for (const [id, coins] of this.roundCoins) {
      const m = this.members.get(id);
      if (m && m.side === side && coins > 0) out.push({ viewer: m.viewer, coins });
    }
    return out.sort((x, y) => y.coins - x.coins).slice(0, n);
  }

  /** the whole show's biggest gifters, either side */
  leaders(n = 5): Member[] {
    return [...this.members.values()].filter((m) => m.coins > 0).sort((x, y) => y.coins - x.coins).slice(0, n);
  }

  private startRound() {
    this.round++;
    const last: [AbilityId, AbilityId] = [this.a, this.b];
    let a: AbilityId, b: AbilityId;
    do {
      a = ABILITY_IDS[Math.floor(this.rand() * ABILITY_IDS.length)];
      b = ABILITY_IDS[Math.floor(this.rand() * ABILITY_IDS.length)];
    } while (a === b || (this.round > 1 && ((a === last[0] && b === last[1]) || (a === last[1] && b === last[0]))));
    this.a = a;
    this.b = b;
    const w = new World(Math.floor(this.rand() * 2 ** 31), { suddenDeath: LIVE_SUDDEN, maxTeam: MAX_TEAM });
    const hpA = Math.round(ABILITIES[a].hp * LIVE_HP), hpB = Math.round(ABILITIES[b].hp * LIVE_HP);
    w.add(0, a, ARENA * 0.27, ARENA * (0.42 + w.rand() * 0.16), { hp: hpA, maxHp: hpA });
    w.add(1, b, ARENA * 0.73, ARENA * (0.42 + w.rand() * 0.16), { hp: hpB, maxHp: hpB });
    this.world = w;
    this.winner = null;
    this.byTime = false;
    this.speed = 1;
    this.acc = 0;
    this.roundCoins.clear();
    this.roundLikes[0] = this.roundLikes[1] = 0;
    this.shared.clear();
    this.go("intro");
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

  private post(side: Team | null, viewer: Viewer, text: string, coins = 0) {
    this.feed.push({ id: this.nextId++, at: this.now, side, viewer, text, coins });
    if (this.feed.length > 12) this.feed.splice(0, this.feed.length - 12);
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
        this.go("fight");
        this.cue("fight");
        for (const p of this.pending.splice(0)) this.apply(p);
      }
      return;
    }

    if (this.phase === "fight" || this.phase === "ko") {
      const w = this.world;
      if (this.phase === "ko") this.speed = 0.22;
      else {
        // clutch: when a side is nearly out, the fight slows so everyone can see it
        const low = Math.min(w.hp(0), w.hp(1));
        this.speed = low <= 3 && w.clock > 5 ? 0.55 : 1;
      }
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= TICK && steps < 12) {
        w.tick();
        this.acc -= TICK;
        steps++;
        if (this.phase === "fight" && this.decided()) break;
      }
      if (this.acc > TICK * 12) this.acc = 0;
      if (this.phase === "ko" && this.elapsed >= KO_HOLD) {
        this.go("win");
        this.cue("win");
      }
      return;
    }

    if (this.phase === "win" && t >= WIN) this.startRound();
  }

  /** Has the fight just been decided? If so, move on to the knockout. */
  private decided(): boolean {
    const w = this.world;
    const c0 = w.count(0), c1 = w.count(1);
    let winner: Team | null | undefined;
    if (c0 === 0 || c1 === 0) winner = c0 === 0 && c1 === 0 ? null : c0 === 0 ? 1 : 0;
    else if (w.clock >= FIGHT_MAX) {
      const h0 = w.hp(0), h1 = w.hp(1);
      winner = h0 === h1 ? null : h0 > h1 ? 0 : 1;
      this.byTime = true;
    }
    if (winner === undefined) return false;
    this.winner = winner;
    if (winner !== null) {
      this.series[winner]++;
      this.streak = this.streak?.side === winner ? { side: winner, n: this.streak.n + 1 } : { side: winner, n: 1 };
    }
    // the round's best gifter
    let best: Show["mvp"] = null;
    for (const [id, coins] of this.roundCoins) {
      const m = this.members.get(id);
      if (m && coins > 0 && (!best || coins > best.coins)) best = { viewer: m.viewer, coins, side: m.side };
    }
    this.mvp = best;
    this.go("ko");
    this.cue("ko");
    return true;
  }

  /** Someone picks a side, or switches. */
  join(viewer: Viewer, side: Team, quiet = false): Member {
    const m = this.members.get(viewer.id);
    if (m) {
      m.viewer = { ...m.viewer, ...viewer, avatar: viewer.avatar ?? m.viewer.avatar };
      if (m.side !== side) {
        m.side = side;
        if (!quiet) this.post(side, viewer, `switched to ${this.names[side]}`);
      }
      return m;
    }
    const fresh: Member = { viewer, side, coins: 0 };
    this.members.set(viewer.id, fresh);
    if (!quiet) {
      this.post(side, viewer, `joined ${this.names[side]}`);
      this.cue("join");
    }
    return fresh;
  }

  /** One thing that happened on the stream. */
  handle(e: LiveEvent) {
    if (e.kind === "chat") {
      const side = sideFromChat(e.text, this.names);
      if (side !== null) this.join(e.viewer, side);
      return;
    }
    if (e.kind === "join") return;

    const side = this.sideOf(e.viewer.id) ?? this.underdog();

    if (e.kind === "like") {
      this.likes[side] += e.count;
      this.roundLikes[side] += e.count;
      const hp = Math.floor(this.likes[side] / LIKES_PER_HP);
      if (hp > 0) {
        this.likes[side] -= hp * LIKES_PER_HP;
        this.act({ side, viewer: e.viewer, effect: "heal", n: hp });
      }
      return;
    }

    if (e.kind === "follow") {
      if (this.followed.has(e.viewer.id)) return;
      this.followed.add(e.viewer.id);
      this.join(e.viewer, side, true);
      this.post(side, e.viewer, "followed: +3 HP");
      this.act({ side, viewer: e.viewer, effect: "heal", n: 3 });
      return;
    }

    if (e.kind === "share") {
      if (this.shared.has(e.viewer.id)) return;
      this.shared.add(e.viewer.id);
      this.join(e.viewer, side, true);
      this.post(side, e.viewer, "shared: mini ball");
      this.act({ side, viewer: e.viewer, effect: "small", n: 1 });
      return;
    }

    // a gift: it counts for the giver's side, and puts them on it if they hadn't picked
    const m = this.join(e.viewer, side, true);
    const total = e.coins * e.count;
    m.coins += total;
    this.roundCoins.set(e.viewer.id, (this.roundCoins.get(e.viewer.id) ?? 0) + total);
    const tier = tierFor(e.coins);
    this.post(side, e.viewer, `${e.count > 1 ? `${e.count}× ` : ""}${e.gift}: ${tier.label}`, total);
    this.cue("gift", total);
    // big gifts get a banner; small ones just the feed
    if (tier.effect !== "heal" && tier.effect !== "small") {
      this.callouts.push({ id: this.nextId++, at: this.now, side, viewer: e.viewer, gift: e.gift, count: e.count, coins: total, effect: tier.effect, label: tier.label });
      if (this.callouts.length > 8) this.callouts.splice(0, this.callouts.length - 8);
    }
    for (const s of giftSteps(e.coins, e.count)) this.act({ side, viewer: e.viewer, effect: s.effect, n: s.n });
  }

  /** Do it now if the fight's on; otherwise it waits for the next fight to start. */
  private act(p: Pending) {
    if (this.phase === "fight") this.apply(p);
    else this.pending.push(p);
  }

  private apply({ side, viewer, effect, n }: Pending) {
    const w = this.world;
    const tag = { name: viewer.name, avatar: viewer.avatar };
    switch (effect) {
      case "heal":
        w.heal(side, n);
        break;
      case "small":
        for (let i = 0; i < n; i++) if (!w.summon(side, this.kind(side), { small: true, tag })) w.heal(side, 2);
        break;
      case "ball":
        for (let i = 0; i < n; i++) if (!w.summon(side, this.kind(side), { tag })) w.heal(side, 8);
        break;
      case "rage":
        w.buff(side, "rage", RAGE_SECONDS * n);
        break;
      case "shield":
        w.buff(side, "shield", SHIELD_SECONDS * n);
        break;
      case "meteor":
        for (let i = 0; i < n; i++) w.meteor(side, i, i * 0.35);
        break;
    }
  }
}
