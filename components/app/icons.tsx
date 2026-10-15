/**
 * The app's icons: drawn here, thick and square-ended like the rest of
 * the brand, so nothing looks borrowed from an icon pack.
 */

type P = { className?: string };
const base = { fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "square" as const, strokeLinejoin: "miter" as const, "aria-hidden": true };

export const Icons = {
  home: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z" />
    </svg>
  ),
  shorts: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <rect x="6" y="2.5" width="12" height="19" rx="1" />
      <path d="M10.5 9l4 3-4 3z" fill="currentColor" stroke="none" />
    </svg>
  ),
  live: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 4.5a10.6 10.6 0 0 1 0 15" />
    </svg>
  ),
  trends: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 18l6-6 4 4 8-9" />
      <path d="M15 7h6v6" />
    </svg>
  ),
  earnings: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </svg>
  ),
  settings: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  ),
  sun: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </svg>
  ),
  moon: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  ),
  arrow: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  check: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  ),
  x: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  ),
  bell: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M6 16V10a6 6 0 0 1 12 0v6l2 2H4z" />
      <path d="M10 21h4" />
    </svg>
  ),
  alert: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </svg>
  ),
  download: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 3v12M6 10l6 6 6-6M4 21h16" />
    </svg>
  ),
  plug: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M8 3v5M16 3v5M5 8h14v4a7 7 0 0 1-14 0zM12 19v3" />
    </svg>
  ),
  card: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <rect x="2.5" y="5" width="19" height="14" />
      <path d="M2.5 10h19M6 15h4" />
    </svg>
  ),
  search: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </svg>
  ),
  calendar: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3" y="5" width="18" height="16" />
      <path d="M3 10h18M8 2.5V7M16 2.5V7" />
    </svg>
  ),
  grid: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.5" y="3.5" width="7" height="7" />
      <rect x="13.5" y="3.5" width="7" height="7" />
      <rect x="3.5" y="13.5" width="7" height="7" />
      <rect x="13.5" y="13.5" width="7" height="7" />
    </svg>
  ),
  external: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
    </svg>
  ),
  bolt: ({ className }: P) => (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
};
