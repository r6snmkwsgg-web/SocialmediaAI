"use client";
import { useEffect, useState } from "react";

/**
 * A time in the viewer's own timezone. The server doesn't know it, so the
 * first paint shows the date alone and the time fills in on the device.
 */
export function LocalTime({ iso, style = "short" }: { iso: string; style?: "short" | "day" }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86400000);
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const dayName = same(d, today) ? "Today" : same(d, tomorrow) ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    setText(style === "day" ? dayName : `${dayName}, ${time}`);
  }, [iso, style]);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text ?? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
    </time>
  );
}
