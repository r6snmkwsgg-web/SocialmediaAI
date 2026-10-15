import Link from "next/link";

/**
 * The app's building blocks. Hard edges, ink and paper, one orange action
 * per screen: the same feel as the website, quieter, and in both themes.
 */

export const button = {
  /** the one thing to do on a screen */
  primary: "press inline-flex items-center justify-center gap-2 bg-signal px-5 py-2.5 font-display text-lg uppercase tracking-wider text-ink [--press:var(--fg)] disabled:opacity-50",
  secondary: "inline-flex items-center justify-center gap-2 border-2 border-fg px-4 py-2 font-display text-base uppercase tracking-wider text-fg transition hover:bg-fg hover:text-surface disabled:opacity-50",
  quiet: "inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted transition hover:text-fg",
};

export function PageHead({ eyebrow, title, line, action }: { eyebrow?: string; title: string; line?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">{eyebrow}</p>}
        <h1 className="font-display text-[clamp(2.4rem,5vw,3.6rem)] uppercase leading-[0.92] tracking-[0.01em]">{title}</h1>
        {line && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{line}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Card({ children, className = "", as: Tag = "section" }: { children: React.ReactNode; className?: string; as?: "section" | "div" | "li" | "article" }) {
  return <Tag className={`min-w-0 border-2 border-edge bg-card ${className}`}>{children}</Tag>;
}

export function CardHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b-2 border-edge px-5 py-3">
      <h2 className="font-display text-xl uppercase tracking-wide">{title}</h2>
      {action}
    </div>
  );
}

/** A number that matters, big, with what it is under it. */
export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      <span className="font-display text-4xl leading-none tabular-nums">{value}</span>
      {sub && <span className="text-[13px] text-muted">{sub}</span>}
    </div>
  );
}

/** Nothing here yet: what it'll show, and the one step that gets it there. */
export function Empty({ title, body, action }: { title: string; body: React.ReactNode; action?: { href: string; label: string } | React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 border-2 border-dashed border-edge-strong px-6 py-8">
      <h3 className="font-display text-2xl uppercase tracking-wide">{title}</h3>
      <div className="max-w-xl text-[15px] leading-relaxed text-muted">{body}</div>
      {action && typeof action === "object" && "href" in action ? (
        <Link href={action.href} className={`${button.primary} mt-1`}>
          {action.label}
        </Link>
      ) : (
        action
      )}
    </div>
  );
}

export function Pill({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "good" | "warn" | "signal" }) {
  const tones = {
    plain: "border-edge-strong text-muted",
    good: "border-[#1f8a3b] text-[#1f8a3b] dark:text-[#34c759]",
    warn: "border-[#b8860b] text-[#b8860b]",
    signal: "border-signal text-signal",
  };
  return <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${tones[tone]}`}>{children}</span>;
}

/** A section's label, small and spaced. */
export function Label({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{children}</p>;
}

/** A service that isn't set up yet: says which, plainly, for whoever runs the app. */
export function NotSetUp({ what, keys }: { what: string; keys: string[] }) {
  return (
    <div className="border-2 border-dashed border-edge-strong px-5 py-4 text-[14px] leading-relaxed text-muted">
      <b className="font-display text-base uppercase tracking-wide text-fg">{what} isn&rsquo;t connected yet.</b> Whoever runs this Hookline needs to set{" "}
      {keys.map((k, i) => (
        <span key={k}>
          <code className="bg-card-2 px-1 font-mono text-[12px]">{k}</code>
          {i < keys.length - 1 ? ", " : ""}
        </span>
      ))}
      .
    </div>
  );
}
