import "server-only";
import { z } from "zod";
import type { Goal } from "../app/checklist";
import type { Plan } from "../billing/plans";
import {
  CLIP_DAYS, CLIP_INPUTS, CLIP_MIN_FIGHT, CLIP_MIN_SCORE, CLIP_MOMENTS, CLIP_NAME, CLIP_PEOPLE, CLIP_RATE, CLIP_V, CLIPS_PER_SESSION, clipWindow, lastStep, replay,
  type ClipLog,
} from "../live/clip";
import { clipRules, showable } from "../live/clip-rules";
import { SESSION_IDLE } from "../live/session";
import { LIVE_ABILITIES, parseSettings, type LiveSettings } from "../live/settings";
import { clipCandidate } from "../shorts/formats/clip";
import type { Candidate } from "../shorts/types";
import { admin, asUser, type Tx } from "./db";
import { configured } from "./env";

/**
 * LIVE clips on the server: the rounds a streamer's game sends, checked,
 * played back and kept only when they're worth a Short, at most each LIVE's
 * best three, for three days. The game runs signed out, so its overlay key
 * says whose round it is, and only the server writes them.
 *
 * A round is the game's word, like a session's gift coins: Hookline checks
 * it hangs together (the same arena, fed those calls, is decided on that
 * step with that result) and a morning only takes one from a finished LIVE
 * that counts as theirs. It can't prove every gift in it happened.
 */

const DAY = 86400_000;
/** the last moment of the year 9999: the latest time the database takes as a date */
const LATEST = 253_402_300_799_999;

const team = z.union([z.literal(0), z.literal(1)]);
/** a physics step: two to each video frame, from the round's start */
const step = z.number().int().min(0);
const ability = z.enum(LIVE_ABILITIES);
/** the health a gift, like or follow brings, or a meteor hits for */
const health = z.number().int().min(1).max(10_000_000);
/** whose doing it was: an index into people, or -1 for nobody named */
const who = z.number().int().min(-1);

const input = z.union([
  z.tuple([step, z.literal("h"), team, health]),
  // a ball's health is 0 for the default
  z.tuple([step, z.literal("s"), team, ability, z.union([z.literal(0), z.literal(1)]), z.number().int().min(0).max(10_000_000), who]),
  z.tuple([step, z.enum(["r", "p"]), team, z.number().min(0).max(60)]),
  z.tuple([step, z.literal("m"), team, z.number().int().min(0).max(50), z.number().min(0).max(10), health]),
]);

const moment = z.tuple([step, z.enum(["rage", "shield", "meteor"]), team, who, z.number().int().min(1).max(1000), z.union([z.literal(0), z.literal(1), z.literal(2)])]);

const side = z.object({ name: z.string().min(1).max(12), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });

/** a gifter's display name, as long as a record keeps one */
const person = z.string().max(2 * CLIP_NAME).refine((n) => [...n].length <= CLIP_NAME);

/**
 * A round's record, every field bounded, so nothing in it can make the
 * server work long: at most 6,000 inputs, and an end no later than the
 * round's own time limit, so playing it back stops by then.
 */
export const clipSchema = z
  .object({
    v: z.literal(CLIP_V),
    game: z.enum(["battle", "rivals"]),
    session: z.uuid(),
    round: z.number().int().min(1).max(100_000),
    at: z.number().int().positive().max(LATEST),
    seed: z.number().int().min(0).max(2 ** 31 - 1),
    a: ability,
    b: ability,
    hp: z.tuple([z.number().int().min(1).max(1000), z.number().int().min(1).max(1000)]),
    world: z.object({
      suddenDeath: z.number().int().min(0).max(300),
      maxTeam: z.number().int().min(1).max(100),
      wallShare: z.number().min(0).max(1),
      hangOn: z.number().min(0).max(60),
    }),
    fightMax: z.number().int().min(30).max(300),
    teams: z.tuple([side, side]),
    rivalry: z.object({ id: z.string().min(1).max(40), group: z.string().min(1).max(20) }).optional(),
    inputs: z.array(input).max(CLIP_INPUTS),
    moments: z.array(moment).max(CLIP_MOMENTS),
    people: z.array(person).max(CLIP_PEOPLE),
    end: z.number().int().min(CLIP_MIN_FIGHT * 60),
    result: z.object({ team: team.nullable(), byTime: z.boolean() }),
    check: z.string().regex(/^[0-9a-f]{8}$/),
  })
  .superRefine((log, ctx) => {
    if (log.end > lastStep(log.fightMax)) ctx.addIssue({ code: "custom", path: ["end"], message: "past the round's time limit" });
    let last = 0;
    for (const [i, x] of log.inputs.entries()) {
      if (x[0] < last || x[0] > log.end) ctx.addIssue({ code: "custom", path: ["inputs", i], message: "out of order" });
      if (x[1] === "s" && x[6] >= log.people.length) ctx.addIssue({ code: "custom", path: ["inputs", i], message: "nobody by that number" });
      last = x[0];
    }
    for (const [i, m] of log.moments.entries()) {
      if (m[0] > log.end || m[3] >= log.people.length) ctx.addIssue({ code: "custom", path: ["moments", i], message: "out of the round" });
    }
  });

/** What the game sends: its key, and the round. */
export const clipUpload = z.object({ key: z.string().min(16).max(64).regex(/^[\w-]+$/), clip: clipSchema });

/**
 * Whether a streamer's rounds can become Shorts: they have it on, Hookline
 * asks TikTok for usernames (TIKTOK_PROFILE), without which no LIVE counts
 * as anyone's, and their Shorts aren't off for LIVE games only. The game,
 * the upload and a morning's Shorts all go by this.
 */
export function clipsAllowed(settings: Pick<LiveSettings, "clips">, goal: Goal | null, usernames: boolean): boolean {
  return settings.clips && usernames && goal !== "live";
}

/** What became of a round the game sent. */
export type ClipSaved = { status: 403 | 404 | 409 | 429 } | { status: 422; why: string } | { status: 200; kept: boolean };

/** The account behind an overlay key, or null for a key that isn't one. */
async function ownerOf(tx: Tx, key: string): Promise<string | null> {
  const [r] = await tx<{ user_id: string }[]>`select user_id from public.overlay_keys where key = ${key}`;
  return r?.user_id ?? null;
}

/** Whether an account's rounds can become Shorts, as its settings and goal say right now. */
async function allowedFor(tx: Tx, userId: string): Promise<boolean> {
  const [r] = await tx<{ settings: unknown; goal: Goal | null }[]>`
    select s.settings, p.goal from public.profiles p left join public.live_settings s on s.user_id = p.id where p.id = ${userId}`;
  return !!r && clipsAllowed(parseSettings(r.settings), r.goal, configured().tiktokProfile);
}

/** The lock an account's rounds take one at a time, and turning them off waits for. */
const lockOf = (userId: string) => `clips:${userId}`;

/** A round that can't be taken at all: past the hourly limit, or sent before, kept or not. */
async function blocked(tx: Tx, userId: string, log: ClipLog, now: Date): Promise<ClipSaved | null> {
  const [r] = await tx<{ recent: number; sent: boolean }[]>`
    select
      (select count(*)::int from public.live_clips where user_id = ${userId} and created_at > ${new Date(now.getTime() - 3600_000)}) as recent,
      exists (select 1 from public.live_clips where user_id = ${userId} and session_id = ${log.session} and round = ${log.round}) as sent`;
  if (r.recent >= CLIP_RATE) return { status: 429 };
  if (r.sent) return { status: 409 };
  return null;
}

type Verdict = { state: "ready"; score: number } | { state: "refused"; reason: "rules" | "replay" | "dull"; score: number | null; why: string };

/** What Hookline makes of a round: a rule it breaks, a record that doesn't play back the way the game said, too little happening, or how good it is to watch. */
function judge(log: ClipLog, now: Date): Verdict {
  const broke = clipRules(log, now.getTime());
  if (broke) return { state: "refused", reason: "rules", score: null, why: broke };
  const r = replay(log);
  const cut = clipWindow(r, log);
  if (!cut) return { state: "refused", reason: "replay", score: null, why: "It doesn't play back the way the game said it went." };
  if (cut.drama.score < CLIP_MIN_SCORE) return { state: "refused", reason: "dull", score: cut.drama.score, why: "Not enough happened in it for a Short." };
  return { state: "ready", score: cut.drama.score };
}

/**
 * A round from the game, kept when it can become a Short: an unknown key
 * is 404; clips off, usernames not checked yet or LIVE games only is 403;
 * more than 120 an hour, or one sent while another of the account's is
 * being played back, is 429; a round sent before is 409. One that breaks
 * a rule or doesn't play back exactly is turned away (422), and so is one
 * with too little happening (200, not kept). Turned-away rounds keep only
 * why, so none is sent twice and the limit counts every try. Each LIVE
 * keeps its best three, and lets go of the rest, names and all.
 *
 * Playing a round back takes up to a second of the server's time, so an
 * account's rounds are played back one at a time, inside the lock that
 * counts them: however many arrive at once, at most 120 an hour are ever
 * played back. An honest game sends one every 30 seconds or more.
 */
export async function saveClip(key: string, log: ClipLog, now = new Date()): Promise<ClipSaved> {
  return admin(async (tx) => {
    const userId = await ownerOf(tx, key);
    if (!userId) return { status: 404 };
    const [{ free }] = await tx<{ free: boolean }[]>`select pg_try_advisory_xact_lock(hashtext(${lockOf(userId)})) as free`;
    if (!free) return { status: 429 };
    // read under the lock, so a round can't slip in just after they're turned off
    if (!(await allowedFor(tx, userId))) return { status: 403 };
    // the quick checks first, so a round that can't be taken costs no playing back
    const no = await blocked(tx, userId, log, now);
    if (no) return no;
    const v = judge(log, now);
    const ready = v.state === "ready";
    await tx`
      insert into public.live_clips (user_id, session_id, round, game, state, reason, score, log, played_at, created_at)
      values (${userId}, ${log.session}, ${log.round}, ${log.game}, ${v.state}, ${ready ? null : v.reason}, ${v.score}, ${ready ? tx.json(log) : null}, ${new Date(log.at)}, ${now})`;
    if (!ready) return v.reason === "dull" ? { status: 200, kept: false } : { status: 422, why: v.why };
    const dropped = await tx<{ round: number }[]>`
      update public.live_clips c set state = 'refused', reason = 'dropped', log = null
      where c.user_id = ${userId} and c.session_id = ${log.session} and c.state = 'ready'
        and c.round not in (
          select b.round from public.live_clips b
          where b.user_id = ${userId} and b.session_id = ${log.session} and b.state = 'ready'
          order by b.score desc, b.played_at desc, b.round desc
          limit ${CLIPS_PER_SESSION})
      returning c.round`;
    return { status: 200, kept: !dropped.some((d) => d.round === log.round) };
  });
}

/**
 * Clips turned off: every round waiting goes, names and all, and so does
 * why the others were turned away. A round being played back as they're
 * turned off is waited for, so it goes too.
 */
export async function forgetClips(userId: string): Promise<void> {
  await admin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${lockOf(userId)}))`;
    await tx`delete from public.live_clips where user_id = ${userId}`;
  });
}

/** A waiting round a morning can make into one of its Shorts: which LIVE and round it is, and the Short it makes. */
export type TakenClip = { session: string; round: number; c: Candidate };

/**
 * A round from the creator's own LIVE for a morning's Shorts, or null when
 * there's none to take: their rounds can become Shorts, and no clip Short
 * has been made today where they are (`today` is their midnight), so it's
 * one a day at most. It comes only from a LIVE that counts as theirs and
 * has been quiet for 20 minutes, so it can't stop counting after this, of
 * the same game, with the round played while that LIVE was going. The
 * best of the last day and a half goes first, then the best still
 * waiting. Each is played back again: one that no longer plays back
 * exactly, or now breaks a rule, is turned away. Names Hookline can't
 * read, or that name people for who they are, are blanked. Taking a round
 * doesn't use it up; the transaction that saves its Short does.
 */
export async function takeClip(userId: string, o: { now: Date; today: Date; tz: string; per: Plan["shorts"]; rand: () => number }): Promise<TakenClip | null> {
  const [p] = await asUser(userId, (tx) => tx<{ settings: unknown; goal: Goal | null; made: boolean }[]>`
    select s.settings, p.goal,
      exists (select 1 from public.videos v where v.user_id = p.id and v.format = 'clip' and v.created_at >= ${o.today}) as made
    from public.profiles p left join public.live_settings s on s.user_id = p.id
    where p.id = ${userId}`);
  if (!p || p.made || !clipsAllowed(parseSettings(p.settings), p.goal, configured().tiktokProfile)) return null;
  const at = (ms: number) => new Date(o.now.getTime() - ms);
  const rows = await asUser(userId, (tx) => tx<{ session_id: string; round: number; log: ClipLog; played_at: Date }[]>`
    select c.session_id, c.round, c.log, c.played_at
    from public.live_clips c
    join public.live_sessions s on s.id = c.session_id and s.user_id = c.user_id
    where c.user_id = ${userId} and c.state = 'ready' and c.created_at > ${at(CLIP_DAYS * DAY)}
      -- a TikTok LIVE's only: rounds on YouTube never become Shorts
      and s.verified and s.game = c.game and s.platform = 'tiktok'
      -- the LIVE is over, so it can't stop counting as theirs after this
      and coalesce(s.last_event_at, s.started_at) < ${at(SESSION_IDLE)}
      -- the round was played while that LIVE was going
      and c.played_at between s.started_at - interval '1 minute' and coalesce(s.last_event_at, s.started_at) + interval '10 minutes'
    order by c.played_at > ${at(36 * 3600_000)} desc, c.score desc, c.played_at desc
    limit 3`);
  for (const r of rows) {
    const log: ClipLog = { ...r.log, people: r.log.people.map((n) => (showable(n) ? n : "")) };
    const broke = clipRules(log) !== null;
    const c = log.v === CLIP_V && !broke ? clipCandidate({ log, played_at: r.played_at }, replay(log), o) : null;
    if (c) return { session: r.session_id, round: r.round, c };
    // it can't become a Short any more: turned away like a round that came in that way, keeping only why
    await admin((tx) => tx`
      update public.live_clips set state = 'refused', reason = ${broke ? "rules" : "replay"}, log = null
      where user_id = ${userId} and session_id = ${r.session_id} and round = ${r.round} and state = 'ready'`);
  }
  return null;
}

/**
 * A round stops waiting as its Short is made, in the same transaction, so
 * it can't come round again: false when it's gone already, because clips
 * were turned off or it waited three days.
 */
export async function stopWaiting(tx: Tx, userId: string, t: { session: string; round: number }): Promise<boolean> {
  const gone = await tx`delete from public.live_clips where user_id = ${userId} and session_id = ${t.session} and round = ${t.round} and state = 'ready' returning round`;
  return gone.length > 0;
}

/**
 * A clip Short that won't show gifters' names lets go of them: kept with
 * names off, or swiped away. As the server, since the round a clip shows
 * is the server's to record. Any other Short is left as it is.
 */
export async function forgetNames(userId: string, videoId: string): Promise<void> {
  await admin((tx) => tx`
    update public.videos set params = jsonb_set(params, '{log,people}', '[]'::jsonb)
    where id = ${videoId} and user_id = ${userId} and format = 'clip' and params -> 'log' -> 'people' <> '[]'::jsonb`);
}

/**
 * Every hour: rounds go three days after they came, waiting or not. A clip
 * Short that doesn't show gifters' names lets go of them once it's been
 * swiped, or left unswiped for three days, so names stay only in a Short
 * that shows them.
 *
 * A swipe lets go of them itself, so this only catches what that missed,
 * among the Shorts swiped in the last week and those left unswiped for
 * three days, up to a week more. Every older one was tidied by then, and
 * its round is only read when it has to be: one can be 128 KB.
 */
export async function tidyClips(now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - CLIP_DAYS * DAY);
  const week = 7 * DAY;
  return admin(async (tx) => {
    const gone = await tx`delete from public.live_clips where created_at < ${since}`;
    // the case checks the times first, so no other Short's round is read at all
    const blank = await tx`
      update public.videos set params = jsonb_set(params, '{log,people}', '[]'::jsonb)
      where format = 'clip' and case
        when (status = 'review' and created_at < ${since} and created_at > ${new Date(since.getTime() - week)}) or (status <> 'review' and decided_at > ${new Date(now.getTime() - week)})
          then jsonb_typeof(params -> 'log' -> 'people') = 'array' and params -> 'log' -> 'people' <> '[]'::jsonb and params -> 'names' is distinct from 'true'::jsonb
        else false end`;
    const out: string[] = [];
    if (gone.count) out.push(`${gone.count} old round${gone.count === 1 ? "" : "s"} let go`);
    if (blank.count) out.push(`names emptied on ${blank.count} clip${blank.count === 1 ? "" : "s"}`);
    return out;
  });
}

/** What came of a LIVE's rounds: how many wait for a morning's Shorts, and the newest Short made from one. */
export type LiveClips = { waiting: number; shortId: string | null };

/**
 * For each of these LIVEs, for the LIVE page: its rounds waiting for a
 * morning's Shorts, counted only on a LIVE that counts as theirs, since no
 * other can become one, and the newest Short made from one of its rounds.
 * A Short from a round is made after its LIVE began, so only the Shorts
 * made since the first of these LIVEs began have their rounds read.
 */
export async function clipsOf(userId: string, sessionIds: string[], now = new Date()): Promise<Map<string, LiveClips>> {
  const out = new Map<string, LiveClips>(sessionIds.map((id) => [id, { waiting: 0, shortId: null }]));
  if (!sessionIds.length) return out;
  const since = new Date(now.getTime() - CLIP_DAYS * DAY);
  await asUser(userId, async (tx) => {
    const waiting = await tx<{ session_id: string; n: number }[]>`
      select c.session_id, count(*)::int as n
      from public.live_clips c join public.live_sessions s on s.id = c.session_id and s.user_id = c.user_id
      where c.user_id = ${userId} and c.session_id = any(${sessionIds}::uuid[]) and c.state = 'ready' and c.created_at > ${since} and s.verified
      group by c.session_id`;
    for (const w of waiting) out.get(w.session_id)!.waiting = w.n;
    const made = await tx<{ session: string; id: string }[]>`
      select distinct on (lower(params -> 'log' ->> 'session')) lower(params -> 'log' ->> 'session') as session, id
      from public.videos
      where user_id = ${userId} and format = 'clip'
        and created_at >= (select min(s.started_at) from public.live_sessions s where s.user_id = ${userId} and s.id = any(${sessionIds}::uuid[]))
        and lower(params -> 'log' ->> 'session') = any(${sessionIds}::text[])
      order by lower(params -> 'log' ->> 'session'), created_at desc`;
    for (const m of made) out.get(m.session)!.shortId = m.id;
  });
  return out;
}
