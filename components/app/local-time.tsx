"use client";
import { useEffect, useState } from "react";

/** How long ago, the way people say it. */
export function ago(d: Date, now: Date): string {
  const s = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2 * 86400) return "Yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * A time in the viewer's own timezone. The server doesn't know it, so the
 * first paint shows the date alone and the time fills in on the device.
 */
export function LocalTime({ iso, style = "short" }: { iso: string; style?: "short" | "day" | "ago" | "time" }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86400000);
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const dayName = same(d, today) ? "Today" : same(d, tomorrow) ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    setText(style === "ago" ? ago(d, today) : style === "time" ? time : style === "day" ? dayName : `${dayName}, ${time}`);
  }, [iso, style]);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text ?? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
    </time>
  );
}
