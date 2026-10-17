import { measureLine, times, type FormatInsight, type KindInsight, type Measure } from "@/lib/shorts/insights";

/**
 * What's working, as one measure: each format's first day against the
 * channel's usual Short. Bars grow right of the middle line when a
 * format beats usual and left when it doesn't, on a scale where 2× and
 * half are the same distance from it. Each row also says it in words, and
 * a line under the bars says what the first days were compared by, and
 * that the comparisons are Hookline's.
 */
export function Working({ formats, kinds, measure }: { formats: FormatInsight[]; kinds: KindInsight[]; measure: Measure }) {
  const reach = Math.log(4);
  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-3" aria-label="Each format's first day against your usual Short">
        {formats.map((f) => {
          const x = f.samples ? Math.max(-1, Math.min(1, Math.log(f.score) / reach)) : 0;
          return (
            <li key={f.format} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[10rem_minmax(0,1fr)_9.5rem]">
              <span className="order-1 truncate text-[14px] font-medium">{f.name}</span>
              <span className="relative order-3 col-span-2 h-5 sm:order-2 sm:col-span-1" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/2 w-[2px] bg-edge-strong" />
                {f.samples > 0 && (
                  <span
                    className={`absolute top-1/2 h-2.5 -translate-y-1/2 ${x >= 0 ? "bg-signal" : "bg-edge-strong"}`}
                    style={x >= 0 ? { left: "50%", width: `${Math.max(1.5, x * 50)}%` } : { right: "50%", width: `${Math.max(1.5, -x * 50)}%` }}
                  />
                )}
              </span>
              <span className="order-2 text-right text-[13px] tabular-nums text-muted sm:order-3">
                {f.samples ? (
                  <>
                    <b className="font-semibold text-fg">{times(f.score)}</b> usual · {f.samples} posted
                  </>
                ) : (
                  "Not measured yet"
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted sm:ml-[11rem] sm:mr-[10.5rem]" aria-hidden="true">
        <span>¼× usual</span>
        <span>Usual</span>
        <span>4× usual</span>
      </div>
      <p className="-mt-2 text-[12px] leading-relaxed text-muted">{measureLine(measure)}</p>
      {kinds.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Standing out</p>
          <ul className="flex flex-wrap gap-2">
            {kinds.slice(0, 8).map((k) => (
              <li key={k.group} className={`border-2 px-2.5 py-1 text-[13px] ${k.score >= 1 ? "border-signal" : "border-edge-strong text-muted"}`}>
                {k.name} <b className="tabular-nums">{times(k.score)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
