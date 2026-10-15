export function Hook({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 32" className={className} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="square" aria-hidden="true">
      <path d="M16 2v17a6.5 6.5 0 0 1-13 0v-3" />
      <path d="M3 16l4.5 3.5" />
      <circle cx="16" cy="3" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1.5 font-display uppercase tracking-[0.08em] ${className}`}>
      <Hook className="h-[1.05em] w-auto text-signal" />
      Hookline
    </span>
  );
}

export function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <p className={`font-mono text-[11px] uppercase tracking-[0.22em] ${dark ? "text-ink/55" : "text-dim"}`}>{children}</p>;
}
