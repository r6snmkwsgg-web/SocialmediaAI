import type { Point } from "@/lib/earnings/series";

/**
 * One measure, day by day, as bars from a shared baseline: one colour, one
 * axis, the biggest day marked, and every bar's exact figure on hover and
 * in a table for screen readers. Days a source didn't report are left
 * empty rather than drawn as zero.
 */

export type Unit = "count" | "money" | "coins";

export function say(v: number, unit: Unit, currency = "USD", compact = false): string {
  if (unit === "money") return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 2 }).format(v);
  const n = new Intl.NumberFormat("en-US", { notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(v);
  return unit === "coins" ? `${n} coins` : n;
}

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function DailyBars({ points, unit, currency, label }: { points: Point[]; unit: Unit; currency?: string; label: string }) {
  const W = 320, H = 110, base = 92, top = 14;
  const n = points.length;
  const max = Math.max(0, ...points.map((p) => p.value ?? 0));
  const step = W / n;
  const gap = n > 45 ? 1 : 2;
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label}, day by day`}>
        <line x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} stroke="var(--edge-strong)" strokeWidth={1} />
        {max > 0 && (
          <>
            <line x1={0} x2={W} y1={top} y2={top} stroke="var(--edge)" strokeWidth={1} strokeDasharray="2 3" />
            <text x={0} y={top - 4} fontSize={9} fill="var(--muted)" fontFamily="var(--font-martian)">{say(max, unit, currency, true)}</text>
          </>
        )}
        {points.map((p, i) => {
          if (p.value === null) return null;
          const h = max > 0 ? Math.max(p.value > 0 ? 1.5 : 0, ((base - top) * p.value) / max) : 0;
          return (
            <rect key={p.day} x={i * step + gap / 2} y={base - h} width={Math.max(1, step - gap)} height={h} rx={Math.min(1.5, (step - gap) / 2)} fill="var(--color-signal)">
              <title>{`${day(p.day)}: ${say(p.value, unit, currency)}`}</title>
            </rect>
          );
        })}
        <text x={0} y={H - 2} fontSize={9} fill="var(--muted)" fontFamily="var(--font-martian)">{day(points[0].day)}</text>
        <text x={W} y={H - 2} fontSize={9} fill="var(--muted)" textAnchor="end" fontFamily="var(--font-martian)">{day(points[n - 1].day)}</text>
      </svg>
      {/* a table can't be shrunk out of sight by itself, so it goes in a box that can */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {points.map((p) => (
              <tr key={p.day}>
                <th scope="row">{day(p.day)}</th>
                <td>{p.value === null ? "not reported" : say(p.value, unit, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
