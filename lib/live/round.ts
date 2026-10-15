import { ABILITIES, type AbilityId } from "../battle/abilities";
import { ARENA, rng, TICK, World, type Ball, type Team } from "../battle/sim";
import type { LiveEvent, Viewer } from "./events";
import { ballFor, FOLLOW_HP, LIKES_PER_HP, LIVE_ABILITIES, MAX_SIDE, powerFor, SHARE_HP, sideFromChat, TEAMS, type Power } from "./rules";

/**
 * A live show: round after round of RED against BLUE. Each side has a
 * champion ball, and viewers join a side by typing 1 or 2. A gift drops
 * the giver's own ball into the fight with their face on it, and more
 * gifts make it bigger; likes heal. Bigger gifts set off a power (shield,
 * freeze, meteor), and the round's biggest gifter wears the crown. It
 * keeps the score across rounds, and
 * it's all plain logic: the screen reads it and draws it, and a test can
 * run a whole show without one.
 */

export type Phase = "intro" | "fight" | "ko" | "win";

/** how long each part of a round lasts, in seconds */
export const INTRO = 6;
export const KO_HOLD = 1.8;
export const WIN = 7;
/** a round that's still going this long is decided on health */
export const FIGHT_MAX = 90;
/** the walls start closing in later than in a video, so gifts have time to matter */
export const LIVE_SUDDEN = 50;
/** champions start tougher than in a video, for the same reason */
export const LIVE_HP = 1.5;

export type Member = { viewer: Viewer; side: Team; coins: number };
/** one line about what just happened, shown briefly */
export type Toast = { id: number; at: number; side: Team; viewer: Viewer; text: string };
/** a power gift going off: its moment on screen */
export type Blast = { id: number; at: number; side: Team; viewer: Viewer; power: Power; count: number };
export type Cue = { at: number; kind: "count" | "fight" | "ko" | "win" | "gift" | "join"; n?: number };

type Pending =
  | { side: Team; viewer: Viewer; coins: number; gift: string; each: number; count: number }
  | { side: Team; viewer: Viewer; heal: number };

export class Show {
  /** seconds since the show started, real time */
  now = 0;
  phase: Phase = "intro";
  phaseAt = 0;
  round = 0;
  series: [number, number] = [0, 0];
  a: AbilityId = "spike";
  b: AbilityId = "sword";
  world!: World;
  winner: Team | null = null;
  byTime = false;
  /** how fast the fight is running: slower when it's about to be decided */
  speed = 1;
  readonly members = new Map<string, Member>();
  /** what each viewer has given this round, in coins */
  readonly roundCoins = new Map<string, number>();
  /** each viewer's ball this round */
  readonly ballOf = new Map<string, Ball>();
  /** likes toward the next HP, per side */
  readonly likes: [number, number] = [0, 0];
  readonly toasts: Toast[] = [];
  readonly blasts: Blast[] = [];
  /** who's given the most this round, and so wears the crown */
  crown: string | null = null;
  readonly cues: Cue[] = [];
  /** every cue so far, counting ones the list has let go of */
  cueCount = 0;
  /** the last round's biggest gifter */
  mvp: { viewer: Viewer; coins: number; side: Team } | null = null;
  private readonly pending: Pending[] = [];
  private readonly followed = new Set<string>();
  private readonly shared = new Set<string>();
  private readonly rand: () => number;
  private acc = 0;
  private nextId = 1;

  constructor(seed = Date.now() % 1_000_000_007) {
    this.rand = rng(seed);
    this.startRound();
  }

  kind(side: Team): AbilityId {
    return side === 0 ? this.a : this.b;
  }

  /** "Spike", "Sword": what each side's champion is this round */
  ability(side: Team): string {
    return ABILITIES[this.kind(side)].name;
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

  private startRound() {
    this.round++;
    const pool = LIVE_ABILITIES;
    let a: AbilityId, b: AbilityId;
    do {
      a = pool[Math.floor(this.rand() * pool.length)];
      b = pool[Math.floor(this.rand() * pool.length)];
    } while (a === b || (this.round > 1 && a === this.a && b === this.b));
    this.a = a;
    this.b = b;
    const w = new World(Math.floor(this.rand() * 2 ** 31), { suddenDeath: LIVE_SUDDEN, maxTeam: MAX_SIDE });
    const hpA = Math.round(ABILITIES[a].hp * LIVE_HP), hpB = Math.round(ABILITIES[b].hp * LIVE_HP);
    w.add(0, a, ARENA * 0.27, ARENA * (0.42 + w.rand() * 0.16), { hp: hpA, maxHp: hpA });
    w.add(1, b, ARENA * 0.73, ARENA * (0.42 + w.rand() * 0.16), { hp: hpB, maxHp: hpB });
    this.world = w;
    this.winner = null;
    this.byTime = false;
    this.speed = 1;
    this.acc = 0;
    this.roundCoins.clear();
    this.ballOf.clear();
    this.crown = null;
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

  private toast(side: Team, viewer: Viewer, text: string) {
    this.toasts.push({ id: this.nextId++, at: this.now, side, viewer, text });
    if (this.toasts.length > 12) this.toasts.splice(0, this.toasts.length - 12);
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
        // when a side is down to its last few HP, slow it down so everyone sees the end
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
    if (winner !== null) this.series[winner]++;
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
  join(viewer: Viewer, side: Team): Member {
    const m = this.members.get(viewer.id);
    if (m) {
      m.viewer = { ...m.viewer, ...viewer, avatar: viewer.avatar ?? m.viewer.avatar };
      m.side = side;
      return m;
    }
    const fresh: Member = { viewer, side, coins: 0 };
    this.members.set(viewer.id, fresh);
    this.cue("join");
    return fresh;
  }

  /** One thing that happened on the stream. */
  handle(e: LiveEvent) {
    if (e.kind === "chat") {
      const side = sideFromChat(e.text);
      if (side !== null) this.join(e.viewer, side);
      return;
    }
    if (e.kind === "join") return;

    const side = this.sideOf(e.viewer.id) ?? this.underdog();

    if (e.kind === "like") {
      this.likes[side] += e.count;
      const hp = Math.floor(this.likes[side] / LIKES_PER_HP);
      if (hp > 0) {
        this.likes[side] -= hp * LIKES_PER_HP;
        this.act({ side, viewer: e.viewer, heal: hp });
      }
      return;
    }

    if (e.kind === "follow" || e.kind === "share") {
      const seen = e.kind === "follow" ? this.followed : this.shared;
      if (seen.has(e.viewer.id)) return;
      seen.add(e.viewer.id);
      this.join(e.viewer, side);
      const hp = e.kind === "follow" ? FOLLOW_HP : SHARE_HP;
      this.toast(side, e.viewer, `${e.kind === "follow" ? "followed" : "shared"}: +${hp} HP`);
      this.act({ side, viewer: e.viewer, heal: hp });
      return;
    }

    // a gift counts for the giver's side, and puts them on it if they hadn't picked
    const m = this.join(e.viewer, side);
    const coins = e.coins * e.count;
    m.coins += coins;
    this.cue("gift", coins);
    this.act({ side, viewer: m.viewer, coins, gift: e.count > 1 ? `${e.count}× ${e.gift}` : e.gift, each: e.coins, count: e.count });
  }

  /** Do it now if the fight's on; otherwise it waits for the next fight to start. */
  private act(p: Pending) {
    if (this.phase === "fight") this.apply(p);
    else this.pending.push(p);
  }

  private apply(p: Pending) {
    const w = this.world;
    if ("heal" in p) {
      w.heal(p.side, p.heal);
      return;
    }
    const { side, viewer, coins, gift } = p;
    const team = TEAMS[side].name.toUpperCase();
    const total = (this.roundCoins.get(viewer.id) ?? 0) + coins;
    this.roundCoins.set(viewer.id, total);
    this.power(p.side, viewer, p.each, p.count);
    // the crown goes to whoever's given the most this round
    const top = this.crown ? (this.roundCoins.get(this.crown) ?? 0) : 0;
    const took = this.crown !== viewer.id && total > top;
    if (took) this.crown = viewer.id;
    const stats = ballFor(total);
    const mine = this.ballOf.get(viewer.id);
    if (mine?.alive && mine.team === side) {
      w.grow(mine, stats);
      this.toast(side, viewer, took ? `took the crown · ${gift}` : `grew · ${gift}`);
      return;
    }
    const ball = w.summon(side, this.kind(side), { ...stats, tag: { name: viewer.name, avatar: viewer.avatar } });
    if (ball) {
      this.ballOf.set(viewer.id, ball);
      this.toast(side, viewer, took && top > 0 ? `took the crown · ${gift}` : `joined ${team} · ${gift}`);
    } else {
      // the side is full: the gift heals it instead
      const hp = Math.max(1, Math.round(ballFor(coins).hp / 2));
      w.heal(side, hp);
      this.toast(side, viewer, `healed ${team} +${hp} · ${gift}`);
    }
  }

  /** A big enough gift sets off a power, once per gift sent. */
  private power(side: Team, viewer: Viewer, each: number, count: number) {
    const power = powerFor(each);
    if (!power) return;
    const w = this.world;
    if (power.id === "shield") w.protect(side, power.seconds * count);
    else if (power.id === "freeze") w.freeze((1 - side) as Team, power.seconds * count);
    else for (let i = 0; i < Math.min(count, 5); i++) w.meteor(side, i, i * 0.4);
    this.blasts.push({ id: this.nextId++, at: this.now, side, viewer, power, count });
    if (this.blasts.length > 8) this.blasts.splice(0, this.blasts.length - 8);
  }
}
