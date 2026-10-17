import type { Team } from "../../battle/sim";
import type { Tier } from "../menu";
import { DEFAULT_SIDE_GIFTS, RIVAL_HEAL, rivalryLabel, rotation, routeGift, sideMenu, type Rivalry, type SideGifts } from "../rivals";
import type { GameId, LiveSettings } from "../settings";
import { BattleGame } from "./battle";
import type { RoundStart, VoteOption } from "./types";
import type { RoundTape } from "../tape";

/**
 * Rivals: the ball battle, red against blue, with a rivalry on it. Each
 * round both sides field the same champion, so the gifts decide it, and
 * the gift someone sends is the side they're on: each side has its own
 * three gifts for the same three powers. Any other gift helps the side
 * the giver is on, by its price. Between rounds, the chat votes the next
 * rivalry.
 */
export class RivalsGame extends BattleGame {
  readonly id: GameId = "rivals";
  /** for a gift from someone on neither side, which the show never sends: it heals */
  readonly menu: Tier[] = [RIVAL_HEAL];
  readonly gifts: SideGifts;
  readonly rivalries: Rivalry[];
  rivalry: Rivalry;
  private readonly menus: [Tier[], Tier[]];

  constructor(s: LiveSettings) {
    super(s);
    this.gifts = s.rivals.gifts ?? DEFAULT_SIDE_GIFTS;
    this.rivalries = rotation(s.rivals.groups, s.rivals.own);
    this.rivalry = this.rivalries[0];
    this.menus = [sideMenu(this.gifts.red), sideMenu(this.gifts.blue)];
  }

  start({ round, option, rand }: RoundStart) {
    // what the vote picked, or a different rivalry from last round's
    let next = option ? this.rivalries.find((r) => r.id === option.key) : undefined;
    if (!next) {
      const others = this.rivalries.filter((r) => r.id !== this.rivalry.id);
      next = others[Math.floor(rand() * others.length)] ?? this.rivalries[0];
    }
    this.rivalry = next;
    this.teamNames = [next.red, next.blue];
    // the same champion on both sides, so it's the gifts that decide it, and a different one from last round's
    const fresh = round > 1 ? this.pool.filter((k) => k !== this.a) : this.pool;
    const from = fresh.length > 0 ? fresh : this.pool;
    const kind = from[Math.floor(rand() * from.length)];
    this.arena(kind, kind, rand);
  }

  names(): [string, string] {
    return [this.rivalry.red, this.rivalry.blue];
  }

  /** This round as it reached the arena, with its rivalry, so a clip of it names the same two sides. */
  tape(): RoundTape | null {
    const t = super.tape();
    return t && { ...t, rivalry: { id: this.rivalry.id, group: this.rivalry.group } };
  }

  route(gift: string): { side: Team; tier: Tier } | null {
    return routeGift(this.gifts, gift);
  }

  sideMenu(side: Team): Tier[] {
    return this.menus[side];
  }

  options(rand: () => number): VoteOption[] {
    // never the rivalry that just played
    const fresh = this.rivalries.filter((r) => r.id !== this.rivalry.id);
    const from = fresh.length >= 3 ? fresh : this.rivalries;
    const picked: Rivalry[] = [];
    while (picked.length < Math.min(3, from.length)) {
      const r = from[Math.floor(rand() * from.length)];
      if (!picked.includes(r)) picked.push(r);
    }
    return picked.map((r) => ({ key: r.id, label: rivalryLabel(r) }));
  }
}
