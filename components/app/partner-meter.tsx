import { big, keepProgress, nextRules, notesFor, progressOf, rulesOn, YPP_RULES, type Check, type Progress, type Rules } from "@/lib/earnings/ypp";
import type { ChannelProof } from "@/lib/server/shorts/proof";

/**
 * How far one YouTube channel is from the Partner Program's bars, by
 * YouTube Analytics and its public subscriber count. Each rung says what
 * it unlocks and what needs someone 18 or older, then has a bar for each
 * figure, never past 100%, and a figure that isn't known says so. A rung
 * with every part past says the channel is past its bars by YouTube
 * Analytics, never that it qualifies, since YouTube Studio's Earn page
 * has YouTube's own count and YouTube reviews every channel. A channel
 * YouTube estimates ad revenue for already shares in it, so it gets that
 * line instead. No countdown, pace or projection anywhere.
 */

const count = (n: number) => Math.floor(n).toLocaleString("en-US");

/** One figure against its bar: what it is, have of need (or that it isn't known), and a bar that stops at full. */
function Row({ label, check, say }: { label: string; check: Check; say: (have: number, need: number) => string }) {
  const share = check.have === null ? null : Math.max(0, Math.min(1, check.have / check.need));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-[13px]">{label}</span>
        <span className={`font-mono text-[12px] tabular-nums ${check.have === null ? "text-muted" : ""}`}>{check.have === null ? "Not known" : say(check.have, check.need)}</span>
      </div>
      {share !== null && (
        <div className="h-2 bg-card-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(share * 100)} aria-label={label}>
          <div className="h-full bg-signal" style={{ width: `${share * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/** One rung: its name, what it unlocks, who has to be 18 or older, and its figures. Shorts views and watch hours show only where YouTube split them. */
function Rung({ p, split }: { p: Progress; split: boolean }) {
  return (
    <div className="flex flex-col gap-3 border-t-2 border-edge pt-4 first:border-t-0 first:pt-0">
      <div>
        <p className="text-[15px] font-semibold">{p.rung.name}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{p.rung.unlocks}</p>
        <p className="mt-1.5 border-l-2 border-signal pl-2.5 text-[13px] leading-relaxed">{p.rung.adult}</p>
      </div>
      <Row label="Subscribers" check={p.subscribers} say={(have, need) => `${count(have)} of ${count(need)}`} />
      {p.uploads && <Row label="Public uploads, last 90 days" check={p.uploads} say={(have, need) => `${count(have)} that Hookline knows of. Needs ${count(need)}.`} />}
      {split && (
        <>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">And one of these</p>
          <Row label="Engaged views on Shorts, last 90 days" check={p.shorts} say={(have, need) => `${big(have)} of ${big(need)}`} />
          <Row label="Watch hours on long videos, last 12 months" check={p.hours} say={(have, need) => `${big(have)} of ${count(need)}`} />
        </>
      )}
      {p.past && (
        <p className="text-[13px] leading-relaxed">By YouTube Analytics, this channel is past these bars. YouTube Studio&rsquo;s Earn page says whether you can apply.</p>
      )}
    </div>
  );
}

/** The notes under the rungs: where the figures come from, what reaching a bar means, and why any figure is missing. */
function notesOf(c: ChannelProof): string[] {
  return [
    "These come from YouTube Analytics and YouTube's public subscriber count. YouTube Studio's Earn page has YouTube's own count, which can differ.",
    "Reaching a bar lets you apply. YouTube reviews every channel and turns some down.",
    ...((c.numbers.subscribers ?? 0) > 1000 ? ["YouTube rounds subscriber counts over 1,000 down."] : []),
    ...(c.subscribersHidden ? ["This channel hides its subscriber count on YouTube, so Hookline can't show it."] : []),
    // a channel with no views in 90 days has nothing to split, which the card says already
    ...(!c.split && c.through ? ["YouTube didn't split Shorts from long videos for this channel, so their views and watch hours don't show. YouTube Studio's Earn page has them."] : []),
    ...(c.revenueReadable === false
      ? ["Hookline can't read this channel's revenue, so it can't tell whether it's in the Partner Program already. If it is, these bars don't apply to it."]
      : []),
  ];
}

/**
 * `today` is the day the bars are for, and `sets` the bars as they're kept
 * in lib/earnings/ypp.ts, copied from YouTube's own pages. A later set
 * gets its dated notes, with a link to YouTube's page on it.
 */
export function PartnerMeter({ c, today, sets = YPP_RULES }: { c: ChannelProof; today: string; sets?: Rules[] }) {
  const rules = rulesOn(today, sets);
  const keep = c.sharesAds ? keepProgress(c.numbers, rules) : null;
  const next = nextRules(today, sets);
  const dated = notesFor(today, c.sharesAds, sets);
  const notes = c.sharesAds ? dated : [...notesOf(c), ...dated];
  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-display text-lg uppercase tracking-wide">YouTube Partner Program</h3>
      {c.sharesAds ? (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] leading-relaxed">YouTube estimates ad revenue for this channel, so it already shares in ad revenue.</p>
          {keep && <Row label="Sharing in Shorts ad revenue" check={keep} say={(have, need) => `${big(have)} of ${big(need)} engaged views on Shorts, last 90 days`} />}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {progressOf(c.numbers, rules).map((p) => <Rung key={p.rung.id} p={p} split={c.split} />)}
        </div>
      )}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t-2 border-edge pt-4 text-[12px] leading-relaxed text-muted">
          {notes.map((t) => <li key={t}>{t}</li>)}
          {next && dated.length > 0 && (
            <li>
              <a href={next.source} target="_blank" rel="noreferrer" className="text-fg underline decoration-signal decoration-2 underline-offset-4">YouTube&rsquo;s announcement</a>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
