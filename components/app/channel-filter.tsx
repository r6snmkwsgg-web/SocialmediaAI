import Link from "next/link";

/**
 * Seeing one channel's Shorts, or every channel's: chips that set
 * `?channel=` and keep the page's other parameters. A disconnected channel
 * is marked, since its Shorts stay to be posted by hand. A page that only
 * ever shows one channel at a time goes without the chip for all of them.
 */
export function ChannelFilter({
  channels,
  picked,
  path,
  keep = {},
  all = true,
}: {
  channels: { id: string; name: string; status: string }[];
  /** the channel shown, or null for all of them */
  picked: string | null;
  /** the page's own address, and the parameters it keeps */
  path: string;
  keep?: Record<string, string | null | undefined>;
  all?: boolean;
}) {
  const href = (channel: string | null) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, channel })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `${path}?${s}` : path;
  };
  const chip = (on: boolean) =>
    `border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] ${on ? "border-fg bg-fg text-surface" : "border-edge text-muted hover:border-fg hover:text-fg"}`;
  return (
    <nav aria-label="Channels" className="mb-6 flex flex-wrap gap-1">
      {all && (
        <Link href={href(null)} aria-current={picked === null ? "page" : undefined} className={chip(picked === null)}>
          All channels
        </Link>
      )}
      {channels.map((c) => (
        <Link key={c.id} href={href(c.id)} aria-current={picked === c.id ? "page" : undefined} className={chip(picked === c.id)}>
          {c.name}
          {c.status === "revoked" && <span className={picked === c.id ? "opacity-70" : "text-muted"}> (disconnected)</span>}
        </Link>
      ))}
    </nav>
  );
}
