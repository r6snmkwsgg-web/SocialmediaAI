import { LocalTime } from "@/components/app/local-time";

/** One of a wait's lines (HELD in lib/shorts/history.ts), with when it goes up where {time} is, in the viewer's own timezone. */
export function HeldWords({ text, until }: { text: string; until: Date }) {
  const [before, after = ""] = text.split("{time}");
  return (
    <>
      {before}
      <LocalTime iso={until.toISOString()} />
      {after}
    </>
  );
}
