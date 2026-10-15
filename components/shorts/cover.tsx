import type { FormatId } from "@/lib/shorts/types";

/**
 * A Short's card picture, drawn in the page from its format's look (the
 * same ink and colours as the video), so a grid of them loads instantly.
 * The video itself plays on the Short's own page.
 */
export function Cover({ format, label, className = "" }: { format: FormatId; label: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-ink ${className}`} aria-hidden="true">
      <Art format={format} />
      <p className="absolute bottom-3 left-3 font-mono text-[10px] uppercase tracking-[0.16em] text-paper/70">{label}</p>
    </div>
  );
}

function Art({ format }: { format: FormatId }) {
  switch (format) {
    case "battle":
      return (
        <div className="absolute inset-0 flex items-center justify-center gap-0">
          <span className="h-16 w-16 rounded-full border-4 border-ink bg-[#ff3b30]" />
          <span className="-ml-3 h-16 w-16 rounded-full border-4 border-ink bg-[#0a84ff]" />
          <span className="absolute font-display text-xl text-paper">VS</span>
        </div>
      );
    case "quiz":
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-[96px] leading-none text-[#ffd60a]">?</span>
        </div>
      );
    case "wyr":
      return (
        <div className="absolute inset-x-0 top-0 h-[82%]">
          <div className="h-1/2 bg-[#ff3b30]" />
          <div className="h-1/2 bg-[#0a84ff]" />
          <span className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-paper bg-ink font-display text-sm text-paper">OR</span>
        </div>
      );
    case "texts":
      return (
        <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 flex-col gap-2">
          <span className="h-6 w-3/5 rounded-xl rounded-bl-sm bg-[#2c2c30]" />
          <span className="h-6 w-1/2 self-end rounded-xl rounded-br-sm bg-[#0a84ff]" />
          <span className="h-6 w-2/3 rounded-xl rounded-bl-sm bg-[#2c2c30]" />
        </div>
      );
    case "ranking":
      return (
        <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
          {[100, 82, 66, 52].map((w, i) => (
            <span key={w} className="flex h-5 items-center gap-1.5">
              <span className="w-3 font-display text-xs text-paper/70">{i + 1}</span>
              <span className="h-full bg-[#0a84ff]" style={{ width: `${w}%` }} />
            </span>
          ))}
        </div>
      );
    case "race":
      return (
        <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
          {[["#ffd60a", 96], ["#ff3b30", 78], ["#34c759", 70], ["#bf5af2", 54]].map(([c, w]) => (
            <span key={c} className="h-5" style={{ width: `${w}%`, background: String(c) }} />
          ))}
        </div>
      );
  }
}
