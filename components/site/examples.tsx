import { DailyBars } from "@/components/app/daily-bars";
import { lastDays } from "@/lib/earnings/series";
import { DemoLabel } from "./chrome";

/**
 * What Trends and Earnings look like, for the website. These are made-up
 * examples, and they say so on them: the app itself only ever shows real
 * numbers.
 */

const ROWS = [
  { format: "Quiz", title: "Name these 5 capitals in 3 seconds each", rate: "8.4K", age: "6h" },
  { format: "Ball battle", title: "Spike vs Sword: who wins?", rate: "6.1K", age: "11h" },
  { format: "Bar chart race", title: "The 10 biggest economies in Asia, 1990 to 2023", rate: "3.9K", age: "19h" },
  { format: "Would you rather", title: "Would you rather: 5 choices you can't skip", rate: "2.7K", age: "1d" },
];

export function ExampleTrends() {
  return (
    <div className="border-2 border-line bg-ink-2">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <span className="font-display text-xl uppercase tracking-wide">Rising now</span>
        <DemoLabel>Example data</DemoLabel>
      </div>
      <ol>
        {ROWS.map((r, i) => (
          <li key={r.title} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0">
            <span className="font-mono text-[12px] text-dim">0{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{r.title}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{r.format} · up {r.age}</span>
            </span>
            <span className="text-right font-display text-2xl leading-none">
              {r.rate}
              <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-dim">views/hour</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** a made-up month that rises and wobbles, so the charts have a shape */
function wave(n: number, base: number, swing: number, grow: number, seed: number) {
  const days = lastDays("2026-10-15", n);
  return days.map((day, i) => ({ day, value: Math.max(0, Math.round(base + swing * Math.sin(i / 2.3 + seed) + grow * i)) }));
}

export function ExampleEarnings() {
  const charts = [
    { label: "Views on YouTube", unit: "count" as const, points: wave(30, 900, 300, 60, 1) },
    { label: "Views on TikTok", unit: "count" as const, points: wave(30, 600, 250, 35, 2.4) },
    { label: "Gift coins seen on your LIVEs", unit: "coins" as const, points: wave(30, 120, 110, 6, 0.7).map((p, i) => ({ ...p, value: i % 3 ? 0 : p.value })) },
  ];
  return (
    <div className="tokens-dark">
      <div className="mb-3 flex justify-end"><DemoLabel>Demo · not real numbers</DemoLabel></div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {charts.map((c) => (
          <li key={c.label} className="flex flex-col gap-3 border-2 border-edge bg-card px-4 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{c.label}</span>
            <DailyBars points={c.points} unit={c.unit} label={`${c.label} (demo)`} />
          </li>
        ))}
      </ul>
    </div>
  );
}
