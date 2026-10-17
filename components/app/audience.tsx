import Link from "next/link";
import { Fragment } from "react";
import { percentOf } from "@/lib/shorts/proof";
import { KIDS_GUIDE } from "@/lib/shorts/youtube";
import type { ChannelProof } from "@/lib/server/shorts/proof";

/**
 * Who watches one YouTube channel, as YouTube Analytics shares it: its
 * signed-in viewers 13 and over by age group and gender, which says
 * plainly that nobody under 13 is in it. Then its made-for-kids answers,
 * from Hookline's own records, so they show whether or not Analytics can
 * be read: the creator's for the channel and for its posted Shorts, and
 * YouTube's verdicts. Nothing here suggests an answer: that's the
 * creator's call.
 */

const linked = "underline decoration-signal decoration-2 underline-offset-4";
const count = (n: number) => n.toLocaleString("en-US");

/** The made-for-kids answers on a channel and on its posted Shorts, the creator's and YouTube's. */
function Kids({ c }: { c: ChannelProof }) {
  const k = c.kids;
  const posted = k.no + k.yes + k.unknown;
  return (
    <div className="flex flex-col gap-2 text-[14px] leading-relaxed">
      <h3 className="font-display text-lg uppercase tracking-wide">Made for kids</h3>
      {k.answer === null ? (
        <p>
          Made for kids: not answered yet. <Link href={`/app/settings#audience-${c.id}`} className={linked}>Answer it in Settings</Link>
        </p>
      ) : (
        <p>Made for kids: you said {k.answer ? "Yes" : "No"} for this channel.</p>
      )}
      {k.youtubeAtConnect !== null && (
        <p className="text-muted">When you connected it, YouTube had this channel as {k.youtubeAtConnect ? "made for kids" : "not made for kids"}.</p>
      )}
      {posted > 0 && (
        <p>
          Your posted Shorts here: {count(k.no)} not made for kids, {count(k.yes)} made for kids{k.unknown ? `, and ${count(k.unknown)} with no answer saved` : ""}.
        </p>
      )}
      {k.youtubeMarked > 0 && <p>YouTube marked {count(k.youtubeMarked)} of them as made for kids.</p>}
      <p className="text-[12px] text-muted">
        Whether your channel is made for kids is your call. <a href={KIDS_GUIDE} target="_blank" rel="noreferrer" className={linked}>How YouTube decides</a>
      </p>
    </div>
  );
}

/** `shown` is whether the channel's YouTube Analytics have been read with views to show; the made-for-kids answers show either way. */
export function Audience({ c, shown }: { c: ChannelProof; shown: boolean }) {
  const a = c.audience;
  return (
    <div className="flex flex-col gap-6">
      {shown && (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-display text-lg uppercase tracking-wide">Who&rsquo;s watching</h3>
            <p className="text-[12px] text-muted">Signed-in viewers 13 and over, last 90 days</p>
          </div>
          {a ? (
            <>
              <ul className="flex flex-col gap-2" aria-label="Signed-in viewers by age group">
                {a.ages.map((g) => (
                  <li key={g.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px]">
                    <span>{g.label}</span>
                    <span className="h-2.5 bg-card-2" aria-hidden="true">
                      <span className="block h-full bg-signal" style={{ width: `${Math.min(100, Math.max(0, g.percent))}%` }} />
                    </span>
                    <span className="text-right font-mono text-[12px] tabular-nums">{percentOf(g.percent)}</span>
                  </li>
                ))}
              </ul>
              {/* each group kept whole on a narrow screen, so the line only breaks between them */}
              <p className="font-mono text-[12px] tabular-nums">
                {a.genders.map((g, i) => (
                  <Fragment key={g.id}>
                    {i > 0 && " · "}
                    <span className="whitespace-nowrap">{g.label} {percentOf(g.percent)}</span>
                  </Fragment>
                ))}
              </p>
              <p className="text-[12px] leading-relaxed text-muted">
                YouTube only shares this for viewers who are signed in and 13 or older. Nobody under 13 is in it, so it can&rsquo;t tell you whether kids watch.
              </p>
            </>
          ) : (
            <p className="text-[14px] leading-relaxed text-muted">YouTube hasn&rsquo;t shared viewers&rsquo; ages for this channel. It only does once enough signed-in viewers watch.</p>
          )}
        </div>
      )}
      <Kids c={c} />
    </div>
  );
}
